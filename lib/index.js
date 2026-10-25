import { defineTool } from "@deepseek-ai/dsh-tools";
import { access, copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { z } from "zod";
import { closeSync, constants, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import Schema from "@deepseek-ai/schemastery";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createServer } from "node:net";
import { createServer as createServer$1 } from "node:http";
//#region src/covers/tools.ts
const scopeParameters = {
	id: {
		type: "string",
		required: true,
		description: "Exact episode id from the request."
	},
	folderPath: {
		type: "string",
		required: true,
		description: "Exact confirmed episode folder."
	},
	runId: {
		type: "string",
		required: true,
		description: "Bound cover run id from the request."
	}
};
const present$3 = (title, rawInput) => ({
	card: "generic",
	title,
	kind: "execute",
	rawInput
});
const jsonOutput = {
	schema: { type: "json" },
	render: (_args, value) => [{
		type: "text",
		text: JSON.stringify(value)
	}]
};
function registerCoverTools(ctx, workflow) {
	const tools = ctx.get("tools");
	const attachments = ctx.get("attachments");
	tools.register(defineTool({
		name: "creator_prepare_cover",
		description: "Prepare the bound video frames and read them as actual image attachments. Follow oil-cover agent-native-flow and cover-rules at the returned paths. Use this session's multimodal model; no external analysis API. If you cannot see images, ask to select a vision-capable Harness model; never pretend to inspect them.",
		parameters: scopeParameters,
		output: {
			...jsonOutput,
			render: (_args, result) => {
				const value = result;
				return [{
					type: "text",
					text: JSON.stringify({
						run: value.run,
						context: value.context,
						rules: value.rules,
						flow: value.flow,
						frameOrder: value.images.map((i) => i.name)
					})
				}, ...value.images.map((i) => ({
					type: "image",
					attachment: i.attachment
				}))];
			}
		},
		presentCall: (args) => present$3("查看封面候选画面", args),
		execute: async (args, exec) => {
			const result = await workflow.prepare(args, args.runId, exec.signal);
			const refs = await attachments.saveImages(result.images.map((i) => ({
				data: i.data,
				name: i.name,
				mediaType: "image/jpeg"
			})));
			return {
				...result,
				images: result.images.map((i, index) => ({
					name: i.name,
					attachment: refs[index]
				}))
			};
		}
	}));
	tools.register(defineTool({
		name: "creator_generate_cover",
		description: "Submit the analysis and full per-ratio prompts for the exact prepared run. Default reference mode passes selected real video frames to the configured image service. text mode requires an explicit user request accepting no reference images. Returns one Harness background job; job_output waits and job_kill cancels. Do not retry unconfirmed remote requests automatically. After completion call creator_read_cover_results, inspect actual images, then creator_review_cover for each version.",
		parameters: {
			...scopeParameters,
			headline: {
				type: "string",
				required: true
			},
			analysis: {
				type: "string",
				required: true
			},
			frameIds: {
				type: "array",
				required: true,
				items: { type: "string" }
			},
			mode: {
				type: "string",
				required: true,
				enum: ["reference", "text"]
			},
			prompts: {
				type: "object",
				required: true,
				additionalProperties: false,
				properties: {
					"3x4": { type: "string" },
					"4x3": { type: "string" },
					"16x9": { type: "string" }
				}
			}
		},
		output: jsonOutput,
		presentCall: (args) => present$3("制作封面", args),
		execute: async (args, exec) => {
			const run = await workflow.start(args, args.runId, args, void 0, false, exec.agent?.session.id);
			return {
				kind: "background",
				jobId: run.jobId,
				runId: run.id,
				status: run.status
			};
		}
	}));
	tools.register(defineTool({
		name: "creator_read_cover_results",
		description: "Load this run's actual generated cover versions into model image context for visual review. Returns per-ratio success/failure, prompts and image attachments; do not assume all three succeeded.",
		parameters: scopeParameters,
		output: {
			...jsonOutput,
			render: (_args, result) => {
				const r = result;
				return [{
					type: "text",
					text: JSON.stringify({
						run: r.run,
						versions: r.versions,
						order: r.images.map((i) => i.name)
					})
				}, ...r.images.map((i) => ({
					type: "image",
					attachment: i.attachment
				}))];
			}
		},
		presentCall: (args) => present$3("检查封面结果", args),
		execute: async (args, exec) => {
			exec.signal.throwIfAborted();
			const state = await workflow.state(args), run = state.runs.find((r) => r.id === args.runId);
			if (!run) throw new Error("制作记录不存在。");
			const versions = state.versions.filter((v) => v.runId === run.id);
			const images = await Promise.all(versions.map(async (v) => {
				const image = await workflow.image(args, v.id);
				return {
					data: Buffer.from(image.base64, "base64"),
					name: `${v.id} ${v.ratio}`,
					mediaType: image.mime
				};
			}));
			const refs = await attachments.saveImages(images);
			return {
				run,
				versions,
				images: images.map((i, index) => ({
					name: i.name,
					attachment: refs[index]
				}))
			};
		}
	}));
	tools.register(defineTool({
		name: "creator_review_cover",
		description: "Save a concrete visual review only after reading this version's actual image. pass can select it as the current ratio; needs_changes preserves the existing selected cover. Describe text, ratio, composition and factual consistency. Do not claim pass when images cannot be viewed.",
		parameters: {
			id: scopeParameters.id,
			folderPath: scopeParameters.folderPath,
			versionId: {
				type: "string",
				required: true
			},
			verdict: {
				type: "string",
				required: true,
				enum: ["pass", "needs_changes"]
			},
			note: {
				type: "string",
				required: true
			},
			select: { type: "boolean" }
		},
		output: jsonOutput,
		presentCall: (args) => present$3("保存封面质检", args),
		execute: async (args, exec) => workflow.action({
			...args,
			action: "review",
			verdict: args.verdict
		}, exec.signal)
	}));
}
//#endregion
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
z.discriminatedUnion("action", [
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
//#region src/covers/files.ts
const MAX_IMAGE_BYTES = 25165824;
const emptyCovers = () => ({
	versions: [],
	selected: {},
	runs: []
});
const tails$1 = /* @__PURE__ */ new Map();
function coverLock(key, operation) {
	const result = (tails$1.get(key) ?? Promise.resolve()).then(operation, operation);
	const settled = result.then(() => void 0, () => void 0);
	tails$1.set(key, settled);
	settled.then(() => {
		if (tails$1.get(key) === settled) tails$1.delete(key);
	});
	return result;
}
function validId(id) {
	return /^[a-f0-9-]{36}$/i.test(id);
}
async function ownedDirectory(folder, ...parts) {
	let path = folder;
	for (const part of [
		".dsh-creator-workbench",
		"covers",
		...parts
	]) {
		if (!part || /[\\/]/.test(part) || part === "." || part === "..") throw new Error("无效的封面目录。");
		path = join(path, part);
		await mkdir(path).catch((e) => {
			if (e.code !== "EEXIST") throw e;
		});
		const info = await lstat(path);
		if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("封面目录不能是链接。");
	}
	return path;
}
async function boundedFile(folder, file) {
	if (isAbsolute(file)) throw new Error("封面记录必须使用相对路径。");
	const path = join(folder, file), root = await realpath(folder), actual = await realpath(path);
	const rel = relative(root, actual);
	if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error("封面文件超出内容目录。");
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink()) throw new Error("封面必须是普通文件。");
	return path;
}
async function atomicJson(path, value) {
	const temp = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temp, JSON.stringify(value, null, 2), {
		encoding: "utf8",
		flag: "wx"
	});
	for (let attempt = 0;; attempt++) try {
		await rename(temp, path);
		break;
	} catch (error) {
		if (attempt >= 5 || ![
			"EPERM",
			"EBUSY",
			"EACCES"
		].includes(error.code ?? "")) throw error;
		await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
	}
}
async function readCoverState(folder) {
	try {
		return coverStateSchema.parse(JSON.parse(await readFile(join(folder, ".dsh-creator-workbench", "covers", "index.json"), "utf8")));
	} catch (error) {
		if (error.code === "ENOENT") return emptyCovers();
		throw new Error("封面记录无法读取，请保留文件并检查 index.json。");
	}
}
async function writeCoverState(folder, state) {
	const dir = await ownedDirectory(folder);
	await atomicJson(join(dir, "index.json"), state);
}
function imageKind(bytes) {
	const b = Buffer.from(bytes);
	if (b.length < 12 || b.length > 25165824) throw new Error("图片为空、损坏或超过 24 MB。");
	if (b.subarray(0, 8).equals(Buffer.from([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]))) return {
		mime: "image/png",
		extension: "png"
	};
	if (b[0] === 255 && b[1] === 216 && b[2] === 255) return {
		mime: "image/jpeg",
		extension: "jpg"
	};
	if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return {
		mime: "image/webp",
		extension: "webp"
	};
	throw new Error("只支持有效的 PNG、JPEG 或 WebP 图片。");
}
async function mediaCommand(command, args, signal) {
	let executable = command;
	if (process.platform === "win32") {
		const installed = `C:/ffmpeg/bin/${command}.exe`;
		if (await access(installed).then(() => true, () => false)) executable = installed;
	}
	return new Promise((resolve, reject) => {
		execFile(executable, args, {
			encoding: "utf8",
			windowsHide: true,
			timeout: 6e4,
			maxBuffer: 2097152,
			...signal ? { signal } : {}
		}, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}
async function inspectImage(path, signal) {
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink() || info.size > 25165824) throw new Error("图片必须是小于 24 MB 的普通文件。");
	const { mime } = imageKind(await readFile(path));
	try {
		const { width, height } = JSON.parse(await mediaCommand("ffprobe", [
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"json",
			path
		], signal)).streams?.[0] ?? {};
		if (!(width > 0 && height > 0 && width * height <= 48e6)) throw new Error("invalid dimensions");
		await mediaCommand("ffmpeg", [
			"-v",
			"error",
			"-xerror",
			"-i",
			path,
			"-frames:v",
			"1",
			"-f",
			"null",
			"-"
		], signal);
		return {
			mime,
			width,
			height
		};
	} catch {
		throw new Error("图片无法解码，或本机 ffmpeg/ffprobe 不可用。");
	}
}
function assertRatio(width, height, ratio) {
	const [w, h] = ratio.split("x").map(Number);
	if (!w || !h || Math.abs(width / height - w / h) > .015) throw new Error(`图片为 ${width}×${height}，不符合 ${ratio.replace("x", ":")}；请提供符合画幅的图片。`);
}
async function saveVersionBytes(folder, version, bytes, signal) {
	const { extension } = imageKind(bytes);
	const dir = await ownedDirectory(folder, "versions", version.id);
	const path = join(dir, `cover.${extension}`);
	await writeFile(path, bytes, { flag: "wx" });
	const image = await inspectImage(path, signal);
	assertRatio(image.width, image.height, version.ratio);
	return {
		...version,
		...image,
		file: relative(folder, path)
	};
}
//#endregion
//#region src/production/types.ts
const ASR_CREDENTIAL = "CREATOR_VOLC_ASR_API_KEY";
const emptyProduction = () => ({
	schemaVersion: 1,
	tasks: [],
	transcripts: [],
	articles: [],
	drafts: [],
	metrics: []
});
const isActiveTask = (task) => [
	"queued",
	"running",
	"waiting-agent"
].includes(task.status);
const sameMedia = (left, right) => left.name === right.name && left.size === right.size && left.sha256 === right.sha256;
const publisherPlatform = (platform) => platform === "wechat" ? "wechat_channels" : platform;
//#endregion
//#region src/production/storage.ts
const tails = /* @__PURE__ */ new Map();
function locked(key, work) {
	const result = (tails.get(key) ?? Promise.resolve()).then(work, work), settled = result.then(() => void 0, () => void 0);
	tails.set(key, settled);
	settled.then(() => {
		if (tails.get(key) === settled) tails.delete(key);
	});
	return result;
}
async function atomic(path, value) {
	const temp = `${path}.${randomUUID()}.tmp`;
	await writeFile(temp, JSON.stringify(value, null, 2), {
		encoding: "utf8",
		flag: "wx"
	});
	for (let n = 0;; n++) try {
		await rename(temp, path);
		return;
	} catch (cause) {
		if (n === 5 || ![
			"EPERM",
			"EBUSY",
			"EACCES"
		].includes(cause.code ?? "")) throw cause;
		await new Promise((r) => setTimeout(r, 30 * (n + 1)));
	}
}
async function readJson$1(path, fallback) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (cause) {
		if (cause.code === "ENOENT") return fallback();
		throw new Error("记录无法读取，请保留文件并检查后重试。");
	}
}
async function owned(folder, ...parts) {
	let path = await realpath(folder);
	for (const name of [
		".dsh-creator-workbench",
		"production",
		...parts
	]) {
		if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === "." || name === "..") throw new Error("无效的任务目录。");
		path = join(path, name);
		await mkdir(path).catch((e) => {
			if (e.code !== "EEXIST") throw e;
		});
		const info = await lstat(path);
		if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("任务目录不能使用链接。");
	}
	return path;
}
async function inside(folder, file) {
	const root = await realpath(folder), path = isAbsolute(file) ? file : join(root, file), actual = await realpath(path), rel = relative(root, actual);
	if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../")) throw new Error("文件超出本期目录。");
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink()) throw new Error("请使用普通文件。");
	return actual;
}
async function hashFile(path, signal) {
	const hash = createHash("sha256"), stream = createReadStream(path, signal ? { signal } : {});
	for await (const chunk of stream) hash.update(chunk);
	return hash.digest("hex");
}
const hashText = (text) => createHash("sha256").update(text).digest("hex");
async function mediaIdentity(path, signal) {
	const before = await stat(path), sha256 = await hashFile(path, signal), after = await stat(path);
	if (!before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("视频在读取时发生变化，请重新准备。");
	return {
		name: path.split(/[\\/]/).pop(),
		size: before.size,
		modifiedAt: before.mtimeMs,
		sha256
	};
}
async function readState(folder) {
	let directory = await realpath(folder);
	for (const name of [".dsh-creator-workbench", "production"]) {
		directory = join(directory, name);
		const info = await lstat(directory).catch((error) => {
			if (error.code === "ENOENT") return void 0;
			throw error;
		});
		if (!info) return emptyProduction();
		if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("任务目录不能使用链接。");
	}
	const file = join(directory, "index.json");
	const info = await lstat(file).catch((error) => {
		if (error.code === "ENOENT") return void 0;
		throw error;
	});
	if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("任务记录必须为普通文件。");
	const state = await readJson$1(file, emptyProduction);
	if (![1, 2].includes(state.schemaVersion) || ![
		state.tasks,
		state.transcripts,
		state.articles,
		state.drafts,
		state.metrics
	].every(Array.isArray)) throw new Error("任务记录格式不受支持。");
	return state;
}
async function updateState(folder, work) {
	return locked(folder, async () => {
		const state = await readState(folder), result = await work(state), dir = await owned(folder);
		if (state.schemaVersion === 1) {
			const previous = await readFile(join(dir, "index.json"), "utf8").catch((error) => {
				if (error.code === "ENOENT") return void 0;
				throw error;
			});
			if (previous) await writeFile(join(dir, "index-v1.backup.json"), previous, {
				encoding: "utf8",
				flag: "wx"
			}).catch((error) => {
				if (error.code !== "EEXIST") throw error;
			});
			state.schemaVersion = 2;
		}
		await atomic(join(dir, "index.json"), state);
		return result;
	});
}
const emptySettings = () => ({
	revision: randomUUID(),
	accounts: {},
	accountHistory: [],
	observations: {},
	browserPaused: false,
	wechat: {
		appid: "",
		theme: "claude-editorial",
		author: ""
	}
});
async function readSettings(dataDir) {
	await mkdir(dataDir, { recursive: true });
	const path = join(dataDir, "production-settings.json");
	try {
		await writeFile(path, JSON.stringify(emptySettings(), null, 2), {
			encoding: "utf8",
			flag: "wx"
		});
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
	const value = await readJson$1(path, emptySettings);
	if (!value.revision || !value.accounts || !Array.isArray(value.accountHistory) || !value.wechat) throw new Error("发布设置无法读取。");
	return value;
}
async function updateSettings(dataDir, work) {
	return locked(`settings:${dataDir}`, async () => {
		const settings = await readSettings(dataDir), result = await work(settings);
		settings.revision = randomUUID();
		await atomic(join(dataDir, "production-settings.json"), settings);
		return result;
	});
}
const wechatCredential = (appid) => `CREATOR_WECHAT_SECRET_${hashText(appid).slice(0, 16).toUpperCase()}`;
//#endregion
//#region src/production/publicationArticle.ts
const isHtmlBody = (body) => /^\s*(?:<!doctype\s+html|<(?:html|head|style|script|body|article|section|div|p|h[1-6])\b)/i.test(body.replace(/<!--([\s\S]*?)-->/g, ""));
/** Store platform copy with its own resource base and explicit article image order. */
async function platformArticleBody(folder, dir, body, sourceFile, selected) {
	const pattern = /!\[([^\]]*)\]\(([^)]+)\)|<img\b[^>]*>/gi;
	const refs = [...body.matchAll(pattern)];
	const html = isHtmlBody(body);
	const resolve = async (value) => {
		try {
			return await inside(folder, join(dir, decodeURIComponent(value)));
		} catch (error) {
			if (error.code !== "ENOENT" || !sourceFile) throw error;
			return inside(folder, join(dirname(await inside(folder, sourceFile)), decodeURIComponent(value)));
		}
	};
	const paths = await Promise.all(refs.map(async (ref) => {
		const value = ref[2]?.split(/\s+["']/)[0] ?? ref[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
		if (!value || /^(?:https?:|data:|file:|\/\/)/i.test(value)) return void 0;
		try {
			return await resolve(value);
		} catch (error) {
			if (selected !== void 0) return void 0;
			throw error;
		}
	}));
	const targets = selected ? await Promise.all(selected.map((file) => inside(folder, file))) : void 0;
	const localRef = (file, alt, asHtml) => {
		const value = relative(dir, file).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
		return asHtml ? `<img src="${value}" alt="${alt.replace(/[&<>"']/g, "")}">` : `![${alt.replace(/[\[\]]/g, "")}](${value})`;
	};
	let index = 0;
	const result = body.replace(pattern, () => {
		const current = index++, ref = refs[current], asHtml = ref[0].startsWith("<");
		const target = targets ? targets[current] : paths[current];
		if (targets && !target) return "";
		if (!target) return ref[0];
		const original = targets ? paths.findIndex((path) => path?.toLowerCase() === target.toLowerCase()) : current;
		const originalRef = refs[original];
		const alt = originalRef?.[1] ?? originalRef?.[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "配图";
		return localRef(target, alt, asHtml);
	});
	return targets && targets.length > refs.length ? result + targets.slice(refs.length).map((file) => `\n\n${localRef(file, "配图", html)}`).join("") : result;
}
/** Rebase actual project resources into an immutable task-owned article, never edit its source. */
async function snapshotPublicationArticle(folder, dir, publication, body, images, format, repairIncomplete = false) {
	const source = await inside(folder, publication.bodyFile);
	const complete = async (file, bytes) => {
		try {
			await writeFile(file, bytes, { flag: "wx" });
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			const actual = await inside(folder, file);
			if ((await readFile(actual)).equals(bytes)) return;
			if (!repairIncomplete) throw new Error("本次文章快照与原提交不一致，请核对原任务。");
			await rename(actual, `${actual}.incomplete-${randomUUID()}`);
			await writeFile(file, bytes, { flag: "wx" });
		}
	};
	const html = format ? format === "html" : isHtmlBody(body) || /\.html?$/i.test(publication.articleFile ?? source) && /<\w+[\s>]/.test(body), refs = [...body.matchAll(html ? /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi : /!\[[^\]]*\]\(([^)]+)\)/g)];
	let rendered = body;
	const freeze = async (path) => {
		const bytes = await readFile(await inside(folder, path));
		if (bytes.length > 25165824) throw new Error("文章配图超过 24 MB，请先处理后再上传。");
		const name = `article-image-${hashText(bytes.toString("base64"))}${extname(path).toLowerCase()}`, target = join(dir, name);
		await complete(target, bytes);
		return name;
	};
	for (const match of refs) {
		const encoded = match[1].split(/\s+["']/)[0];
		const value = html ? encoded.replaceAll("&amp;", "&").replaceAll("&#38;", "&").replaceAll("&#x26;", "&") : encoded;
		if (/^(?:https?:|file:|data:|\/\/)/i.test(value)) {
			if (!value.startsWith("data:")) throw new Error("请先将文章配图导入本项目。");
			continue;
		}
		let file;
		try {
			file = await inside(folder, join(dirname(source), decodeURIComponent(value)));
		} catch (error) {
			if (error.code !== "ENOENT" || !publication.articleFile) throw error;
			const origin = await inside(folder, publication.articleFile);
			file = await inside(folder, join(dirname(origin), decodeURIComponent(value)));
		}
		const target = await freeze(file);
		rendered = rendered.split(match[0]).join(match[0].replace(encoded, target));
	}
	if (!refs.length && images.length) for (const file of images) {
		const local = await freeze(file);
		rendered += html ? `\n<p><img src="${local}" alt="配图"></p>` : `\n\n![配图](${local})`;
	}
	const file = join(dir, html ? "publication-body.html" : "publication-body.md");
	await complete(file, Buffer.from(rendered, "utf8"));
	return file;
}
/** Render a separately titled platform body without altering its frozen submission. */
async function publicationArticleForRender(folder, article, title) {
	const source = await inside(folder, article);
	if (/\.html?$/i.test(source)) return source;
	const body = await readFile(source, "utf8");
	const rendered = `# ${title.replace(/[\r\n]+/g, " ").trim()}\n\n${body.replace(/^\uFEFF?\s*#\s+[^\r\n]*(?:\r?\n|$)/, "").trimStart()}`;
	const file = join(dirname(source), `publication-render-${hashText(rendered)}.md`);
	try {
		await writeFile(file, rendered, {
			encoding: "utf8",
			flag: "wx"
		});
	} catch (error) {
		if (error.code !== "EEXIST" || await readFile(file, "utf8") !== rendered) throw error;
	}
	return file;
}
//#endregion
//#region src/production/creations.ts
async function saveCreationImage(folder, bytes, options, signal) {
	const id = options.id ?? randomUUID(), dir = await owned(folder, "images", id), file = join(dir, `image.${imageKind(bytes).extension}`);
	try {
		await writeFile(file, bytes, { flag: "wx" });
	} catch (error) {
		if (error.code !== "EEXIST" || !(await readFile(file)).equals(Buffer.from(bytes))) throw error;
	}
	return {
		id,
		...await inspectImage(file, signal),
		file: relative(folder, file),
		sha256: await hashFile(file, signal),
		createdAt: Date.now(),
		source: options.source,
		purpose: options.purpose,
		...options.taskId ? { taskId: options.taskId } : {}
	};
}
async function importCreationImage(folder, source, purpose, signal, assertAvailable) {
	const info = await lstat(source);
	if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > 25165824) throw new Error("请选择小于 24 MB 的普通图片文件。");
	const digest = await hashFile(source, signal);
	if ((await readState(folder)).images?.some((i) => !i.hidden && i.sha256 === digest)) return;
	const image = await saveCreationImage(folder, await readFile(source), {
		purpose,
		source: "imported"
	}, signal);
	await updateState(folder, async (state) => {
		await assertAvailable?.();
		if (!state.images?.some((i) => !i.hidden && i.sha256 === image.sha256)) (state.images ??= []).push(image);
	});
}
async function creationImage(folder, id, state) {
	const image = (state ?? await readState(folder)).images?.find((row) => row.id === id && !row.hidden);
	if (!image) throw new Error("图片不存在或已移除，请重新选择。");
	const file = await inside(folder, image.file);
	if (await hashFile(file) !== image.sha256) throw new Error("图片文件已被修改，请重新导入确认。");
	return {
		image,
		file
	};
}
async function readCreationSource(folder, source, state) {
	const pieces = [source.text ?? ""];
	const files = [...source.files ?? []];
	if (source.articleId) {
		const article = state.articles.find((row) => row.id === source.articleId);
		if (!article) throw new Error("来源文章不存在。");
		files.push(article.file);
	}
	if (source.kind === "topic" && !files.length) {
		const topic = await inside(folder, "topic.md").then((file) => readFile(file, "utf8")).catch((error) => {
			if (error.code === "ENOENT") return "";
			throw error;
		});
		if (topic) pieces.push(topic);
	}
	for (const name of [...new Set(files)]) {
		const file = await inside(folder, name);
		if ((await lstat(file)).size > 2097152) throw new Error("文字材料超过 2 MB，请选取本次需要的内容。");
		pieces.push(`材料：${name}\n${await readFile(file, "utf8")}`);
	}
	return pieces.filter(Boolean).join("\n\n");
}
async function savePublication(folder, input, id, expectedRevision, assertAvailable, saveId) {
	if (saveId !== void 0 && !/^[a-zA-Z0-9_-]{1,128}$/.test(saveId)) throw new Error("保存请求标识无效。");
	input = structuredClone(input);
	if (input.type === "images" && input.coverImageId) input = {
		...input,
		imageIds: [input.coverImageId, ...input.imageIds.filter((imageId) => imageId !== input.coverImageId)]
	};
	if (new Set(input.imageIds).size !== input.imageIds.length) throw new Error("图集内同一张图片请只选择一次。");
	if (input.platform === "wechat" && input.type !== "video") throw new Error("本轮视频号只支持视频。");
	if (input.platform === "official-account" && input.type !== "article") throw new Error("公众号请选择文章。");
	if (input.type === "article" && !["bilibili", "official-account"].includes(input.platform)) throw new Error("此平台请准备图片和独立文案。");
	const inputHash = hashText(JSON.stringify({
		id: id ?? null,
		expectedRevision: expectedRevision ?? null,
		input
	}));
	return updateState(folder, async (state) => {
		await assertAvailable?.();
		const receipt = saveId ? state.publicationSaves?.find((row) => row.saveId === saveId) : void 0;
		if (receipt) {
			if (receipt.inputHash !== inputHash) throw new Error("此保存请求已用于另一份内容，请保留输入并重新核对。");
			return {
				...receipt.result,
				body: await readFile(await inside(folder, receipt.result.bodyFile), "utf8")
			};
		}
		const old = id ? state.publications?.find((p) => p.id === id && !p.hidden) : void 0;
		if (id && (!old || old.revision !== expectedRevision)) throw new Error("发布内容已被修改或移除，输入已保留，请重新读取后合并。");
		if (old && (old.platform !== input.platform || old.type !== input.type)) throw new Error("请为其他平台或形式另建发布内容，原材料归属保持不变。");
		for (const imageId of [...input.imageIds, ...input.coverImageId ? [input.coverImageId] : []]) await creationImage(folder, imageId, state);
		if (input.video) await inside(folder, input.video);
		if (input.articleFile) await inside(folder, input.articleFile);
		if (input.articleId && !state.articles.some((a) => a.id === input.articleId)) throw new Error("文章版本不存在。");
		for (const file of Object.values(input.coverFiles ?? {})) if (file) await inside(folder, file);
		const operation = saveId ? hashText(saveId) : randomUUID();
		const publicationId = old?.id ?? (saveId ? `pub-${operation.slice(0, 32)}` : randomUUID()), revision = (old?.revision ?? 0) + 1;
		const dir = await owned(folder, "publications", publicationId), file = join(dir, `body-${revision}-${operation}.md`);
		if (saveId) {
			const manifest = join(dir, `save-${operation}.json`), value = {
				inputHash,
				publicationId,
				revision
			};
			if (await lstat(manifest).catch((e) => {
				if (e.code === "ENOENT") return void 0;
				throw e;
			})) {
				if (JSON.stringify(JSON.parse(await readFile(await inside(folder, manifest), "utf8"))) !== JSON.stringify(value)) throw new Error("保存记录与本次输入不符，请保留草稿核对。");
			} else await atomic(manifest, value);
		}
		const body = input.type === "article" ? await platformArticleBody(folder, dir, input.body, input.articleFile, input.imageIds.length || old?.imageIds.length ? input.imageIds.map((id) => state.images.find((image) => image.id === id).file) : void 0) : input.body;
		try {
			await writeFile(file, body, {
				encoding: "utf8",
				flag: "wx"
			});
		} catch (error) {
			if (error.code !== "EEXIST" || !saveId) throw error;
			const actual = await inside(folder, file);
			if (await readFile(actual, "utf8") !== body) {
				if (state.publications?.some((p) => p.bodyFile === relative(folder, file)) || state.publicationSaves?.some((r) => r.result.bodyFile === relative(folder, file))) throw new Error("已有发布正文发生变化，请核对原材料。");
				await rename(actual, `${actual}.incomplete-${randomUUID()}`);
				await writeFile(file, body, {
					encoding: "utf8",
					flag: "wx"
				});
			}
		}
		const { body: _body, ...fields } = structuredClone(input);
		const sourceHash = input.source ? old?.sourceHash && JSON.stringify(old.source) === JSON.stringify(input.source) ? old.sourceHash : hashText(await readCreationSource(folder, input.source, state)) : void 0;
		const draft = {
			...fields,
			id: publicationId,
			revision,
			bodyFile: relative(folder, file),
			...sourceHash ? { sourceHash } : {},
			createdAt: old?.createdAt ?? Date.now(),
			updatedAt: Date.now()
		};
		const rows = state.publications ??= [], index = rows.findIndex((p) => p.id === publicationId);
		if (index < 0) rows.push(draft);
		else rows[index] = draft;
		if (saveId) (state.publicationSaves ??= []).push({
			saveId,
			inputHash,
			...id ? { requestedId: id } : {},
			...expectedRevision ? { expectedRevision } : {},
			result: structuredClone(draft)
		});
		return {
			...draft,
			body
		};
	});
}
async function hydrateCreations(folder, state) {
	const { publicationSaves: _receipts, ...publicState } = state;
	if (!state.publications?.length) return publicState;
	const body = async (p) => {
		if (p.hidden) return {};
		try {
			return { body: await readFile(await inside(folder, p.bodyFile), "utf8") };
		} catch {
			return { bodyError: "正文文件无法读取，请保留当前材料并检查文件。" };
		}
	};
	return {
		...publicState,
		publications: await Promise.all(state.publications.map(async (p) => ({
			...p,
			...await body(p),
			...p.source && p.sourceHash ? { sourceChanged: await readCreationSource(folder, p.source, state).then((text) => hashText(text) !== p.sourceHash, () => true) } : {}
		})))
	};
}
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
	title: z.string().max(500),
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
z.object({
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
		parentArticleId: z.string().optional(),
		saveInputHash: z.string().optional(),
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
z.object({
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
		saveId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),
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
		newUploadAfter: z.string().optional(),
		expectedAccountId: z.string().min(1).optional()
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
		recordId: z.string().optional(),
		remoteId: z.string().min(1).optional(),
		expectedAccountId: z.string().min(1).optional(),
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
		url: z.string().optional(),
		expectedAccountId: z.string().min(1).optional(),
		candidateAccountId: z.string().min(1).optional()
	})
]);
z.discriminatedUnion("action", [
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
//#endregion
//#region src/production/tools.ts
const scope = {
	id: {
		type: "string",
		required: true
	},
	folderPath: {
		type: "string",
		required: true
	}
};
const taskScope = {
	...scope,
	taskId: {
		type: "string",
		required: true
	}
};
const output = {
	schema: { type: "json" },
	render: (_args, result) => [{
		type: "text",
		text: JSON.stringify(result)
	}]
};
const present$2 = (title, rawInput) => ({
	card: "generic",
	title,
	kind: "execute",
	rawInput
});
function registerProductionTools(ctx, workflow) {
	const tools = ctx.get("tools"), attachments = ctx.get("attachments");
	tools.register(defineTool({
		name: "creator_read_article_source",
		description: "Read an existing project's exact article version source, format and content hash before editing. ArticleId is from production state. No video prerequisite; no new workspace or generation task.",
		parameters: {
			...scope,
			articleId: {
				type: "string",
				required: true
			}
		},
		output,
		execute: async (args) => workflow.readArticleVersion(args)
	}));
	tools.register(defineTool({
		name: "creator_save_article_revision",
		description: "Save edits to an existing article as a new immutable version and HTML preview. First read creator_read_article_source; provide its articleId and expectedSourceHash, edited source and stable unique saveId (reuse same saveId for a transport retry). Retain Markdown/HTML format and original resources. Never overwrite original, platform material or submission snapshot. A preview error after saving preserves the new article; do not save again for formatting.",
		parameters: {
			...scope,
			articleId: {
				type: "string",
				required: true
			},
			expectedSourceHash: {
				type: "string",
				required: true
			},
			source: {
				type: "string",
				required: true
			},
			saveId: {
				type: "string",
				required: true
			}
		},
		output,
		execute: async (args, exec) => {
			const saved = await workflow.editArticleVersion(args, exec.signal);
			return {
				article: saved.article,
				sourceHash: saved.sourceHash,
				...saved.preview ? { previewPath: saved.preview.path } : {},
				...saved.previewError ? { previewError: saved.previewError } : {}
			};
		}
	}));
	tools.register(defineTool({
		name: "creator_production_state",
		description: "Read account-bound publishing, ASR, article, WeChat draft and metrics records for the exact episode. Script and subtitles are optional for finished-video uploads. Never equate uploaded/draft with published.",
		parameters: scope,
		output,
		presentCall: (args) => present$2("查看内容任务", args),
		execute: async (args) => workflow.state(args)
	}));
	tools.register(defineTool({
		name: "creator_production_action",
		description: "Run an approved account-bound workbench action. action is an object including id, folderPath and action. Supported actions: register-article(file in project,source,imageIds) for normal file-tool-created Markdown/HTML; import-article(sourcePath) copies a user-selected article; import-image(sourcePath,purpose), remove-image(imageId), generate-images(items prompt/ratio/purpose/references), retry-images(taskId,itemIds), save-publication(input independent copy/ordered imageIds/platform/type, expectedRevision for updates, stable saveId reused only for exact retries), remove-publication, upload-publication(publicationId,expectedRevision,originalRightsConfirmed), upload(input platform/title/description/tags/originalRightsConfirmed/useCovers), transcribe, import-subtitle(sourcePath), cancel/resume-upload/inspect-upload(taskId), wechat-preview/wechat-draft, refresh-metrics(publicationId/recordId/expectedAccountId), associate-publication(platform/remoteId/expectedAccountId, candidateAccountId when choosing a candidate). Original rights must have explicit user evidence. Never make final publication, auto-retry an unconfirmed paid request or replace an account. For independent writing use prepare-article with a source object with kind topic/materials/article and text/files/articleId; video source retains real evidence. For articles, prepare-article creates or resumes a request in the exact content folder; then use creator_prepare_article and creator_save_article with its taskId. Any conversation may work on that request. Credentials only via settings, never read or pass keys.",
		parameters: { action: {
			type: "json",
			required: true
		} },
		output,
		presentCall: (args) => present$2("处理内容任务", args),
		execute: async (args, exec) => {
			const request = productionActionSchema.parse(args.action);
			if (["save-article"].includes(request.action)) throw new Error("此操作请使用专用入口或在工作台明确关联。");
			return workflow.action((request.action === "prepare-article" || request.action === "generate-images") && exec.agent?.session.id ? {
				...request,
				sessionId: exec.agent.session.id
			} : request, exec.signal);
		}
	}));
	tools.register(defineTool({
		name: "creator_prepare_article",
		description: "Read the exact article request's source materials; video sources include real transcript and image attachments. Independent articles need no video. Returns the bundled WeWrite writing Skill entry. Read that Skill and its mature writing/quality references. If transcript is pending, wait for returned Harness jobId then call again. Inspect images and preserve source facts. Save with creator_save_article for formatted HTML delivery; no final publication.",
		parameters: taskScope,
		output: {
			...output,
			render: (_args, result) => {
				const value = result;
				return [{
					type: "text",
					text: JSON.stringify({
						task: value.task,
						transcript: value.transcript,
						rules: value.rules,
						outputDirectory: value.outputDirectory,
						waiting: value.waiting,
						jobId: value.jobId,
						frames: value.images.map(({ file, at }) => ({
							file,
							at
						}))
					})
				}, ...value.images.map((image) => ({
					type: "image",
					attachment: image.attachment
				}))];
			}
		},
		presentCall: (args) => present$2("准备文章材料", args),
		execute: async (args, exec) => {
			const { frames = [], ...result } = await workflow.articleInputs(args, args.taskId, exec.agent?.session.id, exec.signal);
			const refs = await attachments.saveImages(frames.map((frame) => ({
				data: frame.data,
				name: result.task.video ? `${frame.at}s ${frame.file}` : frame.file,
				mediaType: "image/jpeg"
			})));
			return {
				...result,
				images: frames.map((frame, i) => ({
					file: frame.file,
					at: frame.at,
					attachment: refs[i]
				}))
			};
		}
	}));
	tools.register(defineTool({
		name: "creator_save_article",
		description: "Save the WeWrite article source as a new version and render a standalone themed HTML with real images. Markdown input needs an H1 title and this request's real frames or registered project images with relative paths and imageIds. Independent articles do not require video or transcript. Keep original facts and distinguish uncertain speech. Deliver HTML from the returned article task receipt, resolved under folderPath. If formatting is blocked, the source is preserved; retry formatting in the article panel instead of saving again. Never overwrite another article version or publish.",
		parameters: {
			...taskScope,
			markdown: {
				type: "string",
				required: true
			},
			imageIds: {
				type: "array",
				items: { type: "string" }
			}
		},
		output,
		presentCall: (args) => present$2("保存并排版公众号文章", args),
		execute: async (args, exec) => workflow.action({
			...args,
			action: "save-article",
			...exec.agent?.session.id ? { sessionId: exec.agent.session.id } : {}
		}, exec.signal)
	}));
	tools.register(defineTool({
		name: "creator_read_images",
		description: "Read registered project image IDs as actual image attachments for visual inspection, reuse and publication selection. Never claim inspection without seeing images.",
		parameters: {
			...scope,
			imageIds: {
				type: "array",
				required: true,
				items: { type: "string" }
			}
		},
		output: {
			...output,
			render: (_args, value) => {
				const result = value;
				return [{
					type: "text",
					text: JSON.stringify({ imageIds: result.images.map((i) => i.id) })
				}, ...result.images.map((i) => ({
					type: "image",
					attachment: i.attachment
				}))];
			}
		},
		execute: async (args, exec) => {
			await workflow.host.resolve(args);
			exec.signal.throwIfAborted();
			const selected = await Promise.all(args.imageIds.map((id) => creationImage(args.folderPath, id)));
			const refs = await attachments.saveImages(await Promise.all(selected.map(async ({ image, file }) => ({
				data: await readFile(file),
				name: image.id,
				mediaType: image.mime
			}))));
			return { images: selected.map(({ image }, i) => ({
				id: image.id,
				attachment: refs[i]
			})) };
		}
	}));
}
//#endregion
//#region src/config.ts
function defaultLibraryRoot(platform = process.platform) {
	const videos = platform === "darwin" ? "Movies" : "Videos";
	return join(homedir(), videos, "视频项目");
}
function defaultDataDir() {
	return join(homedir(), ".dsh-creator-workbench");
}
function defaultSubtitleSkillDir() {
	return join(homedir(), ".claude", "skills", "oil-subtitle");
}
function defaultCoverSkillDir() {
	return join(homedir(), ".claude", "skills", "oil-cover");
}
function skillDirCandidates(skillName, home = homedir()) {
	return [
		join(home, ".claude", "skills", skillName),
		join(home, ".codex", "skills", skillName),
		join(home, ".agents", "skills", skillName),
		join(home, ".grok", "skills", skillName)
	];
}
function joinUnderHome(home, rest) {
	return join(home, ...rest.replaceAll("\\", "/").split("/").filter(Boolean));
}
function expandHomePath(path, home = homedir()) {
	const trimmed = path.trim();
	if (trimmed === "~" || trimmed === "%USERPROFILE%" || trimmed === "%HOME%") return home;
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return joinUnderHome(home, trimmed.slice(2));
	const windowsHome = /^%(?:USERPROFILE|HOME)%([\\/].*)?$/i.exec(trimmed);
	if (windowsHome !== null) {
		const rest = windowsHome[1];
		return rest === void 0 || rest === "" ? home : joinUnderHome(home, rest);
	}
	return trimmed;
}
defaultLibraryRoot();
const Config = Schema.object({
	libraryRoot: Schema.string().default(defaultLibraryRoot()),
	dataDir: Schema.string().default(defaultDataDir()),
	subtitleSkillDir: Schema.string().default(""),
	coverSkillDir: Schema.string().default("")
});
function resolveDataDir(config) {
	return config.dataDir === "" ? defaultDataDir() : config.dataDir;
}
function resolveSkillDir(configured, skillName, envValue) {
	if (configured.trim() !== "") return expandHomePath(configured);
	if (envValue !== void 0 && envValue.trim() !== "") return expandHomePath(envValue);
	return skillDirCandidates(skillName).find((candidate) => existsSync(candidate)) ?? skillDirCandidates(skillName)[0];
}
//#endregion
//#region src/backgroundJobs.ts
const BACKGROUND_OUTPUT = {
	type: "object",
	additionalProperties: false,
	properties: {
		kind: {
			type: "string",
			required: true,
			const: "background"
		},
		jobId: {
			type: "string",
			required: true
		}
	}
};
function message(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
function present$1(title, rawInput) {
	return {
		card: "generic",
		title,
		kind: "execute",
		rawInput
	};
}
function backgroundOutput() {
	return {
		schema: BACKGROUND_OUTPUT,
		render: (_args, value) => [{
			type: "text",
			text: `started background job ${value.jobId}`
		}]
	};
}
async function assertMediaIdle(service, id, fields, signal) {
	const detail = await service.getContent({ id }, signal);
	const running = fields.find((field) => detail[field].status === "running");
	if (running !== void 0) throw new Error(`${id}: ${running} is already running`);
}
function startExclusiveJob(jobs, active, key, spec, run) {
	if (active.has(key)) throw new Error(`${key}: background job is already running`);
	try {
		return jobs.start({
			...spec,
			run: () => {
				if (active.has(key)) throw new Error(`${key}: background job is already running`);
				const hooks = run();
				active.add(key);
				hooks.done.then(() => {
					active.delete(key);
				}, () => {
					active.delete(key);
				});
				return hooks;
			}
		});
	} catch (cause) {
		if (message(cause).includes("no job controller")) throw new Error("background jobs unavailable: use the Harness standard or code preset with @deepseek-ai/dsh-tool-jobs");
		throw cause;
	}
}
function mediaHooks(service, id, field, start) {
	const controller = new AbortController();
	return {
		cancel: (reason) => {
			if (!controller.signal.aborted) controller.abort(new Error(reason ?? "cancelled"));
		},
		done: (async () => {
			try {
				await start(controller.signal);
				const job = await service.waitForMediaJob(id, field, controller.signal);
				if (job.status === "done") return {
					status: "completed",
					detail: field,
					result: job.output ?? `${id}: completed`
				};
				return {
					status: "failed",
					detail: field,
					result: job.error ?? `${id}: failed`
				};
			} catch (cause) {
				if (controller.signal.aborted) {
					try {
						await service.cancelMediaJob(id, field);
					} catch (cleanupCause) {
						return {
							status: "failed",
							detail: "cancel cleanup failed",
							result: message(cleanupCause)
						};
					}
					return {
						status: "killed",
						detail: field,
						result: `${id}: cancelled`
					};
				}
				return {
					status: "failed",
					detail: field,
					result: message(cause)
				};
			}
		})()
	};
}
function registerCreatorJobTools(ctx, service) {
	const active = /* @__PURE__ */ new Set();
	ctx.tools.register(defineTool({
		name: "creator_burn_subtitles",
		description: "Burn the confirmed subtitle draft as a Harness background job. Open and confirm the subtitle preview first; use job_output with wait=true or job_kill for control.",
		parameters: { id: {
			type: "string",
			required: true,
			description: "Folder id."
		} },
		output: backgroundOutput(),
		presentCall: (args) => present$1("Burn subtitles", args),
		execute: async (args, exec) => {
			if (args.id.trim() === "") throw new Error("id is required");
			exec.signal.throwIfAborted();
			await assertMediaIdle(service, args.id, ["burn"], exec.signal);
			return {
				kind: "background",
				jobId: startExclusiveJob(ctx.jobs, active, `${args.id}:burn`, {
					kind: "creator-media",
					label: `Burn subtitles: ${args.id}`,
					...exec.agent === void 0 ? {} : { owner: exec.agent.session.id }
				}, () => mediaHooks(service, args.id, "burn", (signal) => service.startSubtitleBurn({ id: args.id }, signal)))
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_generate_subtitles",
		description: "Transcribe, review, and lay out subtitle drafts as a Harness background job. Completion opens the preview editor; use job_output with wait=true or job_kill for control.",
		parameters: { id: {
			type: "string",
			required: true,
			description: "Folder id."
		} },
		output: backgroundOutput(),
		presentCall: (args) => present$1("Generate subtitles", args),
		execute: async (args, exec) => {
			if (args.id.trim() === "") throw new Error("id is required");
			exec.signal.throwIfAborted();
			await assertMediaIdle(service, args.id, ["subtitleJob", "burn"], exec.signal);
			return {
				kind: "background",
				jobId: startExclusiveJob(ctx.jobs, active, `${args.id}:subtitleJob`, {
					kind: "creator-media",
					label: `Generate subtitles: ${args.id}`,
					...exec.agent === void 0 ? {} : { owner: exec.agent.session.id }
				}, () => mediaHooks(service, args.id, "subtitleJob", (signal) => service.startSubtitleGenerate({ id: args.id }, signal)))
			};
		}
	}));
}
//#endregion
//#region src/creatorSkill.ts
const CREATOR_WORKBENCH_SKILL = {
	name: "dsh-creator-workbench",
	description: "配置和使用内容工作台。首次使用、调整内容目录、整理目录、检查字幕/封面/发布能力，或推进一条内容时使用。",
	source: "runtime",
	invocation: {
		modelInvocable: true,
		userInvocable: true
	},
	content: `# 创作工作台

## 开始前

1. 用户不知道这个插件能做什么、怎么用，或你不确定下一步时，先调用 \`creator_guide\`；它会返回带当前能力状态的完整指引。
2. 配置或诊断环境调用 \`creator_setup\`，不要先向用户询问系统能够检查出来的信息。
3. 根据返回的 \`capabilities\` 区分核心能力和可选能力。内容目录是核心；字幕、封面和发布同步缺失时只降级对应环节。
4. 如果需要寻找目录，先用系统文件工具只读查看候选目录。不要扫描整个磁盘，不要读取与内容工作无关的私人文件。

## 配置

- 内容目录和 \`enabledPlatforms\` 通过 \`creator_setup\` 配置；这里不配置创作者名称或平台主页。
- 脚本规则（人设）通过 \`creator_script_rules\` 配置：写或改 script.md 前先读；用户第一次让你写脚本而没有规则时，根据本次要求写作，缺少必要信息时只问一个问题；用户明确长期偏好后再保存；之后把新的长期偏好合并进现有规则，不要整体覆盖。
- 候选内容目录不存在时，让用户在内容工作台的系统目录选择器中明确新建或选择目录；用户确认后再重新调用 \`creator_setup\` 预览。不要在默认位置或推测路径创建目录。
- 第一次带配置字段调用时保持 \`apply=false\`，把精确变更展示给用户。
- 只有用户确认后，才使用同一组字段和 \`apply=true\`。
- 不向用户索要 API Key 明文。字幕和封面凭据只能让用户在内容工作台的设置页通过 Harness Credentials 配置。
- 高级依赖路径由插件配置或环境自动发现；能自动发现时不要增加问题。

## 内容目录

- 磁盘文件是正文真源；工作台 overlay 只保存绑定、阶段和发布状态。
- 一集一个子目录，默认命名为 \`YYYY-MM-DD_可读标题\`。
- 先列目录，再读这一集需要的 \`topic.md\`、\`script.md\`、发布包、字幕或文章文件。
- 首次保存文件前先在工作台调用系统目录选择器。已确认资料位置后，创建新内容使用 \`creator_create_content\`；修改普通 Markdown 和 JSON 正文使用系统文件工具。

## 整理与发布安全

- 调用 \`creator_organize_library\` 时先预览，向用户列出改名前后；确认后才传 \`apply=true\`。它不删除文件。
- 发布默认准备草稿。上传和账号登录复用外部能力；最后点击发表始终由用户手动完成。
- 自动发布（\`video-publisher\` skill）和已发布数据回收（\`creator_sync_publish\`）只处理 \`enabledPlatforms\` 中的平台，都依赖 Ego Browser 和已登录的创作者后台；\`enabledPlatforms\` 为空时不执行发布或同步，先配置并确认启用平台。能力检查显示缺失时明确告诉用户这两项不可用，其余功能照常。

## 页面与成果

概览仅汇总已有成果；视频、脚本、字幕、文章、图片和发布各有页签。图片页管理项目配图与视频封面，发布页管理各平台独立文案、图序、上传及具体作品数据。

## 统一创作与平台发布

- 一个项目一个目录，不设置项目模式。脚本、文章、视频、配图和平台材料可独立制作、互相复用。已有上下文足够时连续执行用户的要求。
- 先用 creator_production_state 读取项目状态。独立文章调用 creator_production_action 的 prepare-article，source.kind 选 topic/materials/article 并提供已知 text/files/articleId；视频转文章选 video。随后 creator_prepare_article 读取输入和 WeWrite，再 creator_save_article 保存源稿与 HTML。
- 配图可调用 generate-images，items 每项含 prompt、ratio（3x4/4x3/16x9/1x1）、purpose（cover/illustration/card）、可选 references（已登记图片 ID）。等待实际 job，使用 creator_read_images 检查产物；retry-images 只重试指定未完成项。
- 修改既有文章先调用 creator_read_article_source 取得准确版本、格式和 sourceHash；再用 creator_save_article_revision 保存新版本，expectedSourceHash使用读取结果，saveId使用稳定唯一身份，通信重试沿用同一身份。保留原文格式与资源；预览失败不否定正文已保存，不因排版失败重复建版本。右侧文章页同样支持文稿编辑和未保存预览。
- 正常文件工具写出的本项目 Markdown/HTML 使用 register-article 登记，已有图片使用 import-image 登记。文章内配图须是本项目真实截图或已登记图片，并使用相对路径；save-article 传对应 imageIds。
- 各平台发布材料独立：save-publication 的 input 包含 platform、type（video/images/article）、title、body、tags、imageIds，以及需要的 video/articleId/articleFile/coverImageId/coverFiles/category/source。更新需要原 publicationId 与 expectedRevision，冲突保留用户编辑。
- 保存发布内容时为本次精确输入生成稳定saveId，通信重试沿用相同saveId和原参数；修改后的输入使用新saveId。创建后的平台与形式保持不变，复用到其他平台另建材料。本地草稿允许缺少标题或素材，上传前再检查必需材料。
- 关联作品前读取当前账号，将expectedAccountId随associate-publication提交；选择候选还传candidateAccountId。候选按平台、账号、作品标识区分，账号变化时重新选择。refresh-metrics可指定publicationId、recordId和expectedAccountId；不按标题或首条记录推定作品归属。
- 工作台自动保存只写本地材料。上传前等待本地保存成功并固定版本与expectedAccountId，上传、更新公众号远端草稿和最终发表分别需要明确操作；自动保存不触发这些远端行为。

- 图文支持小红书、抖音、B站；公众号用 article，视频号只用 video。小红书、抖音用有序图片组和独立正文，B站通过图文编辑器处理正文与图片；HTML 是文章阅读和公众号排版成品。
- upload-publication 需要已保存材料版本及用户明确发布授权。上传任务固定账号、类型和材料；中断先 inspect-upload/resume-upload，不能为绕开阻塞而新建。最终点击发表始终由用户操作。
- 自然语言操作直接执行；右侧按钮才需要把请求放入项目原生会话。项目目录与会话只用于定位，不限制其他会话处理明确项目；不要反复创建工作区。

## 当前视频

- 先调用 \`creator_get_content\` 读取视频候选与当前选择。多个候选时让用户明确选择，再调用 \`creator_select_video\`。预览、封面和外部上传均使用这个选择，不以修改时间换源。
- \`creator_import_video\` 仅复制用户选定的视频，原文件保留。同名冲突时修改导入名称重试，不能覆盖已有文件。

## 推进工作

根据用户要求制作脚本、文章、视频或图片，再为所需平台准备独立发布材料、上传草稿及同步作品数据。脚本与文章可独立完成；视频转文章才需要真实转写与画面。

- \`creator_import_video\`、\`creator_generate_subtitles\` 返回 Harness job id。用 \`job_output\` 的 \`wait=true\` 等待并查看完成结果，用 \`job_kill\` 取消，不轮询文件夹冒充任务控制器。字幕使用火山录音文件识别或导入已有 SRT/ASS；不运行 Mac 专属安装、MLX 或烧录入口。
- 上传、公众号和数据使用 \`creator_production_state\` / \`creator_production_action\` 的工作台入口，复用锁定版本外部 Skill。账号、精确视频、封面和任务在启动时绑定，不直接运行绕过账号检查的脚本。用户接管浏览器后停止；中断优先检查并恢复原任务；上传完成、草稿就绪和已发表分别记录。
- 文章由用户发送原生制作请求；用 \`creator_prepare_article\` 读取绑定的真实转写、图片附件和 WeWrite Skill，按返回的成熟写作流程、规则与定向检查制作。缺字幕时等待返回的火山 Job，再继续读取。用当前 Harness 模型看图；文字与画面不足时说明缺口。用 \`creator_save_article\` 保存并排版新版本，以返回任务 receipt 的 HTML 作为成品链接；Markdown 是可编辑源稿。只引用本次真实截图，不用脚本冒充实录。公众号先本地预览，再准备草稿；不自动发表。数据只按用户操作手动刷新，按账号和平台内容标识精确匹配，未知值不能写成零。
- 封面使用原生 Agent 流程：界面提供的制作请求包含固定 id、folderPath、runId；先调用 \`creator_prepare_cover\` 查看真实候选画面，读取返回的 oil-cover 规则与 agent-native-flow，用当前模型选帧和分析。看不到图片时要求用户在 Harness 中换支持看图的模型，不调用外部分析服务。
- 标题遵循用户指定文本；字幕可选。分析完成后直接调用 \`creator_generate_cover\`，默认 reference 模式，提交完整逐画幅提示词和本次 frameIds；只有用户明确接受纯文字制作才用 text。无额外方案审批。该工具返回原生 Job id，使用 job_output/job_kill 管理；不自动重试结果未确认的付费请求。
- 任务结束调用 \`creator_read_cover_results\`，逐幅查看真实图片后用 \`creator_review_cover\` 保存具体检查结论，pass 时可选为当前版；缺失、失败或看不到图片不能标为通过。只重做用户指定或实际失败的画幅，旧成果保留。
- 兼容的旧封面审查：封面任务完成后调用 \`creator_prepare_visual_review\`，检查三画幅构图、文字可读性、安全区、适配和品牌一致性；再用 \`creator_save_visual_review\` 保存具体结论。不把“已经启动”说成“已经完成”。`
};
function registerCreatorWorkbenchSkill(ctx) {
	return ctx.skills.register(CREATOR_WORKBENCH_SKILL);
}
//#endregion
//#region src/platforms.ts
/**
* 共享发布平台契约。
*
* 保持本模块不依赖 Node 和 UI，让 Host、schema 与客户端复用同一份定义。
*/
const PUBLISH_PLATFORM_DEFINITIONS = {
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
};
const PUBLISH_PLATFORMS = Object.freeze(Object.keys(PUBLISH_PLATFORM_DEFINITIONS));
function isPublishPlatform$1(value) {
	return typeof value === "string" && value in PUBLISH_PLATFORM_DEFINITIONS;
}
function normalizeEnabledPlatforms(value) {
	if (!Array.isArray(value)) return [...PUBLISH_PLATFORMS];
	const enabled = new Set(value.filter(isPublishPlatform$1));
	return PUBLISH_PLATFORMS.filter((platform) => enabled.has(platform));
}
//#endregion
//#region src/libraryPrompt.ts
function resolvePromptLibraryRoot(source) {
	return source.cache?.libraryRoot ?? source.libraryRoot;
}
function enabledPlatformNames(platforms) {
	return platforms.map((key) => {
		if (Object.hasOwn(PUBLISH_PLATFORM_DEFINITIONS, key)) return PUBLISH_PLATFORM_DEFINITIONS[key].name;
		return key;
	}).join("、");
}
function libraryConventionText(libraryRoot, dataDir, scriptRules, enabledPlatforms) {
	const lines = [
		`创作者的项目内容以磁盘文件为准，目录是 ${libraryRoot}。首次使用或能力不明确时先调用 creator_setup 做只读检查；用户问这个插件能做什么、怎么用，或你不确定下一步时，调用 creator_guide 获取带当前能力状态的完整指引。`,
		"一集一个子文件夹，名字是 YYYY-MM-DD_可读标题。列出这个目录就是项目列表；打开一集先列出那个文件夹，再读需要的文件。",
		"约定文件：topic.md 选题；script.md 口播脚本；公众号文章/<标题>.md 已转写文章，配图在 公众号文章/images/；publish-package.json 只放标题和 tags，不写平台长文案；*.mp4/*.mov 成片（_subtitled 为烧录版）；*.srt/*.ass 字幕；*_3x4.png *_4x3.png *_16x9.png 封面。",
		"读或改这些内容，用系统自带的列文件、读文件、写文件工具。需要视频候选与当前选择时调用 creator_get_content；被移除的视频只从工作台显示中隐藏，不能调用文件删除代替移除；封面和外部上传都使用同一当前视频，不按修改时间或字幕文件名换源。",
		"写或改 script.md 先用 creator_script_rules 读取已有偏好，遵循本次要求；缺少真正影响结果的信息时只问一个必要问题。长期偏好由用户明确后保存。",
		`插件工具只做文件做不到的事：配置工作台、按约定建文件夹、导入和选择视频、生成或烧录字幕、生成封面、同步已发布数据、整理文件夹名。工作台状态在 ${dataDir}/overlay.json，不是正文。`,
		"项目不分视频/图文模式。左侧自然语言与右侧人工操作共用 creator_production_state / creator_production_action。独立写文章先 prepare-article(source.kind=topic/materials/article)，再 creator_prepare_article、creator_save_article；视频来源用 source.kind=video。正常文件工具写的 Markdown/HTML 可用 register-article 登记。",
		"配图、封面、多图可无视频制作：generate-images 逐张指定 prompt/ratio/purpose/references；用 creator_read_images 查看真实图片，重试只处理失败项。用户已提出制作要求就连续执行，不要求点击右侧按钮。",
		"不同平台各建独立 save-publication 材料，明确 platform/type/title/body/tags/imageIds 及可选 video/articleId/articleFile/coverImageId。修改带 publicationId 和 expectedRevision；不改来源文章或其他平台材料。图片顺序就是 imageIds 的顺序。upload-publication 上传保存版本，最终发表仍由用户手动完成。",
		"自动发布（video-publisher skill）和已发布数据回收（creator_sync_publish）都依赖 Ego Browser；能力检查显示缺失时明确告诉用户，不要假装能同步。"
	];
	if (enabledPlatforms !== void 0) lines.push(enabledPlatforms.length === 0 ? "当前没有启用发布平台。不要调用 video-publisher 或 creator_sync_publish。" : `当前启用平台：${enabledPlatformNames(enabledPlatforms)}。video-publisher 和 creator_sync_publish 只处理这些平台。`);
	if (scriptRules !== void 0 && scriptRules.trim() !== "") lines.push("", "当前脚本规则（人设）：", scriptRules.trim());
	return lines.join("\n");
}
/** Read Desktop's durable ownership for every assembly; native sessions receive no private library context. */
function registerLibraryPrompt(ctx, source) {
	return ctx.on("system-prompt/assemble", async (assembly, context, next) => {
		const id = context.agent?.session.id;
		const ownership = ctx.get("desktopWorkbenchOwnership");
		const state = id === void 0 || ownership === void 0 ? void 0 : await ownership.read().catch(() => void 0);
		if (id !== void 0 && state?.added.includes("qinghui316/dsh-creator-workbench") && state.sessionBindings[id] === "qinghui316/dsh-creator-workbench") assembly.sections.push({
			name: "oil:library",
			text: libraryConventionText(resolvePromptLibraryRoot(source), source.dataDir, source.cachedScriptRules, source.cachedEnabledPlatforms)
		});
		return next();
	});
}
//#endregion
//#region src/projectView.ts
function productionView(state) {
	const { publicationSaves: _receipts, ...metadata } = state;
	const source = (value) => {
		if (!value) return {};
		const { text: _text, ...s } = value;
		return { source: s };
	};
	return {
		...metadata,
		articles: state.articles.map(({ source: s, ...a }) => ({
			...a,
			...source(s)
		})),
		publications: state.publications?.map(({ body: _body, bodyError: _error, source: s, ...p }) => ({
			...p,
			...source(s)
		})) ?? [],
		tasks: state.tasks.map(({ source: s, imageItems, ...t }) => ({
			...t,
			...source(s),
			...imageItems ? { imageItems: imageItems.map(({ prompt: _prompt, ...i }) => i) } : {}
		}))
	};
}
function coverView(state) {
	return {
		...state,
		versions: state.versions.map(({ reviewNote: _note, ...v }) => v),
		runs: state.runs.map(({ analysis: _analysis, slots, ...r }) => ({
			...r,
			slots: Object.fromEntries(Object.entries(slots).map(([ratio, { prompt: _prompt, ...slot }]) => [ratio, slot]))
		}))
	};
}
//#endregion
//#region src/covers/types.ts
const IMAGE_CREDENTIAL = "DSH_CREATOR_IMAGE_API_KEY";
const COVER_RATIOS$1 = [
	"3x4",
	"4x3",
	"16x9"
];
function coverRunStatus(slots) {
	const states = Object.values(slots).map((s) => s.status);
	if (states.includes("running") || states.includes("pending")) return "running";
	if (states.includes("unconfirmed")) return "unconfirmed";
	if (states.length && states.every((s) => s === "completed")) return "completed";
	if (states.includes("completed")) return "partial";
	return states.includes("failed") ? "failed" : "cancelled";
}
//#endregion
//#region src/secrets.ts
const SUBTITLE_KEY_REFS = [ASR_CREDENTIAL];
const COVER_KEY_REFS = [IMAGE_CREDENTIAL];
function refsFor(kind) {
	return kind === "subtitle" ? SUBTITLE_KEY_REFS : COVER_KEY_REFS;
}
function primaryRef(kind) {
	return refsFor(kind)[0] ?? "CREATOR_VOLC_ASR_API_KEY";
}
function emptySecretView(kind) {
	return {
		kind,
		ref: primaryRef(kind),
		configured: false,
		writable: true
	};
}
function emptySecrets() {
	return {
		subtitle: emptySecretView("subtitle"),
		cover: emptySecretView("cover")
	};
}
function viewFromDescribe(kind, credentials) {
	for (const ref of refsFor(kind)) {
		const row = credentials[ref];
		if (row?.configured !== true) continue;
		return {
			kind,
			ref,
			configured: true,
			writable: row.writable !== false,
			...typeof row.source === "string" && row.source !== "" ? { source: row.source } : {}
		};
	}
	const primary = primaryRef(kind);
	return {
		kind,
		ref: primary,
		configured: false,
		writable: credentials[primary]?.writable !== false
	};
}
//#endregion
//#region src/production/projectQuery.ts
const excerptsByFile = /* @__PURE__ */ new Map();
async function excerpt(folder, path, limit = 240) {
	const actual = await inside(folder, path), file = await open(actual, "r");
	try {
		const info = await file.stat(), cached = excerptsByFile.get(actual);
		if (cached?.modifiedAt === info.mtimeMs && cached.size === info.size) return cached.text.slice(0, limit);
		const buffer = Buffer.alloc(8192), result = await file.read(buffer, 0, buffer.length, 0);
		const text = new TextDecoder().decode(buffer.subarray(0, result.bytesRead), { stream: true }).replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, " ").replace(/<[^>]*>/g, " ").replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/^\s*(?:#{1,6}\s+|\d+\s*$|[\d:,]+\s*-->[^\n]*)/gm, "").replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, name) => ({
			nbsp: " ",
			amp: "&",
			lt: "<",
			gt: ">",
			quot: "\"",
			"#39": "'"
		})[name] ?? " ").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 240);
		excerptsByFile.set(actual, {
			modifiedAt: info.mtimeMs,
			size: info.size,
			text
		});
		if (excerptsByFile.size > 100) excerptsByFile.delete(excerptsByFile.keys().next().value);
		return text.slice(0, limit);
	} finally {
		await file.close();
	}
}
async function queryProject(item, readCovers = () => readCoverState(item.folderPath)) {
	const production = await readState(item.folderPath), covers = await readCovers();
	production.publications = production.publications?.map(({ body: _body, bodyError: _error, ...p }) => ({
		...p,
		...p.source?.articleId && production.articles.some((a) => a.parentArticleId === p.source.articleId) ? { sourceChanged: true } : {}
	})) ?? [];
	let script = {
		exists: false,
		excerpt: ""
	};
	try {
		const text = await excerpt(item.folderPath, "script.md");
		script = {
			exists: Boolean(text),
			excerpt: text
		};
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const excerpts = {};
	const article = production.articles.at(-1), video = item.videos?.find((v) => v.name === item.selectedVideo);
	const transcript = [...production.transcripts].reverse().find((t) => video && t.video.name === video.name && t.video.size === video.size && t.video.modifiedAt === video.modifiedAt);
	if (article || item.articlePath) try {
		excerpts.article = {
			id: article?.id ?? "legacy",
			text: await excerpt(item.folderPath, article?.file ?? item.articlePath)
		};
	} catch {}
	const legacySubtitle = item.subtitles?.srt ?? item.subtitles?.transcript;
	const isKnownOldSubtitle = legacySubtitle && production.transcripts.some((t) => [t.srtFile, t.textFile].some((file) => resolve(item.folderPath, file).toLowerCase() === resolve(item.folderPath, legacySubtitle).toLowerCase()));
	const subtitleFile = transcript?.srtFile ?? (!isKnownOldSubtitle ? legacySubtitle : void 0);
	if (subtitleFile) try {
		excerpts.subtitle = {
			file: subtitleFile,
			source: transcript ? `${transcript.source === "volcano" ? "火山转写" : "导入字幕"} · ${transcript.video.name}` : "已有字幕",
			text: await excerpt(item.folderPath, subtitleFile)
		};
	} catch {}
	return {
		detail: {
			...item,
			script: "",
			article: "",
			topicNote: "",
			publishCopy: "",
			secrets: emptySecrets()
		},
		production: productionView(production),
		covers: coverView(covers),
		script,
		excerpts
	};
}
//#endregion
//#region src/artifacts.ts
const ARTICLE_DIR = "公众号文章";
const PUBLISH_NAME = "publish-package.json";
function isPublishPackageName(name) {
	if (name.includes("auto-publish")) return false;
	if (name.startsWith("publish-package-")) return false;
	if (name.startsWith("publish_package_")) return false;
	if (name.includes("_test.video-publisher")) return false;
	return name === "publish-package.json" || name === "publisher-package.json" || name === "video-publisher-package.json" || name.endsWith(".publish-package.json") || name.endsWith("_publish-package.json") || name.endsWith(".video-publisher.json") || name.endsWith(".publisher-package.json") || name.endsWith(".publish.json");
}
function pickPublishPackage(names) {
	if (names.includes("publish-package.json")) return PUBLISH_NAME;
	const candidates = names.filter((name) => isPublishPackageName(name));
	if (candidates.length === 0) return void 0;
	const score = (name) => {
		if (name.endsWith(".publish-package.json") || name.endsWith("_publish-package.json")) return 3;
		if (name.includes("publisher-package")) return 2;
		if (name.includes("video-publisher")) return 1;
		return 0;
	};
	return [...candidates].sort((left, right) => score(right) - score(left))[0];
}
function isDraftArticleName(name) {
	return /\.(source|wechat|processed|source-check)(\.|$)/.test(name) || /_(source|processed|source-check)\.md$/.test(name);
}
function pickArticleFile(names) {
	const markdown = names.filter((name) => name.endsWith(".md"));
	return markdown.filter((name) => !isDraftArticleName(name))[0] ?? markdown[0];
}
function isSubtitledVideoName(name) {
	return name.includes("_subtitled") || name.includes("_带字幕") || name.includes("subtitled");
}
async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/runtimePaths.ts
function venvPythonCandidates(skillDir, platform = process.platform) {
	if (platform === "win32") return [join(skillDir, ".venv", "Scripts", "python.exe"), join(skillDir, ".venv", "Scripts", "python3.exe")];
	return [join(skillDir, ".venv", "bin", "python3"), join(skillDir, ".venv", "bin", "python")];
}
function systemPythonCommand(platform = process.platform) {
	return platform === "win32" ? "python" : "python3";
}
async function resolveVenvPython(skillDir, platform = process.platform) {
	for (const path of venvPythonCandidates(skillDir, platform)) if (await pathExists(path)) return path;
}
function pathEnvValue(env) {
	const path = env.PATH ?? env.Path;
	return typeof path === "string" ? path : "";
}
function extraBinDirs(platform, home = homedir(), env = process.env) {
	const dirs = [join(home, ".local", "bin"), join(home, "bin")];
	if (platform === "win32") {
		const local = env.LOCALAPPDATA ?? env.LocalAppData ?? join(home, "AppData", "Local");
		dirs.push(join(home, ".local", "share", "ego", "active_version_dir"), join(local, "Programs"));
		return dirs;
	}
	if (home === homedir()) dirs.push("/usr/local/bin", "/opt/homebrew/bin");
	return dirs;
}
function egoInstallCandidates(platform, home = homedir(), env = process.env) {
	if (platform === "darwin") {
		const local = [join(home, "Applications", "ego lite.app"), join(home, "Applications", "Ego Lite.app")];
		if (home !== homedir()) return local;
		return [
			"/Applications/ego lite.app",
			"/Applications/Ego Lite.app",
			...local
		];
	}
	if (platform === "win32") {
		const local = env.LOCALAPPDATA ?? env.LocalAppData ?? join(home, "AppData", "Local");
		const programFiles = env.ProgramFiles ?? "C:\\Program Files";
		const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
		return [
			join(local, "Programs", "ego lite", "ego-browser.exe"),
			join(local, "Programs", "Ego Lite", "ego-browser.exe"),
			join(programFiles, "ego lite", "ego-browser.exe"),
			join(programFiles, "Ego Lite", "ego-browser.exe"),
			join(programFilesX86, "ego lite", "ego-browser.exe")
		];
	}
	return [];
}
//#endregion
//#region src/production/process.ts
function decodeOutput(chunks) {
	const bytes = Buffer.concat(chunks);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder("gb18030").decode(bytes);
	}
}
function safeError(cause, secrets = []) {
	let text = cause instanceof Error ? cause.message : String(cause);
	for (const key of secrets) if (key) text = text.split(key).join("[已隐藏]");
	return text.replace(/((?:authorization|access_token|api[_-]?key|appsecret|secret)\s*[=:]\s*)[^\s&,"'}]+/gi, "$1[已隐藏]").slice(0, 1e3);
}
/** Private worker transport. Callers never log raw input/output; API credentials travel through stdin only. */
function runProcess(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(/* @__PURE__ */ new Error("操作已取消。"));
			return;
		}
		const child = spawn(command, args, {
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			env: {
				...process.env,
				PYTHONUTF8: "1",
				PYTHONIOENCODING: "utf-8",
				...options.env
			}
		});
		const stdout = [], stderr = [];
		let bytes = 0, failure;
		const stop = (error) => {
			failure ??= error;
			if (process.platform === "win32" && child.pid) spawn("taskkill.exe", [
				"/PID",
				String(child.pid),
				"/T",
				"/F"
			], {
				windowsHide: true,
				stdio: "ignore"
			}).on("error", () => child.kill());
			else child.kill();
		};
		const abort = () => stop(/* @__PURE__ */ new Error("操作已取消。"));
		options.signal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(() => stop(/* @__PURE__ */ new Error("操作超时，服务端结果可能尚未确认。")), options.timeout ?? 12e4);
		timer.unref();
		child.stdin.on("error", () => void 0);
		child.stdin.end(options.input ?? "");
		for (const [pipe, target] of [[child.stdout, stdout], [child.stderr, stderr]]) pipe.on("data", (chunk) => {
			bytes += chunk.length;
			if (bytes > (options.maxOutput ?? 16777216)) stop(/* @__PURE__ */ new Error("运行结果超过安全大小。"));
			else target.push(chunk);
		});
		child.once("error", (error) => {
			failure = error;
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			if (failure) reject(failure);
			else resolve({
				code: code ?? 1,
				stdout: decodeOutput(stdout),
				stderr: decodeOutput(stderr)
			});
		});
	});
}
//#endregion
//#region src/production/runtime.ts
const PUBLISHER_COMMIT = "0d02cc5387b0bea0a43d5aa4e72a2c9502d05f94";
const exists = (file) => access(file).then(() => true, () => false);
const publisherRoot = (dataDir) => join(dataDir, "runtime", `video-publisher-${PUBLISHER_COMMIT.slice(0, 12)}`);
const pythonPath = (dataDir) => join(dataDir, "runtime", "wewrite-python", "Scripts", "python.exe");
async function resource(...parts) {
	const here = dirname(fileURLToPath(import.meta.url));
	for (const root of [join(here, ".."), join(here, "..", "..")]) {
		const file = join(root, ...parts);
		if (await exists(file)) return file;
	}
	throw new Error("工作台运行资源缺失，请重新安装完整包。");
}
async function egoCompatibilityPrelude() {
	return (await import(pathToFileURL(await resource("scripts", "ego-compat.mjs")).href)).legacyEgoPrelude();
}
async function executable(name, env = process.env) {
	const dirs = [...pathEnvValue(env).split(delimiter), ...extraBinDirs("win32", homedir(), env)];
	for (const dir of dirs.filter(Boolean)) for (const suffix of process.platform === "win32" ? [
		".exe",
		".cmd",
		""
	] : [""]) {
		const file = join(dir, `${name}${suffix}`);
		if (await exists(file)) return file;
	}
}
async function browserExecutable() {
	const found = await executable("ego-browser");
	if (found) return found;
	const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
	for (const file of [
		join(homedir(), ".local", "share", "ego", "active_version_dir", "ego-browser.exe"),
		join(homedir(), ".ego", "bin", "ego-browser.exe"),
		join(homedir(), ".local", "bin", "ego-browser.exe"),
		join(local, "Programs", "ego lite", "ego-browser.exe"),
		join(local, "Programs", "ego lite", "resources", "bin", "ego-browser.exe")
	]) if (await exists(file)) return file;
	throw new Error("请安装并打开 Ego 浏览器 Windows 版，完成首次设置后重试。");
}
async function runtimeStatus(dataDir) {
	const publisher = await exists(join(publisherRoot(dataDir), "scripts", "v2", "publisher.mjs"));
	const article = await resource("vendor", "wewrite", "SKILL.md").then(() => true, () => false);
	const python = await exists(pythonPath(dataDir));
	const ffmpeg = Boolean(await executable("ffmpeg")) || await exists("C:/ffmpeg/bin/ffmpeg.exe");
	const browser = await browserExecutable().then(() => true, () => false);
	return {
		publisher,
		article,
		python,
		ffmpeg,
		browser,
		details: [
			!publisher || !article || !python ? "请先准备 Windows 运行环境。" : "",
			!ffmpeg ? "需要 FFmpeg 才能提取音频和截图。" : "",
			!browser ? "视频上传和数据回收需要 Ego 浏览器 Windows 版。" : ""
		].filter(Boolean)
	};
}
async function prepareRuntime(dataDir, signal) {
	const script = await resource("scripts", "install-runtime.mjs"), python = await executable("python");
	if (!python) throw new Error("未找到 Python 3.12，请安装后重新准备运行环境。");
	if ((await runProcess(process.execPath, [
		script,
		dataDir,
		python
	], {
		signal,
		timeout: 6e5,
		env: { ELECTRON_RUN_AS_NODE: "1" }
	})).code !== 0) throw new Error("运行环境准备失败，请检查网络和 Python 安装后重试。");
	const status = await runtimeStatus(dataDir);
	if (!status.publisher || !status.article || !status.python) throw new Error("运行环境准备尚未完成，请重试。");
}
async function pinnedPublisher(dataDir) {
	const root = publisherRoot(dataDir);
	if (JSON.parse(await readFile(join(root, ".source.json"), "utf8")).commit !== "0d02cc5387b0bea0a43d5aa4e72a2c9502d05f94") throw new Error("上传工具版本与本工作台不匹配，请重新准备运行环境。");
	return root;
}
//#endregion
//#region src/production/wechat.ts
var WechatError = class extends Error {
	unknownOutcome;
	code;
	constructor(message, unknownOutcome = false, code) {
		super(message);
		this.unknownOutcome = unknownOutcome;
		this.code = code;
	}
};
async function wechatWorker(dataDir, input, signal) {
	const answer = await runProcess(pythonPath(dataDir), [await resource("vendor", "wewrite", "worker.py")], {
		input: JSON.stringify(input),
		signal,
		timeout: 6e5,
		maxOutput: 8388608
	});
	let result;
	try {
		result = JSON.parse(answer.stdout);
	} catch {
		throw new WechatError("公众号运行结果未确认，请检查依赖及本次草稿。", true);
	}
	if (!result.ok || answer.code !== 0 || !result.value) throw new WechatError(result.error ?? "公众号操作未完成。", result.unknown === true, result.code);
	return result.value;
}
async function renderWechat(dataDir, folder, articleFile, theme, signal) {
	const article = await inside(folder, articleFile);
	if ((await readFile(article)).byteLength > 1048576) throw new Error("文章超过 1 MB，请精简后重试。");
	return wechatWorker(dataDir, {
		operation: "render",
		folder,
		article,
		theme
	}, signal);
}
async function submitWechat(input) {
	const article = await inside(input.folder, input.articleFile), sourceCover = await inside(input.folder, input.cover);
	const snapshot = join(input.dir, "submission-input.md"), cover = join(input.dir, `submission-cover${extname(sourceCover).toLowerCase()}`);
	try {
		await writeFile(snapshot, await readFile(article), { flag: "wx" });
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
	try {
		await writeFile(cover, await readFile(sourceCover), { flag: "wx" });
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
	const markdown = await readFile(snapshot, "utf8"), before = hashText(markdown);
	const result = await wechatWorker(input.dataDir, {
		operation: input.operation ?? "publish",
		folder: input.folder,
		article,
		markdown,
		cover,
		appid: input.config.appid,
		secret: input.secret,
		author: input.config.author,
		theme: input.config.theme,
		receiptPath: join(input.dir, "wechat-receipt.json"),
		...input.previous ? {
			mediaId: input.previous.mediaId,
			remoteHash: input.previous.remoteHash
		} : {},
		confirmRemoteChange: input.confirmRemoteChange === true
	}, input.signal);
	if (!result.mediaId || !result.remoteHash) throw new WechatError("公众号草稿回执不完整，请核对后台。", true);
	const submittedFile = join(input.dir, "submitted.md");
	try {
		await writeFile(submittedFile, markdown, {
			encoding: "utf8",
			flag: "wx"
		});
	} catch (error) {
		if (error.code !== "EEXIST" || await readFile(submittedFile, "utf8") !== markdown) throw error;
	}
	return {
		id: input.previous?.id ?? crypto.randomUUID(),
		appid: input.config.appid,
		articleFile: relative(input.folder, article),
		mediaId: result.mediaId,
		title: result.title,
		submittedHash: before,
		remoteHash: result.remoteHash,
		submittedFile: relative(input.folder, submittedFile),
		updatedAt: Date.now(),
		...input.previous?.publishedId ? { publishedId: input.previous.publishedId } : {},
		...input.previous?.publishedUrl ? { publishedUrl: input.previous.publishedUrl } : {}
	};
}
//#endregion
//#region src/production/articlePreview.ts
/** Local WeWrite formatting only: no credentials, platform mutation or task creation. */
async function formatArticle(dataDir, folder, articleFile, theme, signal) {
	const article = await inside(folder, articleFile);
	return locked(`article-preview:${article}:${theme}`, async () => {
		signal.throwIfAborted();
		const source = await readFile(article, "utf8");
		const result = /\.html?$/i.test(article) ? {
			preview: source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""),
			images: await Promise.all([...source.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].filter((m) => !m[1].startsWith("data:")).map(async (m) => {
				const name = m[1].replaceAll("&amp;", "&");
				if (/^(?:https?:|file:|\/\/)/i.test(name)) throw new Error("HTML 配图需先导入本项目，再使用本地相对路径。");
				return {
					source: name,
					path: await inside(folder, join(dirname(article), decodeURIComponent(name)))
				};
			}))
		} : await renderWechat(dataDir, folder, article, theme, signal);
		if (source !== await readFile(article, "utf8")) throw new Error("文章已修改，请重新预览最新内容。");
		let html = result.preview, total = 0;
		for (const image of result.images) {
			const bytes = await readFile(await inside(folder, image.path));
			total += bytes.length;
			if (total > 25165824) throw new Error("预览图片总量超过 24 MB，请缩小图片后重试。");
			const kind = imageKind(bytes), escaped = image.source.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
			html = html.split(`src="${escaped}"`).join(`src="data:${kind.mime};base64,${bytes.toString("base64")}"`);
		}
		signal.throwIfAborted();
		const dir = await owned(folder, `preview-${hashText(`${theme}\n${source}\n${html}`)}`), path = join(dir, "preview.html");
		try {
			await writeFile(path, html, {
				encoding: "utf8",
				flag: "wx"
			});
		} catch (error) {
			if (error.code !== "EEXIST" || await readFile(await inside(folder, path), "utf8") !== html) throw error;
		}
		return {
			html,
			path
		};
	});
}
//#endregion
//#region src/production/articleEditing.ts
async function articleSource(folder, articleId, legacyFile) {
	const article = (await readState(folder)).articles.find((a) => a.id === articleId) ?? (articleId === "legacy" && legacyFile ? {
		id: "legacy",
		file: legacyFile,
		frameFiles: [],
		createdAt: 0
	} : void 0);
	if (!article) throw new Error("文章版本不存在，请重新选择。");
	const file = await inside(folder, article.file), source = await readFile(file, "utf8");
	if (Buffer.byteLength(source) > 2097152) throw new Error("文章超过 2 MB，请在外部编辑后导入。");
	return {
		article: {
			...article,
			format: article.format ?? (/\.html?$/i.test(file) ? "html" : "markdown")
		},
		source,
		sourceHash: hashText(source)
	};
}
function validate(request) {
	if (!request.source.trim() || Buffer.byteLength(request.source) > 2097152) throw new Error("请填写正文，文章不能超过 2 MB。");
}
async function checkBase(folder, request, legacyFile) {
	validate(request);
	const base = await articleSource(folder, request.articleId, legacyFile);
	if (base.sourceHash !== request.expectedSourceHash) throw new Error("来源文章已被修改。当前输入已保留，请重新读取并核对。");
	return base;
}
async function previewArticleEdit(dataDir, folder, request, theme, signal, legacyFile) {
	const base = await checkBase(folder, request, legacyFile);
	const dir = await owned(folder, `edit-preview-${randomUUID()}`);
	try {
		return await formatArticle(dataDir, folder, await snapshotPublicationArticle(folder, dir, {
			articleFile: base.article.file,
			bodyFile: base.article.file
		}, request.source, [], base.article.format), theme, signal);
	} finally {
		const actual = await realpath(dir);
		if (!relative(await realpath(folder), actual).replace(/\\/g, "/").startsWith(".dsh-creator-workbench/production/edit-preview-") || actual !== dir) throw new Error("预览临时目录已变化，已保留供核对。");
		await rm(actual, {
			recursive: true,
			force: true
		});
	}
}
async function saveArticleRevision(dataDir, folder, request, theme, signal, assertAvailable, legacyFile) {
	if (!/^[a-zA-Z0-9-]{8,80}$/.test(request.saveId)) throw new Error("保存请求无效，请重试。");
	validate(request);
	const inputHash = hashText(JSON.stringify([
		request.articleId,
		request.expectedSourceHash,
		request.source
	]));
	return locked(`article-save:${folder}:${request.saveId}`, async () => {
		signal.throwIfAborted();
		await assertAvailable();
		const id = `edit-${request.saveId}`;
		let article = (await readState(folder)).articles.find((a) => a.id === id);
		if (article && article.saveInputHash !== inputHash) throw new Error("保存请求已用于其他内容，请核对后重新保存。");
		if (!article) {
			const base = await checkBase(folder, request, legacyFile), dir = await owned(folder, "articles", id);
			const manifest = join(dir, "save-input.json");
			try {
				await writeFile(manifest, JSON.stringify({ inputHash }), {
					encoding: "utf8",
					flag: "wx"
				});
			} catch (error) {
				if (error.code !== "EEXIST" || JSON.parse(await readFile(manifest, "utf8")).inputHash !== inputHash) throw error;
			}
			const file = await snapshotPublicationArticle(folder, dir, {
				articleFile: base.article.file,
				bodyFile: base.article.file
			}, request.source, [], base.article.format, true);
			article = {
				...base.article,
				id,
				parentArticleId: base.article.id,
				saveInputHash: inputHash,
				file: relative(folder, file),
				createdAt: Date.now(),
				title: request.source.match(/^#\s+(.+)/m)?.[1] ?? request.source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, "") ?? base.article.title ?? "文章"
			};
			const version = article;
			await updateState(folder, async (state) => {
				await assertAvailable();
				if (hashText(await readFile(await inside(folder, base.article.file), "utf8")) !== request.expectedSourceHash) throw new Error("来源文章已被修改，输入已保留。");
				if (!state.articles.some((a) => a.id === id)) state.articles.push(version);
			});
		}
		const result = await articleSource(folder, article.id);
		try {
			return {
				...result,
				preview: await formatArticle(dataDir, folder, article.file, theme, signal)
			};
		} catch (error) {
			return {
				...result,
				previewError: error instanceof Error ? error.message : "排版未完成，请重试预览。"
			};
		}
	});
}
//#endregion
//#region src/videoSelection.ts
/** Filenames, never arbitrary paths. Shared by the scanner and import boundary. */
function validVideoName(name) {
	return name !== "." && name !== ".." && !/[\\/:*?"<>|\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && !name.startsWith(".") && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) && /\.(?:mp4|mov)$/i.test(name);
}
function resolveVideoSelection(candidates, saved) {
	if (saved === null) return { videoSelection: "cleared" };
	if (saved !== void 0) return candidates.some((video) => video.name === saved) ? {
		videoSelection: "selected",
		selectedVideo: saved
	} : { videoSelection: "missing" };
	if (candidates.length === 1) return {
		videoSelection: "selected",
		selectedVideo: candidates[0].name
	};
	return { videoSelection: candidates.length === 0 ? "empty" : "choose" };
}
function currentVideoPath(item) {
	return item.videos?.find((video) => video.name === item.selectedVideo)?.path;
}
/** Windows names identify the same on-disk file regardless of case. */
function sameVideoName(a, b, windows = true) {
	return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}
//#endregion
//#region src/videoFiles.ts
function assertInside(root, target) {
	const rel = relative(root, target);
	if (rel === "" || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) throw new Error("文件必须位于当前内容目录中。");
}
async function contentFolder(root, folder) {
	const realRoot = await realpath(root);
	const realFolder = await realpath(folder);
	assertInside(realRoot, realFolder);
	if (dirname(realFolder) !== realRoot) throw new Error("内容目录必须直接位于资料库内。");
	return realFolder;
}
async function videoFile(folder, name) {
	if (!validVideoName(name)) throw new Error("请选择 MP4 或 MOV 文件，名称不能含路径或 Windows 保留字符。");
	const path = join(folder, name);
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error("视频必须是非空的普通文件。");
	assertInside(await realpath(folder), await realpath(path));
	return path;
}
//#endregion
//#region src/covers/provider.ts
const emptyImageSettings = () => ({
	apiBase: "",
	model: "",
	revision: ""
});
function normalizeImageSettings(input) {
	const url = new URL(input.apiBase.trim());
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("请输入不含密钥或查询参数的 HTTP/HTTPS 服务根地址。");
	if (!input.model.trim()) throw new Error("请填写生图模型名称。");
	return {
		apiBase: url.href.replace(/\/+$/, ""),
		model: input.model.trim()
	};
}
async function readImageSettings(dataDir) {
	try {
		return JSON.parse(await readFile(join(dataDir, "image-service.json"), "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return emptyImageSettings();
		throw new Error("生图服务设置无法读取。");
	}
}
async function saveImageSettings(dataDir, input) {
	return coverLock(`image-settings:${dataDir}`, async () => {
		if ((await readImageSettings(dataDir)).pending) throw new Error("生图设置更新未完成，请继续保存。");
		const settings = {
			...normalizeImageSettings(input),
			revision: randomUUID()
		};
		await mkdir(dataDir, { recursive: true });
		await atomicJson(join(dataDir, "image-service.json"), settings);
		return settings;
	});
}
/** Non-secret coordination: credentials are still written exclusively by the host. */
async function beginImageUpdate(dataDir, input) {
	const target = normalizeImageSettings(input);
	return coverLock(`image-settings:${dataDir}`, async () => {
		const current = await readImageSettings(dataDir);
		if (current.revision !== input.revision) throw new Error("设置已在其他位置变化，请重新读取后保存。");
		if ((!current.apiBase || new URL(current.apiBase).origin !== new URL(target.apiBase).origin || current.pending?.needsKey) && !input.hasNewKey) throw new Error("请填写对应服务的新 API Key。");
		const token = randomUUID();
		const next = {
			...current,
			revision: token,
			pending: {
				...target,
				token,
				needsKey: input.hasNewKey
			}
		};
		delete next.checked;
		await mkdir(dataDir, { recursive: true });
		await atomicJson(join(dataDir, "image-service.json"), next);
		return next;
	});
}
async function completeImageUpdate(dataDir, token, keyUpdated) {
	return coverLock(`image-settings:${dataDir}`, async () => {
		const pending = (await readImageSettings(dataDir)).pending;
		if (!pending || pending.token !== token) throw new Error("设置更新已变化，请重新读取后保存。");
		if (pending.needsKey && !keyUpdated) throw new Error("API Key 尚未保存，设置更新未完成。");
		const next = {
			apiBase: pending.apiBase,
			model: pending.model,
			revision: randomUUID()
		};
		await atomicJson(join(dataDir, "image-service.json"), next);
		return next;
	});
}
var ImageRequestError = class extends Error {
	uncertain;
	constructor(message, uncertain) {
		super(message);
		this.uncertain = uncertain;
	}
};
function safeImageError(error, key) {
	let value = error instanceof Error ? error.message : String(error);
	if (key) value = value.replaceAll(key, "[redacted]");
	return value.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [redacted]").replace(/\bsk-[\w-]+/g, "[redacted]").slice(0, 500);
}
async function readLimited(response, limit) {
	if (Number(response.headers.get("content-length")) > limit) throw new Error("图片响应过大。");
	const reader = response.body?.getReader();
	if (!reader) throw new Error("服务没有返回内容。");
	const chunks = [];
	let length = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > limit) throw new Error("图片响应过大。");
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => void 0);
	}
	return Buffer.concat(chunks);
}
async function requestImage(settings, key, input, signal) {
	if (settings.pending) throw new ImageRequestError("生图设置更新未完成，请继续保存。", false);
	const timeout = AbortSignal.timeout(18e4), combined = AbortSignal.any([signal, timeout]);
	const size = {
		"3x4": "960x1280",
		"4x3": "1280x960",
		"16x9": "1280x720",
		"1x1": "1024x1024"
	}[input.ratio];
	let body;
	const headers = { Authorization: `Bearer ${key}` };
	if (input.mode === "reference") {
		if (!input.references.length) throw new ImageRequestError("参考图制作需要先选择图片。", false);
		const form = new FormData();
		form.set("model", settings.model);
		form.set("prompt", input.prompt);
		form.set("size", size);
		form.set("n", "1");
		for (const file of input.references) form.append("image[]", new Blob([Buffer.from(file.data)], { type: imageKind(file.data).mime }), file.name);
		body = form;
	} else {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify({
			model: settings.model,
			prompt: input.prompt,
			size,
			n: 1
		});
	}
	let sent = false;
	try {
		sent = true;
		const response = await fetch(`${settings.apiBase}/images/${input.mode === "reference" ? "edits" : "generations"}`, {
			method: "POST",
			headers,
			body,
			signal: combined,
			redirect: "error"
		});
		if (!response.ok) throw new ImageRequestError(`生图服务返回 HTTP ${response.status}。请检查模型、密钥、参考图和尺寸支持。`, response.status >= 500);
		const raw = await readLimited(response, 37748736);
		const first = JSON.parse(Buffer.from(raw).toString("utf8")).data?.[0];
		let bytes;
		if (typeof first?.b64_json === "string") bytes = Buffer.from(first.b64_json, "base64");
		else if (typeof first?.url === "string") {
			const url = new URL(first.url);
			if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("图片下载地址无效。");
			const download = await fetch(url, {
				signal: combined,
				redirect: "follow"
			});
			if (!download.ok) throw new Error("图片已生成，但下载失败；请核对服务端结果。");
			bytes = await readLimited(download, MAX_IMAGE_BYTES);
		} else throw new Error("服务已接收请求，但响应没有图片，请核对结果。");
		imageKind(bytes);
		return bytes;
	} catch (error) {
		if (error instanceof ImageRequestError) throw error;
		throw new ImageRequestError(safeImageError(signal.aborted ? "请求已取消，服务端可能仍在生成，请核对后再重试。" : error, key), sent);
	}
}
async function checkImageConnection(settings, key, signal) {
	if (settings.pending) throw new Error("生图设置更新未完成，请先保存。");
	const response = await fetch(`${settings.apiBase}/models`, {
		headers: { Authorization: `Bearer ${key}` },
		signal: AbortSignal.any([signal, AbortSignal.timeout(15e3)]),
		redirect: "error"
	});
	return {
		...settings,
		checked: {
			revision: settings.revision,
			connection: response.ok ? "连接成功；未执行生图" : `HTTP ${response.status}；此服务可能不提供模型列表`,
			generation: settings.checked?.generation ?? "未验证",
			edit: settings.checked?.edit ?? "未验证"
		}
	};
}
async function saveImageCheck(dataDir, result) {
	return coverLock(`image-settings:${dataDir}`, async () => {
		const current = await readImageSettings(dataDir);
		if (current.revision !== result.revision) return current;
		await atomicJson(join(dataDir, "image-service.json"), result);
		return result;
	});
}
async function recordImageSuccess(dataDir, settings, mode, ratio) {
	return coverLock(`image-settings:${dataDir}`, async () => {
		const current = await readImageSettings(dataDir);
		if (current.revision !== settings.revision) return;
		const checked = current.checked ?? {
			revision: current.revision,
			connection: "已完成真实图片请求",
			generation: "未验证",
			edit: "未验证"
		};
		checked[mode === "reference" ? "edit" : "generation"] = `已验证 ${ratio.replace("x", ":")}`;
		await atomicJson(join(dataDir, "image-service.json"), {
			...current,
			checked
		});
	});
}
//#endregion
//#region src/covers/workflow.ts
async function selectedCoverPaths(folder, fallback) {
	const state = await readCoverState(folder).catch(() => void 0), result = { ...fallback };
	if (!state) return {};
	for (const ratio of COVER_RATIOS$1) {
		const id = state.selected[ratio];
		if (id !== void 0) {
			const version = state.versions.find((v) => v.id === id && v.ratio === ratio && !v.hidden);
			delete result[ratio];
			if (version) {
				const file = await boundedFile(folder, version.file).catch(() => void 0);
				if (file) result[ratio] = file;
			}
		}
	}
	return result;
}
var CoverWorkflow = class {
	host;
	active = /* @__PURE__ */ new Map();
	constructor(host) {
		this.host = host;
	}
	dispose() {
		for (const task of this.active.values()) task.controller.abort();
	}
	async load(folder) {
		const state = await readCoverState(folder);
		for (const run of state.runs) {
			run.contentId = basename(folder);
			run.folderPath = folder;
		}
		const names = await readdir(folder);
		for (const name of names) {
			const ratio = COVER_RATIOS$1.find((r) => name.endsWith(`_${r}.png`));
			if (!ratio || state.versions.some((v) => v.file === name)) continue;
			const info = await lstat(join(folder, name));
			if (!info.isFile() || info.isSymbolicLink()) continue;
			const id = `legacy-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
			state.versions.push({
				id,
				ratio,
				file: name,
				mime: "image/png",
				width: 0,
				height: 0,
				source: "legacy",
				createdAt: info.mtimeMs,
				review: "pass"
			});
			if (state.selected[ratio] === void 0) state.selected[ratio] = id;
		}
		return state;
	}
	async state(scope) {
		const { folder } = await this.host.resolve(scope);
		return coverLock(folder, async () => {
			const state = await this.load(folder);
			let changed = false;
			for (const run of state.runs) {
				if (this.active.get(folder)?.runId === run.id) continue;
				if (run.status === "preparing") {
					run.status = "failed";
					run.error = "准备画面时中断，请重新准备。";
					changed = true;
				}
				for (const [ratio, slot] of Object.entries(run.slots)) {
					if (slot.status !== "running" && slot.status !== "pending") continue;
					const dir = join(folder, ".dsh-creator-workbench", "covers", "versions", slot.versionId);
					const file = (await readdir(dir).catch(() => [])).find((f) => /^cover\.(png|jpg|webp)$/.test(f));
					if (file) try {
						const path = await boundedFile(folder, relative(folder, join(dir, file))), image = await inspectImage(path);
						assertRatio(image.width, image.height, ratio);
						if (!state.versions.some((v) => v.id === slot.versionId)) state.versions.push({
							id: slot.versionId,
							ratio,
							file: relative(folder, path),
							...image,
							source: "generated",
							createdAt: Date.now(),
							video: run.video.name,
							runId: run.id,
							review: "pending"
						});
						slot.status = "completed";
					} catch {
						slot.status = "unconfirmed";
						slot.error = "已发现图片文件但无法核验，请检查已有成果。";
					}
					else {
						slot.status = slot.status === "running" ? "unconfirmed" : "cancelled";
						slot.error = "任务中断；服务端结果需核对，未自动重发。";
					}
					changed = true;
				}
				if (Object.keys(run.slots).length) run.status = coverRunStatus(run.slots);
			}
			if (changed) {
				await writeCoverState(folder, state);
				this.host.changed();
			}
			return state;
		});
	}
	async action(request, signal) {
		const context = await this.host.resolve(request), { folder } = context;
		signal.throwIfAborted();
		if (request.action === "retry") {
			await this.state(request);
			await this.start(request, request.runId, void 0, request.ratios, request.acknowledgeUnknown === true);
			return this.state(request);
		}
		if (request.action === "cancel") {
			const active = this.active.get(folder);
			if (active?.runId === request.runId) active.controller.abort();
			return coverLock(folder, async () => {
				const state = await this.load(folder), run = state.runs.find((r) => r.id === request.runId);
				if (run && !active) {
					run.status = "cancelled";
					run.updatedAt = Date.now();
					await writeCoverState(folder, state);
				}
				return state;
			});
		}
		const result = await coverLock(folder, async () => {
			const state = await this.load(folder);
			await this.host.resolve(request);
			if (request.action === "delivered" || request.action === "discard-request") {
				const run = state.runs.find((r) => r.id === request.runId);
				if (!run || run.status === "cancelled") return state;
				if (request.action === "delivered") {
					run.deliveredAt = Date.now();
					run.sessionId = request.sessionId;
				} else if (run.requestToken === request.requestToken && !run.deliveredAt && !run.frames.length && !Object.keys(run.slots).length && run.status === "waiting_agent") run.status = "cancelled";
				await writeCoverState(folder, state);
				this.host.changed();
				return state;
			}
			if (request.action === "create" || request.action === "test") {
				if (context.selectedVideo !== request.video) throw new Error("当前视频已切换，请重新发起制作。");
				const path = await videoFile(folder, request.video), info = await lstat(path);
				const ratios = request.action === "test" ? ["3x4"] : COVER_RATIOS$1.filter((ratio) => request.ratios.includes(ratio));
				const purpose = request.action === "test" ? "service_test" : "cover";
				if (!ratios.length) throw new Error("请至少选择一种画幅。");
				const existing = [...state.runs].reverse().find((r) => [
					"waiting_agent",
					"preparing",
					"running"
				].includes(r.status) && (r.purpose ?? "cover") === purpose);
				if (existing && existing.video.name === request.video && existing.video.size === info.size && existing.video.modifiedAt === info.mtimeMs && ratios.join() === COVER_RATIOS$1.filter((ratio) => existing.ratios.includes(ratio)).join()) return state;
				if (this.active.has(folder)) throw new Error("这一期已有封面任务，请等待或取消后再制作。");
				if (existing) existing.status = "cancelled";
				const now = Date.now();
				state.runs.push({
					purpose,
					...request.action === "create" && request.requestToken ? { requestToken: request.requestToken } : {},
					selectionRevision: state.selectionRevision ?? 0,
					id: randomUUID(),
					contentId: request.id,
					folderPath: folder,
					video: {
						name: request.video,
						size: info.size,
						modifiedAt: info.mtimeMs
					},
					ratios,
					createdAt: now,
					updatedAt: now,
					status: "waiting_agent",
					frames: [],
					slots: {}
				});
			} else if (request.action === "import") {
				const info = await inspectImage(request.sourcePath, signal);
				const version = await saveVersionBytes(folder, {
					id: randomUUID(),
					ratio: request.ratio,
					source: "import",
					createdAt: Date.now(),
					review: "pass",
					...context.selectedVideo ? { video: context.selectedVideo } : {}
				}, await readFile(request.sourcePath), signal);
				if (info.width !== version.width || info.height !== version.height) throw new Error("导入期间图片发生变化，请重新导入。");
				state.versions.push(version);
				if (state.selected[request.ratio] === void 0) {
					state.selected[request.ratio] = version.id;
					state.selectionRevision = (state.selectionRevision ?? 0) + 1;
				}
			} else {
				const version = state.versions.find((v) => v.id === request.versionId);
				if (!version) throw new Error("封面版本已找不到。");
				if (request.action === "remove") {
					version.hidden = true;
					if (state.selected[version.ratio] === version.id) state.selected[version.ratio] = null;
					state.selectionRevision = (state.selectionRevision ?? 0) + 1;
					await writeCoverState(folder, state);
					this.host.changed();
					return state;
				}
				if (version.hidden) throw new Error("此封面已移除，请重新导入后使用。");
				await boundedFile(folder, version.file);
				if (request.action === "review") {
					version.review = request.verdict;
					version.reviewNote = request.note;
				}
				if (request.action === "select" || request.action === "review" && request.select) {
					if (version.review !== "pass") throw new Error("请先完成这个版本的图片质检，再选为当前封面。");
					const image = await inspectImage(await boundedFile(folder, version.file), signal);
					assertRatio(image.width, image.height, version.ratio);
					Object.assign(version, image);
					const run = state.runs.find((r) => r.id === version.runId);
					const source = run ? await videoFile(folder, run.video.name).then((file) => lstat(file)).catch(() => void 0) : void 0;
					const canAutoSelect = run && source?.size === run.video.size && source?.mtimeMs === run.video.modifiedAt && (run.selectionRevision ?? 0) === (state.selectionRevision ?? 0) && context.selectedVideo === run.video.name;
					if (request.action === "select" || canAutoSelect) {
						state.selected[version.ratio] = version.id;
						if (request.action === "select") state.selectionRevision = (state.selectionRevision ?? 0) + 1;
					}
				}
			}
			await writeCoverState(folder, state);
			this.host.changed();
			return state;
		});
		if (request.action === "test") {
			const run = [...result.runs].reverse().find((r) => r.purpose === "service_test" && r.video.name === request.video);
			await this.start(request, run.id, {
				headline: "生图服务测试",
				analysis: "用户点击测试生图，明确请求一张文字生图测试图片；无需视频分析。",
				frameIds: [],
				mode: "text",
				prompts: { "3x4": "Create a clean blue and cream abstract cover with the exact title IMAGE SERVICE TEST, no people. Exact 3:4 portrait." }
			});
			return this.state(request);
		}
		return result;
	}
	async image(scope, versionId) {
		const { folder } = await this.host.resolve(scope), version = (await this.load(folder)).versions.find((v) => v.id === versionId);
		if (!version) throw new Error("封面版本不存在。");
		const file = await boundedFile(folder, version.file);
		return {
			mime: (await inspectImage(file)).mime,
			base64: (await readFile(file)).toString("base64")
		};
	}
	async snapshot(folder, run) {
		const path = await videoFile(folder, run.video.name), info = await lstat(path);
		if (info.size !== run.video.size || info.mtimeMs !== run.video.modifiedAt) throw new Error("视频内容已变化，请重新准备封面。");
		return path;
	}
	async prepare(scope, runId, signal) {
		if (!validId(runId)) throw new Error("无效的制作记录。");
		const context = await this.host.resolve(scope), { folder } = context;
		return coverLock(folder, async () => {
			await this.host.resolve(scope);
			const state = await this.load(folder), run = state.runs.find((r) => r.id === runId);
			if (!run || run.status === "cancelled") throw new Error("制作记录不存在或已取消。");
			const video = await this.snapshot(folder, run), dir = await ownedDirectory(folder, "runs", runId);
			const rules = join(this.host.skill(), "references/cover-rules.md"), flow = join(this.host.skill(), "references/agent-native-flow.md");
			await readFile(rules, "utf8").catch(() => {
				throw new Error("未发现 oil-cover 视觉规则，请先安装或配置该 Skill。");
			});
			if (!run.frames.length) {
				if (this.active.has(folder)) throw new Error("这一期已有封面任务，请等待或取消后再准备画面。");
				const preparation = new AbortController();
				const preparationSignal = AbortSignal.any([signal, preparation.signal]);
				this.active.set(folder, {
					runId,
					controller: preparation
				});
				run.status = "preparing";
				await writeCoverState(folder, state);
				try {
					const duration = Number((await mediaCommand("ffprobe", [
						"-v",
						"error",
						"-show_entries",
						"format=duration",
						"-of",
						"default=noprint_wrappers=1:nokey=1",
						video
					], preparationSignal)).trim());
					if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长。");
					for (let i = 0; i < 8; i++) {
						preparationSignal.throwIfAborted();
						const at = Math.max(0, duration * i / 8), file = join(dir, `frame-${i}.jpg`);
						await mediaCommand("ffmpeg", [
							"-v",
							"error",
							"-y",
							"-ss",
							String(at),
							"-i",
							video,
							"-frames:v",
							"1",
							"-vf",
							"scale=min(1280\\,iw):-2",
							file
						], preparationSignal);
						run.frames.push({
							id: String(i),
							at,
							file: relative(folder, file)
						});
					}
					await this.snapshot(folder, run);
					run.status = "waiting_agent";
					run.updatedAt = Date.now();
					await writeCoverState(folder, state);
				} catch (error) {
					run.status = preparationSignal.aborted ? "cancelled" : "failed";
					run.error = "抽取画面失败或已取消，请检查视频和 ffmpeg 后重新准备。";
					run.frames = [];
					await writeCoverState(folder, state);
					throw new Error(run.error);
				} finally {
					this.active.delete(folder);
				}
			}
			return {
				run,
				images: await Promise.all(run.frames.map(async (f) => ({
					name: `frame-${f.id} @ ${f.at.toFixed(2)}s`,
					data: await readFile(await boundedFile(folder, f.file))
				}))),
				context: `标题：${context.title}\n文稿：${context.script}\n字幕：${context.transcript}`,
				rules,
				flow
			};
		});
	}
	async start(scope, runId, plan, retryRatios, acknowledgeUnknown = false, owner) {
		const { folder } = await this.host.resolve(scope), jobs = this.host.jobs();
		if (!jobs) throw new Error("Harness 后台任务服务尚未就绪。");
		return coverLock(folder, async () => {
			await this.host.resolve(scope);
			const state = await this.load(folder), run = state.runs.find((r) => r.id === runId);
			if (!run) throw new Error("制作记录已找不到。");
			if (this.active.has(folder)) {
				if (this.active.get(folder)?.runId === runId) return run;
				throw new Error("这一期已有其他封面任务。");
			}
			await this.snapshot(folder, run);
			const settings = await readImageSettings(this.host.dataDir), key = await this.host.key();
			const latestSettings = await readImageSettings(this.host.dataDir);
			if (settings.pending || latestSettings.pending || settings.revision !== latestSettings.revision) throw new Error("生图设置更新未完成或已变化，请先保存。");
			if (!settings.apiBase || !settings.model || !key) throw new Error("请在数据与设置中配置生图服务地址、模型和 API Key。");
			if (plan) {
				if (run.status === "cancelled") throw new Error("该制作记录已取消，请重新发起。");
				if (!plan.headline.trim() || !plan.analysis.trim()) throw new Error("请先保存标题、选帧分析和逐画幅提示词。");
				if (plan.frameIds.some((id) => !run.frames.some((f) => f.id === id))) throw new Error("参考画面不属于本次制作记录。");
				if (plan.mode === "reference" && !plan.frameIds.length) throw new Error("请选择真实视频画面。");
				run.headline = plan.headline;
				run.analysis = plan.analysis;
				run.frameIds = plan.frameIds;
				run.mode = plan.mode;
				run.provider = {
					apiBase: settings.apiBase,
					model: settings.model,
					revision: settings.revision
				};
			} else if (run.provider?.revision !== settings.revision) throw new Error("生图设置已变化，请重新发起制作，避免混用服务。");
			const ratios = retryRatios ?? run.ratios;
			for (const ratio of ratios) {
				if (!run.ratios.includes(ratio)) throw new Error("画幅不属于本次制作任务。");
				const old = run.slots[ratio];
				if (old?.status === "completed") continue;
				if (old?.status === "unconfirmed" && !acknowledgeUnknown) throw new Error("上次服务端结果未确认；核对后勾选确认再重试，可能产生新的费用。");
				const prompt = plan?.prompts[ratio] ?? old?.prompt;
				if (!prompt?.trim()) throw new Error(`${ratio} 缺少完整提示词。`);
				run.slots[ratio] = {
					status: "pending",
					versionId: randomUUID(),
					prompt
				};
			}
			if (!ratios.some((r) => run.slots[r]?.status === "pending")) return run;
			const dir = await ownedDirectory(folder, "runs", run.id);
			await writeFile(join(dir, "analysis.md"), run.analysis ?? "", "utf8");
			await writeFile(join(dir, "cover_plan.md"), `# ${run.headline}\n\n${ratios.join(", ")}\n\n${run.analysis}`, "utf8");
			for (const ratio of ratios) await writeFile(join(dir, `cover_${ratio}.prompt.md`), run.slots[ratio]?.prompt ?? "", "utf8");
			run.status = "running";
			run.updatedAt = Date.now();
			await writeCoverState(folder, state);
			const controller = new AbortController();
			this.active.set(folder, {
				runId,
				controller
			});
			try {
				run.jobId = jobs.start({
					kind: "creator-media",
					label: `制作封面：${run.headline}`,
					...owner ? { owner } : {},
					run: () => ({
						cancel: () => controller.abort(),
						done: this.execute(folder, runId, settings, key, controller.signal)
					})
				});
				await writeCoverState(folder, state);
			} catch (error) {
				this.active.delete(folder);
				run.status = "failed";
				run.error = safeImageError(error, key);
				for (const slot of Object.values(run.slots)) if (slot.status === "pending") slot.status = "failed";
				await writeCoverState(folder, state);
				throw new Error(run.error);
			}
			this.host.changed();
			return run;
		});
	}
	async execute(folder, runId, settings, key, signal) {
		try {
			const run = (await coverLock(folder, () => readCoverState(folder))).runs.find((r) => r.id === runId);
			const references = await Promise.all((run.frameIds ?? []).map(async (id) => {
				const frame = run.frames.find((f) => f.id === id);
				return {
					name: basename(frame.file),
					data: await readFile(await boundedFile(folder, frame.file))
				};
			}));
			for (const ratio of run.ratios) {
				const slot = (await coverLock(folder, () => readCoverState(folder))).runs.find((r) => r.id === runId).slots[ratio];
				if (slot?.status !== "pending") continue;
				if (signal.aborted) {
					await this.update(folder, runId, (r) => {
						r.slots[ratio].status = "cancelled";
					});
					continue;
				}
				await this.snapshot(folder, run);
				await this.update(folder, runId, (r) => {
					r.slots[ratio].status = "running";
				});
				try {
					const bytes = await requestImage(settings, key, {
						ratio,
						prompt: slot.prompt,
						mode: run.mode ?? "reference",
						references
					}, signal);
					const version = await saveVersionBytes(folder, {
						id: slot.versionId,
						ratio,
						source: "generated",
						createdAt: Date.now(),
						runId,
						video: run.video.name,
						review: "pending"
					}, bytes);
					await this.update(folder, runId, (r, state) => {
						state.versions.push(version);
						r.slots[ratio].status = "completed";
					});
					await recordImageSuccess(this.host.dataDir, settings, run.mode ?? "reference", ratio).catch(() => void 0);
				} catch (error) {
					await this.update(folder, runId, (r) => {
						const s = r.slots[ratio];
						s.status = error instanceof ImageRequestError && error.uncertain ? "unconfirmed" : "failed";
						s.error = safeImageError(error, key);
					});
				}
			}
			const result = (await this.update(folder, runId, (r) => {
				r.status = coverRunStatus(r.slots);
			})).runs.find((r) => r.id === runId);
			return {
				status: result.status === "completed" ? "completed" : signal.aborted ? "killed" : "failed",
				result: `封面任务 ${runId}: ${result.status}；请检查各画幅并完成视觉质检。`
			};
		} catch (error) {
			await this.update(folder, runId, (r) => {
				r.status = "unconfirmed";
				r.error = safeImageError(error, key);
			});
			return {
				status: "failed",
				result: safeImageError(error, key)
			};
		} finally {
			this.active.delete(folder);
			this.host.changed();
		}
	}
	async update(folder, runId, mutate) {
		return coverLock(folder, async () => {
			const state = await this.load(folder), run = state.runs.find((r) => r.id === runId);
			if (!run) throw new Error("制作记录缺失。");
			mutate(run, state);
			run.updatedAt = Date.now();
			await writeCoverState(folder, state);
			this.host.changed();
			return state;
		});
	}
};
//#endregion
//#region src/production/videoIdentity.ts
function sameMediaIdentityError(expected, actual) {
	if (!sameMedia(expected, actual)) throw new Error("视频已被替换，请重新准备本次操作。");
}
//#endregion
//#region src/production/browser.ts
var BrowserControlError = class extends Error {};
const browserControlStopped = (value) => value instanceof BrowserControlError || /USER_CONTROL|user (?:now controls|took control|has taken control)|not assigned to an agent|task space.*inactive|browser permission prompt/i.test(value instanceof Error ? value.message : String(value));
const leases = /* @__PURE__ */ new Map();
function pauseBrowser(dataDir) {
	leases.get(dataDir)?.abort();
}
async function withBrowser(dataDir, signal, work) {
	if ((await readSettings(dataDir)).browserPaused) throw new Error("浏览器自动操作已暂停，请在发布设置中继续。");
	if (leases.has(dataDir)) throw new Error("浏览器正在处理其他上传或数据任务，请稍后重试。");
	const controller = new AbortController();
	leases.set(dataDir, controller);
	try {
		return await work(AbortSignal.any([signal, controller.signal]));
	} catch (error) {
		if (browserControlStopped(error)) await updateSettings(dataDir, (settings) => {
			settings.browserPaused = true;
		});
		throw error;
	} finally {
		if (leases.get(dataDir) === controller) leases.delete(dataDir);
	}
}
async function probeAccount(platform, signal, login = false, resumeSpace) {
	const sourcePath = await resource("scripts", "ego-account.mjs");
	const input = (await readFile(sourcePath, "utf8")).replace(/^export /gm, "") + `\nconst s=accountScript(${JSON.stringify(platform)},{login:${JSON.stringify(login)},resumeSpace:${JSON.stringify(resumeSpace)}});\n`;
	const build = await runProcess(process.execPath, [
		"--input-type=module",
		"-e",
		`${input}\nprocess.stdout.write(s);`
	], {
		signal,
		env: { ELECTRON_RUN_AS_NODE: "1" }
	});
	const result = await runProcess(await browserExecutable(), ["nodejs"], {
		input: build.stdout,
		signal,
		timeout: 6e4
	});
	if (browserControlStopped(`${result.stdout}\n${result.stderr}`)) throw new BrowserControlError("浏览器已交给你，请处理页面权限或验证提示后再继续。");
	if (result.code !== 0) throw new Error("浏览器账号检查失败，请确认浏览器已打开，并完成首次设置。");
	const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).reverse().find((row) => row.includes("CREATOR_ACCOUNT:"));
	if (!line) throw new Error("未收到可靠的账号检查结果。");
	const value = JSON.parse(line.slice(line.indexOf("CREATOR_ACCOUNT:") + 16));
	if (value.platform !== platform || ![
		"connected",
		"login-required",
		"unverified"
	].includes(value.state)) throw new Error("账号检查结果无效。");
	if (value.state === "connected" && (!value.id || !value.name)) throw new Error("当前账号身份不完整。");
	return value;
}
async function requireAccount(platform, id, signal) {
	const observed = await probeAccount(platform, signal);
	if (observed.state !== "connected" || observed.id !== id) throw new Error("当前登录账号与任务账号不一致，请切回原账号后继续。");
}
//#endregion
//#region src/production/publishing.ts
async function releaseUploadBrowser(folder, task) {
	if (!task.platform || !/^[a-f0-9-]{36}$/i.test(task.id)) return;
	const file = await inside(folder, join(".dsh-creator-workbench", "production", task.id, "publisher-jobs", task.id, "state.json")).catch(() => void 0);
	if (!file) return;
	const spaceId = JSON.parse(await readFile(file, "utf8").catch(() => "{}")).platforms?.[publisherPlatform(task.platform)]?.taskSpaceId;
	if (!Number.isSafeInteger(spaceId) || !spaceId) return;
	const script = `const space=(await listTaskSpaces()).find(s=>s.id===${spaceId} && s.name.includes(${JSON.stringify(task.id)}));if(space?.ownership==='agent'){const task=await taskSpace(space.id);await task.handOff();}`;
	await runProcess(await browserExecutable(), ["nodejs"], {
		input: script,
		timeout: 1e4
	});
}
async function makeUploadPackage(input) {
	const { fields, signal, dir } = input, platform = publisherPlatform(fields.platform), root = await pinnedPublisher(input.dataDir);
	const video = await inside(input.folder, input.video), covers = { uploadCustomCover: fields.useCovers };
	const assets = [];
	if (fields.useCovers) for (const [ratio, name] of [
		["3x4", "vertical3x4Path"],
		["4x3", "horizontal4x3Path"],
		["16x9", "horizontal16x9Path"]
	]) {
		const source = input.covers[ratio];
		if (source) {
			const file = await inside(input.folder, source);
			covers[name] = file;
			assets.push({
				file,
				sha256: await hashFile(file, signal)
			});
		}
	}
	const config = join(dir, "publisher-config.json"), file = join(dir, "publish-package.json");
	const nodeEnv = {
		ELECTRON_RUN_AS_NODE: "1",
		VIDEO_PUBLISHER_CONFIG: config
	};
	if ((await runProcess(process.execPath, [
		join(root, "scripts", "config.mjs"),
		"onboard",
		"--source-dir",
		input.folder,
		"--available-platform",
		platform,
		"--platform",
		platform,
		"--locale",
		"zh-CN",
		"--originality-policy",
		"ask_each_run",
		"--check-concurrency",
		"1",
		"--upload-concurrency",
		"1"
	], {
		signal,
		env: nodeEnv
	})).code !== 0) throw new Error("上传工具配置未完成，请重新准备运行环境。");
	const metadata = {
		videoPath: video,
		title: fields.title,
		cover: covers,
		...platform === "xiaohongshu" ? {
			xhsTitle: fields.title,
			xhsTopics: fields.tags,
			description: fields.description
		} : {},
		...platform === "douyin" ? {
			douyinTitle: fields.title,
			douyinDescription: fields.description,
			douyinTopics: fields.tags
		} : {},
		...platform === "bilibili" ? {
			bilibiliTitle: fields.title,
			bilibiliDescription: fields.description,
			bilibiliTags: fields.tags,
			bilibiliAllowedAutoTags: [],
			...fields.category ? { bilibiliCategory: fields.category } : {}
		} : {},
		...platform === "wechat_channels" ? {
			wechatTitle: fields.title,
			wechatDescription: `${fields.description}\n\n${fields.tags.map((t) => `#${t}`).join(" ")}`,
			wechatTags: fields.tags
		} : {}
	};
	const serialized = JSON.stringify(metadata, null, 2);
	try {
		await writeFile(file, serialized, {
			encoding: "utf8",
			flag: "wx"
		});
	} catch (error) {
		if (error.code !== "EEXIST" || await readFile(file, "utf8") !== serialized) throw new Error("原上传包与本次材料不一致，请检查原任务。");
	}
	const checked = await runProcess(process.execPath, [
		join(root, "scripts", "check-package.mjs"),
		platform,
		file
	], {
		signal,
		env: nodeEnv
	});
	let verdict;
	try {
		verdict = JSON.parse(checked.stdout);
	} catch {
		throw new Error("上传材料检查没有返回有效结果。");
	}
	if (checked.code !== 0 || verdict.errors?.length) throw new Error(`请补齐上传材料：${(verdict.errors ?? []).map((e) => safeError(e)).join("；")}`);
	await atomic(join(dir, "assets.json"), assets);
	return {
		file: relative(input.folder, file),
		config: relative(input.folder, config),
		assets
	};
}
async function runUpload(input) {
	const { task, signal, account, dir } = input;
	if (!task.packageFile || !task.platform || !task.originalRightsConfirmed) throw new Error("上传任务缺少材料、平台或本次原创确认。");
	await requireAccount(task.platform, account.id, signal);
	if (!task.video) throw new Error("上传任务没有固定视频身份。");
	sameMediaIdentityError(task.video, await mediaIdentity(await inside(input.folder, task.video.name), signal));
	const root = await pinnedPublisher(input.dataDir), packageFile = await inside(input.folder, task.packageFile);
	const assets = JSON.parse(await readFile(join(dir, "assets.json"), "utf8"));
	for (const asset of assets) if (await hashFile(await inside(input.folder, asset.file), signal) !== asset.sha256) throw new Error("封面已修改，请重新准备上传任务。");
	const stateRoot = join(dir, "publisher-jobs"), config = join(dir, "publisher-config.json"), platform = publisherPlatform(task.platform);
	const oldState = JSON.parse(await readFile(join(stateRoot, task.id, "state.json"), "utf8").catch(() => "{}"));
	const resumeSpace = input.operation !== "create" ? oldState.platforms?.[platform]?.taskSpaceId : void 0;
	const operation = input.operation === "resume" && oldState.status === "ready" ? "inspect" : input.operation;
	const args = [
		join(root, "scripts", "v2", "publisher.mjs"),
		"--package",
		packageFile,
		"--job-id",
		task.id,
		"--state-root",
		stateRoot,
		"--platform",
		platform,
		"--operation",
		operation,
		"--reuse-space",
		"--keep-space",
		"--no-cleanup-stale-spaces",
		"--space-prefix",
		`creator-${task.id}`,
		"--check-concurrency",
		"1",
		"--upload-concurrency",
		"1",
		"--confirm-original-rights"
	];
	const result = await runProcess(process.execPath, args, {
		signal,
		timeout: 54e5,
		env: {
			ELECTRON_RUN_AS_NODE: "1",
			VIDEO_PUBLISHER_CONFIG: config,
			VIDEO_PUBLISHER_V2_EGO_COMMAND: await resource("scripts", "publisher-ego-bridge.mjs"),
			CREATOR_EGO_EXECUTABLE: await browserExecutable(),
			CREATOR_PUBLISH_PLATFORM: task.platform,
			CREATOR_PUBLISH_ACCOUNT: account.id,
			CREATOR_RESUME_SPACE: Number.isSafeInteger(resumeSpace) ? String(resumeSpace) : ""
		}
	});
	const file = join(stateRoot, task.id, "state.json");
	const slot = JSON.parse(await readFile(file, "utf8").catch(() => "{}")).platforms?.[platform], blocker = slot?.verdict?.blocker;
	const userControl = /USER_CONTROL|INPUT_CHANNEL_BROKEN|INPUT_UNAVAILABLE/.test(blocker?.code ?? "");
	if (!slot) throw new Error("上传未取得平台回执；请检查浏览器和账号，再继续原任务。");
	let ready = result.code === 0 && slot.status === "ready" && slot.verdict?.ready === true;
	let detailsError;
	if (ready && task.platform === "xiaohongshu") {
		const pkg = JSON.parse(await readFile(packageFile, "utf8"));
		const script = (await import(pathToFileURL(await resource("scripts", "publisher-xhs-details.mjs")).href)).xhsDetailsScript({
			taskId: task.id,
			videoName: pkg.videoPath.split(/[\\/]/).pop(),
			title: pkg.xhsTitle,
			description: pkg.description
		}, {
			spaceId: slot.taskSpaceId,
			mutate: input.operation !== "inspect",
			resume: input.operation !== "create"
		});
		const checked = await runProcess(await browserExecutable(), ["nodejs"], {
			input: script,
			signal,
			timeout: 3e4
		});
		const output = `${checked.stdout}\n${checked.stderr}`;
		if (browserControlStopped(output)) throw new BrowserControlError("浏览器已交给你，原草稿保留；继续原任务后再核对正文。");
		const line = output.split(/\r?\n/).find((row) => row.includes("CREATOR_XHS_DETAILS:"));
		if (checked.code !== 0 || !line) throw new Error("小红书正文尚未核对，原草稿保留，请继续原任务。");
		const details = JSON.parse(line.slice(line.indexOf("CREATOR_XHS_DETAILS:") + 20));
		await atomic(join(dir, "xiaohongshu-details.json"), details);
		ready = details.ready === true;
		detailsError = details.error;
	}
	if (ready && task.platform === "bilibili") {
		const pkg = JSON.parse(await readFile(packageFile, "utf8"));
		const detailsFile = join(dir, "bilibili-details.json");
		const previous = JSON.parse(await readFile(detailsFile, "utf8").catch((error) => {
			if (error.code === "ENOENT") return "{}";
			throw error;
		}));
		const script = (await import(pathToFileURL(await resource("scripts", "publisher-bilibili-details.mjs")).href)).bilibiliDetailsScript({
			taskId: task.id,
			videoName: pkg.videoPath.split(/[\\/]/).pop(),
			title: pkg.bilibiliTitle,
			category: pkg.bilibiliCategory
		}, {
			spaceId: slot.taskSpaceId,
			mutate: input.operation !== "inspect",
			resume: input.operation !== "create",
			previouslyVerified: previous.verifiedOnce === true || previous.ready === true
		});
		const checked = await runProcess(await browserExecutable(), ["nodejs"], {
			input: script,
			signal,
			timeout: 3e4
		});
		const output = `${checked.stdout}\n${checked.stderr}`;
		if (browserControlStopped(output)) throw new BrowserControlError("浏览器已交给你，原草稿保留；继续原任务后再核对 B 站分区。");
		const line = output.split(/\r?\n/).find((row) => row.includes("CREATOR_BILI_DETAILS:"));
		if (checked.code !== 0 || !line) throw new Error("B 站分区尚未核对，原草稿保留，请继续原任务。");
		const details = JSON.parse(line.slice(line.indexOf("CREATOR_BILI_DETAILS:") + 21));
		await atomic(detailsFile, {
			...details,
			verifiedOnce: previous.verifiedOnce === true || previous.ready === true || details.ready === true
		});
		ready = details.ready === true;
		detailsError = details.error;
	}
	if (!userControl) await requireAccount(task.platform, account.id, signal);
	return {
		ready,
		...userControl ? { error: "浏览器已交给你，请处理权限或验证提示后继续原任务。" } : detailsError ? { error: detailsError } : blocker?.message ? { error: safeError(blocker.message) } : result.code !== 0 ? { error: "上传工具未完成操作，原任务与草稿保留，请继续原任务。" } : {},
		userControl,
		receipt: relative(input.folder, file)
	};
}
//#endregion
//#region src/production/publicationUpload.ts
async function preparePublicationUpload(scope, id, revision, rights, host, signal, after, expectedAccountId) {
	if (!rights) throw new Error("请先确认本次内容拥有发布授权。");
	const state = await readState(scope.folderPath), publication = state.publications?.find((p) => p.id === id && !p.hidden);
	if (!publication || publication.revision !== revision) throw new Error("发布内容已变化，请重新查看本次材料。");
	if (!publication.title.trim()) throw new Error("请填写本次发布标题后再上传。");
	if (publication.type === "images" && publication.coverImageId && publication.imageIds[0] !== publication.coverImageId) throw new Error("图文封面与第一张图片不一致，请重新保存材料后上传。");
	if (publication.platform === "wechat" && publication.type !== "video") throw new Error("视频号暂不支持图文。");
	if (publication.platform !== "official-account" && !(await host.platforms()).includes(publication.platform)) throw new Error("请先启用此发布平台。");
	const settings = await readSettings(host.dataDir), account = publication.platform === "official-account" ? void 0 : settings.accounts[publication.platform];
	const accountId = publication.platform === "official-account" ? settings.wechat.appid : account?.id;
	if (!accountId) throw new Error("请先连接对应的发布账号。");
	if (expectedAccountId && accountId !== expectedAccountId) throw new Error("发布账号已变化，请核对当前账号后再上传。");
	const images = await Promise.all(publication.imageIds.map(async (imageId) => {
		const { image } = await creationImage(scope.folderPath, imageId, state);
		return {
			file: image.file,
			sha256: image.sha256,
			width: image.width,
			height: image.height
		};
	}));
	if (publication.type === "images" && !images.length) throw new Error("请至少选择一张发布图片。");
	const body = await readFile(await inside(scope.folderPath, publication.bodyFile), "utf8");
	const video = publication.type === "video" && publication.video ? await mediaIdentity(await inside(scope.folderPath, publication.video), signal) : void 0;
	if (publication.type === "video" && !video) throw new Error("请明确选择本次发布的视频。");
	const cover = publication.coverImageId ? (await creationImage(scope.folderPath, publication.coverImageId, state)).image.file : void 0;
	if (publication.platform === "official-account" && !cover) throw new Error("请明确选择本次公众号文章封面。");
	const sourceKey = hashText(JSON.stringify({
		type: publication.type,
		video: video?.sha256,
		images: images.map((i) => i.sha256),
		articleId: publication.articleId ?? publication.articleFile
	}));
	const snapshot = {
		publication: structuredClone(publication),
		body,
		accountId,
		images,
		sourceKey,
		...cover ? { cover } : {},
		...video ? { video } : {}
	};
	if (snapshot.publication.category?.trim()) snapshot.publication.category = snapshot.publication.category.trim();
	else delete snapshot.publication.category;
	const key = hashText(JSON.stringify(snapshot));
	return updateState(scope.folderPath, async (latest) => {
		await host.resolve(scope);
		if ((latest.publications?.find((p) => p.id === id && !p.hidden))?.revision !== revision) throw new Error("材料正在修改，请重新确认后上传。");
		const candidates = latest.tasks.filter((t) => t.kind === "upload" && (t.account?.id ?? t.wechatAppId) === accountId && (t.platform ?? "official-account") === publication.platform && (video && t.video ? sameMedia(t.video, video) : t.publicationId && t.publicationType === publication.type && (t.publicationId === id || t.source?.text === sourceKey)));
		const previous = after ? candidates.at(-1) : [...candidates].reverse().find((t) => t.uploadKey === key) ?? candidates.at(-1);
		if (after && !candidates.some((t) => t.id === after)) throw new Error("原任务与当前平台、账号或材料不符。");
		if (previous && (!after || previous.id !== after || ["queued", "running"].includes(previous.status))) return {
			task: structuredClone(previous),
			fresh: false,
			notice: {
				taskId: previous.id,
				canCreateNew: !["queued", "running"].includes(previous.status),
				message: "已有上传记录，请检查或继续原任务；需要另一份时明确另建。"
			}
		};
		const task = {
			id: randomUUID(),
			kind: "upload",
			status: "queued",
			contentId: scope.id,
			folderPath: scope.folderPath,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			publicationId: id,
			publicationRevision: revision,
			publicationType: publication.type,
			uploadKey: key,
			source: {
				kind: "materials",
				text: sourceKey
			},
			originalRightsConfirmed: true,
			...account ? {
				account,
				platform: account.platform
			} : { wechatAppId: accountId },
			...video ? { video } : {}
		};
		const dir = await owned(scope.folderPath, task.id);
		const freeze = async (file) => {
			const source = await inside(scope.folderPath, file), bytes = await readFile(source), digest = await hashFile(source, signal), target = join(dir, `asset-${digest}${extname(file).toLowerCase()}`);
			try {
				await writeFile(target, bytes, { flag: "wx" });
			} catch (error) {
				if (error.code !== "EEXIST" || !(await readFile(target)).equals(bytes)) throw error;
			}
			if (await hashFile(target, signal) !== digest) throw new Error("材料读取期间发生变化，请重新确认。");
			return relative(scope.folderPath, target);
		};
		snapshot.images = await Promise.all(snapshot.images.map(async (image) => ({
			...image,
			file: await freeze(image.file)
		})));
		if (snapshot.cover) snapshot.cover = await freeze(snapshot.cover);
		for (const [ratio, file] of Object.entries(snapshot.publication.coverFiles ?? {})) if (file) snapshot.publication.coverFiles[ratio] = await freeze(file);
		if (publication.type === "article") snapshot.articleFile = relative(scope.folderPath, await snapshotPublicationArticle(scope.folderPath, dir, publication, body, images.map((i) => i.file)));
		await atomic(join(dir, "publication-snapshot.json"), snapshot);
		task.packageFile = relative(scope.folderPath, join(dir, "publication-snapshot.json"));
		latest.tasks.push(task);
		host.reserve(task.id);
		return {
			task,
			fresh: true
		};
	});
}
async function executePublicationUpload(folder, task, operation, signal, host) {
	if (!task.packageFile || !task.publicationId) throw new Error("上传缺少固定材料。");
	const snapshot = JSON.parse(await readFile(await inside(folder, task.packageFile), "utf8"));
	const { publication } = snapshot, dir = await owned(folder, task.id), settings = await readSettings(host.dataDir);
	for (const image of snapshot.images) if (await hashFile(await inside(folder, image.file), signal) !== image.sha256) throw new Error("本次图片文件已变化，请核对原任务。");
	let receipt, remoteId, savedDraft = false;
	if (publication.platform === "official-account") {
		if (settings.wechat.appid !== snapshot.accountId) throw new Error("公众号账号已变化，请切回原账号。");
		const secret = await host.key(wechatCredential(snapshot.accountId));
		if (!secret || !snapshot.cover) throw new Error("请先完成公众号账号及封面配置。");
		const article = await publicationArticleForRender(folder, snapshot.articleFile ? await inside(folder, snapshot.articleFile) : await snapshotPublicationArticle(folder, dir, publication, snapshot.body, snapshot.images.map((i) => i.file)), publication.title);
		const state = await readState(folder), record = [...state.records ?? []].reverse().find((r) => r.publicationId === publication.id && r.accountId === snapshot.accountId && r.remoteId);
		const previous = state.drafts.find((d) => d.appid === snapshot.accountId && (record?.remoteId ? d.mediaId === record.remoteId : d.articleFile === publication.bodyFile));
		const draft = await submitWechat({
			dataDir: host.dataDir,
			folder,
			dir,
			articleFile: article,
			cover: snapshot.cover,
			config: settings.wechat,
			secret,
			...previous ? { previous } : {},
			operation: operation === "inspect" ? "inspect" : "publish",
			signal
		});
		await updateState(folder, (s) => {
			const i = s.drafts.findIndex((d) => d.id === draft.id);
			if (i < 0) s.drafts.push(draft);
			else s.drafts[i] = draft;
		});
		receipt = relative(folder, join(dir, "wechat-receipt.json"));
		remoteId = draft.mediaId;
		savedDraft = true;
	} else {
		const account = settings.accounts[publication.platform];
		if (!account || account.id !== snapshot.accountId) throw new Error("当前账号与上传任务不一致，请切回原账号。");
		const result = await withBrowser(host.dataDir, signal, async (current) => {
			await requireAccount(publication.platform, snapshot.accountId, current);
			if (publication.type === "video") {
				const prepared = operation !== "inspect" ? await makeUploadPackage({
					dataDir: host.dataDir,
					folder,
					dir,
					video: snapshot.video.name,
					covers: publication.coverFiles ?? {},
					fields: {
						platform: publication.platform,
						title: publication.title,
						description: snapshot.body,
						tags: publication.tags,
						originalRightsConfirmed: true,
						useCovers: Boolean(Object.keys(publication.coverFiles ?? {}).length),
						...publication.category ? { category: publication.category } : {}
					},
					signal: current
				}) : { file: relative(folder, join(dir, "publish-package.json")) };
				const videoTask = {
					...task,
					packageFile: prepared.file
				};
				try {
					return await runUpload({
						dataDir: host.dataDir,
						folder,
						dir,
						task: videoTask,
						account,
						operation,
						signal: current
					});
				} finally {
					await releaseUploadBrowser(folder, videoTask).catch(() => void 0);
				}
			}
			let graphicFile = await inside(folder, task.packageFile);
			if (publication.type === "article") {
				const article = await publicationArticleForRender(folder, snapshot.articleFile ? await inside(folder, snapshot.articleFile) : await snapshotPublicationArticle(folder, dir, publication, snapshot.body, snapshot.images.map((i) => i.file)), publication.title);
				const rendered = await formatArticle(host.dataDir, folder, article, settings.wechat.theme, current);
				graphicFile = join(dir, "graphic-input.json");
				await atomic(graphicFile, {
					...snapshot,
					html: rendered.html
				});
			}
			const script = await resource("scripts", "graphic-publisher.mjs"), program = `const {runGraphicPublisher}=await import(${JSON.stringify(new URL(`file:///${script.replace(/\\/g, "/")}`).href)});await runGraphicPublisher(${JSON.stringify({
				folder,
				taskId: task.id,
				operation,
				snapshotFile: graphicFile
			})});`;
			const result = await runProcess(await browserExecutable(), ["nodejs"], {
				input: program,
				signal: current,
				timeout: 3e5
			});
			const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).reverse().find((s) => s.startsWith("CREATOR_GRAPH:"));
			if (!line) throw new Error("图文上传未返回可靠结果，请检查原任务页面后继续。");
			const observed = JSON.parse(line.slice(14));
			await updateState(folder, (state) => {
				state.tasks.find((t) => t.id === task.id).receipt = observed.receipt;
			});
			if (observed.userControl) throw new BrowserControlError(observed.error ?? "浏览器已交还，请明确继续原任务。");
			await requireAccount(publication.platform, snapshot.accountId, current);
			return observed;
		});
		if (!result.ready) {
			await updateState(folder, (state) => {
				const stored = state.tasks.find((t) => t.id === task.id);
				stored.status = "blocked";
				stored.receipt = result.receipt;
				stored.error = result.error ?? "材料尚未核对完成，请检查原任务。";
				stored.updatedAt = Date.now();
			});
			host.changed();
			return;
		}
		if ((await readSettings(host.dataDir)).accounts[publication.platform]?.id !== snapshot.accountId) throw new Error("任务完成时账号配置已变化，结果已保留，请切回原账号核对。");
		receipt = result.receipt;
		remoteId = "remoteId" in result ? result.remoteId : void 0;
		savedDraft = "savedDraft" in result && result.savedDraft === true;
	}
	await updateState(folder, (state) => {
		const stored = state.tasks.find((t) => t.id === task.id);
		stored.status = "ready";
		stored.step = savedDraft ? "平台草稿已保存" : "已上传，待人工发表";
		stored.receipt = receipt;
		stored.updatedAt = Date.now();
		delete stored.error;
		const record = {
			id: task.id,
			publicationId: publication.id,
			revision: publication.revision,
			platform: publication.platform,
			type: publication.type,
			accountId: snapshot.accountId,
			taskId: task.id,
			state: savedDraft ? "draft" : "uploaded",
			submittedFile: task.packageFile,
			updatedAt: Date.now(),
			receipt,
			...remoteId ? { remoteId } : {}
		};
		const records = state.records ??= [], index = records.findIndex((r) => r.id === task.id);
		if (index < 0) records.push(record);
		else records[index] = record;
	});
	host.changed();
}
//#endregion
//#region src/production/imageTasks.ts
async function reconcileImageItems(folder, task) {
	if (!task.imageItems?.some((item) => ["running", "pending"].includes(item.status))) return;
	for (const item of task.imageItems ?? []) {
		if (item.status !== "running") continue;
		const dir = await owned(folder, "images", item.imageId ?? item.id), file = (await readdir(dir)).find((f) => /^image\.(png|jpg|webp)$/.test(f));
		let recovered = false;
		if (file) try {
			const image = await saveCreationImage(folder, await readFile(join(dir, file)), {
				id: item.imageId ?? item.id,
				purpose: item.purpose,
				source: "generated",
				taskId: task.id
			});
			assertRatio(image.width, image.height, item.ratio);
			await updateState(folder, (state) => {
				if (!state.images?.some((i) => i.id === image.id)) (state.images ??= []).push(image);
				const slot = state.tasks.find((t) => t.id === task.id)?.imageItems?.find((i) => i.id === item.id);
				if (slot) {
					slot.imageId = image.id;
					slot.status = "completed";
					delete slot.error;
				}
			});
			recovered = true;
		} catch {}
		if (!recovered) await updateState(folder, (state) => {
			const slot = state.tasks.find((t) => t.id === task.id)?.imageItems?.find((i) => i.id === item.id);
			if (slot) {
				slot.status = "unconfirmed";
				slot.error = "制作中断，服务端结果需核对，未自动重发。";
			}
		});
	}
	await updateState(folder, (state) => {
		const stored = state.tasks.find((t) => t.id === task.id);
		if (!stored?.imageItems) return;
		for (const item of stored.imageItems) if (item.status === "pending") item.status = "cancelled";
		const complete = stored.imageItems.filter((i) => i.status === "completed").length;
		stored.status = complete === stored.imageItems.length ? "completed" : stored.imageItems.some((i) => i.status === "unconfirmed") ? "unconfirmed" : "failed";
		stored.step = `${complete}/${stored.imageItems.length} 张图片已保存`;
		stored.updatedAt = Date.now();
		if (stored.status === "completed") delete stored.error;
		else stored.error = stored.status === "unconfirmed" ? "制作中断，请核对已保存图片及上次请求结果。" : "制作中断，可继续尚未完成的图片。";
	});
}
async function generateImageItems(input) {
	const settings = structuredClone(input.settings ?? await readImageSettings(input.dataDir));
	if (!settings.apiBase || !settings.model || settings.pending) throw new Error("请先完成生图服务设置。");
	const items = input.task.imageItems ?? [];
	const referenceData = new Map(await Promise.all([...new Set(items.flatMap((i) => i.references))].map(async (id) => {
		const { file } = await creationImage(input.folder, id);
		return [id, {
			data: await readFile(file),
			name: basename(file)
		}];
	})));
	for (const original of items) {
		if (input.itemIds && !input.itemIds.includes(original.id) || original.status === "completed") continue;
		if (input.signal.aborted) break;
		const imageId = randomUUID();
		const patch = async (values) => {
			await updateState(input.folder, (state) => {
				const slot = state.tasks.find((t) => t.id === input.task.id)?.imageItems?.find((i) => i.id === original.id);
				if (!slot) throw new Error("图片任务已不存在。");
				Object.assign(slot, values);
			});
			input.changed();
		};
		await patch({
			status: "running",
			imageId
		});
		try {
			const references = original.references.map((id) => referenceData.get(id));
			const bytes = await requestImage(settings, input.key, {
				ratio: original.ratio,
				prompt: original.prompt,
				mode: references.length ? "reference" : "text",
				references
			}, input.signal);
			const image = await saveCreationImage(input.folder, bytes, {
				id: imageId,
				purpose: original.purpose,
				source: "generated",
				taskId: input.task.id
			});
			assertRatio(image.width, image.height, original.ratio);
			await updateState(input.folder, (state) => {
				(state.images ??= []).push(image);
			});
			await patch({
				status: "completed",
				imageId
			});
		} catch (error) {
			await patch({
				status: error instanceof ImageRequestError && error.uncertain ? "unconfirmed" : input.signal.aborted ? "cancelled" : "failed",
				error: safeImageError(error, input.key)
			});
		}
	}
	await updateState(input.folder, (state) => {
		const task = state.tasks.find((t) => t.id === input.task.id);
		if (input.signal.aborted) {
			for (const item of task.imageItems ?? []) if (item.status === "pending") item.status = "cancelled";
		}
		const states = task.imageItems?.map((item) => item.status) ?? [];
		task.status = states.every((s) => s === "completed") ? "completed" : states.includes("unconfirmed") ? "unconfirmed" : input.signal.aborted ? "cancelled" : "failed";
		task.step = `${states.filter((s) => s === "completed").length}/${states.length} 张图片已保存`;
		task.updatedAt = Date.now();
	});
	input.changed();
}
//#endregion
//#region src/production/creationActions.ts
async function creationAction(detail, request, signal, host) {
	const folder = detail.folderPath;
	if (request.action === "import-image") await importCreationImage(folder, request.sourcePath, request.purpose, signal, host.assertAvailable);
	else if (request.action === "register-article" || request.action === "import-article") {
		let file = request.action === "register-article" ? await inside(folder, request.file) : request.sourcePath;
		const extension = extname(file).toLowerCase();
		if (![
			".md",
			".html",
			".htm"
		].includes(extension)) throw new Error("请选择 Markdown 或 HTML 文章。");
		const info = await lstat(file);
		if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > 2097152) throw new Error("请选择小于 2 MB 的普通文章文件。");
		const text = await readFile(file, "utf8"), id = randomUUID();
		if (request.action === "register-article") for (const imageId of request.imageIds ?? []) await creationImage(folder, imageId);
		if (request.action === "import-article") {
			const dir = await owned(folder, "articles", id);
			file = await snapshotPublicationArticle(dirname(file), dir, {
				articleFile: basename(file),
				bodyFile: basename(file)
			}, text, []);
		}
		const title = extension === ".md" ? text.match(/^#\s+(.+)/m)?.[1] : text.match(/<h1[^>]*>([\s\S]*?)<\/h1>|<title[^>]*>([\s\S]*?)<\/title>/i)?.slice(1).find(Boolean)?.replace(/<[^>]*>/g, "");
		await updateState(folder, async (state) => {
			await host.assertAvailable();
			state.articles.push({
				id,
				file: relative(folder, file),
				title: title?.trim() || detail.title,
				createdAt: Date.now(),
				frameFiles: [],
				format: extension === ".md" ? "markdown" : "html",
				...request.action === "register-article" && request.source ? { source: request.source } : {},
				...request.action === "register-article" && request.imageIds ? { imageIds: request.imageIds } : {}
			});
		});
	} else if (request.action === "remove-image") await updateState(folder, async (state) => {
		await host.assertAvailable();
		const image = state.images?.find((row) => row.id === request.imageId);
		if (!image) throw new Error("图片不存在。");
		image.hidden = true;
	});
	else if (request.action === "save-publication") {
		const saved = await savePublication(folder, request.input, request.publicationId, request.expectedRevision, host.assertAvailable, request.saveId);
		host.changed();
		return { savedPublication: {
			id: saved.id,
			revision: saved.revision
		} };
	} else if (request.action === "remove-publication") await updateState(folder, async (state) => {
		await host.assertAvailable();
		const publication = state.publications?.find((p) => p.id === request.publicationId && !p.hidden);
		if (!publication || publication.revision !== request.expectedRevision) throw new Error("发布内容已变化，请重新读取。");
		publication.hidden = true;
		publication.revision++;
	});
	else if (request.action === "generate-images" || request.action === "retry-images") {
		const settings = await readImageSettings(host.dataDir), key = await host.key(IMAGE_CREDENTIAL), latestSettings = await readImageSettings(host.dataDir);
		if (settings.pending || latestSettings.pending || settings.revision !== latestSettings.revision) throw new Error("生图设置正在变化，请保存完成后再制作。");
		if (!key) throw new Error("请先在设置中配置生图服务。");
		if (request.action === "generate-images") {
			for (const item of request.items) for (const id of item.references ?? []) await creationImage(folder, id);
			const identity = hashText(JSON.stringify({
				items: request.items,
				source: request.source
			}));
			const unknown = (await readState(folder)).tasks.find((t) => t.kind === "images" && t.uploadKey === identity && t.status === "unconfirmed");
			if (unknown) throw new Error(`图片请求 ${unknown.id} 的结果尚未确认，请核对后重试原任务。`);
			const { task, fresh } = await host.newTask("images", {
				uploadKey: identity,
				...request.source ? { source: request.source } : {},
				...request.sessionId ? { sessionId: request.sessionId } : {},
				imageItems: request.items.map((item) => ({
					...item,
					id: randomUUID(),
					references: item.references ?? [],
					status: "pending"
				}))
			});
			if (task.uploadKey !== identity) throw new Error("已有另一组图片正在制作，请先等待或取消。");
			if (fresh) await host.launch(task, (current) => generateImageItems({
				dataDir: host.dataDir,
				folder,
				task,
				key,
				settings,
				signal: current,
				changed: host.changed
			}));
		} else {
			const task = (await readState(folder)).tasks.find((t) => t.id === request.taskId && t.kind === "images");
			if (!task?.imageItems || ["running", "queued"].includes(task.status)) throw new Error("图片任务不存在或仍在运行。");
			const slots = request.itemIds.map((id) => task.imageItems.find((i) => i.id === id));
			if (slots.some((i) => !i || i.status === "completed")) throw new Error("请选择未完成的图片重试。");
			if (slots.some((i) => i?.status === "unconfirmed") && !request.acknowledgeUnknown) throw new Error("请先核对上次图片结果，再明确重试，可能产生新的费用。");
			await updateState(folder, async (latest) => {
				await host.assertAvailable();
				const stored = latest.tasks.find((t) => t.id === task.id);
				if (!stored || ["queued", "running"].includes(stored.status) || (stored.executionRevision ?? 0) !== (task.executionRevision ?? 0)) throw new Error("图片任务已变化，请重新读取。");
				if (stored.status === "cancelled") stored.status = "failed";
			});
			await host.launch(task, (current) => generateImageItems({
				dataDir: host.dataDir,
				folder,
				task,
				key,
				settings,
				itemIds: request.itemIds,
				signal: current,
				changed: host.changed
			}));
		}
	} else return false;
	host.changed();
	return true;
}
//#endregion
//#region src/collectPublish.ts
function normalizeTitle(value) {
	return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
function titleScore(local, remote) {
	const left = normalizeTitle(local);
	const right = normalizeTitle(remote);
	if (left === "" || right === "") return 0;
	if (left === right) return 1;
	if (left.includes(right) || right.includes(left)) return .88;
	const shorter = left.length < right.length ? left : right;
	const longer = left.length < right.length ? right : left;
	let hits = 0;
	const size = Math.min(4, shorter.length);
	if (size < 2) return 0;
	for (let index = 0; index <= shorter.length - size; index += 1) if (longer.includes(shorter.slice(index, index + size))) hits += 1;
	const possible = shorter.length - size + 1;
	return possible === 0 ? 0 : hits / possible * .7;
}
function collectedPostKey(item) {
	return item.remoteId ?? item.url ?? item.title;
}
function dedupeCollectedPosts(items) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const item of items) {
		const key = collectedPostKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}
PUBLISH_PLATFORMS.map((platform) => ({
	platform,
	url: PUBLISH_PLATFORM_DEFINITIONS[platform].collectUrl
}));
function parseCollectOutput(raw) {
	const lines = raw.split(/\n/).map((line) => line.trim()).filter((line) => line.startsWith("{"));
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (line === void 0) continue;
		try {
			const value = JSON.parse(line);
			if (typeof value !== "object" || value === null) continue;
			const collected = value.collected;
			if (!Array.isArray(collected)) continue;
			const parsed = { collected: collected.flatMap((row) => {
				if (typeof row !== "object" || row === null) return [];
				const record = row;
				const platform = record.platform;
				if (!PUBLISH_PLATFORMS.includes(platform)) return [];
				const page = {
					platform,
					items: dedupeCollectedPosts(Array.isArray(record.items) ? record.items.flatMap((item) => {
						if (typeof item !== "object" || item === null) return [];
						const post = item;
						if (typeof post.title !== "string" || post.title.trim() === "") return [];
						const next = {
							platform,
							title: post.title.trim()
						};
						if (typeof post.url === "string" && post.url !== "") next.url = post.url;
						if (typeof post.remoteId === "string" && post.remoteId !== "") next.remoteId = post.remoteId;
						if (platform === "douyin" && next.remoteId && /^\d+$/.test(next.remoteId)) next.url = `https://www.douyin.com/video/${next.remoteId}`;
						if (typeof post.views === "number") next.views = post.views;
						if (typeof post.likes === "number") next.likes = post.likes;
						if (typeof post.comments === "number") next.comments = post.comments;
						return [next];
					}) : [])
				};
				if (typeof record.error === "string" && record.error !== "") page.error = record.error;
				if (record.loginRequired === true) page.loginRequired = true;
				return [page];
			}) };
			const spaceClosed = value.spaceClosed;
			if (spaceClosed === true) parsed.spaceClosed = true;
			if (spaceClosed === false) parsed.spaceClosed = false;
			return parsed;
		} catch {
			continue;
		}
	}
	throw new Error("collect-publish produced no JSON");
}
//#endregion
//#region src/collectSpaces.ts
const LEGACY_COLLECT_SPACE = "oil-collect-publish";
function defaultCollectSpaceName() {
	return `oil-collect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function collectRegistryPath(root = homedir()) {
	return join(root, ".dsh-creator-workbench", "collect-spaces.json");
}
function pidIsAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
function parseCollectRegistry(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((row) => {
			if (!row || typeof row !== "object") return [];
			const record = row;
			if (typeof record.name !== "string" || record.name.trim() === "") return [];
			if (!Number.isInteger(record.pid)) return [];
			return [{
				name: record.name.trim(),
				pid: record.pid,
				startedAt: typeof record.startedAt === "number" ? record.startedAt : 0
			}];
		});
	} catch {
		return [];
	}
}
function loadCollectRegistry(filePath) {
	try {
		return parseCollectRegistry(readFileSync(filePath, "utf8"));
	} catch {
		return [];
	}
}
function saveCollectRegistry(filePath, records) {
	mkdirSync(dirname(filePath), { recursive: true });
	const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`, { mode: 384 });
	renameSync(temp, filePath);
}
function acquireRegistryFileLock(filePath) {
	const lockPath = `${filePath}.lock`;
	mkdirSync(dirname(filePath), { recursive: true });
	for (let attempt = 0; attempt < 80; attempt += 1) try {
		const fd = openSync(lockPath, "wx");
		writeFileSync(fd, `${process.pid}\n`);
		return () => {
			try {
				closeSync(fd);
			} catch {}
			try {
				unlinkSync(lockPath);
			} catch {}
		};
	} catch (cause) {
		if (cause.code !== "EEXIST") throw cause;
		try {
			const pid = Number(readFileSync(lockPath, "utf8").trim());
			if (Number.isInteger(pid) && pid > 0 && !pidIsAlive(pid)) unlinkSync(lockPath);
		} catch {}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
	}
	throw new Error(`collect space registry is busy: ${lockPath}`);
}
function withRegistryLock(filePath, work) {
	const release = acquireRegistryFileLock(filePath);
	try {
		return work();
	} finally {
		release();
	}
}
function registerCollectSpace(filePath, record) {
	return withRegistryLock(filePath, () => {
		const existing = loadCollectRegistry(filePath);
		const stale = existing.filter((row) => row.name !== record.name && !pidIsAlive(row.pid));
		saveCollectRegistry(filePath, [...existing.filter((row) => row.name !== record.name && pidIsAlive(row.pid)), record]);
		return stale.map((row) => row.name);
	});
}
function unregisterCollectSpace(filePath, name) {
	withRegistryLock(filePath, () => {
		saveCollectRegistry(filePath, loadCollectRegistry(filePath).filter((row) => row.name !== name));
	});
}
function collectCleanupNames(options) {
	const names = [
		...options.includeLegacy === false ? [] : [LEGACY_COLLECT_SPACE],
		...options.stale ?? [],
		...options.extra ?? []
	];
	return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}
//#endregion
//#region src/collectEgo.ts
function collectScriptPath() {
	return join(dirname(fileURLToPath(import.meta.url)), "collect-publish.mjs");
}
async function resolveCollectScript(preferred) {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		preferred,
		join(here, "collect-publish.mjs"),
		join(here, "..", "scripts", "collect-publish.mjs")
	];
	for (const path of candidates) {
		if (path === void 0) continue;
		try {
			await access(path);
			return path;
		} catch {
			continue;
		}
	}
	throw new Error("collect-publish.mjs is missing; rebuild dsh-creator-workbench");
}
async function runCollectPublish(scriptPath, signal, options = {}) {
	const source = await readFile(await resolveCollectScript(scriptPath), "utf8");
	const compatibility = await egoCompatibilityPrelude();
	const executable = options.executable ?? await browserExecutable();
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
			return;
		}
		const platforms = options.platforms;
		const targets = options.targets;
		const spaceName = options.spaceName?.trim() || defaultCollectSpaceName();
		const registryPath = options.registryPath ?? collectRegistryPath();
		const cleanupNames = collectCleanupNames({
			stale: options.cleanupStale === false ? [] : loadCollectRegistry(registryPath).filter((row) => row.name !== spaceName && !pidIsAlive(row.pid)).map((row) => row.name),
			includeLegacy: options.cleanupStale !== false,
			...options.cleanupNames === void 0 ? {} : { extra: options.cleanupNames }
		});
		const env = { ...process.env };
		if (platforms !== void 0 && platforms.length > 0) env.OIL_COLLECT_PLATFORMS = platforms.join(",");
		if (targets !== void 0 && targets.length > 0) env.OIL_COLLECT_TARGETS = JSON.stringify(targets);
		env.OIL_COLLECT_SPACE = spaceName;
		env.OIL_COLLECT_KEEP = options.keepSpace === true ? "1" : "0";
		env.OIL_COLLECT_CLEANUP_STALE = options.cleanupStale === false ? "0" : "1";
		env.OIL_COLLECT_CLEANUP_NAMES = cleanupNames.join(",");
		if (options.cleanupPrefixes !== void 0 && options.cleanupPrefixes.length > 0) env.OIL_COLLECT_CLEANUP_PREFIXES = options.cleanupPrefixes.join(",");
		if (options.maxPages !== void 0) env.OIL_COLLECT_MAX_PAGES = String(options.maxPages);
		if (options.xhsScrollSteps !== void 0) env.OIL_COLLECT_XHS_SCROLL = String(options.xhsScrollSteps);
		const child = spawn(executable, ["nodejs"], {
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			env,
			windowsHide: true
		});
		if (child.pid !== void 0) registerCollectSpace(registryPath, {
			name: spaceName,
			pid: child.pid,
			startedAt: Date.now()
		});
		child.stdin?.on("error", () => void 0);
		const filter = platforms !== void 0 && platforms.length > 0 ? platforms.join(",") : "";
		const prelude = [
			`var OIL_COLLECT_PLATFORMS = ${JSON.stringify(filter)};`,
			targets !== void 0 && targets.length > 0 ? `var OIL_COLLECT_TARGETS = ${JSON.stringify(targets)};` : "",
			`var OIL_COLLECT_SPACE = ${JSON.stringify(spaceName)};`,
			`var OIL_COLLECT_KEEP = ${JSON.stringify(options.keepSpace === true ? "1" : "0")};`,
			`var OIL_COLLECT_CLEANUP_STALE = ${JSON.stringify(options.cleanupStale === false ? "0" : "1")};`,
			`var OIL_COLLECT_CLEANUP_NAMES = ${JSON.stringify(cleanupNames.join(","))};`,
			options.cleanupPrefixes !== void 0 && options.cleanupPrefixes.length > 0 ? `var OIL_COLLECT_CLEANUP_PREFIXES = ${JSON.stringify(options.cleanupPrefixes.join(","))};` : "",
			options.maxPages !== void 0 ? `var OIL_COLLECT_MAX_PAGES = ${JSON.stringify(String(options.maxPages))};` : "",
			options.xhsScrollSteps !== void 0 ? `var OIL_COLLECT_XHS_SCROLL = ${JSON.stringify(String(options.xhsScrollSteps))};` : ""
		].filter(Boolean).join("\n");
		child.stdin?.end(`${compatibility}\n${prelude}\n${source}`);
		const stdout = [];
		const stderr = [];
		child.stdout?.on("data", (chunk) => {
			stdout.push(Buffer.from(chunk));
		});
		child.stderr?.on("data", (chunk) => {
			stderr.push(Buffer.from(chunk));
		});
		let aborting = false;
		const onAbort = () => {
			aborting = true;
			child.kill("SIGTERM");
			const release = `${compatibility}\nconst spaces=await listTaskSpaces();for(const space of spaces){if(space.name===${JSON.stringify(spaceName)} && space.ownership==='agent'){await (await taskSpace(space.id)).handOff();}}`;
			runProcess(executable, ["nodejs"], {
				input: release,
				timeout: 5e3
			}).catch(() => void 0).finally(() => reject(signal.reason ?? /* @__PURE__ */ new Error("同步已取消。")));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		child.once("error", (cause) => {
			signal.removeEventListener("abort", onAbort);
			unregisterCollectSpace(registryPath, spaceName);
			const code = cause.code;
			reject(code === "ENOENT" ? /* @__PURE__ */ new Error("ego-browser not found; install Ego Lite") : cause);
		});
		child.once("close", (code) => {
			signal.removeEventListener("abort", onAbort);
			if (aborting) return;
			if (signal.aborted) {
				reject(signal.reason ?? /* @__PURE__ */ new Error("同步已取消。"));
				return;
			}
			const raw = `${decodeOutput(stdout)}\n${decodeOutput(stderr)}`;
			if (code !== 0 && raw.trim() === "") {
				reject(/* @__PURE__ */ new Error(`ego-browser exited ${code}`));
				return;
			}
			try {
				const result = parseCollectOutput(raw);
				if (options.keepSpace === true || result.spaceClosed !== false) unregisterCollectSpace(registryPath, spaceName);
				resolve(result);
			} catch (cause) {
				const detail = raw.trim() === "" ? "" : `: ${raw.trim().slice(-500)}`;
				reject(new Error((cause instanceof Error ? cause.message : String(cause)) + detail));
			}
		});
	});
}
//#endregion
//#region src/production/transcription.ts
const VOLCANO_ASR_ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const VOLCANO_ASR_RESOURCE = "volc.bigasr.auc_turbo";
var AsrError = class extends Error {
	unknownOutcome;
	constructor(message, unknownOutcome = false) {
		super(message);
		this.unknownOutcome = unknownOutcome;
	}
};
function normalizeCues(value, durationMs = Number.POSITIVE_INFINITY) {
	if (!Array.isArray(value) || !value.length) throw new AsrError("识别结果缺少时间轴，请保留原始结果后核对。");
	let previous = -1;
	return value.map((raw) => {
		if (!raw || typeof raw !== "object") throw new AsrError("识别时间轴格式无效。");
		const cue = raw;
		if (typeof cue.start_time !== "number" || typeof cue.end_time !== "number") throw new AsrError("识别时间轴格式无效。");
		const start = cue.start_time, end = cue.end_time, text = typeof cue.text === "string" ? cue.text.trim() : "";
		if (![start, end].every(Number.isFinite) || start < 0 || end <= start || start < previous || end > durationMs + 2e3 || !text) throw new AsrError("识别时间轴无效，未生成字幕。");
		previous = start;
		return {
			start,
			end,
			text
		};
	});
}
function timestamp(ms) {
	const n = Math.round(ms);
	return `${String(Math.floor(n / 36e5)).padStart(2, "0")}:${String(Math.floor(n / 6e4) % 60).padStart(2, "0")}:${String(Math.floor(n / 1e3) % 60).padStart(2, "0")},${String(n % 1e3).padStart(3, "0")}`;
}
function toSrt(cues) {
	return cues.map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join("\n");
}
function parseSrt(text) {
	const value = text.replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
	const parse = (time) => {
		const parts = time.replace(",", ".").split(":").map(Number);
		if (parts[1] >= 60 || parts[2] >= 60) throw new AsrError("字幕时间格式无效。");
		return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1e3;
	};
	return normalizeCues(value.split(/\n\s*\n/).map((block) => {
		const lines = block.split("\n"), i = lines.findIndex((line) => line.includes("-->"));
		const match = lines[i]?.match(/^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})/);
		if (!match) throw new AsrError("字幕格式无效，请选择带时间轴的 SRT 或 ASS 文件。");
		return {
			start_time: parse(match[1]),
			end_time: parse(match[2]),
			text: lines.slice(i + 1).join("\n").trim()
		};
	}));
}
async function videoDuration(video, signal, requireAudio = true) {
	const value = JSON.parse(await mediaCommand("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration:stream=codec_type",
		"-of",
		"json",
		video
	], signal));
	const duration = Number(value.format?.duration);
	if (requireAudio && !value.streams?.some((stream) => stream.codec_type === "audio")) throw new AsrError("当前视频没有音轨，无法转写。");
	if (!Number.isFinite(duration) || duration <= 0) throw new AsrError("无法读取视频时长。");
	return duration;
}
async function transcribe(input) {
	const { signal, dir, key } = input, duration = await videoDuration(input.video, signal);
	if (duration > 7200) throw new AsrError("首版支持两小时以内的视频转写，请先准备较短的视频或导入字幕。");
	const audio = join(dir, "audio.mp3");
	await mediaCommand("ffmpeg", [
		"-v",
		"error",
		"-nostdin",
		"-i",
		input.video,
		"-vn",
		"-ac",
		"1",
		"-ar",
		"16000",
		"-c:a",
		"libmp3lame",
		"-b:a",
		"32k",
		audio
	], signal);
	const info = await stat(audio);
	if (!info.size || info.size > 104857600) throw new AsrError("提取的音频为空或超过 100 MB，未提交识别。");
	sameMediaIdentityError(input.identity, await mediaIdentity(input.video, signal));
	signal.throwIfAborted();
	let response;
	try {
		response = await (input.fetcher ?? fetch)(VOLCANO_ASR_ENDPOINT, {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(6e5)]),
			headers: {
				"Content-Type": "application/json",
				"X-Api-Key": key,
				"X-Api-Resource-Id": VOLCANO_ASR_RESOURCE,
				"X-Api-Request-Id": randomUUID(),
				"X-Api-Sequence": "-1"
			},
			body: JSON.stringify({
				user: { uid: "dsh-creator-workbench" },
				audio: {
					data: (await readFile(audio)).toString("base64"),
					format: "mp3",
					rate: 16e3,
					channel: 1
				},
				request: {
					model_name: "bigmodel",
					enable_itn: true,
					enable_punc: true,
					enable_ddc: false,
					show_utterances: true
				}
			})
		});
	} catch {
		throw new AsrError(signal.aborted ? "已停止等待识别；服务端结果未确认，未自动重发。" : "识别连接中断或超时，服务端结果未确认，请核对后再重试。", true);
	}
	const status = response.headers.get("x-api-status-code");
	if (!response.ok || status && status !== "20000000") throw new AsrError(response.status === 401 || response.status === 403 ? "语音 Key 或录音文件识别权限不可用，请检查火山语音配置。" : `火山识别未完成（HTTP ${response.status}${status ? `，状态 ${status}` : ""}），请检查权限、额度或音频内容。`, response.status >= 500);
	let raw;
	try {
		const text = await response.text();
		if (text.length > 33554432) throw new Error();
		raw = JSON.parse(text);
	} catch {
		throw new AsrError("服务返回的识别结果无法读取，请核对本次请求后再试。", true);
	}
	raw = JSON.parse(JSON.stringify(raw, (name, value) => /authorization|api[_-]?key|secret|token/i.test(name) ? "[已隐藏]" : typeof value === "string" && key ? value.split(key).join("[已隐藏]") : value));
	const rawFile = join(dir, "asr-result.json");
	await atomic(rawFile, raw);
	const cues = normalizeCues(raw.result?.utterances, duration * 1e3), srtFile = join(dir, "transcript.srt"), textFile = join(dir, "transcript.txt");
	const text = cues.map((cue) => cue.text).join("\n");
	if (!text.trim()) throw new AsrError("未识别到语音文字，请检查音轨。");
	await writeFile(srtFile, toSrt(cues), {
		encoding: "utf8",
		flag: "wx"
	});
	await writeFile(textFile, text, {
		encoding: "utf8",
		flag: "wx"
	});
	return {
		id: randomUUID(),
		video: input.identity,
		source: "volcano",
		rawFile: relative(input.folder, rawFile),
		srtFile: relative(input.folder, srtFile),
		textFile: relative(input.folder, textFile),
		createdAt: Date.now(),
		cues: cues.length
	};
}
async function importSubtitle(input) {
	const ext = extname(input.source).toLowerCase(), output = join(input.dir, "transcript.srt");
	const info = await stat(input.source);
	if (!info.isFile() || !info.size || info.size > 16777216 || ![".srt", ".ass"].includes(ext)) throw new Error("请选择有效的 SRT 或 ASS 字幕文件（不超过 16 MB）。");
	if (ext === ".ass") await mediaCommand("ffmpeg", [
		"-v",
		"error",
		"-nostdin",
		"-i",
		input.source,
		output
	], input.signal);
	else await writeFile(output, await readFile(input.source), { flag: "wx" });
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(output));
	} catch {
		throw new AsrError("字幕编码无法读取，请另存为 UTF-8 后导入。");
	}
	const duration = await videoDuration(input.video, input.signal, false), cues = parseSrt(text);
	normalizeCues(cues.map((cue) => ({
		start_time: cue.start,
		end_time: cue.end,
		text: cue.text
	})), duration * 1e3);
	await writeFile(output, toSrt(cues), "utf8");
	sameMediaIdentityError(input.identity, await mediaIdentity(input.video, input.signal));
	const textFile = join(input.dir, "transcript.txt");
	await writeFile(textFile, cues.map((cue) => cue.text).join("\n"), {
		encoding: "utf8",
		flag: "wx"
	});
	return {
		id: randomUUID(),
		video: input.identity,
		source: "imported",
		textFile: relative(input.folder, textFile),
		srtFile: relative(input.folder, output),
		createdAt: Date.now(),
		cues: cues.length
	};
}
//#endregion
//#region src/production/articleFrames.ts
const parameters = {
	algorithm: "cue-midpoint-v1",
	quality: 3,
	maxFrames: 8,
	format: "jpg"
};
async function recoverArticleFrames(input) {
	const root = await realpath(input.folder), dir = await realpath(input.dir), rel = relative(root, dir);
	if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../")) throw new Error("截图目录不属于本期内容。");
	const source = await mediaIdentity(input.video, input.signal);
	sameMediaIdentityError(input.identity, source);
	const signature = hashText(JSON.stringify({
		source,
		transcriptId: input.transcriptId,
		srt: input.srt,
		parameters,
		points: input.points
	})), token = signature.slice(0, 16);
	return locked(`article-frames:${dir}`, async () => {
		const manifest = join(dir, `frames-${token}.json`);
		const cache = await readJson$1(manifest, () => ({
			schemaVersion: 1,
			signature,
			frames: {}
		}));
		if (cache.schemaVersion !== 1 || cache.signature !== signature || !cache.frames) throw new Error("截图参数记录不一致，请保留原记录后重新准备。");
		const regular = async (file) => {
			const info = await lstat(file).catch((error) => {
				if (error.code === "ENOENT") return void 0;
				throw error;
			});
			if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("截图不能使用链接或其他类型的文件。");
			return Boolean(info);
		};
		const complete = async (file, hash) => {
			input.signal.throwIfAborted();
			if (!await regular(file)) return false;
			try {
				return (await inspectImage(file, input.signal)).mime === "image/jpeg" && (!hash || await hashFile(file, input.signal) === hash);
			} catch (error) {
				input.signal.throwIfAborted();
				return false;
			}
		};
		const frames = [];
		for (const point of input.points) {
			input.signal.throwIfAborted();
			const name = `frame-${point.index}-${token}.jpg`, final = join(dir, name);
			let entry = cache.frames[String(point.index)];
			if (entry && (entry.file !== name || entry.at !== point.at)) throw new Error("截图时间点记录不一致。");
			if (!entry) {
				if (await regular(final)) throw new Error("发现未关联的截图文件，请保留并核对后重试。");
				entry = {
					file: name,
					at: point.at
				};
				cache.frames[String(point.index)] = entry;
				await atomic(manifest, cache);
			}
			if (entry.pending && (basename(entry.pending) !== entry.pending || !entry.pending.startsWith(`.${name}.part-`) || !entry.pending.endsWith(".jpg"))) throw new Error("截图临时文件记录无效。");
			if (!await complete(final, entry.sha256)) {
				if (await regular(final)) await rename(final, join(dir, `${name}.invalid-${randomUUID()}`));
				if (entry.pending) {
					const partial = join(dir, entry.pending);
					if (!await complete(partial)) {
						if (await regular(partial)) await unlink(partial);
						delete entry.pending;
						await atomic(manifest, cache);
					}
				}
				if (!entry.pending) {
					entry.pending = `.${name}.part-${randomUUID()}.jpg`;
					await atomic(manifest, cache);
					await mediaCommand("ffmpeg", [
						"-v",
						"error",
						"-nostdin",
						"-ss",
						String(point.at),
						"-i",
						input.video,
						"-frames:v",
						"1",
						"-q:v",
						String(parameters.quality),
						"-n",
						join(dir, entry.pending)
					], input.signal);
				}
				const partial = join(dir, entry.pending);
				if (!await complete(partial)) throw new Error("截图没有完整生成，请重试以继续本次任务。");
				input.signal.throwIfAborted();
				await copyFile(partial, final, constants.COPYFILE_EXCL);
				entry.sha256 = await hashFile(final, input.signal);
				delete entry.pending;
				await atomic(manifest, cache);
				await unlink(partial);
			} else {
				if (entry.pending) {
					const partial = join(dir, entry.pending);
					if (await regular(partial)) await unlink(partial);
					delete entry.pending;
				}
				entry.sha256 ??= await hashFile(final, input.signal);
				await atomic(manifest, cache);
			}
			frames.push({
				file: relative(root, final),
				at: point.at
			});
		}
		sameMediaIdentityError(source, await mediaIdentity(input.video, input.signal));
		return frames;
	});
}
//#endregion
//#region src/production/articles.ts
async function prepareArticleFrames(input) {
	const file = await inside(input.folder, input.transcript.srtFile), srt = await readFile(file, "utf8"), cues = parseSrt(srt);
	const count = Math.min(8, cues.length);
	const points = [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * (cues.length - 1) / Math.max(1, count - 1))))].map((index) => {
		const cue = cues[index];
		return {
			index,
			at: (cue.start + Math.min(1e3, cue.end - cue.start) / 2) / 1e3
		};
	});
	const frames = await recoverArticleFrames({
		folder: input.folder,
		dir: input.dir,
		video: input.video,
		identity: input.transcript.video,
		transcriptId: input.transcript.id,
		srt,
		points,
		signal: input.signal
	});
	if (srt !== await readFile(file, "utf8")) throw new Error("字幕在截图期间发生变化，请重新准备。");
	return {
		transcript: await readFile(await inside(input.folder, input.transcript.textFile), "utf8"),
		frames,
		skill: await resource("vendor", "wewrite", "SKILL.md")
	};
}
async function saveArticle(input) {
	const markdown = input.markdown.trim();
	if (!/^#\s+\S/m.test(markdown) || markdown.length < 60 || markdown.length > 3e5) throw new Error("请提供包含一级标题和正文的文章。");
	for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
		const target = match[1].split(/\s+["']/)[0];
		if (/^(?:https?:|data:|file:|\/\/)/i.test(target)) throw new Error("文章配图必须使用本项目已登记图片的相对路径。");
		const file = await inside(input.folder, join(relative(input.folder, input.dir), target));
		const relativeFile = relative(input.folder, file);
		if (!input.frames.includes(relativeFile)) throw new Error("文章配图不属于本次视频截图或已登记材料，请重新核对。");
	}
	const file = join(input.dir, "article.md");
	await writeFile(file, `${markdown}\n`, {
		encoding: "utf8",
		flag: "wx"
	});
	return {
		id: randomUUID(),
		...input.video ? { video: input.video } : {},
		...input.transcriptId ? { transcriptId: input.transcriptId } : {},
		...input.source ? { source: input.source } : {},
		...input.imageIds ? { imageIds: input.imageIds } : {},
		title: markdown.match(/^#\s+(.+)/m)?.[1] ?? "文章",
		file: relative(input.folder, file),
		createdAt: Date.now(),
		frameFiles: input.frames
	};
}
//#endregion
//#region src/production/uploadAdmission.ts
async function uploadKey(folder, video, account, fields, covers, signal) {
	const assets = [];
	if (fields.useCovers) for (const ratio of [
		"3x4",
		"4x3",
		"16x9"
	]) {
		const source = covers[ratio];
		if (!source) continue;
		const file = await inside(folder, source);
		assets.push({
			ratio,
			file: relative(folder, file),
			sha256: await hashFile(file, signal)
		});
	}
	return hashText(JSON.stringify({
		video: {
			name: video.name,
			size: video.size,
			sha256: video.sha256
		},
		account: account.id,
		platform: account.platform,
		title: fields.title,
		description: fields.description,
		tags: fields.tags,
		category: fields.category ?? "",
		useCovers: fields.useCovers,
		originalRightsConfirmed: fields.originalRightsConfirmed,
		assets
	}));
}
/** Admission and reservation share the persisted state lock, for UI and Agent callers alike. */
async function admitUpload(scope, video, account, key, newUploadAfter, assertAvailable, reserve) {
	return updateState(scope.folderPath, async (state) => {
		await assertAvailable?.();
		const candidates = state.tasks.filter((task) => task.kind === "upload" && task.platform === account.platform && task.account?.id === account.id && task.video && sameMedia(task.video, video));
		const previous = newUploadAfter ? candidates.at(-1) : [...candidates].reverse().find((task) => task.uploadKey === key) ?? candidates.at(-1);
		if (newUploadAfter && !candidates.some((task) => task.id === newUploadAfter)) throw new Error("原任务不属于当前视频、平台和账号，请重新核对。");
		if (previous && (!newUploadAfter || previous.id !== newUploadAfter || isActiveTask(previous))) {
			const same = previous.uploadKey === key;
			return {
				task: structuredClone(previous),
				fresh: false,
				notice: {
					taskId: previous.id,
					canCreateNew: !isActiveTask(previous),
					message: same ? "已有本次上传任务，请检查草稿或继续原任务。" : "此视频已有上传记录，发布材料不同或旧输入尚未核验。请先检查原草稿；需要另一份时再明确另建。"
				}
			};
		}
		const task = {
			id: randomUUID(),
			kind: "upload",
			contentId: scope.id,
			folderPath: scope.folderPath,
			status: "queued",
			platform: account.platform,
			video,
			account,
			uploadKey: key,
			originalRightsConfirmed: true,
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
		state.tasks.push(task);
		reserve?.(task.id);
		return {
			task: structuredClone(task),
			fresh: true
		};
	});
}
//#endregion
//#region src/production/metrics.ts
function refreshMetric(previous, posts, error) {
	const checkedAt = Date.now();
	if (error) return {
		...previous,
		checkedAt,
		state: "error",
		error
	};
	const matches = posts.filter((post) => post.remoteId === previous.remoteId);
	if (matches.length !== 1) return {
		...previous,
		checkedAt,
		state: "not-found",
		error: matches.length > 1 ? "存在多个匹配结果，请核对平台链接。" : "当前账号中未找到这条内容，请核对链接或发表状态。"
	};
	const post = matches[0];
	const result = {
		platform: previous.platform,
		accountId: previous.accountId,
		remoteId: previous.remoteId,
		checkedAt,
		syncedAt: checkedAt,
		state: "ok",
		...previous.publicationId ? { publicationId: previous.publicationId } : {},
		...previous.recordId ? { recordId: previous.recordId } : {},
		...post.url ?? previous.url ? { url: post.url ?? previous.url } : {}
	};
	for (const key of [
		"views",
		"likes",
		"comments"
	]) {
		const value = post[key];
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) result[key] = value;
	}
	return result;
}
function validatePublication(platform, remoteId, url) {
	if (!remoteId.trim() || remoteId.length > 200 || /[\s\x00-\x1f]/.test(remoteId)) throw new Error("请填写有效的平台内容标识。");
	if (url) {
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error("请填写完整的内容链接。");
		}
		const domains = {
			xiaohongshu: ["xiaohongshu.com", "xhslink.com"],
			douyin: ["douyin.com"],
			bilibili: ["bilibili.com", "b23.tv"],
			wechat: ["channels.weixin.qq.com"],
			"official-account": ["mp.weixin.qq.com"]
		}[platform];
		if (parsed.protocol !== "https:" || !domains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) throw new Error("内容链接与所选平台不一致。");
	}
}
async function metricsSnapshot(dataDir, folder, enabled, platform, publicationId, selection = {}) {
	const settings = await readSettings(dataDir), state = await readState(folder);
	if (platform && platform !== "official-account" && !enabled.includes(platform)) throw new Error("此平台尚未启用。");
	const publication = publicationId ? state.publications?.find((p) => p.id === publicationId && !p.hidden) : void 0;
	if (publicationId && !publication) throw new Error("发布内容不存在。");
	if (publication && platform && publication.platform !== platform) throw new Error("作品与本次平台不符。");
	if (selection.recordId && !state.records?.some((r) => r.id === selection.recordId && (!publicationId || r.publicationId === publicationId) && (!platform || r.platform === platform))) throw new Error("作品记录不属于本次材料或平台。");
	const targets = (platform ? [platform] : publication ? [publication.platform] : enabled.filter((p) => Boolean(settings.accounts[p]))).flatMap((p) => {
		const accountId = p === "official-account" ? settings.wechat.appid : settings.accounts[p]?.id;
		if (!accountId) throw new Error("请先连接对应的平台账号。");
		if (selection.expectedAccountId && selection.expectedAccountId !== accountId) throw new Error("平台账号已变化，请重新选择当前作品。");
		const rows = state.metrics.filter((m) => m.platform === p && m.accountId === accountId && (!publicationId || m.publicationId === publicationId) && (!selection.recordId || m.recordId === selection.recordId) && (!selection.remoteId || m.remoteId === selection.remoteId));
		if ((selection.recordId || selection.remoteId) && !rows.length) throw new Error("此作品属于其他账号或尚未关联数据。");
		return rows.length ? rows.map((row) => ({
			platform: p,
			accountId,
			remoteId: row.remoteId,
			...row.url ? { url: row.url } : {},
			...row.publicationId ? { publicationId: row.publicationId } : {},
			...row.recordId ? { recordId: row.recordId } : {}
		})) : [{
			platform: p,
			accountId,
			...publicationId ? { publicationId } : {}
		}];
	});
	if (!targets.length) throw new Error("请先连接发布平台账号。");
	targets.sort((a, b) => `${a.platform}:${a.publicationId ?? ""}:${a.remoteId ?? ""}`.localeCompare(`${b.platform}:${b.publicationId ?? ""}:${b.remoteId ?? ""}`));
	return {
		metricsTargets: targets,
		metricsKey: hashText(JSON.stringify(targets))
	};
}
/** Deadline includes login checks and scraping. Every write rechecks identity and cancellation. */
async function runMetricsTask(input) {
	const { folder, task, signal } = input, progress = (task.metricsTargets ?? []).map((row) => ({
		...row,
		state: "queued"
	}));
	const patch = async () => {
		await updateState(folder, (state) => {
			const row = state.tasks.find((t) => t.id === task.id);
			row.metricsProgress = structuredClone(progress);
			row.updatedAt = Date.now();
		});
		input.changed();
	};
	const checkAccount = async (target) => {
		const settings = await readSettings(input.dataDir);
		if ((target.platform === "official-account" ? settings.wechat.appid : settings.accounts[target.platform]?.id) !== target.accountId) throw new Error("平台账号已变化，本次结果未写回。请用当前账号重新同步。");
	};
	let stopped = false;
	const platformReads = /* @__PURE__ */ new Map(), platformStarts = /* @__PURE__ */ new Map();
	for (const target of progress) {
		if (signal.aborted || stopped) {
			target.state = "cancelled";
			target.endedAt = Date.now();
			continue;
		}
		target.state = "running";
		target.startedAt = Date.now();
		await patch();
		const deadline = new AbortController(), current = AbortSignal.any([signal, deadline.signal]);
		const platformKey = `${target.platform}:${target.accountId}`, started = platformStarts.get(platformKey) ?? Date.now();
		platformStarts.set(platformKey, started);
		const timer = setTimeout(() => deadline.abort(/* @__PURE__ */ new Error("同步超过 180 秒，已停止本次平台操作。")), Math.max(1, (input.timeoutMs ?? 18e4) - (Date.now() - started)));
		try {
			await checkAccount(target);
			let reading = platformReads.get(platformKey);
			if (!reading) {
				reading = input.collect(target, current);
				platformReads.set(platformKey, reading);
			}
			const posts = await Promise.race([reading, new Promise((_, reject) => {
				if (current.aborted) reject(current.reason);
				else current.addEventListener("abort", () => reject(current.reason), { once: true });
			})]);
			current.throwIfAborted();
			await locked(`settings:${input.dataDir}`, async () => {
				await checkAccount(target);
				current.throwIfAborted();
				let published, matchError;
				await updateState(folder, (state) => {
					const owner = state.tasks.find((t) => t.id === task.id);
					if (!owner || !["running", "queued"].includes(owner.status)) throw new Error("任务已停止，结果未写回。");
					if (target.remoteId) {
						const index = state.metrics.findIndex((m) => m.platform === target.platform && m.accountId === target.accountId && m.remoteId === target.remoteId && m.publicationId === target.publicationId && m.recordId === target.recordId);
						if (index < 0) throw new Error("作品关联已变化，本次结果未写回。");
						const next = refreshMetric(state.metrics[index], posts);
						state.metrics[index] = next;
						if (next.state !== "ok") matchError = next.error;
						else {
							published = next;
							for (const record of state.records ?? []) if (record.platform === next.platform && record.accountId === next.accountId && (next.recordId ? record.id === next.recordId : next.publicationId && record.publicationId === next.publicationId && record.remoteId === next.remoteId)) {
								record.state = "published";
								record.remoteId = next.remoteId;
								if (next.url) record.url = next.url;
								record.updatedAt = Date.now();
							}
						}
					} else {
						const candidates = posts.filter((post) => post.remoteId).sort((a, b) => titleScore(input.detail.title, b.title) - titleScore(input.detail.title, a.title)).slice(0, 10).map((post) => ({
							platform: target.platform,
							accountId: target.accountId,
							remoteId: post.remoteId,
							title: post.title,
							...post.url ? { url: post.url } : {}
						}));
						state.candidates = [...(state.candidates ?? []).filter((row) => row.platform !== target.platform || row.accountId !== target.accountId), ...candidates];
					}
				});
				if (matchError) throw new Error(matchError);
				if (published) {
					current.throwIfAborted();
					await input.published?.(published);
				}
			});
			target.state = "completed";
		} catch (error) {
			target.error = safeError(error);
			target.state = signal.aborted ? "cancelled" : browserControlStopped(error) ? "blocked" : "failed";
			if (target.state === "blocked" || deadline.signal.aborted) stopped = true;
			await updateState(folder, (state) => {
				const row = state.metrics.find((m) => m.platform === target.platform && m.accountId === target.accountId && m.remoteId === target.remoteId && m.publicationId === target.publicationId && m.recordId === target.recordId);
				if (row) {
					if (row.state !== "not-found") row.state = "error";
					row.error = target.error;
					row.checkedAt = Date.now();
				}
			});
		} finally {
			clearTimeout(timer);
			target.endedAt = Date.now();
			await patch();
		}
	}
	await updateState(folder, (state) => {
		const owner = state.tasks.find((t) => t.id === task.id);
		owner.metricsProgress = progress;
		owner.status = signal.aborted ? "cancelled" : progress.some((p) => p.state === "blocked") ? "blocked" : progress.some((p) => p.state === "failed") ? "failed" : "completed";
		owner.step = progress.some((p) => !p.remoteId && p.state === "completed") ? "待关联作品：选择准确作品后即会读取数据。" : "同步已结束";
		const errors = progress.filter((p) => p.error).map((p) => `${p.platform}：${p.error}`);
		if (errors.length) owner.error = errors.join("；");
		else delete owner.error;
		owner.updatedAt = Date.now();
	});
	input.changed();
}
//#endregion
//#region src/production/publicationAssociation.ts
/** The initiating account remains fixed through the entire local association write. */
async function associatePublication(dataDir, folder, request, assertAvailable) {
	validatePublication(request.platform, request.remoteId, request.url);
	if (!request.expectedAccountId) throw new Error("请重新打开作品关联，确认当前平台账号后再保存。");
	return locked(`settings:${dataDir}`, async () => {
		const settings = await readSettings(dataDir);
		const accountId = request.platform === "official-account" ? settings.wechat.appid : settings.accounts[request.platform]?.id;
		if (!accountId) throw new Error("请先连接对应账号。");
		if (accountId !== request.expectedAccountId || request.candidateAccountId && request.candidateAccountId !== accountId) throw new Error("平台账号已变化，原作品未关联。请用当前账号重新选择。");
		return updateState(folder, async (state) => {
			await assertAvailable();
			if (state.tasks.some((t) => t.kind === "metrics" && isActiveTask(t))) throw new Error("正在同步，请等待或取消原任务后再更换作品关联。");
			const remoteId = request.remoteId.trim();
			if (request.candidateAccountId && !state.candidates?.some((c) => c.platform === request.platform && c.accountId === accountId && c.remoteId === remoteId)) throw new Error("候选作品已变化，请重新选择或手工填写作品标识。");
			const publication = request.publicationId ? state.publications?.find((p) => p.id === request.publicationId && !p.hidden) : void 0;
			if (request.publicationId && (!publication || publication.platform !== request.platform)) throw new Error("作品关联与发布内容的平台不符。");
			let recordId = request.recordId;
			if (recordId && !state.records?.some((r) => r.id === recordId && r.publicationId === request.publicationId && r.platform === request.platform && r.accountId === accountId)) throw new Error("作品记录不属于本次发布内容或账号。");
			if (publication && !recordId) {
				const records = state.records ??= [];
				const old = records.find((r) => r.publicationId === publication.id && r.platform === request.platform && r.accountId === accountId && r.remoteId === remoteId);
				recordId = old?.id ?? randomUUID();
				if (!old) records.push({
					id: recordId,
					publicationId: publication.id,
					revision: publication.revision,
					platform: publication.platform,
					type: publication.type,
					accountId,
					remoteId,
					...request.url ? { url: request.url } : {},
					state: "linked",
					updatedAt: Date.now()
				});
			}
			if (request.recordId) {
				const record = state.records.find((r) => r.id === request.recordId);
				record.remoteId = remoteId;
				record.state = "linked";
				record.updatedAt = Date.now();
				if (request.url) record.url = request.url;
				else delete record.url;
			}
			const old = state.metrics.find((m) => m.platform === request.platform && m.accountId === accountId && (recordId ? m.recordId === recordId : request.publicationId ? m.publicationId === request.publicationId : !m.publicationId));
			if (old && old.remoteId !== remoteId) {
				old.remoteId = remoteId;
				old.state = "unassociated";
				delete old.syncedAt;
				delete old.views;
				delete old.likes;
				delete old.comments;
				delete old.shares;
			}
			if (old) {
				if (request.url) old.url = request.url;
				else delete old.url;
			} else state.metrics.push({
				...request.publicationId ? { publicationId: request.publicationId } : {},
				...recordId ? { recordId } : {},
				platform: request.platform,
				accountId,
				remoteId,
				...request.url ? { url: request.url } : {},
				checkedAt: Date.now(),
				state: "unassociated"
			});
			return recordId;
		});
	});
}
//#endregion
//#region src/production/workflow.ts
var ProductionWorkflow = class {
	host;
	active = /* @__PURE__ */ new Map();
	pending = /* @__PURE__ */ new Set();
	disposed = false;
	constructor(host) {
		this.host = host;
	}
	dispose() {
		this.disposed = true;
		for (const task of this.active.values()) task.controller.abort();
		pauseBrowser(this.host.dataDir);
	}
	async readArticleVersion(scope) {
		const detail = await this.host.resolve(scope);
		return articleSource(detail.folderPath, scope.articleId, detail.articlePath);
	}
	async editArticleVersion(request, signal) {
		const detail = await this.host.resolve(request), settings = await readSettings(this.host.dataDir);
		const result = await saveArticleRevision(this.host.dataDir, detail.folderPath, request, settings.wechat.theme, signal, () => this.host.resolve(request), detail.articlePath);
		this.host.changed();
		return result;
	}
	async settings() {
		const settings = await readSettings(this.host.dataDir), ref = wechatCredential(settings.wechat.appid);
		return {
			...settings,
			runtime: await runtimeStatus(this.host.dataDir),
			asrConfigured: await this.host.hasKey(ASR_CREDENTIAL),
			wechatConfigured: Boolean(settings.wechat.appid) && await this.host.hasKey(ref),
			wechatCredential: ref
		};
	}
	async settingsAction(request, signal) {
		const dataDir = this.host.dataDir;
		signal.throwIfAborted();
		if (request.action === "prepare-runtime") await prepareRuntime(dataDir, signal);
		else if (request.action === "pause-browser" || request.action === "resume-browser") {
			const paused = request.action === "pause-browser";
			if (paused) pauseBrowser(dataDir);
			await updateSettings(dataDir, (settings) => {
				settings.browserPaused = paused;
			});
		} else if (request.action === "open-login" || request.action === "check-account" || request.action === "connect-account") await withBrowser(dataDir, signal, async (current) => {
			const settings = await readSettings(dataDir);
			const resume = request.action === "check-account" ? settings.observations[request.platform]?.spaceId : void 0;
			const observed = await probeAccount(request.platform, current, request.action === "open-login", resume);
			await updateSettings(dataDir, (settings) => {
				settings.observations[request.platform] = observed;
				if (request.action !== "connect-account") return;
				if (observed.state !== "connected" || !observed.id || !observed.name || request.expectedId !== observed.id) throw new Error("账号已变化或尚未核验，请重新检查账号。");
				const previous = settings.accounts[request.platform];
				if (previous && previous.id !== observed.id && !request.replace) throw new Error("请明确确认更换账号；原账号历史会保留。");
				if (previous && !settings.accountHistory.some((account) => account.platform === previous.platform && account.id === previous.id)) settings.accountHistory.push(previous);
				settings.accounts[request.platform] = {
					platform: request.platform,
					id: observed.id,
					name: observed.name,
					checkedAt: observed.checkedAt
				};
			});
		});
		else if (request.action === "save-wechat") {
			if (!/^wx[a-zA-Z0-9]{8,40}$/.test(request.appid) || !["claude-editorial", "professional-clean"].includes(request.theme)) throw new Error("请填写有效的公众号 AppID，并选择可用主题。");
			if (!await this.host.hasKey(wechatCredential(request.appid))) throw new Error("请先保存此公众号的 AppSecret。");
			await updateSettings(dataDir, (settings) => {
				if (settings.revision !== request.revision) throw new Error("设置已被更新，请重新加载后保存。");
				settings.wechat = {
					appid: request.appid,
					author: request.author.trim(),
					theme: request.theme
				};
			});
		} else if (request.action === "check-wechat") {
			const settings = await readSettings(dataDir), secret = await this.host.key(wechatCredential(settings.wechat.appid));
			if (!secret) throw new Error("请先配置公众号 AppID 和 AppSecret。");
			try {
				await wechatWorker(dataDir, {
					operation: "check",
					...settings.wechat,
					secret
				}, signal);
				await updateSettings(dataDir, (latest) => {
					if (latest.wechat.appid === settings.wechat.appid) {
						latest.wechat.checkedAt = Date.now();
						delete latest.wechat.error;
					}
				});
			} catch (error) {
				const message = safeError(error, [secret]);
				await updateSettings(dataDir, (latest) => {
					if (latest.wechat.appid === settings.wechat.appid) latest.wechat.error = message;
				});
				throw new Error(message);
			}
		} else if (request.action === "import-wechat") {
			const config = await wechatWorker(dataDir, {
				operation: "import-config",
				path: request.sourcePath
			}, signal);
			if (!/^wx[a-zA-Z0-9]{8,40}$/.test(config.appid) || !config.secret) throw new Error("所选文件缺少有效的公众号配置。");
			await this.host.setKey(wechatCredential(config.appid), config.secret);
			await updateSettings(dataDir, (settings) => {
				settings.wechat = {
					appid: config.appid,
					author: config.author,
					theme: "claude-editorial"
				};
			});
		}
		this.host.changed();
		return this.settings();
	}
	async reconcile(scope) {
		const detail = await this.host.resolve(scope);
		const existing = await readState(detail.folderPath);
		for (const task of existing.tasks) if (task.kind === "images" && ["running", "unconfirmed"].includes(task.status) && !this.active.has(task.id) && !this.pending.has(task.id)) await reconcileImageItems(detail.folderPath, task);
		if (!existing.tasks.some((task) => ["running", "queued"].includes(task.status) && !this.active.has(task.id) && !this.pending.has(task.id))) return readState(detail.folderPath);
		return await updateState(detail.folderPath, async (state) => {
			await this.host.resolve({
				id: detail.id,
				folderPath: detail.folderPath
			});
			for (const task of state.tasks) if (["running", "queued"].includes(task.status) && !this.active.has(task.id) && !this.pending.has(task.id)) {
				task.status = "unconfirmed";
				task.error = "任务运行时中断，请先核对已有成果，再继续处理。";
				task.updatedAt = Date.now();
			}
			return structuredClone(state);
		});
	}
	async state(scope) {
		return hydrateCreations(scope.folderPath, await this.reconcile(scope));
	}
	async newTask(detail, kind, extra = {}) {
		let reserved;
		return updateState(detail.folderPath, async (state) => {
			await this.host.resolve({
				id: detail.id,
				folderPath: detail.folderPath
			});
			if (this.disposed) throw new Error("工作台服务已重新加载，请重试。");
			const old = state.tasks.find((task) => task.kind === kind && isActiveTask(task) && (!extra.platform || task.platform === extra.platform));
			if (old) {
				if (kind === "metrics" && old.metricsKey !== extra.metricsKey) throw new Error(`同步任务 ${old.id} 正在处理其他平台、账号或作品，请先等待或取消原任务。`);
				return {
					task: structuredClone(old),
					fresh: false
				};
			}
			const task = {
				id: randomUUID(),
				kind,
				contentId: detail.id,
				folderPath: detail.folderPath,
				status: "queued",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				...extra
			};
			state.tasks.push(task);
			if (task.status === "queued") {
				reserved = task.id;
				this.pending.add(task.id);
			}
			return {
				task,
				fresh: true
			};
		}).catch((error) => {
			if (reserved) this.pending.delete(reserved);
			throw error;
		});
	}
	async patch(folder, id, values) {
		await updateState(folder, (state) => {
			const task = state.tasks.find((row) => row.id === id);
			if (!task) throw new Error("任务记录不存在。");
			Object.assign(task, values, { updatedAt: Date.now() });
		});
		this.host.changed();
	}
	async launch(folder, task, run) {
		return locked(`launch:${folder}:${task.id}`, async () => {
			if (this.active.has(task.id)) return;
			const controller = new AbortController();
			const entry = {
				folder,
				controller,
				executing: false
			};
			try {
				await this.host.resolve({
					id: task.contentId,
					folderPath: folder
				});
				const jobs = this.host.jobs();
				const admitted = await updateState(folder, (state) => {
					const stored = state.tasks.find((row) => row.id === task.id);
					if (this.disposed || !stored || [
						"cancelled",
						"completed",
						"running"
					].includes(stored.status) || (stored.executionRevision ?? 0) !== (task.executionRevision ?? 0)) return false;
					if (!jobs) {
						stored.status = "blocked";
						stored.error = "后台任务服务暂不可用，请稍后重试。";
						return false;
					}
					stored.executionRevision = (stored.executionRevision ?? 0) + 1;
					stored.status = "running";
					stored.updatedAt = Date.now();
					delete stored.error;
					this.active.set(task.id, entry);
					return true;
				});
				this.pending.delete(task.id);
				if (!admitted || !jobs) return;
				const jobId = jobs.start({
					kind: "creator-media",
					label: `${{
						upload: "上传视频",
						asr: "视频转文字",
						article: "准备文章",
						wechat: "公众号草稿",
						metrics: "同步数据",
						images: "制作图片"
					}[task.kind]}：${basename(folder)}`,
					...task.sessionId ? { owner: task.sessionId } : {},
					run: () => ({
						cancel: () => controller.abort(),
						done: (async () => {
							try {
								controller.signal.throwIfAborted();
								entry.executing = true;
								await run(controller.signal);
								const actual = (await readState(folder)).tasks.find((row) => row.id === task.id);
								return {
									status: actual?.status === "cancelled" ? "killed" : actual && ["ready", "completed"].includes(actual.status) ? "completed" : "failed",
									result: `任务 ${task.id}：${actual?.status ?? "结果待核对"}。${actual?.error ?? "请查看工作台实际结果。"}`
								};
							} catch (error) {
								const unknown = error instanceof AsrError || error instanceof WechatError ? error.unknownOutcome : entry.executing && controller.signal.aborted && ["upload", "wechat"].includes(task.kind);
								await this.patch(folder, task.id, {
									status: unknown ? "unconfirmed" : controller.signal.aborted ? "cancelled" : browserControlStopped(error) ? "blocked" : "failed",
									error: safeError(error)
								});
								return {
									status: controller.signal.aborted ? "killed" : "failed",
									result: safeError(error)
								};
							} finally {
								this.active.delete(task.id);
								this.host.changed();
							}
						})()
					})
				});
				await this.patch(folder, task.id, { jobId });
			} catch (error) {
				this.active.delete(task.id);
				await updateState(folder, (state) => {
					const stored = state.tasks.find((row) => row.id === task.id);
					if (stored && ![
						"cancelled",
						"completed",
						"unconfirmed"
					].includes(stored.status)) {
						stored.status = "failed";
						stored.error = safeError(error);
						stored.updatedAt = Date.now();
					}
				});
				throw error;
			} finally {
				this.pending.delete(task.id);
				this.host.changed();
			}
		});
	}
	async selected(detail, signal) {
		if (!detail.selectedVideo || detail.videoSelection !== "selected") throw new Error("请先明确选择当前视频。");
		const path = await inside(detail.folderPath, detail.selectedVideo);
		return {
			path,
			identity: await mediaIdentity(path, signal)
		};
	}
	async action(request, signal) {
		const detail = await this.host.resolve(request), folder = detail.folderPath;
		signal.throwIfAborted();
		const creation = await creationAction(detail, request, signal, {
			dataDir: this.host.dataDir,
			key: this.host.key,
			changed: this.host.changed,
			assertAvailable: () => this.host.resolve(request),
			newTask: (kind, extra) => this.newTask(detail, kind, extra),
			launch: (task, work) => this.launch(folder, task, work)
		});
		if (creation) {
			if (request.action === "save-publication" && request.saveId && typeof creation === "object") {
				const raw = await readState(folder), { publicationSaves: _receipts, ...metadata } = raw;
				const saved = raw.publications?.find((p) => p.id === creation.savedPublication.id && p.revision === creation.savedPublication.revision);
				const body = saved ? await readFile(await inside(folder, saved.bodyFile), "utf8") : void 0;
				return {
					...metadata,
					...creation,
					...saved && body !== void 0 ? { publications: raw.publications.map((p) => p === saved ? {
						...p,
						body
					} : p) } : {}
				};
			}
			return {
				...await this.state(request),
				...typeof creation === "object" ? creation : {}
			};
		}
		const publicationHost = {
			dataDir: this.host.dataDir,
			platforms: this.host.platforms,
			key: this.host.key,
			resolve: this.host.resolve,
			changed: this.host.changed,
			reserve: (id) => this.pending.add(id)
		};
		if (request.action === "upload-publication") {
			const { task, fresh, notice } = await preparePublicationUpload(detail, request.publicationId, request.expectedRevision, request.originalRightsConfirmed, publicationHost, signal, request.newUploadAfter, request.expectedAccountId);
			if (fresh) await this.launch(folder, task, (current) => executePublicationUpload(folder, task, "create", current, publicationHost));
			return {
				...await this.state(request),
				...notice ? { uploadNotice: notice } : {}
			};
		}
		if (request.action === "upload" && !(await this.host.platforms()).includes(request.input.platform)) throw new Error("此平台尚未启用，请先在常规设置中选择显示的平台。");
		if (request.action === "cancel") await updateState(folder, (state) => {
			const task = state.tasks.find((row) => row.id === request.taskId);
			if (!task) throw new Error("任务不存在。");
			if (!isActiveTask(task)) return;
			const active = this.active.get(task.id);
			task.status = active?.executing && ["upload", "wechat"].includes(task.kind) ? "unconfirmed" : "cancelled";
			task.error = "取消请求已提交，完整成果保留。";
			task.updatedAt = Date.now();
			this.pending.delete(task.id);
			active?.controller.abort(/* @__PURE__ */ new Error("用户取消任务。"));
		});
		else if (request.action === "upload") {
			const account = (await readSettings(this.host.dataDir)).accounts[request.input.platform];
			if (!account) throw new Error("请先在发布设置中检查并连接此平台账号。");
			if (!request.input.originalRightsConfirmed) throw new Error("请先确认本次视频可按原创上传。");
			const selected = await this.selected(detail, signal), fields = structuredClone(request.input), covers = structuredClone(detail.covers);
			const key = await uploadKey(folder, selected.identity, account, fields, covers, signal);
			let reserved;
			const { task, fresh, notice } = await admitUpload(detail, selected.identity, account, key, request.newUploadAfter, () => this.host.resolve(request), (id) => {
				reserved = id;
				this.pending.add(id);
			}).catch((error) => {
				if (reserved) this.pending.delete(reserved);
				throw error;
			});
			if (!fresh) return {
				...await this.state(request),
				...notice ? { uploadNotice: notice } : {}
			};
			if (fresh) await this.launch(folder, task, async (current) => {
				const dir = await owned(folder, task.id), prepared = await makeUploadPackage({
					dataDir: this.host.dataDir,
					folder,
					dir,
					video: selected.path,
					covers,
					fields,
					signal: current
				});
				if (key !== await uploadKey(folder, selected.identity, account, fields, covers, current)) throw new Error("封面或发布材料已变化，请核对原任务后再继续。");
				await this.patch(folder, task.id, { packageFile: prepared.file });
				task.packageFile = prepared.file;
				await this.executeUpload(folder, task, "create", current);
			});
		} else if (request.action === "resume-upload" || request.action === "inspect-upload") {
			const task = (await readState(folder)).tasks.find((row) => row.id === request.taskId && row.kind === "upload");
			if (task?.publicationId) {
				if (task.status === "cancelled") await updateState(folder, (state) => {
					const stored = state.tasks.find((t) => t.id === task.id);
					if (stored.status === "cancelled") stored.status = "blocked";
				});
				if (!this.active.has(task.id)) await this.launch(folder, task, (current) => executePublicationUpload(folder, task, request.action === "inspect-upload" ? "inspect" : "resume", current, publicationHost));
				return this.state(request);
			}
			if (!task?.video || !task.account) throw new Error("上传任务不存在或缺少原始身份。");
			if (this.active.has(task.id)) return this.state(request);
			sameMediaIdentityError(task.video, await mediaIdentity(await inside(folder, task.video.name), signal));
			await this.launch(folder, task, (current) => this.executeUpload(folder, task, request.action === "inspect-upload" ? "inspect" : "resume", current));
		} else if (request.action === "transcribe" || request.action === "import-subtitle") {
			const selected = await this.selected(detail, signal);
			const state = await readState(folder), previous = [...state.tasks].reverse().find((task) => task.kind === "asr" && task.video && sameMedia(task.video, selected.identity));
			if (request.action === "transcribe" && previous?.status === "unconfirmed" && !request.acknowledgeUnknown) throw new Error("上次识别结果未确认；请先核对，再明确重试，可能产生新的识别费用。");
			if (request.action === "transcribe" && state.transcripts.some((entry) => sameMedia(entry.video, selected.identity))) return state;
			const key = request.action === "transcribe" ? await this.host.key(ASR_CREDENTIAL) : void 0;
			if (request.action === "transcribe" && !key) throw new Error("请先在设置中填写火山语音 API Key。");
			const { task, fresh } = await this.newTask(detail, "asr", { video: selected.identity });
			if (fresh) await this.launch(folder, task, async (current) => {
				const dir = await owned(folder, task.id);
				let version;
				try {
					version = request.action === "import-subtitle" ? await importSubtitle({
						folder,
						video: selected.path,
						identity: selected.identity,
						dir,
						source: request.sourcePath,
						signal: current
					}) : await transcribe({
						folder,
						video: selected.path,
						identity: selected.identity,
						dir,
						key,
						signal: current
					});
				} catch (error) {
					if (error instanceof AsrError) throw new AsrError(safeError(error, [key ?? ""]), error.unknownOutcome);
					throw new Error(safeError(error, [key ?? ""]));
				}
				await updateState(folder, (latest) => {
					latest.transcripts.push(version);
				});
				await this.patch(folder, task.id, {
					status: "completed",
					transcriptId: version.id
				});
			});
		} else if (request.action === "prepare-article") {
			const selected = !request.source || request.source.kind === "video" ? await this.selected(detail, signal) : void 0;
			const source = request.source ?? {
				kind: "video",
				video: selected.identity
			};
			const { task } = await this.newTask(detail, "article", {
				...selected ? { video: selected.identity } : {},
				source,
				status: "waiting-agent",
				...request.sessionId ? { sessionId: request.sessionId } : {}
			});
			if (task.video && selected && !sameMedia(task.video, selected.identity) || task.source && JSON.stringify(task.source) !== JSON.stringify(source)) throw new Error("已有文章请求使用另一份材料，请先处理或取消原请求。");
		} else if (request.action === "save-article") await this.commitArticle(request, signal);
		else if (request.action === "wechat-preview" || request.action === "wechat-draft") await this.wechatAction(detail, request, signal);
		else if (request.action === "associate-publication") {
			const recordId = await associatePublication(this.host.dataDir, folder, request, () => this.host.resolve(request));
			return this.action({
				...request,
				action: "refresh-metrics",
				platform: request.platform,
				...recordId ? { recordId } : {},
				...request.publicationId ? { publicationId: request.publicationId } : {}
			}, signal);
		} else if (request.action === "refresh-metrics") {
			const snapshot = await metricsSnapshot(this.host.dataDir, folder, await this.host.platforms(), request.platform, request.publicationId, {
				...request.recordId ? { recordId: request.recordId } : {},
				...request.remoteId ? { remoteId: request.remoteId } : {},
				...request.expectedAccountId ? { expectedAccountId: request.expectedAccountId } : {}
			});
			const { task, fresh } = await this.newTask(detail, "metrics", snapshot);
			if (fresh) await this.launch(folder, task, (current) => this.refreshMetrics(folder, task, request.platform, current));
		}
		this.host.changed();
		return this.state(request);
	}
	async executeUpload(folder, task, operation, signal) {
		const settings = await readSettings(this.host.dataDir), account = task.account;
		if (settings.accounts[account.platform]?.id !== account.id) throw new Error("本任务属于原账号，请切回后继续。");
		if (!(await this.host.platforms()).includes(account.platform)) throw new Error("本任务的平台已停用，请重新启用后继续。");
		const result = await withBrowser(this.host.dataDir, signal, async (current) => {
			try {
				const dir = await owned(folder, task.id), first = await runUpload({
					dataDir: this.host.dataDir,
					folder,
					dir,
					task,
					account,
					operation,
					signal: current
				});
				if (first.ready && operation !== "inspect") return runUpload({
					dataDir: this.host.dataDir,
					folder,
					dir,
					task,
					account,
					operation: "inspect",
					signal: current
				});
				return first;
			} finally {
				await releaseUploadBrowser(folder, task).catch(() => void 0);
			}
		});
		if (result.userControl) await updateSettings(this.host.dataDir, (latest) => {
			latest.browserPaused = true;
		});
		await updateState(folder, (state) => {
			const saved = state.tasks.find((row) => row.id === task.id);
			if (!saved) throw new Error("任务记录不存在。");
			saved.status = result.ready ? "ready" : "blocked";
			saved.receipt = result.receipt;
			saved.updatedAt = Date.now();
			if (result.error) saved.error = result.error;
			else delete saved.error;
		});
		this.host.changed();
	}
	async articleInputs(scope, taskId, sessionId, signal) {
		const detail = await this.host.resolve(scope), folder = detail.folderPath, state = await readState(folder), task = state.tasks.find((row) => row.id === taskId && row.kind === "article");
		if (!task || !task.video && !task.source || task.status === "cancelled" || task.status === "completed") throw new Error("文章请求已结束或不存在。");
		if (sessionId && !task.sessionId) {
			task.sessionId = sessionId;
			await this.patch(folder, task.id, { sessionId });
		}
		if (!task.video) {
			const outputDirectory = await owned(folder, task.id), skill = await resource("vendor", "wewrite", "SKILL.md");
			const inputFile = join(outputDirectory, "article-inputs.json");
			const text = await locked(`article-input:${folder}:${task.id}`, async () => {
				const existing = await readFile(inputFile, "utf8").catch((error) => {
					if (error.code === "ENOENT") return void 0;
					throw error;
				});
				if (existing) {
					const saved = JSON.parse(existing);
					if (saved.text !== void 0) return saved.text;
				}
				const captured = await readCreationSource(folder, task.source, state);
				await atomic(inputFile, {
					frames: [],
					source: task.source,
					text: captured
				});
				return captured;
			});
			const imageFiles = await Promise.all((state.images ?? []).filter((i) => !i.hidden).map(async (i) => ({
				id: i.id,
				file: relative(outputDirectory, await inside(folder, i.file)),
				purpose: i.purpose
			})));
			return {
				task,
				transcript: `项目：${detail.title}\n\n${text}`,
				frames: [],
				outputDirectory,
				rules: `读取 WeWrite Skill：${skill}。本次为独立写作，按用户需求完成正文、配图及 HTML；不要求视频。已登记图片：${JSON.stringify(imageFiles)}。保存时用这些相对路径和 imageIds。`
			};
		}
		const video = await inside(folder, task.video.name);
		sameMediaIdentityError(task.video, await mediaIdentity(video, signal));
		const transcript = [...state.transcripts].reverse().find((entry) => sameMedia(entry.video, task.video));
		const dir = await owned(folder, task.id), outputDirectory = dir;
		const skill = await resource("vendor", "wewrite", "SKILL.md");
		const rules = `使用 WeWrite 写作 Skill：${skill}。先读取此文件及其中的成熟写作流程和规则，再基于本次真实转写、图片附件制作文章。保存时调用 creator_save_article，返回排版后的 HTML 成品；不要另行运行发布脚本。`;
		if (!transcript) {
			const selected = await this.selected(detail, signal);
			sameMediaIdentityError(task.video, selected.identity);
			const asr = [...(await this.action({
				...scope,
				action: "transcribe"
			}, signal)).tasks].reverse().find((row) => row.kind === "asr" && row.video && sameMedia(row.video, task.video));
			return {
				waiting: "先等待视频转写任务完成，再次调用本工具读取真实文字和画面。",
				...asr?.jobId ? { jobId: asr.jobId } : {},
				task,
				rules,
				outputDirectory
			};
		}
		const manifestPath = join(dir, "article-inputs.json");
		let prepared;
		prepared = await prepareArticleFrames({
			dataDir: this.host.dataDir,
			folder,
			video,
			dir,
			transcript,
			signal
		});
		await atomic(manifestPath, prepared);
		await this.patch(folder, task.id, {
			transcriptId: transcript.id,
			status: "waiting-agent"
		});
		return {
			task,
			transcript: prepared.transcript,
			frames: await Promise.all(prepared.frames.map(async (frame) => ({
				...frame,
				data: await readFile(await inside(folder, frame.file))
			}))),
			rules: `${rules}\n\n${await readFile(skill, "utf8")}`,
			outputDirectory
		};
	}
	async commitArticle(request, signal) {
		const folder = (await this.host.resolve(request)).folderPath, state = await readState(folder), task = state.tasks.find((row) => row.id === request.taskId && row.kind === "article");
		if (!task || task.video && !task.transcriptId || !task.video && !task.source || task.status !== "waiting-agent") throw new Error("请先读取本次文章的真实字幕和画面。");
		if (task.video) sameMediaIdentityError(task.video, await mediaIdentity(await inside(folder, task.video.name), signal));
		const dir = await owned(folder, task.id), inputs = JSON.parse(await readFile(join(dir, "article-inputs.json"), "utf8"));
		const images = await Promise.all((request.imageIds ?? []).map((id) => creationImage(folder, id, state)));
		const version = await saveArticle({
			folder,
			dir,
			...task.video ? { video: task.video } : {},
			...task.transcriptId ? { transcriptId: task.transcriptId } : {},
			...task.source ? { source: task.source } : {},
			imageIds: request.imageIds ?? [],
			frames: [...inputs.frames.map((frame) => frame.file), ...images.map(({ image }) => image.file)],
			markdown: request.markdown
		});
		await updateState(folder, (latest) => {
			latest.articles.push(version);
		});
		try {
			const settings = await readSettings(this.host.dataDir), result = await formatArticle(this.host.dataDir, folder, version.file, settings.wechat.theme, signal);
			await this.patch(folder, task.id, {
				status: "completed",
				articleId: version.id,
				receipt: relative(folder, result.path),
				step: "formatted"
			});
		} catch (cause) {
			await this.patch(folder, task.id, {
				status: "blocked",
				articleId: version.id,
				step: "formatting",
				error: `源稿已保存，排版未完成：${safeError(cause)}。请在文章页重试排版。`
			});
		}
	}
	async wechatAction(detail, request, signal) {
		const folder = detail.folderPath, state = await readState(folder), settings = await readSettings(this.host.dataDir), config = structuredClone(settings.wechat);
		const articleFile = request.articleFile ?? state.articles.at(-1)?.file ?? detail.articlePath;
		if (!articleFile) throw new Error("请先准备或选择公众号文章。");
		const article = await inside(folder, articleFile);
		if (request.action === "wechat-preview") {
			await this.preview(detail, { articleFile: article }, signal);
			return;
		}
		const secret = await this.host.key(wechatCredential(config.appid));
		if (!secret || !config.appid) throw new Error("请先配置公众号 AppID 和 AppSecret。");
		const cover = request.coverPath;
		if (!cover) throw new Error("请先准备公众号封面。");
		const articleRelative = relative(folder, article);
		const previousTask = [...state.tasks].reverse().find((row) => row.kind === "wechat" && row.step === "draft" && row.wechatAppId === config.appid && row.articleFile === articleRelative);
		if (previousTask?.status === "unconfirmed" && !request.acknowledgeUnknown) throw new Error("上次草稿提交结果未确认，请先在公众号后台核对，再明确重试。");
		const previous = [...state.drafts].reverse().find((draft) => draft.appid === config.appid && draft.articleFile === relative(folder, article));
		const { task, fresh } = previousTask && [
			"unconfirmed",
			"failed",
			"cancelled"
		].includes(previousTask.status) && !this.active.has(previousTask.id) ? {
			task: previousTask,
			fresh: true
		} : await this.newTask(detail, "wechat", {
			step: "draft",
			wechatAppId: config.appid,
			articleFile: articleRelative
		});
		if (task.wechatAppId !== config.appid || task.articleFile !== articleRelative) throw new Error("已有公众号草稿任务正在处理其他文章或账号，请先完成或取消原任务。");
		if (fresh) await this.launch(folder, task, async (current) => {
			try {
				const dir = await owned(folder, task.id), draft = await submitWechat({
					dataDir: this.host.dataDir,
					folder,
					dir,
					articleFile: article,
					cover,
					config,
					secret,
					...previous ? { previous } : {},
					...request.confirmRemoteChange ? { confirmRemoteChange: true } : {},
					signal: current
				});
				await updateState(folder, (latest) => {
					const index = latest.drafts.findIndex((row) => row.id === draft.id);
					if (index < 0) latest.drafts.push(draft);
					else latest.drafts[index] = draft;
				});
				await this.patch(folder, task.id, {
					status: "ready",
					remoteId: draft.mediaId,
					receipt: relative(folder, join(dir, "wechat-receipt.json"))
				});
			} catch (error) {
				throw new WechatError(safeError(error, [secret]), error instanceof WechatError ? error.unknownOutcome : true, error instanceof WechatError ? error.code : void 0);
			}
		});
	}
	async preview(scope, request, signal) {
		const detail = await this.host.resolve(scope), folder = detail.folderPath, state = await readState(folder);
		if (request.publicationId) {
			const publication = state.publications?.find((p) => p.id === request.publicationId && !p.hidden);
			if (!publication || publication.revision !== request.revision) throw new Error("发布内容已变化，请读取当前版本后预览。");
			const body = await readFile(await inside(folder, publication.bodyFile), "utf8");
			const dir = await owned(folder, "publication-previews", hashText(`${publication.id}:${publication.revision}:${body}`));
			const manifest = join(dir, "preview-owner.json"), identity = JSON.stringify({
				id: publication.id,
				revision: publication.revision,
				bodyFile: publication.bodyFile
			});
			const previous = await readFile(manifest, "utf8").catch((e) => {
				if (e.code === "ENOENT") return void 0;
				throw e;
			});
			if (previous !== void 0 && JSON.stringify(JSON.parse(previous)) !== identity) throw new Error("预览来源记录与本次版本不符，请重新读取材料。");
			if (previous === void 0) await atomic(manifest, JSON.parse(identity));
			const article = await snapshotPublicationArticle(folder, dir, publication, body, publication.imageIds.map((id) => state.images?.find((i) => i.id === id)?.file).filter((file) => Boolean(file)), void 0, true);
			return formatArticle(this.host.dataDir, folder, article, (await readSettings(this.host.dataDir)).wechat.theme, signal);
		}
		if (request.taskId) {
			const task = state.tasks.find((row) => row.id === request.taskId && row.step === "preview");
			if (!task?.receipt) throw new Error("预览尚未准备好。");
			const path = await inside(folder, task.receipt);
			return {
				html: await readFile(path, "utf8"),
				path
			};
		}
		const file = request.articleFile ?? state.articles.at(-1)?.file ?? detail.articlePath;
		if (!file) throw new Error("请先准备或选择公众号文章。");
		const settings = await readSettings(this.host.dataDir), result = await formatArticle(this.host.dataDir, folder, file, settings.wechat.theme, signal);
		if (state.tasks.some((task) => task.kind === "article" && task.step === "formatting")) await updateState(folder, (latest) => {
			for (const task of latest.tasks) if (task.kind === "article" && task.step === "formatting" && latest.articles.some((article) => article.id === task.articleId && article.file === file)) {
				task.status = "completed";
				task.step = "formatted";
				task.receipt = relative(folder, result.path);
				delete task.error;
			}
		});
		return result;
	}
	async discoverPublications(folder, task, platform, signal) {
		return this.refreshMetrics(folder, task, platform, signal);
	}
	async refreshMetrics(folder, task, platform, signal) {
		if (!task.metricsTargets) Object.assign(task, await metricsSnapshot(this.host.dataDir, folder, await this.host.platforms(), platform));
		const detail = await this.host.resolve({
			id: task.contentId,
			folderPath: folder
		});
		await runMetricsTask({
			dataDir: this.host.dataDir,
			folder,
			task,
			detail,
			signal,
			changed: this.host.changed,
			...this.host.published ? { published: (record) => this.host.published({
				id: task.contentId,
				folderPath: folder
			}, record) } : {},
			collect: async (target, current) => {
				if (target.platform === "official-account") {
					const settings = await readSettings(this.host.dataDir), secret = await this.host.key(wechatCredential(target.accountId));
					if (!secret) throw new Error("公众号凭据未配置。");
					return (await wechatWorker(this.host.dataDir, {
						operation: "stats",
						...settings.wechat,
						secret
					}, current).catch((error) => {
						throw new Error(safeError(error, [secret]));
					})).rows.map((row) => ({
						...row,
						title: row.title ?? "",
						platform: "wechat"
					}));
				}
				const platform = target.platform;
				return withBrowser(this.host.dataDir, current, async (browserSignal) => {
					await requireAccount(platform, target.accountId, browserSignal);
					const peers = task.metricsTargets.filter((row) => row.platform === platform && row.accountId === target.accountId);
					const remoteIds = [...new Set(peers.flatMap((row) => row.remoteId ? [row.remoteId] : []))];
					const result = await runCollectPublish(collectScriptPath(), browserSignal, {
						executable: await browserExecutable(),
						platforms: [platform],
						...remoteIds.length && peers.every((row) => row.remoteId) ? { targets: [{
							title: "",
							remoteIds
						}] } : {},
						cleanupStale: false,
						maxPages: 80,
						xhsScrollSteps: 80
					});
					await requireAccount(platform, target.accountId, browserSignal);
					const page = result.collected.find((row) => row.platform === platform);
					if (!page || page.error || page.loginRequired) throw new Error(page?.error ?? "登录失效或未取得平台结果。");
					return page.items;
				});
			}
		});
	}
};
//#endregion
//#region src/production/projection.ts
/** Project only artifacts whose recorded source still matches the explicit current video. */
async function projectProduction(item, dataDir) {
	const state = await readState(item.folderPath).catch(() => void 0);
	if (!state) return item;
	const current = item.videos?.find((video) => video.name === item.selectedVideo);
	const transcript = [...state.transcripts].reverse().find((entry) => current && entry.video.name === current.name && entry.video.size === current.size && entry.video.modifiedAt === current.modifiedAt);
	const article = state.articles.at(-1), result = { ...item };
	if (dataDir) {
		const settings = await readSettings(dataDir);
		result.publish = { ...item.publish };
		for (const key of Object.keys(result.publish)) {
			const row = result.publish[key], accountId = settings.accounts[key]?.id;
			if (row.verifiedAccountId && row.verifiedAccountId !== accountId) result.publish[key] = {
				status: "unpublished",
				source: "none"
			};
			if ([...state.tasks].reverse().find((task) => task.kind === "upload" && task.platform === key && task.status === "ready" && task.account?.id === accountId && current && task.video?.name === current.name && task.video.size === current.size && task.video.modifiedAt === current.modifiedAt) && result.publish[key].source === "none") result.publish[key] = {
				status: "draft",
				source: "publisher",
				verifiedAccountId: accountId
			};
		}
	}
	if (transcript) {
		const file = await inside(item.folderPath, transcript.srtFile).catch(() => void 0), text = await inside(item.folderPath, transcript.textFile).catch(() => void 0);
		if (file && text) result.subtitles = {
			srt: file,
			transcript: text
		};
	}
	if (article) {
		const file = await inside(item.folderPath, article.file).catch(() => void 0);
		if (file) {
			result.hasArticle = true;
			result.articlePath = file;
			if (!current && result.workflow !== "live") result.workflow = "publish";
		}
	}
	const job = [...state.tasks].reverse().find((task) => task.kind === "asr");
	if (job) result.subtitleJob = {
		status: ["running", "queued"].includes(job.status) ? "running" : job.status === "completed" ? "done" : [
			"failed",
			"unconfirmed",
			"blocked"
		].includes(job.status) ? "error" : "idle",
		startedAt: job.createdAt,
		...job.error ? { error: job.error } : {}
	};
	return result;
}
//#endregion
//#region src/publishRules.ts
const FILE_TO_PLATFORM = Object.fromEntries([...PUBLISH_PLATFORMS.map((platform) => [platform, platform]), ["wechat_channels", "wechat"]]);
function anyPlatformPublished(publish) {
	return PUBLISH_PLATFORMS.some((key) => publish[key].status === "published");
}
function emptyPublish() {
	const result = {};
	for (const platform of PUBLISH_PLATFORMS) result[platform] = {
		status: "unpublished",
		source: "none"
	};
	return result;
}
function emptyBurn() {
	return { status: "idle" };
}
function isPublishMark(value) {
	return value === "unpublished" || value === "draft" || value === "published";
}
function isPublishPlatform(value) {
	return PUBLISH_PLATFORMS.includes(value);
}
function mapPublisherStatus(raw) {
	const value = raw.trim().toLowerCase();
	if (value === "published" || value === "live" || value === "posted") return "published";
	if (value === "ready" || value === "draft" || value === "prepared") return "draft";
	return "unpublished";
}
function pickAutoPublishName(names) {
	if (names.includes("auto-publish.json")) return "auto-publish.json";
	return names.find((name) => name.endsWith(".auto-publish.json"));
}
function platformFromField(field, fallback) {
	if (typeof field === "string") return {
		status: mapPublisherStatus(field),
		source: "publisher"
	};
	if (typeof field !== "object" || field === null) return {
		status: fallback,
		source: "publisher"
	};
	const record = field;
	const status = typeof record.status === "string" ? mapPublisherStatus(record.status) : fallback;
	const url = typeof record.url === "string" && record.url.trim() !== "" ? record.url.trim() : void 0;
	return url === void 0 ? {
		status,
		source: "publisher"
	} : {
		status,
		source: "publisher",
		url
	};
}
function publishFromAutoPublish(value) {
	const result = emptyPublish();
	if (typeof value !== "object" || value === null) return result;
	const publisher = value.publisher;
	if (typeof publisher !== "object" || publisher === null) return result;
	const platforms = publisher.platforms;
	if (typeof platforms !== "object" || platforms === null) return result;
	for (const [rawKey, field] of Object.entries(platforms)) {
		const key = FILE_TO_PLATFORM[rawKey];
		if (key === void 0) continue;
		result[key] = platformFromField(field, "unpublished");
	}
	return result;
}
function mergePublish(file, overlay) {
	if (overlay === void 0) return file;
	const result = {};
	for (const key of PUBLISH_PLATFORMS) {
		result[key] = file[key];
		const over = overlay[key];
		if (over === void 0) continue;
		const source = over.syncedAt === void 0 ? "overlay" : "sync";
		result[key] = {
			status: over.status,
			source,
			...copyOverlayFields(over)
		};
	}
	return result;
}
function decodeOverlayPublish(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const source = raw;
	const next = {};
	for (const key of PUBLISH_PLATFORMS) {
		const field = source[key];
		if (typeof field !== "object" || field === null) continue;
		const record = field;
		if (!isPublishMark(record.status)) continue;
		const entry = { status: record.status };
		if (typeof record.verifiedAccountId === "string") entry.verifiedAccountId = record.verifiedAccountId;
		if (typeof record.url === "string" && record.url.trim() !== "") entry.url = record.url.trim();
		if (typeof record.remoteId === "string" && record.remoteId.trim() !== "") entry.remoteId = record.remoteId.trim();
		if (typeof record.views === "number" && Number.isFinite(record.views)) entry.views = record.views;
		if (typeof record.likes === "number" && Number.isFinite(record.likes)) entry.likes = record.likes;
		if (typeof record.comments === "number" && Number.isFinite(record.comments)) entry.comments = record.comments;
		if (typeof record.syncedAt === "number" && Number.isFinite(record.syncedAt)) entry.syncedAt = record.syncedAt;
		next[key] = entry;
	}
	return Object.keys(next).length === 0 ? void 0 : next;
}
function decodeBurnJob(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const record = raw;
	if (record.status !== "running" && record.status !== "done" && record.status !== "error") return;
	const next = { status: record.status };
	if (typeof record.startedAt === "number" && Number.isFinite(record.startedAt)) next.startedAt = record.startedAt;
	if (typeof record.output === "string" && record.output !== "") next.output = record.output;
	if (typeof record.error === "string" && record.error !== "") next.error = record.error;
	if (typeof record.pid === "number" && Number.isInteger(record.pid) && record.pid > 0) next.pid = record.pid;
	return next;
}
function patchOverlayPublish(current, platform, status, url) {
	const next = { ...current };
	const previous = current?.[platform];
	const entry = {
		status,
		...previous === void 0 ? {} : copyOverlayMetrics(previous)
	};
	if (status === "published" && url !== void 0 && url.trim() !== "") entry.url = url.trim();
	else if (previous?.url !== void 0 && status === "published") entry.url = previous.url;
	next[platform] = entry;
	return next;
}
function copyOverlayMetrics(over) {
	const next = {};
	if (over.remoteId !== void 0) next.remoteId = over.remoteId;
	if (over.views !== void 0) next.views = over.views;
	if (over.likes !== void 0) next.likes = over.likes;
	if (over.comments !== void 0) next.comments = over.comments;
	if (over.syncedAt !== void 0) next.syncedAt = over.syncedAt;
	return next;
}
function copyOverlayFields(over) {
	const next = {};
	if (over.verifiedAccountId !== void 0) next.verifiedAccountId = over.verifiedAccountId;
	if (over.url !== void 0) next.url = over.url;
	if (over.remoteId !== void 0) next.remoteId = over.remoteId;
	if (over.views !== void 0) next.views = over.views;
	if (over.likes !== void 0) next.likes = over.likes;
	if (over.comments !== void 0) next.comments = over.comments;
	if (over.syncedAt !== void 0) next.syncedAt = over.syncedAt;
	return next;
}
//#endregion
//#region src/publishStatus.ts
async function readFolderPublish(folderPath, names) {
	const name = pickAutoPublishName(names ?? await readdir(folderPath).catch(() => []));
	if (name === void 0) return emptyPublish();
	try {
		return publishFromAutoPublish(JSON.parse(await readFile(join(folderPath, name), "utf8")));
	} catch {
		return emptyPublish();
	}
}
//#endregion
//#region src/overlay.ts
const DEFAULT_ENABLED_PLATFORMS = PUBLISH_PLATFORMS;
function emptyProfile() {
	return { enabledPlatforms: [...DEFAULT_ENABLED_PLATFORMS] };
}
function decodeProfile(value) {
	if (typeof value !== "object" || value === null) return emptyProfile();
	const raw = value;
	if (Array.isArray(raw.enabledPlatforms)) return { enabledPlatforms: normalizeEnabledPlatforms(raw.enabledPlatforms) };
	return emptyProfile();
}
function overlayPath(dataDir) {
	return join(dataDir, "overlay.json");
}
function emptyOverlay() {
	return {
		schemaVersion: 1,
		items: {}
	};
}
function decodeOverlay(value) {
	if (typeof value !== "object" || value === null) return emptyOverlay();
	const raw = value;
	const items = {};
	if (raw.items !== null && typeof raw.items === "object") for (const [id, item] of Object.entries(raw.items)) {
		if (typeof item !== "object" || item === null) continue;
		const record = item;
		const next = {};
		if (typeof record.title === "string" && record.title.length > 0) next.title = record.title;
		const publish = decodeOverlayPublish(record.publish);
		if (publish !== void 0) next.publish = publish;
		const burn = decodeBurnJob(record.burn);
		if (burn !== void 0) next.burn = burn;
		const subtitleJob = decodeBurnJob(record.subtitleJob);
		if (subtitleJob !== void 0) next.subtitleJob = subtitleJob;
		const coverJob = decodeBurnJob(record.coverJob);
		if (coverJob !== void 0) next.coverJob = coverJob;
		items[id] = next;
	}
	const store = emptyOverlay();
	store.items = items;
	if (typeof raw.hiddenContents === "object" && raw.hiddenContents !== null) store.hiddenContents = Object.fromEntries(Object.entries(raw.hiddenContents).filter(([, ids]) => Array.isArray(ids)).map(([root, ids]) => [root, [...new Set(ids.filter((id) => typeof id === "string" && id !== "" && id !== "." && id !== ".." && !/[\\/]/.test(id)))]]));
	if (typeof raw.videoSelections === "object" && raw.videoSelections !== null) store.videoSelections = Object.fromEntries(Object.entries(raw.videoSelections).filter(([, v]) => typeof v === "object" && v !== null).map(([root, v]) => [root, Object.fromEntries(Object.entries(v).filter(([, name]) => typeof name === "string" || name === null))]));
	if (typeof raw.hiddenVideos === "object" && raw.hiddenVideos !== null) store.hiddenVideos = Object.fromEntries(Object.entries(raw.hiddenVideos).filter(([, v]) => typeof v === "object" && v !== null).map(([root, value]) => [root, Object.fromEntries(Object.entries(value).filter(([, names]) => Array.isArray(names)).map(([id, names]) => [id, names.filter((n) => typeof n === "string" && !/[\\/]/.test(n))]))]));
	if (typeof raw.libraryRoot === "string" && raw.libraryRoot.length > 0) store.libraryRoot = raw.libraryRoot;
	if (typeof raw.scriptRules === "string" && raw.scriptRules.trim() !== "") store.scriptRules = raw.scriptRules.trim();
	if (typeof raw.profile === "object" && raw.profile !== null) store.profile = decodeProfile(raw.profile);
	return store;
}
async function loadOverlay(dataDir) {
	try {
		const raw = await readFile(overlayPath(dataDir), "utf8");
		return decodeOverlay(JSON.parse(raw));
	} catch {
		return emptyOverlay();
	}
}
const overlayTails = /* @__PURE__ */ new Map();
function withOverlayLock(dataDir, work) {
	const run = (overlayTails.get(dataDir) ?? Promise.resolve()).then(work, work);
	overlayTails.set(dataDir, run.then(() => void 0, () => void 0));
	return run;
}
async function saveOverlay(dataDir, store) {
	const path = overlayPath(dataDir);
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
	await rename(temp, path);
}
//#endregion
//#region src/contentVisibility.ts
function contentRootKey(root) {
	const key = root.replaceAll("\\", "/").replace(/\/+$/, "");
	return process.platform === "win32" ? key.toLowerCase() : key;
}
function removedContentIds(overlay, root) {
	return overlay.hiddenContents?.[contentRootKey(root)] ?? [];
}
/** Only update list visibility. Files, tasks and conversations remain intact. */
async function setContentHidden(dataDir, libraryRoot, id, folderPath, hidden) {
	const root = await realpath(libraryRoot), folder = await contentFolder(root, folderPath);
	if (basename(folder) !== id) throw new Error("项目目录已变化，请刷新后重试。");
	await withOverlayLock(dataDir, async () => {
		const overlay = await loadOverlay(dataDir);
		if (overlay.libraryRoot && contentRootKey(await realpath(overlay.libraryRoot)) !== contentRootKey(root)) throw new Error("资料库已切换，请刷新后重试。");
		const ids = removedContentIds(overlay, root).filter((value) => value !== id);
		overlay.hiddenContents ??= {};
		overlay.hiddenContents[contentRootKey(root)] = hidden ? [...ids, id] : ids;
		await saveOverlay(dataDir, overlay);
	});
}
//#endregion
//#region src/projectSessionsHost.ts
/** Re-account an existing session using the host's exported, cwd-validating registry API. */
async function restoreProjectSessionMembership(ctx, folder, sessionId, signal) {
	const registry = ctx.get("workspaceRegistry");
	const query = ctx.get("sessionQuery");
	if (!registry?.resolveByPath || !registry.create || !query?.observeSession) throw new Error("当前 Desktop 尚未提供恢复原会话分组的接口，原会话和资料已保留。");
	signal.throwIfAborted();
	const observation = await query.observeSession(sessionId);
	try {
		const cwd = observation.header.cwd;
		if (!cwd || await realpath(cwd) !== await realpath(folder)) throw new Error("原会话目录与项目不一致，未更改工作区。");
		signal.throwIfAborted();
		const workspace = await registry.resolveByPath(folder) ?? await registry.create(folder);
		signal.throwIfAborted();
		await workspace.attachSession(sessionId);
	} finally {
		observation[Symbol.dispose]();
	}
}
//#endregion
//#region src/secretsHost.ts
/** Domain-specific references stay in the host vault; never serialized to ordinary settings. */
async function resolveWorkbenchCredential(ctx, ref) {
	return (await credentialsOf(ctx)?.resolve(ref))?.value.trim() || void 0;
}
async function workbenchCredentialConfigured(ctx, ref) {
	return (await credentialsOf(ctx)?.describe(ref))?.configured === true;
}
async function saveWorkbenchCredential(ctx, ref, value) {
	const credentials = credentialsOf(ctx);
	if (!credentials?.set) throw new Error("宿主凭据保存服务暂不可用，请重试。");
	await credentials.set(ref, value);
}
function credentialsOf(ctx) {
	const value = ctx.get("credentials");
	if (typeof value !== "object" || value === null) return void 0;
	const record = value;
	if (typeof record.resolve !== "function" || typeof record.describe !== "function") return void 0;
	return record;
}
function envView(kind) {
	const configured = refsFor(kind).some((ref) => (process.env[ref] ?? "").trim() !== "");
	const view = emptySecretView(kind);
	return configured ? {
		...view,
		configured: true,
		source: "env",
		writable: false
	} : view;
}
async function describeCreatorSecrets(ctx) {
	const credentials = credentialsOf(ctx);
	if (credentials === void 0) return {
		subtitle: envView("subtitle"),
		cover: envView("cover")
	};
	const described = {};
	for (const ref of [...refsFor("subtitle"), ...refsFor("cover")]) described[ref] = await credentials.describe(ref);
	return {
		subtitle: viewFromDescribe("subtitle", described),
		cover: viewFromDescribe("cover", described)
	};
}
async function resolveCreatorSecret(ctx, kind) {
	const credentials = credentialsOf(ctx);
	if (credentials !== void 0) for (const ref of refsFor(kind)) {
		const value = (await credentials.resolve(ref))?.value.trim();
		if (value !== void 0 && value !== "") return value;
	}
	for (const ref of refsFor(kind)) {
		const value = process.env[ref]?.trim();
		if (value !== void 0 && value !== "") return value;
	}
}
//#endregion
//#region src/videoImport.ts
/** Copy to an exclusively owned partial, then publish with an atomic no-overwrite link. */
async function copyVideo(input, signal) {
	signal.throwIfAborted();
	const name = input.name ?? basename(input.sourcePath);
	if (!validVideoName(name) || !validVideoName(basename(input.sourcePath))) throw new Error("只支持 MP4 和 MOV 视频，文件名不能含路径或保留字符。");
	const info = await lstat(input.sourcePath);
	if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error("视频不存在、不是普通文件或内容为空。");
	const folder = await contentFolder(input.libraryRoot, input.folder);
	const target = join(folder, name);
	if (await lstat(target).then(() => true, () => false)) throw new Error("同名文件已存在，请修改导入名称后重试。");
	const temp = join(folder, `.import-${randomUUID()}.partial`);
	let owned = false;
	let committed = false;
	try {
		const handle = await open(temp, "wx");
		owned = true;
		await handle.close();
		await pipeline(createReadStream(input.sourcePath), createWriteStream(temp, { flags: "r+" }), { signal });
		signal.throwIfAborted();
		const after = await lstat(input.sourcePath);
		const copied = await lstat(temp);
		if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || copied.size !== info.size) throw new Error("复制期间源视频发生变化，请导出完成后重新导入。");
		if (await contentFolder(input.libraryRoot, input.folder) !== folder) throw new Error("内容目录发生变化，请重新打开。");
		const synced = await open(temp, "r+");
		try {
			await synced.sync();
		} finally {
			await synced.close();
		}
		signal.throwIfAborted();
		try {
			await link(temp, target);
		} catch (cause) {
			if (cause.code === "EEXIST") throw new Error("同名文件已存在，请修改导入名称后重试。");
			throw cause;
		}
		committed = true;
		return name;
	} finally {
		if (owned) await unlink(temp).catch((cause) => {
			if (!committed) throw cause;
		});
	}
}
var VideoImports = class {
	tasks = /* @__PURE__ */ new Map();
	start(jobs, input, committed) {
		const token = randomUUID();
		const controller = new AbortController();
		const state = {
			token,
			id: input.id,
			status: "running",
			name: input.name ?? basename(input.sourcePath)
		};
		const entry = {
			state,
			controller,
			folder: input.folder
		};
		this.tasks.set(token, entry);
		try {
			state.jobId = jobs.start({
				kind: "creator-media",
				label: `导入视频：${state.name}`,
				run: () => ({
					cancel: () => controller.abort(),
					done: (async () => {
						let fileCommitted = false;
						try {
							const name = await copyVideo(input, controller.signal);
							fileCommitted = true;
							await committed(name);
							state.status = "completed";
							return {
								status: "completed",
								result: join(input.folder, name)
							};
						} catch (cause) {
							const cancelled = controller.signal.aborted && !fileCommitted;
							state.status = cancelled ? "cancelled" : "failed";
							state.error = cause instanceof Error ? cause.message : String(cause);
							return {
								status: cancelled ? "killed" : "failed",
								result: state.error
							};
						}
					})()
				})
			});
		} catch (cause) {
			this.tasks.delete(token);
			throw cause;
		}
		for (const [key, task] of this.tasks) {
			if (this.tasks.size <= 100) break;
			if (task.state.status !== "running") this.tasks.delete(key);
		}
		return { ...state };
	}
	get(token) {
		const task = this.tasks.get(token);
		if (task === void 0) throw new Error("导入任务已结束或应用已重新打开，请刷新片库查看文件。");
		return { ...task.state };
	}
	cancel(token) {
		const task = this.tasks.get(token);
		if (task === void 0) return this.get(token);
		if (task.state.status === "running") task.controller.abort();
		return this.get(token);
	}
	dispose() {
		for (const task of this.tasks.values()) task.controller.abort();
	}
};
//#endregion
//#region src/openExternalPath.ts
/** Hand a validated local path or URL to the OS default application. */
function openExternalPath(path, platform = process.platform) {
	return new Promise((resolve, reject) => {
		const windows = platform === "win32";
		const command = windows ? "explorer.exe" : platform === "darwin" ? "open" : "xdg-open";
		const target = windows && !/^https?:\/\//i.test(path) ? win32.normalize(path) : path;
		const child = spawn(command, [target], {
			stdio: "ignore",
			windowsHide: true,
			...windows ? { detached: true } : {}
		});
		child.once("error", reject);
		if (windows) child.once("spawn", () => {
			child.unref();
			resolve();
		});
		else child.once("exit", (code) => {
			if (code === 0 || code === null) resolve();
			else reject(/* @__PURE__ */ new Error(`${command} failed: ${code}`));
		});
	});
}
//#endregion
//#region src/catalog.ts
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})_(.+)$/;
const SKIP_DIRS = /* @__PURE__ */ new Set([
	".dsh-creator-workbench",
	".oil-cover",
	"公众号文章"
]);
function formatDay(now) {
	return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function readableTitle(title) {
	return title.trim().replace(/[\\/:*?"<>|\n\r]/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
function folderNameForTitle(title, now) {
	const safe = readableTitle(title);
	if (safe === "") throw new Error("empty title");
	return `${formatDay(now)}_${safe}`;
}
async function createContentFolder(libraryRoot, title, now = /* @__PURE__ */ new Date()) {
	const root = await stat(libraryRoot).catch(() => void 0);
	if (root === void 0 || !root.isDirectory()) throw new Error("library root missing");
	const base = folderNameForTitle(title, now);
	let id = base;
	let suffix = 2;
	while (true) {
		const folderPath = join(libraryRoot, id);
		if (!await stat(folderPath).then(() => true, () => false)) {
			await mkdir(folderPath);
			return {
				id,
				folderPath
			};
		}
		id = `${base}-${suffix}`;
		suffix += 1;
	}
}
function folderDateAndTitle(folderName) {
	const matched = DATE_PREFIX.exec(folderName);
	if (matched === null || matched[1] === void 0 || matched[2] === void 0) return { title: folderName };
	return {
		date: matched[1],
		title: matched[2]
	};
}
function folderDateMs(date) {
	if (date === void 0) return void 0;
	const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (matched === null) return void 0;
	const year = Number(matched[1]);
	const month = Number(matched[2]);
	const day = Number(matched[3]);
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return void 0;
	const value = new Date(year, month - 1, day).getTime();
	return Number.isFinite(value) ? value : void 0;
}
function hasCover(item) {
	return item.covers["3x4"] !== void 0 || item.covers["4x3"] !== void 0 || item.covers["16x9"] !== void 0;
}
function sameCalendarDay(a, b) {
	const left = new Date(a);
	const right = new Date(b);
	return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
function hasSubtitle(item) {
	return item.subtitles.srt !== void 0 || item.subtitles.ass !== void 0 || item.subtitles.transcript !== void 0 || item.videoSubtitled !== void 0;
}
function pipelineOf(item) {
	if (item.hasPublishPackage) return "packaged";
	if (hasCover(item)) return "covered";
	if (hasSubtitle(item)) return "subtitled";
	return "raw";
}
function workflowOf(item, overlay) {
	if (anyPlatformPublished(item.publish)) return "live";
	if (currentVideoPath(item) !== void 0) {
		if (hasCover(item)) return "publish";
		return "finish";
	}
	return "idle";
}
function countsOf(items) {
	let cover = 0;
	let subtitle = 0;
	let article = 0;
	for (const item of items) {
		if (hasCover(item)) cover += 1;
		if (hasSubtitle(item)) subtitle += 1;
		if (item.hasArticle) article += 1;
	}
	return {
		total: items.length,
		cover,
		subtitle,
		article
	};
}
function matchesFilter(item, filter) {
	if (filter === "cover") return hasCover(item);
	if (filter === "subtitle") return hasSubtitle(item);
	if (filter === "article") return item.hasArticle;
	return true;
}
function matchesQuery(item, query) {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	return item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle) || item.tags.some((tag) => tag.toLowerCase().includes(needle));
}
async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return;
	}
}
function stringArrayField(value, key) {
	if (typeof value !== "object" || value === null) return [];
	const field = value[key];
	if (!Array.isArray(field)) return [];
	return field.filter((item) => typeof item === "string" && item.length > 0);
}
async function scanFolder(libraryRoot, folderName, overlay) {
	const folderPath = join(libraryRoot, folderName);
	const info = await stat(folderPath).catch(() => void 0);
	if (info === void 0 || !info.isDirectory()) return void 0;
	if (SKIP_DIRS.has(folderName) || folderName.startsWith(".")) return void 0;
	const entries = await readdir(folderPath, { withFileTypes: true });
	const names = entries.map((entry) => entry.name);
	const { date, title: folderTitle } = folderDateAndTitle(folderName);
	let covers = {};
	const cover3x4 = names.find((name) => name.endsWith("_3x4.png"));
	const cover4x3 = names.find((name) => name.endsWith("_4x3.png"));
	const cover16x9 = names.find((name) => name.endsWith("_16x9.png"));
	if (cover3x4 !== void 0) covers["3x4"] = join(folderPath, cover3x4);
	if (cover4x3 !== void 0) covers["4x3"] = join(folderPath, cover4x3);
	if (cover16x9 !== void 0) covers["16x9"] = join(folderPath, cover16x9);
	covers = await selectedCoverPaths(folderPath, covers);
	const subtitles = {};
	const srt = names.find((name) => name.endsWith(".srt"));
	const ass = names.find((name) => name.endsWith(".ass"));
	if (srt !== void 0) subtitles.srt = join(folderPath, srt);
	if (ass !== void 0) subtitles.ass = join(folderPath, ass);
	const workDir = names.find((name) => name.endsWith(".subtitle-work"));
	if (workDir !== void 0) {
		const transcript = join(folderPath, workDir, "subtitle-transcript.json");
		const fallback = join(folderPath, workDir, "transcript.json");
		if (await fileExists(transcript)) subtitles.transcript = transcript;
		else if (await fileExists(fallback)) subtitles.transcript = fallback;
	}
	let videos = [];
	for (const entry of entries) {
		if (!entry.isFile() || !validVideoName(entry.name)) continue;
		const path = await videoFile(folderPath, entry.name).catch(() => void 0);
		if (path === void 0) continue;
		const info = await stat(path);
		videos.push({
			name: entry.name,
			path,
			size: info.size,
			modifiedAt: info.mtimeMs
		});
	}
	videos.sort((a, b) => a.name.localeCompare(b.name, "zh"));
	const hiddenNames = overlay.hiddenVideos?.[libraryRoot]?.[folderName] ?? [];
	const hiddenVideos = hiddenNames.map((name) => videos.find((v) => sameVideoName(v.name, name, process.platform === "win32")) ?? {
		name,
		path: join(folderPath, name),
		size: 0,
		modifiedAt: 0,
		missing: true
	});
	videos = videos.filter((v) => !hiddenNames.some((name) => sameVideoName(v.name, name, process.platform === "win32")));
	const selection = resolveVideoSelection(videos, overlay.videoSelections?.[libraryRoot]?.[folderName]);
	const selected = videos.find((video) => video.name === selection.selectedVideo);
	const videoRaw = selected?.path;
	const videoSubtitled = selected !== void 0 && isSubtitledVideoName(selected.name.toLowerCase()) ? selected.path : void 0;
	const packageName = pickPublishPackage(names);
	const packagePath = packageName === void 0 ? void 0 : join(folderPath, packageName);
	const packageJson = packagePath === void 0 ? void 0 : await readJson(packagePath);
	const title = overlay.items[folderName]?.title ?? folderTitle;
	const tags = [
		...stringArrayField(packageJson, "xhsTopics"),
		...stringArrayField(packageJson, "douyinTopics"),
		...stringArrayField(packageJson, "bilibiliTags"),
		...stringArrayField(packageJson, "wechatTags")
	].filter((tag, index, all) => all.indexOf(tag) === index);
	const folderDate = folderDateMs(date);
	const createdMs = info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs;
	const recordedAt = folderDate === void 0 ? createdMs : sameCalendarDay(folderDate, createdMs) ? createdMs : folderDate;
	const overlayItem = overlay.items[folderName];
	let articlePath;
	if (names.includes("公众号文章")) {
		const articleFile = pickArticleFile(await readdir(join(folderPath, ARTICLE_DIR)).catch(() => []));
		if (articleFile !== void 0) articlePath = join(folderPath, ARTICLE_DIR, articleFile);
	}
	const draft = {
		id: folderName,
		folderPath,
		title,
		recordedAt,
		createdMs,
		covers,
		subtitles,
		videos,
		hiddenVideos,
		...selection,
		hasPublishPackage: packageJson !== void 0,
		hasArticle: articlePath !== void 0,
		tags,
		...date === void 0 ? {} : { date },
		...videoRaw === void 0 ? {} : { videoRaw },
		...videoSubtitled === void 0 ? {} : { videoSubtitled },
		...articlePath === void 0 ? {} : { articlePath },
		publish: mergePublish(await readFolderPublish(folderPath, names), overlayItem?.publish),
		burn: overlayItem?.burn ?? emptyBurn(),
		subtitleJob: overlayItem?.subtitleJob ?? emptyBurn(),
		coverJob: overlayItem?.coverJob ?? emptyBurn()
	};
	return {
		...draft,
		pipeline: pipelineOf(draft),
		workflow: workflowOf(draft, overlay.items[folderName])
	};
}
async function fileExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
async function scanLibrary(libraryRoot, overlay) {
	const root = await stat(libraryRoot).catch(() => void 0);
	if (root === void 0 || !root.isDirectory()) return [];
	const entries = await readdir(libraryRoot, { withFileTypes: true });
	const items = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const item = await scanFolder(libraryRoot, entry.name, overlay);
		if (item !== void 0) items.push(item);
	}
	items.sort((left, right) => {
		if (left.recordedAt !== right.recordedAt) return right.recordedAt - left.recordedAt;
		if (left.createdMs !== right.createdMs) return right.createdMs - left.createdMs;
		return basename(right.folderPath).localeCompare(basename(left.folderPath), "zh");
	});
	return items;
}
async function readTopicNote(folderPath) {
	try {
		return await readFile(join(folderPath, "topic.md"), "utf8");
	} catch {
		return "";
	}
}
async function writeTopicNote(folderPath, text) {
	const path = join(folderPath, "topic.md");
	if (text.trim() === "") {
		await unlink(path).catch(() => void 0);
		return;
	}
	const body = text.endsWith("\n") ? text : `${text}\n`;
	await writeFile(path, body, "utf8");
}
async function readScript(folderPath) {
	try {
		return await readFile(join(folderPath, "script.md"), "utf8");
	} catch {
		return "";
	}
}
async function writeScript(folderPath, text) {
	const path = join(folderPath, "script.md");
	if (text.trim() === "") {
		await unlink(path).catch(() => void 0);
		return;
	}
	const body = text.endsWith("\n") ? text : `${text}\n`;
	await writeFile(path, body, "utf8");
}
async function readArticle(path) {
	if (path === void 0) return "";
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}
async function readPublishCopy(folderPath) {
	const packageName = pickPublishPackage(await readdir(folderPath).catch(() => []));
	if (packageName === void 0) return "";
	const value = await readJson(join(folderPath, packageName));
	if (typeof value !== "object" || value === null) return "";
	const record = value;
	const parts = [];
	for (const key of [
		"title",
		"bilibiliDescription",
		"douyinDescription",
		"wechatDescription"
	]) {
		const field = record[key];
		if (typeof field === "string" && field.length > 0) parts.push(field);
	}
	return parts.join("\n\n");
}
function formatCueClock(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) return "";
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total % 3600 / 60);
	const rest = total % 60;
	if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
	return `${minutes}:${String(rest).padStart(2, "0")}`;
}
function cuesFromSegments(segments) {
	const cues = [];
	for (const segment of segments) {
		if (typeof segment !== "object" || segment === null) continue;
		const row = segment;
		const text = typeof row.text === "string" ? row.text.trim() : "";
		if (text === "") continue;
		const start = typeof row.start === "number" ? row.start : typeof row.startTime === "number" ? row.startTime : void 0;
		const at = start === void 0 ? void 0 : formatCueClock(start);
		cues.push(at === void 0 || at === "" ? { text } : {
			text,
			at
		});
	}
	return cues;
}
function cuesFromTranscript(value) {
	if (Array.isArray(value)) return cuesFromSegments(value);
	if (typeof value !== "object" || value === null) return [];
	const record = value;
	if (Array.isArray(record.segments)) return cuesFromSegments(record.segments);
	const text = typeof record.text === "string" ? record.text.trim() : "";
	return text === "" ? [] : [{ text }];
}
const ASS_DRAWING = /\\p\d/;
const ASS_VECTOR = /^(?:m|l|b)\s+-?\d/i;
const ASS_SKIP_STYLES = /* @__PURE__ */ new Set([
	"captionbox",
	"progresslabel",
	"progressfill"
]);
function assCueText(parts) {
	const style = (parts[3] ?? "").trim().toLowerCase();
	const name = (parts[4] ?? "").trim().toLowerCase();
	if (ASS_SKIP_STYLES.has(style) || ASS_SKIP_STYLES.has(name)) return void 0;
	const original = parts.slice(9).join(",");
	if (ASS_DRAWING.test(original)) return void 0;
	const text = original.replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n").replace(/\\n/g, "\n").trim();
	if (text === "" || ASS_VECTOR.test(text)) return void 0;
	return text;
}
function cuesFromAss(raw) {
	const cues = [];
	for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
		if (!line.startsWith("Dialogue:")) continue;
		const parts = line.slice(9).trim().split(",");
		if (parts.length < 10) continue;
		const text = assCueText(parts);
		if (text === void 0) continue;
		const at = formatAssClock(parts[1] ?? "");
		cues.push(at === void 0 ? { text } : {
			text,
			at
		});
	}
	return cues;
}
function formatAssClock(stamp) {
	const matched = /^(\d+):(\d{2}):(\d{2})/.exec(stamp.trim());
	if (matched === null || matched[1] === void 0 || matched[2] === void 0 || matched[3] === void 0) return;
	const hours = Number(matched[1]);
	const minutes = matched[2];
	const seconds = matched[3];
	if (hours > 0) return `${hours}:${minutes}:${seconds}`;
	return `${Number(minutes)}:${seconds}`;
}
function cuesFromSrt(raw) {
	const blocks = raw.replace(/^\uFEFF/, "").split(/\n{2,}/);
	const cues = [];
	for (const block of blocks) {
		const lines = block.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
		let at;
		const texts = [];
		for (const line of lines) {
			const stamp = /^(\d{2}):(\d{2}):(\d{2})[,.]/.exec(line);
			if (stamp !== null) {
				const hours = stamp[1];
				const minutes = stamp[2];
				const seconds = stamp[3];
				if (hours !== void 0 && minutes !== void 0 && seconds !== void 0) at = hours === "00" ? `${Number(minutes)}:${seconds}` : `${Number(hours)}:${minutes}:${seconds}`;
				continue;
			}
			if (/^\d+$/.test(line)) continue;
			if (line.startsWith("Dialogue:") || line.startsWith("Style:") || line.startsWith("Format:")) continue;
			texts.push(line.replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n"));
		}
		const text = texts.join("\n").trim();
		if (text === "") continue;
		cues.push(at === void 0 ? { text } : {
			text,
			at
		});
	}
	return cues;
}
function subtitlePaths(item) {
	return [
		item.subtitles.srt,
		item.subtitles.transcript,
		item.subtitles.ass
	].filter((path) => path !== void 0);
}
async function cuesFromFile(path) {
	try {
		const raw = await readFile(path, "utf8");
		if (path.endsWith(".json")) return cuesFromTranscript(JSON.parse(raw));
		if (path.endsWith(".ass")) return cuesFromAss(raw);
		return cuesFromSrt(raw);
	} catch {
		return [];
	}
}
async function readSubtitleCues(item) {
	for (const path of subtitlePaths(item)) {
		const cues = await cuesFromFile(path);
		if (cues.length > 0) return cues;
	}
	return [];
}
async function readSubtitleText(item) {
	return (await readSubtitleCues(item)).map((cue) => cue.text).join("\n");
}
function coverPathOf(item) {
	return item.covers["3x4"] ?? item.covers["4x3"] ?? item.covers["16x9"];
}
//#endregion
//#region src/capabilities.ts
function capability(state, required, detail, path) {
	return path === void 0 ? {
		state,
		required,
		detail
	} : {
		state,
		required,
		detail,
		path
	};
}
async function libraryCapability(path) {
	const info = await stat(path).catch(() => void 0);
	if (info === void 0 || !info.isDirectory()) return capability("missing", true, "内容目录不存在，需要先选择或创建目录。", path);
	return await access(path, constants.R_OK | constants.W_OK).then(() => true, () => false) ? capability("ready", true, "内容目录可读写。", path) : capability("missing", true, "内容目录存在，但当前进程没有读写权限。", path);
}
async function subtitleCapability(platform, env, home) {
	if (platform !== "win32") return capability("unsupported", false, "当前语音转文字入口面向 Windows。");
	const ffmpeg = await findExecutable("ffmpeg", env, platform, home);
	const local = home === homedir() && existsSync("C:/ffmpeg/bin/ffmpeg.exe");
	return ffmpeg || local ? capability("ready", false, "本地音频提取可用；火山识别能力需使用已配置服务实际验证。") : capability("missing", false, "请安装 FFmpeg，再使用火山录音文件识别。");
}
async function coverCapability(path, platform) {
	const rules = join(path, "references", "cover-rules.md");
	const flow = join(path, "references", "agent-native-flow.md");
	return (await Promise.all([rules, flow].map((file) => access(file, constants.R_OK).then(() => true, () => false)))).every(Boolean) ? capability("ready", false, "已发现 oil-cover 原生 Agent 流程和视觉规则；看图能力由当前 Harness 模型决定。", path) : capability("missing", false, "未发现 oil-cover 原生流程与视觉规则；已有封面管理仍可使用。", path);
}
function credentialCapability(secret, label) {
	return secret.configured ? capability("ready", false, `${label}凭据已配置。`) : capability("missing", false, `${label}凭据未配置。`);
}
async function findExecutable(command, env = process.env, platform = process.platform, home = homedir()) {
	const pathValue = pathEnvValue(env);
	const extensions = platform === "win32" ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)] : [""];
	const mode = platform === "win32" ? constants.F_OK : constants.X_OK;
	const directories = [...pathValue.split(delimiter).filter(Boolean), ...extraBinDirs(platform, home, env)];
	for (const directory of directories) for (const extension of extensions) {
		const fileName = platform === "win32" && extension !== "" ? `${command}${extension}` : command;
		const path = join(directory, fileName);
		if (await access(path, mode).then(() => true, () => false)) return path;
	}
}
async function findEgo(platform, env, home) {
	const cli = await findExecutable("ego-browser", env, platform, home);
	if (cli !== void 0) return {
		path: cli,
		kind: "cli"
	};
	for (const path of egoInstallCandidates(platform, home, env)) if (await access(path).then(() => true, () => false)) return {
		path,
		kind: "app"
	};
}
function egoCapability(found) {
	if (found === void 0) return capability("missing", false, "未发现 Ego Browser；自动发布和发布数据回收不可用。");
	if (found.kind === "app") return capability("missing", false, "已发现 Ego Lite 应用，但 PATH 里没有 ego-browser 命令；把 CLI 加到 PATH 后再试。", found.path);
	return capability("ready", false, "已发现 Ego Browser 命令；账号、上传和数据能力需分别实际检查。", found.path);
}
function recommendationsOf(capabilities) {
	const recommendations = [];
	if (capabilities.library.state !== "ready") recommendations.push("先选择一个可读写的内容目录。");
	if (capabilities.subtitleSkill.state !== "ready") recommendations.push("视频转文字：安装 FFmpeg，使用 Windows 入口。");
	if (capabilities.subtitleCredential.state !== "ready") recommendations.push("在设置 → 语音转文字中填写火山语音 API Key。");
	if (capabilities.coverSkill.state !== "ready") recommendations.push("封面：git clone https://github.com/oil-oil/oil-cover ~/.agents/skills/oil-cover");
	if (capabilities.coverCredential.state !== "ready") recommendations.push("封面：在数据与设置中填写所选生图服务的地址、模型和 API Key；分析使用 Harness 当前 Agent。");
	if (capabilities.publishSync.state !== "ready") recommendations.push(capabilities.publishSync.detail.includes("PATH") ? "自动发布和数据回收：已装 Ego Lite，还需要把 ego-browser 加到 PATH。" : "自动发布和数据回收：安装 Ego Browser（https://www.egolite.ai/download）并保证 PATH 里有 ego-browser，再登录各平台后台。");
	if (capabilities.publishSkill.state !== "ready") recommendations.push("视频上传：在设置 → 发布平台中准备运行环境。");
	if (capabilities.articleSkill.state !== "ready") recommendations.push("公众号图文：在设置 → 发布平台中准备运行环境。");
	return recommendations;
}
async function inspectCreatorSetup(options) {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	const capabilities = {
		library: await libraryCapability(options.libraryRoot),
		subtitleSkill: await subtitleCapability(platform, env, home),
		subtitleCredential: credentialCapability(options.settings.secrets.subtitle, "字幕"),
		coverSkill: await coverCapability(options.coverSkillDir, platform),
		coverCredential: credentialCapability(options.settings.secrets.cover, "封面"),
		publishSync: egoCapability(await findEgo(platform, env, home)),
		publishSkill: existsSync(join(publisherRoot(options.dataDir), "scripts", "v2", "publisher.mjs")) ? capability("ready", false, "已准备锁定版本的视频上传工具。") : capability("missing", false, "请在发布平台设置中准备运行环境。"),
		articleSkill: await resource("vendor", "wewrite", "SKILL.md").then(() => capability("ready", false, "已提供 WeWrite 写作与排版。"), () => capability("missing", false, "WeWrite 资源缺失，请重新安装完整工作台包。"))
	};
	return {
		platform,
		dataDir: options.dataDir,
		settings: options.settings,
		capabilities,
		recommendations: recommendationsOf(capabilities)
	};
}
//#endregion
//#region src/guide.ts
function stateMark(capability) {
	if (capability.state === "ready") return "可用";
	if (capability.state === "unsupported") return "当前系统不支持";
	return "缺失";
}
function capabilityLine(label, capability) {
	return `- ${label}：${stateMark(capability)}。${capability.detail}`;
}
function subtitleLines(capabilities) {
	const lines = [];
	if (capabilities.subtitleSkill.state !== "ready") lines.push("- 视频转文字需要 Windows 和 FFmpeg；请按当前能力提示补齐依赖。");
	if (capabilities.subtitleCredential.state !== "ready") lines.push("- 请在工作台设置 → 语音转文字配置火山语音 API Key，不要把 Key 发到对话。");
	return lines.length ? lines : ["- 本地提取与凭据已准备；实际识别结果仍需验证。"];
}
function coverLines(capabilities) {
	const lines = [];
	if (capabilities.coverSkill.state !== "ready") lines.push("- 缺 oil-cover：征得用户同意后执行 `git clone https://github.com/oil-oil/oil-cover ~/.agents/skills/oil-cover`，装完重新调用 creator_setup 确认。");
	if (capabilities.coverCredential.state !== "ready") lines.push("- 缺生图服务凭据：让用户在工作台的数据与设置填写所选服务的地址、模型和 API Key；不要让用户把 Key 明文发到对话里。");
	return lines.length === 0 ? ["- 当前封面能力可用。"] : lines;
}
function publishPlatformLine(enabledPlatforms) {
	if (enabledPlatforms.length === 0) return "- 当前 enabledPlatforms 为空（[]）：不要调用 video-publisher，也不要调用 creator_sync_publish；先用 creator_setup 配置启用平台，用户确认后再继续。";
	return `- 当前 enabledPlatforms：${enabledPlatforms.map((platform) => `${PUBLISH_PLATFORM_DEFINITIONS[platform].name}（${platform}）`).join("、")}。video-publisher 与 creator_sync_publish 只处理这些平台，不得上传或同步其他平台。`;
}
/**
* Build the self-bootstrap guide for the model. The text reflects the live
* capability status so the model can tell the user exactly which parts of the
* workflow work on this machine and which need installation or credentials.
*/
function creatorGuideText(status) {
	const { capabilities, settings } = status;
	const scriptRules = settings.scriptRules;
	const enabledPlatforms = settings.profile.enabledPlatforms;
	return [
		"# 内容工作台自举指引",
		"",
		"用户在 DeepSeek Harness 里安装了内容工作台插件。你的任务是在同一项目中协助用户制作脚本、视频、文章和配图，并独立准备各平台发布材料，并在能力缺失时明确告诉用户缺什么、怎么补。先把下面的现状转成用户听得懂的话，不要逐字复述。",
		"",
		"## 当前能力状态",
		capabilityLine("内容目录（核心）", capabilities.library),
		capabilityLine("Windows 视频转文字", capabilities.subtitleSkill),
		capabilityLine("火山语音凭据", capabilities.subtitleCredential),
		capabilityLine("封面工作流 oil-cover", capabilities.coverSkill),
		capabilityLine("生图服务凭据", capabilities.coverCredential),
		capabilityLine("Ego Browser（自动发布与数据回收）", capabilities.publishSync),
		capabilityLine("发布 skill video-publisher", capabilities.publishSkill),
		capabilityLine("公众号写作 WeWrite", capabilities.articleSkill),
		"",
		"## 内容管理",
		`- 片库目录是 ${settings.libraryRoot}，一集一个子文件夹，命名为 YYYY-MM-DD_可读标题。`,
		"- 正文以磁盘文件为准：topic.md 选题、script.md 口播脚本、公众号文章/ 图文稿、*.mp4 成片、*.srt/*.ass 字幕、*_3x4.png 等封面。读和改这些文件用系统自带的文件工具。",
		"- 新建一集用 creator_create_content；文件夹名乱了用 creator_organize_library，先预览、用户确认后再 apply=true。它只改名，不删文件。",
		"- 工作台自己的状态（绑定、阶段、发布标记）在 overlay.json，不是正文，不要手改。",
		"",
		"## 脚本与人设",
		"- 每集的口播脚本在 script.md，直接用文件工具读写。",
		scriptRules === void 0 ? "- 当前没有配置脚本规则（人设）。用户第一次让你写或改脚本时，先主动问清语气、结构、禁忌和目标观众，再用 creator_script_rules 存下来，之后每次写脚本都遵循。" : "- 已配置脚本规则（人设），写或改 script.md 前先用 creator_script_rules 读取并严格遵循；用户提出新的长期偏好时，把它合并进规则再保存。",
		"",
		"## 字幕",
		"- 脚本和字幕都是可选资料。视频转文章优先使用匹配字幕，缺少时调用火山录音文件识别；在字幕页查看或导入，原始识别结果保留。",
		"- creator_generate_subtitles 是 Harness 后台任务。保存返回的 job id，用 job_output 的 wait=true 等待并获取完成结果、job_kill 取消；不要把启动说成完成。完成以工作台任务和带时间轴的实际文字/SRT 为准。",
		...subtitleLines(capabilities),
		"",
		"## 封面",
		"- creator_generate_cover 前先按 oil-cover 从脚本或字幕提炼封面主标题，通过 title 传入；不要把文件夹名直接当封面结论。它返回 Harness job id，用 job_output（需要等待时传 wait=true）/ job_kill 管理。",
		"- 封面任务完成后调用 creator_prepare_visual_review，把三画幅作为图片附件检查构图、可读性、安全区、画幅适配和品牌一致性；随后调用 creator_save_visual_review，把具体结论写入该期目录。",
		...coverLines(capabilities),
		"",
		"## 视频导入",
		"- 通过工作台导入 MP4 或 MOV，原文件保留。多个视频时先选择当前视频；字幕可选。需要 AI 协助时再打开原生对话。",
		"",
		"## 自动发布与数据回收",
		"- 这两项都依赖 Ego Browser Windows 版和已登录的各平台创作者后台；在发布设置中打开登录、检查并连接实际账号。发现命令不代表已通过上传验收。",
		publishPlatformLine(enabledPlatforms),
		capabilities.publishSync.state === "ready" ? enabledPlatforms.length === 0 ? "- 已发现 Ego Browser，但当前没有启用平台，不执行自动发布和数据回收。" : "- 当前已发现 Ego Browser。上传通过工作台 creator_production_action 调用锁定版本 video-publisher，精确绑定视频、封面和账号；停在最终发表按钮前由用户点。只有用户要求时，用 creator_sync_publish 或 refresh-metrics 手动回收数据。" : "- 当前未发现 Ego Browser：自动发布和 creator_sync_publish 数据回收都不可用。告诉用户到 https://www.egolite.ai/download 下载 Windows 版，完成首次引导后再登录平台；片库、脚本、字幕、封面不受影响，不要假装能同步。",
		capabilities.publishSkill.state === "ready" ? enabledPlatforms.length === 0 ? "- 已发现 video-publisher，但当前没有启用平台，不使用它。" : "- 已发现 video-publisher。" : enabledPlatforms.length === 0 ? "- 当前没有启用平台，先配置 enabledPlatforms，再考虑安装 video-publisher。" : "- 缺 video-publisher：请在工作台设置 → 发布平台点击准备运行环境，使用锁定版本及 Windows 兼容入口；不要直接克隆未知版本来绕过检查。",
		"",
		"## 公众号图文",
		"- 在文章页发起制作，由用户发送原生会话草稿。用 creator_prepare_article 读取固定请求的字幕、真实截图和 WeWrite Skill，按其成熟流程写作与检查，再用 creator_save_article 保存并交付排版 HTML。",
		"- 普通成片视频可以转写，配图直接从当前视频截取。",
		"- 脚本可作表达参考，事实以成片、真实转写和截图为准。公众号单独配置 AppID/AppSecret；先预览，再创建或更新草稿并读取确认，不自动发表。",
		capabilities.articleSkill.state === "ready" ? "- 已提供 WeWrite 写作规范和排版能力，Markdown 用作可编辑源稿，默认查看 HTML 成品。" : "- WeWrite 资源缺失：请重新安装完整工作台包。",
		"",
		"## 推进原则",
		"- 每次只推进当前缺失的下一步：内容与脚本 → 导入视频并选择当前视频 → 封面与发布材料 → 平台草稿 → 人工发表 → 数据回收。独立字幕可选。",
		"- 任何写入（配置、整理、发布标记）先预览或说明，用户确认后再执行。",
		...status.recommendations.length === 0 ? ["- 当前没有待办的环境建议。"] : [
			"",
			"## 环境建议",
			...status.recommendations.map((item) => `- ${item}`)
		]
	].join("\n");
}
//#endregion
//#region src/organize.ts
const DATED = /^(\d{4}-\d{2}-\d{2})_(.+)$/;
const CLIPBOARD = /^Clipboard-(\d{4})(\d{2})(\d{2})-(\d{6})(?:-(\d+))?$/i;
const SCREEN = /^录屏(\d{4})-(\d{2})-(\d{2})(?:[ _.-](.+))?$/;
const FEISHU = /^飞书(\d{4})(\d{2})(\d{2})(?:-(\d+))?$/;
const CN_DATE = /^(\d{1,2})月(\d{1,2})日$/;
const STAGING = ".oil-organize-tmp";
function inferDateFromName(folderName, recordedAt) {
	const dated = DATED.exec(folderName);
	if (dated?.[1] !== void 0) return dated[1];
	const clip = CLIPBOARD.exec(folderName);
	if (clip !== null && clip[1] !== void 0 && clip[2] !== void 0 && clip[3] !== void 0) return `${clip[1]}-${clip[2]}-${clip[3]}`;
	const rec = SCREEN.exec(folderName);
	if (rec !== null && rec[1] !== void 0 && rec[2] !== void 0 && rec[3] !== void 0) return `${rec[1]}-${rec[2]}-${rec[3]}`;
	const feishu = FEISHU.exec(folderName);
	if (feishu !== null && feishu[1] !== void 0 && feishu[2] !== void 0 && feishu[3] !== void 0) return `${feishu[1]}-${feishu[2]}-${feishu[3]}`;
	const cn = CN_DATE.exec(folderName);
	if (cn !== null && cn[1] !== void 0 && cn[2] !== void 0) return `${recordedAt.getFullYear()}-${cn[1].padStart(2, "0")}-${cn[2].padStart(2, "0")}`;
	return formatDay(recordedAt);
}
function inferTitleFromName(folderName) {
	const dated = DATED.exec(folderName);
	if (dated?.[2] !== void 0) return readableTitle(dated[2]);
	const clip = CLIPBOARD.exec(folderName);
	if (clip !== null && clip[4] !== void 0) return readableTitle(`Clipboard ${clip[4]}`);
	const rec = SCREEN.exec(folderName);
	if (rec !== null) return rec[4] === void 0 ? "录屏" : readableTitle(`录屏 ${rec[4]}`);
	const feishu = FEISHU.exec(folderName);
	if (feishu !== null) return feishu[4] === void 0 ? "飞书" : readableTitle(`飞书 ${feishu[4]}`);
	return readableTitle(folderName);
}
function proposedFolderName(folderName, recordedAt) {
	const date = inferDateFromName(folderName, recordedAt);
	const title = inferTitleFromName(folderName);
	return `${date}_${title === "" ? "未命名" : title}`;
}
function reasonOf(from, to) {
	const dated = DATED.exec(from);
	const dateChanged = dated?.[1] !== to.slice(0, 10);
	const fromTitle = dated?.[2] ?? from;
	const toTitle = to.slice(11);
	const titleChanged = readableTitle(fromTitle) !== fromTitle || fromTitle !== toTitle;
	if (dateChanged && titleChanged) return "both";
	if (dateChanged) return "add-date";
	return "readable-title";
}
function uniqueName(base, used) {
	let suffix = 2;
	let next = `${base}-${suffix}`;
	while (used.has(next)) {
		suffix += 1;
		next = `${base}-${suffix}`;
	}
	return next;
}
function proposeOrganizeMoves(items, ids = []) {
	const selected = ids.length === 0 ? items : items.filter((item) => ids.includes(item.id));
	const used = new Set(items.map((item) => item.id));
	const moves = [];
	let unchanged = items.length - selected.length;
	for (const item of selected) if (proposedFolderName(item.id, new Date(item.recordedAt)) !== item.id) used.delete(item.id);
	for (const item of selected) {
		let target = proposedFolderName(item.id, new Date(item.recordedAt));
		if (target === item.id) {
			unchanged += 1;
			continue;
		}
		if (used.has(target)) target = uniqueName(target, used);
		used.add(target);
		moves.push({
			from: item.id,
			to: target,
			reason: reasonOf(item.id, target)
		});
	}
	return {
		moves,
		unchanged
	};
}
function remapOverlayItems(overlay, moves, libraryRoot) {
	if (moves.length === 0) return overlay;
	const map = new Map(moves.map((move) => [move.from, move.to]));
	const items = {};
	for (const [id, item] of Object.entries(overlay.items)) items[map.get(id) ?? id] = item;
	const remapScoped = (roots) => {
		if (!libraryRoot || !roots[libraryRoot]) return roots;
		return {
			...roots,
			[libraryRoot]: Object.fromEntries(Object.entries(roots[libraryRoot]).map(([id, value]) => [map.get(id) ?? id, value]))
		};
	};
	const rootKey = libraryRoot?.replaceAll("\\", "/").replace(/\/+$/, "");
	const hiddenKey = process.platform === "win32" ? rootKey?.toLowerCase() : rootKey;
	const hiddenContents = hiddenKey && overlay.hiddenContents?.[hiddenKey] ? {
		...overlay.hiddenContents,
		[hiddenKey]: overlay.hiddenContents[hiddenKey].map((id) => map.get(id) ?? id)
	} : overlay.hiddenContents;
	return {
		...overlay,
		items,
		...hiddenContents ? { hiddenContents } : {},
		...overlay.videoSelections ? { videoSelections: remapScoped(overlay.videoSelections) } : {},
		...overlay.hiddenVideos ? { hiddenVideos: remapScoped(overlay.hiddenVideos) } : {}
	};
}
async function previewOrganize(libraryRoot, overlay, ids = []) {
	return proposeOrganizeMoves(await scanLibrary(libraryRoot, overlay), ids);
}
async function applyOrganize(libraryRoot, overlay, ids = []) {
	const preview = await previewOrganize(libraryRoot, overlay, ids);
	if (preview.moves.length === 0) return {
		preview,
		overlay
	};
	const staging = join(libraryRoot, STAGING);
	await mkdir(staging, { recursive: true });
	try {
		for (const move of preview.moves) await rename(join(libraryRoot, move.from), join(staging, move.from));
		for (const move of preview.moves) await rename(join(staging, move.from), join(libraryRoot, move.to));
	} catch (cause) {
		for (const move of preview.moves) {
			const staged = join(staging, move.from);
			const original = join(libraryRoot, move.from);
			if (await pathExists(staged) && !await pathExists(original)) await rename(staged, original).catch(() => void 0);
		}
		throw cause;
	} finally {
		await rmdir(staging).catch(() => void 0);
	}
	return {
		preview,
		overlay: remapOverlayItems(overlay, preview.moves, libraryRoot)
	};
}
//#endregion
//#region src/processAlive.ts
function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
function pidCommand(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return void 0;
	try {
		const executable = process.platform === "win32" ? "powershell.exe" : "ps";
		const args = process.platform === "win32" ? [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); (Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`
		] : [
			"-p",
			String(pid),
			"-o",
			"command="
		];
		const command = execFileSync(executable, args, {
			encoding: "utf8",
			timeout: process.platform === "win32" ? 5e3 : 500,
			windowsHide: true
		}).trim();
		return command === "" ? void 0 : command;
	} catch {
		return;
	}
}
function jobPidMatches(pid, fragments) {
	if (pid === void 0) return false;
	if (!pidAlive(pid)) return false;
	const command = pidCommand(pid);
	if (command === void 0) return false;
	return fragments.some((fragment) => command.includes(fragment));
}
function jobPidStillOurs(pid, fragment) {
	return jobPidMatches(pid, [fragment]);
}
async function waitForPidExit(pid, fragments, timeoutMs = 2e3, intervalMs = 50) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!jobPidMatches(pid, fragments)) return true;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return !jobPidMatches(pid, fragments);
}
async function terminateOwnedProcess(pid, fragments, termTimeoutMs = 2e3, killTimeoutMs = 1e3) {
	if (pid === void 0 || !jobPidMatches(pid, fragments)) return true;
	try {
		process.kill(pid, "SIGTERM");
	} catch {}
	await waitForPidExit(pid, fragments, termTimeoutMs);
	if (jobPidMatches(pid, fragments)) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
		await waitForPidExit(pid, fragments, killTimeoutMs);
	}
	return !jobPidMatches(pid, fragments);
}
//#endregion
//#region src/subtitle.ts
function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
function subtitleInstallCommand(skillDir) {
	return `git clone https://github.com/oil-oil/oil-subtitle ${shellQuote(skillDir)} && bash ${shellQuote(join(skillDir, "setup.sh"))}`;
}
async function resolveSubtitleSkill(skillDir = process.env.OIL_SUBTITLE_SKILL ?? defaultSubtitleSkillDir(), platform = process.platform) {
	const root = await stat(skillDir).catch(() => void 0);
	if (root === void 0 || !root.isDirectory()) throw new Error(`未发现 oil-subtitle。执行 ${subtitleInstallCommand(skillDir)} 后重试。`);
	const setup = join(skillDir, "setup.sh");
	const python = await resolveVenvPython(skillDir, platform);
	const preview = join(skillDir, "scripts/preview_editor.py");
	const burn = join(skillDir, "scripts/burn_subtitles.py");
	const prepare = join(skillDir, "scripts/prepare_subtitles.py");
	const review = join(skillDir, "scripts/review_subtitles.py");
	if (python === void 0 || !await pathExists(setup) || !await pathExists(preview) || !await pathExists(burn) || !await pathExists(prepare) || !await pathExists(review)) throw new Error(`已发现 oil-subtitle 目录，但尚未完成 setup.sh。执行 bash "${setup}" 后重试。`);
	return {
		root: skillDir,
		python
	};
}
function parseSrtClock(stamp) {
	const matched = /(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(stamp.trim());
	if (matched === null) return void 0;
	const hours = Number(matched[1]);
	const minutes = Number(matched[2]);
	const seconds = Number(matched[3]);
	const millis = Number((matched[4] ?? "0").padEnd(3, "0").slice(0, 3));
	if (![
		hours,
		minutes,
		seconds,
		millis
	].every((value) => Number.isFinite(value))) return void 0;
	return hours * 3600 + minutes * 60 + seconds + millis / 1e3;
}
function srtToSegments(raw) {
	const blocks = raw.replace(/^\uFEFF/, "").split(/\n{2,}/);
	const segments = [];
	for (const block of blocks) {
		const lines = block.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
		let start;
		let end;
		const texts = [];
		for (const line of lines) {
			const range = /^(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/.exec(line);
			if (range !== null && range[1] !== void 0 && range[2] !== void 0) {
				start = parseSrtClock(range[1]);
				end = parseSrtClock(range[2]);
				continue;
			}
			if (/^\d+$/.test(line)) continue;
			texts.push(line.replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n"));
		}
		const text = texts.join("\n").trim();
		if (text === "" || start === void 0 || end === void 0) continue;
		segments.push({
			start,
			end,
			text
		});
	}
	return segments;
}
function workDirOf(item) {
	if (item.subtitles.transcript !== void 0) return dirname(item.subtitles.transcript);
	const video = currentVideoPath(item);
	const stem = video === void 0 ? item.id : basename(video, extname(video));
	return join(item.folderPath, `${stem}.subtitle-work`);
}
async function uniqueSubtitledPath(folderPath, stem) {
	let name = `${stem}_subtitled.mp4`;
	let suffix = 2;
	while (await pathExists(join(folderPath, name))) {
		name = `${stem}_subtitled-${suffix}.mp4`;
		suffix += 1;
	}
	return join(folderPath, name);
}
async function ensurePreviewTranscript(item) {
	const work = workDirOf(item);
	const preview = join(work, "preview-transcript.json");
	const candidates = [
		item.subtitles.transcript,
		join(work, "subtitle-transcript.json"),
		join(work, "transcript.json"),
		preview
	];
	for (const path of candidates) if (path !== void 0 && await pathExists(path)) return path;
	if (item.subtitles.srt === void 0) throw new Error("no subtitle draft");
	await mkdir(work, { recursive: true });
	const raw = await readFile(item.subtitles.srt, "utf8");
	await writeFile(preview, `${JSON.stringify({ segments: srtToSegments(raw) }, null, 2)}\n`);
	return preview;
}
async function pickPreviewLaunch(item) {
	const video = currentVideoPath(item);
	if (video === void 0) throw new Error("no video to preview");
	const manifest = join(workDirOf(item), "subtitle-manifest.json");
	if (await pathExists(manifest)) return {
		args: [manifest],
		video
	};
	return {
		args: [video, await ensurePreviewTranscript(item)],
		video
	};
}
async function newerOrEqual(left, right) {
	const leftInfo = await stat(left).catch(() => void 0);
	const rightInfo = await stat(right).catch(() => void 0);
	if (leftInfo === void 0) return false;
	if (rightInfo === void 0) return true;
	return leftInfo.mtimeMs >= rightInfo.mtimeMs;
}
async function pickBurnLaunch(item) {
	const video = currentVideoPath(item);
	if (video === void 0) throw new Error("no raw video to burn");
	const stem = basename(video, extname(video));
	const output = await uniqueSubtitledPath(item.folderPath, stem);
	const work = workDirOf(item);
	const preview = join(work, "preview-transcript.json");
	const transcript = item.subtitles.transcript ?? (await pathExists(preview) ? preview : void 0);
	const srt = item.subtitles.srt;
	if (srt !== void 0 && (transcript === void 0 || await newerOrEqual(srt, transcript)) && srt !== void 0) return {
		args: [
			"--video",
			video,
			"--srt-input",
			srt,
			"--output",
			output
		],
		output
	};
	if (transcript !== void 0) {
		const args = [
			"--video",
			video,
			"--transcript",
			transcript,
			"--output",
			output
		];
		const chapters = join(dirname(transcript), "subtitle-chapters.json");
		if (await pathExists(chapters)) args.push("--chapters", chapters);
		return {
			args,
			output
		};
	}
	throw new Error("no subtitle draft");
}
function spawnPython(python, script, args, extraEnv) {
	const env = { ...process.env };
	delete env.DASHSCOPE_API_KEY;
	delete env.ZENMUX_API_KEY;
	delete env.DSH_CREATOR_IMAGE_API_KEY;
	if (extraEnv !== void 0) Object.assign(env, extraEnv);
	return spawn(python, [script, ...args], {
		env,
		stdio: [
			"ignore",
			"ignore",
			"pipe"
		],
		detached: true
	});
}
async function findFreePort(start = 8765, end = 8785) {
	for (let port = start; port < end; port += 1) if (await portIsFree(port)) return port;
	throw new Error("no free preview port");
}
function portIsFree(port) {
	return new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => {
			resolve(false);
		});
		server.listen(port, "127.0.0.1", () => {
			server.close(() => {
				resolve(true);
			});
		});
	});
}
async function waitHttp(url, timeoutMs, signal) {
	const started = Date.now();
	let last;
	while (Date.now() - started < timeoutMs) {
		signal.throwIfAborted();
		try {
			const response = await fetch(url, { signal });
			if (response.ok) return;
			last = response.status;
		} catch (cause) {
			last = cause;
		}
		await sleep$1(200, signal);
	}
	throw new Error(`preview did not start: ${String(last)}`);
}
function sleep$1(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
//#endregion
//#region src/generate.ts
async function resolveCoverSkill(skillDir = process.env.OIL_COVER_SKILL ?? defaultCoverSkillDir(), platform = process.platform) {
	const script = join(skillDir, "scripts/generate_oil_cover.py");
	if (!await pathExists(script)) throw new Error("未安装 oil-cover。执行 git clone https://github.com/oil-oil/oil-cover ~/.agents/skills/oil-cover 后重试。");
	return {
		root: skillDir,
		python: await resolveVenvPython(skillDir, platform) ?? systemPythonCommand(platform),
		script
	};
}
const NOISE_FILE = /^(?:\.DS_Store|Thumbs\.db)$/i;
const NOISE_EXT = /\.(?:tmp|temp|part|crdownload|download)$/i;
function shouldIgnoreWatchName(name) {
	if (name === null || name === "") return false;
	for (const part of name.split(/[\\/]/)) {
		if (part === "" || part === ".") continue;
		if (NOISE_FILE.test(part) || part.startsWith("._")) return true;
		if (part === "node_modules" || part === ".git") return true;
		if (NOISE_EXT.test(part) || part.startsWith("~")) return true;
	}
	return false;
}
function createDebounced(run, waitMs) {
	let timer;
	return {
		trigger() {
			if (timer !== void 0) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = void 0;
				run();
			}, waitMs);
		},
		cancel() {
			if (timer !== void 0) clearTimeout(timer);
			timer = void 0;
		}
	};
}
function startLibraryWatch(options) {
	const debounce = createDebounced(options.onChange, options.debounceMs ?? 500);
	const watchers = [];
	const watchFileSystem = options.watchFileSystem ?? watch;
	const fingerprintOf = options.fingerprint ?? libraryFingerprint;
	let closed = false;
	let polling = false;
	let fingerprint;
	let fallback;
	let startupCheck;
	let ready = Promise.resolve();
	const poll = async () => {
		if (closed || polling) return;
		polling = true;
		try {
			const next = await fingerprintOf(options.libraryRoot, options.overlayPath);
			if (fingerprint !== void 0 && next !== fingerprint) debounce.trigger();
			fingerprint = next;
		} finally {
			polling = false;
		}
	};
	const startFallback = () => {
		if (closed || fallback !== void 0) return;
		if (startupCheck !== void 0) clearTimeout(startupCheck);
		ready = poll();
		fallback = setInterval(() => {
			poll();
		}, options.fallbackMs ?? 4e3);
		fallback.unref?.();
	};
	const attach = (path, recursive, accept, onError) => {
		try {
			const watcher = watchFileSystem(path, {
				persistent: false,
				recursive
			}, (_event, filename) => {
				const name = typeof filename === "string" ? filename : null;
				if (accept !== void 0 && !accept(name)) return;
				if (shouldIgnoreWatchName(name)) return;
				debounce.trigger();
			});
			watcher.on("error", () => {
				onError?.();
			});
			watchers.push(watcher);
			return true;
		} catch {
			return false;
		}
	};
	const recursiveLibraryWatch = attach(options.libraryRoot, true, void 0, startFallback);
	attach(options.libraryRoot, false);
	const overlayName = basename(options.overlayPath);
	const overlayWatch = attach(dirname(options.overlayPath), false, (filename) => filename === null || filename === overlayName, startFallback);
	if (!recursiveLibraryWatch || !overlayWatch) startFallback();
	else {
		ready = poll();
		ready.then(() => {
			if (closed || fallback !== void 0) return;
			startupCheck = setTimeout(() => {
				startupCheck = void 0;
				poll();
			}, options.fallbackMs ?? 4e3);
			startupCheck.unref?.();
		});
	}
	return {
		ready,
		close() {
			closed = true;
			debounce.cancel();
			if (fallback !== void 0) clearInterval(fallback);
			if (startupCheck !== void 0) clearTimeout(startupCheck);
			for (const watcher of watchers) watcher.close();
		}
	};
}
async function libraryFingerprint(libraryRoot, overlayPath) {
	const rows = [];
	const visit = async (directory, prefix) => {
		const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (shouldIgnoreWatchName(relative)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(path, relative);
				continue;
			}
			const info = await stat(path).catch(() => void 0);
			if (info !== void 0) rows.push(`${relative}:${info.size}:${info.mtimeMs}`);
		}
	};
	await visit(libraryRoot, "");
	const overlay = await stat(overlayPath).catch(() => void 0);
	rows.push(`overlay:${overlay?.size ?? -1}:${overlay?.mtimeMs ?? -1}`);
	return rows.join("|");
}
//#endregion
//#region src/previewServers.ts
function previewRegistryPathForDataDir(dataDir) {
	return join(dataDir, "preview-servers.json");
}
function parsePreviewRegistry(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((row) => {
			if (!row || typeof row !== "object") return [];
			const record = row;
			if (typeof record.id !== "string" || record.id.trim() === "") return [];
			if (typeof record.url !== "string" || typeof record.port !== "number") return [];
			if (!Number.isInteger(record.pid)) return [];
			return [{
				id: record.id,
				url: record.url,
				port: record.port,
				pid: record.pid,
				startedAt: typeof record.startedAt === "number" ? record.startedAt : 0
			}];
		});
	} catch {
		return [];
	}
}
function loadPreviewRegistry(filePath) {
	try {
		return parsePreviewRegistry(readFileSync(filePath, "utf8"));
	} catch {
		return [];
	}
}
function savePreviewRegistry(filePath, records) {
	mkdirSync(dirname(filePath), { recursive: true });
	const temp = `${filePath}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`, { mode: 384 });
	renameSync(temp, filePath);
}
function livePreviewRecord(records, id) {
	return records.find((row) => row.id === id && jobPidStillOurs(row.pid, "preview_editor"));
}
function upsertPreviewRecord(filePath, record) {
	const next = loadPreviewRegistry(filePath).filter((row) => row.id !== record.id && pidAlive(row.pid));
	next.push(record);
	savePreviewRegistry(filePath, next);
}
function removePreviewRecord(filePath, id) {
	savePreviewRegistry(filePath, loadPreviewRegistry(filePath).filter((row) => row.id !== id));
}
//#endregion
//#region src/thumbs.ts
function thumbName(id, sourcePath) {
	const digest = createHash("sha1").update(sourcePath).digest("hex").slice(0, 10);
	return `${id.replace(/[^\w.-]+/g, "_")}-${digest}.jpg`;
}
async function coverThumb(dataDir, id, sourcePath) {
	const empty = {
		found: false,
		mime: "",
		base64: ""
	};
	if (sourcePath === void 0) return empty;
	const source = await stat(sourcePath).catch(() => void 0);
	if (source === void 0 || !source.isFile()) return empty;
	const dir = join(dataDir, "thumbs");
	await mkdir(dir, { recursive: true });
	const dest = join(dir, thumbName(id, sourcePath));
	const cached = await stat(dest).catch(() => void 0);
	if (cached === void 0 || cached.mtimeMs < source.mtimeMs) {
		const executable = process.platform === "darwin" ? "sips" : existsSync("C:/ffmpeg/bin/ffmpeg.exe") ? "C:/ffmpeg/bin/ffmpeg.exe" : "ffmpeg";
		const args = process.platform === "darwin" ? [
			"-s",
			"format",
			"jpeg",
			"-Z",
			"360",
			sourcePath,
			"--out",
			dest
		] : [
			"-v",
			"error",
			"-y",
			"-i",
			sourcePath,
			"-frames:v",
			"1",
			"-vf",
			"scale=360:-2",
			dest
		];
		if (spawnSync(executable, args, {
			encoding: "utf8",
			windowsHide: true
		}).status !== 0) return empty;
	}
	try {
		return {
			found: true,
			mime: "image/jpeg",
			base64: (await readFile(dest)).toString("base64")
		};
	} catch {
		return empty;
	}
}
//#endregion
//#region src/articleServe.ts
const IMAGE_MIME = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif"
};
function resolveArticleFile(root, urlPath) {
	let rel = urlPath.split("?")[0] ?? "";
	try {
		rel = decodeURIComponent(rel);
	} catch {
		return;
	}
	rel = rel.replace(/^\/+/, "");
	if (rel === "" || rel.includes("\0")) return void 0;
	const base = resolve(root);
	const candidate = resolve(base, rel);
	if (candidate !== base && !candidate.startsWith(base + sep)) return void 0;
	if (IMAGE_MIME[extname(candidate).toLowerCase()] === void 0) return void 0;
	return candidate;
}
async function startArticleServer(root) {
	const port = await findFreePort(9e3, 9099);
	const server = createServer$1((request, response) => {
		response.setHeader("Access-Control-Allow-Origin", "*");
		if (request.method === "OPTIONS") {
			response.writeHead(204);
			response.end();
			return;
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405);
			response.end();
			return;
		}
		const file = resolveArticleFile(root, request.url ?? "/");
		if (file === void 0) {
			response.writeHead(404);
			response.end();
			return;
		}
		stat(file).then((info) => {
			if (!info.isFile()) {
				response.writeHead(404);
				response.end();
				return;
			}
			const mime = IMAGE_MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
			response.writeHead(200, {
				"Content-Type": mime,
				"Content-Length": info.size,
				"Cache-Control": "private, max-age=3600"
			});
			if (request.method === "HEAD") {
				response.end();
				return;
			}
			createReadStream(file).pipe(response);
		}, () => {
			response.writeHead(404);
			response.end();
		});
	});
	await new Promise((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			resolveListen();
		});
	});
	server.unref();
	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => {
			server.close();
		}
	};
}
//#endregion
//#region src/videoServe.ts
const MIME = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm"
};
function playbackOf(item) {
	const path = currentVideoPath(item);
	return path === void 0 ? void 0 : {
		path,
		kind: "raw"
	};
}
function parseByteRange(header, size) {
	if (header === void 0 || size <= 0) return void 0;
	const matched = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (matched === null) return void 0;
	const rawStart = matched[1] ?? "";
	const rawEnd = matched[2] ?? "";
	if (rawStart === "" && rawEnd === "") return void 0;
	if (rawStart === "") {
		const suffix = Number(rawEnd);
		if (!Number.isFinite(suffix) || suffix <= 0) return void 0;
		return {
			start: Math.max(0, size - suffix),
			end: size - 1
		};
	}
	const start = Number(rawStart);
	const end = rawEnd === "" ? size - 1 : Number(rawEnd);
	if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return;
	return {
		start,
		end: Math.min(end, size - 1)
	};
}
async function startVideoServer(path) {
	if (!(await stat(path)).isFile()) throw new Error("video is not a file");
	const mime = MIME[extname(path).toLowerCase()] ?? "video/mp4";
	const port = await findFreePort(8900, 8999);
	const server = createServer$1((request, response) => {
		(async () => {
			const current = await lstat(path).catch(() => void 0);
			if (current === void 0 || !current.isFile() || current.isSymbolicLink()) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.setHeader("Access-Control-Allow-Origin", "*");
			response.setHeader("Access-Control-Allow-Headers", "Range");
			response.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
			if (request.method === "OPTIONS") {
				response.writeHead(204);
				response.end();
				return;
			}
			if (request.method !== "GET" && request.method !== "HEAD") {
				response.writeHead(405);
				response.end();
				return;
			}
			const range = parseByteRange(request.headers.range, current.size);
			if (range === void 0) {
				response.writeHead(200, {
					"Content-Type": mime,
					"Content-Length": current.size,
					"Accept-Ranges": "bytes"
				});
				if (request.method === "HEAD") {
					response.end();
					return;
				}
				pipeFile(path, response);
				return;
			}
			const length = range.end - range.start + 1;
			response.writeHead(206, {
				"Content-Type": mime,
				"Content-Length": length,
				"Content-Range": `bytes ${range.start}-${range.end}/${current.size}`,
				"Accept-Ranges": "bytes"
			});
			if (request.method === "HEAD") {
				response.end();
				return;
			}
			pipeFile(path, response, range);
		})().catch(() => {
			if (!response.headersSent) response.writeHead(500);
			response.end();
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			resolve();
		});
	});
	server.unref();
	return {
		url: `http://127.0.0.1:${port}/video${extname(path).toLowerCase()}`,
		port,
		close: () => {
			server.close();
		}
	};
}
function pipeFile(path, response, range) {
	const stream = createReadStream(path, range);
	stream.on("error", () => {
		response.destroy();
	});
	response.on("close", () => {
		stream.destroy();
	});
	stream.pipe(response);
}
//#endregion
//#region src/service.ts
const CREATOR_WORKBENCH_SERVICE = "creatorWorkbench";
var CreatorWorkbenchService = class extends TypertRemoteService {
	libraryRoot;
	dataDir;
	subtitleSkillDirConfig;
	coverSkillDirConfig;
	cache;
	cachedScriptRules;
	cachedEnabledPlatforms;
	catalogRevision = 0;
	watchClose;
	watchedRoot;
	imports = new VideoImports();
	covers;
	production;
	importJobs;
	previews = /* @__PURE__ */ new Map();
	videos = /* @__PURE__ */ new Map();
	articles = /* @__PURE__ */ new Map();
	constructor(ctx, config) {
		super(ctx, CREATOR_WORKBENCH_SERVICE);
		this.libraryRoot = resolveUserPath(config.libraryRoot);
		this.dataDir = resolveUserPath(resolveDataDir(config));
		this.subtitleSkillDirConfig = config.subtitleSkillDir;
		this.coverSkillDirConfig = config.coverSkillDir;
		this.production = new ProductionWorkflow({
			dataDir: this.dataDir,
			published: async (scope, record) => {
				if (record.platform === "official-account") return;
				const platform = record.platform;
				await this.patchItem(scope.id, (item) => {
					item.publish ??= {};
					item.publish[platform] = {
						status: "published",
						verifiedAccountId: record.accountId,
						remoteId: record.remoteId,
						...record.url ? { url: record.url } : {},
						...record.syncedAt ? { syncedAt: record.syncedAt } : {}
					};
				}, new AbortController().signal, scope.folderPath);
			},
			platforms: async () => (await loadOverlay(this.dataDir)).profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms,
			resolve: async (scope) => {
				const detail = await this.getContent({ id: scope.id }, new AbortController().signal);
				if (detail.folderPath !== scope.folderPath) throw new Error("资料位置已切换，请重新打开内容。");
				return detail;
			},
			key: (ref) => resolveWorkbenchCredential(this.ctx, ref),
			hasKey: (ref) => workbenchCredentialConfigured(this.ctx, ref),
			setKey: (ref, value) => saveWorkbenchCredential(this.ctx, ref, value),
			jobs: () => this.importJobs,
			changed: () => this.invalidateCatalog()
		});
		this.covers = new CoverWorkflow({
			dataDir: this.dataDir,
			resolve: async (scope) => {
				const detail = await this.getContent({ id: scope.id }, new AbortController().signal);
				if (detail.folderPath !== scope.folderPath) throw new Error("资料位置已切换，请重新打开内容。");
				const { libraryRoot } = await this.scanned();
				return {
					folder: await contentFolder(libraryRoot, detail.folderPath),
					...detail.selectedVideo ? { selectedVideo: detail.selectedVideo } : {},
					title: detail.title,
					script: detail.script,
					transcript: detail.subtitles.srt ? (await readSubtitleText(detail)).slice(0, 3e4) : ""
				};
			},
			key: () => resolveCreatorSecret(this.ctx, "cover"),
			jobs: () => this.importJobs,
			changed: () => this.invalidateCatalog(),
			skill: () => this.coverSkillDir()
		});
		loadOverlay(this.dataDir).then((overlay) => {
			this.rememberOverlay(overlay);
		});
		ctx.effect(() => async () => {
			this.stopWatch();
			this.imports.dispose();
			this.covers.dispose();
			this.production.dispose();
			await this.stopServers();
		}, "creator-workbench: library watch");
	}
	subtitleSkillDir() {
		return resolveSkillDir(this.subtitleSkillDirConfig, "oil-subtitle", process.env.OIL_SUBTITLE_SKILL);
	}
	coverSkillDir() {
		return resolveSkillDir(this.coverSkillDirConfig, "oil-cover", process.env.OIL_COVER_SKILL);
	}
	async stopServers() {
		for (const session of this.videos.values()) session.close();
		this.videos.clear();
		for (const session of this.articles.values()) session.close();
		this.articles.clear();
		const registryPath = previewRegistryPathForDataDir(this.dataDir);
		const recorded = loadPreviewRegistry(registryPath);
		const recordedByPid = new Map(recorded.map((record) => [record.pid, record]));
		const remaining = /* @__PURE__ */ new Map();
		const seen = /* @__PURE__ */ new Set();
		for (const preview of [...this.previews.values(), ...recorded]) {
			if (seen.has(preview.pid)) continue;
			seen.add(preview.pid);
			if (jobPidStillOurs(preview.pid, "preview_editor")) try {
				process.kill(preview.pid, "SIGTERM");
				await waitForPidExit(preview.pid, ["preview_editor"]);
				if (jobPidStillOurs(preview.pid, "preview_editor")) {
					process.kill(preview.pid, "SIGKILL");
					await waitForPidExit(preview.pid, ["preview_editor"], 1e3);
				}
			} catch {}
			if (pidAlive(preview.pid) && (pidCommand(preview.pid) === void 0 || jobPidStillOurs(preview.pid, "preview_editor"))) {
				const record = recordedByPid.get(preview.pid);
				if (record !== void 0) remaining.set(record.id, record);
			}
		}
		this.previews.clear();
		savePreviewRegistry(registryPath, [...remaining.values()]);
	}
	invalidateCatalog() {
		this.cache = void 0;
		this.catalogRevision += 1;
	}
	stopWatch() {
		this.watchClose?.();
		this.watchClose = void 0;
		this.watchedRoot = void 0;
	}
	ensureWatch(libraryRoot) {
		if (this.watchedRoot === libraryRoot && this.watchClose !== void 0) return;
		this.stopWatch();
		this.watchedRoot = libraryRoot;
		try {
			mkdirSync(this.dataDir, { recursive: true });
		} catch {}
		this.watchClose = startLibraryWatch({
			libraryRoot,
			overlayPath: overlayPath(this.dataDir),
			onChange: () => {
				this.invalidateCatalog();
			}
		}).close;
	}
	subtitleSkill() {
		return resolveSubtitleSkill(this.subtitleSkillDir());
	}
	coverSkill() {
		return resolveCoverSkill(this.coverSkillDir());
	}
	async scanned(reconcile = true) {
		return withOverlayLock(this.dataDir, async () => {
			let overlay = await loadOverlay(this.dataDir);
			const libraryRoot = overlay.libraryRoot ?? this.libraryRoot;
			this.rememberOverlay(overlay);
			this.ensureWatch(libraryRoot);
			const reconciled = reconcile ? await reconcileOverlayBurns(overlay) : void 0;
			if (reconciled !== void 0) {
				overlay = reconciled;
				await saveOverlay(this.dataDir, overlay);
				this.invalidateCatalog();
			}
			if (this.cache?.libraryRoot === libraryRoot) return {
				overlay,
				libraryRoot,
				items: this.cache.items
			};
			const items = await Promise.all((await scanLibrary(libraryRoot, overlay)).map((item) => projectProduction(item, this.dataDir)));
			this.cache = {
				libraryRoot,
				items
			};
			return {
				overlay,
				libraryRoot,
				items
			};
		});
	}
	async getRevision(_request, signal) {
		signal.throwIfAborted();
		if (this.watchClose === void 0) await this.scanned();
		return { revision: this.catalogRevision };
	}
	async listContents(request, signal) {
		signal.throwIfAborted();
		const { overlay, libraryRoot, items: scanned } = await this.scanned();
		const hidden = new Set(removedContentIds(overlay, libraryRoot));
		const visible = scanned.filter((item) => !hidden.has(item.id));
		const items = visible.filter((item) => matchesFilter(item, request.filter) && matchesQuery(item, request.query));
		return {
			settings: await this.settingsOf(libraryRoot, overlay),
			items,
			removedItems: scanned.filter((item) => hidden.has(item.id)),
			counts: countsOf(visible),
			revision: this.catalogRevision
		};
	}
	async setContentVisibility(request, signal) {
		await this.projectAction({
			...request,
			action: request.hidden ? "remove" : "join"
		}, signal);
		return this.listContents({
			query: "",
			filter: "all"
		}, signal);
	}
	async projectAction(request, signal) {
		signal.throwIfAborted();
		const { libraryRoot, overlay } = await this.scanned();
		const folder = await contentFolder(request.action === "inspect" ? dirname(request.folderPath) : libraryRoot, request.folderPath);
		if (basename(folder) !== request.id) throw new Error("项目目录已变化，请刷新后重试。");
		if (request.action === "join") {
			await setContentHidden(this.dataDir, libraryRoot, request.id, folder, false);
			this.invalidateCatalog();
			return {
				tasks: [],
				removed: false
			};
		}
		const production = await readState(folder), cover = await readCoverState(folder);
		const tasks = production.tasks.filter((t) => [
			"queued",
			"running",
			"waiting-agent"
		].includes(t.status)).map((t) => t.step ?? {
			upload: "上传视频",
			article: "文章制作",
			asr: "语音转文字",
			metrics: "同步数据",
			wechat: "公众号草稿",
			images: "制作图片"
		}[t.kind]);
		tasks.push(...cover.runs.filter((r) => ["preparing", "running"].includes(r.status) || r.status === "waiting_agent" && Boolean(r.deliveredAt || r.frames.length)).map((r) => r.status === "waiting_agent" ? "封面制作请求" : "封面制作"));
		const imports = [...this.imports.tasks.values()].filter((t) => t.folder === folder && t.state.status === "running");
		tasks.push(...imports.map(() => "导入视频"));
		if (request.action === "inspect") return {
			tasks,
			removed: removedContentIds(overlay, dirname(folder)).includes(request.id)
		};
		if (tasks.length && !request.cancelTasks) throw new Error("项目仍有任务，请确认‘取消任务并移除’。");
		await setContentHidden(this.dataDir, libraryRoot, request.id, folder, true);
		this.invalidateCatalog();
		for (const task of this.production.active.values()) if (task.folder === folder) task.controller.abort();
		this.covers.active.get(folder)?.controller.abort();
		for (const task of imports) task.controller.abort();
		const stoppingDeadline = Date.now() + 1e4;
		const stillRunning = () => [...this.production.active.values()].some((task) => task.folder === folder) || this.covers.active.has(folder) || imports.some((task) => task.state.status === "running");
		while (stillRunning() && Date.now() < stoppingDeadline) {
			signal.throwIfAborted();
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		if (stillRunning()) throw new Error("项目已停止接收新任务，部分本地任务尚未确认结束。请稍后重试移除；现有文件和远端结果保留。");
		await updateState(folder, (state) => {
			for (const task of state.tasks) if ([
				"queued",
				"running",
				"waiting-agent"
			].includes(task.status)) {
				task.status = task.status === "running" && (task.kind === "upload" || task.kind === "wechat") ? "unconfirmed" : "cancelled";
				task.error = "项目已移除；已完成文件保留，远端结果未撤回。";
				task.updatedAt = Date.now();
			}
		});
		await coverLock(folder, async () => {
			const state = await readCoverState(folder);
			for (const run of state.runs) if ([
				"waiting_agent",
				"preparing",
				"running"
			].includes(run.status)) {
				run.status = this.covers.active.has(folder) ? "unconfirmed" : "cancelled";
				run.updatedAt = Date.now();
			}
			await writeCoverState(folder, state);
		});
		this.videos.get(request.id)?.close();
		this.videos.delete(request.id);
		this.invalidateCatalog();
		return {
			tasks,
			removed: true
		};
	}
	async restoreProjectSession(request, signal) {
		const detail = await this.getContent({ id: request.id }, signal);
		const folder = await contentFolder(dirname(detail.folderPath), request.folderPath);
		if (await realpath(detail.folderPath) !== await realpath(folder)) throw new Error("项目位置已变化，请刷新后重新加入。");
		await restoreProjectSessionMembership(this.ctx, folder, request.sessionId, signal);
		return {};
	}
	async getContent(request, signal) {
		signal.throwIfAborted();
		const catalog = await this.scanned();
		if (removedContentIds(catalog.overlay, catalog.libraryRoot).includes(request.id)) throw new Error("此项目已从工作台移除，请通过‘使用已有目录’重新加入。");
		const found = await this.find(request.id);
		const item = found ? await projectProduction(found, this.dataDir) : void 0;
		if (item === void 0) throw new Error(`content not found: ${request.id}`);
		return {
			...item,
			publishCopy: await readPublishCopy(item.folderPath),
			topicNote: await readTopicNote(item.folderPath),
			script: await readScript(item.folderPath),
			article: await readArticle(item.articlePath),
			secrets: await describeCreatorSecrets(this.ctx)
		};
	}
	async getCoverThumb(request, signal) {
		signal.throwIfAborted();
		const folderId = request.id.split("::")[0] ?? request.id;
		const ratio = request.id.split("::")[1];
		const item = await this.find(folderId);
		const path = ratio === "3x4" || ratio === "4x3" || ratio === "16x9" ? item?.covers[ratio] : item === void 0 ? void 0 : coverPathOf(item);
		return coverThumb(this.dataDir, request.id, path);
	}
	async getVideoPlayback(request, signal) {
		signal.throwIfAborted();
		const item = await this.find(request.id);
		const picked = item === void 0 ? void 0 : playbackOf(item);
		if (picked === void 0) return {
			found: false,
			url: "",
			kind: "raw"
		};
		const existing = this.videos.get(request.id);
		if (existing !== void 0 && existing.path === picked.path) return {
			found: true,
			url: existing.url,
			kind: picked.kind
		};
		existing?.close();
		const session = await startVideoServer(picked.path);
		this.videos.set(request.id, {
			url: session.url,
			path: picked.path,
			close: session.close
		});
		return {
			found: true,
			url: session.url,
			kind: picked.kind
		};
	}
	async getArticleMedia(request, signal) {
		signal.throwIfAborted();
		const item = await this.getContent(request, signal);
		if (item?.articlePath === void 0) return {
			found: false,
			origin: ""
		};
		const root = dirname(item.articlePath);
		const existing = this.articles.get(request.id);
		if (existing !== void 0 && existing.root === root) return {
			found: true,
			origin: existing.origin
		};
		existing?.close();
		const session = await startArticleServer(root);
		this.articles.set(request.id, {
			origin: session.origin,
			root,
			close: session.close
		});
		return {
			found: true,
			origin: session.origin
		};
	}
	async getSubtitleText(request, signal) {
		signal.throwIfAborted();
		const found = await this.find(request.id);
		const item = found ? await projectProduction(found, this.dataDir) : void 0;
		if (item === void 0) return {
			text: "",
			cues: []
		};
		const cues = await readSubtitleCues(item);
		return {
			text: cues.length > 0 ? cues.map((cue) => cue.text).join("\n") : await readSubtitleText(item),
			cues
		};
	}
	async openContentPath(request, signal) {
		signal.throwIfAborted();
		const overlay = await loadOverlay(this.dataDir);
		const root = await realpath(overlay.libraryRoot ?? this.libraryRoot);
		const target = await realpath(request.path);
		const inside = relative(root, target);
		if (inside === ".." || inside.startsWith("../") || inside.startsWith("..\\") || isAbsolute(inside)) throw new Error("只能打开当前资料目录里的文件。");
		signal.throwIfAborted();
		await openExternalPath(target);
		return {};
	}
	async getSettings(_request, signal) {
		signal.throwIfAborted();
		const overlay = await loadOverlay(this.dataDir);
		this.rememberOverlay(overlay);
		return this.settingsOf(overlay.libraryRoot ?? this.libraryRoot, overlay);
	}
	async setLibraryRoot(request, signal) {
		signal.throwIfAborted();
		const libraryRoot = resolveUserPath(request.path);
		const info = await stat(libraryRoot).catch(() => void 0);
		if (info === void 0 || !info.isDirectory()) throw new Error(`library root is not a directory: ${libraryRoot}`);
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
	async setProfile(request, signal) {
		signal.throwIfAborted();
		return withOverlayLock(this.dataDir, async () => {
			const overlay = await loadOverlay(this.dataDir);
			overlay.profile = { enabledPlatforms: normalizeEnabledPlatforms(request.profile.enabledPlatforms) };
			await saveOverlay(this.dataDir, overlay);
			this.rememberOverlay(overlay);
			this.invalidateCatalog();
			return this.settingsOf(overlay.libraryRoot ?? this.libraryRoot, overlay);
		});
	}
	async setScriptRules(request, signal) {
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
	async getCreatorGuide(signal) {
		signal.throwIfAborted();
		const status = await this.getCreatorSetupStatus(signal);
		return {
			guide: creatorGuideText(status),
			status
		};
	}
	async getCapabilities(_request, signal) {
		signal.throwIfAborted();
		return { capabilities: (await this.getCreatorSetupStatus(signal)).capabilities };
	}
	async getCreatorSetupStatus(signal) {
		signal.throwIfAborted();
		const settings = await this.getSettings({}, signal);
		return inspectCreatorSetup({
			libraryRoot: settings.libraryRoot,
			dataDir: this.dataDir,
			subtitleSkillDir: this.subtitleSkillDir(),
			coverSkillDir: this.coverSkillDir(),
			settings
		});
	}
	async configureCreator(request, signal) {
		signal.throwIfAborted();
		const proposal = {};
		if (request.libraryRoot !== void 0) proposal.libraryRoot = resolveUserPath(request.libraryRoot);
		if (request.enabledPlatforms !== void 0) proposal.enabledPlatforms = normalizeEnabledPlatforms(request.enabledPlatforms);
		if (!request.apply || Object.keys(proposal).length === 0) return {
			applied: false,
			proposal,
			status: await this.getCreatorSetupStatus(signal)
		};
		if (proposal.libraryRoot !== void 0) {
			const info = await stat(proposal.libraryRoot).catch(() => void 0);
			if (info === void 0 || !info.isDirectory()) throw new Error(`library root is not a directory: ${proposal.libraryRoot}`);
		}
		await withOverlayLock(this.dataDir, async () => {
			const overlay = await loadOverlay(this.dataDir);
			if (proposal.libraryRoot !== void 0) overlay.libraryRoot = proposal.libraryRoot;
			const profile = overlay.profile ?? emptyProfile();
			if (proposal.enabledPlatforms !== void 0) profile.enabledPlatforms = [...proposal.enabledPlatforms];
			overlay.profile = profile;
			await saveOverlay(this.dataDir, overlay);
			this.rememberOverlay(overlay);
			if (proposal.libraryRoot !== void 0) {
				this.libraryRoot = proposal.libraryRoot;
				this.stopWatch();
			}
			this.invalidateCatalog();
		});
		return {
			applied: true,
			proposal,
			status: await this.getCreatorSetupStatus(signal)
		};
	}
	async setTopicNote(request, signal) {
		signal.throwIfAborted();
		const item = await this.find(request.id);
		if (item === void 0) throw new Error(`content not found: ${request.id}`);
		await writeTopicNote(item.folderPath, request.text);
		return this.getContent({ id: request.id }, signal);
	}
	async setScript(request, signal) {
		signal.throwIfAborted();
		const item = await this.find(request.id);
		if (item === void 0) throw new Error(`content not found: ${request.id}`);
		if (request.folderPath !== void 0 && request.folderPath !== item.folderPath) throw new Error("资料位置已切换，脚本草稿已保留，请重新打开对应内容。");
		signal.throwIfAborted();
		await writeScript(item.folderPath, request.text);
		return this.getContent({ id: request.id }, signal);
	}
	async organizeLibrary(request, signal) {
		signal.throwIfAborted();
		const overlay = await loadOverlay(this.dataDir);
		const libraryRoot = overlay.libraryRoot ?? this.libraryRoot;
		if (!request.apply) return previewOrganize(libraryRoot, overlay, request.ids);
		if ([...this.covers.active.keys()].some((folder) => dirname(folder) === libraryRoot)) throw new Error("资料库中有封面任务正在运行，请等待或取消后再整理目录。");
		const result = await applyOrganize(libraryRoot, overlay, request.ids);
		await withOverlayLock(this.dataDir, async () => {
			const latest = await loadOverlay(this.dataDir);
			await saveOverlay(this.dataDir, remapOverlayItems(latest, result.preview.moves, libraryRoot));
		});
		this.invalidateCatalog();
		return result.preview;
	}
	async refreshCatalog(_request, signal) {
		this.invalidateCatalog();
		return this.listContents({
			query: "",
			filter: "all"
		}, signal);
	}
	async createContent(request, signal) {
		signal.throwIfAborted();
		const overlay = await loadOverlay(this.dataDir);
		const libraryRoot = request.libraryRoot === void 0 ? overlay.libraryRoot : resolveUserPath(request.libraryRoot);
		if (libraryRoot === void 0) throw new Error("请先在内容工作台的系统目录选择器中确认资料位置。");
		const created = await createContentFolder(libraryRoot, request.title);
		this.invalidateCatalog();
		return created;
	}
	async setPublish(request, signal) {
		signal.throwIfAborted();
		if (!((await loadOverlay(this.dataDir)).profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms).includes(request.platform)) throw new Error(`publish platform is disabled: ${request.platform}`);
		return this.patchItem(request.id, (item) => {
			item.publish = patchOverlayPublish(item.publish, request.platform, request.status, request.url);
		}, signal, request.folderPath);
	}
	async syncPublish(request, signal) {
		signal.throwIfAborted();
		const enabled = (await loadOverlay(this.dataDir)).profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms;
		if (request.platform && !enabled.includes(request.platform)) throw new Error(`publish platform is disabled: ${request.platform}`);
		const platforms = request.platform ? [request.platform] : enabled;
		const { items } = await this.scanned();
		const targets = request.id ? items.filter((item) => item.id === request.id) : items;
		if (request.id && !targets.length) throw new Error(`content not found: ${request.id}`);
		const result = {
			matched: 0,
			platforms: []
		};
		for (const platform of platforms) {
			let count = 0;
			const errors = [];
			for (const item of targets) {
				const startedAt = Date.now(), scope = {
					id: item.id,
					folderPath: item.folderPath
				};
				const task = [...(await this.production.action({
					...scope,
					action: "refresh-metrics",
					platform
				}, signal)).tasks].reverse().find((row) => row.kind === "metrics");
				while (task && this.production.active.has(task.id) && Date.now() - startedAt < 185e3) {
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
			result.platforms.push({
				platform,
				count,
				...errors.length ? { error: errors.join("；") } : {}
			});
		}
		this.invalidateCatalog();
		return result;
	}
	async openSubtitlePreview(request, signal) {
		signal.throwIfAborted();
		const item = await this.find(request.id);
		if (item === void 0) throw new Error(`content not found: ${request.id}`);
		const registryPath = previewRegistryPathForDataDir(this.dataDir);
		const recorded = livePreviewRecord(loadPreviewRegistry(registryPath), request.id);
		const existing = this.previews.get(request.id);
		const reusable = existing !== void 0 && jobPidMatches(existing.pid, ["preview_editor"]) ? existing : recorded;
		if (reusable !== void 0) {
			this.previews.set(request.id, reusable);
			await openExternalPath(reusable.url);
			return {
				url: reusable.url,
				port: reusable.port
			};
		}
		const skill = await this.subtitleSkill();
		const launch = await pickPreviewLaunch(item);
		const port = await findFreePort();
		const child = spawnPython(skill.python, join(skill.root, "scripts/preview_editor.py"), launch.args, { PREVIEW_EDITOR_PORT: String(port) });
		const pid = child.pid;
		if (pid === void 0) throw new Error("preview failed to start");
		child.unref();
		const url = `http://127.0.0.1:${port}`;
		const record = {
			url,
			port,
			pid,
			id: request.id,
			startedAt: Date.now()
		};
		this.previews.set(request.id, record);
		upsertPreviewRecord(registryPath, record);
		try {
			await waitHttp(url, 8e3, signal);
		} catch (cause) {
			try {
				await terminateOwnedProcess(pid, ["preview_editor"]);
			} catch {}
			try {
				this.previews.delete(request.id);
			} finally {
				removePreviewRecord(registryPath, request.id);
			}
			throw cause;
		}
		await openExternalPath(url);
		return {
			url,
			port
		};
	}
	async startSubtitleBurn(request, signal) {
		signal.throwIfAborted();
		const item = await this.find(request.id);
		if (item === void 0) throw new Error(`content not found: ${request.id}`);
		if (item.burn.status === "running" && jobPidMatches(item.burn.pid, ["burn_subtitles.py"])) return this.getContent({ id: request.id }, signal);
		const skill = await this.subtitleSkill();
		const launch = await pickBurnLaunch(item);
		const child = spawnPython(skill.python, join(skill.root, "scripts/burn_subtitles.py"), launch.args);
		const pid = child.pid;
		if (pid === void 0) throw new Error("burn failed to start");
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr = `${stderr}${String(chunk)}`.slice(-4e3);
		});
		const startedAt = Date.now();
		child.once("exit", (code) => {
			const burn = code === 0 ? {
				status: "done",
				startedAt,
				output: launch.output
			} : {
				status: "error",
				startedAt,
				output: launch.output,
				error: stderr.trim() === "" ? `burn failed: ${code}` : stderr.trim()
			};
			this.patchItem(request.id, (next) => {
				next.burn = burn;
			}, new AbortController().signal).catch(() => void 0);
		});
		child.unref();
		return this.patchItem(request.id, (next) => {
			next.burn = {
				status: "running",
				startedAt,
				output: launch.output,
				pid
			};
		}, signal);
	}
	async startSubtitleGenerate(request, signal) {
		signal.throwIfAborted();
		const detail = await this.getContent(request, signal);
		await this.production.action({
			id: request.id,
			folderPath: detail.folderPath,
			action: "transcribe"
		}, signal);
		return this.getContent(request, signal);
	}
	async getProductionSettings(_request, signal) {
		signal.throwIfAborted();
		return this.production.settings();
	}
	async productionSettingsAction(request, signal) {
		return this.production.settingsAction(request, signal);
	}
	async getProjectView(request, signal) {
		signal.throwIfAborted();
		const { libraryRoot, overlay, items } = await this.scanned(false);
		if (removedContentIds(overlay, libraryRoot).includes(request.id)) throw new Error("项目已移除，请明确重新加入。");
		const item = items.find((item) => item.id === request.id);
		if (!item || request.folderPath && await realpath(request.folderPath) !== await realpath(item.folderPath)) throw new Error("项目位置已变化，请重新打开。");
		const config = await readSettings(this.dataDir);
		const accountIds = Object.fromEntries(Object.entries(config.accounts).map(([p, a]) => [p, a?.id]));
		if (config.wechat.appid) accountIds["official-account"] = config.wechat.appid;
		return {
			...await queryProject(item, () => this.covers.load(item.folderPath)),
			accountIds,
			settingsRevision: config.revision
		};
	}
	async reconcileProject(request, signal) {
		await this.getProjectView(request, signal);
		await this.production.reconcile(request);
		await this.covers.state(request);
		return {};
	}
	async getPublicationContent(request, signal) {
		const view = await this.getProjectView(request, signal);
		const full = await readState(view.detail.folderPath);
		const publication = full.publications?.find((p) => p.id === request.publicationId && !p.hidden);
		if (!publication || publication.revision !== request.revision) throw new Error("发布材料已变化，请重新读取。");
		const result = (await hydrateCreations(request.folderPath, {
			...full,
			publications: [publication]
		})).publications[0];
		if (publication.source?.articleId && view.production.articles.some((a) => a.parentArticleId === publication.source.articleId)) result.sourceChanged = true;
		return result;
	}
	async readArticleSource(request, signal) {
		const view = await this.getProjectView(request, signal);
		return articleSource(view.detail.folderPath, request.articleId, view.detail.articlePath);
	}
	async previewArticleDraft(request, signal) {
		const view = await this.getProjectView(request, signal), settings = await readSettings(this.dataDir);
		return previewArticleEdit(this.dataDir, view.detail.folderPath, request, settings.wechat.theme, signal, view.detail.articlePath);
	}
	async saveArticleRevision(request, signal) {
		const view = await this.getProjectView(request, signal), settings = await readSettings(this.dataDir);
		const saved = await saveArticleRevision(this.dataDir, view.detail.folderPath, request, settings.wechat.theme, signal, () => this.getProjectView(request, signal), view.detail.articlePath);
		this.invalidateCatalog();
		return saved;
	}
	async getProductionState(request, signal) {
		signal.throwIfAborted();
		return this.production.state(request);
	}
	async getCreationImage(request, signal) {
		await this.production.host.resolve(request);
		signal.throwIfAborted();
		const { image, file } = await creationImage(request.folderPath, request.imageId);
		return {
			mime: image.mime,
			base64: (await readFile(file)).toString("base64")
		};
	}
	async getCreationText(request, signal) {
		const detail = await this.production.host.resolve(request), state = await readState(detail.folderPath);
		signal.throwIfAborted();
		const file = await inside(detail.folderPath, request.file);
		const allowed = [
			...state.articles.map((a) => a.file),
			...(state.publications ?? []).map((p) => p.bodyFile),
			...detail.articlePath ? [detail.articlePath] : []
		];
		if (!(await Promise.all(allowed.map((name) => inside(detail.folderPath, name).catch(() => "")))).includes(file)) throw new Error("请选择本项目已登记的正文。");
		return { text: await readFile(file, "utf8") };
	}
	async productionAction(request, signal) {
		return this.production.action(request, signal);
	}
	async getProductionPreview(request, signal) {
		signal.throwIfAborted();
		return this.production.preview(request, request, signal);
	}
	async startCoverGenerate(_request, _signal) {
		throw new Error("请使用‘让 Agent 制作封面’；由 Harness 当前 Agent 分析后调用新的封面工具。");
	}
	async getCoverState(request, signal) {
		signal.throwIfAborted();
		return this.covers.state(request);
	}
	async coverAction(request, signal) {
		return this.covers.action(request, signal);
	}
	async getCoverImage(request, signal) {
		signal.throwIfAborted();
		return this.covers.image(request, request.versionId);
	}
	async getImageSettings(_request, signal) {
		signal.throwIfAborted();
		return readImageSettings(this.dataDir);
	}
	async setImageSettings(request, signal) {
		signal.throwIfAborted();
		return saveImageSettings(this.dataDir, request);
	}
	async beginImageUpdate(request, signal) {
		signal.throwIfAborted();
		return beginImageUpdate(this.dataDir, request);
	}
	async completeImageUpdate(request, signal) {
		signal.throwIfAborted();
		if (!await resolveCreatorSecret(this.ctx, "cover")) throw new Error("请先保存生图 API Key。");
		return completeImageUpdate(this.dataDir, request.token, request.keyUpdated);
	}
	async checkImageService(_request, signal) {
		const settings = await readImageSettings(this.dataDir);
		const key = await resolveCreatorSecret(this.ctx, "cover");
		if (!key) throw new Error("请先保存生图 API Key。");
		const latest = await readImageSettings(this.dataDir);
		if (settings.pending || latest.pending || settings.revision !== latest.revision) throw new Error("生图设置更新未完成或已变化，请先保存。");
		try {
			const result = await checkImageConnection(settings, key, signal);
			return saveImageCheck(this.dataDir, result);
		} catch (error) {
			throw new Error(safeImageError(error, key));
		}
	}
	async startChainedJob(id, field, launch, signal) {
		const first = launch.steps[0];
		if (first === void 0) throw new Error(`${field} has no steps`);
		const finalOutput = launch.steps[launch.steps.length - 1]?.output ?? first.output;
		const startedAt = Date.now();
		const runStep = (index) => {
			const step = launch.steps[index];
			if (step === void 0) throw new Error(`${field} step missing`);
			const child = spawnPython(launch.python, step.script, step.args, envForGenerateStep(step.env, launch.env));
			const pid = child.pid;
			if (pid === void 0) throw new Error(`${field} failed to start`);
			let stderr = "";
			child.stderr?.on("data", (chunk) => {
				stderr = `${stderr}${String(chunk)}`.slice(-4e3);
			});
			child.once("exit", (code) => {
				if (code !== 0) {
					const job = {
						status: "error",
						startedAt,
						output: step.output,
						error: stderr.trim() === "" ? `${field} failed: ${code}` : stderr.trim()
					};
					this.patchItem(id, (next) => {
						next[field] = job;
					}, new AbortController().signal).catch(() => void 0);
					return;
				}
				if (launch.steps[index + 1] !== void 0) {
					try {
						const nextPid = runStep(index + 1);
						this.patchItem(id, (next) => {
							next[field] = {
								status: "running",
								startedAt,
								output: finalOutput,
								pid: nextPid
							};
						}, new AbortController().signal).catch(() => void 0);
					} catch (cause) {
						const message = cause instanceof Error ? cause.message : `${field} failed`;
						this.patchItem(id, (next) => {
							next[field] = {
								status: "error",
								startedAt,
								output: step.output,
								error: message
							};
						}, new AbortController().signal).catch(() => void 0);
					}
					return;
				}
				this.patchItem(id, (next) => {
					next[field] = {
						status: "done",
						startedAt,
						output: finalOutput
					};
				}, new AbortController().signal).then(() => {
					if (field !== "subtitleJob") return;
					return this.openSubtitlePreview({ id }, new AbortController().signal);
				}, () => void 0).catch(() => void 0);
			});
			child.unref();
			return pid;
		};
		const pid = runStep(0);
		return this.patchItem(id, (next) => {
			next[field] = {
				status: "running",
				startedAt,
				output: finalOutput,
				pid
			};
		}, signal);
	}
	async startTrackedJob(id, field, launch, signal) {
		const child = spawnPython(launch.python, launch.script, launch.args, launch.env);
		const pid = child.pid;
		if (pid === void 0) throw new Error(`${field} failed to start`);
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr = `${stderr}${String(chunk)}`.slice(-4e3);
		});
		const startedAt = Date.now();
		child.once("exit", (code) => {
			const job = code === 0 ? {
				status: "done",
				startedAt,
				output: launch.output
			} : {
				status: "error",
				startedAt,
				output: launch.output,
				error: stderr.trim() === "" ? `${field} failed: ${code}` : stderr.trim()
			};
			this.patchItem(id, (next) => {
				next[field] = job;
			}, new AbortController().signal).catch(() => void 0);
		});
		child.unref();
		return this.patchItem(id, (next) => {
			next[field] = {
				status: "running",
				startedAt,
				output: launch.output,
				pid
			};
		}, signal);
	}
	async waitForMediaJob(id, field, signal) {
		while (true) {
			signal.throwIfAborted();
			const job = (await this.getContent({ id }, signal))[field];
			if (job.status !== "running") return job;
			await sleep(400, signal);
		}
	}
	async cancelMediaJob(id, field) {
		const signal = new AbortController().signal;
		const detail = await this.getContent({ id }, signal);
		if (field === "subtitleJob" && this.production) {
			const task = [...(await this.production.state({
				id,
				folderPath: detail.folderPath
			})).tasks].reverse().find((row) => row.kind === "asr" && ["running", "queued"].includes(row.status));
			if (task) {
				await this.production.action({
					id,
					folderPath: detail.folderPath,
					action: "cancel",
					taskId: task.id
				}, signal);
				return;
			}
		}
		const job = detail[field];
		if (job.status !== "running") return;
		await terminateOwnedProcess(job.pid, JOB_COMMAND[field]);
		await this.patchItem(id, (next) => {
			const current = next[field];
			if (current?.status !== "running" || current.pid !== job.pid) return;
			next[field] = {
				status: "error",
				...current.startedAt === void 0 ? {} : { startedAt: current.startedAt },
				...current.output === void 0 ? {} : { output: current.output },
				error: "cancelled"
			};
		}, signal);
	}
	async find(id) {
		const { items, overlay, libraryRoot } = await this.scanned();
		if (removedContentIds(overlay, libraryRoot).includes(id)) return void 0;
		return items.find((item) => item.id === id);
	}
	async saveVideoSelection(libraryRoot, id, name, allowRestore = true) {
		await withOverlayLock(this.dataDir, async () => {
			const overlay = await loadOverlay(this.dataDir);
			if (removedContentIds(overlay, libraryRoot).includes(id)) throw new Error("项目已移除，导入文件保留但未更改选择。");
			if (!allowRestore && ((overlay.libraryRoot ?? this.libraryRoot) !== libraryRoot || overlay.hiddenVideos?.[libraryRoot]?.[id]?.some((n) => sameVideoName(n, name, process.platform === "win32")))) throw new Error("资料库或视频可见性已变化，请刷新后重选。");
			overlay.videoSelections ??= {};
			overlay.videoSelections[libraryRoot] ??= {};
			overlay.videoSelections[libraryRoot][id] = name;
			const hidden = overlay.hiddenVideos?.[libraryRoot]?.[id];
			if (hidden) overlay.hiddenVideos[libraryRoot][id] = hidden.filter((n) => !sameVideoName(n, name, process.platform === "win32"));
			await saveOverlay(this.dataDir, overlay);
			this.invalidateCatalog();
		});
	}
	async selectVideo(request, signal) {
		signal.throwIfAborted();
		const { libraryRoot, items } = await this.scanned();
		const item = items.find((entry) => entry.id === request.id);
		if (item === void 0) throw new Error("内容已找不到，请刷新片库。");
		if (item.folderPath !== request.folderPath) throw new Error("资料库已切换，请重新打开对应内容。");
		const folder = await contentFolder(libraryRoot, item.folderPath);
		if (!item.videos?.some((v) => sameVideoName(v.name, request.name, process.platform === "win32"))) throw new Error("请先恢复这个视频，再选择使用。");
		await videoFile(folder, request.name);
		signal.throwIfAborted();
		await this.saveVideoSelection(libraryRoot, request.id, request.name, false);
		return this.getContent({ id: request.id }, signal);
	}
	async setVideoVisibility(request, signal) {
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
			overlay.hiddenVideos ??= {};
			overlay.hiddenVideos[libraryRoot] ??= {};
			if ((overlay.libraryRoot ?? this.libraryRoot) !== libraryRoot) throw new Error("资料库已切换，请重新打开。");
			const names = overlay.hiddenVideos[libraryRoot][request.id] ?? [];
			const selected = resolveVideoSelection([...item.videos ?? [], ...(item.hiddenVideos ?? []).filter((v) => !v.missing)].filter((v) => !names.some((n) => sameVideoName(n, v.name, process.platform === "win32"))), overlay.videoSelections?.[libraryRoot]?.[request.id]).selectedVideo;
			overlay.hiddenVideos[libraryRoot][request.id] = [...names.filter((n) => !sameVideoName(n, request.name, process.platform === "win32")), ...request.hidden ? [request.name] : []];
			if (request.hidden && selected && sameVideoName(selected, request.name, process.platform === "win32")) {
				overlay.videoSelections ??= {};
				overlay.videoSelections[libraryRoot] ??= {};
				overlay.videoSelections[libraryRoot][request.id] = null;
			}
			await saveOverlay(this.dataDir, overlay);
			this.invalidateCatalog();
		});
		return this.getContent({ id: request.id }, signal);
	}
	async startVideoImport(request, signal) {
		signal.throwIfAborted();
		const { libraryRoot, items } = await this.scanned();
		const item = items.find((entry) => entry.id === request.id);
		if (item === void 0) throw new Error("内容已找不到，请刷新片库。");
		if (item.folderPath !== request.folderPath) throw new Error("资料库已切换，请重新打开对应内容。");
		await contentFolder(libraryRoot, item.folderPath);
		const source = await realpath(request.sourcePath).catch(() => "");
		let existing;
		for (const candidate of item.hiddenVideos ?? []) {
			const actual = await realpath(candidate.path).catch(() => "");
			if (!candidate.missing && actual && source && sameVideoName(actual, source, process.platform === "win32")) {
				existing = candidate;
				break;
			}
		}
		if (existing && (!request.name || sameVideoName(existing.name, request.name, process.platform === "win32"))) {
			await this.setVideoVisibility({
				id: request.id,
				name: existing.name,
				folderPath: item.folderPath,
				hidden: false
			}, signal);
			await this.saveVideoSelection(libraryRoot, request.id, existing.name);
			return {
				token: `restored-${Date.now()}`,
				id: request.id,
				name: existing.name,
				status: "completed"
			};
		}
		signal.throwIfAborted();
		if (this.importJobs === void 0) throw new Error("后台任务服务尚未就绪，请等待工作台加载完成后重试。");
		return this.imports.start(this.importJobs, {
			...request,
			folder: item.folderPath,
			libraryRoot
		}, async (name) => {
			await this.saveVideoSelection(libraryRoot, request.id, name);
		});
	}
	async getVideoImport(request, signal) {
		signal.throwIfAborted();
		return this.imports.get(request.token);
	}
	async cancelVideoImport(request, signal) {
		signal.throwIfAborted();
		return this.imports.cancel(request.token);
	}
	rememberOverlay(overlay) {
		this.cachedScriptRules = overlay.scriptRules;
		this.cachedEnabledPlatforms = overlay.profile?.enabledPlatforms ?? emptyProfile().enabledPlatforms;
	}
	async settingsOf(libraryRoot, overlay) {
		return {
			libraryRoot,
			libraryConfirmed: overlay.libraryRoot !== void 0,
			profile: overlay.profile ?? emptyProfile(),
			secrets: await describeCreatorSecrets(this.ctx),
			...overlay.scriptRules === void 0 ? {} : { scriptRules: overlay.scriptRules }
		};
	}
	async patchItem(id, mutate, signal, expectedFolder) {
		await withOverlayLock(this.dataDir, async () => {
			const overlay = await loadOverlay(this.dataDir);
			const root = overlay.libraryRoot ?? this.libraryRoot;
			if (removedContentIds(overlay, root).includes(id)) throw new Error("项目已移除，请重新加入后操作。");
			if (expectedFolder && basename(await contentFolder(root, expectedFolder)) !== id) throw new Error("资料位置已变化，结果未写回。");
			const next = { ...overlay.items[id] ?? {} };
			mutate(next);
			overlay.items[id] = next;
			await saveOverlay(this.dataDir, overlay);
			this.invalidateCatalog();
		});
		return this.getContent({ id }, signal);
	}
};
function resolveUserPath(path) {
	const expanded = expandHomePath(path);
	if (!isAbsolute(expanded)) throw new Error(`path must be absolute: ${path}`);
	return expanded;
}
function envForGenerateStep(kind, env) {
	const key = kind === "subtitle" ? "DASHSCOPE_API_KEY" : kind === "cover" ? "DSH_CREATOR_IMAGE_API_KEY" : void 0;
	if (key === void 0 || env === void 0 || env[key] === void 0) return void 0;
	return { [key]: env[key] };
}
const JOB_FIELDS = [
	"burn",
	"subtitleJob",
	"coverJob"
];
const JOB_COMMAND = {
	burn: ["burn_subtitles.py"],
	subtitleJob: [
		"bailian_transcribe.py",
		"review_subtitles.py",
		"prepare_subtitles.py"
	],
	coverJob: ["generate_oil_cover.py"]
};
function jobStarted(job) {
	return job.startedAt === void 0 ? {} : { startedAt: job.startedAt };
}
async function settleFinishedJob(job, field) {
	const output = job.output;
	const started = jobStarted(job);
	if (output !== void 0 && await pathExists(output)) return {
		status: "done",
		...started,
		output
	};
	return {
		status: "error",
		...started,
		...output === void 0 ? {} : { output },
		error: `${field} process exited`
	};
}
function recoverSubtitleJob(item, job) {
	if (job.status !== "error" || job.error !== "subtitleJob process exited") return void 0;
	const burn = item.burn;
	if (burn?.status === "running" && burn.pid !== void 0 && jobPidMatches(burn.pid, JOB_COMMAND.burn)) return {
		status: "running",
		...jobStarted(job),
		...jobStarted(burn),
		...burn.output === void 0 ? {} : { output: burn.output },
		pid: burn.pid
	};
	if (burn?.status === "done") {
		const output = burn.output ?? job.output;
		return {
			status: "done",
			...jobStarted(job),
			...jobStarted(burn),
			...output === void 0 ? {} : { output }
		};
	}
}
async function reconcileOverlayBurns(overlay) {
	let dirty = false;
	const items = { ...overlay.items };
	for (const [id, item] of Object.entries(overlay.items)) {
		let nextItem = items[id] ?? item;
		for (const field of JOB_FIELDS) {
			const job = nextItem[field];
			if (job === void 0) continue;
			if (field === "subtitleJob") {
				const recovered = recoverSubtitleJob(nextItem, job);
				if (recovered !== void 0) {
					nextItem = {
						...nextItem,
						subtitleJob: recovered
					};
					dirty = true;
					continue;
				}
			}
			if (job.status !== "running") continue;
			if (jobPidMatches(job.pid, JOB_COMMAND[field])) continue;
			nextItem = {
				...nextItem,
				[field]: await settleFinishedJob(job, field)
			};
			dirty = true;
		}
		items[id] = nextItem;
	}
	return dirty ? {
		...overlay,
		items
	} : void 0;
}
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
//#endregion
//#region src/settingsHost.ts
/** Settings forms now derive discovery from the plugin's Config/entry id. */
function registerCreatorSettingsNamespace(settings) {
	return settings.configure({ auto: false });
}
//#endregion
//#region src/tools.ts
function signalOf(exec) {
	return exec.signal;
}
function compactText(title, detail) {
	return [{
		type: "text",
		text: `${title}: ${detail}`
	}];
}
function asJson(value) {
	return JSON.parse(JSON.stringify(value));
}
function present(title, rawInput) {
	return {
		card: "generic",
		title,
		kind: "other",
		rawInput
	};
}
const JSON_VALUE$1 = { type: "json" };
function registerCreatorTools(ctx, service) {
	ctx.tools.register(defineTool({
		name: "creator_get_content",
		description: "Read an episode's exact folderPath, video candidates, current video selection, local materials and task states. Do this before importing, selecting a video or preparing any external Skill input.",
		parameters: { id: {
			type: "string",
			required: true,
			description: "Episode folder id."
		} },
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => compactText("内容资料", JSON.stringify(value))
		},
		presentCall: (args) => present("查看内容资料", args),
		execute: (args, exec) => service.getContent(args, signalOf(exec)).then(asJson)
	}));
	ctx.tools.register(defineTool({
		name: "creator_import_video",
		description: "Copy a user-selected local MP4/MOV into an episode without overwriting or moving the source. Returns a Harness jobId; use job_output/job_kill. Get the exact folderPath from creator_get_content first. Do not treat job start as completion.",
		parameters: {
			id: {
				type: "string",
				required: true
			},
			folderPath: {
				type: "string",
				required: true
			},
			sourcePath: {
				type: "string",
				required: true,
				description: "Absolute local video path supplied or confirmed by the user."
			},
			name: {
				type: "string",
				description: "Optional destination filename; no directory components."
			}
		},
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => compactText("导入视频", JSON.stringify(value))
		},
		presentCall: (args) => present("导入视频", args),
		execute: (args, exec) => service.startVideoImport(args, signalOf(exec)).then(asJson)
	}));
	ctx.tools.register(defineTool({
		name: "creator_select_video",
		description: "Explicitly select the current video from the episode candidates. Preview, cover and subtitle tools use this exact selection. Get folderPath and candidates from creator_get_content first.",
		parameters: {
			id: {
				type: "string",
				required: true
			},
			folderPath: {
				type: "string",
				required: true
			},
			name: {
				type: "string",
				required: true
			}
		},
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => compactText("当前视频", JSON.stringify(value))
		},
		presentCall: (args) => present("选择当前视频", args),
		execute: (args, exec) => service.selectVideo(args, signalOf(exec)).then(asJson)
	}));
	ctx.tools.register(defineTool({
		name: "creator_guide",
		description: "Self-bootstrap guide for this plugin. Call this when the user asks what this plugin does, how to use it, or when you are unsure which step comes next. Returns the full workflow (library, script rules, subtitles, covers, publish, data sync) with the live capability status, including whether Ego Browser is available for auto-publish and data collection.",
		parameters: {},
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => {
				const capabilities = Object.values(value.status?.capabilities ?? {});
				const ready = capabilities.filter((item) => item.state === "ready").length;
				return compactText("Guide", `${ready}/${capabilities.length} capabilities ready`);
			}
		},
		presentCall: (args) => present("Creator guide", args),
		execute: (_args, exec) => service.getCreatorGuide(signalOf(exec)).then(asJson)
	}));
	ctx.tools.register(defineTool({
		name: "creator_script_rules",
		description: "Read or update the creator's script rules (persona): tone, structure, audience, and taboos that every script.md must follow. Omit text to read. Send text to save. Empty text clears. Ask the user about their persona before writing rules for the first time; merge new long-term preferences into the existing rules instead of replacing them.",
		parameters: { text: {
			type: "string",
			description: "Full script rules text. Omit to read. Empty string clears."
		} },
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => {
				return compactText("Script rules", value.scriptRules === void 0 ? "not set" : "saved");
			}
		},
		presentCall: (args) => present("Script rules", args),
		async execute(args, exec) {
			const signal = signalOf(exec);
			if (typeof args.text !== "string") return asJson(await service.getSettings({}, signal));
			return asJson(await service.setScriptRules({ text: args.text }, signal));
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_setup",
		description: "Inspect the creator workspace, optional local capabilities, credential status, and current configuration. Omit fields for a read-only diagnosis. Proposed changes are previewed unless apply=true. Only use apply=true after the user confirms the exact directory and enabled platform changes.",
		parameters: {
			apply: {
				type: "boolean",
				description: "False previews changes. True saves them after user confirmation."
			},
			libraryRoot: {
				type: "string",
				description: "Existing absolute content directory, or a path starting with ~/."
			},
			enabledPlatforms: {
				type: "array",
				items: {
					type: "string",
					enum: PUBLISH_PLATFORMS
				},
				description: "Complete list of enabled platforms. Empty disables all platforms."
			}
		},
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => {
				const result = value;
				const capabilities = Object.values(result.status?.capabilities ?? {});
				const ready = capabilities.filter((item) => item.state === "ready").length;
				return compactText(result.applied ? "Setup applied" : "Setup checked", `${ready}/${capabilities.length} capabilities ready`);
			}
		},
		presentCall: (args) => present("Creator setup", args),
		async execute(args, exec) {
			const request = {
				apply: args.apply === true,
				...typeof args.libraryRoot === "string" ? { libraryRoot: args.libraryRoot } : {},
				...Array.isArray(args.enabledPlatforms) ? { enabledPlatforms: normalizeEnabledPlatforms(args.enabledPlatforms) } : {}
			};
			return asJson(await service.configureCreator(request, signalOf(exec)));
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_create_content",
		description: "Create an empty dated library folder named YYYY-MM-DD_title using today's date and a readable title.",
		parameters: { title: {
			type: "string",
			required: true,
			description: "Episode title. Hyphens become spaces."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					folderPath: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => compactText("Created", value.id)
		},
		presentCall: (args) => present("Create content", args),
		execute: (args, exec) => {
			if (args.title.trim() === "") throw new Error("title is required");
			return service.createContent({ title: args.title }, signalOf(exec));
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_update_content",
		description: "Write overlay-only publish marks for one episode: or set a platform publish status. To change topic.md or script.md, write those files in the episode folder with the built-in file tools.",
		parameters: {
			id: {
				type: "string",
				required: true,
				description: "Folder id."
			},
			publishPlatform: {
				type: "string",
				enum: PUBLISH_PLATFORMS,
				description: "Platform to mark. Pair with publishStatus."
			},
			publishStatus: {
				type: "string",
				enum: [
					"unpublished",
					"draft",
					"published"
				],
				description: "Per-platform publish mark stored in the plugin overlay."
			},
			publishUrl: {
				type: "string",
				description: "Optional live URL when status is published."
			}
		},
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => {
				const record = value;
				return compactText("Updated", record.title || record.id || "");
			}
		},
		presentCall: (args) => present("Update content", args),
		async execute(args, exec) {
			const signal = signalOf(exec);
			if (args.id === "") throw new Error("id is required");
			if (args.publishPlatform !== void 0 !== (args.publishStatus !== void 0)) throw new Error("publishPlatform and publishStatus must be sent together");
			if (isPublishPlatform(args.publishPlatform) && isPublishMark(args.publishStatus)) await service.setPublish(args.publishUrl === void 0 ? {
				id: args.id,
				platform: args.publishPlatform,
				status: args.publishStatus
			} : {
				id: args.id,
				platform: args.publishPlatform,
				status: args.publishStatus,
				url: args.publishUrl
			}, signal);
			return asJson(await service.getContent({ id: args.id }, signal));
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_profile",
		description: "Read or update the list of enabled publishing platforms. Omit the list to read. Send the complete list to replace it.",
		parameters: { enabledPlatforms: {
			type: "array",
			items: {
				type: "string",
				enum: PUBLISH_PLATFORMS
			},
			description: "Complete list of enabled platforms. Empty disables all platforms."
		} },
		output: {
			schema: JSON_VALUE$1,
			render: () => compactText("Profile", "saved")
		},
		presentCall: (args) => present("Creator profile", args),
		async execute(args, exec) {
			const signal = signalOf(exec);
			const current = (await service.getSettings({}, signal)).profile;
			if (!Array.isArray(args.enabledPlatforms)) return asJson(current);
			const next = { enabledPlatforms: normalizeEnabledPlatforms(args.enabledPlatforms) };
			return asJson((await service.setProfile({ profile: next }, signal)).profile);
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_organize_library",
		description: "Preview or apply library folder cleanup to YYYY-MM-DD_readable title. Adds a date from the recording/folder time when missing, and turns hyphens/underscores in titles into spaces. Never deletes files. apply=false (default) only previews. Pass ids to limit the batch.",
		parameters: {
			apply: {
				type: "boolean",
				description: "False previews. True renames folders."
			},
			ids: {
				type: "array",
				items: { type: "string" },
				description: "Optional folder ids to organize. Empty means the whole library."
			}
		},
		output: {
			schema: JSON_VALUE$1,
			render: (_args, value) => {
				const record = value;
				return compactText("Organize", `${(Array.isArray(record.moves) ? record.moves : []).length} moves`);
			}
		},
		presentCall: (args) => present("Organize library", args),
		execute: async (args, exec) => asJson(await service.organizeLibrary({
			apply: args.apply === true,
			ids: args.ids ?? []
		}, signalOf(exec)))
	}));
	ctx.tools.register(defineTool({
		name: "creator_sync_publish",
		description: "Sync published titles, URLs, and counts from logged-in creator dashboards. Pass id to update one episode only and stop paging once that title is found. Omit id to match the whole library and collect every page. Requires Ego Lite and an already-logged-in creator session. Repeats within 90 seconds reuse the last snapshot.",
		parameters: {
			id: {
				type: "string",
				description: "Folder id of one episode. Omit to sync the whole library."
			},
			platform: {
				type: "string",
				enum: PUBLISH_PLATFORMS,
				description: "Collect only this platform. Omit to visit all enabled platforms."
			},
			force: {
				type: "boolean",
				description: "Skip the 90-second cache and open creator pages again."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					matched: {
						type: "integer",
						required: true
					},
					platforms: {
						type: "json",
						required: true
					},
					cached: { type: "boolean" }
				}
			},
			render: (_args, value) => compactText("Sync publish", `${value.matched} matched`)
		},
		presentCall: (args) => present("Sync publish", args),
		execute: (args, exec) => {
			const request = {};
			if (args.id !== void 0 && args.id !== "") request.id = args.id;
			if (isPublishPlatform(args.platform)) request.platform = args.platform;
			if (args.force === true) request.force = true;
			return service.syncPublish(request, signalOf(exec));
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_open_subtitle_preview",
		description: "Open the oil-subtitle preview editor in the browser for this episode (video + editable cues).",
		parameters: { id: {
			type: "string",
			required: true,
			description: "Folder id."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					url: {
						type: "string",
						required: true
					},
					port: {
						type: "integer",
						required: true
					}
				}
			},
			render: (_args, value) => compactText("Subtitle preview", value.url)
		},
		presentCall: (args) => present("Subtitle preview", args),
		execute: (args, exec) => {
			if (args.id === "") throw new Error("id is required");
			return service.openSubtitlePreview({ id: args.id }, signalOf(exec));
		}
	}));
}
//#endregion
//#region src/visualReview.ts
const JSON_VALUE = { type: "json" };
const COVER_RATIOS = [
	"3x4",
	"4x3",
	"16x9"
];
function missingCoverRatios(covers) {
	return COVER_RATIOS.filter((ratio) => covers[ratio] === void 0);
}
function imageMediaType(path) {
	switch (extname(path).toLowerCase()) {
		case ".png": return "image/png";
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".gif": return "image/gif";
		default: return;
	}
}
async function prepareCoverReview(service, attachments, id, signal) {
	const detail = await service.getContent({ id }, signal);
	const missing = missingCoverRatios(detail.covers);
	if (missing.length > 0) throw new Error(`missing cover variants: ${missing.join(", ")}`);
	const candidates = COVER_RATIOS.flatMap((ratio) => {
		const path = detail.covers[ratio];
		return path === void 0 ? [] : [{
			ratio,
			path
		}];
	});
	if (candidates.length === 0) throw new Error(`no generated covers: ${id}`);
	const inputs = await Promise.all(candidates.map(async ({ path }) => {
		signal.throwIfAborted();
		const mediaType = imageMediaType(path);
		if (mediaType === void 0) throw new Error(`unsupported cover image: ${path}`);
		return {
			data: await readFile(path),
			mediaType,
			name: basename(path)
		};
	}));
	signal.throwIfAborted();
	const refs = await attachments.saveImages(inputs);
	return {
		id,
		title: detail.title,
		images: candidates.map((candidate, index) => ({
			ratio: candidate.ratio,
			attachment: refs[index]
		}))
	};
}
function reviewMarkdown(id, review, createdAt) {
	const verdict = review.verdict === "pass" ? "通过" : "需要修改";
	const rows = review.findings.length === 0 ? "- 无" : review.findings.map((finding) => {
		const suggestion = finding.suggestion?.trim();
		return `- [${finding.severity}] ${finding.asset}：${finding.issue}` + (suggestion === void 0 || suggestion === "" ? "" : `；建议：${suggestion}`);
	}).join("\n");
	return `# 视觉审查\n\n- 内容：${id}\n- 结论：${verdict}\n- 时间：${createdAt}\n\n## 总结\n\n${review.summary}\n\n## 问题清单\n\n${rows}\n`;
}
async function atomicWrite(path, content) {
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
	try {
		await writeFile(temporary, content, "utf8");
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true }).catch(() => void 0);
	}
}
async function saveVisualReview(service, id, review, signal) {
	signal.throwIfAborted();
	const detail = await service.getContent({ id }, signal);
	const missing = missingCoverRatios(detail.covers ?? {});
	if (review.verdict === "pass" && missing.length > 0) throw new Error(`cannot pass visual review; missing cover variants: ${missing.join(", ")}`);
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	const jsonPath = join(detail.folderPath, "visual-review.json");
	const markdownPath = join(detail.folderPath, "visual-review.md");
	const record = {
		schemaVersion: 1,
		id,
		createdAt,
		...review
	};
	await atomicWrite(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
	signal.throwIfAborted();
	await atomicWrite(markdownPath, reviewMarkdown(id, review, createdAt));
	return {
		jsonPath,
		markdownPath
	};
}
function registerVisualReviewTools(ctx, service) {
	ctx.tools.register(defineTool({
		name: "creator_prepare_visual_review",
		description: "Load all generated cover variants for one episode into the multimodal model context. Inspect composition, readability, safe areas, ratio adaptation, and brand consistency, then call creator_save_visual_review.",
		parameters: { id: {
			type: "string",
			required: true,
			description: "Folder id."
		} },
		output: {
			schema: JSON_VALUE,
			render: (_args, value) => {
				const result = value;
				return [{
					type: "text",
					text: `${result.title}: cover images follow in this order: ${result.images.map((image) => image.ratio).join(", ")}`
				}, ...result.images.map((image) => ({
					type: "image",
					attachment: image.attachment
				}))];
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Prepare visual review",
			kind: "other",
			rawInput: args
		}),
		execute: async (args, exec) => {
			if (args.id.trim() === "") throw new Error("id is required");
			return prepareCoverReview(service, ctx.attachments, args.id, exec.signal);
		}
	}));
	ctx.tools.register(defineTool({
		name: "creator_save_visual_review",
		description: "Persist a completed multimodal cover review into visual-review.json and visual-review.md in the episode folder. Call only after creator_prepare_visual_review and include concrete findings for each affected ratio.",
		parameters: {
			id: {
				type: "string",
				required: true,
				description: "Folder id."
			},
			verdict: {
				type: "string",
				required: true,
				enum: ["pass", "needs_changes"]
			},
			summary: {
				type: "string",
				required: true,
				description: "Concise overall review."
			},
			findings: {
				type: "array",
				required: true,
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						severity: {
							type: "string",
							required: true,
							enum: [
								"info",
								"warning",
								"blocking"
							]
						},
						asset: {
							type: "string",
							required: true,
							description: "Affected ratio or file name."
						},
						issue: {
							type: "string",
							required: true
						},
						suggestion: { type: "string" }
					}
				}
			}
		},
		output: {
			schema: JSON_VALUE,
			render: (_args, value) => {
				return [{
					type: "text",
					text: `visual review saved: ${value.markdownPath ?? "visual-review.md"}`
				}];
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Save visual review",
			kind: "other",
			rawInput: args
		}),
		execute: async (args, exec) => {
			if (args.id.trim() === "") throw new Error("id is required");
			if (args.summary.trim() === "") throw new Error("summary is required");
			const findings = args.findings.map((finding) => {
				if (finding.asset.trim() === "" || finding.issue.trim() === "") throw new Error("finding asset and issue are required");
				return {
					severity: finding.severity,
					asset: finding.asset,
					issue: finding.issue,
					...finding.suggestion === void 0 ? {} : { suggestion: finding.suggestion }
				};
			});
			return saveVisualReview(service, args.id, {
				verdict: args.verdict,
				summary: args.summary,
				findings
			}, exec.signal);
		}
	}));
}
//#endregion
//#region src/index.ts
const name = "dsh-creator-workbench";
function apply(ctx, config) {
	const service = new CreatorWorkbenchService(ctx, config);
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.effect(() => registerCreatorSettingsNamespace(settingsCtx.settings));
	});
	ctx.inject(["tools"], (toolsCtx) => {
		registerCreatorTools(toolsCtx, service);
	});
	ctx.inject(["jobs"], (jobsCtx) => {
		jobsCtx.effect(() => jobsCtx.jobs.attachController("dsh-creator-workbench-video-import"));
		service.importJobs = jobsCtx.jobs;
		jobsCtx.effect(() => () => {
			service.imports.dispose();
			service.importJobs = void 0;
		});
	});
	ctx.inject(["tools", "jobs"], (jobsCtx) => {
		registerCreatorJobTools(jobsCtx, service);
	});
	ctx.inject(["tools", "attachments"], (visualCtx) => {
		registerVisualReviewTools(visualCtx, service);
		registerCoverTools(visualCtx, service.covers);
		registerProductionTools(visualCtx, service.production);
	});
	ctx.inject(["systemPrompt"], (promptCtx) => {
		registerLibraryPrompt(promptCtx, service);
	});
	ctx.inject(["skills"], (skillsCtx) => {
		registerCreatorWorkbenchSkill(skillsCtx);
	});
}
//#endregion
export { Config, apply, name };
