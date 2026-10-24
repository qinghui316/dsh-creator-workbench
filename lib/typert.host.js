import { z } from "zod";
//#region src/covers/schemas.ts
const coverRatioSchema = z.enum([
	"3x4",
	"4x3",
	"16x9"
]);
const coverScopeSchema = z.object({
	id: z.string().min(1),
	folderPath: z.string().min(1)
});
const slot = z.object({
	status: z.enum([
		"pending",
		"running",
		"completed",
		"failed",
		"cancelled",
		"unconfirmed"
	]),
	versionId: z.string(),
	prompt: z.string(),
	error: z.string().optional()
});
const imageSettingsSchema = z.object({
	apiBase: z.string(),
	model: z.string(),
	revision: z.string(),
	pending: z.object({
		token: z.string(),
		apiBase: z.string(),
		model: z.string(),
		needsKey: z.boolean()
	}).optional(),
	checked: z.object({
		revision: z.string(),
		connection: z.string(),
		generation: z.string(),
		edit: z.string()
	}).optional()
});
const coverVersionSchema = z.object({
	id: z.string(),
	ratio: coverRatioSchema,
	file: z.string(),
	mime: z.string(),
	width: z.number(),
	height: z.number(),
	source: z.enum([
		"import",
		"generated",
		"legacy"
	]),
	createdAt: z.number(),
	video: z.string().optional(),
	runId: z.string().optional(),
	review: z.enum([
		"pending",
		"pass",
		"needs_changes"
	]),
	reviewNote: z.string().optional(),
	hidden: z.boolean().optional()
});
const coverRunSchema = z.object({
	purpose: z.enum(["cover", "service_test"]).optional(),
	requestToken: z.string().optional(),
	deliveredAt: z.number().optional(),
	sessionId: z.string().optional(),
	selectionRevision: z.number().optional(),
	id: z.string(),
	contentId: z.string(),
	folderPath: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	video: z.object({
		name: z.string(),
		size: z.number(),
		modifiedAt: z.number()
	}),
	ratios: z.array(coverRatioSchema),
	status: z.enum([
		"waiting_agent",
		"preparing",
		"running",
		"partial",
		"completed",
		"failed",
		"cancelled",
		"unconfirmed"
	]),
	frames: z.array(z.object({
		id: z.string(),
		file: z.string(),
		at: z.number()
	})),
	analysis: z.string().optional(),
	headline: z.string().optional(),
	frameIds: z.array(z.string()).optional(),
	mode: z.enum(["reference", "text"]).optional(),
	provider: imageSettingsSchema.omit({ checked: true }).optional(),
	slots: z.object({
		"3x4": slot.optional(),
		"4x3": slot.optional(),
		"16x9": slot.optional()
	}),
	jobId: z.string().optional(),
	error: z.string().optional()
});
const coverStateSchema = z.object({
	versions: z.array(coverVersionSchema),
	selected: z.object({
		"3x4": z.string().nullable().optional(),
		"4x3": z.string().nullable().optional(),
		"16x9": z.string().nullable().optional()
	}),
	runs: z.array(coverRunSchema),
	selectionRevision: z.number().optional()
});
const coverActionSchema = z.discriminatedUnion("action", [
	coverScopeSchema.extend({
		action: z.literal("delivered"),
		runId: z.string().uuid(),
		sessionId: z.string().min(1)
	}),
	coverScopeSchema.extend({
		action: z.literal("discard-request"),
		runId: z.string().uuid(),
		requestToken: z.string().uuid()
	}),
	coverScopeSchema.extend({
		action: z.literal("remove"),
		versionId: z.string().min(1)
	}),
	coverScopeSchema.extend({
		action: z.literal("test"),
		video: z.string().min(1)
	}),
	coverScopeSchema.extend({
		action: z.literal("create"),
		video: z.string().min(1),
		ratios: z.array(coverRatioSchema).min(1).max(3),
		requestToken: z.string().uuid().optional()
	}),
	coverScopeSchema.extend({
		action: z.literal("import"),
		sourcePath: z.string().min(1),
		ratio: coverRatioSchema
	}),
	coverScopeSchema.extend({
		action: z.literal("select"),
		versionId: z.string().min(1)
	}),
	coverScopeSchema.extend({
		action: z.literal("cancel"),
		runId: z.string().uuid()
	}),
	coverScopeSchema.extend({
		action: z.literal("retry"),
		runId: z.string().uuid(),
		ratios: z.array(coverRatioSchema).min(1).max(3),
		acknowledgeUnknown: z.boolean().optional()
	}),
	coverScopeSchema.extend({
		action: z.literal("review"),
		versionId: z.string(),
		verdict: z.enum(["pass", "needs_changes"]),
		note: z.string().min(1),
		select: z.boolean().optional()
	})
]);
//#endregion
//#region src/production/creationSchemas.ts
const creationSourceSchema = z.object({
	kind: z.enum([
		"topic",
		"materials",
		"article",
		"video"
	]),
	text: z.string().max(1e5).optional(),
	files: z.array(z.string().min(1)).max(30).optional(),
	articleId: z.string().optional(),
	video: z.object({
		name: z.string(),
		size: z.number(),
		modifiedAt: z.number(),
		sha256: z.string()
	}).optional()
});
const imageItemInputSchema = z.object({
	prompt: z.string().min(1).max(15e3),
	ratio: z.enum([
		"3x4",
		"4x3",
		"16x9",
		"1x1"
	]),
	purpose: z.enum([
		"cover",
		"illustration",
		"card"
	]),
	references: z.array(z.string()).max(8).optional()
});
const creationImageSchema = z.object({
	id: z.string(),
	file: z.string(),
	mime: z.string(),
	width: z.number(),
	height: z.number(),
	sha256: z.string(),
	createdAt: z.number(),
	source: z.enum(["imported", "generated"]),
	purpose: z.enum([
		"cover",
		"illustration",
		"card"
	]),
	taskId: z.string().optional(),
	hidden: z.boolean().optional(),
	review: z.string().optional()
});
const imageItemSchema = imageItemInputSchema.extend({
	id: z.string(),
	references: z.array(z.string()),
	status: z.enum([
		"pending",
		"running",
		"completed",
		"failed",
		"cancelled",
		"unconfirmed"
	]),
	imageId: z.string().optional(),
	error: z.string().optional()
});
const publicationInputSchema = z.object({
	platform: z.enum([
		"xiaohongshu",
		"douyin",
		"bilibili",
		"wechat",
		"official-account"
	]),
	type: z.enum([
		"video",
		"images",
		"article"
	]),
	title: z.string().min(1).max(500),
	body: z.string().max(3e5),
	tags: z.array(z.string().min(1).max(100)).max(20),
	imageIds: z.array(z.string()).max(50),
	video: z.string().optional(),
	articleId: z.string().optional(),
	articleFile: z.string().optional(),
	coverImageId: z.string().optional(),
	coverFiles: z.object({
		"3x4": z.string().optional(),
		"4x3": z.string().optional(),
		"16x9": z.string().optional()
	}).optional(),
	category: z.string().max(100).optional(),
	source: creationSourceSchema.optional()
});
const publicationSchema = publicationInputSchema.omit({ body: true }).extend({
	id: z.string(),
	revision: z.number().int().positive(),
	bodyFile: z.string(),
	body: z.string().optional(),
	bodyError: z.string().optional(),
	sourceHash: z.string().optional(),
	sourceChanged: z.boolean().optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
	hidden: z.boolean().optional()
});
const publicationRecordSchema = z.object({
	id: z.string(),
	publicationId: z.string(),
	revision: z.number(),
	platform: publicationInputSchema.shape.platform,
	type: publicationInputSchema.shape.type,
	accountId: z.string(),
	taskId: z.string().optional(),
	state: z.enum([
		"linked",
		"uploaded",
		"draft",
		"published"
	]),
	remoteId: z.string().optional(),
	url: z.string().optional(),
	receipt: z.string().optional(),
	submittedFile: z.string().optional(),
	updatedAt: z.number()
});
//#endregion
//#region src/production/schemas.ts
const scopeSchema = z.object({
	id: z.string().min(1),
	folderPath: z.string().min(1)
});
const platform = z.enum([
	"xiaohongshu",
	"douyin",
	"bilibili",
	"wechat"
]);
const media = z.object({
	name: z.string(),
	size: z.number(),
	modifiedAt: z.number(),
	sha256: z.string()
});
const account = z.object({
	platform,
	id: z.string(),
	name: z.string(),
	checkedAt: z.number()
});
const observation = z.object({
	platform,
	id: z.string().optional(),
	name: z.string().optional(),
	checkedAt: z.number(),
	state: z.enum([
		"connected",
		"login-required",
		"unverified"
	]),
	error: z.string().optional(),
	spaceId: z.number().int().positive().optional()
});
const metricsTarget = z.object({
	platform: z.enum([
		"xiaohongshu",
		"douyin",
		"bilibili",
		"wechat",
		"official-account"
	]),
	accountId: z.string(),
	remoteId: z.string().optional(),
	url: z.string().optional(),
	publicationId: z.string().optional(),
	recordId: z.string().optional()
});
const task = z.object({
	source: creationSourceSchema.optional(),
	imageItems: z.array(imageItemSchema).optional(),
	publicationId: z.string().optional(),
	publicationRevision: z.number().optional(),
	publicationType: z.enum([
		"video",
		"images",
		"article"
	]).optional(),
	executionRevision: z.number().int().nonnegative().optional(),
	metricsKey: z.string().optional(),
	metricsTargets: z.array(metricsTarget).optional(),
	metricsProgress: z.array(metricsTarget.extend({
		state: z.enum([
			"queued",
			"running",
			"completed",
			"failed",
			"blocked",
			"cancelled"
		]),
		startedAt: z.number().optional(),
		endedAt: z.number().optional(),
		error: z.string().optional()
	})).optional(),
	id: z.string(),
	kind: z.enum([
		"upload",
		"asr",
		"article",
		"wechat",
		"metrics",
		"images"
	]),
	status: z.enum([
		"queued",
		"running",
		"waiting-agent",
		"ready",
		"completed",
		"blocked",
		"failed",
		"cancelled",
		"unconfirmed"
	]),
	contentId: z.string(),
	folderPath: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	video: media.optional(),
	account: account.optional(),
	jobId: z.string().optional(),
	error: z.string().optional(),
	step: z.string().optional(),
	packageFile: z.string().optional(),
	platform: platform.optional(),
	articleId: z.string().optional(),
	transcriptId: z.string().optional(),
	originalRightsConfirmed: z.boolean().optional(),
	sessionId: z.string().optional(),
	receipt: z.string().optional(),
	remoteId: z.string().optional(),
	wechatAppId: z.string().optional(),
	articleFile: z.string().optional()
});
const productionStateSchema = z.object({
	savedPublication: z.object({
		id: z.string(),
		revision: z.number().int().positive()
	}).optional(),
	schemaVersion: z.union([z.literal(1), z.literal(2)]),
	images: z.array(creationImageSchema).optional(),
	publications: z.array(publicationSchema).optional(),
	records: z.array(publicationRecordSchema).optional(),
	tasks: z.array(task.extend({ uploadKey: z.string().optional() })),
	uploadNotice: z.object({
		taskId: z.string(),
		message: z.string(),
		canCreateNew: z.boolean()
	}).optional(),
	candidates: z.array(z.object({
		platform: z.enum([
			"xiaohongshu",
			"douyin",
			"bilibili",
			"wechat",
			"official-account"
		]),
		accountId: z.string(),
		remoteId: z.string(),
		title: z.string(),
		url: z.string().optional()
	})).optional(),
	transcripts: z.array(z.object({
		id: z.string(),
		video: media,
		source: z.enum(["imported", "volcano"]),
		textFile: z.string(),
		srtFile: z.string(),
		rawFile: z.string().optional(),
		createdAt: z.number(),
		cues: z.number()
	})),
	articles: z.array(z.object({
		id: z.string(),
		video: media.optional(),
		transcriptId: z.string().optional(),
		source: creationSourceSchema.optional(),
		imageIds: z.array(z.string()).optional(),
		title: z.string().optional(),
		format: z.enum(["markdown", "html"]).optional(),
		file: z.string(),
		createdAt: z.number(),
		frameFiles: z.array(z.string())
	})),
	drafts: z.array(z.object({
		id: z.string(),
		appid: z.string(),
		articleFile: z.string(),
		mediaId: z.string(),
		title: z.string(),
		submittedHash: z.string(),
		remoteHash: z.string(),
		submittedFile: z.string(),
		updatedAt: z.number(),
		publishedId: z.string().optional(),
		publishedUrl: z.string().optional()
	})),
	metrics: z.array(z.object({
		publicationId: z.string().optional(),
		recordId: z.string().optional(),
		platform: z.enum([
			"xiaohongshu",
			"douyin",
			"bilibili",
			"wechat",
			"official-account"
		]),
		accountId: z.string(),
		remoteId: z.string(),
		url: z.string().optional(),
		views: z.number().optional(),
		likes: z.number().optional(),
		comments: z.number().optional(),
		shares: z.number().optional(),
		syncedAt: z.number().optional(),
		checkedAt: z.number(),
		state: z.enum([
			"ok",
			"error",
			"not-found",
			"unassociated"
		]),
		error: z.string().optional()
	}))
});
const productionSettingsSchema = z.object({
	revision: z.string(),
	accounts: z.partialRecord(platform, account),
	accountHistory: z.array(account),
	observations: z.partialRecord(platform, observation),
	wechat: z.object({
		appid: z.string(),
		theme: z.string(),
		author: z.string(),
		checkedAt: z.number().optional(),
		error: z.string().optional()
	}),
	browserPaused: z.boolean(),
	runtime: z.object({
		publisher: z.boolean(),
		article: z.boolean(),
		python: z.boolean(),
		ffmpeg: z.boolean(),
		browser: z.boolean(),
		details: z.array(z.string())
	}),
	asrConfigured: z.boolean(),
	wechatConfigured: z.boolean(),
	wechatCredential: z.string()
});
const scoped = (shape) => scopeSchema.extend(shape);
const productionActionSchema = z.discriminatedUnion("action", [
	scoped({
		action: z.literal("register-article"),
		file: z.string().min(1),
		source: creationSourceSchema.optional(),
		imageIds: z.array(z.string()).optional()
	}),
	scoped({
		action: z.literal("import-article"),
		sourcePath: z.string().min(1)
	}),
	scoped({
		action: z.literal("import-image"),
		sourcePath: z.string().min(1),
		purpose: z.enum([
			"cover",
			"illustration",
			"card"
		])
	}),
	scoped({
		action: z.literal("remove-image"),
		imageId: z.string()
	}),
	scoped({
		action: z.literal("generate-images"),
		items: z.array(imageItemInputSchema).min(1).max(30),
		source: creationSourceSchema.optional(),
		sessionId: z.string().optional()
	}),
	scoped({
		action: z.literal("retry-images"),
		taskId: z.string(),
		itemIds: z.array(z.string()).min(1),
		acknowledgeUnknown: z.boolean().optional()
	}),
	scoped({
		action: z.literal("save-publication"),
		publicationId: z.string().optional(),
		expectedRevision: z.number().int().positive().optional(),
		input: publicationInputSchema
	}),
	scoped({
		action: z.literal("remove-publication"),
		publicationId: z.string(),
		expectedRevision: z.number().int().positive()
	}),
	scoped({
		action: z.literal("upload-publication"),
		publicationId: z.string(),
		expectedRevision: z.number().int().positive(),
		originalRightsConfirmed: z.boolean(),
		newUploadAfter: z.string().optional()
	}),
	scoped({
		action: z.literal("upload"),
		input: z.object({
			platform,
			title: z.string().min(1).max(500),
			description: z.string().max(1e4),
			tags: z.array(z.string().min(1).max(100)).max(20),
			originalRightsConfirmed: z.boolean(),
			useCovers: z.boolean(),
			category: z.string().max(100).optional()
		}),
		newUploadAfter: z.string().uuid().optional()
	}),
	scoped({
		action: z.literal("resume-upload"),
		taskId: z.string().uuid()
	}),
	scoped({
		action: z.literal("inspect-upload"),
		taskId: z.string().uuid()
	}),
	scoped({
		action: z.literal("cancel"),
		taskId: z.string().uuid()
	}),
	scoped({
		action: z.literal("transcribe"),
		acknowledgeUnknown: z.boolean().optional()
	}),
	scoped({
		action: z.literal("import-subtitle"),
		sourcePath: z.string().min(1)
	}),
	scoped({
		action: z.literal("prepare-article"),
		source: creationSourceSchema.optional(),
		sessionId: z.string().optional()
	}),
	scoped({
		action: z.literal("save-article"),
		imageIds: z.array(z.string()).optional(),
		taskId: z.string().uuid(),
		markdown: z.string().max(3e5),
		sessionId: z.string().optional()
	}),
	...["wechat-preview", "wechat-draft"].map((action) => scoped({
		action: z.literal(action),
		articleFile: z.string().optional(),
		coverPath: z.string().optional(),
		confirmRemoteChange: z.boolean().optional(),
		acknowledgeUnknown: z.boolean().optional()
	})),
	scoped({
		action: z.literal("refresh-metrics"),
		publicationId: z.string().optional(),
		platform: z.enum([
			"xiaohongshu",
			"douyin",
			"bilibili",
			"wechat",
			"official-account"
		]).optional()
	}),
	scoped({
		action: z.literal("associate-publication"),
		publicationId: z.string().optional(),
		recordId: z.string().optional(),
		platform: z.enum([
			"xiaohongshu",
			"douyin",
			"bilibili",
			"wechat",
			"official-account"
		]),
		remoteId: z.string().min(1).max(200),
		url: z.string().optional()
	})
]);
const productionSettingsActionSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("prepare-runtime") }),
	...[
		"pause-browser",
		"resume-browser",
		"check-wechat"
	].map((action) => z.object({ action: z.literal(action) })),
	z.object({
		action: z.literal("open-login"),
		platform
	}),
	z.object({
		action: z.literal("check-account"),
		platform
	}),
	z.object({
		action: z.literal("connect-account"),
		platform,
		expectedId: z.string().min(1),
		replace: z.boolean()
	}),
	z.object({
		action: z.literal("save-wechat"),
		appid: z.string().min(1),
		author: z.string(),
		theme: z.string(),
		revision: z.string()
	}),
	z.object({
		action: z.literal("import-wechat"),
		sourcePath: z.string().min(1)
	})
]);
const PUBLISH_PLATFORMS = Object.freeze(Object.keys({
	xiaohongshu: {
		name: "小红书",
		icon: "xhs",
		settingsLabel: "settings.platform.xiaohongshu",
		inspectorLabel: "inspector.platform.xhs",
		collectUrl: "https://creator.xiaohongshu.com/new/note-manager"
	},
	douyin: {
		name: "抖音",
		icon: "douyin",
		settingsLabel: "settings.platform.douyin",
		inspectorLabel: "inspector.platform.douyin",
		collectUrl: "https://creator.douyin.com/creator-micro/content/manage"
	},
	bilibili: {
		name: "B站",
		icon: "bilibili",
		settingsLabel: "settings.platform.bilibili",
		inspectorLabel: "inspector.platform.bilibili",
		collectUrl: "https://member.bilibili.com/platform/upload-manager/article"
	},
	wechat: {
		name: "视频号",
		icon: "wechat",
		settingsLabel: "settings.platform.wechat",
		inspectorLabel: "inspector.platform.wechat",
		collectUrl: "https://channels.weixin.qq.com/platform/post/list"
	}
}));
//#endregion
//#region src/schemas.ts
const contentCoversSchema = z.object({
	"3x4": z.string().optional(),
	"4x3": z.string().optional(),
	"16x9": z.string().optional()
});
const contentSubtitlesSchema = z.object({
	srt: z.string().optional(),
	ass: z.string().optional(),
	transcript: z.string().optional()
});
const pipelineSchema = z.union([
	z.literal("raw"),
	z.literal("subtitled"),
	z.literal("covered"),
	z.literal("packaged")
]);
const workflowSchema = z.union([
	z.literal("idle"),
	z.literal("finish"),
	z.literal("publish"),
	z.literal("live")
]);
const publishMarkSchema = z.union([
	z.literal("unpublished"),
	z.literal("draft"),
	z.literal("published")
]);
const publishPlatformSchema = z.enum(PUBLISH_PLATFORMS);
const platformPublishSchema = z.object({
	status: publishMarkSchema,
	source: z.union([
		z.literal("none"),
		z.literal("publisher"),
		z.literal("overlay"),
		z.literal("sync")
	]),
	url: z.string().optional(),
	remoteId: z.string().optional(),
	views: z.number().optional(),
	likes: z.number().optional(),
	comments: z.number().optional(),
	syncedAt: z.number().optional(),
	verifiedAccountId: z.string().optional()
});
const contentPublishSchema = z.object(Object.fromEntries(PUBLISH_PLATFORMS.map((platform) => [platform, platformPublishSchema])));
const burnJobSchema = z.object({
	status: z.union([
		z.literal("idle"),
		z.literal("running"),
		z.literal("done"),
		z.literal("error")
	]),
	startedAt: z.number().optional(),
	output: z.string().optional(),
	error: z.string().optional(),
	pid: z.number().optional()
});
const contentSummarySchema = z.object({
	id: z.string().min(1),
	folderPath: z.string().min(1),
	title: z.string(),
	date: z.string().optional(),
	recordedAt: z.number(),
	createdMs: z.number(),
	videos: z.array(z.object({
		name: z.string(),
		path: z.string(),
		size: z.number(),
		modifiedAt: z.number(),
		missing: z.boolean().optional()
	})).optional(),
	hiddenVideos: z.array(z.object({
		name: z.string(),
		path: z.string(),
		size: z.number(),
		modifiedAt: z.number(),
		missing: z.boolean().optional()
	})).optional(),
	selectedVideo: z.string().optional(),
	videoSelection: z.enum([
		"empty",
		"choose",
		"selected",
		"missing",
		"cleared"
	]).optional(),
	videoRaw: z.string().optional(),
	videoSubtitled: z.string().optional(),
	covers: contentCoversSchema,
	subtitles: contentSubtitlesSchema,
	hasPublishPackage: z.boolean(),
	hasArticle: z.boolean(),
	articlePath: z.string().optional(),
	tags: z.array(z.string()),
	pipeline: pipelineSchema,
	workflow: workflowSchema,
	publish: contentPublishSchema,
	burn: burnJobSchema,
	subtitleJob: burnJobSchema,
	coverJob: burnJobSchema
});
const creatorProfileSchema = z.object({ enabledPlatforms: z.array(publishPlatformSchema) });
const secretViewSchema = z.object({
	kind: z.union([z.literal("subtitle"), z.literal("cover")]),
	ref: z.string(),
	configured: z.boolean(),
	writable: z.boolean(),
	source: z.string().optional()
});
const librarySettingsSchema = z.object({
	libraryRoot: z.string(),
	libraryConfirmed: z.boolean().optional(),
	profile: creatorProfileSchema,
	secrets: z.object({
		subtitle: secretViewSchema,
		cover: secretViewSchema
	}),
	scriptRules: z.string().optional()
});
const listContentsRequestSchema = z.object({
	query: z.string(),
	filter: z.union([
		z.literal("all"),
		z.literal("cover"),
		z.literal("subtitle"),
		z.literal("article")
	])
});
const listContentsResultSchema = z.object({
	settings: librarySettingsSchema,
	items: z.array(contentSummarySchema),
	removedItems: z.array(contentSummarySchema).optional(),
	counts: z.object({
		total: z.number().int().nonnegative(),
		cover: z.number().int().nonnegative(),
		subtitle: z.number().int().nonnegative(),
		article: z.number().int().nonnegative()
	}),
	revision: z.number().int().nonnegative()
});
const idRequestSchema = z.object({ id: z.string().min(1) });
const contentDetailSchema = contentSummarySchema.and(z.object({
	publishCopy: z.string(),
	topicNote: z.string(),
	script: z.string(),
	article: z.string(),
	secrets: z.object({
		subtitle: secretViewSchema,
		cover: secretViewSchema
	})
}));
const coverThumbResultSchema = z.object({
	found: z.boolean(),
	mime: z.string(),
	base64: z.string()
});
const videoPlaybackResultSchema = z.object({
	found: z.boolean(),
	url: z.string(),
	kind: z.union([z.literal("raw"), z.literal("subtitled")])
});
const articleMediaResultSchema = z.object({
	found: z.boolean(),
	origin: z.string()
});
const subtitleTextResultSchema = z.object({
	text: z.string(),
	cues: z.array(z.object({
		text: z.string(),
		at: z.string().optional()
	}))
});
const setPublishRequestSchema = z.object({
	folderPath: z.string().min(1).optional(),
	id: z.string().min(1),
	platform: publishPlatformSchema,
	status: publishMarkSchema,
	url: z.string().optional()
});
const subtitlePreviewResultSchema = z.object({
	url: z.string().min(1),
	port: z.number().int().positive()
});
const syncPublishRequestSchema = z.object({
	id: z.string().min(1).optional(),
	platform: publishPlatformSchema.optional(),
	force: z.boolean().optional()
});
const syncPublishResultSchema = z.object({
	matched: z.number().int().nonnegative(),
	cached: z.boolean().optional(),
	platforms: z.array(z.object({
		platform: publishPlatformSchema,
		count: z.number().int().nonnegative(),
		loginRequired: z.boolean().optional(),
		error: z.string().optional()
	}))
});
const revisionResultSchema = z.object({ revision: z.number().int().nonnegative() });
const capabilitySchema = z.object({
	state: z.union([
		z.literal("ready"),
		z.literal("missing"),
		z.literal("unsupported")
	]),
	required: z.boolean(),
	detail: z.string(),
	path: z.string().optional()
});
const capabilitiesResultSchema = z.object({ capabilities: z.object({
	library: capabilitySchema,
	screenStudio: capabilitySchema,
	subtitleSkill: capabilitySchema,
	subtitleCredential: capabilitySchema,
	coverSkill: capabilitySchema,
	coverCredential: capabilitySchema,
	publishSync: capabilitySchema,
	editingSkill: capabilitySchema,
	publishSkill: capabilitySchema,
	articleSkill: capabilitySchema
}) });
const setLibraryRootRequestSchema = z.object({ path: z.string().min(1) });
const createContentRequestSchema = z.object({
	title: z.string().min(1),
	libraryRoot: z.string().min(1).optional()
});
const createContentResultSchema = z.object({
	id: z.string().min(1),
	folderPath: z.string().min(1)
});
const setProfileRequestSchema = z.object({ profile: creatorProfileSchema });
const setScriptRulesRequestSchema = z.object({ text: z.string() });
z.object({
	id: z.string().min(1),
	text: z.string()
});
const setScriptRequestSchema = z.object({
	id: z.string().min(1),
	text: z.string(),
	folderPath: z.string().min(1).optional()
});
z.object({
	apply: z.boolean(),
	ids: z.array(z.string())
});
z.object({
	moves: z.array(z.object({
		from: z.string().min(1),
		to: z.string().min(1),
		reason: z.union([
			z.literal("add-date"),
			z.literal("readable-title"),
			z.literal("both")
		])
	})),
	unchanged: z.number().int().nonnegative()
});
const selectVideoRequestSchema = z.object({
	id: z.string().min(1),
	folderPath: z.string().min(1),
	name: z.string().min(1)
});
const videoImportRequestSchema = z.object({
	id: z.string().min(1),
	folderPath: z.string().min(1),
	sourcePath: z.string().min(1),
	name: z.string().min(1).optional()
});
const videoImportTokenSchema = z.object({ token: z.string().min(1) });
const videoImportStateSchema = z.object({
	token: z.string(),
	id: z.string(),
	name: z.string(),
	status: z.enum([
		"running",
		"completed",
		"failed",
		"cancelled"
	]),
	jobId: z.string().optional(),
	error: z.string().optional()
});
//#endregion
//#region src/remote-contract.ts
const PACKAGE_NAME = "dsh-creator-workbench";
const REMOTE_NAMESPACE = "creatorWorkbench";
const emptyObjectSchema = z.object({});
function codec(typeSymbol, schema) {
	return {
		mode: "strict",
		typeSymbol,
		create: () => schema
	};
}
function jsonParam(name, typeSymbol, schema) {
	return {
		name,
		wire: name,
		source: "json",
		codec: codec(typeSymbol, schema)
	};
}
function invocation(method, request, result) {
	return {
		id: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${method}`,
		service: REMOTE_NAMESPACE,
		namespace: REMOTE_NAMESPACE,
		method,
		invocation: { kind: "direct" },
		parameters: [jsonParam("request", `${PACKAGE_NAME}#${method}Request`, request)],
		cancellation: { parameter: "signal" },
		result: codec(`${PACKAGE_NAME}#${method}Result`, result),
		sourceLocation: {
			file: "src/service.ts",
			line: 1,
			column: 1
		}
	};
}
//#endregion
//#region src/typert.host.ts
const TYPERT = {
	package: PACKAGE_NAME,
	face: "host",
	schemas: [],
	model: {
		services: [],
		events: [],
		objects: []
	},
	invocations: [
		invocation("getProductionSettings", emptyObjectSchema, productionSettingsSchema),
		invocation("productionSettingsAction", productionSettingsActionSchema, productionSettingsSchema),
		invocation("getProductionState", scopeSchema, productionStateSchema),
		invocation("getCreationImage", scopeSchema.extend({ imageId: z.string() }), z.object({
			mime: z.string(),
			base64: z.string()
		})),
		invocation("getCreationText", scopeSchema.extend({ file: z.string() }), z.object({ text: z.string() })),
		invocation("productionAction", productionActionSchema, productionStateSchema),
		invocation("getProductionPreview", scopeSchema.extend({
			taskId: z.string().uuid().optional(),
			articleFile: z.string().optional()
		}), z.object({
			html: z.string(),
			path: z.string()
		})),
		invocation("setVideoVisibility", z.object({
			id: z.string().min(1),
			folderPath: z.string().min(1),
			name: z.string().min(1),
			hidden: z.boolean()
		}), contentDetailSchema),
		invocation("setContentVisibility", z.object({
			id: z.string().min(1),
			folderPath: z.string().min(1),
			hidden: z.boolean()
		}), listContentsResultSchema),
		invocation("projectAction", z.object({
			id: z.string().min(1),
			folderPath: z.string().min(1),
			action: z.enum([
				"inspect",
				"remove",
				"join"
			]),
			cancelTasks: z.boolean().optional()
		}), z.object({
			tasks: z.array(z.string()),
			removed: z.boolean()
		})),
		invocation("restoreProjectSession", z.object({
			id: z.string().min(1),
			folderPath: z.string().min(1),
			sessionId: z.string().min(1)
		}), emptyObjectSchema),
		invocation("getCoverState", coverScopeSchema, coverStateSchema),
		invocation("coverAction", coverActionSchema, coverStateSchema),
		invocation("getCoverImage", coverScopeSchema.extend({ versionId: z.string() }), z.object({
			mime: z.string(),
			base64: z.string()
		})),
		invocation("getImageSettings", emptyObjectSchema, imageSettingsSchema),
		invocation("setImageSettings", z.object({
			apiBase: z.string(),
			model: z.string()
		}), imageSettingsSchema),
		invocation("beginImageUpdate", z.object({
			apiBase: z.string(),
			model: z.string(),
			revision: z.string(),
			hasNewKey: z.boolean()
		}), imageSettingsSchema),
		invocation("completeImageUpdate", z.object({
			token: z.string(),
			keyUpdated: z.boolean()
		}), imageSettingsSchema),
		invocation("checkImageService", emptyObjectSchema, imageSettingsSchema),
		invocation("selectVideo", selectVideoRequestSchema, contentDetailSchema),
		invocation("startVideoImport", videoImportRequestSchema, videoImportStateSchema),
		invocation("getVideoImport", videoImportTokenSchema, videoImportStateSchema),
		invocation("cancelVideoImport", videoImportTokenSchema, videoImportStateSchema),
		invocation("listContents", listContentsRequestSchema, listContentsResultSchema),
		invocation("getContent", idRequestSchema, contentDetailSchema),
		invocation("getCoverThumb", idRequestSchema, coverThumbResultSchema),
		invocation("getVideoPlayback", idRequestSchema, videoPlaybackResultSchema),
		invocation("getArticleMedia", idRequestSchema, articleMediaResultSchema),
		invocation("getSubtitleText", idRequestSchema, subtitleTextResultSchema),
		invocation("openContentPath", z.object({ path: z.string().min(1) }), emptyObjectSchema),
		invocation("getSettings", emptyObjectSchema, librarySettingsSchema),
		invocation("getCapabilities", emptyObjectSchema, capabilitiesResultSchema),
		invocation("getRevision", emptyObjectSchema, revisionResultSchema),
		invocation("setLibraryRoot", setLibraryRootRequestSchema, librarySettingsSchema),
		invocation("refreshCatalog", emptyObjectSchema, listContentsResultSchema),
		invocation("createContent", createContentRequestSchema, createContentResultSchema),
		invocation("setProfile", setProfileRequestSchema, librarySettingsSchema),
		invocation("setScriptRules", setScriptRulesRequestSchema, librarySettingsSchema),
		invocation("setPublish", setPublishRequestSchema, contentDetailSchema),
		invocation("syncPublish", syncPublishRequestSchema, syncPublishResultSchema),
		invocation("setScript", setScriptRequestSchema, contentDetailSchema),
		invocation("openSubtitlePreview", idRequestSchema, subtitlePreviewResultSchema),
		invocation("startSubtitleBurn", idRequestSchema, contentDetailSchema),
		invocation("startSubtitleGenerate", idRequestSchema, contentDetailSchema),
		invocation("startCoverGenerate", idRequestSchema, contentDetailSchema)
	]
};
//#endregion
export { TYPERT };
