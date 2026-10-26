export type ContentFilter = "all" | "cover" | "subtitle" | "article";

export type PipelineStage = "raw" | "subtitled" | "covered" | "packaged";

export type WorkflowStage = "idle" | "finish" | "publish" | "live";

export type { PublishPlatform } from "./platforms.ts";
import type { PublishPlatform } from "./platforms.ts";

export type PublishMark = "unpublished" | "draft" | "published";

export type PublishSource = "none" | "publisher" | "overlay" | "sync";

export interface PublishMetrics {
  verifiedAccountId?: string;
  views?: number;
  likes?: number;
  comments?: number;
  syncedAt?: number;
}

export interface PlatformPublish extends PublishMetrics {
  status: PublishMark;
  source: PublishSource;
  url?: string;
  remoteId?: string;
}

export type ContentPublish = Record<PublishPlatform, PlatformPublish>;

export type BurnStatus = "idle" | "running" | "done" | "error";

export interface BurnJob {
  status: BurnStatus;
  startedAt?: number;
  output?: string;
  error?: string;
  pid?: number;
}

export type MediaJob = BurnJob;

export type SecretKind = "subtitle" | "cover";

export interface SecretView {
  kind: SecretKind;
  ref: string;
  configured: boolean;
  writable: boolean;
  source?: string;
}

export interface CreatorSecrets {
  subtitle: SecretView;
  cover: SecretView;
}

export interface OverlayPublish extends PublishMetrics {
  status: PublishMark;
  url?: string;
  remoteId?: string;
}

export interface SubtitleCue {
  text: string;
  at?: string;
}

export interface ContentCovers {
  "3x4"?: string;
  "4x3"?: string;
  "16x9"?: string;
}

export interface ContentSubtitles {
  srt?: string;
  ass?: string;
  transcript?: string;
}

export type VideoSelectionState = "empty" | "choose" | "selected" | "missing" | "cleared";
export interface VideoCandidate { name: string; path: string; size: number; modifiedAt: number; missing?: boolean }
export interface VideoImportRequest { id: string; folderPath: string; sourcePath: string; name?: string }
export interface VideoImportState { token: string; id: string; name: string; status: "running" | "completed" | "failed" | "cancelled"; jobId?: string; error?: string }

export interface ContentSummary {
  accessError?: string;
  directoryRevision?: string;
  directoryAliases?: string[];
  videos?: VideoCandidate[];
  hiddenVideos?: VideoCandidate[];
  selectedVideo?: string;
  videoSelection?: VideoSelectionState;
  id: string;
  folderPath: string;
  title: string;
  date?: string;
  recordedAt: number;
  createdMs: number;
  videoRaw?: string;
  videoSubtitled?: string;
  covers: ContentCovers;
  subtitles: ContentSubtitles;
  hasPublishPackage: boolean;
  hasArticle: boolean;
  articlePath?: string;
  tags: string[];
  pipeline: PipelineStage;
  workflow: WorkflowStage;
  publish: ContentPublish;
  burn: BurnJob;
  subtitleJob: MediaJob;
  coverJob: MediaJob;
}

export interface CreatorProfile {
  enabledPlatforms: PublishPlatform[];
}

export interface LibrarySettings {
  projectLocations?: Array<{ path: string }>;
  libraryRoot: string;
  libraryConfirmed?: boolean;
  profile: CreatorProfile;
  secrets: CreatorSecrets;
  scriptRules?: string;
}

export type ProjectLocationsView = Pick<LibrarySettings, "libraryRoot" | "libraryConfirmed" | "projectLocations">;

export type CreatorCapabilityState = "ready" | "missing" | "unsupported";

export interface CreatorCapability {
  state: CreatorCapabilityState;
  required: boolean;
  detail: string;
  path?: string;
}

export interface CreatorCapabilities {
  library: CreatorCapability;
  subtitleSkill: CreatorCapability;
  subtitleCredential: CreatorCapability;
  coverSkill: CreatorCapability;
  coverCredential: CreatorCapability;
  publishSync: CreatorCapability;
  publishSkill: CreatorCapability;
  articleSkill: CreatorCapability;
}

export interface CreatorSetupStatus {
  platform: NodeJS.Platform;
  dataDir: string;
  settings: LibrarySettings;
  capabilities: CreatorCapabilities;
  recommendations: string[];
}

export interface CreatorSetupRequest {
  apply: boolean;
  libraryRoot?: string;
  enabledPlatforms?: PublishPlatform[];
}

export interface CreatorSetupResult {
  applied: boolean;
  proposal: Omit<CreatorSetupRequest, "apply">;
  status: CreatorSetupStatus;
}

export interface LibraryCounts {
  total: number;
  cover: number;
  subtitle: number;
  article: number;
}

export interface ListContentsRequest {
  query: string;
  filter: ContentFilter;
}

export interface ListContentsResult {
  /** Client-side public-host cleanup feedback; never a replacement for the content list. */
  cleanupWarnings?: string[];
  settings: LibrarySettings;
  items: ContentSummary[];
  removedItems?: ContentSummary[];
  counts: LibraryCounts;
  revision: number;
}

export interface IdRequest {
  id: string;
  folderPath?: string;
}

export interface ContentDetail extends ContentSummary {
  publishCopy: string;
  topicNote: string;
  script: string;
  article: string;
  secrets: CreatorSecrets;
}

export interface CoverThumbResult {
  found: boolean;
  mime: string;
  base64: string;
}

export interface VideoPlaybackResult {
  found: boolean;
  url: string;
  kind: "raw" | "subtitled";
}

export interface ArticleMediaResult {
  found: boolean;
  origin: string;
}

export interface SubtitleTextResult {
  text: string;
  cues: SubtitleCue[];
}

export interface SetLibraryRootRequest {
  path: string;
}

export interface CreateContentRequest {
  title: string;
  libraryRoot?: string;
  requestId?: string;
}

export interface CreateContentResult {
  directoryAliases?: string[];
  id: string;
  folderPath: string;
}

export interface OverlayItem {
  title?: string;
  publish?: Partial<Record<PublishPlatform, OverlayPublish>>;
  burn?: BurnJob;
  subtitleJob?: MediaJob;
  coverJob?: MediaJob;
}

export interface SetPublishRequest {
  folderPath?: string;
  id: string;
  platform: PublishPlatform;
  status: PublishMark;
  url?: string;
}

export interface SubtitlePreviewResult {
  url: string;
  port: number;
}

export interface SyncPublishRequest {
  id?: string;
  platform?: PublishPlatform;
  force?: boolean;
}

export interface SyncPublishResult {
  matched: number;
  cached?: boolean;
  platforms: Array<{
    platform: PublishPlatform;
    count: number;
    loginRequired?: boolean;
    error?: string;
  }>;
}

export interface OverlayStore {
  schemaVersion: 1;
  videoSelections?: Record<string, Record<string, string | null>>;
  hiddenVideos?: Record<string, Record<string, string[]>>;
  hiddenContents?: Record<string, string[]>;
  libraryRoot?: string;
  profile?: CreatorProfile;
  scriptRules?: string;
  items: Record<string, OverlayItem>;
}

export type OrganizeReason = "add-date" | "readable-title" | "both";

export interface OrganizeMove {
  from: string;
  to: string;
  reason: OrganizeReason;
}

export interface OrganizeRequest {
  libraryRoot?: string;
  apply: boolean;
  ids: string[];
}

export interface OrganizePreview {
  moves: OrganizeMove[];
  unchanged: number;
}

export interface SetProfileRequest {
  profile: CreatorProfile;
}

export interface SetScriptRulesRequest {
  text: string;
}

export interface CreatorGuideResult {
  guide: string;
  status: CreatorSetupStatus;
}

export interface SetTopicNoteRequest {
  id: string;
  folderPath?: string;
  text: string;
}

export interface SetScriptRequest {
  id: string;
  text: string;
  folderPath?: string;
}
