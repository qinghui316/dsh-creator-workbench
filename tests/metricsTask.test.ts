import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { metricsSnapshot, runMetricsTask } from "../src/production/metricsTask.ts";
import { readState, updateSettings, updateState } from "../src/production/storage.ts";
import type { ContentDetail } from "../src/types.ts";
import type { ProductionTask } from "../src/production/types.ts";
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-metrics-")), dataDir = join(folder, "settings");
  await updateSettings(dataDir, (s) => { s.accounts.xiaohongshu = { platform: "xiaohongshu", id: "account", name: "作者", checkedAt: 1 }; });
  await updateState(folder, (s) => { s.metrics.push({ platform: "xiaohongshu", accountId: "account", remoteId: "post", state: "ok", checkedAt: 1, syncedAt: 1, views: 42 }); });
  const snapshot = await metricsSnapshot(dataDir, folder, ["xiaohongshu"]);
  const task: ProductionTask = { id: crypto.randomUUID(), kind: "metrics", status: "running", contentId: "episode", folderPath: folder, createdAt: Date.now(), updatedAt: Date.now(), ...snapshot };
  await updateState(folder, (s) => s.tasks.push(task));
  const detail = { id: "episode", title: "测试", folderPath: folder } as ContentDetail;
  return { folder, dataDir, task, detail, signal: new AbortController().signal, changed: vi.fn() };
}
describe("bounded account-bound metric lifecycle", () => {
  it("reads a platform once and applies separate identities for multiple works", async () => {
    const f = await fixture();
    await updateState(f.folder, state => { state.metrics.push({ platform: "xiaohongshu", accountId: "account", remoteId: "second", publicationId: "images", recordId: "record-images", state: "ok", checkedAt: 1, views: 7 }); });
    const snapshot = await metricsSnapshot(f.dataDir, f.folder, ["xiaohongshu"]); Object.assign(f.task, snapshot);
    await updateState(f.folder, state => { Object.assign(state.tasks[0]!, snapshot); });
    const collect = vi.fn(async () => [{ platform: "xiaohongshu" as const, remoteId: "post", title: "Video", views: 11 }, { platform: "xiaohongshu" as const, remoteId: "second", title: "Images", views: 22 }]);
    await runMetricsTask({ ...f, collect });
    const state = await readState(f.folder); expect(collect).toHaveBeenCalledOnce();
    expect(state.metrics.map(m => m.views)).toEqual([11,22]); expect(state.metrics[1]).toMatchObject({ publicationId: "images", recordId: "record-images" });
  });
  it("accepts exact zero metrics and marks publication only after the same account and work were verified", async () => {
    const f = await fixture(), published = vi.fn();
    await runMetricsTask({ ...f, published, collect: async () => [{ platform: "xiaohongshu", remoteId: "post", title: "测试", views: 0 }] });
    const state = await readState(f.folder);
    expect(state.tasks[0]).toMatchObject({ status: "completed", metricsProgress: [{ state: "completed", accountId: "account", remoteId: "post" }] });
    expect(state.metrics[0]).toMatchObject({ state: "ok", views: 0 }); expect(published).toHaveBeenCalledOnce();
  });
  it("terminates a hung platform, preserves successful data, and ignores a late result", async () => {
    const f = await fixture(), published = vi.fn(); let finish!: (value: never[]) => void;
    await runMetricsTask({ ...f, published, timeoutMs: 20, collect: () => new Promise((r) => { finish = r; }) });
    finish([]); await new Promise((r) => setTimeout(r, 10));
    const state = await readState(f.folder);
    expect(state.tasks[0]?.status).toBe("failed"); expect(state.metrics[0]).toMatchObject({ state: "error", views: 42, syncedAt: 1 }); expect(published).not.toHaveBeenCalled();
  });
  it("does not write publication or metrics to an account changed during collection", async () => {
    const f = await fixture(), published = vi.fn();
    await runMetricsTask({ ...f, published, collect: async () => { await updateSettings(f.dataDir, (s) => { s.accounts.xiaohongshu!.id = "different"; }); return [{ platform: "xiaohongshu", remoteId: "post", title: "测试", views: 100 }]; } });
    expect((await readState(f.folder)).metrics[0]?.views).toBe(42); expect(published).not.toHaveBeenCalled();
    expect((await metricsSnapshot(f.dataDir, f.folder, ["xiaohongshu"])).metricsKey).not.toBe(f.task.metricsKey);
  });
  it("cancels without automatic retry and gives every queued platform a terminal result", async () => {
    const f = await fixture(), controller = new AbortController(), collect = vi.fn(async () => { controller.abort(new Error("用户取消")); return []; });
    await runMetricsTask({ ...f, signal: controller.signal, collect });
    expect((await readState(f.folder)).tasks[0]).toMatchObject({ status: "cancelled", metricsProgress: [{ state: "cancelled" }] }); expect(collect).toHaveBeenCalledOnce();
  });
});
