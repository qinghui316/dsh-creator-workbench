import { articleSource, saveArticleRevision } from "./articleEditing.ts";
import type { ArticleSave } from "../projectView.ts";
import { preparePublicationUpload, executePublicationUpload } from "./publicationUpload.ts";
import { creationAction } from "./creationActions.ts";
import { creationImage, hydrateCreations, readCreationSource } from "./creations.ts";
import { reconcileImageItems } from "./imageTasks.ts";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { JobOutcome, JobRegistry, JobSpec } from "@deepseek-ai/dsh-jobs";
import type { ContentDetail, PublishPlatform } from "../types.ts";
import { runCollectPublish, collectScriptPath } from "../collectEgo.ts";
import { titleScore } from "../collectPublish.ts";
import { ASR_CREDENTIAL, PRODUCTION_PLATFORMS, isActiveTask, sameMedia, type ContentScope, type CreationSource, type ProductionAction, type ProductionSettingsAction, type ProductionSettingsView, type ProductionState, type ProductionTask, type TranscriptVersion } from "./types.ts";
import { locked, atomic, hashFile, hashText, inside, mediaIdentity, owned, readSettings, readState, updateSettings, updateState, wechatCredential } from "./storage.ts";
import { browserExecutable, prepareRuntime, resource, runtimeStatus } from "./runtime.ts";
import { pauseBrowser, probeAccount, requireAccount, withBrowser, browserControlStopped } from "./browser.ts";
import { AsrError, importSubtitle, parseSrt, transcribe } from "./transcription.ts";
import { sameMediaIdentityError } from "./videoIdentity.ts";
import { makeUploadPackage, runUpload, releaseUploadBrowser } from "./publishing.ts";
import { prepareArticleFrames, saveArticle } from "./articles.ts";
import { WechatError, submitWechat, wechatWorker } from "./wechat.ts";
import { formatArticle } from "./articlePreview.ts";
import { admitUpload, uploadKey } from "./uploadAdmission.ts";
import { safeError } from "./process.ts";
import { metricsSnapshot, runMetricsTask } from "./metricsTask.ts";
import { refreshMetric, validatePublication } from "./metrics.ts";

export interface ProductionHost {
  dataDir: string; resolve: (scope: ContentScope) => Promise<ContentDetail>;
  key: (ref: string) => Promise<string | undefined>; hasKey: (ref: string) => Promise<boolean>;
  setKey: (ref: string, value: string) => Promise<void>;
  platforms: () => Promise<readonly PublishPlatform[]>;
  jobs: () => JobRegistry | undefined; changed: () => void;
  published?: (scope: ContentScope, record: import("./types.ts").MetricRecord) => Promise<void>;
}
export class ProductionWorkflow {
  readonly active = new Map<string, { folder: string; controller: AbortController; executing?: boolean }>();
  readonly pending = new Set<string>();
  private disposed = false;
  constructor(readonly host: ProductionHost) {}
  dispose(): void { this.disposed = true; for (const task of this.active.values()) task.controller.abort(); pauseBrowser(this.host.dataDir); }
  async readArticleVersion(scope: ContentScope & {articleId: string}) {
    const detail = await this.host.resolve(scope); return articleSource(detail.folderPath, scope.articleId, detail.articlePath);
  }
  async editArticleVersion(request: ArticleSave, signal: AbortSignal) {
    const detail = await this.host.resolve(request), settings = await readSettings(this.host.dataDir);
    const result = await saveArticleRevision(this.host.dataDir, detail.folderPath, request, settings.wechat.theme, signal, () => this.host.resolve(request), detail.articlePath);
    this.host.changed(); return result;
  }
  async settings(): Promise<ProductionSettingsView> {
    const settings = await readSettings(this.host.dataDir), ref = wechatCredential(settings.wechat.appid);
    return { ...settings, runtime: await runtimeStatus(this.host.dataDir), asrConfigured: await this.host.hasKey(ASR_CREDENTIAL), wechatConfigured: Boolean(settings.wechat.appid) && await this.host.hasKey(ref), wechatCredential: ref };
  }
  async settingsAction(request: ProductionSettingsAction, signal: AbortSignal): Promise<ProductionSettingsView> {
    const dataDir = this.host.dataDir; signal.throwIfAborted();
    if (request.action === "prepare-runtime") await prepareRuntime(dataDir, signal);
    else if (request.action === "pause-browser" || request.action === "resume-browser") {
      const paused = request.action === "pause-browser"; if (paused) pauseBrowser(dataDir);
      await updateSettings(dataDir, (settings) => { settings.browserPaused = paused; });
    } else if (request.action === "open-login" || request.action === "check-account" || request.action === "connect-account") {
      await withBrowser(dataDir, signal, async (current) => {
        const settings = await readSettings(dataDir);
        // Only explicit account checking resumes a space handed to the user.
        const resume = request.action === "check-account" ? settings.observations[request.platform]?.spaceId : undefined;
        const observed = await probeAccount(request.platform, current, request.action === "open-login", resume);
        await updateSettings(dataDir, (settings) => {
          settings.observations[request.platform] = observed;
          if (request.action !== "connect-account") return;
          if (observed.state !== "connected" || !observed.id || !observed.name || request.expectedId !== observed.id) throw new Error("账号已变化或尚未核验，请重新检查账号。");
          const previous = settings.accounts[request.platform];
          if (previous && previous.id !== observed.id && !request.replace) throw new Error("请明确确认更换账号；原账号历史会保留。");
          if (previous && !settings.accountHistory.some((account) => account.platform === previous.platform && account.id === previous.id)) settings.accountHistory.push(previous);
          settings.accounts[request.platform] = { platform: request.platform, id: observed.id, name: observed.name, checkedAt: observed.checkedAt };
        });
      });
    } else if (request.action === "save-wechat") {
      if (!/^wx[a-zA-Z0-9]{8,40}$/.test(request.appid) || !["claude-editorial", "professional-clean"].includes(request.theme)) throw new Error("请填写有效的公众号 AppID，并选择可用主题。");
      if (!await this.host.hasKey(wechatCredential(request.appid))) throw new Error("请先保存此公众号的 AppSecret。");
      await updateSettings(dataDir, (settings) => {
        if (settings.revision !== request.revision) throw new Error("设置已被更新，请重新加载后保存。");
        settings.wechat = { appid: request.appid, author: request.author.trim(), theme: request.theme };
      });
    } else if (request.action === "check-wechat") {
      const settings = await readSettings(dataDir), secret = await this.host.key(wechatCredential(settings.wechat.appid));
      if (!secret) throw new Error("请先配置公众号 AppID 和 AppSecret。");
      try { await wechatWorker(dataDir, { operation: "check", ...settings.wechat, secret }, signal); await updateSettings(dataDir, (latest) => { if (latest.wechat.appid === settings.wechat.appid) { latest.wechat.checkedAt = Date.now(); delete latest.wechat.error; } }); }
      catch (error) { const message = safeError(error, [secret]); await updateSettings(dataDir, (latest) => { if (latest.wechat.appid === settings.wechat.appid) latest.wechat.error = message; }); throw new Error(message); }
    } else if (request.action === "import-wechat") {
      const config = await wechatWorker<{ appid: string; secret: string; author: string }>(dataDir, { operation: "import-config", path: request.sourcePath }, signal);
      if (!/^wx[a-zA-Z0-9]{8,40}$/.test(config.appid) || !config.secret) throw new Error("所选文件缺少有效的公众号配置。");
      await this.host.setKey(wechatCredential(config.appid), config.secret);
      await updateSettings(dataDir, (settings) => { settings.wechat = { appid: config.appid, author: config.author, theme: "claude-editorial" }; });
    }
    this.host.changed(); return this.settings();
  }
  async reconcile(scope: ContentScope): Promise<ProductionState> {
    const detail = await this.host.resolve(scope);
    const existing = await readState(detail.folderPath);
    for (const task of existing.tasks) if (task.kind === "images" && ["running", "unconfirmed"].includes(task.status) && !this.active.has(task.id) && !this.pending.has(task.id)) await reconcileImageItems(detail.folderPath, task);
    if (!existing.tasks.some((task) => ["running", "queued"].includes(task.status) && !this.active.has(task.id) && !this.pending.has(task.id))) return readState(detail.folderPath);
    const reconciled = await updateState(detail.folderPath, async (state) => {
      await this.host.resolve({ id: detail.id, folderPath: detail.folderPath });
      for (const task of state.tasks) if (["running", "queued"].includes(task.status) && !this.active.has(task.id) && !this.pending.has(task.id)) {
        task.status = "unconfirmed"; task.error = "任务运行时中断，请先核对已有成果，再继续处理。"; task.updatedAt = Date.now();
      }
      return structuredClone(state);
    });
    return reconciled;
  }
  async state(scope: ContentScope): Promise<ProductionState> {
    return hydrateCreations(scope.folderPath, await this.reconcile(scope));
  }
  async newTask(detail: ContentDetail, kind: ProductionTask["kind"], extra: Partial<ProductionTask> = {}): Promise<{ task: ProductionTask; fresh: boolean }> {
    let reserved: string | undefined;
    return updateState(detail.folderPath, async (state) => {
      await this.host.resolve({ id: detail.id, folderPath: detail.folderPath });
      if (this.disposed) throw new Error("工作台服务已重新加载，请重试。");
      const old = state.tasks.find((task) => task.kind === kind && isActiveTask(task) && (!extra.platform || task.platform === extra.platform));
      if (old) {
        if (kind === "metrics" && old.metricsKey !== extra.metricsKey) throw new Error(`同步任务 ${old.id} 正在处理其他平台、账号或作品，请先等待或取消原任务。`);
        return { task: structuredClone(old), fresh: false };
      }
      const task: ProductionTask = { id: randomUUID(), kind, contentId: detail.id, folderPath: detail.folderPath, status: "queued", createdAt: Date.now(), updatedAt: Date.now(), ...extra };
      state.tasks.push(task); if (task.status === "queued") { reserved = task.id; this.pending.add(task.id); } return { task, fresh: true };
    }).catch((error) => { if (reserved) this.pending.delete(reserved); throw error; });
  }
  async patch(folder: string, id: string, values: Partial<ProductionTask>): Promise<void> {
    await updateState(folder, (state) => { const task = state.tasks.find((row) => row.id === id); if (!task) throw new Error("任务记录不存在。"); Object.assign(task, values, { updatedAt: Date.now() }); }); this.host.changed();
  }
  async launch(folder: string, task: ProductionTask, run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    return locked(`launch:${folder}:${task.id}`, async () => {
      if (this.active.has(task.id)) return;
      const controller = new AbortController();
      const entry = { folder, controller, executing: false };
      try {
        await this.host.resolve({ id: task.contentId, folderPath: folder });
        const jobs = this.host.jobs();
        const admitted = await updateState(folder, (state) => {
          const stored = state.tasks.find((row) => row.id === task.id);
          if (this.disposed || !stored || ["cancelled", "completed", "running"].includes(stored.status) || (stored.executionRevision ?? 0) !== (task.executionRevision ?? 0)) return false;
          if (!jobs) { stored.status = "blocked"; stored.error = "后台任务服务暂不可用，请稍后重试。"; return false; }
          // Cancellation and admission observe the same persisted state lock.
          stored.executionRevision = (stored.executionRevision ?? 0) + 1;
          stored.status = "running"; stored.updatedAt = Date.now(); delete stored.error;
          this.active.set(task.id, entry); return true;
        });
        this.pending.delete(task.id);
        if (!admitted || !jobs) return;
        const jobId = jobs.start({ kind: "creator-media", label: `${{ upload: "上传视频", asr: "视频转文字", article: "准备文章", wechat: "公众号草稿", metrics: "同步数据", images: "制作图片" }[task.kind]}：${basename(folder)}`, ...(task.sessionId ? { owner: task.sessionId as NonNullable<JobSpec["owner"]> } : {}), run: () => ({ cancel: () => controller.abort(), done: (async (): Promise<JobOutcome> => {
          try {
            controller.signal.throwIfAborted(); entry.executing = true;
            await run(controller.signal);
            const actual = (await readState(folder)).tasks.find((row) => row.id === task.id);
            return { status: actual?.status === "cancelled" ? "killed" : actual && ["ready", "completed"].includes(actual.status) ? "completed" : "failed", result: `任务 ${task.id}：${actual?.status ?? "结果待核对"}。${actual?.error ?? "请查看工作台实际结果。"}` };
          } catch (error) {
            const unknown = error instanceof AsrError || error instanceof WechatError ? error.unknownOutcome : entry.executing && controller.signal.aborted && ["upload", "wechat"].includes(task.kind);
            await this.patch(folder, task.id, { status: unknown ? "unconfirmed" : controller.signal.aborted ? "cancelled" : browserControlStopped(error) ? "blocked" : "failed", error: safeError(error) });
            return { status: controller.signal.aborted ? "killed" : "failed", result: safeError(error) };
          } finally { this.active.delete(task.id); this.host.changed(); }
        })() }) });
        await this.patch(folder, task.id, { jobId });
      } catch (error) {
        this.active.delete(task.id);
        await updateState(folder, (state) => { const stored = state.tasks.find((row) => row.id === task.id); if (stored && !["cancelled", "completed", "unconfirmed"].includes(stored.status)) { stored.status = "failed"; stored.error = safeError(error); stored.updatedAt = Date.now(); } });
        throw error;
      } finally { this.pending.delete(task.id); this.host.changed(); }
    });
  }
  async selected(detail: ContentDetail, signal: AbortSignal): Promise<{ path: string; identity: Awaited<ReturnType<typeof mediaIdentity>> }> {
    if (!detail.selectedVideo || detail.videoSelection !== "selected") throw new Error("请先明确选择当前视频。");
    const path = await inside(detail.folderPath, detail.selectedVideo); return { path, identity: await mediaIdentity(path, signal) };
  }
  async action(request: ProductionAction, signal: AbortSignal): Promise<ProductionState> {
    const detail = await this.host.resolve(request), folder = detail.folderPath; signal.throwIfAborted();
    const creation = await creationAction(detail, request, signal, { dataDir: this.host.dataDir, key: this.host.key, changed: this.host.changed, assertAvailable: () => this.host.resolve(request), newTask: (kind, extra) => this.newTask(detail, kind, extra), launch: (task, work) => this.launch(folder, task, work) });
    if (creation) return { ...await this.state(request), ...(typeof creation === "object" ? creation : {}) };
    const publicationHost = { dataDir: this.host.dataDir, platforms: this.host.platforms, key: this.host.key, resolve: this.host.resolve, changed: this.host.changed, reserve: (id: string) => this.pending.add(id) };
    if (request.action === "upload-publication") {
      const { task, fresh, notice } = await preparePublicationUpload(detail, request.publicationId, request.expectedRevision, request.originalRightsConfirmed, publicationHost, signal, request.newUploadAfter);
      if (fresh) await this.launch(folder, task, (current) => executePublicationUpload(folder, task, "create", current, publicationHost));
      return { ...await this.state(request), ...(notice ? { uploadNotice: notice } : {}) };
    }
    if (request.action === "upload" && !(await this.host.platforms()).includes(request.input.platform)) throw new Error("此平台尚未启用，请先在常规设置中选择显示的平台。");
    if (request.action === "cancel") {
      await updateState(folder, (state) => {
        const task = state.tasks.find((row) => row.id === request.taskId); if (!task) throw new Error("任务不存在。");
        if (!isActiveTask(task)) return;
        const active = this.active.get(task.id);
        task.status = active?.executing && ["upload", "wechat"].includes(task.kind) ? "unconfirmed" : "cancelled";
        task.error = "取消请求已提交，完整成果保留。"; task.updatedAt = Date.now();
        this.pending.delete(task.id); active?.controller.abort(new Error("用户取消任务。"));
      });
    } else if (request.action === "upload") {
      const settings = await readSettings(this.host.dataDir), account = settings.accounts[request.input.platform];
      if (!account) throw new Error("请先在发布设置中检查并连接此平台账号。");
      if (!request.input.originalRightsConfirmed) throw new Error("请先确认本次视频可按原创上传。");
      const selected = await this.selected(detail, signal), fields = structuredClone(request.input), covers = structuredClone(detail.covers);
      const key = await uploadKey(folder, selected.identity, account, fields, covers, signal);
      let reserved: string | undefined;
      const { task, fresh, notice } = await admitUpload(detail, selected.identity, account, key, request.newUploadAfter, () => this.host.resolve(request), (id) => { reserved = id; this.pending.add(id); }).catch((error) => { if (reserved) this.pending.delete(reserved); throw error; });
      if (!fresh) return { ...await this.state(request), ...(notice ? { uploadNotice: notice } : {}) };
      if (fresh) await this.launch(folder, task, async (current) => {
        const dir = await owned(folder, task.id), prepared = await makeUploadPackage({ dataDir: this.host.dataDir, folder, dir, video: selected.path, covers, fields, signal: current });
        if (key !== await uploadKey(folder, selected.identity, account, fields, covers, current)) throw new Error("封面或发布材料已变化，请核对原任务后再继续。");
        await this.patch(folder, task.id, { packageFile: prepared.file }); task.packageFile = prepared.file;
        await this.executeUpload(folder, task, "create", current);
      });
    } else if (request.action === "resume-upload" || request.action === "inspect-upload") {
      const task = (await readState(folder)).tasks.find((row) => row.id === request.taskId && row.kind === "upload");
      if (task?.publicationId) {
        if (task.status === "cancelled") await updateState(folder, state => { const stored = state.tasks.find(t => t.id === task.id)!; if (stored.status === "cancelled") stored.status = "blocked"; });
        if (!this.active.has(task.id)) await this.launch(folder, task, (current) => executePublicationUpload(folder, task, request.action === "inspect-upload" ? "inspect" : "resume", current, publicationHost));
        return this.state(request);
      }
      if (!task?.video || !task.account) throw new Error("上传任务不存在或缺少原始身份。");
      if (this.active.has(task.id)) return this.state(request);
      sameMediaIdentityError(task.video, await mediaIdentity(await inside(folder, task.video.name), signal));
      await this.launch(folder, task, (current) => this.executeUpload(folder, task, request.action === "inspect-upload" ? "inspect" : "resume", current));
    } else if (request.action === "transcribe" || request.action === "import-subtitle") {
      const selected = await this.selected(detail, signal);
      const state = await readState(folder), previous = [...state.tasks].reverse().find((task) => task.kind === "asr" && task.video && sameMedia(task.video, selected.identity));
      if (request.action === "transcribe" && previous?.status === "unconfirmed" && !request.acknowledgeUnknown) throw new Error("上次识别结果未确认；请先核对，再明确重试，可能产生新的识别费用。");
      if (request.action === "transcribe" && state.transcripts.some((entry) => sameMedia(entry.video, selected.identity))) return state;
      const key = request.action === "transcribe" ? await this.host.key(ASR_CREDENTIAL) : undefined;
      if (request.action === "transcribe" && !key) throw new Error("请先在设置中填写火山语音 API Key。");
      const { task, fresh } = await this.newTask(detail, "asr", { video: selected.identity });
      if (fresh) await this.launch(folder, task, async (current) => {
        const dir = await owned(folder, task.id);
        let version: TranscriptVersion;
        try { version = request.action === "import-subtitle" ? await importSubtitle({ folder, video: selected.path, identity: selected.identity, dir, source: request.sourcePath, signal: current }) : await transcribe({ folder, video: selected.path, identity: selected.identity, dir, key: key!, signal: current }); }
        catch (error) { if (error instanceof AsrError) throw new AsrError(safeError(error, [key ?? ""]), error.unknownOutcome); throw new Error(safeError(error, [key ?? ""])); }
        await updateState(folder, (latest) => { latest.transcripts.push(version); }); await this.patch(folder, task.id, { status: "completed", transcriptId: version.id });
      });
    } else if (request.action === "prepare-article") {
      const selected = !request.source || request.source.kind === "video" ? await this.selected(detail, signal) : undefined;
      const source = request.source ?? { kind: "video" as const, video: selected!.identity };
      const { task } = await this.newTask(detail, "article", { ...(selected ? { video: selected.identity } : {}), source, status: "waiting-agent", ...(request.sessionId ? { sessionId: request.sessionId } : {}) });
      if (task.video && selected && !sameMedia(task.video, selected.identity) || task.source && JSON.stringify(task.source) !== JSON.stringify(source)) throw new Error("已有文章请求使用另一份材料，请先处理或取消原请求。");
    } else if (request.action === "save-article") await this.commitArticle(request, signal);
    else if (request.action === "wechat-preview" || request.action === "wechat-draft") await this.wechatAction(detail, request, signal);
    else if (request.action === "associate-publication") {
      if ((await readState(folder)).tasks.some((t) => t.kind === "metrics" && isActiveTask(t))) throw new Error("正在同步，请等待或取消原任务后再更换作品关联。");
      validatePublication(request.platform, request.remoteId, request.url);
      if (request.publicationId) {
        const publication = (await readState(folder)).publications?.find((p) => p.id === request.publicationId && !p.hidden);
        if (!publication || publication.platform !== request.platform) throw new Error("作品关联与发布内容的平台不符。");
      }
      const settings = await readSettings(this.host.dataDir), accountId = request.platform === "official-account" ? settings.wechat.appid : settings.accounts[request.platform]?.id;
      if (!accountId) throw new Error("请先连接对应账号。");
      await updateState(folder, (state) => {
        let recordId = request.recordId;
        if (request.publicationId && !recordId) {
          const publication = state.publications?.find(p => p.id === request.publicationId && !p.hidden); if (!publication) throw new Error("发布内容已移除。");
          const records = state.records ??= [];
          const existing = records.find(r => r.publicationId === publication.id && r.accountId === accountId && r.remoteId === request.remoteId.trim());
          recordId = existing?.id ?? randomUUID();
          if (!existing) records.push({ id: recordId, publicationId: publication.id, revision: publication.revision, platform: publication.platform, type: publication.type, accountId, remoteId: request.remoteId.trim(), ...(request.url ? { url: request.url } : {}), state: "linked", updatedAt: Date.now() });
        }
        if (request.recordId && !state.records?.some(r => r.id === request.recordId && r.publicationId === request.publicationId && r.platform === request.platform && r.accountId === accountId)) throw new Error("作品记录不属于本次发布内容或账号。");
        if (request.recordId) { const record = state.records!.find(r => r.id === request.recordId)!; record.remoteId = request.remoteId.trim(); record.state = "linked"; record.updatedAt = Date.now(); if (request.url) record.url = request.url; else delete record.url; }
        const old = state.metrics.find((row) => row.platform === request.platform && row.accountId === accountId && (recordId ? row.recordId === recordId : request.publicationId ? row.publicationId === request.publicationId : !row.publicationId));
        if (old) { old.remoteId = request.remoteId.trim(); if (request.url) old.url = request.url; else delete old.url; old.state = "unassociated"; delete old.syncedAt; delete old.views; delete old.likes; delete old.comments; delete old.shares; }
        else state.metrics.push({ ...(request.publicationId ? { publicationId: request.publicationId } : {}), ...(recordId ? { recordId } : {}), platform: request.platform, accountId, remoteId: request.remoteId.trim(), ...(request.url ? { url: request.url } : {}), checkedAt: Date.now(), state: "unassociated" });
        state.candidates = (state.candidates ?? []).filter((row) => row.platform !== request.platform || row.accountId !== accountId);
      });
      return this.action({ ...request, action: "refresh-metrics", platform: request.platform, ...(request.publicationId ? { publicationId: request.publicationId } : {}) }, signal);
    } else if (request.action === "refresh-metrics") {
      const snapshot = await metricsSnapshot(this.host.dataDir, folder, await this.host.platforms(), request.platform, request.publicationId);
      const { task, fresh } = await this.newTask(detail, "metrics", snapshot); if (fresh) await this.launch(folder, task, (current) => this.refreshMetrics(folder, task, request.platform, current));
    }
    this.host.changed(); return this.state(request);
  }
  async executeUpload(folder: string, task: ProductionTask, operation: "create" | "resume" | "inspect", signal: AbortSignal): Promise<void> {
    const settings = await readSettings(this.host.dataDir), account = task.account!;
    if (settings.accounts[account.platform]?.id !== account.id) throw new Error("本任务属于原账号，请切回后继续。");
    if (!(await this.host.platforms()).includes(account.platform)) throw new Error("本任务的平台已停用，请重新启用后继续。");
    const result = await withBrowser(this.host.dataDir, signal, async (current) => {
      try {
      const dir = await owned(folder, task.id), first = await runUpload({ dataDir: this.host.dataDir, folder, dir, task, account, operation, signal: current });
      if (first.ready && operation !== "inspect") return runUpload({ dataDir: this.host.dataDir, folder, dir, task, account, operation: "inspect", signal: current });
      return first;
      } finally { await releaseUploadBrowser(folder, task).catch(() => undefined); }
    });
    if (result.userControl) await updateSettings(this.host.dataDir, (latest) => { latest.browserPaused = true; });
    await updateState(folder, (state) => {
      const saved = state.tasks.find((row) => row.id === task.id);
      if (!saved) throw new Error("任务记录不存在。");
      saved.status = result.ready ? "ready" : "blocked"; saved.receipt = result.receipt; saved.updatedAt = Date.now();
      if (result.error) saved.error = result.error; else delete saved.error;
    });
    this.host.changed();
  }
  async articleInputs(scope: ContentScope, taskId: string, sessionId: string | undefined, signal: AbortSignal): Promise<{ waiting?: string; jobId?: string; transcript?: string; frames?: Array<{ file: string; at: number; data: Buffer }>; task: ProductionTask; rules: string; outputDirectory: string }> {
    const detail = await this.host.resolve(scope), folder = detail.folderPath, state = await readState(folder), task = state.tasks.find((row) => row.id === taskId && row.kind === "article");
    if (!task || !task.video && !task.source || task.status === "cancelled" || task.status === "completed") throw new Error("文章请求已结束或不存在。");
    // Session identity is for navigation/job attribution, not permission to work on the exact task.
    if (sessionId && !task.sessionId) { task.sessionId = sessionId; await this.patch(folder, task.id, { sessionId }); }
    if (!task.video) {
      const outputDirectory = await owned(folder, task.id), skill = await resource("vendor", "wewrite", "SKILL.md");
      const inputFile = join(outputDirectory, "article-inputs.json");
      const text = await locked(`article-input:${folder}:${task.id}`, async () => { const existing = await readFile(inputFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; }); if (existing) { const saved = JSON.parse(existing) as { text?: string }; if (saved.text !== undefined) return saved.text; } const captured = await readCreationSource(folder, task.source!, state); await atomic(inputFile, { frames: [], source: task.source, text: captured }); return captured; });
      const imageFiles = await Promise.all((state.images ?? []).filter((i) => !i.hidden).map(async (i) => ({ id: i.id, file: relative(outputDirectory, await inside(folder, i.file)), purpose: i.purpose })));
      return { task, transcript: `项目：${detail.title}\n\n${text}`, frames: [], outputDirectory, rules: `读取 WeWrite Skill：${skill}。本次为独立写作，按用户需求完成正文、配图及 HTML；不要求视频。已登记图片：${JSON.stringify(imageFiles)}。保存时用这些相对路径和 imageIds。` };
    }
    const video = await inside(folder, task.video.name); sameMediaIdentityError(task.video, await mediaIdentity(video, signal));
    const transcript = [...state.transcripts].reverse().find((entry) => sameMedia(entry.video, task.video!));
    const dir = await owned(folder, task.id), outputDirectory = dir;
    const skill = await resource("vendor", "wewrite", "SKILL.md");
    const rules = `使用 WeWrite 写作 Skill：${skill}。先读取此文件及其中的成熟写作流程和规则，再基于本次真实转写、图片附件制作文章。保存时调用 creator_save_article，返回排版后的 HTML 成品；不要另行运行发布脚本。`;
    if (!transcript) {
      const selected = await this.selected(detail, signal); sameMediaIdentityError(task.video, selected.identity);
      const next = await this.action({ ...scope, action: "transcribe" }, signal), asr = [...next.tasks].reverse().find((row) => row.kind === "asr" && row.video && sameMedia(row.video, task.video!));
      return { waiting: "先等待视频转写任务完成，再次调用本工具读取真实文字和画面。", ...(asr?.jobId ? { jobId: asr.jobId } : {}), task, rules, outputDirectory };
    }
    const manifestPath = join(dir, "article-inputs.json");
    let prepared: Awaited<ReturnType<typeof prepareArticleFrames>>;
    prepared = await prepareArticleFrames({ dataDir: this.host.dataDir, folder, video, dir, transcript, signal });
    await atomic(manifestPath, prepared);
    await this.patch(folder, task.id, { transcriptId: transcript.id, status: "waiting-agent" });
    // Old input manifests remain usable, but never revive their retired writing entry.
    return { task, transcript: prepared.transcript, frames: await Promise.all(prepared.frames.map(async (frame) => ({ ...frame, data: await readFile(await inside(folder, frame.file)) }))), rules: `${rules}\n\n${await readFile(skill, "utf8")}`, outputDirectory };
  }
  async commitArticle(request: ContentScope & { taskId: string; markdown: string; sessionId?: string; imageIds?: string[] }, signal: AbortSignal): Promise<void> {
    const detail = await this.host.resolve(request), folder = detail.folderPath, state = await readState(folder), task = state.tasks.find((row) => row.id === request.taskId && row.kind === "article");
    if (!task || task.video && !task.transcriptId || !task.video && !task.source || task.status !== "waiting-agent") throw new Error("请先读取本次文章的真实字幕和画面。");
    if (task.video) sameMediaIdentityError(task.video, await mediaIdentity(await inside(folder, task.video.name), signal));
    const dir = await owned(folder, task.id), inputs = JSON.parse(await readFile(join(dir, "article-inputs.json"), "utf8")) as { frames: Array<{ file: string }> };
    const images = await Promise.all((request.imageIds ?? []).map((id) => creationImage(folder, id, state)));
    const version = await saveArticle({ folder, dir, ...(task.video ? { video: task.video } : {}), ...(task.transcriptId ? { transcriptId: task.transcriptId } : {}), ...(task.source ? { source: task.source } : {}), imageIds: request.imageIds ?? [], frames: [...inputs.frames.map((frame) => frame.file), ...images.map(({ image }) => image.file)], markdown: request.markdown });
    await updateState(folder, (latest) => { latest.articles.push(version); });
    try {
      const settings = await readSettings(this.host.dataDir), result = await formatArticle(this.host.dataDir, folder, version.file, settings.wechat.theme, signal);
      await this.patch(folder, task.id, { status: "completed", articleId: version.id, receipt: relative(folder, result.path), step: "formatted" });
    } catch (cause) {
      await this.patch(folder, task.id, { status: "blocked", articleId: version.id, step: "formatting", error: `源稿已保存，排版未完成：${safeError(cause)}。请在文章页重试排版。` });
    }
  }
  async wechatAction(detail: ContentDetail, request: Extract<ProductionAction, { action: "wechat-preview" | "wechat-draft" }>, signal: AbortSignal): Promise<void> {
    const folder = detail.folderPath, state = await readState(folder), settings = await readSettings(this.host.dataDir), config = structuredClone(settings.wechat);
    const articleFile = request.articleFile ?? state.articles.at(-1)?.file ?? detail.articlePath;
    if (!articleFile) throw new Error("请先准备或选择公众号文章。");
    const article = await inside(folder, articleFile);
    if (request.action === "wechat-preview") {
      await this.preview(detail, { articleFile: article }, signal); return;
    }
    const secret = await this.host.key(wechatCredential(config.appid)); if (!secret || !config.appid) throw new Error("请先配置公众号 AppID 和 AppSecret。");
    const cover = request.coverPath; if (!cover) throw new Error("请先准备公众号封面。");
    const articleRelative = relative(folder, article);
    const previousTask = [...state.tasks].reverse().find((row) => row.kind === "wechat" && row.step === "draft" && row.wechatAppId === config.appid && row.articleFile === articleRelative);
    if (previousTask?.status === "unconfirmed" && !request.acknowledgeUnknown) throw new Error("上次草稿提交结果未确认，请先在公众号后台核对，再明确重试。");
    const previous = [...state.drafts].reverse().find((draft) => draft.appid === config.appid && draft.articleFile === relative(folder, article));
    const recover = previousTask && ["unconfirmed", "failed", "cancelled"].includes(previousTask.status) && !this.active.has(previousTask.id);
    const { task, fresh } = recover ? { task: previousTask, fresh: true } : await this.newTask(detail, "wechat", { step: "draft", wechatAppId: config.appid, articleFile: articleRelative });
    if (task.wechatAppId !== config.appid || task.articleFile !== articleRelative) throw new Error("已有公众号草稿任务正在处理其他文章或账号，请先完成或取消原任务。");
    if (fresh) await this.launch(folder, task, async (current) => {
      try {
        const dir = await owned(folder, task.id), draft = await submitWechat({ dataDir: this.host.dataDir, folder, dir, articleFile: article, cover, config, secret, ...(previous ? { previous } : {}), ...(request.confirmRemoteChange ? { confirmRemoteChange: true } : {}), signal: current });
        await updateState(folder, (latest) => { const index = latest.drafts.findIndex((row) => row.id === draft.id); if (index < 0) latest.drafts.push(draft); else latest.drafts[index] = draft; });
        await this.patch(folder, task.id, { status: "ready", remoteId: draft.mediaId, receipt: relative(folder, join(dir, "wechat-receipt.json")) });
      } catch (error) { throw new WechatError(safeError(error, [secret]), error instanceof WechatError ? error.unknownOutcome : true, error instanceof WechatError ? error.code : undefined); }
    });
  }
  async preview(scope: ContentScope, request: { taskId?: string; articleFile?: string }, signal: AbortSignal): Promise<{ html: string; path: string }> {
    const detail = await this.host.resolve(scope), folder = detail.folderPath, state = await readState(folder);
    if (request.taskId) {
      const task = state.tasks.find((row) => row.id === request.taskId && row.step === "preview");
      if (!task?.receipt) throw new Error("预览尚未准备好。");
      const path = await inside(folder, task.receipt); return { html: await readFile(path, "utf8"), path };
    }
    const file = request.articleFile ?? state.articles.at(-1)?.file ?? detail.articlePath;
    if (!file) throw new Error("请先准备或选择公众号文章。");
    const settings = await readSettings(this.host.dataDir), result = await formatArticle(this.host.dataDir, folder, file, settings.wechat.theme, signal);
    if (state.tasks.some((task) => task.kind === "article" && task.step === "formatting")) await updateState(folder, (latest) => {
      for (const task of latest.tasks) if (task.kind === "article" && task.step === "formatting" && latest.articles.some((article) => article.id === task.articleId && article.file === file)) {
        task.status = "completed"; task.step = "formatted"; task.receipt = relative(folder, result.path); delete task.error;
      }
    });
    return result;
  }
  async discoverPublications(folder: string, task: ProductionTask, platform: PublishPlatform | "official-account" | undefined, signal: AbortSignal): Promise<void> {
    return this.refreshMetrics(folder, task, platform, signal);
  }
  async refreshMetrics(folder: string, task: ProductionTask, platform: PublishPlatform | "official-account" | undefined, signal: AbortSignal): Promise<void> {
    if (!task.metricsTargets) Object.assign(task, await metricsSnapshot(this.host.dataDir, folder, await this.host.platforms(), platform));
    const detail = await this.host.resolve({ id: task.contentId, folderPath: folder });
    await runMetricsTask({ dataDir: this.host.dataDir, folder, task, detail, signal, changed: this.host.changed,
      ...(this.host.published ? { published: (record) => this.host.published!({ id: task.contentId, folderPath: folder }, record) } : {}),
      collect: async (target, current) => {
        if (target.platform === "official-account") {
          const settings = await readSettings(this.host.dataDir), secret = await this.host.key(wechatCredential(target.accountId));
          if (!secret) throw new Error("公众号凭据未配置。");
          const result = await wechatWorker<{ rows: Array<{ remoteId: string; title?: string; views?: number; likes?: number }> }>(this.host.dataDir, { operation: "stats", ...settings.wechat, secret }, current).catch((error: unknown) => { throw new Error(safeError(error, [secret])); });
          return result.rows.map((row) => ({ ...row, title: row.title ?? "", platform: "wechat" as const }));
        }
        const platform = target.platform;
        return withBrowser(this.host.dataDir, current, async (browserSignal) => {
          await requireAccount(platform, target.accountId, browserSignal);
          const peers = task.metricsTargets!.filter(row => row.platform === platform && row.accountId === target.accountId);
          const remoteIds = [...new Set(peers.flatMap(row => row.remoteId ? [row.remoteId] : []))];
          const result = await runCollectPublish(collectScriptPath(), browserSignal, { executable: await browserExecutable(), platforms: [platform], ...(remoteIds.length && peers.every(row => row.remoteId) ? { targets: [{ title: "", remoteIds }] } : {}), cleanupStale: false, maxPages: 80, xhsScrollSteps: 80 });
          await requireAccount(platform, target.accountId, browserSignal);
          const page = result.collected.find((row) => row.platform === platform);
          if (!page || page.error || page.loginRequired) throw new Error(page?.error ?? "登录失效或未取得平台结果。");
          return page.items;
        });
      },
    });
  }
}
