import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentDetail } from "../src/types.ts";
vi.mock("../src/production/browser.ts", () => ({ probeAccount: vi.fn(), pauseBrowser: vi.fn(), requireAccount: vi.fn(), browserControlStopped: vi.fn(() => false), withBrowser: async (_data: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<unknown>) => work(signal) }));
vi.mock("../src/production/runtime.ts", () => ({ runtimeStatus: vi.fn(async () => ({ publisher: true, article: true, python: true, ffmpeg: true, browser: true, details: [] })), prepareRuntime: vi.fn(), articleRoot: vi.fn(), browserExecutable: vi.fn() }));
vi.mock("../src/collectEgo.ts", () => ({ collectScriptPath: () => "collector.mjs", runCollectPublish: vi.fn() }));
vi.mock("../src/production/publishing.ts", () => ({ makeUploadPackage: vi.fn(), runUpload: vi.fn(), releaseUploadBrowser: vi.fn(async () => undefined) }));
import { probeAccount } from "../src/production/browser.ts";
import { runCollectPublish } from "../src/collectEgo.ts";
import { runUpload } from "../src/production/publishing.ts";
import { ProductionWorkflow } from "../src/production/workflow.ts";
import { readSettings, readState, updateSettings, updateState } from "../src/production/storage.ts";
beforeEach(() => vi.clearAllMocks());
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-workflow-")), video = "source.mp4"; await writeFile(join(folder, video), "stable video");
  const detail = { id: "episode", folderPath: folder, title: "测试", selectedVideo: video, videoSelection: "selected", covers: {}, subtitles: {}, script: "", article: "", tags: [] } as unknown as ContentDetail;
  const host = { dataDir: join(folder, "settings"), resolve: vi.fn(async () => detail), platforms: vi.fn(async () => ["xiaohongshu" as const]), key: vi.fn(async () => undefined), hasKey: vi.fn(async () => false), setKey: vi.fn(), jobs: () => undefined, changed: vi.fn() };
  return { folder, detail, host, workflow: new ProductionWorkflow(host), signal: new AbortController().signal };
}
describe("production workflow guards", () => {
  it("clears an old handoff error when the same upload passes its resumed inspection", async () => {
    const { workflow, host, detail, folder, signal } = await fixture();
    const account = { platform: "xiaohongshu" as const, id: "account", name: "创作者", checkedAt: 1 };
    await updateSettings(host.dataDir, s => { s.accounts.xiaohongshu = account; });
    const { task } = await workflow.newTask(detail, "upload", { platform: "xiaohongshu", account, status: "blocked", error: "浏览器已交给你" });
    vi.mocked(runUpload).mockResolvedValue({ ready: true, userControl: false, receipt: "verified.json" });
    await workflow.executeUpload(folder, task, "resume", signal);
    const saved = (await readState(folder)).tasks;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: task.id, status: "ready", receipt: "verified.json" });
    expect(saved[0]?.error).toBeUndefined();
    expect(vi.mocked(runUpload).mock.calls.map(([args]) => args.operation)).toEqual(["resume", "inspect"]);
  });
  it("requires explicit replacement and preserves old account ownership", async () => {
    const { workflow, host, signal } = await fixture();
    await updateSettings(host.dataDir, s => { s.accounts.xiaohongshu = { platform: "xiaohongshu", id: "old", name: "Old", checkedAt: 1 }; });
    vi.mocked(probeAccount).mockResolvedValue({ platform: "xiaohongshu", state: "connected", id: "new", name: "New", checkedAt: 2 });
    await expect(workflow.settingsAction({ action: "connect-account", platform: "xiaohongshu", expectedId: "new", replace: false }, signal)).rejects.toThrow("明确确认");
    expect((await readSettings(host.dataDir)).accounts.xiaohongshu?.id).toBe("old");
    await workflow.settingsAction({ action: "connect-account", platform: "xiaohongshu", expectedId: "new", replace: true }, signal);
    expect((await readSettings(host.dataDir)).accountHistory).toEqual([expect.objectContaining({ id: "old" })]);
  });
  it("deduplicates concurrent starts and only reconciles genuinely orphaned tasks", async () => {
    const { workflow, detail, folder } = await fixture();
    const starts = await Promise.all([workflow.newTask(detail, "upload", { platform: "xiaohongshu" }), workflow.newTask(detail, "upload", { platform: "xiaohongshu" })]);
    expect(starts.filter(s => s.fresh)).toHaveLength(1); expect(starts[0]!.task.id).toBe(starts[1]!.task.id);
    const task = starts[0]!.task;
    workflow.active.set(task.id, { folder, controller: new AbortController() });
    expect((await workflow.state(detail)).tasks[0]?.status).toBe("queued");
    const reopened = new ProductionWorkflow(workflow.host); expect((await reopened.state(detail)).tasks[0]?.status).toBe("unconfirmed");
    expect((await readState(folder)).tasks).toHaveLength(1);
  });
  it("blocks disabled platforms and uncertain paid retries before any new task or request", async () => {
    const { workflow, detail, folder, signal } = await fixture();
    await expect(workflow.action({ ...detail, action: "upload", input: { platform: "bilibili", title: "test", description: "", tags: [], originalRightsConfirmed: true, useCovers: false } }, signal)).rejects.toThrow("尚未启用");
    const selected = await workflow.selected(detail, signal);
    await updateState(folder, s => { s.tasks.push({ id: crypto.randomUUID(), kind: "asr", status: "unconfirmed", contentId: detail.id, folderPath: folder, video: selected.identity, createdAt: 1, updatedAt: 1 }); });
    await expect(workflow.action({ id: detail.id, folderPath: folder, action: "transcribe" }, signal)).rejects.toThrow("结果未确认");
    expect((await readState(folder)).tasks).toHaveLength(1);
  });
  it("reuses the same article request from another session and still rejects cancelled requests", async () => {
    const { workflow, detail, folder, signal } = await fixture();
    const first = await workflow.action({ id: detail.id, folderPath: folder, action: "prepare-article", sessionId: "one" }, signal), task = first.tasks[0]!;
    const result = await workflow.action({ id: detail.id, folderPath: folder, action: "prepare-article", sessionId: "other-session" }, signal);
    expect(result.tasks.find((row) => row.kind === "article")?.id).toBe(task.id);
    expect((await readState(folder)).tasks.filter((row) => row.kind === "article")).toHaveLength(1);
    await workflow.action({ id: detail.id, folderPath: folder, action: "cancel", taskId: task.id }, signal);
    await expect(workflow.articleInputs(detail, task.id, "one", signal)).rejects.toThrow("已结束");
  });
  it("refreshes linked metrics and still discovers newly connected platforms", async () => {
    const { workflow, host, folder, detail, signal } = await fixture();
    host.platforms.mockResolvedValue(["xiaohongshu", "bilibili"] as never);
    await updateSettings(host.dataDir, s => {
      s.accounts.xiaohongshu = { platform: "xiaohongshu", id: "xhs", name: "XHS", checkedAt: 1 };
      s.accounts.bilibili = { platform: "bilibili", id: "bili", name: "Bili", checkedAt: 1 };
    });
    await updateState(folder, s => { s.metrics.push({ platform: "xiaohongshu", accountId: "xhs", remoteId: "post-1", checkedAt: 1, state: "ok" }); });
    vi.mocked(runCollectPublish).mockImplementation(async (_script, _signal, options) => ({ collected: [{ platform: options?.platforms?.[0]!, items: [{ platform: options?.platforms?.[0]!, remoteId: options?.platforms?.[0] === "xiaohongshu" ? "post-1" : "bili-1", title: "测试", views: 0 }] }] }));
    const { task } = await workflow.newTask(detail, "metrics");
    await workflow.refreshMetrics(folder, task, undefined, signal);
    expect((await readState(folder)).metrics[0]).toMatchObject({ state: "ok", views: 0 });
    expect((await readState(folder)).candidates).toEqual([expect.objectContaining({ platform: "bilibili", remoteId: "bili-1", accountId: "bili" })]);
  });
  it("coalesces concurrent UI and Agent sync admission and refuses changed input scopes", async () => {
    const { workflow, host, folder, detail, signal } = await fixture();
    await updateSettings(host.dataDir, (s) => { s.accounts.xiaohongshu = { platform: "xiaohongshu", id: "one", name: "作者", checkedAt: 1 }; });
    const launch = vi.spyOn(workflow, "launch").mockImplementation(async (_folder, task) => { workflow.active.set(task.id, { folder, controller: new AbortController() }); });
    const request = { id: detail.id, folderPath: folder, action: "refresh-metrics" as const };
    await Promise.all([workflow.action(request, signal), workflow.action(request, signal)]);
    expect(launch).toHaveBeenCalledOnce(); expect((await readState(folder)).tasks).toHaveLength(1);
    await updateSettings(host.dataDir, (s) => { s.accounts.xiaohongshu!.id = "other"; });
    await expect(workflow.action(request, signal)).rejects.toThrow("其他平台、账号或作品");
    expect((await readState(folder)).tasks).toHaveLength(1);
  });

  it("rechecks project removal at task admission rather than admitting a delayed request", async () => {
    const { workflow, host, folder, detail } = await fixture();
    host.resolve.mockRejectedValue(new Error("项目已移除"));
    await expect(workflow.newTask(detail, "article")).rejects.toThrow("已移除");
    expect((await readState(folder)).tasks).toHaveLength(0);
  });

  it("keeps queued ownership through a deferred launch, and never starts a task cancelled in that window", async () => {
    const { workflow, host, folder, detail, signal } = await fixture();
    const { task } = await workflow.newTask(detail, "asr");
    let release!: (value: ContentDetail) => void;
    host.resolve.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const start = vi.fn(), jobs = { start }; Object.assign(host, { jobs: () => jobs });
    const run = vi.fn(async () => undefined), launching = workflow.launch(folder, task, run);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await workflow.state(detail)).tasks[0]?.status).toBe("queued");
    expect(workflow.pending.has(task.id)).toBe(true);
    await workflow.action({ id: detail.id, folderPath: folder, action: "cancel", taskId: task.id }, signal);
    release(detail); await launching;
    expect((await readState(folder)).tasks[0]?.status).toBe("cancelled");
    expect(start).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(workflow.pending.size).toBe(0);
  });
  it("reserves and launches once across concurrent calls, rejects an old launch snapshot, and reconciles a real restart", async () => {
    const { workflow, host, folder, detail } = await fixture(); const { task } = await workflow.newTask(detail, "asr");
    let done: Promise<unknown> | undefined, finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const jobs = { start: vi.fn((spec: { run: () => { done: Promise<unknown> } }) => { done = spec.run().done; return "job-one"; }) }; Object.assign(host, { jobs: () => jobs });
    const run = vi.fn(async () => { await gate; await workflow.patch(folder, task.id, { status: "ready" }); });
    await Promise.all([workflow.launch(folder, task, run), workflow.launch(folder, task, run)]);
    expect(run).toHaveBeenCalledOnce(); expect(jobs.start).toHaveBeenCalledOnce();
    finish(); await done; await workflow.launch(folder, task, run);
    expect(run).toHaveBeenCalledOnce(); expect((await readState(folder)).tasks[0]?.executionRevision).toBe(1);
    const queued = await workflow.newTask(detail, "metrics", { metricsKey: "next" });
    expect((await workflow.state(detail)).tasks.find((row) => row.id === queued.task.id)?.status).toBe("queued");
    expect((await new ProductionWorkflow(host).state(detail)).tasks.find((row) => row.id === queued.task.id)?.status).toBe("unconfirmed");
  });
  it("does not invoke external work when a registered Job is cancelled before its run callback", async () => {
    const { workflow, host, folder, detail, signal } = await fixture(); const { task } = await workflow.newTask(detail, "upload", { platform: "xiaohongshu" });
    let spec!: { run: () => { done: Promise<unknown> } };
    const jobs = { start: vi.fn((value: typeof spec) => { spec = value; return "job-delayed"; }) }; Object.assign(host, { jobs: () => jobs });
    const run = vi.fn(async () => undefined); await workflow.launch(folder, task, run);
    await workflow.action({ id: detail.id, folderPath: folder, action: "cancel", taskId: task.id }, signal);
    await spec.run().done;
    expect(run).not.toHaveBeenCalled(); expect((await readState(folder)).tasks[0]?.status).toBe("cancelled");
  });

});
