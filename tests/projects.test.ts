import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRegistry, directoryKey } from "../src/projects.ts";
import { emptyOverlay } from "../src/overlay.ts";
import { emptyProduction } from "../src/production/types.ts";
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "creator-projects-")); roots.push(root);
  const a = join(root, "父目录 A"), b = join(root, "父目录 B"), data = join(root, "state");
  await mkdir(a); await mkdir(b); const registry = new ProjectRegistry(data);
  await registry.initialize({ ...emptyOverlay(), libraryRoot: a }, a); return { root, a, b, data, registry };
}
async function marker(folder: string) { const dir = join(folder, ".dsh-creator-workbench", "production"); await mkdir(dir, { recursive: true }); await writeFile(join(dir, "index.json"), JSON.stringify(emptyProduction())); }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe("multi-parent project registration", () => {
  it("retains A projects while selecting B; dated creation override never changes the default", async () => {
    const f = await fixture(), first = await f.registry.create(f.a, "我的选题", "first");
    await f.registry.setDefault(f.b);
    const second = await f.registry.create(f.a, "本次仍放 A", "second"), third = await f.registry.create(f.b, "图文项目", "third");
    const reopened = await new ProjectRegistry(f.data).read();
    expect(reopened?.defaultParent).toBe(f.b); expect(reopened?.projects.map(p => p.id)).toEqual([first.id, second.id, third.id]);
    expect(reopened?.locations.map(p => p.path)).toEqual([f.a, f.b]); expect(basename(first.path)).toMatch(/^\d{4}-\d{2}-\d{2}_我的选题$/);
  });
  it("joins an exact empty folder, deduplicates aliases/concurrent joins, and isolates same-name directories", async () => {
    const f = await fixture(), a = join(f.a, "同名"), b = join(f.b, "同名"); await mkdir(a); await mkdir(b);
    const [first, alias, second] = await Promise.all([f.registry.join(a), f.registry.join(a + "/"), f.registry.join(b)]);
    expect(first.id).toBe(alias.id); expect(second.id).not.toBe(first.id); expect(await readdir(a)).toEqual([]);
    await f.registry.mutate(first.id, a, p => { p.selectedVideo = null; p.hiddenVideos = ["old.mp4"]; p.item.publish = { douyin: { status: "published" } }; });
    const state = (await f.registry.read())!; expect(state.projects.find(p => p.id === second.id)?.item).toEqual({});
    expect(() => f.registry.resolve(state, "同名")).toThrow("同名"); expect(f.registry.resolve(state, "同名", b)?.id).toBe(second.id);
  });
  it("recognizes only valid workbench evidence; removed projects do not reappear", async () => {
    const f = await fixture(), regular = join(f.a, "2026-10-26_普通文件夹"), recognized = join(f.a, "可靠记录");
    await mkdir(regular); await writeFile(join(regular, "video.mp4"), "video"); await marker(recognized); await f.registry.discover();
    expect((await f.registry.read())?.projects.map(p => p.path)).toEqual([recognized]);
    await f.registry.update(state => { state.projects[0]!.removed = true; }); await f.registry.discover();
    expect((await f.registry.read())?.projects[0]?.removed).toBe(true);
    const original = (await f.registry.read())!.projects[0]!.id; expect((await f.registry.join(recognized)).id).toBe(original);
  });
  it("keeps offline projects and never recreates their missing directory", async () => {
    const f = await fixture(), folder = join(f.a, "离线项目"); await mkdir(folder); const p = await f.registry.join(folder);
    await rename(f.a, f.a + "-offline");
    const state = (await f.registry.read())!; expect(state.projects[0]?.id).toBe(p.id); await expect(f.registry.locate(state.projects[0]!)).rejects.toThrow();
    await expect(f.registry.setDefault(f.a)).rejects.toThrow(); expect((await f.registry.read())?.defaultParent).toBe(f.a);
    expect((await readdir(f.root)).includes(basename(f.a))).toBe(false);
  });
  it("fails closed for a damaged or unsupported registry and preserves exact bytes", async () => {
    const f = await fixture(); await writeFile(f.registry.file, '{"schemaVersion":99,"projects":[]}'); const before = await readFile(f.registry.file, "utf8");
    await expect(f.registry.initialize(emptyOverlay(), f.a)).rejects.toThrow("项目记录读取失败");
    await expect(f.registry.join(f.b)).rejects.toThrow("项目记录读取失败"); expect(await readFile(f.registry.file, "utf8")).toBe(before);
  });
  it("backs up scoped legacy states and never assigns unscoped A/demo marks to current B/demo", async () => {
    const f = await fixture(), otherData = join(f.root, "legacy"), folder = join(f.a, "demo"); await mkdir(folder);
    const legacy = { ...emptyOverlay(), libraryRoot: f.b, items: { demo: { title: "A 的标题", publish: { douyin: { status: "published" as const } } } }, videoSelections: { [f.a]: { demo: null } }, hiddenVideos: { [f.a]: { demo: ["隐藏.mp4"] } } };
    const r = new ProjectRegistry(otherData); await r.initialize(legacy, f.b); const state = (await r.read())!;
    expect(state.projects.map(p => p.path)).toEqual([folder]); expect(state.projects[0]?.item).toEqual({}); expect(state.legacyItems.demo).toEqual(legacy.items.demo);
    expect(state.projects[0]?.selectedVideo).toBeNull(); expect(state.projects[0]?.hiddenVideos).toEqual(["隐藏.mp4"]);
    expect(JSON.parse(await readFile(join(otherData, "projects-migration-overlay.backup.json"), "utf8"))).toEqual(legacy);
  });
  it("retains original link aliases, merges migrated removal states, and detects retargeting", async () => {
    const f = await fixture(), actual = join(f.a, "actual"), aliasRoot = join(f.root, "alias"); await mkdir(actual); await symlink(f.a, aliasRoot, "junction");
    const r = new ProjectRegistry(join(f.root, "linked-state")); await r.initialize({ ...emptyOverlay(), libraryRoot: f.a, videoSelections: { [f.a]: { actual: "A.mp4" }, [aliasRoot]: { actual: null } }, hiddenVideos: { [f.a]: { actual: ["A.mp4"] }, [aliasRoot]: { actual: ["B.mp4"] } } }, f.a);
    const state = (await r.read())!; expect(state.projects).toHaveLength(1); expect(state.projects[0]?.hiddenVideos.sort()).toEqual(["A.mp4", "B.mp4"]); expect(state.projects[0]?.selectedVideo).toBeNull();
    const alias = join(f.root, "原来项目名"); await symlink(actual, alias, "junction"); const joined = await r.join(alias);
    expect(r.resolve((await r.read())!, "原来项目名", alias)?.id).toBe(joined.id);
    await rm(alias); await symlink(f.b, alias, "junction"); await expect(r.join(alias)).rejects.toThrow("链接的位置已变化");
  });
  it("retries a creation after registry save failure without creating a second folder", async () => {
    const f = await fixture(), save = vi.spyOn(f.registry, "save").mockRejectedValueOnce(new Error("disk busy"));
    await expect(f.registry.create(f.a, "创建恢复", "same-request")).rejects.toThrow("文件夹已创建"); expect(await readdir(f.a)).toHaveLength(1);
    save.mockRestore(); const result = await f.registry.create(f.a, "创建恢复", "same-request");
    const concurrent = await Promise.all([f.registry.create(f.a, "创建恢复", "same-request"), f.registry.create(f.a, "创建恢复", "same-request")]);
    expect(concurrent.every(p => p.id === result.id)).toBe(true); expect(await readdir(f.a)).toHaveLength(1);
  });
  it("stale creation receipts cannot reactivate a removed project or follow a replacement link", async () => {
    const f = await fixture(), p = await f.registry.create(f.a, "原项目", "request"); await f.registry.update(state => { state.projects[0]!.removed = true; });
    await expect(f.registry.create(f.a, "原项目", "request")).rejects.toThrow("已移除"); expect((await f.registry.read())?.projects[0]?.removed).toBe(true);
    await f.registry.join(p.path); await rename(p.path, p.path + "-saved"); await symlink(f.b, p.path, "junction");
    await expect(f.registry.create(f.a, "原项目", "request")).rejects.toThrow(); expect((await f.registry.read())?.projects).toHaveLength(1);
  });
  it("unchanged discovery does not write or advance revision; recovery preserves removed barriers", async () => {
    const f = await fixture(), p = await f.registry.join(f.b); await f.registry.update(s => { s.projects[0]!.removed = true; });
    const before = await readFile(f.registry.file, "utf8"); await f.registry.discover(); expect(await readFile(f.registry.file, "utf8")).toBe(before);
    await f.registry.recover(f.b); expect((await f.registry.read())?.projects.find(row => row.id === p.id)?.removed).toBe(true);
  });
  it("does not merge parent and child projects", async () => {
    const f = await fixture(), child = join(f.a, "child"); await mkdir(child); const parent = await f.registry.join(f.a), project = await f.registry.join(child);
    expect(project.id).not.toBe(parent.id); expect(directoryKey(project.path)).not.toBe(directoryKey(parent.path));
  });
  it("a newly joined folder at an old path never reuses a moved project's stable id", async () => {
    const f = await fixture(), old = join(f.a,"old"), moved = join(f.a,"moved"); await mkdir(old); const p = await f.registry.join(old); await rename(old,moved);
    await f.registry.update(state => { const current=state.projects[0]!;current.path=moved;current.sourcePath=moved;current.pathAliases=[moved];current.key=directoryKey(moved); });
    await mkdir(old);const fresh=await f.registry.join(old);expect(fresh.id).not.toBe(p.id);expect((await f.registry.read())?.projects).toHaveLength(2);
  });
});

it("refuses structurally damaged legacy overlays without writing a project registry",async()=>{
 const root=await mkdtemp(join(tmpdir(),"creator-bad-legacy-"));roots.push(root);const parent=join(root,"parent");await mkdir(parent);
 for(const [i,raw] of ["[]",'{"schemaVersion":1,"items":[]}'].entries()) { const data=join(root,String(i));await mkdir(data);await writeFile(join(data,"overlay.json"),raw);const r=new ProjectRegistry(data);await expect(r.initialize(emptyOverlay(),parent)).rejects.toThrow("旧项目记录读取失败");expect(await readFile(join(data,"overlay.json"),"utf8")).toBe(raw);expect(await r.read()).toBeUndefined(); }
});
