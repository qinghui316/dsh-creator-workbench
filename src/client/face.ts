import type { CoverScope, CoverAction, CoverState, ImageSettings } from "../covers/types.ts";
import type { ProductionClient } from "./productionApi.ts";
import type {
  VideoImportState,
  ContentDetail,
  ContentFilter,
  CoverThumbResult,
  CreatorCapabilities,
  CreatorProfile,
  LibrarySettings,
  ListContentsResult,
  PublishMark,
  PublishPlatform,
  SubtitlePreviewResult,
  SubtitleTextResult,
  SyncPublishResult,
  ArticleMediaResult,
  VideoPlaybackResult,
} from "../types.ts";

export interface CreatorViewFace {
  getProjectView?: (id: string) => Promise<import("../projectView.ts").ProjectView>;
  production?: ProductionClient;
  inspectProject?: (id: string, folderPath: string) => Promise<string[]>;
  projectRemoved?: (id: string, folderPath: string) => Promise<boolean>;
  removeProject?: (id: string, folderPath: string, cancelTasks: boolean) => Promise<void>;
  joinProject?: () => Promise<{ id: string; folderPath: string } | null>;
  prepareCoverRequest?: (detail: ContentDetail, ratios: import("../covers/types.ts").CoverRatio[], append?: boolean) => Promise<void>;
  getCoverState: (scope: CoverScope) => Promise<CoverState>;
  coverAction: (request: CoverAction) => Promise<CoverState>;
  getCoverImage: (request: CoverScope & { versionId: string }) => Promise<{ mime: string; base64: string }>;
  getImageSettings: () => Promise<ImageSettings>;
  setImageSettings: (settings: { apiBase: string; model: string }) => Promise<ImageSettings>;
  beginImageUpdate: (settings: { apiBase: string; model: string; revision: string; hasNewKey: boolean }) => Promise<ImageSettings>;
  completeImageUpdate: (request: { token: string; keyUpdated: boolean }) => Promise<ImageSettings>;
  checkImageService: () => Promise<ImageSettings>;
  prepareCoverDraft: (detail: ContentDetail, runId: string, append?: boolean) => Promise<void>;
  ready: () => boolean;
  captureNavigation: () => () => boolean;
  listContents: (query: string, filter: ContentFilter) => Promise<ListContentsResult>;
  setContentVisibility: (id: string, folderPath: string, hidden: boolean) => Promise<ListContentsResult>;
  getRevision: () => Promise<number>;
  getContent: (id: string, folderPath?: string) => Promise<ContentDetail>;
  getCoverThumb: (id: string) => Promise<CoverThumbResult>;
  startVideoImport: (id: string, sourcePath: string, name: string, folderPath: string) => Promise<VideoImportState>;
  getVideoImport: (token: string) => Promise<VideoImportState>;
  cancelVideoImport: (token: string) => Promise<VideoImportState>;
  setVideoVisibility: (id: string, name: string, folderPath: string, hidden: boolean) => Promise<ContentDetail>;
  selectVideo: (id: string, name: string, folderPath: string) => Promise<ContentDetail>;
  getVideoPlayback: (id: string) => Promise<VideoPlaybackResult>;
  getArticleMedia: (id: string) => Promise<ArticleMediaResult>;
  getSubtitleText: (id: string) => Promise<SubtitleTextResult>;
  pickDirectory: () => Promise<string | null>;
  openPath: (path: string) => Promise<void>;
  getSettings: () => Promise<LibrarySettings>;
  getProjectLocations?: () => Promise<import("../types.ts").ProjectLocationsView>;
  getCapabilities: () => Promise<CreatorCapabilities>;
  setLibraryRoot: (path: string) => Promise<import("../types.ts").ProjectLocationsView | void>;
  setProfile: (profile: CreatorProfile) => Promise<void>;
  setScriptRules: (text: string) => Promise<void>;
  refreshCatalog: () => Promise<ListContentsResult>;
  createContent: (title: string, parent?: string, requestId?: string) => Promise<{ id: string; folderPath: string }>;
  setPublish: (id: string, platform: PublishPlatform, status: PublishMark, url?: string, folderPath?: string) => Promise<ContentDetail>;
  syncPublish: (request?: { platform?: PublishPlatform; id?: string }) => Promise<SyncPublishResult>;
  openSubtitlePreview: (id: string) => Promise<SubtitlePreviewResult>;
  startSubtitleBurn: (id: string) => Promise<ContentDetail>;
  startSubtitleGenerate: (id: string) => Promise<ContentDetail>;
  startCoverGenerate: (id: string) => Promise<ContentDetail>;
  setScript: (id: string, text: string, folderPath?: string) => Promise<ContentDetail>;
}
