import { randomUUID, createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { JobRegistry, JobOutcome, JobSpec } from "@deepseek-ai/dsh-jobs";
import { videoFile } from "../videoFiles.ts";
import { coverRunStatus, COVER_RATIOS, type CoverAction, type CoverPlan, type CoverRatio, type CoverRun, type CoverScope, type CoverState, type CoverVersion } from "./types.ts";
import { assertRatio, boundedFile, coverLock, inspectImage, mediaCommand, ownedDirectory, readCoverState, saveVersionBytes, validId, writeCoverState } from "./files.ts";
import { ImageRequestError, readImageSettings, recordImageSuccess, requestImage, safeImageError } from "./provider.ts";

interface CoverHost {
  dataDir: string;
  resolve: (scope: CoverScope) => Promise<{ folder: string; selectedVideo?: string; title: string; script: string; transcript: string }>;
  key: () => Promise<string | undefined>;
  jobs: () => JobRegistry | undefined;
  changed: () => void;
  skill: () => string;
}
export async function selectedCoverPaths(folder: string, fallback: Partial<Record<CoverRatio, string>>): Promise<Partial<Record<CoverRatio, string>>> {
  const state = await readCoverState(folder).catch(() => undefined), result = { ...fallback };
  if (!state) return {}; // Keep a corrupt cover index from blocking video management; the cover panel surfaces the error.
  for (const ratio of COVER_RATIOS) {
    const id = state.selected[ratio];
    if (id !== undefined) {
      const version = state.versions.find((v) => v.id === id && v.ratio === ratio && !v.hidden);
      delete result[ratio];
      if (version) { const file = await boundedFile(folder, version.file).catch(() => undefined); if (file) result[ratio] = file; }
    }
  }
  return result;
}
export class CoverWorkflow {
  readonly active = new Map<string, { runId: string; controller: AbortController }>();
  constructor(readonly host: CoverHost) {}
  dispose(): void { for (const task of this.active.values()) task.controller.abort(); }
  async load(folder: string): Promise<CoverState> {
    const state = await readCoverState(folder);
    // The record travels with its episode when an idle folder is renamed.
    for (const run of state.runs) { run.contentId = basename(folder); run.folderPath = folder; }
    const names = await readdir(folder);
    for (const name of names) {
      const ratio = COVER_RATIOS.find((r) => name.endsWith(`_${r}.png`));
      if (!ratio || state.versions.some((v) => v.file === name)) continue;
      const info = await lstat(join(folder, name)); if (!info.isFile() || info.isSymbolicLink()) continue;
      const id = `legacy-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
      state.versions.push({ id, ratio, file: name, mime: "image/png", width: 0, height: 0, source: "legacy", createdAt: info.mtimeMs, review: "pass" });
      if (state.selected[ratio] === undefined) state.selected[ratio] = id;
    }
    return state;
  }
  async state(scope: CoverScope): Promise<CoverState> {
    const { folder } = await this.host.resolve(scope);
    return coverLock(folder, async () => {
      const state = await this.load(folder); let changed = false;
      for (const run of state.runs) {
        if (this.active.get(folder)?.runId === run.id) continue;
        if (run.status === "preparing") { run.status = "failed"; run.error = "准备画面时中断，请重新准备。"; changed = true; }
        for (const [ratio, slot] of Object.entries(run.slots)) {
          if (slot.status !== "running" && slot.status !== "pending") continue;
          const dir = join(folder, ".dsh-creator-workbench", "covers", "versions", slot.versionId);
          const files = await readdir(dir).catch(() => []);
          const file = files.find((f) => /^cover\.(png|jpg|webp)$/.test(f));
          if (file) {
            try {
              const path = await boundedFile(folder, relative(folder, join(dir, file))), image = await inspectImage(path);
              assertRatio(image.width, image.height, ratio);
              if (!state.versions.some((v) => v.id === slot.versionId)) state.versions.push({ id: slot.versionId, ratio: ratio as CoverRatio, file: relative(folder, path), ...image, source: "generated", createdAt: Date.now(), video: run.video.name, runId: run.id, review: "pending" });
              slot.status = "completed";
            } catch { slot.status = "unconfirmed"; slot.error = "已发现图片文件但无法核验，请检查已有成果。"; }
          } else { slot.status = slot.status === "running" ? "unconfirmed" : "cancelled"; slot.error = "任务中断；服务端结果需核对，未自动重发。"; }
          changed = true;
        }
        if (Object.keys(run.slots).length) run.status = coverRunStatus(run.slots);
      }
      if (changed) { await writeCoverState(folder, state); this.host.changed(); }
      return state;
    });
  }
  async action(request: CoverAction, signal: AbortSignal): Promise<CoverState> {
    const context = await this.host.resolve(request), { folder } = context; signal.throwIfAborted();
    if (request.action === "retry") {
      await this.state(request);
      await this.start(request, request.runId, undefined, request.ratios, request.acknowledgeUnknown === true); return this.state(request);
    }
    if (request.action === "cancel") {
      const active = this.active.get(folder); if (active?.runId === request.runId) active.controller.abort();
      return coverLock(folder, async () => {
        const state = await this.load(folder), run = state.runs.find((r) => r.id === request.runId);
        if (run && !active) { run.status = "cancelled"; run.updatedAt = Date.now(); await writeCoverState(folder, state); }
        return state;
      });
    }
    const result = await coverLock(folder, async () => {
      const state = await this.load(folder);
      await this.host.resolve(request); // Recheck removal after waiting for the file lock.
      if (request.action === "delivered" || request.action === "discard-request") {
        const run = state.runs.find((r) => r.id === request.runId);
        if (!run || run.status === "cancelled") return state;
        if (request.action === "delivered") { run.deliveredAt = Date.now(); run.sessionId = request.sessionId; }
        else if (run.requestToken === request.requestToken && !run.deliveredAt && !run.frames.length && !Object.keys(run.slots).length && run.status === "waiting_agent") run.status = "cancelled";
        await writeCoverState(folder, state); this.host.changed(); return state;
      }
      if (request.action === "create" || request.action === "test") {
        if (context.selectedVideo !== request.video) throw new Error("当前视频已切换，请重新发起制作。");
        const path = await videoFile(folder, request.video), info = await lstat(path);
        const ratios: CoverRatio[] = request.action === "test" ? ["3x4"] : COVER_RATIOS.filter((ratio) => request.ratios.includes(ratio));
        const purpose = request.action === "test" ? "service_test" : "cover"; if (!ratios.length) throw new Error("请至少选择一种画幅。");
        const existing = [...state.runs].reverse().find((r) => ["waiting_agent", "preparing", "running"].includes(r.status) && (r.purpose ?? "cover") === purpose);
        if (existing && existing.video.name === request.video && existing.video.size === info.size && existing.video.modifiedAt === info.mtimeMs && ratios.join() === COVER_RATIOS.filter((ratio) => existing.ratios.includes(ratio)).join()) return state;
        if (this.active.has(folder)) throw new Error("这一期已有封面任务，请等待或取消后再制作。");
        if (existing) existing.status = "cancelled";
        const now = Date.now();
        state.runs.push({ purpose, ...(request.action === "create" && request.requestToken ? { requestToken: request.requestToken } : {}), selectionRevision: state.selectionRevision ?? 0, id: randomUUID(), contentId: request.id, folderPath: folder, video: { name: request.video, size: info.size, modifiedAt: info.mtimeMs }, ratios, createdAt: now, updatedAt: now, status: "waiting_agent", frames: [], slots: {} });
      } else if (request.action === "import") {
        const info = await inspectImage(request.sourcePath, signal);
        const version = await saveVersionBytes(folder, { id: randomUUID(), ratio: request.ratio, source: "import", createdAt: Date.now(), review: "pass", ...(context.selectedVideo ? { video: context.selectedVideo } : {}) }, await readFile(request.sourcePath), signal);
        if (info.width !== version.width || info.height !== version.height) throw new Error("导入期间图片发生变化，请重新导入。");
        state.versions.push(version); if (state.selected[request.ratio] === undefined) { state.selected[request.ratio] = version.id; state.selectionRevision = (state.selectionRevision ?? 0) + 1; }
      } else {
        const version = state.versions.find((v) => v.id === request.versionId);
        if (!version) throw new Error("封面版本已找不到。");
        if (request.action === "remove") {
          version.hidden = true;
          if (state.selected[version.ratio] === version.id) state.selected[version.ratio] = null;
          state.selectionRevision = (state.selectionRevision ?? 0) + 1;
          await writeCoverState(folder, state); this.host.changed(); return state;
        }
        if (version.hidden) throw new Error("此封面已移除，请重新导入后使用。");
        await boundedFile(folder, version.file);
        if (request.action === "review") { version.review = request.verdict; version.reviewNote = request.note; }
        if (request.action === "select" || (request.action === "review" && request.select)) {
          if (version.review !== "pass") throw new Error("请先完成这个版本的图片质检，再选为当前封面。");
          const image = await inspectImage(await boundedFile(folder, version.file), signal); assertRatio(image.width, image.height, version.ratio);
          Object.assign(version, image);
          const run = state.runs.find((r) => r.id === version.runId);
          const source = run ? await videoFile(folder, run.video.name).then((file) => lstat(file)).catch(() => undefined) : undefined;
          const canAutoSelect = run && source?.size === run.video.size && source?.mtimeMs === run.video.modifiedAt && (run.selectionRevision ?? 0) === (state.selectionRevision ?? 0) && context.selectedVideo === run.video.name;
          if (request.action === "select" || canAutoSelect) {
            state.selected[version.ratio] = version.id;
            if (request.action === "select") state.selectionRevision = (state.selectionRevision ?? 0) + 1;
          }
        }
      }
      await writeCoverState(folder, state); this.host.changed(); return state;
    });
    if (request.action === "test") {
      const run = [...result.runs].reverse().find((r) => r.purpose === "service_test" && r.video.name === request.video)!;
      await this.start(request, run.id, { headline: "生图服务测试", analysis: "用户点击测试生图，明确请求一张文字生图测试图片；无需视频分析。", frameIds: [], mode: "text", prompts: { "3x4": "Create a clean blue and cream abstract cover with the exact title IMAGE SERVICE TEST, no people. Exact 3:4 portrait." } });
      return this.state(request);
    }
    return result;
  }
  async image(scope: CoverScope, versionId: string): Promise<{ mime: string; base64: string }> {
    const { folder } = await this.host.resolve(scope), state = await this.load(folder), version = state.versions.find((v) => v.id === versionId);
    if (!version) throw new Error("封面版本不存在。");
    const file = await boundedFile(folder, version.file), image = await inspectImage(file);
    return { mime: image.mime, base64: (await readFile(file)).toString("base64") };
  }
  async snapshot(folder: string, run: CoverRun): Promise<string> {
    const path = await videoFile(folder, run.video.name), info = await lstat(path);
    if (info.size !== run.video.size || info.mtimeMs !== run.video.modifiedAt) throw new Error("视频内容已变化，请重新准备封面。");
    return path;
  }
  async prepare(scope: CoverScope, runId: string, signal: AbortSignal): Promise<{ run: CoverRun; images: Array<{ data: Buffer; name: string }>; context: string; rules: string; flow: string }> {
    if (!validId(runId)) throw new Error("无效的制作记录。");
    const context = await this.host.resolve(scope), { folder } = context;
    return coverLock(folder, async () => {
      await this.host.resolve(scope);
      const state = await this.load(folder), run = state.runs.find((r) => r.id === runId);
      if (!run || run.status === "cancelled") throw new Error("制作记录不存在或已取消。");
      const video = await this.snapshot(folder, run), dir = await ownedDirectory(folder, "runs", runId);
      const rules = join(this.host.skill(), "references/cover-rules.md"), flow = join(this.host.skill(), "references/agent-native-flow.md");
      await readFile(rules, "utf8").catch(() => { throw new Error("未发现 oil-cover 视觉规则，请先安装或配置该 Skill。"); });
      if (!run.frames.length) {
        if (this.active.has(folder)) throw new Error("这一期已有封面任务，请等待或取消后再准备画面。");
        const preparation = new AbortController();
        const preparationSignal = AbortSignal.any([signal, preparation.signal]);
        this.active.set(folder, { runId, controller: preparation });
        run.status = "preparing"; await writeCoverState(folder, state);
        try {
          const duration = Number((await mediaCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", video], preparationSignal)).trim());
          if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长。");
          for (let i = 0; i < 8; i++) {
            preparationSignal.throwIfAborted(); const at = Math.max(0, duration * i / 8), file = join(dir, `frame-${i}.jpg`);
            await mediaCommand("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", "scale=min(1280\\,iw):-2", file], preparationSignal);
            run.frames.push({ id: String(i), at, file: relative(folder, file) });
          }
          await this.snapshot(folder, run); run.status = "waiting_agent"; run.updatedAt = Date.now(); await writeCoverState(folder, state);
        } catch (error) { run.status = preparationSignal.aborted ? "cancelled" : "failed"; run.error = "抽取画面失败或已取消，请检查视频和 ffmpeg 后重新准备。"; run.frames = []; await writeCoverState(folder, state); throw new Error(run.error); }
        finally { this.active.delete(folder); }
      }
      return { run, images: await Promise.all(run.frames.map(async (f) => ({ name: `frame-${f.id} @ ${f.at.toFixed(2)}s`, data: await readFile(await boundedFile(folder, f.file)) }))), context: `标题：${context.title}\n文稿：${context.script}\n字幕：${context.transcript}`, rules, flow };
    });
  }
  async start(scope: CoverScope, runId: string, plan?: CoverPlan, retryRatios?: CoverRatio[], acknowledgeUnknown = false, owner?: string): Promise<CoverRun> {
    const { folder } = await this.host.resolve(scope), jobs = this.host.jobs();
    if (!jobs) throw new Error("Harness 后台任务服务尚未就绪。");
    return coverLock(folder, async () => {
      await this.host.resolve(scope);
      const state = await this.load(folder), run = state.runs.find((r) => r.id === runId);
      if (!run) throw new Error("制作记录已找不到。");
      if (this.active.has(folder)) {
        if (this.active.get(folder)?.runId === runId) return run;
        throw new Error("这一期已有其他封面任务。");
      }
      await this.snapshot(folder, run);
      const settings = await readImageSettings(this.host.dataDir), key = await this.host.key();
      const latestSettings = await readImageSettings(this.host.dataDir);
      if (settings.pending || latestSettings.pending || settings.revision !== latestSettings.revision) throw new Error("生图设置更新未完成或已变化，请先保存。");
      if (!settings.apiBase || !settings.model || !key) throw new Error("请在数据与设置中配置生图服务地址、模型和 API Key。");
      if (plan) {
        if (run.status === "cancelled") throw new Error("该制作记录已取消，请重新发起。");
        if (!plan.headline.trim() || !plan.analysis.trim()) throw new Error("请先保存标题、选帧分析和逐画幅提示词。");
        if (plan.frameIds.some((id) => !run.frames.some((f) => f.id === id))) throw new Error("参考画面不属于本次制作记录。");
        if (plan.mode === "reference" && !plan.frameIds.length) throw new Error("请选择真实视频画面。");
        run.headline = plan.headline; run.analysis = plan.analysis; run.frameIds = plan.frameIds; run.mode = plan.mode;
        run.provider = { apiBase: settings.apiBase, model: settings.model, revision: settings.revision };
      } else if (run.provider?.revision !== settings.revision) throw new Error("生图设置已变化，请重新发起制作，避免混用服务。");
      const ratios = retryRatios ?? run.ratios;
      for (const ratio of ratios) {
        if (!run.ratios.includes(ratio)) throw new Error("画幅不属于本次制作任务。");
        const old = run.slots[ratio];
        if (old?.status === "completed") continue;
        if (old?.status === "unconfirmed" && !acknowledgeUnknown) throw new Error("上次服务端结果未确认；核对后勾选确认再重试，可能产生新的费用。");
        const prompt = plan?.prompts[ratio] ?? old?.prompt;
        if (!prompt?.trim()) throw new Error(`${ratio} 缺少完整提示词。`);
        run.slots[ratio] = { status: "pending", versionId: randomUUID(), prompt };
      }
      if (!ratios.some((r) => run.slots[r]?.status === "pending")) return run;
      const dir = await ownedDirectory(folder, "runs", run.id);
      await writeFile(join(dir, "analysis.md"), run.analysis ?? "", "utf8");
      await writeFile(join(dir, "cover_plan.md"), `# ${run.headline}\n\n${ratios.join(", ")}\n\n${run.analysis}`, "utf8");
      for (const ratio of ratios) await writeFile(join(dir, `cover_${ratio}.prompt.md`), run.slots[ratio]?.prompt ?? "", "utf8");
      run.status = "running"; run.updatedAt = Date.now(); await writeCoverState(folder, state);
      const controller = new AbortController(); this.active.set(folder, { runId, controller });
      try {
        run.jobId = jobs.start({ kind: "creator-media", label: `制作封面：${run.headline}`, ...(owner ? { owner: owner as NonNullable<JobSpec["owner"]> } : {}), run: () => ({ cancel: () => controller.abort(), done: this.execute(folder, runId, settings, key, controller.signal) }) });
        await writeCoverState(folder, state);
      } catch (error) {
        this.active.delete(folder); run.status = "failed"; run.error = safeImageError(error, key);
        for (const slot of Object.values(run.slots)) if (slot.status === "pending") slot.status = "failed";
        await writeCoverState(folder, state); throw new Error(run.error);
      }
      this.host.changed(); return run;
    });
  }
  async execute(folder: string, runId: string, settings: Awaited<ReturnType<typeof readImageSettings>>, key: string, signal: AbortSignal): Promise<JobOutcome> {
    try {
      const initial = await coverLock(folder, () => readCoverState(folder)), run = initial.runs.find((r) => r.id === runId)!;
      const references = await Promise.all((run.frameIds ?? []).map(async (id) => {
        const frame = run.frames.find((f) => f.id === id)!;
        return { name: basename(frame.file), data: await readFile(await boundedFile(folder, frame.file)) };
      }));
      for (const ratio of run.ratios) {
        const slot = (await coverLock(folder, () => readCoverState(folder))).runs.find((r) => r.id === runId)!.slots[ratio];
        if (slot?.status !== "pending") continue;
        if (signal.aborted) { await this.update(folder, runId, (r) => { r.slots[ratio]!.status = "cancelled"; }); continue; }
        await this.snapshot(folder, run);
        await this.update(folder, runId, (r) => { r.slots[ratio]!.status = "running"; });
        try {
          const bytes = await requestImage(settings, key, { ratio, prompt: slot.prompt, mode: run.mode ?? "reference", references }, signal);
          const version = await saveVersionBytes(folder, { id: slot.versionId, ratio, source: "generated", createdAt: Date.now(), runId, video: run.video.name, review: "pending" }, bytes);
          await this.update(folder, runId, (r, state) => { state.versions.push(version); r.slots[ratio]!.status = "completed"; });
          await recordImageSuccess(this.host.dataDir, settings, run.mode ?? "reference", ratio).catch(() => undefined);
        } catch (error) {
          await this.update(folder, runId, (r) => { const s = r.slots[ratio]!; s.status = error instanceof ImageRequestError && error.uncertain ? "unconfirmed" : "failed"; s.error = safeImageError(error, key); });
        }
      }
      const state = await this.update(folder, runId, (r) => { r.status = coverRunStatus(r.slots); });
      const result = state.runs.find((r) => r.id === runId)!;
      return { status: result.status === "completed" ? "completed" : signal.aborted ? "killed" : "failed", result: `封面任务 ${runId}: ${result.status}；请检查各画幅并完成视觉质检。` };
    } catch (error) {
      await this.update(folder, runId, (r) => { r.status = "unconfirmed"; r.error = safeImageError(error, key); });
      return { status: "failed", result: safeImageError(error, key) };
    } finally { this.active.delete(folder); this.host.changed(); }
  }
  async update(folder: string, runId: string, mutate: (run: CoverRun, state: CoverState) => void): Promise<CoverState> {
    return coverLock(folder, async () => {
      const state = await this.load(folder), run = state.runs.find((r) => r.id === runId); if (!run) throw new Error("制作记录缺失。");
      mutate(run, state); run.updatedAt = Date.now(); await writeCoverState(folder, state); this.host.changed(); return state;
    });
  }
}
