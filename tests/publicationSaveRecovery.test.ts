import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { savePublication } from "../src/production/creations.ts";
import { readState, updateSettings, updateState } from "../src/production/storage.ts";
import { productionActionSchema } from "../src/production/schemas.ts";
import { associatePublication } from "../src/production/publicationAssociation.ts";
import { ProductionWorkflow } from "../src/production/workflow.ts";
import { metricsSnapshot, runMetricsTask } from "../src/production/metricsTask.ts";
import type { PublicationInput } from "../src/production/types.ts";
import type { ContentDetail } from "../src/types.ts";

const fault = vi.hoisted(() => ({ partialBody: false, partialManifest: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(async (...args: Parameters<typeof writeFile>) => {
    if (fault.partialManifest && /save-[^/\\]+\.json\.[^/\\]+\.tmp$/.test(String(args[0]))) {
      fault.partialManifest=false;await actual.writeFile(args[0],'{"inputHash":');throw new Error("interrupted manifest write");
    }
    if (fault.partialBody && /body-\d+-[^/\\]+\.md$/.test(String(args[0]))) {
      fault.partialBody = false; await actual.writeFile(args[0], "partial"); throw new Error("interrupted body write");
    }
    return actual.writeFile(...args);
  }) };
});
const input: PublicationInput = { platform: "xiaohongshu", type: "images", title: "", body: "草稿", tags: [], imageIds: [] };
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-save-")), dataDir = join(folder, "settings");
  await updateSettings(dataDir, s => { s.accounts.xiaohongshu = { platform: "xiaohongshu", id: "A", name: "A", checkedAt: 1 }; });
  return { folder, dataDir, scope: { id: "project", folderPath: folder } };
}
describe("durable publication save operations", () => {
  it("atomically commits save identity so an interrupted manifest cannot block the same request",async()=>{
    const f=await fixture();fault.partialManifest=true;
    await expect(savePublication(f.folder,input,undefined,undefined,undefined,"manifest-1")).rejects.toThrow("manifest");
    const saved=await savePublication(f.folder,input,undefined,undefined,undefined,"manifest-1");
    expect(saved.revision).toBe(1);expect((await readState(f.folder)).publications).toHaveLength(1);
    expect((await savePublication(f.folder,input,undefined,undefined,undefined,"manifest-1")).id).toBe(saved.id);
  });
  it("persists incomplete drafts, merges concurrent creates and replays a lost receipt after later writes", async () => {
    const f = await fixture();
    expect(productionActionSchema.parse({ ...f.scope, action: "save-publication", input, saveId: "create-1" })).toBeTruthy();
    const [a, b] = await Promise.all([savePublication(f.folder, input, undefined, undefined, undefined, "create-1"), savePublication(f.folder, input, undefined, undefined, undefined, "create-1")]);
    expect(a).toEqual(b); expect((await readState(f.folder)).publications).toHaveLength(1);
    const edit = { ...input, title: "标题", body: "后续编辑" };
    const second = await savePublication(f.folder, edit, a.id, 1, undefined, "write-1");
    expect(await savePublication(f.folder, edit, a.id, 1, undefined, "write-1")).toEqual(second);
    expect((await savePublication(f.folder, input, undefined, undefined, undefined, "create-1")).revision).toBe(1);
    expect((await readState(f.folder)).publications![0]!.revision).toBe(2);
    await expect(savePublication(f.folder, { ...input, body: "different" }, undefined, undefined, undefined, "create-1")).rejects.toThrow("另一份内容");
    expect(await readFile(join(f.folder, a.bodyFile), "utf8")).toBe("草稿");
  });
  it("recovers only the manifest-owned partial output, without overwriting earlier versions", async () => {
    const f = await fixture(); fault.partialBody = true;
    await expect(savePublication(f.folder, input, undefined, undefined, undefined, "interrupted")).rejects.toThrow("interrupted");
    expect((await readState(f.folder)).publications).toBeUndefined();
    const saved = await savePublication(f.folder, input, undefined, undefined, undefined, "interrupted");
    expect(saved.revision).toBe(1); expect(await readFile(join(f.folder, saved.bodyFile), "utf8")).toBe("草稿");
    expect((await readdir(join(f.folder, ".dsh-creator-workbench", "production", "publications", saved.id))).some(n => n.includes(".incomplete-"))).toBe(true);
    await expect(savePublication(f.folder, { ...input, platform: "douyin" }, saved.id, 1, undefined, "move")).rejects.toThrow("另建");
    const writes = await Promise.allSettled([savePublication(f.folder, { ...input, body: "manual" }, saved.id, 1, undefined, "manual"), savePublication(f.folder, { ...input, body: "agent" }, saved.id, 1, undefined, "agent")]);
    expect(writes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await readFile(join(f.folder, saved.bodyFile), "utf8")).toBe("草稿");
  });
});

describe("account-owned work association", () => {
  it("starts the first exact-work sync from an uploaded record without previous metrics",async()=>{
    const f=await fixture(),p=await savePublication(f.folder,input);
    await updateState(f.folder,s=>{s.publications![0]!.platform="bilibili";s.records=[{id:"legacy-work",publicationId:p.id,revision:1,platform:"xiaohongshu",type:"images",accountId:"A",remoteId:"one",state:"uploaded",updatedAt:1}];});
    const snapshot=await metricsSnapshot(f.dataDir,f.folder,["xiaohongshu"],"xiaohongshu",undefined,{recordId:"legacy-work",expectedAccountId:"A"});
    expect(snapshot.metricsTargets).toEqual([{platform:"xiaohongshu",accountId:"A",recordId:"legacy-work",publicationId:p.id,remoteId:"one"}]);expect((await readState(f.folder)).metrics).toEqual([]);
    const task={id:"first-record-sync",kind:"metrics"as const,status:"running"as const,contentId:"p",folderPath:f.folder,createdAt:1,updatedAt:1,...snapshot};
    await updateState(f.folder,s=>{s.tasks.push(task);});
    await runMetricsTask({dataDir:f.dataDir,folder:f.folder,task,signal:new AbortController().signal,detail:{id:"p",title:"t",folderPath:f.folder}as ContentDetail,collect:async()=>[{platform:"xiaohongshu",remoteId:"one",title:"one",views:0}],changed:()=>undefined});
    const state=await readState(f.folder);expect(state.metrics).toHaveLength(1);expect(state.metrics[0]).toMatchObject({recordId:"legacy-work",accountId:"A",remoteId:"one",views:0,state:"ok"});expect(state.records![0]!.state).toBe("published");
  });

  it("does not rewrite other works when a legacy metric has only a material identity",async()=>{
    const f=await fixture(),p=await savePublication(f.folder,input),task={id:"metrics",kind:"metrics"as const,status:"running"as const,contentId:"p",folderPath:f.folder,createdAt:1,updatedAt:1,metricsTargets:[{platform:"xiaohongshu"as const,accountId:"A",publicationId:p.id,remoteId:"one"}]};
    await updateState(f.folder,s=>{s.tasks.push(task);s.records=["one","two"].map(remoteId=>({id:remoteId,publicationId:p.id,revision:1,platform:"xiaohongshu",type:"images",accountId:"A",remoteId,state:"linked",updatedAt:1}));s.metrics.push({platform:"xiaohongshu",accountId:"A",publicationId:p.id,remoteId:"one",checkedAt:1,state:"unassociated"});});
    await runMetricsTask({dataDir:f.dataDir,folder:f.folder,task,signal:new AbortController().signal,detail:{id:"p",title:"t",folderPath:f.folder}as ContentDetail,collect:async()=>[{platform:"xiaohongshu",remoteId:"one",title:"one",views:0}],changed:()=>undefined});
    const state=await readState(f.folder);expect(state.records!.map(r=>r.remoteId)).toEqual(["one","two"]);expect(state.records![1]!.state).toBe("linked");expect(state.metrics[0]!.views).toBe(0);
  });
  it("rejects a stale candidate/account through the real public workflow before writing any record", async () => {
    const f = await fixture(), p = await savePublication(f.folder, input);
    await updateState(f.folder, s => { s.candidates = [{ platform: "xiaohongshu", accountId: "A", remoteId: "same", title: "A work" }, { platform: "xiaohongshu", accountId: "B", remoteId: "same", title: "B work" }]; });
    await updateSettings(f.dataDir, s => { s.accounts.xiaohongshu!.id = "B"; });
    const workflow = new ProductionWorkflow({ dataDir: f.dataDir, resolve: async () => ({ ...f.scope, title: "test", covers: {}, tags: [], subtitles: {} }) as unknown as ContentDetail, key: async () => undefined, hasKey: async () => false, setKey: async () => undefined, platforms: async () => ["xiaohongshu"], jobs: () => undefined, changed: vi.fn() });
    await expect(workflow.action({ ...f.scope, action: "associate-publication", platform: "xiaohongshu", publicationId: p.id, expectedAccountId: "A", candidateAccountId: "A", remoteId: "same" }, new AbortController().signal)).rejects.toThrow("账号已变化");
    await expect(associatePublication(f.dataDir, f.folder, { ...f.scope, action: "associate-publication", platform: "xiaohongshu", publicationId: p.id, expectedAccountId: "B", candidateAccountId: "A", remoteId: "same" }, async () => undefined)).rejects.toThrow("账号已变化");
    expect((await readState(f.folder)).records).toBeUndefined(); expect((await readState(f.folder)).metrics).toEqual([]);
    await associatePublication(f.dataDir, f.folder, { ...f.scope, action: "associate-publication", platform: "xiaohongshu", publicationId: p.id, expectedAccountId: "B", candidateAccountId: "B", remoteId: "same" }, async () => undefined);
    expect((await readState(f.folder)).records![0]).toMatchObject({ accountId: "B", remoteId: "same" });
    expect((await readState(f.folder)).candidates).toHaveLength(2);
  });
  it("manual IDs remain supported while sync targets are limited to the exact record and account", async () => {
    const f = await fixture(), p = await savePublication(f.folder, input);
    for (const remoteId of ["one", "two"]) await associatePublication(f.dataDir, f.folder, { ...f.scope, action: "associate-publication", platform: "xiaohongshu", publicationId: p.id, expectedAccountId: "A", remoteId }, async () => undefined);
    const records = (await readState(f.folder)).records!;
    const snapshot = await metricsSnapshot(f.dataDir, f.folder, ["xiaohongshu"], "xiaohongshu", p.id, { recordId: records[1]!.id, expectedAccountId: "A" });
    expect(snapshot.metricsTargets).toHaveLength(1); expect(snapshot.metricsTargets[0]).toMatchObject({ recordId: records[1]!.id, remoteId: "two" });
    await updateSettings(f.dataDir, s => { s.accounts.xiaohongshu!.id = "B"; });
    await expect(metricsSnapshot(f.dataDir, f.folder, ["xiaohongshu"], "xiaohongshu", p.id, { recordId: records[0]!.id, expectedAccountId: "B" })).rejects.toThrow("其他账号");
  });
});
