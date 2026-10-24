import { CoverWorkflow } from "./covers/workflow.ts";
import { ProductionWorkflow } from "./production/workflow.ts";
import { projectProduction } from "./production/projection.ts";
import { removedContentIds, setContentHidden } from "./contentVisibility.ts";
import { restoreProjectSessionMembership } from "./projectSessionsHost.ts";
import type { ContentScope, ProductionAction, ProductionSettingsAction, ProductionSettingsView, ProductionState } from "./production/types.ts";
import { resolveWorkbenchCredential, workbenchCredentialConfigured, saveWorkbenchCredential } from "./secretsHost.ts";
import type { CoverAction, CoverScope, CoverState, ImageSettings } from "./covers/types.ts";
import { readImageSettings, saveImageSettings, beginImageUpdate, completeImageUpdate, checkImageConnection, saveImageCheck, safeImageError } from "./covers/provider.ts";
import { atomicJson, coverLock, readCoverState, writeCoverState } from "./covers/files.ts";
import { readState, updateState } from "./production/storage.ts";
import { resolveVideoSelection, sameVideoName } from "./videoSelection.ts";
import type { JobRegistry } from "@deepseek-ai/dsh-jobs";
import { VideoImports } from "./videoImport.ts";
import { openExternalPath } from "./openExternalPath.ts";
import { contentFolder, videoFile } from "./videoFiles.ts";
import type { VideoImportRequest, VideoImportState } from "./types.ts";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { pathExists } from "./artifacts.ts";
import {
  countsOf,
  coverPathOf,
  createContentFolder,
  matchesFilter,
  matchesQuery,
  readArticle,
  readPublishCopy,
  readSubtitleCues,
  readSubtitleText,
  readScript,
  readTopicNote,
  scanLibrary,
  writeScript,
  writeTopicNote,
} from "./catalog.ts";
import {
  expandHomePath,
  resolveSkillDir,
  resolveDataDir,
  type Config,
} from "./config.ts";
import { inspectCreatorSetup } from "./capabilities.ts";
import { creatorGuideText } from "./guide.ts";
import { applyOrganize, previewOrganize, remapOverlayItems } from "./organize.ts";
import { cacheIsFresh, loadCollectCache, nextCollectCacheScope, saveCollectCache } from "./collectCache.ts";
import {
  applyMatchesToOverlay,
  cacheCoversTargets,
  filterCollected,
  filterMatchItems,
  knownFromPublish,
  matchCollected,
  mergeCollected,
  unionCollected,
  type CollectResult,
  type CollectTarget,
} from "./collectPublish.ts";
import { collectScriptPath, runCollectPublish } from "./collectEgo.ts";
import { pickCoverLaunch, pickSubtitleWorkflow, resolveCoverSkill, type GenerateStep } from "./generate.ts";
import { startLibraryWatch } from "./libraryWatch.ts";
import {
  emptyProfile,
  loadOverlay,
  normalizeEnabledPlatforms,
  overlayPath,
  saveOverlay,
  withOverlayLock,
} from "./overlay.ts";
import { patchOverlayPublish } from "./publishStatus.ts";
import { missingSecretMessage } from "./secrets.ts";
import { describeCreatorSecrets, resolveCreatorSecret, secretEnv } from "./secretsHost.ts";
import {
  findFreePort,
  pickBurnLaunch,
  pickPreviewLaunch,
  resolveSubtitleSkill,
  spawnPython,
  waitHttp,
} from "./subtitle.ts";
import {
  jobPidMatches,
  jobPidStillOurs,
  pidAlive,
  pidCommand,
  terminateOwnedProcess,
  waitForPidExit,
} from "./processAlive.ts";
import {
  livePreviewRecord,
  loadPreviewRegistry,
  previewRegistryPathForDataDir,
  removePreviewRecord,
  savePreviewRegistry,
  upsertPreviewRecord,
} from "./previewServers.ts";
import { collectRegistryPathForDataDir } from "./collectSpaces.ts";
import { coverThumb } from "./thumbs.ts";
import { startArticleServer } from "./articleServe.ts";
import { playbackOf, startVideoServer } from "./videoServe.ts";
import type {
  BurnJob,
  ContentDetail,
  CoverThumbResult,
  CreatorCapabilities,
  CreatorSetupRequest,
  CreatorSetupResult,
  CreatorSetupStatus,
  CreateContentRequest,
  CreateContentResult,
  CreatorGuideResult,
  IdRequest,
  OverlayItem,
  OverlayStore,
  LibrarySettings,
  ListContentsRequest,
  ListContentsResult,
  OrganizePreview,
  OrganizeRequest,
  SetLibraryRootRequest,
  SetProfileRequest,
  SetPublishRequest,
  SetScriptRequest,
  SetScriptRulesRequest,
  SetTopicNoteRequest,
  SubtitlePreviewResult,
  SubtitleTextResult,
  SyncPublishRequest,
  SyncPublishResult,
  ArticleMediaResult,
  VideoPlaybackResult,
} from "./types.ts";

export const CREATOR_WORKBENCH_SERVICE = "creatorWorkbench";

export class CreatorWorkbenchService extends TypertRemoteService {
  // Gateway calls methods on a Cordis proxy; `#private` fields throw on that receiver.
  libraryRoot: string;
  readonly dataDir: string;
  // Raw config values; skill dirs are re-resolved on each use so a skill the
  // user installs after Harness started is discovered without a restart.
  readonly subtitleSkillDirConfig: string;
  readonly coverSkillDirConfig: string;
  cache: { libraryRoot: string; items: Awaited<ReturnType<typeof scanLibrary>> } | undefined;
  cachedScriptRules: string | undefined;
  cachedEnabledPlatforms: string[] | undefined;
  catalogRevision = 0;
  watchClose: (() => void) | undefined;
  watchedRoot: string | undefined;
  imports = new VideoImports();
  covers: CoverWorkflow;
  production: ProductionWorkflow;
  importJobs: JobRegistry | undefined;
  previews = new Map<string, { url: string; port: number; pid: number }>();
  videos = new Map<string, { url: string; path: string; close: () => void }>();
  articles = new Map<string, { origin: string; root: string; close: () => void }>();

  constructor(ctx: Context, config: Config) {
    super(ctx, CREATOR_WORKBENCH_SERVICE);
    this.libraryRoot = resolveUserPath(config.libraryRoot);
    this.dataDir = resolveUserPath(resolveDataDir(config));
    this.subtitleSkillDirConfig = config.subtitleSkillDir;
    this.coverSkillDirConfig = config.coverSkillDir;
    this.production = new ProductionWorkflow({ dataDir: this.dataDir,
      published: async (scope, record) => { if (record.platform === "official-account") return; const platform = record.platform; await this.patchItem(scope.id, (item) => { item.publish ??= {}; item.publish[platform] = { status: "published", verifiedAccountId: record.accountId, remoteId: record.remoteId, ...(record.url ? { url: record.url } : {}), ...(record.syncedAt ? { syncedAt: record.syncedAt } : {}) }; }, new AbortController().signal, scope.folderPath); },
      platforms: async () => (await loadOverlay(this.dataDir)).profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms,
      resolve: async (scope) => { const detail = await this.getContent({ id: scope.id }, new AbortController().signal); if (detail.folderPath !== scope.folderPath) throw new Error("资料位置已切换，请重新打开内容。"); return detail; },
      key: (ref) => resolveWorkbenchCredential(this.ctx, ref), hasKey: (ref) => workbenchCredentialConfigured(this.ctx, ref), setKey: (ref, value) => saveWorkbenchCredential(this.ctx, ref, value), jobs: () => this.importJobs, changed: () => this.invalidateCatalog(),
    });
    this.covers = new CoverWorkflow({ dataDir: this.dataDir,
      resolve: async (scope) => {
        const detail = await this.getContent({ id: scope.id }, new AbortController().signal);
        if (detail.folderPath !== scope.folderPath) throw new Error("资料位置已切换，请重新打开内容。");
        const { libraryRoot } = await this.scanned();
        return { folder: await contentFolder(libraryRoot, detail.folderPath), ...(detail.selectedVideo ? { selectedVideo: detail.selectedVideo } : {}), title: detail.title, script: detail.script, transcript: detail.subtitles.srt ? (await readSubtitleText(detail)).slice(0, 30000) : "" };
      }, key: () => resolveCreatorSecret(this.ctx, "cover"), jobs: () => this.importJobs,
      changed: () => this.invalidateCatalog(), skill: () => this.coverSkillDir(),
    });
    void loadOverlay(this.dataDir).then((overlay) => { this.rememberOverlay(overlay); });
    ctx.effect(() => async () => {
      this.stopWatch();
      this.imports.dispose();
      this.covers.dispose();
      this.production.dispose();
      await this.stopServers();
    }, "creator-workbench: library watch");
  }

  subtitleSkillDir(): string {
    return resolveSkillDir(this.subtitleSkillDirConfig, "oil-subtitle", process.env.OIL_SUBTITLE_SKILL);
  }

  coverSkillDir(): string {
    return resolveSkillDir(this.coverSkillDirConfig, "oil-cover", process.env.OIL_COVER_SKILL);
  }

  async stopServers(): Promise<void> {
    for (const session of this.videos.values()) session.close();
    this.videos.clear();
    for (const session of this.articles.values()) session.close();
    this.articles.clear();
    const registryPath = previewRegistryPathForDataDir(this.dataDir);
    const recorded = loadPreviewRegistry(registryPath);
    const recordedByPid = new Map(recorded.map((record) => [record.pid, record]));
    const remaining = new Map<string, typeof recorded[number]>();
    const seen = new Set<number>();
    for (const preview of [...this.previews.values(), ...recorded]) {
      if (seen.has(preview.pid)) continue;
      seen.add(preview.pid);
      if (jobPidStillOurs(preview.pid, "preview_editor")) {
        try {
          process.kill(preview.pid, "SIGTERM");
          await waitForPidExit(preview.pid, ["preview_editor"]);
          if (jobPidStillOurs(preview.pid, "preview_editor")) {
            process.kill(preview.pid, "SIGKILL");
            await waitForPidExit(preview.pid, ["preview_editor"], 1_000);
          }
        } catch {
          // The process may have exited between ownership check and signal.
        }
      }
      // Keep a live record when ownership could not be established or the
      // process ignored both signals. A later Harness run can retry safely.
      if (pidAlive(preview.pid) && (pidCommand(preview.pid) === undefined || jobPidStillOurs(preview.pid, "preview_editor"))) {
        const record = recordedByPid.get(preview.pid);
        if (record !== undefined) remaining.set(record.id, record);
      }
    }
    this.previews.clear();
    savePreviewRegistry(registryPath, [...remaining.values()]);
  }

  invalidateCatalog(): void {
    this.cache = undefined;
    this.catalogRevision += 1;
  }

  stopWatch(): void {
    this.watchClose?.();
    this.watchClose = undefined;
    this.watchedRoot = undefined;
  }

  ensureWatch(libraryRoot: string): void {
    if (this.watchedRoot === libraryRoot && this.watchClose !== undefined) return;
    this.stopWatch();
    this.watchedRoot = libraryRoot;
    try {
      mkdirSync(this.dataDir, { recursive: true });
    } catch {
      // Watch can still attach to an existing library root.
    }
    this.watchClose = startLibraryWatch({
      libraryRoot,
      overlayPath: overlayPath(this.dataDir),
      onChange: () => {
        this.invalidateCatalog();
      },
    }).close;
  }

  subtitleSkill(): Promise<{ root: string; python: string }> {
    return resolveSubtitleSkill(this.subtitleSkillDir());
  }

  coverSkill(): Promise<{ root: string; python: string; script: string }> {
    return resolveCoverSkill(this.coverSkillDir());
  }

  async scanned() {
    return withOverlayLock(this.dataDir, async () => {
      let overlay = await loadOverlay(this.dataDir);
      const libraryRoot = overlay.libraryRoot ?? this.libraryRoot;
      this.rememberOverlay(overlay);
      this.ensureWatch(libraryRoot);
      const reconciled = await reconcileOverlayBurns(overlay);
      if (reconciled !== undefined) {
        overlay = reconciled;
        await saveOverlay(this.dataDir, overlay);
        this.invalidateCatalog();
      }
      if (this.cache?.libraryRoot === libraryRoot) {
        return { overlay, libraryRoot, items: this.cache.items };
      }
      const items = await Promise.all((await scanLibrary(libraryRoot, overlay)).map((item) => projectProduction(item, this.dataDir)));
      this.cache = { libraryRoot, items };
      return { overlay, libraryRoot, items };
    });
  }

  async getRevision(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<{ revision: number }> {
    signal.throwIfAborted();
    if (this.watchClose === undefined) await this.scanned();
    return { revision: this.catalogRevision };
  }

  async listContents(
    request: ListContentsRequest,
    signal: AbortSignal,
  ): Promise<ListContentsResult> {
    signal.throwIfAborted();
    const { overlay, libraryRoot, items: scanned } = await this.scanned();
    const hidden = new Set(removedContentIds(overlay, libraryRoot));
    const visible = scanned.filter((item) => !hidden.has(item.id));
    const items = visible.filter((item) =>
      matchesFilter(item, request.filter) && matchesQuery(item, request.query)
    );
    return {
      settings: await this.settingsOf(libraryRoot, overlay),
      items,
      removedItems: scanned.filter((item) => hidden.has(item.id)),
      counts: countsOf(visible),
      revision: this.catalogRevision,
    };
  }

  async setContentVisibility(request: { id: string; folderPath: string; hidden: boolean }, signal: AbortSignal): Promise<ListContentsResult> {
    await this.projectAction({ ...request, action: request.hidden ? "remove" : "join" }, signal);
    return this.listContents({ query: "", filter: "all" }, signal);
  }

  async projectAction(request: { id: string; folderPath: string; action: "inspect" | "remove" | "join"; cancelTasks?: boolean }, signal: AbortSignal): Promise<{ tasks: string[]; removed: boolean }> {
    signal.throwIfAborted();
    const { libraryRoot, overlay } = await this.scanned();
    const folder = await contentFolder(request.action === "inspect" ? dirname(request.folderPath) : libraryRoot, request.folderPath);
    if (basename(folder) !== request.id) throw new Error("项目目录已变化，请刷新后重试。");
    if (request.action === "join") {
      await setContentHidden(this.dataDir, libraryRoot, request.id, folder, false); this.invalidateCatalog();
      return { tasks: [], removed: false };
    }
    const production = await readState(folder), cover = await readCoverState(folder);
    const tasks = production.tasks.filter((t) => ["queued", "running", "waiting-agent"].includes(t.status)).map((t) => t.step ?? ({ upload: "上传视频", article: "文章制作", asr: "语音转文字", metrics: "同步数据", wechat: "公众号草稿" }[t.kind]));
    tasks.push(...cover.runs.filter((r) => ["preparing", "running"].includes(r.status) || r.status === "waiting_agent" && Boolean(r.deliveredAt || r.frames.length)).map((r) => r.status === "waiting_agent" ? "封面制作请求" : "封面制作"));
    const imports = [...this.imports.tasks.values()].filter((t) => t.folder === folder && t.state.status === "running");
    tasks.push(...imports.map(() => "导入视频"));
    if (request.action === "inspect") return { tasks, removed: removedContentIds(overlay, dirname(folder)).includes(request.id) };
    if (tasks.length && !request.cancelTasks) throw new Error("项目仍有任务，请确认‘取消任务并移除’。");
    // Persist the admission barrier first, including when a later host cleanup fails.
    await setContentHidden(this.dataDir, libraryRoot, request.id, folder, true); this.invalidateCatalog();
    for (const task of this.production.active.values()) if (task.folder === folder) task.controller.abort();
    this.covers.active.get(folder)?.controller.abort();
    for (const task of imports) task.controller.abort();
    const stoppingDeadline = Date.now() + 10_000;
    const stillRunning = () => [...this.production.active.values()].some((task) => task.folder === folder) || this.covers.active.has(folder) || imports.some((task) => task.state.status === "running");
    while (stillRunning() && Date.now() < stoppingDeadline) { signal.throwIfAborted(); await new Promise((resolve) => setTimeout(resolve, 50)); }
    if (stillRunning()) throw new Error("项目已停止接收新任务，部分本地任务尚未确认结束。请稍后重试移除；现有文件和远端结果保留。");
    await updateState(folder, (state) => { for (const task of state.tasks) if (["queued", "running", "waiting-agent"].includes(task.status)) { task.status = task.status === "running" && (task.kind === "upload" || task.kind === "wechat") ? "unconfirmed" : "cancelled"; task.error = "项目已移除；已完成文件保留，远端结果未撤回。"; task.updatedAt = Date.now(); } });
    await coverLock(folder, async () => { const state = await readCoverState(folder); for (const run of state.runs) if (["waiting_agent", "preparing", "running"].includes(run.status)) { run.status = this.covers.active.has(folder) ? "unconfirmed" : "cancelled"; run.updatedAt = Date.now(); } await writeCoverState(folder, state); });
    this.videos.get(request.id)?.close(); this.videos.delete(request.id);
    this.invalidateCatalog();
    return { tasks, removed: true };
  }

  async restoreProjectSession(request: { id: string; folderPath: string; sessionId: string }, signal: AbortSignal): Promise<Record<string, never>> {
    const detail = await this.getContent({ id: request.id }, signal);
    const folder = await contentFolder(dirname(detail.folderPath), request.folderPath);
    if (await realpath(detail.folderPath) !== await realpath(folder)) throw new Error("项目位置已变化，请刷新后重新加入。");
    await restoreProjectSessionMembership(this.ctx, folder, request.sessionId, signal);
    return {};
  }

  async getContent(request: IdRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const catalog = await this.scanned();
    if (removedContentIds(catalog.overlay, catalog.libraryRoot).includes(request.id)) throw new Error("此项目已从工作台移除，请通过‘使用已有目录’重新加入。");
    const found = await this.find(request.id);
    const item = found ? await projectProduction(found, this.dataDir) : undefined;
    if (item === undefined) {
      throw new Error(`content not found: ${request.id}`);
    }
    return {
      ...item,
      publishCopy: await readPublishCopy(item.folderPath),
      topicNote: await readTopicNote(item.folderPath),
      script: await readScript(item.folderPath),
      article: await readArticle(item.articlePath),
      secrets: await describeCreatorSecrets(this.ctx),
    };
  }

  async getCoverThumb(request: IdRequest, signal: AbortSignal): Promise<CoverThumbResult> {
    signal.throwIfAborted();
    const folderId = request.id.split("::")[0] ?? request.id;
    const ratio = request.id.split("::")[1];
    const item = await this.find(folderId);
    const path = ratio === "3x4" || ratio === "4x3" || ratio === "16x9"
      ? item?.covers[ratio]
      : item === undefined ? undefined : coverPathOf(item);
    return coverThumb(this.dataDir, request.id, path);
  }

  async getVideoPlayback(request: IdRequest, signal: AbortSignal): Promise<VideoPlaybackResult> {
    signal.throwIfAborted();
    const item = await this.find(request.id);
    const picked = item === undefined ? undefined : playbackOf(item);
    if (picked === undefined) return { found: false, url: "", kind: "raw" };
    const existing = this.videos.get(request.id);
    if (existing !== undefined && existing.path === picked.path) {
      return { found: true, url: existing.url, kind: picked.kind };
    }
    existing?.close();
    const session = await startVideoServer(picked.path);
    this.videos.set(request.id, { url: session.url, path: picked.path, close: session.close });
    return { found: true, url: session.url, kind: picked.kind };
  }

  async getArticleMedia(request: IdRequest, signal: AbortSignal): Promise<ArticleMediaResult> {
    signal.throwIfAborted();
    const item = await this.getContent(request, signal);
    if (item?.articlePath === undefined) return { found: false, origin: "" };
    const root = dirname(item.articlePath);
    const existing = this.articles.get(request.id);
    if (existing !== undefined && existing.root === root) {
      return { found: true, origin: existing.origin };
    }
    existing?.close();
    const session = await startArticleServer(root);
    this.articles.set(request.id, { origin: session.origin, root, close: session.close });
    return { found: true, origin: session.origin };
  }

  async getSubtitleText(request: IdRequest, signal: AbortSignal): Promise<SubtitleTextResult> {
    signal.throwIfAborted();
    const found = await this.find(request.id);
    const item = found ? await projectProduction(found, this.dataDir) : undefined;
    if (item === undefined) return { text: "", cues: [] };
    const cues = await readSubtitleCues(item);
    const text = cues.length > 0 ? cues.map((cue) => cue.text).join("\n") : await readSubtitleText(item);
    return { text, cues };
  }

  async openContentPath(request: { path: string }, signal: AbortSignal): Promise<Record<string, never>> {
    signal.throwIfAborted();
    const overlay = await loadOverlay(this.dataDir);
    const root = await realpath(overlay.libraryRoot ?? this.libraryRoot);
    const target = await realpath(request.path);
    const inside = relative(root, target);
    if (inside === ".." || inside.startsWith("../") || inside.startsWith("..\\") || isAbsolute(inside)) {
      throw new Error("只能打开当前资料目录里的文件。");
    }
    signal.throwIfAborted();
    await openExternalPath(target);
    return {};
  }

  async getSettings(_request: Record<string, never>, signal: AbortSignal): Promise<LibrarySettings> {
    signal.throwIfAborted();
    const overlay = await loadOverlay(this.dataDir);
    this.rememberOverlay(overlay);
    return this.settingsOf(overlay.libraryRoot ?? this.libraryRoot, overlay);
  }

  async setLibraryRoot(
    request: SetLibraryRootRequest,
    signal: AbortSignal,
  ): Promise<LibrarySettings> {
    signal.throwIfAborted();
    const libraryRoot = resolveUserPath(request.path);
    const info = await stat(libraryRoot).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) {
      throw new Error(`library root is not a directory: ${libraryRoot}`);
    }
    return withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      overlay.libraryRoot = libraryRoot;
      await saveOverlay(this.dataDir, overlay);
      this.libraryRoot = libraryRoot;
      this.stopWatch();
      this.invalidateCatalog();
      return this.settingsOf(libraryRoot, overlay);
    });
  }

  async setProfile(request: SetProfileRequest, signal: AbortSignal): Promise<LibrarySettings> {
    signal.throwIfAborted();
    return withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      overlay.profile = {
        enabledPlatforms: normalizeEnabledPlatforms(request.profile.enabledPlatforms),
      };
      await saveOverlay(this.dataDir, overlay);
      this.rememberOverlay(overlay);
      this.invalidateCatalog();
      return this.settingsOf(overlay.libraryRoot ?? this.libraryRoot, overlay);
    });
  }

  async setScriptRules(request: SetScriptRulesRequest, signal: AbortSignal): Promise<LibrarySettings> {
    signal.throwIfAborted();
    return withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      const text = request.text.trim();
      if (text === "") delete overlay.scriptRules;
      else overlay.scriptRules = text;
      await saveOverlay(this.dataDir, overlay);
      this.rememberOverlay(overlay);
      return this.settingsOf(overlay.libraryRoot ?? this.libraryRoot, overlay);
    });
  }

  async getCreatorGuide(signal: AbortSignal): Promise<CreatorGuideResult> {
    signal.throwIfAborted();
    const status = await this.getCreatorSetupStatus(signal);
    return { guide: creatorGuideText(status), status };
  }

  async getCapabilities(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<{ capabilities: CreatorCapabilities }> {
    signal.throwIfAborted();
    const status = await this.getCreatorSetupStatus(signal);
    return { capabilities: status.capabilities };
  }

  async getCreatorSetupStatus(signal: AbortSignal): Promise<CreatorSetupStatus> {
    signal.throwIfAborted();
    const settings = await this.getSettings({}, signal);
    return inspectCreatorSetup({
      libraryRoot: settings.libraryRoot,
      dataDir: this.dataDir,
      subtitleSkillDir: this.subtitleSkillDir(),
      coverSkillDir: this.coverSkillDir(),
      settings,
    });
  }

  async configureCreator(
    request: CreatorSetupRequest,
    signal: AbortSignal,
  ): Promise<CreatorSetupResult> {
    signal.throwIfAborted();
    const proposal: CreatorSetupResult["proposal"] = {};
    if (request.libraryRoot !== undefined) proposal.libraryRoot = resolveUserPath(request.libraryRoot);
    if (request.enabledPlatforms !== undefined) {
      proposal.enabledPlatforms = normalizeEnabledPlatforms(request.enabledPlatforms);
    }
    if (!request.apply || Object.keys(proposal).length === 0) {
      return { applied: false, proposal, status: await this.getCreatorSetupStatus(signal) };
    }
    if (proposal.libraryRoot !== undefined) {
      const info = await stat(proposal.libraryRoot).catch(() => undefined);
      if (info === undefined || !info.isDirectory()) {
        throw new Error(`library root is not a directory: ${proposal.libraryRoot}`);
      }
    }
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      if (proposal.libraryRoot !== undefined) overlay.libraryRoot = proposal.libraryRoot;
      const profile = overlay.profile ?? emptyProfile();
      if (proposal.enabledPlatforms !== undefined) {
        profile.enabledPlatforms = [...proposal.enabledPlatforms];
      }
      overlay.profile = profile;
      await saveOverlay(this.dataDir, overlay);
      this.rememberOverlay(overlay);
      if (proposal.libraryRoot !== undefined) {
        this.libraryRoot = proposal.libraryRoot;
        this.stopWatch();
      }
      this.invalidateCatalog();
    });
    return { applied: true, proposal, status: await this.getCreatorSetupStatus(signal) };
  }

  async setTopicNote(request: SetTopicNoteRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const item = await this.find(request.id);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    await writeTopicNote(item.folderPath, request.text);
    return this.getContent({ id: request.id }, signal);
  }

  async setScript(request: SetScriptRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const item = await this.find(request.id);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    if (request.folderPath !== undefined && request.folderPath !== item.folderPath) throw new Error("资料位置已切换，脚本草稿已保留，请重新打开对应内容。");
    signal.throwIfAborted();
    await writeScript(item.folderPath, request.text);
    return this.getContent({ id: request.id }, signal);
  }

  async organizeLibrary(request: OrganizeRequest, signal: AbortSignal): Promise<OrganizePreview> {
    signal.throwIfAborted();
    const overlay = await loadOverlay(this.dataDir);
    const libraryRoot = overlay.libraryRoot ?? this.libraryRoot;
    if (!request.apply) {
      return previewOrganize(libraryRoot, overlay, request.ids);
    }
    if ([...this.covers.active.keys()].some((folder) => dirname(folder) === libraryRoot)) throw new Error("资料库中有封面任务正在运行，请等待或取消后再整理目录。");
    const result = await applyOrganize(libraryRoot, overlay, request.ids);
    await withOverlayLock(this.dataDir, async () => {
      const latest = await loadOverlay(this.dataDir);
      await saveOverlay(this.dataDir, remapOverlayItems(latest, result.preview.moves, libraryRoot));
    });
    this.invalidateCatalog();
    return result.preview;
  }

  async refreshCatalog(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<ListContentsResult> {
    this.invalidateCatalog();
    return this.listContents({ query: "", filter: "all" }, signal);
  }

  async createContent(
    request: CreateContentRequest,
    signal: AbortSignal,
  ): Promise<CreateContentResult> {
    signal.throwIfAborted();
    const overlay = await loadOverlay(this.dataDir);
    const libraryRoot = request.libraryRoot === undefined ? overlay.libraryRoot : resolveUserPath(request.libraryRoot);
    if (libraryRoot === undefined) throw new Error("请先在内容工作台的系统目录选择器中确认资料位置。");
    const created = await createContentFolder(libraryRoot, request.title);
    this.invalidateCatalog();
    return created;
  }

  async setPublish(request: SetPublishRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const overlay = await loadOverlay(this.dataDir);
    const enabledPlatforms = overlay.profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms;
    if (!enabledPlatforms.includes(request.platform)) {
      throw new Error(`publish platform is disabled: ${request.platform}`);
    }
    return this.patchItem(request.id, (item) => {
      item.publish = patchOverlayPublish(item.publish, request.platform, request.status, request.url);
    }, signal, request.folderPath);
  }

  async syncPublish(request: SyncPublishRequest, signal: AbortSignal): Promise<SyncPublishResult> {
    signal.throwIfAborted();
    const configured = await loadOverlay(this.dataDir);
    const enabled = configured.profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms;
    if (request.platform && !enabled.includes(request.platform)) throw new Error(`publish platform is disabled: ${request.platform}`);
    const platforms = request.platform ? [request.platform] : enabled;
    const { items } = await this.scanned();
    const targets = request.id ? items.filter((item) => item.id === request.id) : items;
    if (request.id && !targets.length) throw new Error(`content not found: ${request.id}`);
    const result: SyncPublishResult = { matched: 0, platforms: [] };
    for (const platform of platforms) {
      let count = 0; const errors: string[] = [];
      for (const item of targets) {
        const startedAt = Date.now(), scope = { id: item.id, folderPath: item.folderPath };
        const started = await this.production.action({ ...scope, action: "refresh-metrics", platform }, signal);
        const task = [...started.tasks].reverse().find((row) => row.kind === "metrics");
        while (task && this.production.active.has(task.id) && Date.now() - startedAt < 185_000) {
          if (signal.aborted) this.production.active.get(task.id)?.controller.abort();
          signal.throwIfAborted();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (task && this.production.active.has(task.id)) throw new Error(`同步仍在后台处理，请查询原任务 ${task.id}，未另建任务。`);
        const latest = await this.production.state(scope);
        const matches = latest.metrics.filter((row) => row.platform === platform && row.state === "ok" && (row.syncedAt ?? 0) >= startedAt);
        count += matches.length;
        const finished = task && latest.tasks.find((row) => row.id === task.id);
        if (finished?.error) errors.push(finished.error);
      }
      result.matched += count;
      result.platforms.push({ platform, count, ...(errors.length ? { error: errors.join("；") } : {}) });
    }
    this.invalidateCatalog(); return result;
  }

  async openSubtitlePreview(
    request: IdRequest,
    signal: AbortSignal,
  ): Promise<SubtitlePreviewResult> {
    signal.throwIfAborted();
    const item = await this.find(request.id);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    const registryPath = previewRegistryPathForDataDir(this.dataDir);
    const recorded = livePreviewRecord(loadPreviewRegistry(registryPath), request.id);
    const existing = this.previews.get(request.id);
    const reusable = existing !== undefined && jobPidMatches(existing.pid, ["preview_editor"])
      ? existing
      : recorded;
    if (reusable !== undefined) {
      this.previews.set(request.id, reusable);
      await openExternalPath(reusable.url);
      return { url: reusable.url, port: reusable.port };
    }
    const skill = await this.subtitleSkill();
    const launch = await pickPreviewLaunch(item);
    const port = await findFreePort();
    const child = spawnPython(
      skill.python,
      join(skill.root, "scripts/preview_editor.py"),
      launch.args,
      { PREVIEW_EDITOR_PORT: String(port) },
    );
    const pid = child.pid;
    if (pid === undefined) throw new Error("preview failed to start");
    child.unref();
    const url = `http://127.0.0.1:${port}`;
    const record = { url, port, pid, id: request.id, startedAt: Date.now() };
    this.previews.set(request.id, record);
    upsertPreviewRecord(registryPath, record);
    try {
      await waitHttp(url, 8000, signal);
    } catch (cause) {
      try {
        await terminateOwnedProcess(pid, ["preview_editor"]);
      } catch {
        // Cleanup must still happen if the termination probe itself fails.
      }
      try {
        this.previews.delete(request.id);
      } finally {
        removePreviewRecord(registryPath, request.id);
      }
      throw cause;
    }
    await openExternalPath(url);
    return { url, port };
  }

  async startSubtitleBurn(request: IdRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const item = await this.find(request.id);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    if (item.burn.status === "running" && jobPidMatches(item.burn.pid, ["burn_subtitles.py"])) {
      return this.getContent({ id: request.id }, signal);
    }
    const skill = await this.subtitleSkill();
    const launch = await pickBurnLaunch(item);
    const child = spawnPython(
      skill.python,
      join(skill.root, "scripts/burn_subtitles.py"),
      launch.args,
    );
    const pid = child.pid;
    if (pid === undefined) throw new Error("burn failed to start");
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    const startedAt = Date.now();
    child.once("exit", (code) => {
      const burn: BurnJob = code === 0
        ? { status: "done", startedAt, output: launch.output }
        : {
          status: "error",
          startedAt,
          output: launch.output,
          error: stderr.trim() === "" ? `burn failed: ${code}` : stderr.trim(),
        };
      void this.patchItem(request.id, (next) => {
        next.burn = burn;
      }, new AbortController().signal).catch(() => undefined);
    });
    child.unref();
    return this.patchItem(request.id, (next) => {
      next.burn = { status: "running", startedAt, output: launch.output, pid };
    }, signal);
  }

  async startSubtitleGenerate(request: IdRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const detail = await this.getContent(request, signal);
    await this.production.action({ id: request.id, folderPath: detail.folderPath, action: "transcribe" }, signal);
    return this.getContent(request, signal);
  }

  async getProductionSettings(_request: Record<string, never>, signal: AbortSignal): Promise<ProductionSettingsView> { signal.throwIfAborted(); return this.production.settings(); }
  async productionSettingsAction(request: ProductionSettingsAction, signal: AbortSignal): Promise<ProductionSettingsView> { return this.production.settingsAction(request, signal); }
  async getProductionState(request: ContentScope, signal: AbortSignal): Promise<ProductionState> { signal.throwIfAborted(); return this.production.state(request); }
  async productionAction(request: ProductionAction, signal: AbortSignal): Promise<ProductionState> { return this.production.action(request, signal); }
  async getProductionPreview(request: ContentScope & { taskId?: string; articleFile?: string }, signal: AbortSignal): Promise<{ html: string; path: string }> { signal.throwIfAborted(); return this.production.preview(request, request, signal); }

  async startCoverGenerate(_request: IdRequest & { title?: string }, _signal: AbortSignal): Promise<ContentDetail> {
    throw new Error("请使用‘让 Agent 制作封面’；由 Harness 当前 Agent 分析后调用新的封面工具。");
  }

  async getCoverState(request: CoverScope, signal: AbortSignal): Promise<CoverState> { signal.throwIfAborted(); return this.covers.state(request); }
  async coverAction(request: CoverAction, signal: AbortSignal): Promise<CoverState> { return this.covers.action(request, signal); }
  async getCoverImage(request: CoverScope & { versionId: string }, signal: AbortSignal): Promise<{ mime: string; base64: string }> { signal.throwIfAborted(); return this.covers.image(request, request.versionId); }
  async getImageSettings(_request: Record<string, never>, signal: AbortSignal): Promise<ImageSettings> { signal.throwIfAborted(); return readImageSettings(this.dataDir); }
  async setImageSettings(request: { apiBase: string; model: string }, signal: AbortSignal): Promise<ImageSettings> { signal.throwIfAborted(); return saveImageSettings(this.dataDir, request); }
  async beginImageUpdate(request: { apiBase: string; model: string; revision: string; hasNewKey: boolean }, signal: AbortSignal): Promise<ImageSettings> { signal.throwIfAborted(); return beginImageUpdate(this.dataDir, request); }
  async completeImageUpdate(request: { token: string; keyUpdated: boolean }, signal: AbortSignal): Promise<ImageSettings> { signal.throwIfAborted(); if (!await resolveCreatorSecret(this.ctx, "cover")) throw new Error("请先保存生图 API Key。"); return completeImageUpdate(this.dataDir, request.token, request.keyUpdated); }
  async checkImageService(_request: Record<string, never>, signal: AbortSignal): Promise<ImageSettings> {
    const settings = await readImageSettings(this.dataDir);
    const key = await resolveCreatorSecret(this.ctx, "cover"); if (!key) throw new Error("请先保存生图 API Key。");
    const latest = await readImageSettings(this.dataDir);
    if (settings.pending || latest.pending || settings.revision !== latest.revision) throw new Error("生图设置更新未完成或已变化，请先保存。");
    try { const result = await checkImageConnection(settings, key, signal); return saveImageCheck(this.dataDir, result); }
    catch (error) { throw new Error(safeImageError(error, key)); }
  }

  async startChainedJob(
    id: string,
    field: "burn" | "subtitleJob" | "coverJob",
    launch: {
      python: string;
      steps: readonly GenerateStep[];
      env?: Record<string, string>;
    },
    signal: AbortSignal,
  ): Promise<ContentDetail> {
    const first = launch.steps[0];
    if (first === undefined) throw new Error(`${field} has no steps`);
    const finalOutput = launch.steps[launch.steps.length - 1]?.output ?? first.output;
    const startedAt = Date.now();
    const runStep = (index: number): number => {
      const step = launch.steps[index];
      if (step === undefined) throw new Error(`${field} step missing`);
      const child = spawnPython(launch.python, step.script, step.args, envForGenerateStep(step.env, launch.env));
      const pid = child.pid;
      if (pid === undefined) throw new Error(`${field} failed to start`);
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr = `${stderr}${String(chunk)}`.slice(-4000);
      });
      child.once("exit", (code) => {
        if (code !== 0) {
          const job: BurnJob = {
            status: "error",
            startedAt,
            output: step.output,
            error: stderr.trim() === "" ? `${field} failed: ${code}` : stderr.trim(),
          };
          void this.patchItem(id, (next) => {
            next[field] = job;
          }, new AbortController().signal).catch(() => undefined);
          return;
        }
        const nextStep = launch.steps[index + 1];
        if (nextStep !== undefined) {
          try {
            const nextPid = runStep(index + 1);
            void this.patchItem(id, (next) => {
              next[field] = { status: "running", startedAt, output: finalOutput, pid: nextPid };
            }, new AbortController().signal).catch(() => undefined);
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : `${field} failed`;
            void this.patchItem(id, (next) => {
              next[field] = { status: "error", startedAt, output: step.output, error: message };
            }, new AbortController().signal).catch(() => undefined);
          }
          return;
        }
        void this.patchItem(id, (next) => {
          next[field] = { status: "done", startedAt, output: finalOutput };
        }, new AbortController().signal).then(() => {
          if (field !== "subtitleJob") return;
          return this.openSubtitlePreview({ id }, new AbortController().signal);
        }, () => undefined).catch(() => undefined);
      });
      child.unref();
      return pid;
    };
    const pid = runStep(0);
    return this.patchItem(id, (next) => {
      next[field] = { status: "running", startedAt, output: finalOutput, pid };
    }, signal);
  }

  async startTrackedJob(
    id: string,
    field: "burn" | "subtitleJob" | "coverJob",
    launch: {
      python: string;
      script: string;
      args: readonly string[];
      output: string;
      env?: Record<string, string>;
    },
    signal: AbortSignal,
  ): Promise<ContentDetail> {
    const child = spawnPython(launch.python, launch.script, launch.args, launch.env);
    const pid = child.pid;
    if (pid === undefined) throw new Error(`${field} failed to start`);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    const startedAt = Date.now();
    child.once("exit", (code) => {
      const job: BurnJob = code === 0
        ? { status: "done", startedAt, output: launch.output }
        : {
          status: "error",
          startedAt,
          output: launch.output,
          error: stderr.trim() === "" ? `${field} failed: ${code}` : stderr.trim(),
        };
      void this.patchItem(id, (next) => {
        next[field] = job;
      }, new AbortController().signal).catch(() => undefined);
    });
    child.unref();
    return this.patchItem(id, (next) => {
      next[field] = { status: "running", startedAt, output: launch.output, pid };
    }, signal);
  }

  async waitForMediaJob(
    id: string,
    field: "burn" | "subtitleJob" | "coverJob",
    signal: AbortSignal,
  ): Promise<BurnJob> {
    while (true) {
      signal.throwIfAborted();
      const detail = await this.getContent({ id }, signal);
      const job = detail[field];
      if (job.status !== "running") return job;
      await sleep(400, signal);
    }
  }

  async cancelMediaJob(
    id: string,
    field: "burn" | "subtitleJob" | "coverJob",
  ): Promise<void> {
    const signal = new AbortController().signal;
    const detail = await this.getContent({ id }, signal);
    if (field === "subtitleJob" && this.production) {
      const state = await this.production.state({ id, folderPath: detail.folderPath });
      const task = [...state.tasks].reverse().find((row) => row.kind === "asr" && ["running", "queued"].includes(row.status));
      if (task) { await this.production.action({ id, folderPath: detail.folderPath, action: "cancel", taskId: task.id }, signal); return; }
    }
    const job = detail[field];
    if (job.status !== "running") return;
    await terminateOwnedProcess(job.pid, JOB_COMMAND[field]);
    await this.patchItem(id, (next) => {
      const current = next[field];
      if (current?.status !== "running" || current.pid !== job.pid) return;
      next[field] = {
        status: "error",
        ...(current.startedAt === undefined ? {} : { startedAt: current.startedAt }),
        ...(current.output === undefined ? {} : { output: current.output }),
        error: "cancelled",
      };
    }, signal);
  }

  async find(id: string) {
    const { items, overlay, libraryRoot } = await this.scanned();
    if (removedContentIds(overlay, libraryRoot).includes(id)) return undefined;
    return items.find((item) => item.id === id);
  }

  async saveVideoSelection(libraryRoot: string, id: string, name: string, allowRestore = true): Promise<void> {
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      if (removedContentIds(overlay, libraryRoot).includes(id)) throw new Error("项目已移除，导入文件保留但未更改选择。");
      if (!allowRestore && ((overlay.libraryRoot ?? this.libraryRoot) !== libraryRoot || overlay.hiddenVideos?.[libraryRoot]?.[id]?.some((n) => sameVideoName(n, name, process.platform === "win32")))) throw new Error("资料库或视频可见性已变化，请刷新后重选。");
      overlay.videoSelections ??= {};
      overlay.videoSelections[libraryRoot] ??= {};
      overlay.videoSelections[libraryRoot]![id] = name;
      const hidden = overlay.hiddenVideos?.[libraryRoot]?.[id];
      if (hidden) overlay.hiddenVideos![libraryRoot]![id] = hidden.filter((n) => !sameVideoName(n, name, process.platform === "win32"));
      await saveOverlay(this.dataDir, overlay);
      this.invalidateCatalog();
    });
  }

  async selectVideo(request: { id: string; name: string; folderPath: string }, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const { libraryRoot, items } = await this.scanned();
    const item = items.find((entry) => entry.id === request.id);
    if (item === undefined) throw new Error("内容已找不到，请刷新片库。");
    if (item.folderPath !== request.folderPath) throw new Error("资料库已切换，请重新打开对应内容。");
    const folder = await contentFolder(libraryRoot, item.folderPath);
    if (!item.videos?.some((v) => sameVideoName(v.name, request.name, process.platform === "win32"))) throw new Error("请先恢复这个视频，再选择使用。");
    await videoFile(folder, request.name);
    signal.throwIfAborted();
    await this.saveVideoSelection(libraryRoot, request.id, request.name, false);
    return this.getContent({ id: request.id }, signal);
  }

  async setVideoVisibility(request: { id: string; name: string; folderPath: string; hidden: boolean }, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const { libraryRoot, items } = await this.scanned();
    const item = items.find((v) => v.id === request.id);
    if (!item || item.folderPath !== request.folderPath) throw new Error("资料库或内容已切换，请重新打开。");
    const folder = await contentFolder(libraryRoot, item.folderPath);
    if (!request.hidden) await videoFile(folder, request.name);
    else if (!item.videos?.some((v) => sameVideoName(v.name, request.name, process.platform === "win32"))) throw new Error("视频已不在当前列表，请刷新。");
    await withOverlayLock(this.dataDir, async () => {
      signal.throwIfAborted();
      const overlay = await loadOverlay(this.dataDir);
      overlay.hiddenVideos ??= {}; overlay.hiddenVideos[libraryRoot] ??= {};
      if ((overlay.libraryRoot ?? this.libraryRoot) !== libraryRoot) throw new Error("资料库已切换，请重新打开。");
      const names = overlay.hiddenVideos[libraryRoot]![request.id] ?? [];
      const candidates = [...(item.videos ?? []), ...(item.hiddenVideos ?? []).filter((v) => !v.missing)].filter((v) => !names.some((n) => sameVideoName(n, v.name, process.platform === "win32")));
      const selected = resolveVideoSelection(candidates, overlay.videoSelections?.[libraryRoot]?.[request.id]).selectedVideo;
      overlay.hiddenVideos[libraryRoot]![request.id] = [...names.filter((n) => !sameVideoName(n, request.name, process.platform === "win32")), ...(request.hidden ? [request.name] : [])];
      if (request.hidden && selected && sameVideoName(selected, request.name, process.platform === "win32")) {
        overlay.videoSelections ??= {}; overlay.videoSelections[libraryRoot] ??= {}; overlay.videoSelections[libraryRoot]![request.id] = null;
      }
      await saveOverlay(this.dataDir, overlay); this.invalidateCatalog();
    });
    return this.getContent({ id: request.id }, signal);
  }

  async startVideoImport(request: VideoImportRequest, signal: AbortSignal): Promise<VideoImportState> {
    signal.throwIfAborted();
    const { libraryRoot, items } = await this.scanned();
    const item = items.find((entry) => entry.id === request.id);
    if (item === undefined) throw new Error("内容已找不到，请刷新片库。");
    if (item.folderPath !== request.folderPath) throw new Error("资料库已切换，请重新打开对应内容。");
    await contentFolder(libraryRoot, item.folderPath);
    const source = await realpath(request.sourcePath).catch(() => "");
    let existing: NonNullable<typeof item.hiddenVideos>[number] | undefined;
    for (const candidate of item.hiddenVideos ?? []) {
      const actual = await realpath(candidate.path).catch(() => "");
      if (!candidate.missing && actual && source && sameVideoName(actual, source, process.platform === "win32")) { existing = candidate; break; }
    }
    if (existing && (!request.name || sameVideoName(existing.name, request.name, process.platform === "win32"))) {
      await this.setVideoVisibility({ id: request.id, name: existing.name, folderPath: item.folderPath, hidden: false }, signal);
      await this.saveVideoSelection(libraryRoot, request.id, existing.name);
      return { token: `restored-${Date.now()}`, id: request.id, name: existing.name, status: "completed" };
    }
    signal.throwIfAborted();
    if (this.importJobs === undefined) throw new Error("后台任务服务尚未就绪，请等待工作台加载完成后重试。");
    return this.imports.start(this.importJobs, { ...request, folder: item.folderPath, libraryRoot }, async (name) => {
      await this.saveVideoSelection(libraryRoot, request.id, name);
    });
  }

  async getVideoImport(request: { token: string }, signal: AbortSignal): Promise<VideoImportState> {
    signal.throwIfAborted();
    return this.imports.get(request.token);
  }

  async cancelVideoImport(request: { token: string }, signal: AbortSignal): Promise<VideoImportState> {
    signal.throwIfAborted();
    return this.imports.cancel(request.token);
  }

  rememberOverlay(overlay: OverlayStore): void {
    this.cachedScriptRules = overlay.scriptRules;
    this.cachedEnabledPlatforms = overlay.profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms;
  }

  async settingsOf(
    libraryRoot: string,
    overlay: { profile?: LibrarySettings["profile"]; scriptRules?: string; libraryRoot?: string },
  ): Promise<LibrarySettings> {
    return {
      libraryRoot,
      libraryConfirmed: overlay.libraryRoot !== undefined,
      profile: overlay.profile ?? emptyProfile(),
      secrets: await describeCreatorSecrets(this.ctx),
      ...(overlay.scriptRules === undefined ? {} : { scriptRules: overlay.scriptRules }),
    };
  }

  async patchItem(
    id: string,
    mutate: (item: OverlayItem) => void,
    signal: AbortSignal,
    expectedFolder?: string,
  ): Promise<ContentDetail> {
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      const root = overlay.libraryRoot ?? this.libraryRoot;
      if (removedContentIds(overlay, root).includes(id)) throw new Error("项目已移除，请重新加入后操作。");
      if (expectedFolder && basename(await contentFolder(root, expectedFolder)) !== id) throw new Error("资料位置已变化，结果未写回。");
      const current = overlay.items[id] ?? {};
      const next = { ...current };
      mutate(next);
      overlay.items[id] = next;
      await saveOverlay(this.dataDir, overlay);
      this.invalidateCatalog();
    });
    return this.getContent({ id }, signal);
  }
}

function resolveUserPath(path: string): string {
  const expanded = expandHomePath(path);
  if (!isAbsolute(expanded)) throw new Error(`path must be absolute: ${path}`);
  return expanded;
}

function envForGenerateStep(
  kind: GenerateStep["env"],
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const key = kind === "subtitle"
    ? "DASHSCOPE_API_KEY"
    : kind === "cover"
      ? "DSH_CREATOR_IMAGE_API_KEY"
      : undefined;
  if (key === undefined || env === undefined || env[key] === undefined) return undefined;
  return { [key]: env[key] };
}

const JOB_FIELDS = ["burn", "subtitleJob", "coverJob"] as const;
const JOB_COMMAND = {
  burn: ["burn_subtitles.py"],
  subtitleJob: ["bailian_transcribe.py", "review_subtitles.py", "prepare_subtitles.py"],
  coverJob: ["generate_oil_cover.py"],
} as const;

function jobStarted(job: BurnJob): { startedAt?: number } {
  return job.startedAt === undefined ? {} : { startedAt: job.startedAt };
}

async function settleFinishedJob(job: BurnJob, field: (typeof JOB_FIELDS)[number]): Promise<BurnJob> {
  const output = job.output;
  const started = jobStarted(job);
  if (output !== undefined && await pathExists(output)) {
    return { status: "done", ...started, output };
  }
  return {
    status: "error",
    ...started,
    ...(output === undefined ? {} : { output }),
    error: `${field} process exited`,
  };
}

function recoverSubtitleJob(item: OverlayItem, job: BurnJob): BurnJob | undefined {
  if (job.status !== "error" || job.error !== "subtitleJob process exited") return undefined;
  const burn = item.burn;
  if (burn?.status === "running" && burn.pid !== undefined && jobPidMatches(burn.pid, JOB_COMMAND.burn)) {
    return {
      status: "running",
      ...jobStarted(job),
      ...jobStarted(burn),
      ...(burn.output === undefined ? {} : { output: burn.output }),
      pid: burn.pid,
    };
  }
  if (burn?.status === "done") {
    const output = burn.output ?? job.output;
    return {
      status: "done",
      ...jobStarted(job),
      ...jobStarted(burn),
      ...(output === undefined ? {} : { output }),
    };
  }
  return undefined;
}

async function reconcileOverlayBurns(overlay: OverlayStore): Promise<OverlayStore | undefined> {
  let dirty = false;
  const items: OverlayStore["items"] = { ...overlay.items };
  for (const [id, item] of Object.entries(overlay.items)) {
    let nextItem = items[id] ?? item;
    for (const field of JOB_FIELDS) {
      const job = nextItem[field];
      if (job === undefined) continue;
      if (field === "subtitleJob") {
        const recovered = recoverSubtitleJob(nextItem, job);
        if (recovered !== undefined) {
          nextItem = { ...nextItem, subtitleJob: recovered };
          dirty = true;
          continue;
        }
      }
      if (job.status !== "running") continue;
      if (jobPidMatches(job.pid, JOB_COMMAND[field])) continue;
      nextItem = { ...nextItem, [field]: await settleFinishedJob(job, field) };
      dirty = true;
    }
    items[id] = nextItem;
  }
  return dirty ? { ...overlay, items } : undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
