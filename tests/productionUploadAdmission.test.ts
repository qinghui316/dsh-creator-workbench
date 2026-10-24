import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProductionWorkflow } from "../src/production/workflow.ts";
import { registerProductionTools } from "../src/production/tools.ts";
import { readState, updateSettings, updateState } from "../src/production/storage.ts";
import type { ContentDetail } from "../src/types.ts";
import type { ProductionAction, ProductionTask } from "../src/production/types.ts";

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-upload-admission-")), dataDir = join(folder, "settings");
  await writeFile(join(folder, "one.mp4"), "one video"); await writeFile(join(folder, "two.mp4"), "two video");
  const detail = { id: "episode", folderPath: folder, selectedVideo: "one.mp4", videoSelection: "selected", covers: {} } as ContentDetail;
  const host = { dataDir, resolve: async () => detail, key: async () => undefined, hasKey: async () => false, setKey: async () => undefined, platforms: async () => ["xiaohongshu", "bilibili"] as const, jobs: () => undefined, changed: () => undefined };
  await updateSettings(dataDir, (state) => { for (const platform of ["xiaohongshu", "bilibili"] as const) state.accounts[platform] = { id: `${platform}-account`, platform, name: "创作者", checkedAt: 1 }; });
  const workflow = new ProductionWorkflow(host), signal = new AbortController().signal;
  const launch = vi.spyOn(workflow, "launch").mockImplementation(async (_folder, task) => { workflow.active.set(task.id, { folder, controller: new AbortController() }); await workflow.patch(folder, task.id, { status: "running" }); });
  const request: Extract<ProductionAction, { action: "upload" }> = { id: detail.id, folderPath: folder, action: "upload", input: { platform: "xiaohongshu", title: "本期标题", description: "实际正文", tags: ["软件"], originalRightsConfirmed: true, useCovers: false } };
  const interrupt = async (status: ProductionTask["status"] = "unconfirmed") => { workflow.active.clear(); await updateState(folder, (state) => { state.tasks.at(-1)!.status = status; }); };
  return { folder, dataDir, detail, workflow, signal, launch, request, interrupt };
}
describe("shared upload admission", () => {
  it.each(["unconfirmed", "blocked", "cancelled", "ready"] as const)("retains %s uploads on repeated and concurrent clicks", async (status) => {
    const f = await fixture(); const original = (await f.workflow.action(f.request, f.signal)).tasks[0]!;
    await f.interrupt(status);
    const repeats = await Promise.all(Array.from({ length: 8 }, () => f.workflow.action(f.request, f.signal)));
    expect((await readState(f.folder)).tasks).toHaveLength(1); expect(f.launch).toHaveBeenCalledOnce();
    expect(repeats.every((state) => state.uploadNotice?.taskId === original.id)).toBe(true);
  });
  it("shares the same guard with real registered Agent tool calls", async () => {
    const f = await fixture(); await f.workflow.action(f.request, f.signal); await f.interrupt("blocked");
    const tools = new Map<string, { execute: (args: unknown, exec: unknown) => Promise<unknown> }>();
    registerProductionTools({ get: (name: string) => name === "tools" ? { register: (tool: { name: string }) => tools.set(tool.name, tool as never) } : { saveImages: vi.fn() } } as never, f.workflow);
    const tool = tools.get("creator_production_action")!;
    await Promise.all(Array.from({ length: 5 }, () => tool.execute({ action: f.request }, { signal: f.signal })));
    expect((await readState(f.folder)).tasks).toHaveLength(1); expect(f.launch).toHaveBeenCalledOnce();
  });
  it("keeps different platforms, accounts, videos and folders separate", async () => {
    const f = await fixture(); await f.workflow.action(f.request, f.signal);
    await f.workflow.action({ ...f.request, input: { ...f.request.input, platform: "bilibili" } }, f.signal);
    await updateSettings(f.dataDir, (state) => { state.accounts.xiaohongshu!.id = "new-account"; });
    await f.workflow.action(f.request, f.signal);
    f.detail.selectedVideo = "two.mp4"; await f.workflow.action(f.request, f.signal);
    expect((await readState(f.folder)).tasks).toHaveLength(4); expect(f.launch).toHaveBeenCalledTimes(4);
    const other = await fixture(); await other.workflow.action(other.request, other.signal);
    expect((await readState(other.folder)).tasks).toHaveLength(1);
  });
  it("requires explicit new-draft confirmation for changed materials and deduplicates concurrent confirmations", async () => {
    const f = await fixture(); const first = (await f.workflow.action(f.request, f.signal)).tasks[0]!; await f.interrupt();
    const changed = { ...f.request, input: { ...f.request.input, description: "另一版正文" } };
    expect((await f.workflow.action(changed, f.signal)).uploadNotice?.message).toContain("材料不同");
    expect((await readState(f.folder)).tasks).toHaveLength(1);
    await Promise.all(Array.from({ length: 8 }, () => f.workflow.action({ ...changed, newUploadAfter: first.id }, f.signal)));
    expect((await readState(f.folder)).tasks).toHaveLength(2); expect(f.launch).toHaveBeenCalledTimes(2);
    expect((await f.workflow.action(f.request, f.signal)).uploadNotice?.taskId).toBe(first.id);
  });
  it("detects changed cover bytes and conservatively protects legacy records without fingerprints", async () => {
    const f = await fixture(), cover = join(f.folder, "cover.png"); await writeFile(cover, "cover version one"); f.detail.covers = { "3x4": cover };
    const request = { ...f.request, input: { ...f.request.input, useCovers: true } };
    await f.workflow.action(request, f.signal); await f.interrupt(); await writeFile(cover, "cover version two");
    expect((await f.workflow.action(request, f.signal)).uploadNotice?.message).toContain("材料不同");
    await updateState(f.folder, (state) => { delete state.tasks[0]!.uploadKey; });
    expect((await f.workflow.action(request, f.signal)).uploadNotice?.message).toContain("尚未核验");
    expect((await readState(f.folder)).tasks).toHaveLength(1);
  });
});
