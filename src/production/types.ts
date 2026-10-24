import type { PublishPlatform } from "../platforms.ts";

export const ASR_CREDENTIAL = "CREATOR_VOLC_ASR_API_KEY";
export const PRODUCTION_PLATFORMS = ["xiaohongshu", "douyin", "bilibili", "wechat"] as const;
export type ContentScope = { id: string; folderPath: string };
export interface MediaIdentity { name: string; size: number; modifiedAt: number; sha256: string }
export interface CreationSource { kind: "topic" | "materials" | "article" | "video"; text?: string; files?: string[]; articleId?: string; video?: MediaIdentity }
export type ImageRatio = "3x4" | "4x3" | "16x9" | "1x1";
export interface CreationImage { id: string; file: string; mime: string; width: number; height: number; sha256: string; createdAt: number; source: "imported" | "generated"; purpose: "cover" | "illustration" | "card"; taskId?: string; hidden?: boolean; review?: string }
export interface ImageItem { id: string; prompt: string; ratio: ImageRatio; purpose: CreationImage["purpose"]; references: string[]; status: "pending" | "running" | "completed" | "failed" | "cancelled" | "unconfirmed"; imageId?: string; error?: string }
export type PublicationPlatform = PublishPlatform | "official-account";
export interface PublicationDraft {
  id: string; platform: PublicationPlatform; type: "video" | "images" | "article"; revision: number; title: string; tags: string[];
  bodyFile: string; body?: string; bodyError?: string; imageIds: string[]; video?: string; articleId?: string; articleFile?: string;
  coverImageId?: string; coverFiles?: Partial<Record<"3x4" | "4x3" | "16x9", string>>; category?: string;
  source?: CreationSource; sourceHash?: string; sourceChanged?: boolean; createdAt: number; updatedAt: number; hidden?: boolean;
}
export interface PublicationInput { platform: PublicationPlatform; type: PublicationDraft["type"]; title: string; body: string; tags: string[]; imageIds: string[]; video?: string; articleId?: string; articleFile?: string; coverImageId?: string; coverFiles?: Partial<Record<"3x4" | "4x3" | "16x9", string>>; category?: string; source?: CreationSource }
export interface PublicationRecord { id: string; publicationId: string; revision: number; platform: PublicationPlatform; type: PublicationDraft["type"]; accountId: string; taskId?: string; state: "linked" | "uploaded" | "draft" | "published"; remoteId?: string; url?: string; receipt?: string; submittedFile?: string; updatedAt: number }
export interface PlatformAccount { platform: PublishPlatform; id: string; name: string; checkedAt: number }
export interface AccountObservation { platform: PublishPlatform; id?: string; name?: string; checkedAt: number; state: "connected" | "login-required" | "unverified"; error?: string; spaceId?: number }
export interface ProductionSettings {
  revision: string;
  accounts: Partial<Record<PublishPlatform, PlatformAccount>>;
  accountHistory: PlatformAccount[];
  observations: Partial<Record<PublishPlatform, AccountObservation>>;
  wechat: { appid: string; theme: string; author: string; checkedAt?: number; error?: string };
  browserPaused: boolean;
}
export interface RuntimeStatus { publisher: boolean; article: boolean; python: boolean; ffmpeg: boolean; browser: boolean; details: string[] }
export interface ProductionSettingsView extends ProductionSettings { runtime: RuntimeStatus; asrConfigured: boolean; wechatConfigured: boolean; wechatCredential: string }
export type TaskStatus = "queued" | "running" | "waiting-agent" | "ready" | "completed" | "blocked" | "failed" | "cancelled" | "unconfirmed";
export interface MetricsTarget { platform: PublishPlatform | "official-account"; accountId: string; remoteId?: string; url?: string; publicationId?: string; recordId?: string }
export interface MetricsProgress extends MetricsTarget { state: "queued" | "running" | "completed" | "failed" | "blocked" | "cancelled"; startedAt?: number; endedAt?: number; error?: string }
export interface ProductionTask {
  id: string; kind: "upload" | "asr" | "article" | "wechat" | "metrics" | "images"; status: TaskStatus;
  contentId: string; folderPath: string; createdAt: number; updatedAt: number;
  video?: MediaIdentity; account?: PlatformAccount; jobId?: string; error?: string; step?: string;
  packageFile?: string; platform?: PublishPlatform; articleId?: string; transcriptId?: string;
  originalRightsConfirmed?: boolean; sessionId?: string; receipt?: string; remoteId?: string;
  wechatAppId?: string; articleFile?: string; uploadKey?: string;
  executionRevision?: number;
  metricsKey?: string; metricsTargets?: MetricsTarget[]; metricsProgress?: MetricsProgress[];
  source?: CreationSource; imageItems?: ImageItem[]; publicationId?: string; publicationRevision?: number; publicationType?: PublicationDraft["type"];
}
export interface TranscriptVersion { id: string; video: MediaIdentity; source: "imported" | "volcano"; textFile: string; srtFile: string; rawFile?: string; createdAt: number; cues: number }
export interface ArticleVersion { parentArticleId?: string; saveInputHash?: string; id: string; video?: MediaIdentity; transcriptId?: string; file: string; createdAt: number; frameFiles: string[]; source?: CreationSource; imageIds?: string[]; title?: string; format?: "markdown" | "html" }
export interface WechatDraft { id: string; appid: string; articleFile: string; mediaId: string; title: string; submittedHash: string; remoteHash: string; submittedFile: string; updatedAt: number; publishedId?: string; publishedUrl?: string }
export interface MetricRecord { platform: PublishPlatform | "official-account"; accountId: string; remoteId: string; url?: string; views?: number; likes?: number; comments?: number; shares?: number; syncedAt?: number; checkedAt: number; state: "ok" | "error" | "not-found" | "unassociated"; error?: string; publicationId?: string; recordId?: string }
export interface PublicationCandidate { platform: PublishPlatform | "official-account"; accountId: string; remoteId: string; title: string; url?: string }
export interface UploadNotice { taskId: string; message: string; canCreateNew: boolean }
export interface ProductionState { savedPublication?: { id: string; revision: number }; schemaVersion: 1 | 2; tasks: ProductionTask[]; transcripts: TranscriptVersion[]; articles: ArticleVersion[]; drafts: WechatDraft[]; metrics: MetricRecord[]; candidates?: PublicationCandidate[]; uploadNotice?: UploadNotice; images?: CreationImage[]; publications?: PublicationDraft[]; records?: PublicationRecord[] }
export interface PublishInput { platform: PublishPlatform; title: string; description: string; tags: string[]; originalRightsConfirmed: boolean; useCovers: boolean; category?: string }
export type ProductionAction = ContentScope & (
  | { action: "upload"; input: PublishInput; newUploadAfter?: string }
  | { action: "resume-upload" | "inspect-upload" | "cancel"; taskId: string }
  | { action: "transcribe"; acknowledgeUnknown?: boolean }
  | { action: "import-subtitle"; sourcePath: string }
  | { action: "prepare-article"; sessionId?: string; source?: CreationSource }
  | { action: "save-article"; taskId: string; markdown: string; sessionId?: string; imageIds?: string[] }
  | { action: "import-image"; sourcePath: string; purpose: CreationImage["purpose"] }
  | { action: "register-article"; file: string; source?: CreationSource; imageIds?: string[] }
  | { action: "import-article"; sourcePath: string }
  | { action: "remove-image"; imageId: string }
  | { action: "generate-images"; items: Array<{ prompt: string; ratio: ImageRatio; purpose: CreationImage["purpose"]; references?: string[] }>; source?: CreationSource; sessionId?: string }
  | { action: "retry-images"; taskId: string; itemIds: string[]; acknowledgeUnknown?: boolean }
  | { action: "save-publication"; publicationId?: string; expectedRevision?: number; input: PublicationInput }
  | { action: "remove-publication"; publicationId: string; expectedRevision: number }
  | { action: "upload-publication"; publicationId: string; expectedRevision: number; originalRightsConfirmed: boolean; newUploadAfter?: string }
  | { action: "wechat-preview" | "wechat-draft"; articleFile?: string; coverPath?: string; confirmRemoteChange?: boolean; acknowledgeUnknown?: boolean }
  | { action: "refresh-metrics"; platform?: PublishPlatform | "official-account"; publicationId?: string }
  | { action: "associate-publication"; platform: PublishPlatform | "official-account"; remoteId: string; url?: string; publicationId?: string; recordId?: string }
);
export type ProductionSettingsAction =
  | { action: "prepare-runtime" | "pause-browser" | "resume-browser" }
  | { action: "open-login" | "check-account"; platform: PublishPlatform }
  | { action: "connect-account"; platform: PublishPlatform; expectedId: string; replace: boolean }
  | { action: "save-wechat"; appid: string; theme: string; author: string; revision: string }
  | { action: "check-wechat" }
  | { action: "import-wechat"; sourcePath: string };

export const emptyProduction = (): ProductionState => ({ schemaVersion: 1, tasks: [], transcripts: [], articles: [], drafts: [], metrics: [] });
export const isActiveTask = (task: Pick<ProductionTask, "status">): boolean => ["queued", "running", "waiting-agent"].includes(task.status);
export const sameMedia = (left: MediaIdentity, right: MediaIdentity): boolean => left.name === right.name && left.size === right.size && left.sha256 === right.sha256;
export const publisherPlatform = (platform: PublishPlatform): string => platform === "wechat" ? "wechat_channels" : platform;
