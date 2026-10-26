import type { ProjectView, ArticleEdit, ArticleSave } from "./projectView.ts";
import { queryProject } from "./production/projectQuery.ts";
import { articleSource, previewArticleEdit, saveArticleRevision } from "./production/articleEditing.ts";
import { hydrateCreations } from "./production/creations.ts";
import { readSettings } from "./production/storage.ts";
import { CoverWorkflow } from "./covers/workflow.ts";
import { ProductionWorkflow } from "./production/workflow.ts";
import { projectProduction } from "./production/projection.ts";
import { restoreProjectSessionMembership, verifyProjectSessionDirectory } from "./projectSessionsHost.ts";
import type { ContentScope, ProductionAction, ProductionSettingsAction, ProductionSettingsView, ProductionState } from "./production/types.ts";
import { creationImage } from "./production/creations.ts";
import { inside as creationFile } from "./production/storage.ts";
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
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { pathExists } from "./artifacts.ts";
import {
  countsOf,
  coverPathOf,
  folderDateAndTitle,
  matchesFilter,
  matchesQuery,
  readArticle,
  readPublishCopy,
  readSubtitleCues,
  readSubtitleText,
  readScript,
  readTopicNote,
  scanLibrary,
  scanProject,
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
import { applyOrganize, previewOrganize } from "./organize.ts";
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
import { startProjectWatch } from "./projectWatch.ts";
import { ProjectRegistry, directoryKey, projectOverlay, type ProjectsState, type ProjectRecord } from "./projects.ts";
import { emptyBurn, emptyPublish } from "./publishStatus.ts";
import { boundedRead } from "./fsReadDeadline.ts";
import { randomUUID } from "node:crypto";
import {
  emptyProfile,
  loadOverlay,
  normalizeEnabledPlatforms,
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
  cache: { libraryRoot: string; registryRevision?: number; items: Awaited<ReturnType<typeof scanLibrary>> } | undefined;
  cachedScriptRules: string | undefined;
  cachedEnabledPlatforms: string[] | undefined;
  projects: ProjectRegistry | undefined;
  projectsReady: Promise<void> | undefined;
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
      resolve: async (scope) => { const detail = await this.getContent({ id: scope.id, folderPath: scope.folderPath }, new AbortController().signal); if (directoryKey(detail.folderPath) !== directoryKey(await realpath(scope.folderPath))) throw new Error("资料位置已切换，请重新打开内容。"); return detail; },
      key: (ref) => resolveWorkbenchCredential(this.ctx, ref), hasKey: (ref) => workbenchCredentialConfigured(this.ctx, ref), setKey: (ref, value) => saveWorkbenchCredential(this.ctx, ref, value), jobs: () => this.importJobs, changed: () => this.invalidateCatalog(),
    });
    this.covers = new CoverWorkflow({ dataDir: this.dataDir,
      resolve: async (scope) => {
        const detail = await this.getContent({ id: scope.id, folderPath: scope.folderPath }, new AbortController().signal);
        if (directoryKey(detail.folderPath) !== directoryKey(await realpath(scope.folderPath))) throw new Error("资料位置已切换，请重新打开内容。");
        return { folder: await contentFolder(dirname(detail.folderPath), detail.folderPath), ...(detail.selectedVideo ? { selectedVideo: detail.selectedVideo } : {}), title: detail.title, script: detail.script, transcript: detail.subtitles.srt ? (await readSubtitleText(detail)).slice(0, 30000) : "" };
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

  projectRegistry(): ProjectRegistry { return this.projects ??= new ProjectRegistry(this.dataDir); }

  async projectState(): Promise<ProjectsState> {
    const registry = this.projectRegistry();
    this.projectsReady ??= loadOverlay(this.dataDir).then(overlay => registry.initialize(overlay, this.libraryRoot)).then(() => undefined).catch(error => { this.projectsReady = undefined; throw error; });
    await this.projectsReady;
    const state = await registry.read(); if (!state) throw new Error("项目记录已丢失，请保留现场并检查后重试。"); if (state.defaultParent) this.libraryRoot = state.defaultParent; return state;
  }

  ensureWatch(state: ProjectsState): void {
    const signature = JSON.stringify([state.locations.map(p => p.path), state.projects.filter(p => !p.removed).map(p => p.path)]);
    if (this.watchedRoot === signature && this.watchClose !== undefined) return;
    this.stopWatch(); this.watchedRoot = signature;
    mkdirSync(this.dataDir, { recursive: true });
    this.watchClose = startProjectWatch({ parents: state.locations.map(p => p.path), projects: state.projects.filter(p => !p.removed).map(p => p.path), dataDir: this.dataDir,
      onChange: () => this.invalidateCatalog(),
      onDiscover: async () => { await this.projectRegistry().discover(); this.invalidateCatalog(); },
    }).close;
  }

  subtitleSkill(): Promise<{ root: string; python: string }> {
    return resolveSubtitleSkill(this.subtitleSkillDir());
  }

  coverSkill(): Promise<{ root: string; python: string; script: string }> {
    return resolveCoverSkill(this.coverSkillDir());
  }

  async scanned(_reconcile = true) {
    const [overlay, registry] = await Promise.all([loadOverlay(this.dataDir), this.projectState()]);
    const libraryRoot = registry.defaultParent ?? overlay.libraryRoot ?? this.libraryRoot;
    this.rememberOverlay(overlay); this.ensureWatch(registry);
    if (this.cache?.registryRevision === registry.revision && this.cache.libraryRoot === libraryRoot) return { overlay, libraryRoot, items: this.cache.items, registry };
    const revision = this.catalogRevision;
    const productionSettings = await readSettings(this.dataDir);
    const items = await Promise.all(registry.projects.map(async project => {
      try {
        return await boundedRead((async () => {
          await this.projectRegistry().locate(project);
          const item = await scanProject(project.path, project.id, projectOverlay(project, overlay));
          if (!item) throw new Error("项目文件夹暂不可访问。");
          return { ...await projectProduction(item, this.dataDir, productionSettings), title: project.item.title ?? folderDateAndTitle(project.name).title, directoryAliases: project.pathAliases, directoryRevision: project.revision };
        })(), 8000);
      } catch (error) {
        return { id: project.id, folderPath: project.path, title: project.item.title ?? folderDateAndTitle(project.name).title, directoryAliases: project.pathAliases, directoryRevision: project.revision,
          recordedAt: project.addedAt, createdMs: project.addedAt, covers: {}, subtitles: {}, tags: [], hasArticle: false, hasPublishPackage: false,
          pipeline: "raw" as const, workflow: "idle" as const, publish: emptyPublish(), burn: emptyBurn(), subtitleJob: emptyBurn(), coverJob: emptyBurn(),
          accessError: error instanceof Error ? error.message : "项目暂不可访问，请重试。" };
      }
    }));
    items.sort((a,b) => b.recordedAt - a.recordedAt || b.createdMs - a.createdMs || a.folderPath.localeCompare(b.folderPath));
    if (revision === this.catalogRevision) this.cache = { libraryRoot, registryRevision: registry.revision, items };
    return { overlay, libraryRoot, items, registry };
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
    const { overlay, libraryRoot, items: scanned, registry } = await this.scanned();
    const hidden = new Set(registry.projects.filter(p => p.removed).map(p => p.id));
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

  async projectAction(request: { id: string; folderPath: string; action: "inspect" | "remove" | "join"; cancelTasks?: boolean }, signal: AbortSignal): Promise<{ tasks: string[]; removed: boolean; directoryAliases?: string[] }> {
    signal.throwIfAborted();
    await this.projectState();
    if (request.action === "join") { await this.addProject({ path: request.folderPath }, signal); return { tasks: [], removed: false }; }
    const registry = await this.projectState();
    const project = this.projectRegistry().resolve(registry, request.id, request.folderPath, true);
    if (!project) throw new Error("项目未加入工作台。");
    let accessible = true;
    try { await this.projectRegistry().locate(project); } catch { accessible = false; }
    const folder = project.path;
    const aliasChecks = await Promise.all(project.pathAliases.map(async path => {
      try { return directoryKey(await boundedRead(realpath(path))) === project.key ? path : undefined; }
      catch { return path; } // Known offline paths remain historical identities.
    }));
    const directoryAliases = aliasChecks.filter((path): path is string => Boolean(path));
    const production = accessible ? await readState(folder) : undefined, cover = accessible ? await readCoverState(folder) : undefined;
    const tasks = (production?.tasks ?? []).filter((t) => ["queued", "running", "waiting-agent"].includes(t.status)).map((t) => t.step ?? ({ upload: "上传视频", article: "文章制作", asr: "语音转文字", metrics: "同步数据", wechat: "公众号草稿", images: "制作图片" }[t.kind]));
    tasks.push(...(cover?.runs ?? []).filter((r) => ["preparing", "running"].includes(r.status) || r.status === "waiting_agent" && Boolean(r.deliveredAt || r.frames.length)).map((r) => r.status === "waiting_agent" ? "封面制作请求" : "封面制作"));
    const imports = [...this.imports.tasks.values()].filter((t) => t.folder === folder && t.state.status === "running");
    tasks.push(...imports.map(() => "导入视频"));
    if (!accessible) tasks.push("目录暂不可访问，历史任务结果保留待核对");
    if (request.action === "inspect") return { tasks, removed: project.removed, directoryAliases };
    if (tasks.length && !request.cancelTasks) throw new Error("项目仍有任务，请确认‘取消任务并移除’。");
    // Persist the admission barrier first, including when a later host cleanup fails.
    await this.projectRegistry().update(state => { const p = this.projectRegistry().resolve(state, project.id, folder, true); if (!p) throw new Error("项目未找到。"); p.removed = true; }); this.invalidateCatalog();
    for (const task of this.production?.active.values() ?? []) if (task.folder === folder) task.controller.abort();
    this.covers?.active.get(folder)?.controller.abort();
    for (const task of imports) task.controller.abort();
    const stoppingDeadline = Date.now() + 10_000;
    const stillRunning = () => [...(this.production?.active.values() ?? [])].some((task) => task.folder === folder) || this.covers?.active.has(folder) || imports.some((task) => task.state.status === "running");
    while (stillRunning() && Date.now() < stoppingDeadline) { signal.throwIfAborted(); await new Promise((resolve) => setTimeout(resolve, 50)); }
    if (stillRunning()) throw new Error("项目已停止接收新任务，部分本地任务尚未确认结束。请稍后重试移除；现有文件和远端结果保留。");
    if (accessible && production?.tasks.some(task => ["queued", "running", "waiting-agent"].includes(task.status))) await updateState(folder, (state) => { for (const task of state.tasks) if (["queued", "running", "waiting-agent"].includes(task.status)) { task.status = task.status === "running" && (task.kind === "upload" || task.kind === "wechat") ? "unconfirmed" : "cancelled"; task.error = "项目已移除；已完成文件保留，远端结果未撤回。"; task.updatedAt = Date.now(); } });
    if (accessible && cover?.runs.some(run => ["waiting_agent", "preparing", "running"].includes(run.status))) await coverLock(folder, async () => { const state = await readCoverState(folder); for (const run of state.runs) if (["waiting_agent", "preparing", "running"].includes(run.status)) { run.status = this.covers.active.has(folder) ? "unconfirmed" : "cancelled"; run.updatedAt = Date.now(); } await writeCoverState(folder, state); });
    this.videos.get(project.id)?.close(); this.videos.delete(project.id);
    this.articles?.get(project.id)?.close(); this.articles?.delete(project.id);
    this.invalidateCatalog();
    return { tasks, removed: true, directoryAliases };
  }

  async restoreProjectSession(request: { id: string; folderPath: string; sessionId: string }, signal: AbortSignal): Promise<Record<string, never>> {
    const detail = await this.getContent({ id: request.id, folderPath: request.folderPath }, signal);
    const folder = await contentFolder(dirname(detail.folderPath), request.folderPath);
    if (await realpath(detail.folderPath) !== await realpath(folder)) throw new Error("项目位置已变化，请刷新后重新加入。");
    await restoreProjectSessionMembership(this.ctx, request.folderPath, request.sessionId, signal);
    return {};
  }

  async getContent(request: IdRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const found = await this.find(request.id, request.folderPath);
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
    const item = await this.find(folderId, request.folderPath);
    const path = ratio === "3x4" || ratio === "4x3" || ratio === "16x9"
      ? item?.covers[ratio]
      : item === undefined ? undefined : coverPathOf(item);
    return coverThumb(this.dataDir, `${item?.id ?? folderId}::${ratio ?? ""}`, path);
  }

  async getVideoPlayback(request: IdRequest, signal: AbortSignal): Promise<VideoPlaybackResult> {
    signal.throwIfAborted();
    const item = await this.find(request.id, "folderPath" in request ? request.folderPath : undefined);
    const picked = item === undefined ? undefined : playbackOf(item);
    if (picked === undefined) return { found: false, url: "", kind: "raw" };
    const existing = this.videos.get(item!.id);
    if (existing !== undefined && existing.path === picked.path) {
      return { found: true, url: existing.url, kind: picked.kind };
    }
    existing?.close();
    const session = await startVideoServer(picked.path);
    this.videos.set(item!.id, { url: session.url, path: picked.path, close: session.close });
    return { found: true, url: session.url, kind: picked.kind };
  }

  async getArticleMedia(request: IdRequest, signal: AbortSignal): Promise<ArticleMediaResult> {
    signal.throwIfAborted();
    const item = await this.getContent(request, signal);
    if (item?.articlePath === undefined) return { found: false, origin: "" };
    const root = dirname(item.articlePath);
    const existing = this.articles.get(item.id);
    if (existing !== undefined && existing.root === root) {
      return { found: true, origin: existing.origin };
    }
    existing?.close();
    const session = await startArticleServer(root);
    this.articles.set(item.id, { origin: session.origin, root, close: session.close });
    return { found: true, origin: session.origin };
  }

  async getSubtitleText(request: IdRequest, signal: AbortSignal): Promise<SubtitleTextResult> {
    signal.throwIfAborted();
    const found = await this.find(request.id, "folderPath" in request ? request.folderPath : undefined);
    const item = found ? await projectProduction(found, this.dataDir) : undefined;
    if (item === undefined) return { text: "", cues: [] };
    const cues = await readSubtitleCues(item);
    const text = cues.length > 0 ? cues.map((cue) => cue.text).join("\n") : await readSubtitleText(item);
    return { text, cues };
  }

  async openContentPath(request: { path: string }, signal: AbortSignal): Promise<Record<string, never>> {
    signal.throwIfAborted();
    const state = await this.projectState(), target = await realpath(request.path);
    let allowed = false;
    for (const p of state.projects.filter(p => !p.removed)) {
      try { const root = await this.projectRegistry().locate(p), rel = relative(root, target); if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) { allowed = true; break; } } catch { /* Isolated unavailable project. */ }
    }
    if (!allowed) throw new Error("只能打开已加入项目中的文件。");
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

  async getProjectLocations(_request: Record<string, never>, signal: AbortSignal): Promise<import("./types.ts").ProjectLocationsView> {
    signal.throwIfAborted(); const state = await this.projectState();
    return { libraryRoot: state.defaultParent ?? this.libraryRoot, libraryConfirmed: state.defaultParent !== undefined, projectLocations: state.locations.map(p => ({ path: p.path })) };
  }
  async setProjectLocation(request: SetLibraryRootRequest, signal: AbortSignal): Promise<import("./types.ts").ProjectLocationsView> {
    signal.throwIfAborted(); await this.projectState();
    await this.projectRegistry().setDefault(resolveUserPath(request.path)); this.invalidateCatalog();
    return this.getProjectLocations({}, signal);
  }
  async setLibraryRoot(request: SetLibraryRootRequest, signal: AbortSignal): Promise<LibrarySettings> {
    await this.setProjectLocation(request, signal); return this.getSettings({}, signal);
  }

  async addProject(request: { path: string }, signal: AbortSignal): Promise<CreateContentResult> {
    signal.throwIfAborted(); await this.projectState();
    const project = await this.projectRegistry().join(resolveUserPath(request.path));
    this.invalidateCatalog(); return { id: project.id, folderPath: project.path, directoryAliases: project.pathAliases };
  }

  async recoverProject(request: { folderPath: string; sessionId: string }, signal: AbortSignal): Promise<CreateContentResult> {
    await this.projectState();
    await verifyProjectSessionDirectory(this.ctx, request.folderPath, request.sessionId, signal);
    const project = await this.projectRegistry().recover(request.folderPath);
    this.invalidateCatalog(); return { id: project.id, folderPath: project.path, directoryAliases: project.pathAliases };
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
    if (proposal.libraryRoot !== undefined) await this.setLibraryRoot({ path: proposal.libraryRoot }, signal);
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
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
    const item = await this.find(request.id, "folderPath" in request ? request.folderPath : undefined);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    if (request.folderPath && directoryKey(await boundedRead(realpath(request.folderPath))) !== directoryKey(item.folderPath)) throw new Error("资料位置已切换，草稿已保留，请重新打开对应项目。");
    await writeTopicNote(item.folderPath, request.text);
    return this.getContent({ id: item.id, folderPath: item.folderPath }, signal);
  }

  async setScript(request: SetScriptRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const item = await this.find(request.id, "folderPath" in request ? request.folderPath : undefined);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    if (request.folderPath && directoryKey(await boundedRead(realpath(request.folderPath))) !== directoryKey(item.folderPath)) throw new Error("资料位置已切换，草稿已保留，请重新打开对应项目。");
    signal.throwIfAborted();
    await writeScript(item.folderPath, request.text);
    return this.getContent({ id: item.id, folderPath: item.folderPath }, signal);
  }

  async organizeLibrary(request: OrganizeRequest, signal: AbortSignal): Promise<OrganizePreview> {
    signal.throwIfAborted();
    const registry = await this.projectState();
    const root = request.libraryRoot ? resolveUserPath(request.libraryRoot) : registry.defaultParent;
    if (!root || request.apply && !request.libraryRoot) throw new Error("请明确要整理的父目录；其他保存位置的项目不会参与。");
    const actual = await realpath(root);
    const projects = registry.projects.filter(p => !p.removed && directoryKey(dirname(p.path)) === directoryKey(actual));
    const selected = request.ids.length ? request.ids.map(id => this.projectRegistry().resolve(registry, id)).filter((p): p is ProjectRecord => Boolean(p)) : projects;
    if (selected.some(p => !projects.some(row => row.id === p.id))) throw new Error("所选项目不在本次整理的父目录中。");
    if (!selected.length) return { moves: [], unchanged: 0 };
    const scoped: OverlayStore = { schemaVersion: 1, items: Object.fromEntries(projects.map(p => [basename(p.path), p.item])) };
    const names = selected.map(p => basename(p.path));
    if (!request.apply) return previewOrganize(actual, scoped, names);
    // A rename is explicit and limited to this parent. Running/uncertain tasks
    // retain their exact directory and must be resolved before moving files.
    for (const p of selected) {
      if (registry.projects.some(other => other.id !== p.id && !other.removed && (() => { const rel = relative(p.path, other.path); return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"); })())) throw new Error("所选目录包含另一个已登记项目，请分别处理，避免改变子项目任务的位置。");
      if ([...(this.production?.active.values() ?? [])].some(task => task.folder === p.path) || this.covers?.active.has(p.path) || [...(this.imports?.tasks.values() ?? [])].some(task => task.folder === p.path && task.state.status === "running")) throw new Error("项目仍有任务正在运行，请先处理后再整理目录。");
      const state = await readState(p.path), covers = await readCoverState(p.path);
      if (state.tasks.some(t => ["running","queued","waiting-agent","unconfirmed"].includes(t.status)) || covers.runs.some(r => ["running","preparing","waiting_agent","unconfirmed"].includes(r.status))) throw new Error("所选项目仍有运行或待核对任务，请先处理后再整理目录。");
    }
    const result = await applyOrganize(actual, scoped, names);
    try {
      await this.projectRegistry().update(state => {
        for (const move of result.preview.moves) {
          const before = join(actual, move.from), after = join(actual, move.to);
          for (const p of state.projects) {
            const rel = relative(before, p.path);
            if (isAbsolute(rel) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../")) continue;
            p.path = join(after, rel); p.key = directoryKey(p.path); p.sourcePath = p.path; p.pathAliases = [p.path];
            p.aliases = [...new Set([...p.aliases, basename(p.path)])]; p.name = basename(p.path); p.parent = dirname(p.path); p.revision = randomUUID();
          }
        }
      });
    } catch (error) { throw new Error("文件夹已整理，项目记录未完成更新；请保留原记录并通过新位置重新加入。", { cause: error }); }
    this.invalidateCatalog(); return result.preview;
  }

  async refreshCatalog(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<ListContentsResult> {
    await this.projectState(); await this.projectRegistry().discover();
    this.invalidateCatalog();
    return this.listContents({ query: "", filter: "all" }, signal);
  }

  async createContent(
    request: CreateContentRequest,
    signal: AbortSignal,
  ): Promise<CreateContentResult> {
    signal.throwIfAborted();
    const state = await this.projectState();
    const parent = request.libraryRoot === undefined ? state.defaultParent : resolveUserPath(request.libraryRoot);
    if (!parent) throw new Error("请选择这次项目的保存位置。");
    const created = await this.projectRegistry().create(parent, request.title, request.requestId ?? randomUUID());
    this.invalidateCatalog(); return { id: created.id, folderPath: created.path, directoryAliases: created.pathAliases };
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
    const item = await this.find(request.id, request.folderPath);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    const registryPath = previewRegistryPathForDataDir(this.dataDir);
    const recorded = livePreviewRecord(loadPreviewRegistry(registryPath), item.id);
    const existing = this.previews.get(item.id);
    const reusable = existing !== undefined && jobPidMatches(existing.pid, ["preview_editor"])
      ? existing
      : recorded;
    if (reusable !== undefined) {
      this.previews.set(item.id, reusable);
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
    const record = { url, port, pid, id: item.id, startedAt: Date.now() };
    this.previews.set(item.id, record);
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
        this.previews.delete(item.id);
      } finally {
        removePreviewRecord(registryPath, item.id);
      }
      throw cause;
    }
    await openExternalPath(url);
    return { url, port };
  }

  async startSubtitleBurn(request: IdRequest, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const item = await this.find(request.id, request.folderPath);
    if (item === undefined) throw new Error(`content not found: ${request.id}`);
    if (item.burn.status === "running" && jobPidMatches(item.burn.pid, ["burn_subtitles.py"])) {
      return this.getContent({ id: item.id }, signal);
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
      void this.patchItem(item.id, (next) => {
        next.burn = burn;
      }, new AbortController().signal).catch(() => undefined);
    });
    child.unref();
    return this.patchItem(item.id, (next) => {
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
  async getProjectView(request: { id: string; folderPath?: string }, signal: AbortSignal): Promise<ProjectView> {
    signal.throwIfAborted();
    const item = await this.find(request.id, request.folderPath);
    if (!item) throw new Error("项目位置已变化，请重新打开。");
    const config = await readSettings(this.dataDir);
    const accountIds = Object.fromEntries(Object.entries(config.accounts).map(([p,a]) => [p,a?.id]));
    if (config.wechat.appid) accountIds["official-account"] = config.wechat.appid;
    return { ...await queryProject(item, () => this.covers.load(item.folderPath)), accountIds, settingsRevision: config.revision };
  }
  async reconcileProject(request: ContentScope, signal: AbortSignal): Promise<Record<string, never>> {
    await this.reconcileLegacyJobs();
    await this.getProjectView(request, signal);
    await this.production.reconcile(request); await this.covers.state(request); return {};
  }
  async getPublicationContent(request: ContentScope & { publicationId: string; revision: number }, signal: AbortSignal) {
    const view = await this.getProjectView(request, signal);
    const full = await readState(view.detail.folderPath);
    const publication = full.publications?.find(p => p.id === request.publicationId && !p.hidden);
    if (!publication || publication.revision !== request.revision) throw new Error("发布材料已变化，请重新读取。");
    const result = (await hydrateCreations(request.folderPath, { ...full, publications: [publication] })).publications![0]!;
    if (publication.source?.articleId && view.production.articles.some(a => a.parentArticleId === publication.source!.articleId)) result.sourceChanged = true;
    return result;
  }
  async readArticleSource(request: ContentScope & { articleId: string }, signal: AbortSignal) {
    const view = await this.getProjectView(request, signal);
    return articleSource(view.detail.folderPath, request.articleId, view.detail.articlePath);
  }
  async previewArticleDraft(request: ArticleEdit, signal: AbortSignal) {
    const view = await this.getProjectView(request, signal), settings = await readSettings(this.dataDir);
    return previewArticleEdit(this.dataDir, view.detail.folderPath, request, settings.wechat.theme, signal, view.detail.articlePath);
  }
  async saveArticleRevision(request: ArticleSave, signal: AbortSignal) {
    const view = await this.getProjectView(request, signal), settings = await readSettings(this.dataDir);
    const saved = await saveArticleRevision(this.dataDir, view.detail.folderPath, request, settings.wechat.theme, signal, () => this.getProjectView(request, signal), view.detail.articlePath);
    this.invalidateCatalog(); return saved;
  }
  async getProductionState(request: ContentScope, signal: AbortSignal): Promise<ProductionState> { signal.throwIfAborted(); return this.production.state(request); }
  async getCreationImage(request: ContentScope & { imageId: string }, signal: AbortSignal): Promise<{ mime: string; base64: string }> {
    await this.production.host.resolve(request); signal.throwIfAborted(); const { image, file } = await creationImage(request.folderPath, request.imageId);
    return { mime: image.mime, base64: (await readFile(file)).toString("base64") };
  }
  async getCreationText(request: ContentScope & { file: string }, signal: AbortSignal): Promise<{ text: string }> {
    const detail = await this.production.host.resolve(request), state = await readState(detail.folderPath); signal.throwIfAborted();
    const file = await creationFile(detail.folderPath, request.file);
    const allowed = [...state.articles.map(a => a.file), ...(state.publications ?? []).map(p => p.bodyFile), ...(detail.articlePath ? [detail.articlePath] : [])];
    if (!(await Promise.all(allowed.map(name => creationFile(detail.folderPath, name).catch(() => "")))).includes(file)) throw new Error("请选择本项目已登记的正文。");
    return { text: await readFile(file, "utf8") };
  }
  async productionAction(request: ProductionAction, signal: AbortSignal): Promise<ProductionState> { return this.production.action(request, signal); }
  async getProductionPreview(request: ContentScope & import("./production/types.ts").ProductionPreviewRequest, signal: AbortSignal): Promise<{ html: string; path: string }> { signal.throwIfAborted(); return this.production.preview(request, request, signal); }

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

  async reconcileLegacyJobs(): Promise<void> {
    await this.projectState();
    await this.projectRegistry().update(async state => {
      for (const p of state.projects.filter(p => !p.removed)) {
        const current: OverlayStore = { schemaVersion: 1, items: { [p.id]: p.item } };
        const next = await reconcileOverlayBurns(current); if (next?.items[p.id]) p.item = next.items[p.id]!;
      }
    });
    this.invalidateCatalog();
  }

  async find(id: string, folderPath?: string) {
    const { items, registry } = await this.scanned(false);
    const project = this.projectRegistry().resolve(registry, id, folderPath);
    const item = project && items.find(item => item.id === project.id);
    if (item?.accessError) throw new Error(`项目暂不可访问：${item.accessError}`);
    return item;
  }

  async saveVideoSelection(folder: string, id: string, name: string, allowRestore = true): Promise<void> {
    await this.projectRegistry().mutate(id, folder, p => {
      if (!allowRestore && p.hiddenVideos.some(n => sameVideoName(n, name, process.platform === "win32"))) throw new Error("视频已移除，请重新导入后选择。");
      p.selectedVideo = name; p.hiddenVideos = p.hiddenVideos.filter(n => !sameVideoName(n, name, process.platform === "win32"));
    });
    this.invalidateCatalog();
  }

  async selectVideo(request: { id: string; name: string; folderPath: string }, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const item = await this.find(request.id, request.folderPath);
    if (!item) throw new Error("项目未找到，请刷新。");
    const folder = await contentFolder(dirname(item.folderPath), item.folderPath);
    if (!item.videos?.some(v => sameVideoName(v.name, request.name, process.platform === "win32"))) throw new Error("请先重新导入这个视频，再选择使用。");
    await videoFile(folder, request.name); signal.throwIfAborted();
    await this.saveVideoSelection(folder, item.id, request.name, false);
    return this.getContent({ id: item.id }, signal);
  }

  async setVideoVisibility(request: { id: string; name: string; folderPath: string; hidden: boolean }, signal: AbortSignal): Promise<ContentDetail> {
    signal.throwIfAborted();
    const item = await this.find(request.id, request.folderPath);
    if (!item) throw new Error("项目未找到，请刷新。");
    const folder = await contentFolder(dirname(item.folderPath), item.folderPath);
    if (!request.hidden) await videoFile(folder, request.name);
    else if (!item.videos?.some(v => sameVideoName(v.name, request.name, process.platform === "win32"))) throw new Error("视频已不在当前列表，请刷新。");
    await this.projectRegistry().mutate(item.id, folder, p => {
      signal.throwIfAborted();
      const candidates = [...(item.videos ?? []), ...(item.hiddenVideos ?? []).filter(v => !v.missing)].filter(v => !p.hiddenVideos.some(n => sameVideoName(n, v.name, process.platform === "win32")));
      const selected = resolveVideoSelection(candidates, p.selectedVideo).selectedVideo;
      p.hiddenVideos = [...p.hiddenVideos.filter(n => !sameVideoName(n, request.name, process.platform === "win32")), ...(request.hidden ? [request.name] : [])];
      if (request.hidden && selected && sameVideoName(selected, request.name, process.platform === "win32")) p.selectedVideo = null;
    });
    this.invalidateCatalog(); return this.getContent({ id: item.id }, signal);
  }

  async startVideoImport(request: VideoImportRequest, signal: AbortSignal): Promise<VideoImportState> {
    signal.throwIfAborted();
    const item = await this.find(request.id, request.folderPath);
    if (!item) throw new Error("项目未找到，请刷新。");
    const folder = await contentFolder(dirname(item.folderPath), item.folderPath);
    const source = await realpath(request.sourcePath).catch(() => "");
    const existing = (item.hiddenVideos ?? []).find(candidate => !candidate.missing && directoryKey(candidate.path) === directoryKey(source));
    if (existing && (!request.name || sameVideoName(existing.name, request.name, process.platform === "win32"))) {
      await this.setVideoVisibility({ id: item.id, name: existing.name, folderPath: folder, hidden: false }, signal);
      await this.saveVideoSelection(folder, item.id, existing.name);
      return { token: `restored-${Date.now()}`, id: item.id, name: existing.name, status: "completed" };
    }
    signal.throwIfAborted();
    if (!this.importJobs) throw new Error("后台任务服务尚未就绪，请等待工作台加载完成后重试。");
    return this.imports.start(this.importJobs, { ...request, id: item.id, folder, libraryRoot: dirname(folder) }, async name => { await this.saveVideoSelection(folder, item.id, name); });
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
    const registry = await this.projectState();
    return {
      libraryRoot: registry.defaultParent ?? libraryRoot,
      libraryConfirmed: registry.defaultParent !== undefined,
      projectLocations: registry.locations.map(p => ({ path: p.path })),
      profile: overlay.profile ?? emptyProfile(),
      secrets: await describeCreatorSecrets(this.ctx),
      ...(overlay.scriptRules === undefined ? {} : { scriptRules: overlay.scriptRules }),
    };
  }

  async patchItem(id: string, mutate: (item: OverlayItem) => void, signal: AbortSignal, expectedFolder?: string): Promise<ContentDetail> {
    await this.projectState();
    const project = this.projectRegistry().resolve(await this.projectState(), id, expectedFolder);
    if (!project) throw new Error("项目未找到，请刷新。");
    await this.projectRegistry().mutate(project.id, project.path, p => { signal.throwIfAborted(); mutate(p.item); });
    this.invalidateCatalog(); return this.getContent({ id: project.id }, signal);
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
