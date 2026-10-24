import { z } from "zod";
export const scopeSchema = z.object({ id: z.string().min(1), folderPath: z.string().min(1) });
const platform = z.enum(["xiaohongshu", "douyin", "bilibili", "wechat"]);
const media = z.object({ name: z.string(), size: z.number(), modifiedAt: z.number(), sha256: z.string() });
const account = z.object({ platform, id: z.string(), name: z.string(), checkedAt: z.number() });
const observation = z.object({ platform, id: z.string().optional(), name: z.string().optional(), checkedAt: z.number(), state: z.enum(["connected", "login-required", "unverified"]), error: z.string().optional(), spaceId: z.number().int().positive().optional() });
const metricsTarget = z.object({ platform: z.enum(["xiaohongshu", "douyin", "bilibili", "wechat", "official-account"]), accountId: z.string(), remoteId: z.string().optional(), url: z.string().optional() });
const task = z.object({ executionRevision: z.number().int().nonnegative().optional(), metricsKey: z.string().optional(), metricsTargets: z.array(metricsTarget).optional(), metricsProgress: z.array(metricsTarget.extend({ state: z.enum(["queued", "running", "completed", "failed", "blocked", "cancelled"]), startedAt: z.number().optional(), endedAt: z.number().optional(), error: z.string().optional() })).optional(), id: z.string(), kind: z.enum(["upload", "asr", "article", "wechat", "metrics"]), status: z.enum(["queued", "running", "waiting-agent", "ready", "completed", "blocked", "failed", "cancelled", "unconfirmed"]), contentId: z.string(), folderPath: z.string(), createdAt: z.number(), updatedAt: z.number(), video: media.optional(), account: account.optional(), jobId: z.string().optional(), error: z.string().optional(), step: z.string().optional(), packageFile: z.string().optional(), platform: platform.optional(), articleId: z.string().optional(), transcriptId: z.string().optional(), originalRightsConfirmed: z.boolean().optional(), sessionId: z.string().optional(), receipt: z.string().optional(), remoteId: z.string().optional(), wechatAppId: z.string().optional(), articleFile: z.string().optional() });
export const productionStateSchema = z.object({
  schemaVersion: z.literal(1), tasks: z.array(task.extend({ uploadKey: z.string().optional() })),
  uploadNotice: z.object({ taskId: z.string(), message: z.string(), canCreateNew: z.boolean() }).optional(),
  candidates: z.array(z.object({ platform: z.enum(["xiaohongshu", "douyin", "bilibili", "wechat", "official-account"]), accountId: z.string(), remoteId: z.string(), title: z.string(), url: z.string().optional() })).optional(),
  transcripts: z.array(z.object({ id: z.string(), video: media, source: z.enum(["imported", "volcano"]), textFile: z.string(), srtFile: z.string(), rawFile: z.string().optional(), createdAt: z.number(), cues: z.number() })),
  articles: z.array(z.object({ id: z.string(), video: media, transcriptId: z.string(), file: z.string(), createdAt: z.number(), frameFiles: z.array(z.string()) })),
  drafts: z.array(z.object({ id: z.string(), appid: z.string(), articleFile: z.string(), mediaId: z.string(), title: z.string(), submittedHash: z.string(), remoteHash: z.string(), submittedFile: z.string(), updatedAt: z.number(), publishedId: z.string().optional(), publishedUrl: z.string().optional() })),
  metrics: z.array(z.object({ platform: z.enum(["xiaohongshu", "douyin", "bilibili", "wechat", "official-account"]), accountId: z.string(), remoteId: z.string(), url: z.string().optional(), views: z.number().optional(), likes: z.number().optional(), comments: z.number().optional(), shares: z.number().optional(), syncedAt: z.number().optional(), checkedAt: z.number(), state: z.enum(["ok", "error", "not-found", "unassociated"]), error: z.string().optional() })),
});
export const productionSettingsSchema = z.object({ revision: z.string(), accounts: z.partialRecord(platform, account), accountHistory: z.array(account), observations: z.partialRecord(platform, observation), wechat: z.object({ appid: z.string(), theme: z.string(), author: z.string(), checkedAt: z.number().optional(), error: z.string().optional() }), browserPaused: z.boolean(), runtime: z.object({ publisher: z.boolean(), article: z.boolean(), python: z.boolean(), ffmpeg: z.boolean(), browser: z.boolean(), details: z.array(z.string()) }), asrConfigured: z.boolean(), wechatConfigured: z.boolean(), wechatCredential: z.string() });
const scoped = <T extends z.ZodRawShape>(shape: T) => scopeSchema.extend(shape);
export const productionActionSchema = z.discriminatedUnion("action", [
  scoped({ action: z.literal("upload"), input: z.object({ platform, title: z.string().min(1).max(500), description: z.string().max(10000), tags: z.array(z.string().min(1).max(100)).max(20), originalRightsConfirmed: z.boolean(), useCovers: z.boolean(), category: z.string().max(100).optional() }), newUploadAfter: z.string().uuid().optional() }),
  scoped({ action: z.literal("resume-upload"), taskId: z.string().uuid() }), scoped({ action: z.literal("inspect-upload"), taskId: z.string().uuid() }), scoped({ action: z.literal("cancel"), taskId: z.string().uuid() }),
  scoped({ action: z.literal("transcribe"), acknowledgeUnknown: z.boolean().optional() }), scoped({ action: z.literal("import-subtitle"), sourcePath: z.string().min(1) }),
  scoped({ action: z.literal("prepare-article"), sessionId: z.string().optional() }), scoped({ action: z.literal("save-article"), taskId: z.string().uuid(), markdown: z.string().max(300000), sessionId: z.string().optional() }),
  ...(["wechat-preview", "wechat-draft"] as const).map((action) => scoped({ action: z.literal(action), articleFile: z.string().optional(), coverPath: z.string().optional(), confirmRemoteChange: z.boolean().optional(), acknowledgeUnknown: z.boolean().optional() })),
  scoped({ action: z.literal("refresh-metrics"), platform: z.enum(["xiaohongshu", "douyin", "bilibili", "wechat", "official-account"]).optional() }),
  scoped({ action: z.literal("associate-publication"), platform: z.enum(["xiaohongshu", "douyin", "bilibili", "wechat", "official-account"]), remoteId: z.string().min(1).max(200), url: z.string().optional() }),
]);
export const productionSettingsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare-runtime") }),
  ...(["pause-browser", "resume-browser", "check-wechat"] as const).map((action) => z.object({ action: z.literal(action) })),
  z.object({ action: z.literal("open-login"), platform }), z.object({ action: z.literal("check-account"), platform }),
  z.object({ action: z.literal("connect-account"), platform, expectedId: z.string().min(1), replace: z.boolean() }),
  z.object({ action: z.literal("save-wechat"), appid: z.string().min(1), author: z.string(), theme: z.string(), revision: z.string() }),
  z.object({ action: z.literal("import-wechat"), sourcePath: z.string().min(1) }),
]);
