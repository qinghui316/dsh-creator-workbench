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
	reviewNote: z.string().optional()
});
const coverRunSchema = z.object({
	purpose: z.enum(["cover", "service_test"]).optional(),
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
		"3x4": z.string().optional(),
		"4x3": z.string().optional(),
		"16x9": z.string().optional()
	}),
	runs: z.array(coverRunSchema)
});
const coverActionSchema = z.discriminatedUnion("action", [
	coverScopeSchema.extend({
		action: z.literal("test"),
		video: z.string().min(1)
	}),
	coverScopeSchema.extend({
		action: z.literal("create"),
		video: z.string().min(1),
		ratios: z.array(coverRatioSchema).min(1).max(3)
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
	syncedAt: z.number().optional()
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
		invocation("setVideoVisibility", z.object({
			id: z.string().min(1),
			folderPath: z.string().min(1),
			name: z.string().min(1),
			hidden: z.boolean()
		}), contentDetailSchema),
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
