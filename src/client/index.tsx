import type { ProjectView, ArticleSource, ArticleEdit, ArticleSave, ArticleSaved } from "../projectView.ts";
import type { CoverScope, CoverAction, CoverState, ImageSettings } from "../covers/types.ts";
import type { ContentScope, ProductionAction, ProductionSettingsAction, ProductionSettingsView, ProductionState } from "../production/types.ts";
import { prepareCoverRequest } from "./coverRequests.ts";
import { browserCreatorStorage, loadCreatorUiState } from "./persistence.ts";
import { projectRecovery } from "./projectRecovery.ts";
import { prepareBusinessRequest, sameFolder } from "./workbench.ts";
import { removeProjectWithHost, planProjectCleanup, restoreProjectSessions, reconcileRemovedProjects } from "./projectCleanup.ts";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";

import { TYPERT_REMOTE } from "../remote.ts";
import { startLibraryLiveSync } from "./catalogSync.ts";
import { remountPluginCss, releasePluginCss } from "./pluginCss.ts";
import { registerContentTriggers } from "./contentTriggers.ts";
import type {
  VideoImportState,
  ContentDetail,
  ContentFilter,
  CoverThumbResult,
  CreateContentResult,
  CreatorCapabilities,
  CreatorProfile,
  LibrarySettings,
  ListContentsResult,
  PublishMark,
  PublishPlatform,
  SubtitlePreviewResult,
  SyncPublishResult,
  ArticleMediaResult,
  VideoPlaybackResult,
} from "../types.ts";
import {
  bumpLibrary,
  bumpProfile,
  captureContentSelection,
  setSelectedContentId,
} from "./contentSelection.ts";
import { credentialsOf } from "./credentialsApi.ts";
import type { CreatorViewFace } from "./face.ts";
import { en, NS, type CreatorKey, zh } from "./locales.ts";
import { CreatorWorkbench } from "./CreatorWorkbench.tsx";
import { captureWorkbenchNavigation, desktopWorkbenchesOf, pickCreatorDirectory, prepareCoverDraft } from "./workbench.ts";
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dsh.creator.workbench": CreatorKey;
  }
}

interface RemoteAnswer<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}

interface CreatorWorkbenchRemote {
  getProjectView: (request: { id: string; folderPath?: string }) => Promise<RemoteAnswer<ProjectView>>;
  reconcileProject: (request: ContentScope) => Promise<RemoteAnswer<Record<string, never>>>;
  getPublicationContent: (request: ContentScope & { publicationId: string; revision: number }) => Promise<RemoteAnswer<import("../production/types.ts").PublicationDraft>>;
  readArticleSource: (request: ContentScope & { articleId: string }) => Promise<RemoteAnswer<ArticleSource>>;
  previewArticleDraft: (request: ArticleEdit) => Promise<RemoteAnswer<{ html: string; path: string }>>;
  saveArticleRevision: (request: ArticleSave) => Promise<RemoteAnswer<ArticleSaved>>;

  getCreationImage: (request: ContentScope & { imageId: string }) => Promise<RemoteAnswer<{ mime: string; base64: string }>>;
  getCreationText: (request: ContentScope & { file: string }) => Promise<RemoteAnswer<{ text: string }>>;
  restoreProjectSession: (request: { id: string; folderPath: string; sessionId: string }) => Promise<RemoteAnswer<Record<string, never>>>;
  projectAction: (request: { id: string; folderPath: string; action: "inspect" | "remove" | "join"; cancelTasks?: boolean }) => Promise<RemoteAnswer<{ tasks: string[]; removed: boolean; directoryAliases?: string[] }>>;
  getProductionSettings: (request: Record<string, never>) => Promise<RemoteAnswer<ProductionSettingsView>>;
  productionSettingsAction: (request: ProductionSettingsAction) => Promise<RemoteAnswer<ProductionSettingsView>>;
  getProductionState: (request: ContentScope) => Promise<RemoteAnswer<ProductionState>>;
  productionAction: (request: ProductionAction) => Promise<RemoteAnswer<ProductionState>>;
  getProductionPreview: (request: ContentScope & import("../production/types.ts").ProductionPreviewRequest) => Promise<RemoteAnswer<{ html: string; path: string }>>;
  getCoverState: (request: CoverScope) => Promise<RemoteAnswer<CoverState>>;
  coverAction: (request: CoverAction) => Promise<RemoteAnswer<CoverState>>;
  getCoverImage: (request: CoverScope & { versionId: string }) => Promise<RemoteAnswer<{ mime: string; base64: string }>>;
  getImageSettings: (request: Record<string, never>) => Promise<RemoteAnswer<ImageSettings>>;
  setImageSettings: (request: { apiBase: string; model: string }) => Promise<RemoteAnswer<ImageSettings>>;
  beginImageUpdate: (request: { apiBase: string; model: string; revision: string; hasNewKey: boolean }) => Promise<RemoteAnswer<ImageSettings>>;
  completeImageUpdate: (request: { token: string; keyUpdated: boolean }) => Promise<RemoteAnswer<ImageSettings>>;
  checkImageService: (request: Record<string, never>) => Promise<RemoteAnswer<ImageSettings>>;
  startVideoImport: (request: { id: string; folderPath: string; sourcePath: string; name?: string }) => Promise<RemoteAnswer<VideoImportState>>;
  getVideoImport: (request: { token: string }) => Promise<RemoteAnswer<VideoImportState>>;
  cancelVideoImport: (request: { token: string }) => Promise<RemoteAnswer<VideoImportState>>;
  setVideoVisibility: (request: { id: string; folderPath: string; name: string; hidden: boolean }) => Promise<RemoteAnswer<ContentDetail>>;
  selectVideo: (request: { id: string; folderPath: string; name: string }) => Promise<RemoteAnswer<ContentDetail>>;

  listContents: (request: { query: string; filter: ContentFilter }) => Promise<RemoteAnswer<ListContentsResult>>;
  setContentVisibility: (request: { id: string; folderPath: string; hidden: boolean }) => Promise<RemoteAnswer<ListContentsResult>>;
  openContentPath: (request: { path: string }) => Promise<RemoteAnswer<Record<string, never>>>;
  getContent: (request: { id: string; folderPath?: string }) => Promise<RemoteAnswer<ContentDetail>>;
  getCoverThumb: (request: { id: string }) => Promise<RemoteAnswer<CoverThumbResult>>;
  getVideoPlayback: (request: { id: string }) => Promise<RemoteAnswer<VideoPlaybackResult>>;
  getArticleMedia: (request: { id: string }) => Promise<RemoteAnswer<ArticleMediaResult>>;
  getSubtitleText: (request: { id: string }) => Promise<RemoteAnswer<{ text: string; cues: Array<{ text: string; at?: string }> }>>;
  getSettings: (request: Record<string, never>) => Promise<RemoteAnswer<LibrarySettings>>;
  getCapabilities: (request: Record<string, never>) => Promise<RemoteAnswer<{ capabilities: CreatorCapabilities }>>;
  getRevision: (request: Record<string, never>) => Promise<RemoteAnswer<{ revision: number }>>;
  getProjectLocations: (request: Record<string, never>) => Promise<RemoteAnswer<import("../types.ts").ProjectLocationsView>>;
  setProjectLocation: (request: { path: string }) => Promise<RemoteAnswer<import("../types.ts").ProjectLocationsView>>;
  setLibraryRoot: (request: { path: string }) => Promise<RemoteAnswer<LibrarySettings>>;
  setProfile: (request: { profile: CreatorProfile }) => Promise<RemoteAnswer<LibrarySettings>>;
  setScriptRules: (request: { text: string }) => Promise<RemoteAnswer<LibrarySettings>>;
  refreshCatalog: (request: Record<string, never>) => Promise<RemoteAnswer<ListContentsResult>>;
  recoverProject: (request: { folderPath: string; sessionId: string }) => Promise<RemoteAnswer<CreateContentResult>>;
  addProject: (request: { path: string }) => Promise<RemoteAnswer<CreateContentResult>>;
  createContent: (request: { title: string; libraryRoot?: string; requestId?: string }) => Promise<RemoteAnswer<CreateContentResult>>;
  setPublish: (request: {
    id: string;
    platform: PublishPlatform;
    status: PublishMark;
    url?: string; folderPath?: string;
  }) => Promise<RemoteAnswer<ContentDetail>>;
  syncPublish: (request: { id?: string; platform?: PublishPlatform; force?: boolean }) => Promise<RemoteAnswer<SyncPublishResult>>;
  openSubtitlePreview: (request: { id: string }) => Promise<RemoteAnswer<SubtitlePreviewResult>>;
  startSubtitleBurn: (request: { id: string }) => Promise<RemoteAnswer<ContentDetail>>;
  startSubtitleGenerate: (request: { id: string }) => Promise<RemoteAnswer<ContentDetail>>;
  startCoverGenerate: (request: { id: string }) => Promise<RemoteAnswer<ContentDetail>>;
  setScript: (request: { id: string; text: string; folderPath?: string }) => Promise<RemoteAnswer<ContentDetail>>;
}

function unwrap<T>(answer: RemoteAnswer<T>, fallback: string): T {
  if (!answer.ok || answer.value === undefined) {
    throw Object.assign(new Error(answer.error?.message ?? fallback), { remoteResponse: true });
  }
  return answer.value;
}

export const inject = ["locale", "remote", "uiWorkspace", "desktopWorkbenches", "sessions", "conversation", "workspaces"];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-creator-workbench: dictionaries");
  ctx.effect(() => {
    remountPluginCss();
    return () => {
      releasePluginCss();
    };
  }, "dsh-creator-workbench: chrome");
  const remoteOf = (): CreatorWorkbenchRemote | undefined =>
    ctx.get("remote.creatorWorkbench") as CreatorWorkbenchRemote | undefined;

  const recovery = projectRecovery({
    bindings: () => loadCreatorUiState(browserCreatorStorage()).sessionContents ?? {},
    owns: session => desktopWorkbenchesOf(ctx).ownsSession(session),
    recover: async (sessionId, folderPath) => { const remote = remoteOf(); if (!remote) throw new Error("服务尚未就绪。"); return unwrap(await remote.recoverProject({ sessionId, folderPath }), "原项目恢复失败"); },
    changed: () => bumpLibrary(),
  });

  const face = (): CreatorViewFace => ({
    prepareCoverRequest: async (detail, ratios, append) => {
      const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。");
      await prepareCoverRequest(ctx, detail, ratios, async (request) => unwrap(await r.coverAction(request), "封面请求更新未完成"), append); bumpLibrary();
    },
    inspectProject: async (id, folderPath) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); const result = unwrap(await r.projectAction({ id, folderPath, action: "inspect" }), "项目检查失败"); planProjectCleanup(ctx, folderPath, result.directoryAliases); return result.tasks; },
    projectRemoved: async (id, folderPath) => {
      const session = desktopWorkbenchesOf(ctx).currentSession(), binding = session ? loadCreatorUiState(browserCreatorStorage()).sessionContents?.[session] : undefined;
      if (session && binding && sameFolder(binding.folder, folderPath)) await recovery.one(session, folderPath);
      const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.projectAction({ id, folderPath, action: "inspect" }), "项目状态读取失败").removed; },
    removeProject: async (id, folderPath, cancelTasks) => {
      const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。");
      const inspected = unwrap(await r.projectAction({ id, folderPath, action: "inspect" }), "项目检查失败");
      await removeProjectWithHost(ctx, { id, folderPath, ...(inspected.directoryAliases ? { directoryAliases: inspected.directoryAliases } : {}) }, async () => { unwrap(await r.projectAction({ id, folderPath, action: "remove", cancelTasks }), "项目移除未完成"); });
    },
    joinProject: async () => {
      const navigationCurrent = captureWorkbenchNavigation(desktopWorkbenchesOf(ctx)), selectionCurrent = captureContentSelection();
      const folderPath = await pickCreatorDirectory(ctx); if (!folderPath) return null;
      const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。");
      const added = unwrap(await r.addProject({ path: folderPath }), "加入项目失败"); bumpLibrary();
      if (!navigationCurrent() || !selectionCurrent()) return null;
      await restoreProjectSessions(ctx, added.folderPath, async (sessionId, nativeFolder) => { unwrap(await r.restoreProjectSession({ id: added.id, folderPath: nativeFolder ?? added.folderPath, sessionId }), "原会话分组恢复失败"); }, added.directoryAliases, added.id);
      return added;
    },
    getProjectView: async (id) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getProjectView({ id }), "项目读取失败"); },
    production: {
      projectView: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getProjectView(request), "项目读取失败"); },
      reconcile: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.reconcileProject(request), "任务核对失败"); },
      publication: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getPublicationContent(request), "材料读取失败"); },
      articleSource: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.readArticleSource(request), "文章读取失败"); },
      articlePreview: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.previewArticleDraft(request), "预览未完成"); },
      articleSave: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); const result = unwrap(await r.saveArticleRevision(request), "保存未完成"); bumpLibrary(); return result; },

      settings: async () => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getProductionSettings({}), "发布设置读取失败"); },
      settingsAction: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.productionSettingsAction(request), "发布设置操作失败"); },
      state: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getProductionState(request), "任务读取失败"); },
      action: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); const value = unwrap(await r.productionAction(request), "操作未完成"); bumpLibrary(); return value; },
      preview: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getProductionPreview(request), "预览读取失败"); },
      image: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getCreationImage(request), "图片读取失败"); },
      text: async (request) => { const r = remoteOf(); if (!r) throw new Error("服务尚未就绪。"); return unwrap(await r.getCreationText(request), "正文读取失败"); },
      prepareRequest: async (detail, text, append) => prepareBusinessRequest(ctx, detail, async () => `${text}\n项目：${detail.id}\n目录：${detail.folderPath}`, async () => detail.folderPath, append, "创作请求"),
      prepareArticleDraft: async (detail, append) => prepareBusinessRequest(ctx, detail, async () => `请使用 WeWrite 为《${detail.title}》写文章，完成检查、按需配图并交付排版 HTML。使用本项目选题和我在会话中的要求，通过工作台文章工具保存到本项目。\n项目：${detail.id}\n目录：${detail.folderPath}`, async () => detail.folderPath, append),
    },
    getCoverState: async (request) => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); return unwrap(await r.getCoverState(request), "封面读取失败"); },
    coverAction: async (request) => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); const state = unwrap(await r.coverAction(request), "封面操作失败"); bumpLibrary(); return state; },
    getCoverImage: async (request) => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); return unwrap(await r.getCoverImage(request), "图片读取失败"); },
    getImageSettings: async () => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); return unwrap(await r.getImageSettings({}), "生图设置读取失败"); },
    setImageSettings: async (request) => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); return unwrap(await r.setImageSettings(request), "生图设置保存失败"); },
    beginImageUpdate: async (request) => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); return unwrap(await r.beginImageUpdate(request), "设置更新未开始"); },
    completeImageUpdate: async (request) => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); return unwrap(await r.completeImageUpdate(request), "设置更新未完成"); },
    checkImageService: async () => { const r = remoteOf(); if (!r) throw new Error("remote unavailable"); return unwrap(await r.checkImageService({}), "连接检查失败"); },
    prepareCoverDraft: async (detail, runId, append) => { await prepareCoverDraft(ctx, detail, runId, async () => detail.folderPath, append); },
    ready: () => remoteOf() !== undefined,
    captureNavigation: () => captureWorkbenchNavigation(desktopWorkbenchesOf(ctx)),
    listContents: async (query, filter) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      void recovery.history();
      const result = unwrap(await remote.listContents({ query, filter }), "list failed");
      const previousSession = desktopWorkbenchesOf(ctx).currentSession();
      const cleanupWarnings = await reconcileRemovedProjects(ctx, result.removedItems ?? []);
      if (desktopWorkbenchesOf(ctx).currentSession() !== previousSession) bumpLibrary();
      return { ...result, cleanupWarnings };
    },
    setContentVisibility: async (id, folderPath, hidden) => {
      const remote = remoteOf(); if (!remote) throw new Error("服务尚未就绪。");
      const result = unwrap(await remote.setContentVisibility({ id, folderPath, hidden }), "项目列表更新失败");
      return result;
    },
    getContent: async (id, folderPath) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getContent({ id, ...(folderPath ? { folderPath } : {}) }), "content failed");
    },
    getCoverThumb: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) return { found: false, mime: "", base64: "" };
      const answer = await remote.getCoverThumb({ id });
      return answer.ok && answer.value !== undefined
        ? answer.value
        : { found: false, mime: "", base64: "" };
    },
    getVideoPlayback: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) return { found: false, url: "", kind: "raw" };
      const answer = await remote.getVideoPlayback({ id });
      return answer.ok && answer.value !== undefined
        ? answer.value
        : { found: false, url: "", kind: "raw" };
    },
    getArticleMedia: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) return { found: false, origin: "" };
      const answer = await remote.getArticleMedia({ id });
      return answer.ok && answer.value !== undefined
        ? answer.value
        : { found: false, origin: "" };
    },
    getSubtitleText: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) return { text: "", cues: [] };
      const answer = await remote.getSubtitleText({ id });
      return answer.ok && answer.value !== undefined ? answer.value : { text: "", cues: [] };
    },
    pickDirectory: () => pickCreatorDirectory(ctx),
    openPath: async (path) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      unwrap(await remote.openContentPath({ path }), "open failed");
    },
    getSettings: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getSettings({}), "settings failed");
    },
    getCapabilities: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getCapabilities({}), "capabilities failed").capabilities;
    },
    getRevision: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getRevision({}), "revision failed").revision;
    },
    getProjectLocations: async () => { const remote = remoteOf(); if (!remote) throw new Error("服务尚未就绪。"); return unwrap(await remote.getProjectLocations({}), "保存位置读取失败"); },
    setLibraryRoot: async (path) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const settings = unwrap(await remote.setProjectLocation({ path }), "保存位置更新失败");
      bumpLibrary(); return settings;
    },
    setProfile: async (profile) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      unwrap(await remote.setProfile({ profile }), "set profile failed");
      bumpProfile();
    },
    setScriptRules: async (text) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      unwrap(await remote.setScriptRules({ text }), "set script rules failed");
      bumpProfile();
    },
    refreshCatalog: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const listed = unwrap(await remote.refreshCatalog({}), "refresh failed");
      bumpLibrary();
      return listed;
    },
    createContent: async (title, parent, requestId) => {
      const remote = remoteOf(); if (!remote) throw new Error("服务尚未就绪。");
      const navigationCurrent = captureWorkbenchNavigation(desktopWorkbenchesOf(ctx));
      if (!parent) {
        const settings = unwrap(await remote.getSettings({}), "保存位置读取失败");
        parent = settings.libraryConfirmed ? settings.libraryRoot : await pickCreatorDirectory(ctx) ?? undefined;
        if (!parent || !navigationCurrent()) throw new Error("已取消选择保存位置。");
      }
      const created = unwrap(await remote.createContent({ title, libraryRoot: parent, ...(requestId ? { requestId } : {}) }), "创建项目失败");
      bumpLibrary(); return created;
    },
    startVideoImport: async (id, sourcePath, name, folderPath) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.startVideoImport({ id, folderPath, sourcePath, ...(name === undefined ? {} : { name }) }), "导入失败");
    },
    getVideoImport: async (token) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getVideoImport({ token }), "查询导入失败");
    },
    cancelVideoImport: async (token) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.cancelVideoImport({ token }), "取消失败");
    },
    setVideoVisibility: async (id, name, folderPath, hidden) => {
      const remote = remoteOf(); if (!remote) throw new Error("remote unavailable");
      const next = unwrap(await remote.setVideoVisibility({ id, name, folderPath, hidden }), "移除或恢复失败"); bumpLibrary(); return next;
    },
    selectVideo: async (id, name, folderPath) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.selectVideo({ id, name, folderPath }), "选择失败");
    },
    setPublish: async (id, platform, status, url, folderPath) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const next = unwrap(
        await remote.setPublish({ id, platform, status, ...(url === undefined ? {} : { url }), ...(folderPath === undefined ? {} : { folderPath }) }),
        "publish failed",
      );
      bumpLibrary();
      return next;
    },
    syncPublish: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const result = unwrap(
        await remote.syncPublish(request ?? {}),
        "sync failed",
      );
      bumpLibrary();
      return result;
    },
    openSubtitlePreview: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.openSubtitlePreview({ id }), "preview failed");
    },
    startSubtitleBurn: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const next = unwrap(await remote.startSubtitleBurn({ id }), "burn failed");
      bumpLibrary();
      return next;
    },
    startSubtitleGenerate: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const next = unwrap(await remote.startSubtitleGenerate({ id }), "transcribe failed");
      bumpLibrary();
      return next;
    },
    startCoverGenerate: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const next = unwrap(await remote.startCoverGenerate({ id }), "cover failed");
      bumpLibrary();
      return next;
    },
    setScript: async (id, text, folderPath) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.setScript({ id, text, ...(folderPath === undefined ? {} : { folderPath }) }), "script failed");
    },
  });

  const contentFace = face();

  ctx.inject(["inputTriggers"], (triggerCtx) => triggerCtx.effect(() => {
    const triggers = triggerCtx.get("inputTriggers") as
      | Parameters<typeof registerContentTriggers>[0]
      | undefined;
    return registerContentTriggers(
      triggers,
      (id) => contentFace.getContent(id),
      async () => {
        const listed = await contentFace.listContents("", "all");
        return listed.items.map((item) => ({ id: item.id, title: item.title }));
      },
      (target) => {
        const service = desktopWorkbenchesOf(ctx);
        const session = service.currentSession();
        const targetId = (target as { sessionId?: string } | undefined)?.sessionId;
        return service.isActive() && session !== undefined && service.ownsSession(session)
          && (target === undefined || targetId === session);
      },
    );
  }, "dsh-creator-workbench: content triggers"));

  const workbenches = desktopWorkbenchesOf(ctx);
  const credentialClient = credentialsOf(ctx);
  function BusinessPanel() {
    return <CreatorWorkbench face={contentFace} service={workbenches} credentials={credentialClient} t={ctx.locale.bind(NS)} />;
  }
  ctx.effect(() => workbenches.register({
    title: "创作工作台",
    repository: "https://github.com/qinghui316/dsh-creator-workbench",
    description: "管理本地片库、脚本、字幕、封面与发布状态",
    panelTitle: "创作工作台",
    layout: { businessSide: "right", businessWidth: 0.7 },
  }, BusinessPanel), "dsh-creator-workbench: workbench");

  ctx.effect(async () => {
    const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
    // Cordis waits for async effect setup during unload. Do not install new
    // slots after the owner has already entered teardown; release the remote
    // contribution immediately in that race.
    if (ctx.fiber.state >= 5) {
      await disposeRemote();
      return () => {};
    }
    bumpProfile();
    bumpLibrary();

    const stopLive = startLibraryLiveSync(() => contentFace.getRevision());

    return async () => {
      stopLive();
      await disposeRemote();
    };
  }, "dsh-creator-workbench: remote-view");
}
