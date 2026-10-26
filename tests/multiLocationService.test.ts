import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CreatorWorkbenchService } from "../src/service.ts";
import { saveOverlay, emptyOverlay } from "../src/overlay.ts";
import { registerCreatorTools } from "../src/tools.ts";
import { VideoImports } from "../src/videoImport.ts";
const roots: string[] = [], signal = () => new AbortController().signal;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "creator-multi-location-service-")); roots.push(root);
  const a = join(root, "A"), b = join(root, "B"), dataDir = join(root, "settings"); await mkdir(a); await mkdir(b);
  await saveOverlay(dataDir, { ...emptyOverlay(), libraryRoot: a, scriptRules: "原偏好", profile: { enabledPlatforms: ["douyin"] } });
  const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
  Object.assign(service, { dataDir, libraryRoot: a, catalogRevision: 0, ctx: { get: () => undefined }, imports: new VideoImports(), videos: new Map() }); service.ensureWatch = () => undefined;
  return { root, a, b, dataDir, service };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
it("changing default retains unified list, old project operations and unrelated settings across restart", async () => {
  const f = await fixture(), first = await f.service.createContent({ title: "第一期", requestId: "A" }, signal());
  await f.service.setLibraryRoot({ path: f.b }, signal());
  const second = await f.service.createContent({ title: "第二期", requestId: "B" }, signal());
  await f.service.setScript({ ...first, text: "A 项目的脚本" }, signal());
  const result = await f.service.listContents({ query: "", filter: "all" }, signal());
  expect(new Set(result.items.map(p => p.id))).toEqual(new Set([first.id, second.id]));
  expect(result.settings.libraryRoot).toBe(f.b); expect(result.settings.scriptRules).toBe("原偏好"); expect(result.settings.profile.enabledPlatforms).toEqual(["douyin"]);
  const reopened = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
  Object.assign(reopened, { dataDir: f.dataDir, libraryRoot: f.a, catalogRevision: 0, ctx: { get: () => undefined } }); reopened.ensureWatch = () => undefined;
  expect((await reopened.getContent(first, signal())).script).toBe("A 项目的脚本\n"); expect((await reopened.getSettings({}, signal())).libraryRoot).toBe(f.b);
  expect((await reopened.listContents({ query: f.a, filter: "all" }, signal())).items.map(p => p.id)).toEqual([first.id]);
});
it("UI and Agent share stable same-name isolation; old exact-path aliases resolve without changing default", async () => {
  const f = await fixture(), a = join(f.a, "同名"), b = join(f.b, "同名"); await mkdir(a); await mkdir(b);
  const first = await f.service.addProject({ path: a }, signal()), second = await f.service.addProject({ path: b }, signal());
  const tools = new Map<string, { execute: (args: unknown, exec: unknown) => Promise<unknown> }>();
  registerCreatorTools({ tools: { register: t => tools.set(t.name, t as never) } }, f.service);
  await expect(tools.get("creator_get_content")!.execute({ id: "同名" }, { signal: signal() })).rejects.toThrow("同名");
  const detail = await tools.get("creator_get_content")!.execute({ id: "同名", folderPath: a }, { signal: signal() }); expect(detail).toMatchObject({ id: first.id, folderPath: a });
  await f.service.setScript({ ...second, text: "B 的独立内容" }, signal());
  expect((await f.service.getContent(first, signal())).script).toBe(""); expect((await f.service.getSettings({}, signal())).libraryRoot).toBe(f.a);
});
it("an import keeps its project directory when the creation default changes mid-copy", async () => {
  const f = await fixture(), p = await f.service.createContent({ title: "导入", requestId: "import-project" }, signal()), source = join(f.root, "external.MP4"); await writeFile(source, Buffer.alloc(2 * 1024 * 1024, 7));
  let done: Promise<unknown> | undefined;
  f.service.importJobs = { start: (job: { run: () => { done: Promise<unknown> } }) => { done = job.run().done; return "job"; } } as never;
  const task = await f.service.startVideoImport({ ...p, sourcePath: source }, signal());
  await f.service.setLibraryRoot({ path: f.b }, signal()); await done;
  expect((await f.service.getVideoImport({ token: task.token }, signal())).status).toBe("completed");
  expect((await f.service.getContent(p, signal())).selectedVideo).toBe("external.MP4"); expect(await readdir(f.b)).toEqual([]);
  expect((await readFile(source)).equals(await readFile(join(p.folderPath, "external.MP4")))).toBe(true);
});
it("a missing project remains visible and another location continues to work", async () => {
  const f = await fixture(), first = await f.service.addProject({ path: f.a }, signal()), second = await f.service.addProject({ path: f.b }, signal());
  await rm(f.a, { recursive: true }); f.service.invalidateCatalog();
  const result = await f.service.listContents({ query: "", filter: "all" }, signal()); expect(result.items.find(p => p.id === first.id)?.accessError).toBeTruthy();
  expect((await f.service.getContent(second, signal())).folderPath).toBe(f.b); await expect(f.service.getContent(first, signal())).rejects.toThrow("不可访问");
});

it("legacy same-name saves return a successful stable receipt after writing the exact folder", async () => {
  const f = await fixture(), a = join(f.a, "demo"), b = join(f.b, "demo"); await mkdir(a); await mkdir(b);
  const pa = await f.service.addProject({path:a},signal()); await f.service.addProject({path:b},signal());
  const script = await f.service.setScript({id:"demo",folderPath:a,text:"旧会话脚本"},signal());
  expect(script.id).toBe(pa.id); expect(script.script).toBe("旧会话脚本\n");
  const note = await f.service.setTopicNote({id:"demo",folderPath:a,text:"旧会话选题"},signal());
  expect(note.id).toBe(pa.id); expect(note.topicNote).toBe("旧会话选题\n");
  expect(await readdir(b)).toEqual([]); expect(await readFile(join(a,"script.md"),"utf8")).toBe("旧会话脚本\n");
});

it("legacy scoped media uses independent stable cache keys", async () => {
  const f = await fixture(), a = join(f.a,"demo"), b = join(f.b,"demo"); await mkdir(a); await mkdir(b);
  await writeFile(join(a,"a.mp4"),"A-video"); await writeFile(join(b,"b.mp4"),"B-video");
  for (const folder of [a,b]) { await mkdir(join(folder,"公众号文章")); await writeFile(join(folder,"公众号文章","article.md"),"# article"); await writeFile(join(folder,"公众号文章","image.png"),"image"); }
  const pa = await f.service.addProject({path:a},signal()), pb = await f.service.addProject({path:b},signal());
  f.service.articles = new Map();
  try {
    const va = await f.service.getVideoPlayback({id:"demo",folderPath:a},signal());
    await f.service.getVideoPlayback({id:"demo",folderPath:b},signal());
    expect([...f.service.videos.keys()].sort()).toEqual([pa.id,pb.id].sort()); expect(await (await fetch(va.url)).text()).toBe("A-video");
    const aa = await f.service.getArticleMedia({id:"demo",folderPath:a},signal()); await f.service.getArticleMedia({id:"demo",folderPath:b},signal());
    expect([...f.service.articles.keys()].sort()).toEqual([pa.id,pb.id].sort()); expect((await fetch(aa.origin + "/image.png")).status).toBe(200);
  } finally { for (const v of f.service.videos.values()) v.close(); for (const a of f.service.articles.values()) a.close(); }
});
it("offline project removal persists a barrier without creating replacement files",async()=>{
  const f=await fixture(), p=await f.service.addProject({path:f.a},signal()); await rm(f.a,{recursive:true}); f.service.invalidateCatalog();
  const inspected=await f.service.projectAction({...p,action:"inspect"},signal()); expect(inspected.tasks.join(" ")).toContain("不可访问");
  await f.service.projectAction({...p,action:"remove",cancelTasks:true},signal());
  expect((await f.service.listContents({query:"",filter:"all"},signal())).items.some(row=>row.id===p.id)).toBe(false);
  expect(await readdir(f.root)).not.toContain("A"); await expect(f.service.getContent(p,signal())).rejects.toThrow("已从工作台移除");
});
it("location-only results remain accurate when unrelated credential inspection is unavailable",async()=>{
  const f=await fixture(); const get=vi.fn(()=>{throw new Error("credentials unavailable");}); Object.assign(f.service,{ctx:{get}});
  expect(await f.service.setProjectLocation({path:f.b},signal())).toMatchObject({libraryRoot:f.b,libraryConfirmed:true});
  expect((await f.service.getProjectLocations({},signal())).projectLocations?.map(p=>p.path)).toEqual([f.a,f.b]); expect(get).not.toHaveBeenCalled();
});
it("directory cleanup cannot move an outer project containing another registered project",async()=>{
  const f=await fixture(),outer=join(f.a,"outer"),child=join(outer,"child");await mkdir(child,{recursive:true});
  const p=await f.service.addProject({path:outer},signal());await f.service.addProject({path:child},signal());
  await expect(f.service.organizeLibrary({apply:true,libraryRoot:f.a,ids:[p.id]},signal())).rejects.toThrow("另一个已登记项目");
  expect(await readdir(outer)).toEqual(["child"]);
});
