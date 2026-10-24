import type { PublishPlatform } from "../platforms.ts";

export const ASR_CREDENTIAL = "CREATOR_VOLC_ASR_API_KEY";
export const PRODUCTION_PLATFORMS = ["xiaohongshu", "douyin", "bilibili", "wechat"] as const;
export type ContentScope = { id: string; folderPath: string };
export interface MediaIdentity { name: string; size: number; modifiedAt: number; sha256: string }
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
export interface MetricsTarget { platform: PublishPlatform | "official-account"; accountId: string; remoteId?: string; url?: string }
export interface MetricsProgress extends MetricsTarget { state: "queued" | "running" | "completed" | "failed" | "blocked" | "cancelled"; startedAt?: number; endedAt?: number; error?: string }
export interface ProductionTask {
  id: string; kind: "upload" | "asr" | "article" | "wechat" | "metrics"; status: TaskStatus;
  contentId: string; folderPath: string; createdAt: number; updatedAt: number;
  video?: MediaIdentity; account?: PlatformAccount; jobId?: string; error?: string; step?: string;
  packageFile?: string; platform?: PublishPlatform; articleId?: string; transcriptId?: string;
  originalRightsConfirmed?: boolean; sessionId?: string; receipt?: string; remoteId?: string;
  wechatAppId?: string; articleFile?: string; uploadKey?: string;
  executionRevision?: number;
  metricsKey?: string; metricsTargets?: MetricsTarget[]; metricsProgress?: MetricsProgress[];
}
export interface TranscriptVersion { id: string; video: MediaIdentity; source: "imported" | "volcano"; textFile: string; srtFile: string; rawFile?: string; createdAt: number; cues: number }
export interface ArticleVersion { id: string; video: MediaIdentity; transcriptId: string; file: string; createdAt: number; frameFiles: string[] }
export interface WechatDraft { id: string; appid: string; articleFile: string; mediaId: string; title: string; submittedHash: string; remoteHash: string; submittedFile: string; updatedAt: number; publishedId?: string; publishedUrl?: string }
export interface MetricRecord { platform: PublishPlatform | "official-account"; accountId: string; remoteId: string; url?: string; views?: number; likes?: number; comments?: number; shares?: number; syncedAt?: number; checkedAt: number; state: "ok" | "error" | "not-found" | "unassociated"; error?: string }
export interface PublicationCandidate { platform: PublishPlatform | "official-account"; accountId: string; remoteId: string; title: string; url?: string }
export interface UploadNotice { taskId: string; message: string; canCreateNew: boolean }
export interface ProductionState { schemaVersion: 1; tasks: ProductionTask[]; transcripts: TranscriptVersion[]; articles: ArticleVersion[]; drafts: WechatDraft[]; metrics: MetricRecord[]; candidates?: PublicationCandidate[]; uploadNotice?: UploadNotice }
export interface PublishInput { platform: PublishPlatform; title: string; description: string; tags: string[]; originalRightsConfirmed: boolean; useCovers: boolean; category?: string }
export type ProductionAction = ContentScope & (
  | { action: "upload"; input: PublishInput; newUploadAfter?: string }
  | { action: "resume-upload" | "inspect-upload" | "cancel"; taskId: string }
  | { action: "transcribe"; acknowledgeUnknown?: boolean }
  | { action: "import-subtitle"; sourcePath: string }
  | { action: "prepare-article"; sessionId?: string }
  | { action: "save-article"; taskId: string; markdown: string; sessionId?: string }
  | { action: "wechat-preview" | "wechat-draft"; articleFile?: string; coverPath?: string; confirmRemoteChange?: boolean; acknowledgeUnknown?: boolean }
  | { action: "refresh-metrics"; platform?: PublishPlatform | "official-account" }
  | { action: "associate-publication"; platform: PublishPlatform | "official-account"; remoteId: string; url?: string }
);
export type ProductionSettingsAction =
  | { action: "prepare-runtime" | "pause-browser" | "resume-browser" }
  | { action: "open-login" | "check-account"; platform: PublishPlatform }
  | { action: "connect-account"; platform: PublishPlatform; expectedId: string; replace: boolean }
  | { action: "save-wechat"; appid: string; theme: string; author: string; revision: string }
  | { action: "check-wechat" }
  | { action: "import-wechat"; sourcePath: string };

export const emptyProduction = (): ProductionState => ({ schemaVersion: 1, tasks: [], transcripts: [], articles: [], drafts: [], metrics: [] });
export const isActiveTask = (task: ProductionTask): boolean => ["queued", "running", "waiting-agent"].includes(task.status);
export const sameMedia = (left: MediaIdentity, right: MediaIdentity): boolean => left.name === right.name && left.size === right.size && left.sha256 === right.sha256;
export const publisherPlatform = (platform: PublishPlatform): string => platform === "wechat" ? "wechat_channels" : platform;
