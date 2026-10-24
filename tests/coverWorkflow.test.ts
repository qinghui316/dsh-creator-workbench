import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { JobHooks, JobRegistry } from "@deepseek-ai/dsh-jobs";
import { CoverWorkflow, selectedCoverPaths } from "../src/covers/workflow.ts";
import { assertRatio, mediaCommand, readCoverState, writeCoverState, ownedDirectory } from "../src/covers/files.ts";
import { readImageSettings, saveImageSettings } from "../src/covers/provider.ts";
import type { CoverPlan, CoverRatio } from "../src/covers/types.ts";

let testVideo: Buffer;
const servers: Server[] = []; const pictures: Partial<Record<CoverRatio, Buffer>> = {};
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "creator-cover-images-"));
  for (const [ratio, size] of [["3x4", "240x320"], ["4x3", "320x240"], ["16x9", "320x180"]] as const) {
    const file = join(dir, `${ratio}.png`); await mediaCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=blue:s=${size}`, "-frames:v", "1", file]); pictures[ratio] = await readFile(file);
  }
  const video = join(dir, "frames.mp4"); await mediaCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]); testVideo = await readFile(video);
}, 30_000);
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "creator-cover-flow-")), folder = join(root, "一期 内容"), dataDir = join(root, "state"); await mkdir(folder);
  await writeFile(join(folder, "video.MP4"), "fixed original video"); const scope = { id: "一期 内容", folderPath: folder };
  const skill = join(root, "skill"); await mkdir(join(skill, "references"), { recursive: true }); await writeFile(join(skill, "references", "cover-rules.md"), "test rules");
  let hooks: JobHooks | undefined; let calls = 0; let hold = false; let failure: CoverRatio | undefined;
  const server = createServer((req, res) => { let body = ""; req.on("data", (b) => body += b); req.on("end", () => {
    calls++; if (hold) return; const size = JSON.parse(body).size; const ratio = size === "960x1280" ? "3x4" : size === "1280x960" ? "4x3" : "16x9";
    if (failure === ratio) { res.writeHead(400); res.end("unsupported size"); }
    else res.end(JSON.stringify({ data: [{ b64_json: pictures[ratio]!.toString("base64") }] }));
  }); }); servers.push(server); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await saveImageSettings(dataDir, { apiBase: `http://127.0.0.1:${(server.address() as { port: number }).port}`, model: "local-fixture-model" });
  const jobs = { start: (spec: { run: () => JobHooks }) => { hooks = spec.run(); return "cover-job-1"; } } as unknown as JobRegistry;
  const host = { dataDir, resolve: async (s: typeof scope) => { if (s.folderPath !== folder) throw new Error("stale folder"); return { folder, selectedVideo: "video.MP4", title: "本期标题", script: "", transcript: "" }; }, key: async () => "fixture-private-key", jobs: () => jobs, changed: () => undefined, skill: () => skill };
  const workflow = new CoverWorkflow(host), signal = new AbortController().signal;
  const create = async (ratios: CoverRatio[] = ["3x4", "4x3", "16x9"]) => (await workflow.action({ ...scope, action: "create", video: "video.MP4", ratios }, signal)).runs.at(-1)!;
  const plan: CoverPlan = { headline: "确定标题", analysis: "用户明确选择文字生图；传输与恢复测试，不是实际 AI 验收。", mode: "text", frameIds: [], prompts: { "3x4": "portrait", "4x3": "landscape", "16x9": "wide" } };
  return { workflow, root, scope, folder, signal, create, plan, calls: () => calls, done: () => hooks!.done, fail: (ratio?: CoverRatio) => { failure = ratio; }, host, hold: (value: boolean) => { hold = value; } };
}
describe("cover assets, jobs and recovery", () => {
  it("imports immutable versions without overwriting sources and persists explicit ratio selection", async () => {
    const f = await fixture(), source = join(f.root, "cover.png"); await writeFile(source, pictures["3x4"]!);
    const one = await f.workflow.action({ ...f.scope, action: "import", ratio: "3x4", sourcePath: source }, f.signal);
    const two = await f.workflow.action({ ...f.scope, action: "import", ratio: "3x4", sourcePath: source }, f.signal);
    expect(two.versions).toHaveLength(2); expect(two.versions[0]!.file).not.toBe(two.versions[1]!.file); expect(two.selected["3x4"]).toBe(one.versions[0]!.id);
    await f.workflow.action({ ...f.scope, action: "select", versionId: two.versions[1]!.id }, f.signal);
    expect((await f.workflow.state(f.scope)).selected["3x4"]).toBe(two.versions[1]!.id);
    expect(await readFile(source)).toEqual(pictures["3x4"]); expect(await readFile(join(f.folder, "video.MP4"), "utf8")).toBe("fixed original video");
    expect((await selectedCoverPaths(f.folder, {}))["3x4"]).toBe(join(f.folder, two.versions[1]!.file));
  });
  it("rejects corrupt and wrong-ratio imports, leaving original files and selection intact", async () => {
    const f = await fixture(), source = join(f.root, "cover.png"); await writeFile(source, pictures["3x4"]!);
    await expect(f.workflow.action({ ...f.scope, action: "import", ratio: "16x9", sourcePath: source }, f.signal)).rejects.toThrow("不符合");
    await writeFile(source, "<html>not an image</html>"); await expect(f.workflow.action({ ...f.scope, action: "import", ratio: "3x4", sourcePath: source }, f.signal)).rejects.toThrow("图片");
    expect((await f.workflow.state(f.scope)).versions).toHaveLength(0);
  });
  it("retains legacy covers without changing their bytes", async () => {
    const f = await fixture(); await writeFile(join(f.folder, "old_3x4.png"), pictures["3x4"]!);
    const state = await f.workflow.state(f.scope); expect(state.versions[0]?.source).toBe("legacy"); expect(state.selected["3x4"]).toBe(state.versions[0]!.id); expect(await readFile(join(f.folder, "old_3x4.png"))).toEqual(pictures["3x4"]);
  });
  it("deduplicates an identical waiting run and rejects changed video snapshots", async () => {
    const f = await fixture(), first = await f.create(), second = await f.create(); expect(second.id).toBe(first.id);
    await writeFile(join(f.folder, "video.MP4"), "changed source");
    await expect(f.workflow.start(f.scope, first.id, f.plan)).rejects.toThrow("变化"); expect(f.calls()).toBe(0);
  });
  it("runs three real HTTP/decoded image outputs with a native Job, and requires visual review before selection", async () => {
    const f = await fixture(), run = await f.create(); const started = await f.workflow.start(f.scope, run.id, f.plan);
    expect(started.jobId).toBe("cover-job-1"); await expect(f.done()).resolves.toMatchObject({ status: "completed" });
    const state = await f.workflow.state(f.scope); expect(state.runs[0]?.status).toBe("completed"); expect(state.versions).toHaveLength(3); expect(f.calls()).toBe(3); expect(state.selected).toEqual({});
    await expect(f.workflow.action({ ...f.scope, action: "select", versionId: state.versions[0]!.id }, f.signal)).rejects.toThrow("质检");
    await f.workflow.action({ ...f.scope, action: "review", versionId: state.versions[0]!.id, verdict: "pass", note: "Actual local fixture was inspected in the test.", select: true }, f.signal);
    expect((await f.workflow.state(f.scope)).selected["3x4"]).toBe(state.versions[0]!.id);
    expect(await readFile(join(f.folder, "video.MP4"), "utf8")).toBe("fixed original video");
    expect(JSON.stringify(await readCoverState(f.folder))).not.toContain("fixture-private-key");
  }, 30_000);
  it("preserves two successful ratios and retries only the failed ratio", async () => {
    const f = await fixture(); f.fail("4x3"); const run = await f.create(); await f.workflow.start(f.scope, run.id, f.plan); await f.done();
    const partial = await f.workflow.state(f.scope); expect(partial.runs[0]?.status).toBe("partial"); const old = partial.versions.map((v) => v.id); expect(old).toHaveLength(2);
    f.fail(); await f.workflow.action({ ...f.scope, action: "retry", runId: run.id, ratios: ["4x3"] }, f.signal); await f.done();
    const done = await f.workflow.state(f.scope); expect(done.versions.map((v) => v.id)).toEqual(expect.arrayContaining(old)); expect(done.versions).toHaveLength(3); expect(f.calls()).toBe(4);
  }, 30_000);
  it("reopening flags interrupted requests without making another POST; unknown retries require acknowledgment", async () => {
    const f = await fixture(), run = await f.create(["3x4"]); const state = await readCoverState(f.folder);
    state.runs[0]!.provider = await readImageSettings(f.host.dataDir); state.runs[0]!.mode = "text";
    state.runs[0]!.status = "running"; state.runs[0]!.slots["3x4"] = { status: "running", versionId: randomUUID(), prompt: "prompt" }; await writeCoverState(f.folder, state);
    const recovered = await f.workflow.state(f.scope); expect(recovered.runs[0]?.status).toBe("unconfirmed"); expect(f.calls()).toBe(0);
    await expect(f.workflow.start(f.scope, run.id, undefined, ["3x4"])).rejects.toThrow("结果未确认"); expect(f.calls()).toBe(0);
  });
  it("reconciles a fully written output after an interrupted index update, without regenerating it", async () => {
    const f = await fixture(), run = await f.create(["3x4"]), state = await readCoverState(f.folder), versionId = randomUUID();
    const dir = await ownedDirectory(f.folder, "versions", versionId); await writeFile(join(dir, "cover.png"), pictures["3x4"]!);
    state.runs[0]!.status = "running"; state.runs[0]!.slots["3x4"] = { status: "running", versionId, prompt: "original prompt" }; await writeCoverState(f.folder, state);
    const recovered = await f.workflow.state(f.scope); expect(recovered.versions[0]?.id).toBe(versionId); expect(recovered.versions[0]?.review).toBe("pending"); expect(recovered.runs[0]?.status).toBe("completed"); expect(f.calls()).toBe(0);
  });
  it("rejects invalid ratios, stale scope and non-owned frame ids before sending requests", async () => {
    const f = await fixture(), run = await f.create(["3x4"]);
    await expect(f.workflow.state({ ...f.scope, folderPath: "another" })).rejects.toThrow("stale");
    await expect(f.workflow.start(f.scope, run.id, { ...f.plan, mode: "reference", frameIds: ["outside"] })).rejects.toThrow("不属于");
    expect(() => assertRatio(320, 180, "3x4")).toThrow("不符合"); expect(f.calls()).toBe(0);
  });
  it("prepares at most eight real JPEG attachments from the bound video without calling the image service", async () => {
    const f = await fixture(); await writeFile(join(f.folder, "video.MP4"), testVideo); const run = await f.create();
    const result = await f.workflow.prepare(f.scope, run.id, f.signal);
    expect(result.images).toHaveLength(8); expect(result.run.frames[0]?.at).toBe(0); expect(result.images.every((image) => image.data[0] === 255 && image.data[1] === 216)).toBe(true); expect(f.calls()).toBe(0);
    const reused = await f.workflow.prepare(f.scope, run.id, f.signal); expect(reused.images.map((i) => i.data)).toEqual(result.images.map((i) => i.data));
    expect(await readFile(join(f.folder, "video.MP4"))).toEqual(testVideo);
  }, 30_000);
  it("deduplicates a running request and cancellation preserves existing covers, with an unknown remote outcome", async () => {
    const f = await fixture(); f.hold(true); const run = await f.create(); await f.workflow.start(f.scope, run.id, f.plan);
    await vi.waitFor(() => expect(f.calls()).toBe(1)); const repeated = await f.workflow.start(f.scope, run.id, f.plan); expect(repeated.jobId).toBe("cover-job-1"); expect(f.calls()).toBe(1);
    await f.workflow.action({ ...f.scope, action: "cancel", runId: run.id }, f.signal); await f.done();
    const state = await f.workflow.state(f.scope); expect(state.runs[0]?.slots["3x4"]?.status).toBe("unconfirmed"); expect(state.runs[0]?.slots["4x3"]?.status).toBe("cancelled"); expect(f.calls()).toBe(1); expect(await readFile(join(f.folder, "video.MP4"), "utf8")).toBe("fixed original video");
  });
  it("cannot replace a running job controller while preparing an older record", async () => {
    const f = await fixture(); await writeFile(join(f.folder, "video.MP4"), testVideo);
    const run = await f.create(), controller = new AbortController();
    f.workflow.active.set(f.folder, { runId: "another-running-job", controller });
    await expect(f.workflow.prepare(f.scope, run.id, f.signal)).rejects.toThrow("已有封面任务");
    expect(f.workflow.active.get(f.folder)?.controller).toBe(controller);
    expect(controller.signal.aborted).toBe(false);
    expect((await readCoverState(f.folder)).runs[0]?.frames).toEqual([]);
  });
  it("does not select outside-folder metadata or hide index corruption from the cover panel", async () => {
    const f = await fixture(); const state = await f.workflow.state(f.scope); state.versions.push({ id: "forged", ratio: "3x4", file: "../outside.png", mime: "image/png", width: 240, height: 320, source: "import", createdAt: 1, review: "pass" }); await writeFile(join(f.root, "outside.png"), pictures["3x4"]!); await writeCoverState(f.folder, state);
    await expect(f.workflow.image(f.scope, "forged")).rejects.toThrow("超出");
    await writeFile(join(f.folder, ".dsh-creator-workbench", "covers", "index.json"), "invalid JSON");
    await expect(f.workflow.state(f.scope)).rejects.toThrow("无法读取"); expect(await selectedCoverPaths(f.folder, {})).toEqual({});
  });
  it("invalidates a retry when image configuration changes", async () => {
    const f = await fixture(); f.fail("3x4"); const run = await f.create(["3x4"]); await f.workflow.start(f.scope, run.id, f.plan); await f.done(); const calls = f.calls();
    const settings = await readImageSettings(f.host.dataDir); await saveImageSettings(f.host.dataDir, settings);
    await expect(f.workflow.action({ ...f.scope, action: "retry", runId: run.id, ratios: ["3x4"] }, f.signal)).rejects.toThrow("设置已变化"); expect(f.calls()).toBe(calls);
  });

  it("an explicit service test makes one image request and records only the tested capability", async () => {
    const f = await fixture(); const state = await f.workflow.action({ ...f.scope, action: "test", video: "video.MP4" }, f.signal); await f.done();
    expect(state.runs.at(-1)?.purpose).toBe("service_test"); expect(f.calls()).toBe(1);
    const settings = await readImageSettings(f.host.dataDir); expect(settings.checked?.generation).toContain("已验证"); expect(settings.checked?.edit).toBe("未验证");
    const finished = await f.workflow.state(f.scope); expect(finished.selected).toEqual({}); expect(finished.versions[0]?.review).toBe("pending");
  });

  it("removes selected legacy covers without deleting files or allowing scan and late review to select them again", async () => {
    const f = await fixture(), file = join(f.folder, "old_3x4.png"); await writeFile(file, pictures["3x4"]!);
    const initial = await f.workflow.state(f.scope), legacy = initial.versions[0]!;
    const run = await f.create(["3x4"]);
    await f.workflow.action({ ...f.scope, action: "remove", versionId: legacy.id }, f.signal);
    expect((await f.workflow.state(f.scope)).selected["3x4"]).toBeNull();
    expect((await selectedCoverPaths(f.folder, { "3x4": file }))["3x4"]).toBeUndefined();
    await f.workflow.start(f.scope, run.id, f.plan); await f.done();
    const generated = (await f.workflow.state(f.scope)).versions.find((v) => v.runId === run.id)!;
    await f.workflow.action({ ...f.scope, action: "review", versionId: generated.id, verdict: "pass", note: "checked", select: true }, f.signal);
    const reopened = new CoverWorkflow(f.host);
    expect((await reopened.state(f.scope)).selected["3x4"]).toBeNull();
    expect(await readFile(file)).toEqual(pictures["3x4"]!);
    await expect(f.workflow.action({ ...f.scope, action: "select", versionId: legacy.id }, f.signal)).rejects.toThrow("已移除");
    await reopened.action({ ...f.scope, action: "select", versionId: generated.id }, f.signal);
    expect((await reopened.state(f.scope)).selected["3x4"]).toBe(generated.id);
  }, 30_000);
  it("rolls back only a newly owned unstarted request, preserving a reused or delivered request", async () => {
    const f = await fixture(), token = crypto.randomUUID();
    const created = await f.workflow.action({ ...f.scope, action: "create", video: "video.MP4", ratios: ["3x4"], requestToken: token }, f.signal), run = created.runs.at(-1)!;
    await f.workflow.action({ ...f.scope, action: "discard-request", runId: run.id, requestToken: crypto.randomUUID() }, f.signal);
    expect((await f.workflow.state(f.scope)).runs.at(-1)?.status).toBe("waiting_agent");
    await f.workflow.action({ ...f.scope, action: "delivered", runId: run.id, sessionId: "original" }, f.signal);
    await f.workflow.action({ ...f.scope, action: "discard-request", runId: run.id, requestToken: token }, f.signal);
    expect((await f.workflow.state(f.scope)).runs.at(-1)?.status).toBe("waiting_agent");
    await f.workflow.action({ ...f.scope, action: "cancel", runId: run.id }, f.signal);
    const next = (await f.workflow.action({ ...f.scope, action: "create", video: "video.MP4", ratios: ["3x4"], requestToken: token }, f.signal)).runs.at(-1)!;
    await f.workflow.action({ ...f.scope, action: "discard-request", runId: next.id, requestToken: token }, f.signal);
    expect((await f.workflow.state(f.scope)).runs.at(-1)?.status).toBe("cancelled");
  });

});
