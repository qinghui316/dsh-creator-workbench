window.__ModuleLoader__.load({
	id: "dsh-creator-workbench",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
		//#region src/client/persistence.ts
		const CREATOR_STORAGE_KEY = "dsh-creator-workbench/ui/v1";
		const DEFAULT_UI_STATE = {
			schemaVersion: 1,
			selectedId: null,
			filter: "all",
			query: "",
			sidebarTab: "sessions"
		};
		function browserCreatorStorage() {
			try {
				return globalThis.localStorage;
			} catch {
				return;
			}
		}
		function loadCreatorUiState(storage) {
			if (storage === void 0) return { ...DEFAULT_UI_STATE };
			try {
				const raw = storage.getItem(CREATOR_STORAGE_KEY);
				if (raw === null) return { ...DEFAULT_UI_STATE };
				const parsed = JSON.parse(raw);
				const filter = parsed.filter;
				return {
					schemaVersion: 1,
					...Array.isArray(parsed.removedProjectFolders) ? { removedProjectFolders: parsed.removedProjectFolders.filter((v) => typeof v === "string") } : {},
					...parsed.sessionContents !== void 0 ? { sessionContents: Object.fromEntries(Object.entries(parsed.sessionContents ?? {}).filter(([id, item]) => id !== "" && item !== null && typeof item === "object" && typeof item.contentId === "string" && typeof item.folder === "string")) } : {},
					selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
					filter: filter === "cover" || filter === "subtitle" || filter === "article" ? filter : "all",
					query: typeof parsed.query === "string" ? parsed.query : "",
					sidebarTab: parsed.sidebarTab === "content" ? "content" : "sessions",
					...typeof parsed.inspectorWidth === "number" && Number.isFinite(parsed.inspectorWidth) ? { inspectorWidth: parsed.inspectorWidth } : {}
				};
			} catch {
				return { ...DEFAULT_UI_STATE };
			}
		}
		function saveCreatorUiState(storage, state) {
			if (storage === void 0) return false;
			try {
				storage.setItem(CREATOR_STORAGE_KEY, JSON.stringify(state));
				return true;
			} catch {
				return false;
			}
		}
		//#endregion
		//#region src/client/workbench.ts
		const CREATOR_REPOSITORY = "qinghui316/dsh-creator-workbench";
		function desktopWorkbenchesOf(ctx) {
			const service = ctx.get("desktopWorkbenches");
			if (service === void 0) throw new Error("请使用提供工作台服务的 DSH Desktop 打开内容工作台。");
			return service;
		}
		function captureWorkbenchNavigation(service) {
			const session = service.currentSession();
			return () => service.isActive() && service.currentSession() === session;
		}
		function pickCreatorDirectory(ctx) {
			const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
			if (desktop !== void 0) return desktop.pick();
			return ctx.get("uiWorkspace").pickDirectory();
		}
		/** Write only through the host's session-addressed input API; never auto-send. */
		async function prepareCoverDraft(ctx, content, runId, picker, append = false) {
			const workbenches = desktopWorkbenchesOf(ctx);
			const expectedSelection = loadCreatorUiState(browserCreatorStorage()).selectedId;
			if (expectedSelection !== content.id) throw new Error("内容已切换，请重新发起。");
			const sessionId = matchesContentDirectory(contentBindingForSession(workbenches), content) ? workbenches.currentSession() : await startContentSession(workbenches, content, picker);
			if (!sessionId) throw new Error("已取消会话创建，制作请求尚未发送。");
			if (loadCreatorUiState(browserCreatorStorage()).selectedId !== expectedSelection) throw new Error("内容已切换，未写入旧制作请求。");
			if (!workbenches.isActive() || workbenches.currentSession() !== sessionId || !workbenches.ownsSession(sessionId)) throw new Error("会话已切换，请重新发起。");
			const scoped = ctx.get("sessions")?.scope(sessionId);
			const conversation = scoped?.get("conversation");
			if (!scoped || !conversation) throw new Error("宿主原生会话输入尚未就绪，请稍后重试。");
			const input = conversation.input.for(scoped), state = input.state.getSnapshot();
			if (state.phase !== "plain") throw new Error("会话输入正在处理请求，请稍后重试。");
			const text = `请使用创作工作台的原生 Agent 封面流程。先调用 creator_prepare_cover 查看真实候选画面，并读取返回的 oil-cover 规则；完成选帧、标题、逐画幅提示词后调用 creator_generate_cover。分析后直接生成，不增加方案审批。等待任务结果后读取图片、逐画幅质检，再保存结论和当前使用版本。\n本次固定输入：${JSON.stringify({
				id: content.id,
				folderPath: content.folderPath,
				runId
			})}\n不要改用其他内容、其他视频或外部视觉分析服务；不要读取或输出 API Key。`;
			if (state.draft || state.occurrences.length || state.attachmentIds.length) {
				if (!append) throw new Error("当前会话已有草稿，原内容已保留。请点击‘追加制作请求’。");
				if (!scoped.bail("slash/input-insert-text", {
					text: `\n\n${text}`,
					span: {
						start: state.draft.length,
						end: state.draft.length,
						draftRev: state.draftRev
					}
				})) throw new Error("草稿已变化，未插入，请重试。");
			} else input.setDraft(text);
			input.focus();
		}
		const recentBindings = /* @__PURE__ */ new WeakMap();
		const sessionNavigations = /* @__PURE__ */ new WeakMap();
		function sameFolder(left, right) {
			const clean = (value) => {
				const path = value.replaceAll("\\", "/").replace(/\/+$/, "");
				return /^[A-Za-z]:\//.test(path) || path.startsWith("//") ? path.toLowerCase() : path;
			};
			return typeof left === "string" && clean(left) === clean(right);
		}
		function matchesContentDirectory(binding, content) {
			return binding !== null && binding.requiresNewSession !== true && [content.folderPath, ...content.directoryAliases ?? []].some((path) => sameFolder(binding.folder, path)) && (binding.workspaceFolder === void 0 || [content.folderPath, ...content.directoryAliases ?? []].some((path) => sameFolder(binding.workspaceFolder, path)));
		}
		/** Never adopt a native or another workbench's saved session. No auto-send. */
		async function startContentSession(service, content, pickDirectory) {
			const key = content.folderPath.replaceAll("\\", "/").replace(/\/+$/, "");
			const normalized = /^[A-Za-z]:\//.test(key) ? key.toLowerCase() : key;
			const pending = sessionNavigations.get(service) ?? /* @__PURE__ */ new Map();
			const existing = pending.get(normalized);
			if (existing) return existing;
			const request = navigateContentSession(service, content, pickDirectory).finally(() => pending.delete(normalized));
			pending.set(normalized, request);
			sessionNavigations.set(service, pending);
			return request;
		}
		async function navigateContentSession(service, content, pickDirectory) {
			const state = loadCreatorUiState(browserCreatorStorage());
			if (state.removedProjectFolders?.some((f) => sameFolder(f, content.folderPath))) throw new Error("项目已移除，请通过‘使用已有目录’重新加入。");
			const previousSession = service.currentSession();
			const bindings = Object.entries({
				...state.sessionContents,
				...Object.fromEntries(recentBindings.get(service) ?? [])
			});
			const folder = content.folderPath;
			const saved = bindings.find(([id, item]) => id === previousSession && matchesContentDirectory(item, content) && service.ownsSession(id)) ?? bindings.find(([id, item]) => matchesContentDirectory(item, content) && service.ownsSession(id));
			if (saved === void 0) {
				const selected = await pickDirectory();
				if (selected === null || !service.isActive() || service.currentSession() !== previousSession) return null;
				if (!sameFolder(selected, folder)) throw new Error(`请选择当前项目的目录：${folder}`);
			}
			if (!service.isActive() || service.currentSession() !== previousSession) return null;
			const sessionId = await service.ensureSession({
				folder,
				...saved ? { sessionId: saved[0] } : {}
			});
			if (!service.ownsSession(sessionId)) return null;
			const pending = recentBindings.get(service) ?? /* @__PURE__ */ new Map();
			pending.set(sessionId, {
				contentId: content.id,
				folder,
				workspaceFolder: folder
			});
			recentBindings.set(service, pending);
			const latest = loadCreatorUiState(browserCreatorStorage());
			if (!saveCreatorUiState(browserCreatorStorage(), {
				...latest,
				sessionContents: {
					...latest.sessionContents,
					[sessionId]: {
						contentId: content.id,
						folder,
						workspaceFolder: folder
					}
				}
			})) throw new Error("会话已创建，但内容关联未保存。请保留当前内容并重试。");
			return service.isActive() && service.currentSession() === sessionId ? sessionId : null;
		}
		function contentBindingForSession(service) {
			const session = service.currentSession();
			if (session === void 0 || !service.ownsSession(session)) return null;
			return recentBindings.get(service)?.get(session) ?? loadCreatorUiState(browserCreatorStorage()).sessionContents?.[session] ?? null;
		}
		/** Prepare the session first, preserve existing input, then create the bound business request. */
		async function prepareBusinessRequest(ctx, content, makeText, picker, append = false, requestLabel = "文章请求") {
			const service = desktopWorkbenchesOf(ctx), expected = loadCreatorUiState(browserCreatorStorage()).selectedId;
			if (expected !== content.id) throw new Error("内容已切换，请重新发起。");
			const sessionId = matchesContentDirectory(contentBindingForSession(service), content) ? service.currentSession() : await startContentSession(service, content, picker);
			if (!sessionId || !service.isActive() || service.currentSession() !== sessionId || !service.ownsSession(sessionId)) throw new Error("会话创建已取消或会话已切换。");
			const scoped = ctx.get("sessions")?.scope(sessionId), conversation = scoped?.get("conversation");
			if (!scoped || !conversation) throw new Error("原生会话输入尚未就绪，请稍后重试。");
			const input = conversation.input.for(scoped), before = input.state.getSnapshot();
			if (before.phase !== "plain") throw new Error("会话正在处理输入，请稍后重试。");
			if ((before.draft || before.occurrences.length || before.attachmentIds.length) && !append) throw new Error(`当前会话已有草稿，原内容已保留。请点击‘追加${requestLabel}’。`);
			const text = await makeText(sessionId), after = input.state.getSnapshot();
			if (!service.isActive() || service.currentSession() !== sessionId || loadCreatorUiState(browserCreatorStorage()).selectedId !== expected || after.draftRev !== before.draftRev || after.phase !== "plain") throw new Error("内容或草稿已变化，未覆盖输入，请重新插入请求。");
			if (before.draft || before.occurrences.length || before.attachmentIds.length) {
				if (!scoped.bail("slash/input-insert-text", {
					text: `\n\n${text}`,
					span: {
						start: after.draft.length,
						end: after.draft.length,
						draftRev: after.draftRev
					}
				})) throw new Error("草稿已变化，未插入请求。");
			} else input.setDraft(text);
			input.focus();
		}
		function libraryRootForFolder(folder) {
			const clean = folder.replace(/[\\/]+$/, "");
			if (!clean.startsWith("/") && !clean.startsWith("\\\\") && !/^[A-Za-z]:[\\/]/.test(clean)) throw new Error("资料目录必须是绝对路径。");
			const cut = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
			return cut === 0 ? "/" : cut === 2 && clean[1] === ":" ? clean.slice(0, 3) : clean.slice(0, cut);
		}
		/** Restore the confirmed folder as well as the id; ids can repeat in different libraries. */
		async function restoreSessionContent(service, face) {
			const session = service.currentSession();
			const binding = contentBindingForSession(service);
			if (binding === null || !service.isActive()) return null;
			if (loadCreatorUiState(browserCreatorStorage()).removedProjectFolders?.some((f) => sameFolder(f, binding.folder))) return null;
			const current = () => service.isActive() && service.currentSession() === session;
			if (await face.projectRemoved?.(binding.contentId, binding.folder)) return null;
			if (!current()) return null;
			let detail;
			try {
				detail = await face.getContent(binding.contentId, binding.folder);
			} catch (error) {
				if (!(error instanceof Error) || !error.message.includes("此项目已从工作台移除")) throw error;
				const storage = browserCreatorStorage(), state = loadCreatorUiState(storage);
				saveCreatorUiState(storage, {
					...state,
					removedProjectFolders: [...(state.removedProjectFolders ?? []).filter((f) => !sameFolder(f, binding.folder)), binding.folder]
				});
				return null;
			}
			if (![detail.folderPath, ...detail.directoryAliases ?? []].some((path) => sameFolder(path, binding.folder))) throw new Error("资料位置已改变，请重新选择资料目录。");
			if (!current()) return null;
			const id = detail.id ?? binding.contentId;
			const updated = {
				...binding,
				contentId: id,
				folder: detail.folderPath
			};
			const pending = recentBindings.get(service) ?? /* @__PURE__ */ new Map();
			pending.set(session, updated);
			recentBindings.set(service, pending);
			const storage = browserCreatorStorage(), state = loadCreatorUiState(storage);
			saveCreatorUiState(storage, {
				...state,
				sessionContents: {
					...state.sessionContents,
					[session]: updated
				}
			});
			return detail.id ?? id;
		}
		/** Relocate business data explicitly without changing the old session's host-owned workspace. */
		async function relocateSessionContent(service, folder, face) {
			const session = service.currentSession();
			if (session === void 0 || !service.ownsSession(session) || !service.isActive()) return null;
			libraryRootForFolder(folder);
			const clean = folder.replace(/[\\/]+$/, "");
			const id = clean.slice(Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\")) + 1);
			if (!service.isActive() || service.currentSession() !== session) return null;
			const detail = await face.getContent(id, clean);
			if (detail.folderPath !== clean) throw new Error("请选择包含这一期资料的内容文件夹。");
			if (!service.isActive() || service.currentSession() !== session) return null;
			const binding = {
				contentId: detail.id ?? id,
				folder: detail.folderPath,
				requiresNewSession: true
			};
			const pending = recentBindings.get(service) ?? /* @__PURE__ */ new Map();
			pending.set(session, binding);
			recentBindings.set(service, pending);
			const state = loadCreatorUiState(browserCreatorStorage());
			if (!saveCreatorUiState(browserCreatorStorage(), {
				...state,
				sessionContents: {
					...state.sessionContents,
					[session]: binding
				}
			})) throw new Error("新资料关联未保存，请保留当前选择并重试。");
			return detail.id ?? id;
		}
		//#endregion
		//#region src/client/coverRequests.ts
		/** A request is admitted only after session/draft preflight; rollback is limited to this new request. */
		async function prepareCoverRequest(ctx, detail, ratios, action, append = false) {
			if (!detail.selectedVideo) throw new Error("请先选择当前视频。");
			const requestToken = crypto.randomUUID();
			let freshRun, runId, owner;
			const scope = {
				id: detail.id,
				folderPath: detail.folderPath
			};
			try {
				await prepareBusinessRequest(ctx, detail, async (sessionId) => {
					owner = sessionId;
					const run = [...(await action({
						...scope,
						action: "create",
						video: detail.selectedVideo,
						ratios,
						requestToken
					})).runs].reverse().find((row) => (row.purpose ?? "cover") === "cover" && row.video.name === detail.selectedVideo && [
						"waiting_agent",
						"preparing",
						"running"
					].includes(row.status));
					if (!run) throw new Error("封面请求未建立。");
					runId = run.id;
					if (run.requestToken === requestToken) freshRun = run.id;
					return `请为本期视频制作 ${ratios.map((ratio) => ratio.replace("x", ":")).join("、")} 封面。调用 creator_prepare_cover 阅读真实画面和规则，再完成生成、看图检查和选用。\n制作请求：${JSON.stringify({
						...scope,
						runId: run.id
					})}`;
				}, async () => detail.folderPath, append, "制作请求");
			} catch (error) {
				if (freshRun) await action({
					...scope,
					action: "discard-request",
					runId: freshRun,
					requestToken
				});
				throw error;
			}
			if (runId && owner) await action({
				...scope,
				action: "delivered",
				runId,
				sessionId: owner
			});
		}
		//#endregion
		//#region src/client/projectRecovery.ts
		/** History recovery is background-only; current navigation awaits at most its own hint. */
		function projectRecovery(options) {
			const recovered = /* @__PURE__ */ new Set(), pending = /* @__PURE__ */ new Map();
			let history;
			const one = (session, folder) => {
				const key = session + "\n" + folder;
				if (recovered.has(key) || !options.owns(session)) return Promise.resolve();
				const active = pending.get(key);
				if (active) return active;
				const work = (async () => {
					let timer;
					try {
						await Promise.race([options.recover(session, folder), new Promise((_, reject) => {
							timer = setTimeout(() => reject(/* @__PURE__ */ new Error("原会话查询超时")), options.timeout ?? 4e3);
						})]);
						recovered.add(key);
						options.changed();
					} catch {} finally {
						clearTimeout(timer);
						pending.delete(key);
					}
				})();
				pending.set(key, work);
				return work;
			};
			return {
				one,
				history: () => {
					if (history) return history;
					const entries = Object.entries(options.bindings());
					let index = 0;
					history = Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
						for (;;) {
							const pair = entries[index++];
							if (!pair) return;
							await one(pair[0], pair[1].folder);
						}
					})).then(() => void 0).finally(() => {
						history = void 0;
					});
					return history;
				}
			};
		}
		//#endregion
		//#region src/client/contentSelection.ts
		const listeners = /* @__PURE__ */ new Set();
		const libraryListeners = /* @__PURE__ */ new Set();
		const profileListeners = /* @__PURE__ */ new Set();
		let selectedId = loadCreatorUiState(browserCreatorStorage()).selectedId;
		let selectionEpoch = 0;
		function captureContentSelection() {
			const epoch = selectionEpoch;
			return () => epoch === selectionEpoch;
		}
		let libraryEpoch = 0;
		let profileEpoch = 0;
		function emit() {
			for (const listener of listeners) listener();
		}
		function emitLibrary() {
			for (const listener of libraryListeners) listener();
		}
		function bumpLibrary() {
			libraryEpoch += 1;
			emitLibrary();
		}
		function getLibraryEpoch() {
			return libraryEpoch;
		}
		function subscribeLibrary(listener) {
			libraryListeners.add(listener);
			return () => {
				libraryListeners.delete(listener);
			};
		}
		function useLibraryEpoch() {
			const [epoch, setEpoch] = (0, react.useState)(getLibraryEpoch);
			(0, react.useEffect)(() => subscribeLibrary(() => {
				setEpoch(getLibraryEpoch());
			}), []);
			return epoch;
		}
		function bumpProfile() {
			profileEpoch += 1;
			for (const listener of profileListeners) listener();
		}
		function getProfileEpoch() {
			return profileEpoch;
		}
		function subscribeProfile(listener) {
			profileListeners.add(listener);
			return () => {
				profileListeners.delete(listener);
			};
		}
		function useProfileEpoch() {
			const [epoch, setEpoch] = (0, react.useState)(getProfileEpoch);
			(0, react.useEffect)(() => subscribeProfile(() => {
				setEpoch(getProfileEpoch());
			}), []);
			return epoch;
		}
		function getSelectedContentId() {
			return selectedId;
		}
		function setSelectedContentId(id) {
			if (selectedId === id) return;
			selectionEpoch += 1;
			selectedId = id;
			const state = loadCreatorUiState(browserCreatorStorage());
			saveCreatorUiState(browserCreatorStorage(), {
				...state,
				selectedId
			});
			emit();
		}
		function subscribeSelectedContentId(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		function useSelectedContentId() {
			const [selectedId, setSelectedId] = (0, react.useState)(getSelectedContentId);
			(0, react.useEffect)(() => subscribeSelectedContentId(() => {
				setSelectedId(getSelectedContentId());
			}), []);
			return [selectedId, setSelectedContentId];
		}
		//#endregion
		//#region src/client/projectCleanup.ts
		async function hostOperation(work) {
			let timer;
			try {
				return await Promise.race([work, new Promise((_, reject) => {
					timer = setTimeout(() => reject(/* @__PURE__ */ new Error("宿主操作结果暂未确认，请重试核对原记录。")), 15e3);
				})]);
			} finally {
				clearTimeout(timer);
			}
		}
		function markProjectRemoved(folder, removed, _contentId) {
			const storage = browserCreatorStorage(), state = loadCreatorUiState(storage);
			const folders = (state.removedProjectFolders ?? []).filter((f) => !sameFolder(f, folder));
			if (!saveCreatorUiState(storage, {
				...state,
				removedProjectFolders: removed ? [...folders, folder] : folders
			})) throw new Error("项目操作已完成，但导航记录未保存，请重试。");
		}
		/** The Remote and native cleanup share one selection guard across their asynchronous work. */
		async function removeProjectWithHost(ctx, content, remove) {
			const cleanup = planProjectCleanup(ctx, content.folderPath, content.directoryAliases), selectionCurrent = captureContentSelection();
			await remove();
			for (const path of /* @__PURE__ */ new Set([content.folderPath, ...content.directoryAliases ?? []])) markProjectRemoved(path, true, content.id);
			if (selectionCurrent() && getSelectedContentId() === content.id) setSelectedContentId(null);
			try {
				await cleanup();
			} catch (error) {
				throw new Error(`项目已从列表移除，部分会话或工作区尚未清理，请重试。${error instanceof Error ? error.message : String(error)}`);
			}
			bumpLibrary();
		}
		const reconciled = /* @__PURE__ */ new WeakMap();
		/** Finish host cleanup for removal records written by older versions. No files or unrelated sessions are touched. */
		async function reconcileRemovedProjects(ctx, items) {
			const entries = reconciled.get(ctx) ?? /* @__PURE__ */ new Map();
			reconciled.set(ctx, entries);
			const warnings = [];
			for (const item of items) {
				let pending = entries.get(item.folderPath);
				if (!pending) {
					pending = (async () => {
						try {
							for (const path of /* @__PURE__ */ new Set([item.folderPath, ...item.directoryAliases ?? []])) markProjectRemoved(path, true, item.id);
							await planProjectCleanup(ctx, item.folderPath, item.directoryAliases)();
						} catch (error) {
							return `已移除项目的会话清理未完成：${error instanceof Error ? error.message : String(error)}`;
						}
					})();
					entries.set(item.folderPath, pending);
				}
				const warning = await pending;
				if (warning) {
					warnings.push(warning);
					entries.delete(item.folderPath);
				}
			}
			return warnings;
		}
		/** Freeze public host identities before archiving; never edit host storage or infer ownership by title. */
		function planProjectCleanup(ctx, folder, aliases = []) {
			const matches = (path) => [folder, ...aliases].some((value) => sameFolder(path, value));
			const workbenches = desktopWorkbenchesOf(ctx), workspaces = ctx.get("workspaces");
			const sessions = ctx.get("sessions");
			const navigation = ctx.get("uiWorkspace");
			if (!workspaces?.delete || !navigation?.archiveSession || !sessions) throw new Error("当前 Desktop 尚未提供完整的会话归档和工作区清理接口。项目未删除，请升级后重试。");
			const snapshot = workspaces.list.getSnapshot(), all = sessions.list.getSnapshot();
			if (snapshot.phase !== "ready" || all.phase !== "ready") throw new Error("工作区仍在读取，请稍后重试。");
			const exact = snapshot.items.filter((item) => matches(item.path));
			const owned = Object.entries(all.byId).filter(([id, item]) => matches(item.cwd) && workbenches.ownsSession(id)).map(([id]) => id);
			const preserveView = workbenches.isActive() && owned.includes(workbenches.currentSession() ?? "");
			return async () => {
				for (const id of owned) {
					if (!workbenches.ownsSession(id) || !matches(sessions.list.getSnapshot().byId[id]?.cwd)) throw new Error("会话归属已变化，已停止清理，请重试。");
					if (!workspaces.list.getSnapshot().archivedSessionIds.includes(id)) await hostOperation(navigation.archiveSession(id, { stopActivity: true }));
				}
				for (const item of exact) {
					const current = workspaces.list.getSnapshot().items.find((w) => w.workspaceId === item.workspaceId);
					if (!current || !matches(current.path) || current.sessionIds.some((id) => !owned.includes(id))) continue;
					const archived = workspaces.list.getSnapshot().archivedSessionIds;
					if (current.sessionIds.every((id) => archived.includes(id))) await hostOperation(workspaces.delete(current.workspaceId));
				}
				const view = workbenches.getSnapshot?.();
				if (preserveView && !workbenches.currentSession() && view && (view.state.active === null || view.state.active === "qinghui316/dsh-creator-workbench") && !view.marketOpen && workbenches.home) await hostOperation(workbenches.home(CREATOR_REPOSITORY));
			};
		}
		async function restoreProjectSessions(ctx, folder, restoreMembership, aliases = [], canonicalId) {
			const matches = (path) => [folder, ...aliases].some((value) => sameFolder(path, value));
			const service = desktopWorkbenchesOf(ctx), state = loadCreatorUiState(browserCreatorStorage());
			const startedActive = service.isActive();
			const workspaces = ctx.get("workspaces"), navigation = ctx.get("uiWorkspace");
			const archived = workspaces?.list.getSnapshot().archivedSessionIds ?? [];
			const candidates = Object.entries(state.sessionContents ?? {}).filter(([id, binding]) => matches(binding.folder) && binding.requiresNewSession !== true && (!binding.workspaceFolder || matches(binding.workspaceFolder)) && service.ownsSession(id));
			const saved = candidates.find(([id]) => id === service.currentSession()) ?? candidates.at(-1);
			if (saved) {
				const originalSession = service.currentSession(), selectionCurrent = captureContentSelection();
				let interrupted = false, restoringSession = false;
				const navigationChanged = () => {
					const current = service.currentSession(), view = service.getSnapshot?.();
					if (!selectionCurrent() && (!restoringSession || getSelectedContentId() !== saved[1].contentId && getSelectedContentId() !== canonicalId) || current && current !== originalSession && current !== saved[0] || view?.marketOpen || view && view.state.active !== null && view.state.active !== "qinghui316/dsh-creator-workbench") interrupted = true;
				};
				const checkNavigation = () => {
					navigationChanged();
					if (interrupted) throw new Error("会话已切换，项目资料已保留。请回到工作台后重新打开项目对话。");
				};
				const unsubscribe = service.subscribe?.(navigationChanged);
				try {
					checkNavigation();
					restoringSession = true;
					if (!workspaces?.list.getSnapshot().items.some((item) => matches(item.path) && item.sessionIds.includes(saved[0]))) {
						if (!restoreMembership) throw new Error("项目已加入，当前 Desktop 尚未提供恢复目录分组的接口。原会话保持完整。");
						await hostOperation(restoreMembership(saved[0], saved[1].workspaceFolder ?? saved[1].folder));
						checkNavigation();
					}
					if (archived.includes(saved[0]) && navigation) await hostOperation(navigation.unarchiveSession(saved[0]));
					checkNavigation();
					if (!service.isActive()) {
						const view = service.getSnapshot?.(), current = service.currentSession();
						if (!startedActive || !view || view.marketOpen || view.state.active !== null && view.state.active !== "qinghui316/dsh-creator-workbench" || current && current !== saved[0] || !service.home) throw new Error("会话已切换，项目资料已保留。请回到工作台后重新打开项目对话。");
						await hostOperation(service.home(CREATOR_REPOSITORY));
						checkNavigation();
					}
					restoringSession = true;
					const actual = await hostOperation(service.ensureSession({
						folder: saved[1].workspaceFolder ?? saved[1].folder,
						sessionId: saved[0]
					}));
					checkNavigation();
					if (actual !== saved[0]) throw new Error("项目已加入，但宿主未恢复原会话。请核对现有工作区，未继续创建会话。");
				} finally {
					unsubscribe?.();
				}
			}
			for (const path of /* @__PURE__ */ new Set([folder, ...aliases])) {
				markProjectRemoved(path, false);
				reconciled.get(ctx)?.delete(path);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function joinValues(array, separator = "|") {
			return array.map((val) => stringifyPrimitive(val)).join(separator);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		var Cached = class {
			constructor(getter) {
				this._getter = getter;
				this._value = void 0;
			}
			get value() {
				const getter = this._getter;
				if (getter !== void 0) {
					this._value = getter();
					this._getter = void 0;
				}
				return this._value;
			}
		};
		function cached(getter) {
			return new Cached(getter);
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		/**
		* Whichever object a def's `shape` currently answers from: the one the caller passed until the first read, the frozen copy after it.
		*
		* Its keys and descriptors read without invoking anything, which is what lets a discriminated union check its discriminator, and the cycle walk read a shape, without resolving a getter that references the schema being constructed. A def that answers `shape` from an accessor of its own has none.
		*/
		function rawShape(def) {
			const desc = Object.getOwnPropertyDescriptor(def, "shape");
			return desc?.get ? desc.get.raw : desc?.value;
		}
		function sourceShape(schema) {
			return rawShape(schema._zod.def) ?? schema._zod.def.shape;
		}
		function deferProp(target, key, getter) {
			Object.defineProperty(target, key, {
				get() {
					const value = getter();
					assignProp(this, key, value);
					return value;
				},
				enumerable: true,
				configurable: true
			});
		}
		function putProp(target, key, value) {
			if (key in target) assignProp(target, key, value);
			else target[key] = value;
		}
		/**
		* Copies `keys` of `source`'s shape onto `target`, each value passed through `wrap`.
		*
		* A key the source has resolved is copied through now, so the derived shape states it outright and nothing has to resolve it to learn what it holds. A key the source still defers stays deferred, and reads back through the source's own `shape`, so it resolves once and both shapes get that one schema.
		*/
		function mirrorShape(target, source, keys, wrap) {
			const raw = sourceShape(source);
			for (const key of keys) {
				const desc = Object.getOwnPropertyDescriptor(raw, key);
				if (!desc.enumerable) continue;
				if (desc.get) deferProp(target, key, () => {
					const value = source._zod.def.shape[key];
					return wrap ? wrap(value, key) : value;
				});
				else putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
			}
		}
		function mirrorProps(target, source) {
			for (const key of Reflect.ownKeys(source)) {
				const desc = Object.getOwnPropertyDescriptor(source, key);
				if (!desc.enumerable) continue;
				if (desc.get) deferProp(target, key, () => source[key]);
				else putProp(target, key, desc.value);
			}
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) {
				const descriptors = Object.getOwnPropertyDescriptors(def);
				Object.assign(mergedDescriptors, descriptors);
			}
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone$1(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function stringifyPrimitive(value) {
			if (typeof value === "bigint") return value.toString() + "n";
			if (typeof value === "string") return `"${value}"`;
			return `${value}`;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = /*@__PURE__*/ (() => ({
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		}))();
		const BIGINT_FORMAT_RANGES = {
			int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
			uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			const newShape = {};
			mirrorShape(newShape, schema, maskedKeys(schema, mask));
			return clone$1(schema, mergeDefs(currDef, {
				shape: newShape,
				checks: []
			}));
		}
		function maskedKeys(schema, mask) {
			const raw = sourceShape(schema);
			const keys = [];
			for (const key of Reflect.ownKeys(mask)) {
				if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) throw new Error(`Unrecognized key: "${String(key)}"`);
				if (mask[key]) keys.push(key);
			}
			return keys;
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			const omitted = new Set(maskedKeys(schema, mask));
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
			return clone$1(schema, mergeDefs(currDef, {
				shape: newShape,
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = sourceShape(schema);
				for (const key of Reflect.ownKeys(shape)) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone$1(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
		}
		function extended(schema, shape) {
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
			mirrorProps(newShape, shape);
			return newShape;
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone$1(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
		}
		function merge(a, b) {
			if (!b?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			const newShape = {};
			mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
			mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
			return clone$1(a, mergeDefs(a._zod.def, {
				shape: newShape,
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask, name = "partial") {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
			const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({
				type: "optional",
				innerType: value
			})));
			return clone$1(schema, mergeDefs(schema._zod.def, {
				shape: newShape,
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({
				type: "nonoptional",
				innerType: value
			}));
			return clone$1(schema, mergeDefs(schema._zod.def, { shape: newShape }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function attachSchema(issues, start, inst) {
			var _a;
			for (let i = start; i < issues.length; i++) (_a = issues[i]).schema ?? (_a.schema = inst);
		}
		function finalizeIssue(iss, ctx, config) {
			var _a;
			const traits = iss.inst?._zod?.traits;
			if (traits?.has("$ZodType")) {
				if (traits.has("$ZodCheck")) (_a = iss).schema ?? (_a.schema = iss.inst);
				else iss.schema = iss.inst;
			}
			const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const full = {};
			for (const k of Object.keys(iss)) {
				if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__") continue;
				full[k] = iss[k];
			}
			full.path ?? (full.path = []);
			full.message = message;
			if (ctx?.reportInput) full.input = iss.input;
			return full;
		}
		const highSurrogate = /[\uD800-\uDBFF]/;
		function codePointLength(str) {
			const units = str.length;
			if (!highSurrogate.test(str)) return units;
			let count = units;
			for (let i = 0; i < units - 1; i++) if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
				count--;
				i++;
			}
			return count;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function parsedType(data) {
			const t = typeof data;
			switch (t) {
				case "number": return Number.isNaN(data) ? "nan" : "number";
				case "object": {
					if (data === null) return "null";
					if (Array.isArray(data)) return "array";
					const obj = data;
					if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) return obj.constructor.name;
				}
			}
			return t;
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		/**
		* Installs a trait's members on its prototype. Each value builds that member for the instance on first read; the built value shadows the accessor as an own property, so a detached `const { parse } = schema` keeps working.
		*
		* Call this from a `proto` initializer, which runs once per prototype — never per instance.
		*/
		function members(proto, table) {
			for (const key in table) {
				const desc = Object.getOwnPropertyDescriptor(table, key);
				if (desc.get) Object.defineProperty(proto, key, {
					...desc,
					enumerable: false
				});
				else defineBound(proto, key, desc.value);
			}
		}
		/** Shadows a prototype member with an own value, so a getter that builds from the instance runs once. */
		function own(inst, key, value, enumerable = true) {
			Object.defineProperty(inst, key, {
				configurable: true,
				writable: true,
				enumerable,
				value
			});
			return value;
		}
		/** Like {@link own}, for a member that was never an own data property and has to stay out of `Object.keys`. */
		function hide(inst, key, value) {
			return own(inst, key, value, false);
		}
		/** Adds members a table derives from the instance: each builds on first read and shadows as own data, and assignment shadows the same way, as when these were own properties. */
		function derived(computes, table) {
			for (const key in computes) {
				const compute = computes[key];
				Object.defineProperty(table, key, {
					configurable: true,
					enumerable: true,
					get() {
						return own(this, key, compute(this));
					},
					set(value) {
						own(this, key, value);
					}
				});
			}
			return table;
		}
		function defineBound(proto, key, fn) {
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					return this == null ? fn : own(this, key, fn.bind(this));
				},
				set(value) {
					own(this, key, value);
				}
			});
		}
		/** Returns the prototype to install on, or `undefined` if this group is already installed on it. */
		function claim(inst, sentinel) {
			const proto = Object.getPrototypeOf(inst);
			return sentinel in proto ? void 0 : proto;
		}
		let installing;
		let broke = false;
		const breaker = {
			configurable: true,
			get() {
				broke = true;
			}
		};
		/**
		* Installs a lazily-derived internal on the `_zod` prototype of `inst`'s
		* constructor, computed from the internals object itself and cached there on
		* first read. One accessor per constructor rather than one per instance.
		*/
		function defineLazyInternal(inst, key, compute) {
			const proto = Object.getPrototypeOf(inst._zod);
			if (key in proto && installing !== inst._zod) {
				installing = void 0;
				return;
			}
			installing = inst._zod;
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					Object.defineProperty(this, key, breaker);
					const outer = broke;
					broke = false;
					try {
						const value = compute(this);
						if (broke) delete this[key];
						else Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							value
						});
						broke = broke || outer;
						return value;
					} catch (err) {
						delete this[key];
						broke = broke || outer;
						throw err;
					}
				},
				set(value) {
					Object.defineProperty(this, key, {
						configurable: true,
						writable: true,
						value
					});
				}
			});
		}
		/**
		* Installs `key` on `inst`'s prototype, computed by `make` on first read and cached there as an own
		* data property. One accessor per constructor rather than one per instance, because an own accessor
		* puts every instance after the first into v8 dictionary mode. The key doubles as the sentinel.
		*/
		function installLazyProp(inst, key, make, enumerable) {
			const proto = claim(inst, key);
			if (!proto) return;
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					const desc = {
						configurable: true,
						writable: true,
						enumerable,
						value: void 0
					};
					Object.defineProperty(this, key, desc);
					desc.value = make(this);
					Object.defineProperty(this, key, desc);
					return desc.value;
				},
				set(value) {
					Object.defineProperty(this, key, {
						configurable: true,
						writable: true,
						enumerable,
						value
					});
				}
			});
		}
		/** Marks the thunk `_catch` synthesises for a constant catch value. `Function.length` cannot tell that thunk from a user callback — rest and defaulted parameters both report arity 0 — and a user callback reads `ctx.error`, whose issues only finalize correctly against the caller's per-parse error map. Provenance can say what arity cannot. A plain string key rather than `Symbol.for`, whose call at module scope no bundler can prove pure — the same shape that anchored `urlCanParse` into every build. */
		const CONSTANT_CATCH = "~constantCatch";
		/** Wraps a constant catch value in a thunk tagged with {@link CONSTANT_CATCH}. */
		function constantCatch(value) {
			const fn = () => value;
			fn[CONSTANT_CATCH] = true;
			return fn;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/core.js
		var _a$1;
		const _zodDesc = {
			value: void 0,
			enumerable: false
		};
		let _E = "captureStackTrace" in Error ? Error : null;
		function newError(Definition) {
			const E = _E;
			if (E) {
				const saved = E.stackTraceLimit;
				if (typeof saved === "number") {
					try {
						E.stackTraceLimit = 0;
					} catch {
						_E = null;
						return new Definition();
					}
					try {
						return new Definition();
					} finally {
						E.stackTraceLimit = saved;
					}
				}
			}
			return new Definition();
		}
		function $constructor(name, initializer, proto, params) {
			const zodProto = {};
			function Internals(def) {
				this.def = def;
				this.constr = _;
				this.traits = /* @__PURE__ */ new Set();
			}
			Internals.prototype = zodProto;
			const protoMembers = proto;
			const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
			function init(inst, def) {
				if (!inst._zod) {
					_zodDesc.value = new Internals(def);
					try {
						Object.defineProperty(inst, "_zod", _zodDesc);
					} finally {
						_zodDesc.value = void 0;
					}
				} else if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				if (initialized) {
					const own = Object.getPrototypeOf(inst);
					const ctorProto = inst._zod.constr.prototype;
					let up = own;
					while (up && up !== ctorProto) up = Object.getPrototypeOf(up);
					const target = up ?? own;
					if (!initialized.has(target)) {
						initialized.add(target);
						members(target, protoMembers);
					}
				}
				const proto = _.prototype;
				for (const k in proto) {
					if (!Object.prototype.hasOwnProperty.call(proto, k)) continue;
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				const inst = params?.Parent ? newError(Definition) : this;
				init(inst, def);
				const deferred = inst._zod.deferred;
				if (deferred) {
					for (const fn of deferred) fn();
					inst._zod.deferred = void 0;
				}
				const pp = globalThis.__zod_globalConfig?.postProcessor;
				if (pp) pp(inst);
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/errors.js
		function _getMessage() {
			const internals = this._zod;
			internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
			return internals.message;
		}
		function _setMessage(value) {
			this._zod.message = value;
		}
		const _messageDesc = {
			get: _getMessage,
			set: _setMessage,
			enumerable: true,
			configurable: true
		};
		const _issuesDesc = {
			value: void 0,
			enumerable: false
		};
		const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			_issuesDesc.value = def;
			Object.defineProperty(inst, "issues", _issuesDesc);
			_issuesDesc.value = void 0;
			Object.defineProperty(inst, "message", _messageDesc);
			const proto = Object.getPrototypeOf(inst);
			if (!_installedToString.has(proto)) {
				_installedToString.add(proto);
				Object.defineProperty(proto, "toString", {
					configurable: true,
					enumerable: false,
					get() {
						const value = () => this.message;
						Object.defineProperty(this, "toString", {
							value,
							configurable: true,
							writable: true
						});
						return value;
					},
					set(value) {
						Object.defineProperty(this, "toString", {
							value,
							configurable: true,
							writable: true
						});
					}
				});
			}
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		$constructor("$ZodError", initializer$1, void 0, { Parent: Error });
		/** Get-or-create `obj[key]` as an own data property. A path segment naming an inherited member
		* ("toString", "constructor") would otherwise read through to the prototype, and assigning
		* "__proto__" would hit the setter instead of creating a key. */
		function node(obj, key, make) {
			if (!Object.prototype.hasOwnProperty.call(obj, key)) {
				if (key === "__proto__") Object.defineProperty(obj, key, {
					value: make(),
					writable: true,
					enumerable: true,
					configurable: true
				});
				else obj[key] = make();
			}
			return obj[key];
		}
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
			else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							const terminal = i === fullpath.length - 1;
							if (el === "_errors") {
								if (terminal) curr._errors.push(mapper(issue));
								i++;
								continue;
							}
							if (!Object.prototype.hasOwnProperty.call(curr, el)) Object.defineProperty(curr, el, {
								value: { _errors: [] },
								enumerable: true,
								writable: true,
								configurable: true
							});
							const node = curr[el];
							if (terminal) node._errors.push(mapper(issue));
							curr = node;
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/parse.js
		function finalizeParams(callee, params) {
			return {
				callee: params?.callee ?? callee,
				Err: params?.Err
			};
		}
		const _parse = (_Err) => {
			const fn = (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					async: false
				} : { async: false };
				const result = schema._zod.run({
					value,
					issues: []
				}, ctx);
				if (result instanceof Promise) throw new $ZodAsyncError();
				if (result.issues.length) {
					const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
					captureStackTrace(e, _params?.callee ?? fn);
					throw e;
				}
				return result.value;
			};
			return fn;
		};
		const _parseAsync = (_Err) => {
			const fn = async (schema, value, _ctx, params) => {
				const ctx = _ctx ? {
					..._ctx,
					async: true
				} : { async: true };
				let result = schema._zod.run({
					value,
					issues: []
				}, ctx);
				if (result instanceof Promise) result = await result;
				if (result.issues.length) {
					const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
					captureStackTrace(e, params?.callee ?? fn);
					throw e;
				}
				return result.value;
			};
			return fn;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? failure(_Err, result.issues, ctx) : {
				success: true,
				data: result.value
			};
		};
		function failure(Err, issues, ctx) {
			let error;
			return {
				success: false,
				get error() {
					if (!error) {
						error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
						issues = void 0;
						ctx = void 0;
					}
					return error;
				},
				set error(e) {
					error = e;
					issues = void 0;
					ctx = void 0;
				}
			};
		}
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? failure(_Err, result.issues, ctx) : {
				success: true,
				data: result.value
			};
		};
		const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
		const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
		const validate = ((schema, value, _ctx) => {
			const validator = schema._zod.bag.validator;
			if (validator !== void 0) {
				if (validator(value) !== COMPILE_INVALID) return true;
				if (validator.definite === true && _ctx === void 0) return false;
			}
			return validateFallback(schema, value, _ctx);
		});
		function validateFallback(schema, value, _ctx) {
			const ctx = _ctx ? {
				..._ctx,
				async: false,
				abortEarly: true
			} : {
				async: false,
				abortEarly: true
			};
			const fallbackRun = schema._zod.bag.fallbackRun;
			let result;
			if (fallbackRun) {
				ctx[COMPILE_FALLBACK] = true;
				result = fallbackRun({
					value,
					issues: []
				}, ctx);
			} else result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length === 0;
		}
		const validateAsync$1 = async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true,
				abortEarly: true
			} : {
				async: true,
				abortEarly: true
			};
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length === 0;
		};
		const _encode = (_Err) => {
			const parse = _parse(_Err);
			const fn = (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					direction: "backward"
				} : { direction: "backward" };
				return parse(schema, value, ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _decode = (_Err) => {
			const parse = _parse(_Err);
			const fn = (schema, value, _ctx, _params) => {
				return parse(schema, value, _ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _encodeAsync = (_Err) => {
			const parseAsync = _parseAsync(_Err);
			const fn = async (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					direction: "backward"
				} : { direction: "backward" };
				return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _decodeAsync = (_Err) => {
			const parseAsync = _parseAsync(_Err);
			const fn = async (schema, value, _ctx, _params) => {
				return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		function nanoidOfLength(length) {
			return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
		}
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		/** Anchors a pattern source. The interpolation lives here rather than at the call site because
		* esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
		* will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */
		function anchor(source) {
			return new RegExp(`^${source}$`);
		}
		const date = /*@__PURE__*/ anchor(dateSource);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime(args) {
			const opts = ["Z"];
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const qualified = `${timeSource({
				precision: args.precision,
				seconds: true
			})}(?:${opts.join("|")})`;
			const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const anyString = /^[\s\S]{0,}$/;
		const integer = /^-?\d+$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const boolean$1 = /^(?:true|false)$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		/** Default `when` for length-based checks: run only on non-nullish values with a `length`. */
		const _whenHasLength = (payload) => {
			const val = payload.value;
			return !nullish(val) && val.length !== void 0;
		};
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin: numericOriginMap[typeof payload.value] ?? origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin: numericOriginMap[typeof payload.value] ?? origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			def.pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = [], closed = {}) {
				this.content = [];
				this.indent = 0;
				this.args = args;
				this.closed = closed;
			}
			indented(fn) {
				this.indent += 1;
				try {
					fn(this);
				} finally {
					this.indent -= 1;
				}
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const content = this?.content ?? [``];
				return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${content.join("\n")}\n};`)(...Object.values(this.closed));
			}
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 6,
			patch: 5
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const defChecks = inst._zod.def.checks;
			const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					if (payload.memo) return payload;
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							attachSchema(payload.issues, currLen, inst);
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							attachSchema(payload.issues, currLen, inst);
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
		}, {
			get "~standard"() {
				return hide(this, "~standard", standardProps(this));
			},
			set "~standard"(value) {
				own(this, "~standard", value);
			}
		});
		/** The Standard Schema surface for `inst`. Shared so wrappers can extend it without forcing it. */
		const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
		async function validateAsync(inst, value) {
			const ctx = { async: true };
			return toStandardResult(await inst._zod.run({
				value,
				issues: []
			}, ctx), ctx);
		}
		function standardProps(inst) {
			return {
				validate: (value) => {
					const ctx = { async: false };
					try {
						const r = inst._zod.run({
							value,
							issues: []
						}, ctx);
						if (!(r instanceof Promise)) return toStandardResult(r, ctx);
					} catch (_) {}
					return validateAsync(inst, value);
				},
				vendor: "zod",
				version: 1
			};
		}
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = def.pattern ?? anyString;
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		function canParseURL(input) {
			try {
				if (typeof URL !== "undefined" && typeof URL.canParse === "function") return URL.canParse(input);
				new URL(input);
				return true;
			} catch {
				return false;
			}
		}
		function validateURL(trimmed, def) {
			if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) return canParseURL(trimmed) || 2;
			return parseURLObject(trimmed, def);
		}
		/** Parses a URL while preserving the non-normalizing HTTP guard. */
		function parseURLObject(trimmed, def) {
			if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) return 1;
			try {
				if (typeof URL !== "undefined") {
					const URLStatic = URL;
					if (typeof URLStatic.parse === "function") return URLStatic.parse(trimmed) ?? 2;
				}
				return new URL(trimmed);
			} catch {
				return 2;
			}
		}
		const asciiTabOrNewline = /[\t\n\r]/g;
		/** The URL parser deletes every ASCII tab, LF and CR from its input before it parses, so `new URL("https://exa\nmple.com")` reports on `example.com`. Applying the same deletion to the returned value closes the half of that divergence which can move the host; the parser's other rewrite, stripping C0 controls at the edges, cannot. */
		function stripTabAndNewline(value) {
			return value.replace(asciiTabOrNewline, "");
		}
		function urlHostnameOk(url, hostname) {
			hostname.lastIndex = 0;
			return hostname.test(url.hostname);
		}
		function urlProtocolOk(url, protocol) {
			protocol.lastIndex = 0;
			return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
		}
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					const url = validateURL(trimmed, def);
					if (url === 1) {
						payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid URL format",
							input: payload.value,
							inst,
							continue: !def.abort
						});
						return;
					}
					if (url === 2) {
						payload.issues.push({
							code: "invalid_format",
							format: "url",
							input: payload.value,
							inst,
							continue: !def.abort
						});
						return;
					}
					if (url === true) {
						payload.value = stripTabAndNewline(trimmed);
						return;
					}
					if (def.hostname && !urlHostnameOk(url, def.hostname)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid hostname",
						pattern: def.hostname.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
					if (def.protocol && !urlProtocolOk(url, def.protocol)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid protocol",
						pattern: def.protocol.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
					payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1)) throw new Error(`Invalid nanoid length: ${def.length}`);
			def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
		});
		/** An IPv6 address is written with hex digits, colons and dots, and nothing else. The guard is what makes the check below an IPv6 check: `new URL("http://[...]")` parses an authority, not an address, so `@` and `\` re-delimit it and `"::@1\\"` validates against the host `0.0.0.1`. The URL parser also deletes ASCII tab, LF and CR rather than failing, which is how `"::1\n"` validated as `::1`. */
		const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
		function isValidIPv6(value) {
			if (!ipv6Alphabet.test(value)) return false;
			return canParseURL(`http://[${value}]`);
		}
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (!isValidIPv6(payload.value)) payload.issues.push({
					code: "invalid_format",
					format: "ipv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		function isValidCIDRv6(value) {
			const parts = value.split("/");
			if (parts.length !== 2) return false;
			const [address, prefix] = parts;
			if (!prefix) return false;
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) return false;
			if (prefixNum < 0 || prefixNum > 128) return false;
			return isValidIPv6(address);
		}
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (!isValidCIDRv6(payload.value)) payload.issues.push({
					code: "invalid_format",
					format: "cidrv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64Charset);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const base64urlCharset = /^[A-Za-z0-9_-]*$/;
		function isValidBase64URL(data) {
			if (!base64urlCharset.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64urlCharset);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			const memo = globalConfig.memoizer;
			memo?.attach(inst);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
				const proms = [];
				const abortEarly = ctx?.abortEarly;
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else {
						handleArrayResult(result, payload, i);
						if (abortEarly && result.issues.length !== 0 && aborted(result)) break;
					}
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, optin, optout) {
			const isPresent = key in input;
			const isOptionalOut = optout === "optional";
			if (!isPresent && isOptionalOut && optin === "optional") return;
			if (result.issues.length) {
				if (optin !== void 0 && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && optin === void 0) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent || optin === "defaulted" && !isOptionalOut) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		const NO_SYMBOL_KEYS = [];
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			const ownSymbols = Object.getOwnPropertySymbols(def.shape);
			const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
			const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
			for (const k of allKeys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				allKeys,
				symbolKeys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const optin = _catchall.optin;
			const optout = _catchall.optout;
			let seen = 0;
			for (const key in input) {
				if (abortEarly && payload.issues.length !== seen) {
					if (aborted(payload, seen)) break;
					seen = payload.issues.length;
				}
				if (keySet.has(key)) continue;
				if (key === "__proto__") {
					if (t === "never") unrecognized.push(key);
					continue;
				}
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
				else handlePropertyResult(r, payload, key, input, optin, optout);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst,
				continue: true
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			const desc = Object.getOwnPropertyDescriptor(def, "shape");
			const sh = desc?.get ? desc.get.raw : def.shape ?? {};
			if (sh) {
				const get = () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					get.raw = newSh;
					return newSh;
				};
				get.raw = sh;
				Object.defineProperty(def, "shape", { get });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazyInternal(inst, "propValues", (zod) => {
				const shape = zod.def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						if (!Object.prototype.hasOwnProperty.call(propValues, key)) assignProp(propValues, key, /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
						if (field.optin !== void 0) propValues[key].add(void 0);
					}
				}
				return propValues;
			});
			const isObject$2 = isObject;
			const catchall = def.catchall;
			let value;
			const memo = globalConfig.memoizer;
			memo?.attach(inst);
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
				const proms = [];
				const shape = value.shape;
				const abortEarly = ctx?.abortEarly;
				let seen = payload.issues.length;
				for (const key of value.allKeys) {
					if (abortEarly && payload.issues.length !== seen) {
						if (aborted(payload, seen)) break;
						seen = payload.issues.length;
					}
					if (key === "__proto__") continue;
					const el = shape[key];
					const optin = el._zod.optin;
					const optout = el._zod.optout;
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
					else handlePropertyResult(r, payload, key, input, optin, optout);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const memo = globalConfig.memoizer;
			const generateFastpass = (shape) => {
				const normalized = _normalized.value;
				const syms = normalized.symbolKeys;
				const doc = new Doc(["payload", "ctx"], {
					shape,
					inst,
					memo,
					syms
				});
				const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.allKeys) ids[key] = `key_${counter++}`;
				doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
				for (const key of normalized.allKeys) {
					if (key === "__proto__") continue;
					const id = ids[key];
					const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
					const isPresent = `${k} in input`;
					const schema = shape[key];
					const optin = schema?._zod?.optin;
					const isOptionalIn = optin !== void 0;
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(k)};`);
					if (isOptionalIn && isOptionalOut) {
						const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
						doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					} else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
					else {
						doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
						if (optin === "defaulted") doc.write(`newResult[${k}] = ${id}.value;`);
						else doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
					}
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				return doc.compile();
			};
			let fastpass;
			const isObject$1 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
			defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazyInternal(inst, "values", (zod) => {
				if (zod.def.options.every((o) => o._zod.values)) return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazyInternal(inst, "pattern", (zod) => {
				if (zod.def.options.every((o) => o._zod.pattern)) {
					const patterns = zod.def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		function discriminatorMap(def) {
			const map = /* @__PURE__ */ new Map();
			for (const option of def.options) {
				const values = option._zod.propValues?.[def.discriminator];
				if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
				for (const value of values) if (map.has(value)) {
					if (value !== void 0) throw new Error(`Duplicate discriminator value "${String(value)}"`);
					map.set(value, null);
				} else map.set(value, option);
			}
			return map;
		}
		const $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
			def.inclusive = false;
			$ZodUnion.init(inst, def);
			const _super = inst._zod.parse;
			defineLazyInternal(inst, "propValues", (zod) => {
				const propValues = {};
				let undefinedCount = 0;
				for (const option of zod.def.options) {
					const pv = option._zod.propValues;
					if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
					if (pv[zod.def.discriminator]?.has(void 0)) undefinedCount++;
					for (const [k, v] of Object.entries(pv)) {
						if (!Object.prototype.hasOwnProperty.call(propValues, k)) assignProp(propValues, k, /* @__PURE__ */ new Set());
						for (const val of v) propValues[k].add(val);
					}
				}
				if (!zod.def.unionFallback && undefinedCount > 1) propValues[zod.def.discriminator]?.delete(void 0);
				return propValues;
			});
			def.options.forEach((option, i) => {
				const propShape = rawShape(option._zod.def);
				if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) throw new Error(`Invalid discriminated union option at index "${i}"`);
			});
			const disc = cached(() => discriminatorMap(def));
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isObject(input)) {
					payload.issues.push({
						code: "invalid_type",
						expected: "object",
						input,
						inst
					});
					return payload;
				}
				const value = input?.[def.discriminator];
				const opt = disc.value.get(value);
				if (opt && (value !== void 0 || ctx.direction !== "backward")) return opt._zod.run(payload, ctx);
				if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
				payload.issues.push({
					code: "invalid_union",
					errors: [],
					note: "No matching discriminator",
					discriminator: def.discriminator,
					options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
					input,
					path: [def.discriminator],
					inst
				});
				return payload;
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				if (Object.prototype.hasOwnProperty.call(newObj, "__proto__")) delete newObj.__proto__;
				for (const key of sharedKeys) {
					if (key === "__proto__") continue;
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			const keyIssues = /* @__PURE__ */ new Map();
			const collect = (iss, side) => {
				let keys;
				if (iss.code === "unrecognized_keys" && !iss.path?.length) {
					unrecIssue ?? (unrecIssue = iss);
					keys = iss.keys;
				} else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
					const k = String(iss.path[0]);
					if (!keyIssues.has(k)) keyIssues.set(k, iss);
					keys = [k];
				} else return false;
				for (const k of keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k)[side] = true;
				}
				return true;
			};
			for (const iss of left.issues) if (!collect(iss, "l")) result.issues.push(iss);
			for (const iss of right.issues) if (!collect(iss, "r")) result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length) {
				const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
				if (aggregated.length) result.issues.push({
					...unrecIssue,
					keys: aggregated
				});
				for (const k of bothKeys) if (!aggregated.includes(k) && keyIssues.has(k)) result.issues.push(keyIssues.get(k));
			}
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) {
				if (aborted(result)) return result;
				throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			}
			result.value = merged.data;
			return result;
		}
		const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
			$ZodType.init(inst, def);
			const memo = globalConfig.memoizer;
			memo?.attach(inst);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isPlainObject(input)) {
					payload.issues.push({
						expected: "record",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				const proms = [];
				const values = def.keyType._zod.values;
				if (values && !def.partial) {
					payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
					const recordKeys = /* @__PURE__ */ new Set();
					for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
						recordKeys.add(typeof key === "number" ? key.toString() : key);
						if (key === "__proto__") continue;
						const keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (keyResult.issues.length) {
							payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const outKey = keyResult.value;
						if (outKey === "__proto__") continue;
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}
					}
					let unrecognized;
					for (const key in input) if (!recordKeys.has(key)) {
						if (def.mode === "loose") {
							if (key === "__proto__") continue;
							payload.value[key] = input[key];
						} else {
							unrecognized = unrecognized ?? [];
							unrecognized.push(key);
						}
					}
					if (unrecognized && unrecognized.length > 0) payload.issues.push({
						code: "unrecognized_keys",
						input,
						inst,
						keys: unrecognized,
						continue: true
					});
				} else {
					payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
					let unrecognized;
					for (const key of Reflect.ownKeys(input)) {
						if (key === "__proto__") continue;
						if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
						let keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
							const retryResult = def.keyType._zod.run({
								value: Number(key),
								issues: []
							}, ctx);
							if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
							if (retryResult.issues.length === 0) keyResult = retryResult;
						}
						if (keyResult.issues.length) {
							if (def.mode === "loose") payload.value[key] = input[key];
							else if (values) {
								unrecognized = unrecognized ?? [];
								unrecognized.push(key);
							} else payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const outKey = keyResult.value;
						if (outKey === "__proto__") continue;
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}
					}
					if (unrecognized && unrecognized.length > 0) payload.issues.push({
						code: "unrecognized_keys",
						input,
						inst,
						keys: unrecognized,
						continue: true
					});
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			defineLazyInternal(inst, "pattern", (zod) => {
				const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
				return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
			});
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
			$ZodType.init(inst, def);
			const values = new Set(def.values);
			inst._zod.values = values;
			defineLazyInternal(inst, "pattern", (zod) => {
				const vals = zod.def.values;
				return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
			});
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (values.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values: def.values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			globalConfig.memoizer?.guard(inst);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				return payload;
			};
		});
		function handleOptionalResult(payload, result) {
			payload.value = result.issues.length ? void 0 : result.value;
			return payload;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
			inst._zod.optout = "optional";
			defineLazyInternal(inst, "values", (zod) => {
				const values = zod.def.innerType._zod.values;
				return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
			});
			defineLazyInternal(inst, "pattern", (zod) => {
				const pattern = zod.def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === void 0) {
					if (def.innerType._zod.optin !== "defaulted") return payload;
					const result = def.innerType._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) return result.then((result) => handleOptionalResult(payload, result));
					return handleOptionalResult(payload, result);
				}
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
			defineLazyInternal(inst, "pattern", (zod) => {
				const pattern = zod.def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazyInternal(inst, "values", (zod) => {
				return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "defaulted";
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "defaulted";
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => {
				const v = zod.def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		function handleCatchResult(payload, result, def, ctx) {
			if (!result.issues.length) {
				payload.value = result.value;
				if (result.memo) payload.memo = true;
				return payload;
			}
			payload.value = def.catchValue({
				...result,
				value: payload.value,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run({
					value: payload.value,
					issues: []
				}, ctx);
				if (result instanceof Promise) return result.then((result) => handleCatchResult(payload, result, def, ctx));
				return handleCatchResult(payload, result, def, ctx);
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
			defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
			defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			if (!payload.memo) payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/memoizer.js
		var $ZodCyclicError = class extends Error {
			constructor() {
				super(`Cannot parse a reference cycle that closes through a transform`);
				this.name = "ZodCyclicError";
			}
		};
		/** Keyed off the context object every schema in one parse call already shares. */
		const STATE = "~memo";
		const NO_ISSUES = [];
		function isRef(value) {
			return value !== null && typeof value === "object";
		}
		function cloneIssues(issues) {
			return issues.map((iss) => iss.path ? {
				...iss,
				path: iss.path.slice()
			} : { ...iss });
		}
		const recursive = /*@__PURE__*/ new WeakMap();
		/** What the walk established, in order of certainty: ordered so the strongest answer among children wins. */
		const NONE = 0;
		const ASSUMED = 1;
		const PROVEN = 2;
		/** Whether this schema's subtree contains a cycle, so one parse can re-enter it. */
		function isRecursive(inst, stack, resolve) {
			const cached = recursive.get(inst);
			if (cached !== void 0) return cached ? PROVEN : NONE;
			if (stack.has(inst)) return PROVEN;
			stack.add(inst);
			let result = NONE;
			const check = (child) => {
				if (result !== PROVEN && child?._zod) {
					const answer = isRecursive(child, stack, resolve);
					if (answer > result) result = answer;
				}
			};
			const shape = (sh, spread) => {
				let answer = NONE;
				for (const key of Reflect.ownKeys(sh)) {
					const desc = Object.getOwnPropertyDescriptor(sh, key);
					if (spread && !desc.enumerable) continue;
					const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
					if (child > answer) answer = child;
				}
				return answer;
			};
			const merge = (answer) => {
				if (answer > result) result = answer;
			};
			const def = inst._zod.def;
			switch (def.type) {
				case "object": {
					const raw = rawShape(def);
					merge(raw ? shape(raw, true) : ASSUMED);
					check(def.catchall);
					break;
				}
				case "array":
					check(def.element);
					break;
				case "tuple":
					for (const el of def.items) check(el);
					check(def.rest);
					break;
				case "record":
				case "map":
					check(def.keyType);
					check(def.valueType);
					break;
				case "set":
					check(def.valueType);
					break;
				case "union":
					for (const el of def.options) check(el);
					break;
				case "intersection":
					check(def.left);
					check(def.right);
					break;
				case "optional":
				case "nullable":
				case "default":
				case "prefault":
				case "catch":
				case "readonly":
				case "nonoptional":
				case "promise":
				case "success":
					check(def.innerType);
					break;
				case "pipe":
					check(def.in);
					check(def.out);
					break;
				case "function":
					check(def.input);
					check(def.output);
					break;
				case "lazy": {
					const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
					merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
					break;
				}
				case "template_literal":
				case "string":
				case "number":
				case "int":
				case "boolean":
				case "bigint":
				case "symbol":
				case "undefined":
				case "null":
				case "void":
				case "never":
				case "any":
				case "unknown":
				case "date":
				case "nan":
				case "enum":
				case "literal":
				case "file":
				case "transform":
				case "custom": break;
				default: for (const key in def) {
					const desc = Object.getOwnPropertyDescriptor(def, key);
					if (!desc || desc.get) continue;
					const value = desc.value;
					if (!value || typeof value !== "object") continue;
					if (value._zod) check(value);
					else if (Array.isArray(value)) for (const el of value) check(el);
				}
			}
			stack.delete(inst);
			return settle(inst, result);
		}
		/** An assumed answer must not outlive the resolution that settles it, so only a certain one is cached. */
		function settle(inst, answer) {
			if (answer !== ASSUMED) recursive.set(inst, answer === PROVEN);
			return answer;
		}
		function bucketFor(state, inst) {
			let bucket = state.buckets.get(inst);
			if (!bucket) {
				bucket = /* @__PURE__ */ new WeakMap();
				state.buckets.set(inst, bucket);
			}
			return bucket;
		}
		let handoff;
		const open = [];
		const memo = {
			alloc(_inst, payload, empty) {
				const bucket = handoff;
				if (!bucket) return empty;
				handoff = void 0;
				const entry = {
					value: empty,
					issues: null
				};
				bucket.set(payload.value, entry);
				open.push(entry);
				return empty;
			},
			guard(inst) {
				var _a;
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred.push(() => {
					const base = inst._zod.parse;
					const wrapped = (payload, ctx) => {
						if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value)) throw new $ZodCyclicError();
						return base(payload, ctx);
					};
					inst._zod.parse = wrapped;
					if (inst._zod.run === base) inst._zod.run = wrapped;
				});
			},
			attach(inst) {
				var _a;
				let isRecursiveInst;
				let rechecked = false;
				let lastCtx;
				let lastBucket;
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred.push(() => {
					const base = inst._zod.parse;
					const wrapped = (payload, ctx) => {
						if (isRecursiveInst === void 0) {
							const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
							if (walked === NONE) {
								inst._zod.parse = base;
								if (inst._zod.run === wrapped) inst._zod.run = base;
								return base(payload, ctx);
							}
							if (walked === PROVEN || rechecked) isRecursiveInst = true;
							else rechecked = true;
						}
						const input = payload.value;
						if (!isRef(input)) return base(payload, ctx);
						let state = ctx[STATE];
						if (!state) {
							state = {
								buckets: /* @__PURE__ */ new WeakMap(),
								backEdges: void 0
							};
							ctx[STATE] = state;
						}
						let bucket;
						if (lastCtx === ctx) bucket = lastBucket;
						else {
							bucket = bucketFor(state, inst);
							lastCtx = ctx;
							lastBucket = bucket;
						}
						const hit = bucket.get(input);
						if (hit) {
							payload.value = hit.value;
							if (hit.issues) {
								if (hit.issues.length) payload.issues.push(...cloneIssues(hit.issues));
							} else {
								payload.memo = true;
								state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
								state.backEdges.add(hit.value);
							}
							return payload;
						}
						handoff = bucket;
						const depth = open.length;
						const result = base(payload, ctx);
						handoff = void 0;
						const entry = open.length > depth ? open.pop() : void 0;
						if (result instanceof Promise) return result.then((r) => {
							if (entry) entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
							return r;
						});
						if (entry) entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
						return result;
					};
					inst._zod.parse = wrapped;
					if (inst._zod.run === base) inst._zod.run = wrapped;
				});
			}
		};
		/** The memoizer that gives containers cycle support. `zod` installs it by default; `zod/mini` opts in with `config({ memoizer: memoizer() })`. */
		function memoizer() {
			return memo;
		}
		/** Whether this value is a node a back-edge resolved to before it finished. */
		function isBackEdge(ctx, value) {
			const backEdges = ctx[STATE]?.backEdges;
			return backEdges !== void 0 && isRef(value) && backEdges.has(value);
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/locales/en.js
		const error = () => {
			const Sizable = {
				string: {
					unit: "characters",
					verb: "to have"
				},
				file: {
					unit: "bytes",
					verb: "to have"
				},
				array: {
					unit: "items",
					verb: "to have"
				},
				set: {
					unit: "items",
					verb: "to have"
				},
				map: {
					unit: "entries",
					verb: "to have"
				}
			};
			function getSizing(origin) {
				return Sizable[origin] ?? null;
			}
			const FormatDictionary = {
				regex: "input",
				email: "email address",
				url: "URL",
				emoji: "emoji",
				uuid: "UUID",
				uuidv4: "UUIDv4",
				uuidv6: "UUIDv6",
				nanoid: "nanoid",
				guid: "GUID",
				cuid: "cuid",
				cuid2: "cuid2",
				ulid: "ULID",
				xid: "XID",
				ksuid: "KSUID",
				datetime: "ISO datetime",
				date: "ISO date",
				time: "ISO time",
				duration: "ISO duration",
				ipv4: "IPv4 address",
				ipv6: "IPv6 address",
				mac: "MAC address",
				cidrv4: "IPv4 range",
				cidrv6: "IPv6 range",
				base64: "base64-encoded string",
				base64url: "base64url-encoded string",
				json_string: "JSON string",
				e164: "E.164 number",
				currency_code: "currency code",
				credit_card: "credit card number",
				iban: "IBAN",
				jwt: "JWT",
				template_literal: "input"
			};
			const TypeDictionary = { nan: "NaN" };
			function getTypeName(type, input) {
				if (type === "number" && typeof input === "number" && !Number.isFinite(input)) return String(input);
				return TypeDictionary[type] ?? type;
			}
			return (issue) => {
				switch (issue.code) {
					case "invalid_type": return `Invalid input: expected ${getTypeName(issue.expected)}, received ${getTypeName(parsedType(issue.input), issue.input)}`;
					case "invalid_value":
						if (issue.values.length === 1) return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
						return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
					case "too_big": {
						const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
						const sizing = getSizing(issue.origin);
						if (sizing) return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
						return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
					}
					case "too_small": {
						const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
						const sizing = getSizing(issue.origin);
						if (sizing) return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
						return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
					}
					case "invalid_format": {
						const _issue = issue;
						if (_issue.format === "starts_with") return `Invalid string: must start with "${_issue.prefix}"`;
						if (_issue.format === "ends_with") return `Invalid string: must end with "${_issue.suffix}"`;
						if (_issue.format === "includes") return `Invalid string: must include "${_issue.includes}"`;
						if (_issue.format === "regex") return `Invalid string: must match pattern ${_issue.pattern}`;
						return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
					}
					case "not_multiple_of": return `Invalid number: must be a multiple of ${issue.divisor}`;
					case "unrecognized_keys": return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
					case "invalid_key": return `Invalid key in ${issue.origin}`;
					case "invalid_union":
						if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
						if (issue.inclusive === false) return "Invalid input: more than one option matched";
						return "Invalid input";
					case "invalid_element": return `Invalid value in ${issue.origin}`;
					default: return `Invalid input`;
				}
			};
		};
		function en_default() {
			return { localeError: error() };
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/api.js
		function snapshotChecks(def) {
			if (def.checks) def.checks = [...def.checks];
			return def;
		}
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class(snapshotChecks({
				type: "string",
				...normalizeParams(params)
			}));
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class(snapshotChecks({
				type: "number",
				checks: [],
				...normalizeParams(params)
			}));
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						if (!("input" in _issue)) _issue.input = payload.value;
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/to-json-schema.js
		function assignProps(target, ...sources) {
			for (const source of sources) for (const key of Reflect.ownKeys(source)) if (Object.prototype.propertyIsEnumerable.call(source, key)) assignProp(target, key, source[key]);
			return target;
		}
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				sharedDefsExtractedFor: void 0,
				sharedEmitDoneFor: void 0,
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				intersections: [],
				deferred: [],
				external: params?.external ?? void 0
			};
		}
		/**
		* Applies the `unrepresentable` setting at a site that has no JSON Schema equivalent. Throws
		* `message` unless the setting (or the handler's return value) says otherwise. Returns `true` if a
		* custom JSON Schema was written into `json`, in which case the caller must not write its own.
		*/
		function handleUnrepresentable(schema, ctx, json, params, message) {
			const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({
				zodSchema: schema,
				path: params.path,
				message
			}) : ctx.unrepresentable;
			if (result === "any") return false;
			if (result === void 0 || result === "throw") throw new Error(message);
			Object.assign(json, result);
			return true;
		}
		function processSchema(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			ctx.sharedDefsExtractedFor = void 0;
			ctx.sharedEmitDoneFor = void 0;
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					processSchema(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) assignProps(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function encodeJSONPointerSegment(segment) {
			return segment.replace(/~/g, "~0").replace(/\//g, "~1");
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external) return;
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}`
					};
				}
				const uriPrefix = `#`;
				const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
				if (entry[1] === root && !entry[1].schema.id) return { ref: uriPrefix };
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + encodeJSONPointerSegment(defId)
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") extractToDef(entry);
				}
			}
			if (ctx.external) ctx.sharedDefsExtractedFor = ctx.external;
		}
		/** Rewrites `anyOf: [{type: "a"}, {type: "b"}]` to `type: ["a", "b"]`, which every JSON Schema draft treats as equivalent and most consumers render far better for the nullable case. Only branches that are a bare type assertion qualify — anything carrying a constraint, `$ref`, `const` or metadata is left alone. Runs after `flattenRef`, so a branch an override decorated or `$defs` extraction turned into a `$ref` is no longer bare and correctly stays in `anyOf`. `oneOf` is excluded: `integer` and `number` overlap, so "exactly one" and "at least one" are not the same there. OpenAPI 3.0 is excluded: its `type` must be a single string. */
		function compactTypeUnion(schema) {
			const options = schema.anyOf;
			if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0) return;
			const types = [];
			for (const option of options) {
				if (!option || typeof option !== "object") return;
				compactTypeUnion(option);
				const keys = Object.keys(option);
				if (keys.length !== 1 || keys[0] !== "type") return;
				const type = option.type;
				for (const member of Array.isArray(type) ? type : [type]) {
					if (typeof member !== "string") return;
					if (!types.includes(member)) types.push(member);
				}
			}
			delete schema.anyOf;
			schema.type = types.length === 1 ? types[0] : types;
		}
		/** Keywords `foldIntersection` knows how to combine. Anything else — `$ref`, `patternProperties`,
		* an annotation like `description` — makes a member unfoldable, so a constraint this does not
		* understand leaves the `allOf` alone instead of being silently dropped or misattributed. */
		const FOLDABLE_KEYS = /* @__PURE__ */ new Set([
			"type",
			"properties",
			"required",
			"additionalProperties"
		]);
		const UNION_KEYS = ["oneOf", "anyOf"];
		/** A member's constraint on a key it does not declare itself. A `catchall` states one; `false`, an absent `additionalProperties`, and the empty schema a loose object emits state nothing. */
		function undeclaredConstraint(member) {
			const extra = member.additionalProperties;
			if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null) return null;
			return Object.keys(extra).length ? extra : null;
		}
		/** Combines object members into the single object they describe together, or returns `null` if any of them carries a keyword outside {@link FOLDABLE_KEYS}. */
		function foldObjects(members) {
			const objects = [];
			for (const member of members) {
				if (typeof member !== "object" || member.type !== "object") return null;
				for (const key in member) if (!FOLDABLE_KEYS.has(key)) return null;
				objects.push(member);
			}
			const properties = {};
			const required = /* @__PURE__ */ new Set();
			for (const object of objects) {
				for (const key in object.properties) {
					if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
					const parts = [];
					for (const other of objects) {
						const part = other.properties?.[key] ?? undeclaredConstraint(other);
						if (part === null || part === void 0) continue;
						if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part))) parts.push(part);
					}
					assignProp(properties, key, parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts });
				}
				for (const key of object.required ?? []) required.add(key);
			}
			const folded = {
				type: "object",
				properties
			};
			if (required.size) folded.required = [...required];
			if (objects.every((object) => object.additionalProperties === false)) folded.additionalProperties = false;
			else {
				const constraints = [];
				for (const object of objects) {
					const constraint = undeclaredConstraint(object);
					if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint))) constraints.push(constraint);
				}
				if (constraints.length === 1) folded.additionalProperties = constraints[0];
				else if (constraints.length > 1) folded.additionalProperties = { allOf: constraints };
			}
			return folded;
		}
		/** `additionalProperties` in an `allOf` member sees only that member's own `properties`, so two
		* closed object members reject each other's keys and the schema validates nothing. Zod's parser
		* pools the key sets instead — `handleIntersectionResults` reports a key as unrecognized only when
		* *every* side rejects it — so the emitted schema has to pool them too, and folding the members
		* into one object is the encoding that says so on every target.
		*
		* This runs from `finalize`, after `extractDefs`, which is what keeps it clear of the `$ref`
		* machinery: a member extracted into `$defs` is already a `$ref` by now and declines to fold, so it
		* keeps its reference and its own closedness rather than being inlined as a stale copy. */
		function foldIntersection(json) {
			const allOf = json.allOf;
			if (!Array.isArray(allOf) || allOf.length < 2) return;
			for (const key of FOLDABLE_KEYS) if (key in json) return;
			const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
			let folded = null;
			if (!unions.length) folded = foldObjects(allOf);
			else {
				const union = unions[0];
				const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
				if (Object.keys(union).length !== 1) return;
				const rest = allOf.filter((m) => m !== union);
				const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
				if (branches.some((b) => !b)) return;
				folded = { [keyword]: branches };
			}
			if (!folded) return;
			delete json.allOf;
			assignProps(json, folded);
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else assignProps(schema, refSchema);
					assignProps(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
				for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
				if (ctx.target !== "openapi-3.0") for (const entry of ctx.seen.entries()) compactTypeUnion(entry[1].def ?? entry[1].schema);
				for (const rewrite of ctx.deferred) rewrite();
				if (ctx.intersections.length) {
					const carriers = /* @__PURE__ */ new Map();
					for (const seen of ctx.seen.values()) for (const json of [seen.schema, seen.def]) {
						const allOf = json?.allOf;
						if (!Array.isArray(allOf)) continue;
						const existing = carriers.get(allOf);
						if (existing) existing.push(json);
						else carriers.set(allOf, [json]);
					}
					for (const allOf of ctx.intersections) for (const json of carriers.get(allOf) ?? []) foldIntersection(json);
				}
			}
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					assignProp(defs, seen.defId, seen.def);
				}
			}
			if (ctx.external) ctx.sharedEmitDoneFor = ctx.external;
			if (ctx.external) {} else if (Object.keys(defs).length > 0) {
				if (ctx.target === "draft-2020-12") result.$defs = defs;
				else result.definitions = defs;
			}
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			processSchema(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			processSchema(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/json-schema-processors.js
		const narrowMin = (agg, key, value) => {
			if (agg[key] === void 0 || value > agg[key]) agg[key] = value;
		};
		const narrowMax = (agg, key, value) => {
			if (agg[key] === void 0 || value < agg[key]) agg[key] = value;
		};
		const narrowBoth = (agg, value) => {
			narrowMin(agg, "minimum", value);
			narrowMax(agg, "maximum", value);
		};
		const addDivisor = (agg, value) => {
			agg.multipleOf ?? (agg.multipleOf = []);
			if (!agg.multipleOf.includes(value)) agg.multipleOf.push(value);
		};
		const addPattern = (agg, pattern) => {
			agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
			agg.patterns.add(pattern);
		};
		const intersectMime = (agg, mime) => {
			agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
		};
		const setFormat = (agg, format) => {
			agg.format = format;
			if (format.includes("int")) agg.isInt = true;
		};
		const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
		const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
		const formatContributor = (ranges) => (agg, def) => {
			setFormat(agg, def.format);
			const [minimum, maximum] = ranges[def.format];
			narrowMin(agg, "minimum", minimum);
			narrowMax(agg, "maximum", maximum);
		};
		const contributors = {
			greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
			less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
			multiple_of: (agg, def) => addDivisor(agg, def.value),
			number_format: formatContributor(NUMBER_FORMAT_RANGES),
			bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
			min_length: minContributor,
			max_length: maxContributor,
			length_equals: (agg, def) => narrowBoth(agg, def.length),
			min_size: minContributor,
			max_size: maxContributor,
			size_equals: (agg, def) => narrowBoth(agg, def.size),
			string_format: (agg, def) => {
				setFormat(agg, def.format);
				if (def.pattern) addPattern(agg, def.pattern);
				if (def.format === "base64" || def.format === "base64url") agg.contentEncoding = def.format;
				if (def.local || def.precision === -1) agg.laxFormat = true;
			},
			mime_type: (agg, def) => intersectMime(agg, def.mime)
		};
		function aggregateChecks(schema) {
			const agg = {};
			const def = schema._zod.def;
			const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
			for (const ch of list) contributors[ch._zod.def.check]?.(agg, ch._zod.def);
			const bag = schema._zod.bag;
			if (bag.minimum !== void 0) narrowMin(agg, "minimum", bag.minimum);
			if (bag.exclusiveMinimum !== void 0) narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
			if (bag.maximum !== void 0) narrowMax(agg, "maximum", bag.maximum);
			if (bag.exclusiveMaximum !== void 0) narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
			if (bag.multipleOf !== void 0) addDivisor(agg, bag.multipleOf);
			if (bag.format !== void 0) {
				agg.format ?? (agg.format = bag.format);
				if (bag.format.includes("int")) agg.isInt = true;
			}
			if (bag.mime) intersectMime(agg, bag.mime);
			for (const pattern of bag.patterns ?? []) addPattern(agg, pattern);
			return agg;
		}
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const exactPatterns = /* @__PURE__ */ new Map([[base64Charset, base64], [base64urlCharset, base64url]]);
		const exactPattern = (p) => exactPatterns.get(p) ?? p;
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time" || laxFormat) delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const patternList = [...patterns].map(exactPattern);
				if (patternList.length === 1) json.pattern = patternList[0].source;
				else if (patternList.length > 1) json.allOf = [...patternList.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
			json.type = isInt ? "integer" : "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) {
				if (legacy) {
					json.minimum = exclusiveMinimum;
					json.exclusiveMinimum = true;
				} else json.exclusiveMinimum = exclusiveMinimum;
			} else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) {
				if (legacy) {
					json.maximum = exclusiveMaximum;
					json.exclusiveMaximum = true;
				} else json.exclusiveMaximum = exclusiveMaximum;
			} else if (typeof maximum === "number") json.maximum = maximum;
			if (multipleOf) {
				const divisors = /* @__PURE__ */ new Set();
				for (const divisor of multipleOf) if (Number.isFinite(divisor) && divisor !== 0) divisors.add(Math.abs(divisor));
				else handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
				const [first, ...rest] = divisors;
				if (first !== void 0) json.multipleOf = first;
				if (rest.length) json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
			}
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.length === 0) {
				json.not = {};
				return;
			}
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			if (def.values.length === 0) {
				json.not = {};
				return;
			}
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema")) return;
			} else if (typeof val === "bigint") {
				if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema")) return;
				vals.push(Number(val));
			} else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const customProcessor = (schema, ctx, json, params) => {
			handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (schema, ctx, json, params) => {
			handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = aggregateChecks(schema);
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = processSchema(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		function inputOptin(schema) {
			const def = schema._zod.def;
			if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) return inputOptin(def.out);
			if (def.type === "catch") return inputOptin(def.innerType);
			return schema._zod.optin;
		}
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const shape = def.shape;
			if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) return;
			json.type = "object";
			json.properties = {};
			for (const key in shape) assignProp(json.properties, key, processSchema(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			}));
			const requiredKeys = [];
			for (const key of Object.keys(shape)) {
				const field = def.shape[key];
				if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) requiredKeys.push(key);
			}
			if (requiredKeys.length > 0) json.required = requiredKeys;
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = processSchema(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => processSchema(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = processSchema(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = processSchema(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			const allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
			json.allOf = allOf;
			ctx.intersections.push(allOf);
		};
		/** JSON object keys are always strings, so a numeric record key schema is re-expressed over the
		* numeric-string form the record parser matches. Deferred to `finalize`, after the flatten: a key
		* behind a wrapper only carries its own `type` before then, and a union key only has its branches.
		*
		* A numeric bound cannot apply to a property name, so `minimum` and its siblings are dropped rather
		* than carried over: keeping them beside `type: "string"` reproduces the match-nothing schema this
		* exists to fix. A key that carries one therefore emits wider than the record parses — `z.record(z.number().min(5), V)`
		* accepts `"3"` — which is the deliberate trade, since throwing on it would reject an ordinary schema
		* outright. */
		function stringifyKeyNames(bySchema, json, visited) {
			if (json.$ref) {
				if (visited.has(json)) return json;
				visited.add(json);
				const def = bySchema.get(json)?.def;
				if (!def) return json;
				const inlined = stringifyKeyNames(bySchema, def, visited);
				return inlined === def ? json : inlined;
			}
			for (const keyword of ["anyOf", "oneOf"]) {
				const branches = json[keyword];
				if (!Array.isArray(branches)) continue;
				const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
				if (mapped.some((branch, i) => branch !== branches[i])) json = {
					...json,
					[keyword]: mapped
				};
			}
			const types = Array.isArray(json.type) ? json.type : [json.type];
			const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
			const values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
			if (!numericType && !values?.some((v) => typeof v === "number")) return json;
			const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
			if (rest.enum) rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
			else if (typeof rest.const === "number") rest.const = String(rest.const);
			if (!numericType) return rest;
			rest.type = "string";
			if (!values) rest.pattern = (types.includes("number") ? number$1 : integer).source;
			return rest;
		}
		/** Every record of one conversion, so the carriers are found in a single pass rather than once per record. */
		const pendingRecords = /* @__PURE__ */ new WeakMap();
		function rewriteKeyNames(ctx) {
			const bySchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.values()) if (entry.def && !bySchema.has(entry.schema)) bySchema.set(entry.schema, entry);
			const rewrites = /* @__PURE__ */ new Map();
			for (const record of pendingRecords.get(ctx) ?? []) {
				const seen = ctx.seen.get(record);
				const names = (seen?.def ?? seen?.schema)?.propertyNames;
				if (!names || names === true || rewrites.has(names)) continue;
				const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
				if (rewritten !== names) rewrites.set(names, rewritten);
			}
			if (!rewrites.size) return;
			for (const entry of ctx.seen.values()) for (const carrier of [entry.schema, entry.def]) {
				const rewritten = carrier && rewrites.get(carrier.propertyNames);
				if (rewritten) carrier.propertyNames = rewritten;
			}
		}
		const recordProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			const keyType = def.keyType;
			const patterns = aggregateChecks(keyType).patterns;
			if (def.mode === "loose" && patterns && patterns.size > 0) {
				const valueSchema = processSchema(def.valueType, ctx, {
					...params,
					path: [
						...params.path,
						"patternProperties",
						"*"
					]
				});
				json.patternProperties = {};
				for (const pattern of patterns) assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
			} else {
				if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
					json.propertyNames = processSchema(def.keyType, ctx, {
						...params,
						path: [...params.path, "propertyNames"]
					});
					let pending = pendingRecords.get(ctx);
					if (!pending) {
						pending = [];
						pendingRecords.set(ctx, pending);
						ctx.deferred.push(() => rewriteKeyNames(ctx));
					}
					pending.push(schema);
				}
				json.additionalProperties = processSchema(def.valueType, ctx, {
					...params,
					path: [...params.path, "additionalProperties"]
				});
			}
			const keyValues = keyType._zod.values;
			const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
			if (keyValues && !def.partial && !omittableOnInput) {
				const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
				if (validKeyValues.length > 0) json.required = validKeyValues.map(String);
			}
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		/** Round-trips a default value through JSON so the emitted schema is guaranteed to be valid JSON.
		* A BigInt has no reliable encoding, so it goes through `unrepresentable` like any other
		* unrepresentable value. Returns a sentinel when the caller must not write a default of its own. */
		const UNREPRESENTABLE_DEFAULT = Symbol();
		function serializeDefaultValue(value, schema, ctx, json, params) {
			let unrepresentable = false;
			const serialized = JSON.stringify(value, (_, val) => {
				if (typeof val !== "bigint") return val;
				unrepresentable = true;
				return null;
			});
			if (!unrepresentable) return JSON.parse(serialized);
			handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
			return UNREPRESENTABLE_DEFAULT;
		}
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
			if (value !== UNREPRESENTABLE_DEFAULT) json.default = value;
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io !== "input") return;
			const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
			if (value !== UNREPRESENTABLE_DEFAULT) json._prefault = value;
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
				return;
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			processSchema(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/errors.js
		const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
		function _lazyMethod(proto, key, make) {
			Object.defineProperty(proto, key, {
				configurable: true,
				enumerable: false,
				get() {
					const value = make(this);
					Object.defineProperty(this, key, {
						value,
						configurable: true,
						writable: true
					});
					return value;
				},
				set(value) {
					Object.defineProperty(this, key, {
						value,
						configurable: true,
						writable: true
					});
				}
			});
		}
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			const proto = Object.getPrototypeOf(inst);
			if (_installedErrorProtos.has(proto)) return;
			_installedErrorProtos.add(proto);
			_lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
			_lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
			_lazyMethod(proto, "addIssue", (self) => (issue) => {
				self.issues.push(issue);
				self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
			});
			_lazyMethod(proto, "addIssues", (self) => (issues) => {
				self.issues.push(...issues);
				self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
			});
			Object.defineProperty(proto, "isEmpty", {
				configurable: true,
				enumerable: false,
				get() {
					return this.issues.length === 0;
				}
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, void 0, { Parent: Error });
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/schemas.js
		function _ensureDefaultLocale() {
			if (!globalConfig.localeError) config(en_default());
		}
		function _ensureDefaultMemoizer() {
			if (!globalConfig.memoizer) config({ memoizer: memoizer() });
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			_ensureDefaultLocale();
			$ZodType.init(inst, def);
			inst.def = def;
			inst.type = def.type;
			return inst;
		}, {
			check(...chks) {
				const def = this.def;
				return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
					check: ch,
					def: { check: "custom" },
					onattach: []
				} } : ch)] }), { parent: true });
			},
			with(...chks) {
				return this.check(...chks);
			},
			clone(def, params) {
				return clone$1(this, def, params);
			},
			brand() {
				return this;
			},
			register(reg, meta) {
				reg.add(this, meta);
				return this;
			},
			refine(check, params) {
				return this.check(refine(check, params));
			},
			superRefine(refinement, params) {
				return this.check(superRefine(refinement, params));
			},
			overwrite(fn) {
				return this.check(/* @__PURE__ */ _overwrite(fn));
			},
			optional() {
				return optional(this);
			},
			exactOptional() {
				return exactOptional(this);
			},
			nullable() {
				return nullable(this);
			},
			nullish() {
				return optional(nullable(this));
			},
			nonoptional(params) {
				return nonoptional(this, params);
			},
			array() {
				return array(this);
			},
			or(arg) {
				return union([this, arg]);
			},
			and(arg) {
				return intersection(this, arg);
			},
			transform(tx) {
				return pipe(this, transform(tx));
			},
			default(d) {
				return _default(this, d);
			},
			prefault(d) {
				return prefault(this, d);
			},
			catch(params) {
				return _catch(this, params);
			},
			pipe(target) {
				return pipe(this, target);
			},
			readonly() {
				return readonly(this);
			},
			describe(description) {
				const cl = this.clone();
				globalRegistry.add(cl, { description });
				return cl;
			},
			meta(...args) {
				if (args.length === 0) return globalRegistry.get(this);
				const cl = this.clone();
				globalRegistry.add(cl, args[0]);
				return cl;
			},
			isOptional() {
				return this.safeParse(void 0).success;
			},
			isNullable() {
				return this.safeParse(null).success;
			},
			apply(fn, ...args) {
				return args.length === 0 ? fn(this) : fn(this, ...args);
			},
			get "~standard"() {
				return hide(this, "~standard", {
					...standardProps(this),
					jsonSchema: {
						input: createStandardJSONSchemaMethod(this, "input"),
						output: createStandardJSONSchemaMethod(this, "output")
					}
				});
			},
			set "~standard"(value) {
				own(this, "~standard", value);
			},
			parse: function _parse(data, params) {
				return parse(this, data, params, { callee: _parse });
			},
			parseAsync: async function _parseAsync(data, params) {
				return await parseAsync(this, data, params, { callee: _parseAsync });
			},
			safeParse(data, params) {
				return safeParse(this, data, params);
			},
			async safeParseAsync(data, params) {
				return safeParseAsync(this, data, params);
			},
			get spa() {
				return this?.safeParseAsync;
			},
			set spa(value) {
				own(this, "spa", value);
			},
			validate(data, params) {
				return validate(this, data, params);
			},
			validateAsync(data, params) {
				return validateAsync$1(this, data, params);
			},
			encode: function _encode(data, params) {
				return encode(this, data, params, { callee: _encode });
			},
			decode: function _decode(data, params) {
				return decode(this, data, params, { callee: _decode });
			},
			encodeAsync: async function _encodeAsync(data, params) {
				return await encodeAsync(this, data, params, { callee: _encodeAsync });
			},
			decodeAsync: async function _decodeAsync(data, params) {
				return await decodeAsync(this, data, params, { callee: _decodeAsync });
			},
			safeEncode(data, params) {
				return safeEncode(this, data, params);
			},
			safeDecode(data, params) {
				return safeDecode(this, data, params);
			},
			async safeEncodeAsync(data, params) {
				return safeEncodeAsync(this, data, params);
			},
			async safeDecodeAsync(data, params) {
				return safeDecodeAsync(this, data, params);
			},
			toJSONSchema(params) {
				return createToJSONSchemaMethod(this, {})(params);
			},
			get description() {
				return globalRegistry.get(this)?.description;
			},
			get _def() {
				return this._zod.def;
			}
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
		}, /*@__PURE__*/ derived({
			format: (inst) => aggregateChecks(inst).format ?? null,
			minLength: (inst) => aggregateChecks(inst).minimum ?? null,
			maxLength: (inst) => aggregateChecks(inst).maximum ?? null
		}, {
			regex(...args) {
				return this.check(/* @__PURE__ */ _regex(...args));
			},
			includes(...args) {
				return this.check(/* @__PURE__ */ _includes(...args));
			},
			startsWith(...args) {
				return this.check(/* @__PURE__ */ _startsWith(...args));
			},
			endsWith(...args) {
				return this.check(/* @__PURE__ */ _endsWith(...args));
			},
			min(...args) {
				return this.check(/* @__PURE__ */ _minLength(...args));
			},
			max(...args) {
				return this.check(/* @__PURE__ */ _maxLength(...args));
			},
			length(...args) {
				return this.check(/* @__PURE__ */ _length(...args));
			},
			nonempty(...args) {
				return this.check(/* @__PURE__ */ _minLength(1, ...args));
			},
			lowercase(params) {
				return this.check(/* @__PURE__ */ _lowercase(params));
			},
			uppercase(params) {
				return this.check(/* @__PURE__ */ _uppercase(params));
			},
			trim() {
				return this.check(/* @__PURE__ */ _trim());
			},
			normalize(...args) {
				return this.check(/* @__PURE__ */ _normalize(...args));
			},
			toLowerCase() {
				return this.check(/* @__PURE__ */ _toLowerCase());
			},
			toUpperCase() {
				return this.check(/* @__PURE__ */ _toUpperCase());
			},
			slugify() {
				return this.check(/* @__PURE__ */ _slugify());
			}
		}));
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
		}, {
			email(params) {
				return this.check(/* @__PURE__ */ _email(ZodEmail, params));
			},
			url(params) {
				return this.check(/* @__PURE__ */ _url(ZodURL, params));
			},
			jwt(params) {
				return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			},
			emoji(params) {
				return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			},
			guid(params) {
				return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
			},
			uuid(params) {
				return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			},
			uuidv4(params) {
				return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			},
			uuidv6(params) {
				return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			},
			uuidv7(params) {
				return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			},
			nanoid(params) {
				return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			},
			cuid(params) {
				return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			},
			cuid2(params) {
				return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			},
			ulid(params) {
				return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
			},
			base64(params) {
				return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
			},
			base64url(params) {
				return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			},
			xid(params) {
				return this.check(/* @__PURE__ */ _xid(ZodXID, params));
			},
			ksuid(params) {
				return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			},
			ipv4(params) {
				return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			},
			ipv6(params) {
				return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			},
			cidrv4(params) {
				return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			},
			cidrv6(params) {
				return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			},
			e164(params) {
				return this.check(/* @__PURE__ */ _e164(ZodE164, params));
			},
			datetime(params) {
				return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
			},
			date(params) {
				return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
			},
			time(params) {
				return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
			},
			duration(params) {
				return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
			}
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			inst.isFinite = true;
		}, /*@__PURE__*/ derived({
			minValue: (inst) => {
				const { minimum, exclusiveMinimum } = aggregateChecks(inst);
				return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
			},
			maxValue: (inst) => {
				const { maximum, exclusiveMaximum } = aggregateChecks(inst);
				return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
			},
			isInt: (inst) => {
				const { isInt, multipleOf } = aggregateChecks(inst);
				return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
			},
			format: (inst) => aggregateChecks(inst).format ?? null
		}, {
			gt(value, params) {
				return this.check(/* @__PURE__ */ _gt(value, params));
			},
			gte(value, params) {
				return this.check(/* @__PURE__ */ _gte(value, params));
			},
			min(value, params) {
				return this.check(/* @__PURE__ */ _gte(value, params));
			},
			lt(value, params) {
				return this.check(/* @__PURE__ */ _lt(value, params));
			},
			lte(value, params) {
				return this.check(/* @__PURE__ */ _lte(value, params));
			},
			max(value, params) {
				return this.check(/* @__PURE__ */ _lte(value, params));
			},
			int(params) {
				return this.check(int(params));
			},
			safe(params) {
				return this.check(int(params));
			},
			positive(params) {
				return this.check(/* @__PURE__ */ _gt(0, params));
			},
			nonnegative(params) {
				return this.check(/* @__PURE__ */ _gte(0, params));
			},
			negative(params) {
				return this.check(/* @__PURE__ */ _lt(0, params));
			},
			nonpositive(params) {
				return this.check(/* @__PURE__ */ _lte(0, params));
			},
			multipleOf(value, params) {
				return this.check(/* @__PURE__ */ _multipleOf(value, params));
			},
			step(value, params) {
				return this.check(/* @__PURE__ */ _multipleOf(value, params));
			},
			finite() {
				return this;
			}
		}));
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
		}, {
			min(n, params) {
				return this.check(/* @__PURE__ */ _minLength(n, params));
			},
			nonempty(params) {
				return this.check(/* @__PURE__ */ _minLength(1, params));
			},
			max(n, params) {
				return this.check(/* @__PURE__ */ _maxLength(n, params));
			},
			length(n, params) {
				return this.check(/* @__PURE__ */ _length(n, params));
			},
			unwrap() {
				return this.element;
			}
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
		}, {
			keyof() {
				return _enum(Object.keys(this._zod.def.shape));
			},
			catchall(catchall) {
				return this.clone(mergeDefs(this._zod.def, { catchall }));
			},
			passthrough() {
				return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
			},
			loose() {
				return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
			},
			strict() {
				return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
			},
			strip() {
				return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
			},
			extend(incoming) {
				return extend(this, incoming);
			},
			safeExtend(incoming) {
				return safeExtend(this, incoming);
			},
			merge(other) {
				return merge(this, other);
			},
			pick(mask) {
				return pick(this, mask);
			},
			omit(mask) {
				return omit(this, mask);
			},
			partial(...args) {
				return partial(ZodOptional, this, args[0]);
			},
			exactPartial(...args) {
				return partial(ZodExactOptional, this, args[0], "exactPartial");
			},
			required(...args) {
				return required(ZodNonOptional, this, args[0]);
			}
		});
		function object(shape, params) {
			const def = {
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			};
			return new ZodObject(def);
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
			ZodUnion.init(inst, def);
			$ZodDiscriminatedUnion.init(inst, def);
		});
		function discriminatedUnion(discriminator, options, params) {
			return new ZodDiscriminatedUnion({
				type: "union",
				options,
				discriminator,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodRecord.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
			inst.keyType = def.keyType;
			inst.valueType = def.valueType;
		});
		function record(keyType, valueType, params) {
			if (!valueType || !valueType._zod) return new ZodRecord({
				type: "record",
				keyType: string(),
				valueType: keyType,
				...normalizeParams(valueType)
			});
			return new ZodRecord({
				type: "record",
				keyType,
				valueType,
				...normalizeParams(params)
			});
		}
		function partialRecord(keyType, valueType, params) {
			return new ZodRecord({
				type: "record",
				keyType,
				valueType,
				...normalizeParams(params),
				partial: true
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = [...inst._zod.values];
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
			return new ZodEnum({
				type: "enum",
				entries,
				...normalizeParams(params)
			});
		}
		const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
			$ZodLiteral.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
			inst.values = new Set(def.values);
			Object.defineProperty(inst, "value", { get() {
				if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
				return def.values[0];
			} });
		});
		function literal(value, params) {
			return new ZodLiteral({
				type: "literal",
				values: Array.isArray(value) ? value : [value],
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						if (!("input" in _issue)) _issue.input = payload.value;
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					return payload;
				});
				payload.value = output;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region src/production/creationSchemas.ts
		const creationSourceSchema = object({
			kind: _enum([
				"topic",
				"materials",
				"article",
				"video"
			]),
			text: string().max(1e5).optional(),
			files: array(string().min(1)).max(30).optional(),
			articleId: string().optional(),
			video: object({
				name: string(),
				size: number(),
				modifiedAt: number(),
				sha256: string()
			}).optional()
		});
		const imageItemInputSchema = object({
			prompt: string().min(1).max(15e3),
			ratio: _enum([
				"3x4",
				"4x3",
				"16x9",
				"1x1"
			]),
			purpose: _enum([
				"cover",
				"illustration",
				"card"
			]),
			references: array(string()).max(8).optional()
		});
		const creationImageSchema = object({
			id: string(),
			file: string(),
			mime: string(),
			width: number(),
			height: number(),
			sha256: string(),
			createdAt: number(),
			source: _enum(["imported", "generated"]),
			purpose: _enum([
				"cover",
				"illustration",
				"card"
			]),
			taskId: string().optional(),
			hidden: boolean().optional(),
			review: string().optional()
		});
		const imageItemSchema = imageItemInputSchema.extend({
			id: string(),
			references: array(string()),
			status: _enum([
				"pending",
				"running",
				"completed",
				"failed",
				"cancelled",
				"unconfirmed"
			]),
			imageId: string().optional(),
			error: string().optional()
		});
		const publicationInputSchema = object({
			platform: _enum([
				"xiaohongshu",
				"douyin",
				"bilibili",
				"wechat",
				"official-account"
			]),
			type: _enum([
				"video",
				"images",
				"article"
			]),
			title: string().max(500),
			body: string().max(3e5),
			tags: array(string().min(1).max(100)).max(20),
			imageIds: array(string()).max(50),
			video: string().optional(),
			articleId: string().optional(),
			articleFile: string().optional(),
			coverImageId: string().optional(),
			coverFiles: object({
				"3x4": string().optional(),
				"4x3": string().optional(),
				"16x9": string().optional()
			}).optional(),
			category: string().max(100).optional(),
			source: creationSourceSchema.optional()
		});
		const publicationSchema = publicationInputSchema.omit({ body: true }).extend({
			id: string(),
			revision: number().int().positive(),
			bodyFile: string(),
			body: string().optional(),
			bodyError: string().optional(),
			sourceHash: string().optional(),
			sourceChanged: boolean().optional(),
			createdAt: number(),
			updatedAt: number(),
			hidden: boolean().optional()
		});
		const publicationRecordSchema = object({
			id: string(),
			publicationId: string(),
			revision: number(),
			platform: publicationInputSchema.shape.platform,
			type: publicationInputSchema.shape.type,
			accountId: string(),
			taskId: string().optional(),
			state: _enum([
				"linked",
				"uploaded",
				"draft",
				"published"
			]),
			remoteId: string().optional(),
			url: string().optional(),
			receipt: string().optional(),
			submittedFile: string().optional(),
			updatedAt: number()
		});
		//#endregion
		//#region src/covers/schemas.ts
		const coverRatioSchema = _enum([
			"3x4",
			"4x3",
			"16x9"
		]);
		const coverScopeSchema = object({
			id: string().min(1),
			folderPath: string().min(1)
		});
		const slot = object({
			status: _enum([
				"pending",
				"running",
				"completed",
				"failed",
				"cancelled",
				"unconfirmed"
			]),
			versionId: string(),
			prompt: string(),
			error: string().optional()
		});
		const imageSettingsSchema = object({
			apiBase: string(),
			model: string(),
			revision: string(),
			pending: object({
				token: string(),
				apiBase: string(),
				model: string(),
				needsKey: boolean()
			}).optional(),
			checked: object({
				revision: string(),
				connection: string(),
				generation: string(),
				edit: string()
			}).optional()
		});
		const coverVersionSchema = object({
			id: string(),
			ratio: coverRatioSchema,
			file: string(),
			mime: string(),
			width: number(),
			height: number(),
			source: _enum([
				"import",
				"generated",
				"legacy"
			]),
			createdAt: number(),
			video: string().optional(),
			runId: string().optional(),
			review: _enum([
				"pending",
				"pass",
				"needs_changes"
			]),
			reviewNote: string().optional(),
			hidden: boolean().optional()
		});
		const coverRunSchema = object({
			purpose: _enum(["cover", "service_test"]).optional(),
			requestToken: string().optional(),
			deliveredAt: number().optional(),
			sessionId: string().optional(),
			selectionRevision: number().optional(),
			id: string(),
			contentId: string(),
			folderPath: string(),
			createdAt: number(),
			updatedAt: number(),
			video: object({
				name: string(),
				size: number(),
				modifiedAt: number()
			}),
			ratios: array(coverRatioSchema),
			status: _enum([
				"waiting_agent",
				"preparing",
				"running",
				"partial",
				"completed",
				"failed",
				"cancelled",
				"unconfirmed"
			]),
			frames: array(object({
				id: string(),
				file: string(),
				at: number()
			})),
			analysis: string().optional(),
			headline: string().optional(),
			frameIds: array(string()).optional(),
			mode: _enum(["reference", "text"]).optional(),
			provider: imageSettingsSchema.omit({ checked: true }).optional(),
			slots: object({
				"3x4": slot.optional(),
				"4x3": slot.optional(),
				"16x9": slot.optional()
			}),
			jobId: string().optional(),
			error: string().optional()
		});
		const coverStateSchema = object({
			versions: array(coverVersionSchema),
			selected: object({
				"3x4": string().nullable().optional(),
				"4x3": string().nullable().optional(),
				"16x9": string().nullable().optional()
			}),
			runs: array(coverRunSchema),
			selectionRevision: number().optional()
		});
		const coverActionSchema = discriminatedUnion("action", [
			coverScopeSchema.extend({
				action: literal("delivered"),
				runId: string().uuid(),
				sessionId: string().min(1)
			}),
			coverScopeSchema.extend({
				action: literal("discard-request"),
				runId: string().uuid(),
				requestToken: string().uuid()
			}),
			coverScopeSchema.extend({
				action: literal("remove"),
				versionId: string().min(1)
			}),
			coverScopeSchema.extend({
				action: literal("test"),
				video: string().min(1)
			}),
			coverScopeSchema.extend({
				action: literal("create"),
				video: string().min(1),
				ratios: array(coverRatioSchema).min(1).max(3),
				requestToken: string().uuid().optional()
			}),
			coverScopeSchema.extend({
				action: literal("import"),
				sourcePath: string().min(1),
				ratio: coverRatioSchema
			}),
			coverScopeSchema.extend({
				action: literal("select"),
				versionId: string().min(1)
			}),
			coverScopeSchema.extend({
				action: literal("cancel"),
				runId: string().uuid()
			}),
			coverScopeSchema.extend({
				action: literal("retry"),
				runId: string().uuid(),
				ratios: array(coverRatioSchema).min(1).max(3),
				acknowledgeUnknown: boolean().optional()
			}),
			coverScopeSchema.extend({
				action: literal("review"),
				versionId: string(),
				verdict: _enum(["pass", "needs_changes"]),
				note: string().min(1),
				select: boolean().optional()
			})
		]);
		//#endregion
		//#region src/production/schemas.ts
		const scopeSchema = object({
			id: string().min(1),
			folderPath: string().min(1)
		});
		const platform = _enum([
			"xiaohongshu",
			"douyin",
			"bilibili",
			"wechat"
		]);
		const media = object({
			name: string(),
			size: number(),
			modifiedAt: number(),
			sha256: string()
		});
		const account = object({
			platform,
			id: string(),
			name: string(),
			checkedAt: number()
		});
		const observation = object({
			platform,
			id: string().optional(),
			name: string().optional(),
			checkedAt: number(),
			state: _enum([
				"connected",
				"login-required",
				"unverified"
			]),
			error: string().optional(),
			spaceId: number().int().positive().optional()
		});
		const metricsTarget = object({
			platform: _enum([
				"xiaohongshu",
				"douyin",
				"bilibili",
				"wechat",
				"official-account"
			]),
			accountId: string(),
			remoteId: string().optional(),
			url: string().optional(),
			publicationId: string().optional(),
			recordId: string().optional()
		});
		const task = object({
			source: creationSourceSchema.optional(),
			imageItems: array(imageItemSchema).optional(),
			publicationId: string().optional(),
			publicationRevision: number().optional(),
			publicationType: _enum([
				"video",
				"images",
				"article"
			]).optional(),
			executionRevision: number().int().nonnegative().optional(),
			metricsKey: string().optional(),
			metricsTargets: array(metricsTarget).optional(),
			metricsProgress: array(metricsTarget.extend({
				state: _enum([
					"queued",
					"running",
					"completed",
					"failed",
					"blocked",
					"cancelled"
				]),
				startedAt: number().optional(),
				endedAt: number().optional(),
				error: string().optional()
			})).optional(),
			id: string(),
			kind: _enum([
				"upload",
				"asr",
				"article",
				"wechat",
				"metrics",
				"images"
			]),
			status: _enum([
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
			contentId: string(),
			folderPath: string(),
			createdAt: number(),
			updatedAt: number(),
			video: media.optional(),
			account: account.optional(),
			jobId: string().optional(),
			error: string().optional(),
			step: string().optional(),
			packageFile: string().optional(),
			platform: platform.optional(),
			articleId: string().optional(),
			transcriptId: string().optional(),
			originalRightsConfirmed: boolean().optional(),
			sessionId: string().optional(),
			receipt: string().optional(),
			remoteId: string().optional(),
			wechatAppId: string().optional(),
			articleFile: string().optional()
		});
		const productionStateSchema = object({
			savedPublication: object({
				id: string(),
				revision: number().int().positive()
			}).optional(),
			schemaVersion: union([literal(1), literal(2)]),
			images: array(creationImageSchema).optional(),
			publications: array(publicationSchema).optional(),
			records: array(publicationRecordSchema).optional(),
			tasks: array(task.extend({ uploadKey: string().optional() })),
			uploadNotice: object({
				taskId: string(),
				message: string(),
				canCreateNew: boolean()
			}).optional(),
			candidates: array(object({
				platform: _enum([
					"xiaohongshu",
					"douyin",
					"bilibili",
					"wechat",
					"official-account"
				]),
				accountId: string(),
				remoteId: string(),
				title: string(),
				url: string().optional()
			})).optional(),
			transcripts: array(object({
				id: string(),
				video: media,
				source: _enum(["imported", "volcano"]),
				textFile: string(),
				srtFile: string(),
				rawFile: string().optional(),
				createdAt: number(),
				cues: number()
			})),
			articles: array(object({
				parentArticleId: string().optional(),
				saveInputHash: string().optional(),
				id: string(),
				video: media.optional(),
				transcriptId: string().optional(),
				source: creationSourceSchema.optional(),
				imageIds: array(string()).optional(),
				title: string().optional(),
				format: _enum(["markdown", "html"]).optional(),
				file: string(),
				createdAt: number(),
				frameFiles: array(string())
			})),
			drafts: array(object({
				id: string(),
				appid: string(),
				articleFile: string(),
				mediaId: string(),
				title: string(),
				submittedHash: string(),
				remoteHash: string(),
				submittedFile: string(),
				updatedAt: number(),
				publishedId: string().optional(),
				publishedUrl: string().optional()
			})),
			metrics: array(object({
				publicationId: string().optional(),
				recordId: string().optional(),
				platform: _enum([
					"xiaohongshu",
					"douyin",
					"bilibili",
					"wechat",
					"official-account"
				]),
				accountId: string(),
				remoteId: string(),
				url: string().optional(),
				views: number().optional(),
				likes: number().optional(),
				comments: number().optional(),
				shares: number().optional(),
				syncedAt: number().optional(),
				checkedAt: number(),
				state: _enum([
					"ok",
					"error",
					"not-found",
					"unassociated"
				]),
				error: string().optional()
			}))
		});
		const productionSettingsSchema = object({
			revision: string(),
			accounts: partialRecord(platform, account),
			accountHistory: array(account),
			observations: partialRecord(platform, observation),
			wechat: object({
				appid: string(),
				theme: string(),
				author: string(),
				checkedAt: number().optional(),
				error: string().optional()
			}),
			browserPaused: boolean(),
			runtime: object({
				publisher: boolean(),
				article: boolean(),
				python: boolean(),
				ffmpeg: boolean(),
				browser: boolean(),
				details: array(string())
			}),
			asrConfigured: boolean(),
			wechatConfigured: boolean(),
			wechatCredential: string()
		});
		const scoped = (shape) => scopeSchema.extend(shape);
		const productionActionSchema = discriminatedUnion("action", [
			scoped({
				action: literal("register-article"),
				file: string().min(1),
				source: creationSourceSchema.optional(),
				imageIds: array(string()).optional()
			}),
			scoped({
				action: literal("import-article"),
				sourcePath: string().min(1)
			}),
			scoped({
				action: literal("import-image"),
				sourcePath: string().min(1),
				purpose: _enum([
					"cover",
					"illustration",
					"card"
				])
			}),
			scoped({
				action: literal("remove-image"),
				imageId: string()
			}),
			scoped({
				action: literal("generate-images"),
				items: array(imageItemInputSchema).min(1).max(30),
				source: creationSourceSchema.optional(),
				sessionId: string().optional()
			}),
			scoped({
				action: literal("retry-images"),
				taskId: string(),
				itemIds: array(string()).min(1),
				acknowledgeUnknown: boolean().optional()
			}),
			scoped({
				action: literal("save-publication"),
				publicationId: string().optional(),
				expectedRevision: number().int().positive().optional(),
				saveId: string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),
				input: publicationInputSchema
			}),
			scoped({
				action: literal("remove-publication"),
				publicationId: string(),
				expectedRevision: number().int().positive()
			}),
			scoped({
				action: literal("upload-publication"),
				publicationId: string(),
				expectedRevision: number().int().positive(),
				originalRightsConfirmed: boolean(),
				newUploadAfter: string().optional(),
				expectedAccountId: string().min(1).optional()
			}),
			scoped({
				action: literal("upload"),
				input: object({
					platform,
					title: string().min(1).max(500),
					description: string().max(1e4),
					tags: array(string().min(1).max(100)).max(20),
					originalRightsConfirmed: boolean(),
					useCovers: boolean(),
					category: string().max(100).optional()
				}),
				newUploadAfter: string().uuid().optional()
			}),
			scoped({
				action: literal("resume-upload"),
				taskId: string().uuid()
			}),
			scoped({
				action: literal("inspect-upload"),
				taskId: string().uuid()
			}),
			scoped({
				action: literal("cancel"),
				taskId: string().uuid()
			}),
			scoped({
				action: literal("transcribe"),
				acknowledgeUnknown: boolean().optional()
			}),
			scoped({
				action: literal("import-subtitle"),
				sourcePath: string().min(1)
			}),
			scoped({
				action: literal("prepare-article"),
				source: creationSourceSchema.optional(),
				sessionId: string().optional()
			}),
			scoped({
				action: literal("save-article"),
				imageIds: array(string()).optional(),
				taskId: string().uuid(),
				markdown: string().max(3e5),
				sessionId: string().optional()
			}),
			...["wechat-preview", "wechat-draft"].map((action) => scoped({
				action: literal(action),
				articleFile: string().optional(),
				coverPath: string().optional(),
				confirmRemoteChange: boolean().optional(),
				acknowledgeUnknown: boolean().optional()
			})),
			scoped({
				action: literal("refresh-metrics"),
				publicationId: string().optional(),
				recordId: string().optional(),
				remoteId: string().min(1).optional(),
				expectedAccountId: string().min(1).optional(),
				platform: _enum([
					"xiaohongshu",
					"douyin",
					"bilibili",
					"wechat",
					"official-account"
				]).optional()
			}),
			scoped({
				action: literal("associate-publication"),
				publicationId: string().optional(),
				recordId: string().optional(),
				platform: _enum([
					"xiaohongshu",
					"douyin",
					"bilibili",
					"wechat",
					"official-account"
				]),
				remoteId: string().min(1).max(200),
				url: string().optional(),
				expectedAccountId: string().min(1).optional(),
				candidateAccountId: string().min(1).optional()
			})
		]);
		const productionSettingsActionSchema = discriminatedUnion("action", [
			object({ action: literal("prepare-runtime") }),
			...[
				"pause-browser",
				"resume-browser",
				"check-wechat"
			].map((action) => object({ action: literal(action) })),
			object({
				action: literal("open-login"),
				platform
			}),
			object({
				action: literal("check-account"),
				platform
			}),
			object({
				action: literal("connect-account"),
				platform,
				expectedId: string().min(1),
				replace: boolean()
			}),
			object({
				action: literal("save-wechat"),
				appid: string().min(1),
				author: string(),
				theme: string(),
				revision: string()
			}),
			object({
				action: literal("import-wechat"),
				sourcePath: string().min(1)
			})
		]);
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
		//#endregion
		//#region src/schemas.ts
		const contentCoversSchema = object({
			"3x4": string().optional(),
			"4x3": string().optional(),
			"16x9": string().optional()
		});
		const contentSubtitlesSchema = object({
			srt: string().optional(),
			ass: string().optional(),
			transcript: string().optional()
		});
		const pipelineSchema = union([
			literal("raw"),
			literal("subtitled"),
			literal("covered"),
			literal("packaged")
		]);
		const workflowSchema = union([
			literal("idle"),
			literal("finish"),
			literal("publish"),
			literal("live")
		]);
		const publishMarkSchema = union([
			literal("unpublished"),
			literal("draft"),
			literal("published")
		]);
		const publishPlatformSchema = _enum(PUBLISH_PLATFORMS);
		const platformPublishSchema = object({
			status: publishMarkSchema,
			source: union([
				literal("none"),
				literal("publisher"),
				literal("overlay"),
				literal("sync")
			]),
			url: string().optional(),
			remoteId: string().optional(),
			views: number().optional(),
			likes: number().optional(),
			comments: number().optional(),
			syncedAt: number().optional(),
			verifiedAccountId: string().optional()
		});
		const contentPublishSchema = object(Object.fromEntries(PUBLISH_PLATFORMS.map((platform) => [platform, platformPublishSchema])));
		const burnJobSchema = object({
			status: union([
				literal("idle"),
				literal("running"),
				literal("done"),
				literal("error")
			]),
			startedAt: number().optional(),
			output: string().optional(),
			error: string().optional(),
			pid: number().optional()
		});
		const contentSummarySchema = object({
			accessError: string().optional(),
			directoryRevision: string().optional(),
			directoryAliases: array(string()).optional(),
			id: string().min(1),
			folderPath: string().min(1),
			title: string(),
			date: string().optional(),
			recordedAt: number(),
			createdMs: number(),
			videos: array(object({
				name: string(),
				path: string(),
				size: number(),
				modifiedAt: number(),
				missing: boolean().optional()
			})).optional(),
			hiddenVideos: array(object({
				name: string(),
				path: string(),
				size: number(),
				modifiedAt: number(),
				missing: boolean().optional()
			})).optional(),
			selectedVideo: string().optional(),
			videoSelection: _enum([
				"empty",
				"choose",
				"selected",
				"missing",
				"cleared"
			]).optional(),
			videoRaw: string().optional(),
			videoSubtitled: string().optional(),
			covers: contentCoversSchema,
			subtitles: contentSubtitlesSchema,
			hasPublishPackage: boolean(),
			hasArticle: boolean(),
			articlePath: string().optional(),
			tags: array(string()),
			pipeline: pipelineSchema,
			workflow: workflowSchema,
			publish: contentPublishSchema,
			burn: burnJobSchema,
			subtitleJob: burnJobSchema,
			coverJob: burnJobSchema
		});
		const creatorProfileSchema = object({ enabledPlatforms: array(publishPlatformSchema) });
		const secretViewSchema = object({
			kind: union([literal("subtitle"), literal("cover")]),
			ref: string(),
			configured: boolean(),
			writable: boolean(),
			source: string().optional()
		});
		const librarySettingsSchema = object({
			projectLocations: array(object({ path: string() })).optional(),
			libraryRoot: string(),
			libraryConfirmed: boolean().optional(),
			profile: creatorProfileSchema,
			secrets: object({
				subtitle: secretViewSchema,
				cover: secretViewSchema
			}),
			scriptRules: string().optional()
		});
		const projectLocationsSchema = librarySettingsSchema.pick({
			libraryRoot: true,
			libraryConfirmed: true,
			projectLocations: true
		});
		const listContentsRequestSchema = object({
			query: string(),
			filter: union([
				literal("all"),
				literal("cover"),
				literal("subtitle"),
				literal("article")
			])
		});
		const listContentsResultSchema = object({
			settings: librarySettingsSchema,
			items: array(contentSummarySchema),
			removedItems: array(contentSummarySchema).optional(),
			counts: object({
				total: number().int().nonnegative(),
				cover: number().int().nonnegative(),
				subtitle: number().int().nonnegative(),
				article: number().int().nonnegative()
			}),
			revision: number().int().nonnegative()
		});
		const idRequestSchema = object({
			id: string().min(1),
			folderPath: string().min(1).optional()
		});
		const contentDetailSchema = contentSummarySchema.and(object({
			publishCopy: string(),
			topicNote: string(),
			script: string(),
			article: string(),
			secrets: object({
				subtitle: secretViewSchema,
				cover: secretViewSchema
			})
		}));
		const coverThumbResultSchema = object({
			found: boolean(),
			mime: string(),
			base64: string()
		});
		const videoPlaybackResultSchema = object({
			found: boolean(),
			url: string(),
			kind: union([literal("raw"), literal("subtitled")])
		});
		const articleMediaResultSchema = object({
			found: boolean(),
			origin: string()
		});
		const subtitleTextResultSchema = object({
			text: string(),
			cues: array(object({
				text: string(),
				at: string().optional()
			}))
		});
		const setPublishRequestSchema = object({
			folderPath: string().min(1).optional(),
			id: string().min(1),
			platform: publishPlatformSchema,
			status: publishMarkSchema,
			url: string().optional()
		});
		const subtitlePreviewResultSchema = object({
			url: string().min(1),
			port: number().int().positive()
		});
		const syncPublishRequestSchema = object({
			id: string().min(1).optional(),
			platform: publishPlatformSchema.optional(),
			force: boolean().optional()
		});
		const syncPublishResultSchema = object({
			matched: number().int().nonnegative(),
			cached: boolean().optional(),
			platforms: array(object({
				platform: publishPlatformSchema,
				count: number().int().nonnegative(),
				loginRequired: boolean().optional(),
				error: string().optional()
			}))
		});
		const revisionResultSchema = object({ revision: number().int().nonnegative() });
		const capabilitySchema = object({
			state: union([
				literal("ready"),
				literal("missing"),
				literal("unsupported")
			]),
			required: boolean(),
			detail: string(),
			path: string().optional()
		});
		const capabilitiesResultSchema = object({ capabilities: object({
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
		const setLibraryRootRequestSchema = object({ path: string().min(1) });
		const createContentRequestSchema = object({
			title: string().min(1),
			libraryRoot: string().min(1).optional(),
			requestId: string().min(1).max(200).optional()
		});
		const createContentResultSchema = object({
			directoryAliases: array(string()).optional(),
			id: string().min(1),
			folderPath: string().min(1)
		});
		const setProfileRequestSchema = object({ profile: creatorProfileSchema });
		const setScriptRulesRequestSchema = object({ text: string() });
		object({
			id: string().min(1),
			folderPath: string().min(1).optional(),
			text: string()
		});
		const setScriptRequestSchema = object({
			id: string().min(1),
			text: string(),
			folderPath: string().min(1).optional()
		});
		object({
			libraryRoot: string().min(1).optional(),
			apply: boolean(),
			ids: array(string())
		});
		object({
			moves: array(object({
				from: string().min(1),
				to: string().min(1),
				reason: union([
					literal("add-date"),
					literal("readable-title"),
					literal("both")
				])
			})),
			unchanged: number().int().nonnegative()
		});
		const selectVideoRequestSchema = object({
			id: string().min(1),
			folderPath: string().min(1),
			name: string().min(1)
		});
		const videoImportRequestSchema = object({
			id: string().min(1),
			folderPath: string().min(1),
			sourcePath: string().min(1),
			name: string().min(1).optional()
		});
		const videoImportTokenSchema = object({ token: string().min(1) });
		const videoImportStateSchema = object({
			token: string(),
			id: string(),
			name: string(),
			status: _enum([
				"running",
				"completed",
				"failed",
				"cancelled"
			]),
			jobId: string().optional(),
			error: string().optional()
		});
		//#endregion
		//#region src/remote-contract.ts
		const PACKAGE_NAME = "dsh-creator-workbench";
		const REMOTE_NAMESPACE = "creatorWorkbench";
		const emptyObjectSchema = object({});
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
		const taskViewSchema = productionStateSchema.shape.tasks.element.extend({ imageItems: array(imageItemSchema.omit({ prompt: true })).optional() });
		const productionViewSchema = productionStateSchema.extend({ tasks: array(taskViewSchema) });
		const slotViewSchema = coverRunSchema.shape.slots.shape["3x4"].unwrap().omit({ prompt: true });
		const coverViewSchema = coverStateSchema.extend({ runs: array(coverRunSchema.extend({ slots: object({
			"3x4": slotViewSchema.optional(),
			"4x3": slotViewSchema.optional(),
			"16x9": slotViewSchema.optional()
		}) })) });
		const articleSourceResultSchema = object({
			article: productionStateSchema.shape.articles.element,
			source: string(),
			sourceHash: string()
		});
		const articleEditSchema = scopeSchema.extend({
			articleId: string(),
			expectedSourceHash: string(),
			source: string().max(2097152)
		});
		const htmlPreviewSchema = object({
			html: string(),
			path: string()
		});
		//#endregion
		//#region src/remote.ts
		const TYPERT_REMOTE = {
			package: PACKAGE_NAME,
			descriptors: [
				invocation("getProjectView", object({
					id: string(),
					folderPath: string().optional()
				}), object({
					detail: contentDetailSchema,
					production: productionViewSchema,
					covers: coverViewSchema,
					settingsRevision: string().optional(),
					accountIds: record(string(), string()).optional(),
					script: object({
						exists: boolean(),
						excerpt: string()
					}),
					excerpts: object({
						article: object({
							id: string(),
							text: string()
						}).optional(),
						subtitle: object({
							file: string(),
							source: string(),
							text: string()
						}).optional()
					}).optional()
				})),
				invocation("reconcileProject", scopeSchema, emptyObjectSchema),
				invocation("getPublicationContent", scopeSchema.extend({
					publicationId: string(),
					revision: number()
				}), publicationSchema),
				invocation("readArticleSource", scopeSchema.extend({ articleId: string() }), articleSourceResultSchema),
				invocation("previewArticleDraft", articleEditSchema, htmlPreviewSchema),
				invocation("saveArticleRevision", articleEditSchema.extend({ saveId: string() }), articleSourceResultSchema.extend({
					preview: htmlPreviewSchema.optional(),
					previewError: string().optional()
				})),
				invocation("getProductionSettings", emptyObjectSchema, productionSettingsSchema),
				invocation("productionSettingsAction", productionSettingsActionSchema, productionSettingsSchema),
				invocation("getProductionState", scopeSchema, productionStateSchema),
				invocation("getCreationImage", scopeSchema.extend({ imageId: string() }), object({
					mime: string(),
					base64: string()
				})),
				invocation("getCreationText", scopeSchema.extend({ file: string() }), object({ text: string() })),
				invocation("productionAction", productionActionSchema, productionStateSchema),
				invocation("getProductionPreview", scopeSchema.extend({
					taskId: string().uuid().optional(),
					articleFile: string().optional(),
					publicationId: string().optional(),
					revision: number().int().positive().optional()
				}), object({
					html: string(),
					path: string()
				})),
				invocation("setVideoVisibility", object({
					id: string().min(1),
					folderPath: string().min(1),
					name: string().min(1),
					hidden: boolean()
				}), contentDetailSchema),
				invocation("setContentVisibility", object({
					id: string().min(1),
					folderPath: string().min(1),
					hidden: boolean()
				}), listContentsResultSchema),
				invocation("projectAction", object({
					id: string().min(1),
					folderPath: string().min(1),
					action: _enum([
						"inspect",
						"remove",
						"join"
					]),
					cancelTasks: boolean().optional()
				}), object({
					tasks: array(string()),
					removed: boolean(),
					directoryAliases: array(string()).optional()
				})),
				invocation("restoreProjectSession", object({
					id: string().min(1),
					folderPath: string().min(1),
					sessionId: string().min(1)
				}), emptyObjectSchema),
				invocation("getCoverState", coverScopeSchema, coverStateSchema),
				invocation("coverAction", coverActionSchema, coverStateSchema),
				invocation("getCoverImage", coverScopeSchema.extend({ versionId: string() }), object({
					mime: string(),
					base64: string()
				})),
				invocation("getImageSettings", emptyObjectSchema, imageSettingsSchema),
				invocation("setImageSettings", object({
					apiBase: string(),
					model: string()
				}), imageSettingsSchema),
				invocation("beginImageUpdate", object({
					apiBase: string(),
					model: string(),
					revision: string(),
					hasNewKey: boolean()
				}), imageSettingsSchema),
				invocation("completeImageUpdate", object({
					token: string(),
					keyUpdated: boolean()
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
				invocation("openContentPath", object({ path: string().min(1) }), emptyObjectSchema),
				invocation("getSettings", emptyObjectSchema, librarySettingsSchema),
				invocation("getCapabilities", emptyObjectSchema, capabilitiesResultSchema),
				invocation("getRevision", emptyObjectSchema, revisionResultSchema),
				invocation("getProjectLocations", emptyObjectSchema, projectLocationsSchema),
				invocation("setProjectLocation", setLibraryRootRequestSchema, projectLocationsSchema),
				invocation("setLibraryRoot", setLibraryRootRequestSchema, librarySettingsSchema),
				invocation("refreshCatalog", emptyObjectSchema, listContentsResultSchema),
				invocation("recoverProject", object({
					folderPath: string().min(1),
					sessionId: string().min(1)
				}), createContentResultSchema),
				invocation("addProject", object({ path: string().min(1) }), createContentResultSchema),
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
		//#region src/client/catalogSync.ts
		const LIBRARY_POLL_MS = 1e3;
		function startLibraryLiveSync(readRevision, intervalMs = LIBRARY_POLL_MS) {
			let last = -1;
			let inFlight = false;
			let stopped = false;
			const tick = async () => {
				if (stopped || inFlight) return;
				inFlight = true;
				try {
					const revision = await readRevision();
					if (stopped) return;
					if (last < 0) {
						last = revision;
						if (revision > 0) bumpLibrary();
						return;
					}
					if (revision !== last) {
						last = revision;
						bumpLibrary();
					}
				} catch {} finally {
					inFlight = false;
				}
			};
			tick();
			const timer = globalThis.setInterval(() => {
				tick();
			}, intervalMs);
			return () => {
				stopped = true;
				globalThis.clearInterval(timer);
			};
		}
		//#endregion
		//#region src/client/pluginCss.ts
		const STORE = "__dshCreatorWorkbenchCss";
		function cssStore() {
			const global = globalThis;
			global[STORE] ??= { sheets: /* @__PURE__ */ new Map() };
			return global[STORE];
		}
		function registerPluginCss(tagId, css) {
			cssStore().sheets.set(tagId, css);
			mountPluginCss(tagId, css);
		}
		function mountPluginCss(tagId, css) {
			if (typeof document === "undefined") return;
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
			const tag = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
			tag.dataset.plugin = "dsh-creator-workbench";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			if (existing === null) document.head.appendChild(tag);
		}
		function remountPluginCss() {
			for (const [tagId, css] of cssStore().sheets) mountPluginCss(tagId, css);
		}
		function releasePluginCss() {
			if (typeof document === "undefined") return;
			for (const tag of document.querySelectorAll("style[data-plugin=\"dsh-creator-workbench\"]")) tag.remove();
		}
		//#endregion
		//#region src/contentRef.ts
		function formatContentRef(detail) {
			return detail.folderPath;
		}
		//#endregion
		//#region src/client/contentTriggers.ts
		/** Composer chips occupy a fixed 4em cell; longer labels are centered and clipped. */
		const CHIP_UNITS = 8;
		function charUnits(ch) {
			return /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
		}
		function chipLabel(title) {
			const chars = [...title.trim()];
			if (chars.length === 0) return "内容";
			let used = 0;
			const out = [];
			for (const ch of chars) {
				const w = charUnits(ch);
				if (used + w > CHIP_UNITS) {
					while (used > 7 && out.length > 0) {
						used -= charUnits(out[out.length - 1] ?? "");
						out.pop();
					}
					while (out.length > 0 && out[out.length - 1] === " ") {
						used -= 1;
						out.pop();
					}
					out.push("…");
					return out.join("");
				}
				out.push(ch);
				used += w;
			}
			return out.join("");
		}
		function registerContentTriggers(inputTriggers, load, list, ownsCurrentSession = () => true) {
			if (inputTriggers === void 0) return () => void 0;
			const serialize = async (ref, signal) => {
				if (!ownsCurrentSession()) throw new Error("请先在内容工作台打开所属会话。");
				const id = ref === "current" ? getSelectedContentId() : ref;
				if (id === null || id === "") return "当前没有打开的内容。用 @ 选一条，或先在内容页打开详情。";
				signal.throwIfAborted();
				const detail = await load(id);
				signal.throwIfAborted();
				if (!ownsCurrentSession()) throw new Error("会话已切换，请重新选择内容。");
				return formatContentRef(detail);
			};
			const insert = (ref, title) => ({ insert: {
				source: "creator-workbench",
				ref,
				label: chipLabel(title),
				clipboardText: `@${title}`
			} });
			const atSource = {
				trigger: "@",
				name: "creator-workbench",
				order: 30,
				async candidates(session, req) {
					if (!ownsCurrentSession(session) || req.signal.aborted) return [];
					const query = req.query.trim().toLowerCase();
					const items = await list();
					if (!ownsCurrentSession(session) || req.signal.aborted) return [];
					const rows = [];
					const selected = getSelectedContentId();
					if (selected !== null && ("当前".includes(query) || query === "")) {
						const current = items.find((item) => item.id === selected);
						rows.push({
							name: "当前详情",
							description: current?.title ?? selected
						});
					}
					for (const item of items) {
						if (query !== "" && !item.title.toLowerCase().includes(query) && !item.id.toLowerCase().includes(query)) continue;
						rows.push({
							name: item.title,
							description: item.id
						});
					}
					return rows.slice(0, 20);
				},
				onPick({ candidate, session }) {
					if (!ownsCurrentSession(session)) return void 0;
					if (candidate.name === "当前详情") return insert("current", "当前详情");
					return insert(candidate.description ?? candidate.name, candidate.name);
				},
				lexicon(session) {
					return ownsCurrentSession(session) ? ["当前详情"] : [];
				},
				subscribeLexicon(_session, listener) {
					return subscribeSelectedContentId(listener);
				},
				codec: {
					clipboardText: (ref) => ref === "current" ? "@当前详情" : `@${ref}`,
					serialize
				}
			};
			const slashSource = {
				trigger: "/",
				name: "creator-workbench",
				order: 40,
				async candidates(session, req) {
					if (!ownsCurrentSession(session) || req.signal.aborted) return [];
					const query = req.query.trim().toLowerCase();
					const name = "current content";
					if (query !== "" && !name.includes(query) && !"当前内容".includes(query)) return [];
					return [{
						name,
						description: "把当前打开的内容交给对话"
					}];
				},
				onPick({ session }) {
					if (!ownsCurrentSession(session)) return void 0;
					return insert("current", "当前内容");
				},
				lexicon(session) {
					return ownsCurrentSession(session) ? ["current content", "当前内容"] : [];
				},
				codec: {
					clipboardText: () => "/current content",
					serialize
				}
			};
			const stopAt = inputTriggers.registerSource(atSource);
			const stopSlash = inputTriggers.registerSource(slashSource);
			return () => {
				stopAt();
				stopSlash();
			};
		}
		//#endregion
		//#region src/client/credentialsApi.ts
		/** The current Credentials remote accepts positional arguments, not legacy API envelopes. */
		function credentialsOf(ctx) {
			const remote = () => {
				const value = ctx.get("remote.credentials");
				if (value === void 0) throw new Error("凭据服务尚未就绪，请稍后重试。");
				return value;
			};
			return {
				async describe({ refs }) {
					const answer = await remote().describe(refs);
					return { result: answer.ok && answer.value !== void 0 ? {
						ok: true,
						value: { credentials: answer.value }
					} : { ok: false } };
				},
				async set({ ref, value }) {
					return { result: await remote().set(ref, value) };
				}
			};
		}
		//#endregion
		//#region src/client/locales.ts
		const NS = "dsh.creator.workbench";
		const zh = {
			"video.title": "视频",
			"video.import": "导入视频",
			"video.importHint": "支持 MP4、MOV。复制到这一期目录，原文件保留；独立字幕可选。",
			"video.importName": "导入后的文件名",
			"video.start": "开始导入",
			"video.cancel": "取消导入",
			"video.running": "正在导入视频…",
			"video.completed": "视频已导入并设为当前视频",
			"video.failed": "导入失败",
			"video.cancelled": "导入已取消",
			"video.current": "当前视频",
			"video.cleared": "尚未选择当前视频",
			"video.empty": "尚无视频，请导入视频",
			"video.choose": "有多个视频，请选择当前视频",
			"video.missing": "视频已找不到，请重新选择",
			"video.selected": "已选择",
			"video.desktopRequired": "请在 DSH Desktop 中导入本机视频。",
			"video.playbackError": "无法播放此视频，可能不支持该编码。文件已保留，可在外部播放器打开。",
			"workbench.restoring": "正在恢复这次会话的资料位置…",
			"workbench.relocate": "重新选择资料目录",
			"workbench.relocateHint": "请选择移动后这一期的内容文件夹。原会话会保留内容关联，点击「打开内容会话」将在新位置开始会话。",
			"markdown.copy": "复制",
			"markdown.copied": "已复制",
			"markdown.footnotes": "脚注",
			"workbench.title": "创作工作台",
			"workbench.session": "打开项目对话",
			"workbench.starting": "正在打开会话…",
			"workbench.settings": "数据与设置",
			"workbench.library": "返回片库",
			"workbench.select": "从片库选择一期内容，查看脚本、字幕、封面与发布状态。",
			tab: "内容",
			"tab.sessions": "会话",
			"session.new.label": "新建会话",
			"toggle.open": "打开侧边栏",
			"toggle.collapse": "收起侧边栏",
			"toolbar.search": "搜索标题",
			"toolbar.search.aria": "搜索内容",
			"toolbar.search.clear": "清除搜索",
			"toolbar.refresh": "刷新",
			"toolbar.create": "新建内容",
			"toolbar.create.aria": "新建内容",
			"create.title": "新建内容",
			"create.name": "项目名称",
			"create.name.placeholder": "例如：DeepSeek Harness 安装上手",
			"create.confirm": "创建",
			"create.cancel": "取消",
			"create.failed": "创建失败",
			"inspector.tab.overview": "概览",
			"inspector.tab.video": "视频",
			"inspector.tab.article": "文章",
			"inspector.tab.images": "图片",
			"inspector.tab.publishing": "发布",
			"inspector.tab.script": "脚本",
			"inspector.tab.subtitle": "字幕",
			"inspector.stage.idle": "未开始",
			"inspector.stage.finish": "待准备封面",
			"inspector.stage.publish": "待发布",
			"inspector.stage.live": "已发布",
			"inspector.article": "公众号",
			"inspector.article.draft": "图文稿",
			"inspector.article.ready": "已成稿",
			"inspector.article.missing": "未转写",
			"inspector.article.empty": "还没有转成文章。成稿会放在这一期的 公众号文章/ 里。",
			"inspector.video.empty": "还没有成片。",
			"inspector.publish.unpublished": "未发布",
			"inspector.publish.draft": "草稿已备",
			"inspector.publish.published": "已发布",
			"inspector.step.topic": "内容",
			"inspector.step.finish": "素材准备",
			"inspector.step.publish": "发布",
			"inspector.step.topicHint": "在对话里定这一期讲什么，笔记写进 topic.md。",
			"inspector.step.finishHint": "准备封面与发布材料，独立字幕可选。",
			"inspector.track.subtitle": "字幕（可选）",
			"inspector.track.cover": "封面",
			"inspector.track.notGenerated": "未生成",
			"inspector.subtitle.empty": "还没有字幕，可在此生成或导入。",
			"inspector.subtitle.proofPending": "待校对",
			"inspector.subtitle.burning": "烧录中",
			"inspector.subtitle.burned": "烧录完成",
			"inspector.subtitle.burnFailed": "烧录失败",
			"inspector.subtitle.burn": "烧录字幕",
			"inspector.subtitle.reburn": "再烧录",
			"inspector.subtitle.needDraft": "先生成并预览字幕稿，再烧录",
			"empty.library": "还没有内容文件夹，点右上角新建第一条。",
			"empty.detail": "点左侧一条内容查看详情。",
			"empty.remote": "内容服务还没连上",
			"empty.error": "读取失败",
			"empty.gone": "这条内容已被移动或删除。",
			"empty.loading": "正在读取",
			"detail.tags": "标签",
			"time.justNow": "刚刚",
			"time.minutes": "{n} 分钟前",
			"time.hours": "{n} 小时前",
			"time.yesterday": "昨天",
			"time.days": "{n} 天前",
			"time.monthDay": "{m}月{d}日",
			"time.yearMonthDay": "{y}年{m}月{d}日",
			"inspector.close": "关闭",
			"inspector.resize": "调整检查器宽度",
			"inspector.openFolder": "打开文件夹",
			"inspector.subtitle.previewEdit": "预览编辑",
			"inspector.platforms": "视频平台",
			"inspector.sync.title": "发布数据",
			"inspector.sync.hint": "从各平台创作者后台回收播放、赞和评论。",
			"inspector.publish.open": "打开作品",
			"inspector.script.placeholder": "还没有脚本。在这里直接写，或在对话里让 AI 起草。",
			"inspector.platform.xhs": "小红书",
			"inspector.platform.bilibili": "B 站",
			"inspector.platform.douyin": "抖音",
			"inspector.platform.wechat": "视频号",
			"inspector.publish.sync": "已发布，同步数据",
			"inspector.publish.syncing": "正在同步",
			"inspector.publish.platformsLoading": "正在读取已启用的平台。",
			"inspector.publish.enablePlatforms": "还没有启用平台，请先到设置里启用平台。",
			"inspector.publish.synced": "已对上 {n} 条",
			"inspector.publish.cached": "已对上 {n} 条 · 用刚才的结果",
			"inspector.publish.login": "{name} 需要先在 Ego 里登录创作者后台",
			"inspector.publish.views": "{n} 播放",
			"inspector.publish.likes": "{n} 赞",
			"inspector.publish.comments": "{n} 评论",
			"settings.title": "内容工作台",
			"settings.description": "内容目录、启用的平台，以及字幕和封面用的 API Key。",
			"settings.libraryRoot": "影片目录",
			"settings.libraryRootHint": "每个子文件夹是一条内容，命名为 日期_可读标题。",
			"settings.enabledPlatforms": "启用平台",
			"settings.enabledPlatformsHint": "选择 AI 发布和数据同步使用的平台。",
			"settings.scriptRules": "脚本规则（人设）",
			"settings.scriptRulesHint": "写脚本时 AI 必须遵循的语气、结构和禁忌。AI 也可以在对话里帮你记录和更新。",
			"settings.scriptRulesPlaceholder": "例如：口语化，少用术语；开头 3 秒抛出结论；不堆砌 emoji。",
			"settings.platform.xiaohongshu": "小红书",
			"settings.platform.douyin": "抖音",
			"settings.platform.bilibili": "B 站",
			"settings.platform.wechat": "视频号",
			"settings.libraryRootEmpty": "尚未选择",
			"settings.pick": "选择",
			"settings.save": "保存",
			"settings.saving": "保存中",
			"settings.discard": "放弃",
			"settings.saved": "已保存",
			"settings.saveFailed": "保存失败",
			"settings.expand": "展开",
			"settings.collapse": "收起",
			"settings.secrets": "接口密钥",
			"settings.capabilities": "环境状态",
			"settings.capabilitiesHint": "缺失的环节可以需要时再装，AI 会给出安装方式。",
			"settings.capability.library": "内容目录",
			"settings.capability.subtitle": "字幕",
			"settings.capability.cover": "封面",
			"settings.capability.publish": "自动发布",
			"settings.capability.article": "公众号图文",
			"settings.capability.ego": "Ego Browser",
			"settings.state.ready": "可用",
			"settings.state.missing": "不可用",
			"settings.state.unsupported": "不支持",
			"settings.secretsHint": "密钥由 Harness 凭据服务保存。页面只显示配置状态，不读取已保存的 Key。",
			"settings.secret.subtitle": "字幕 · 百炼",
			"settings.secret.subtitleHint": "生成字幕用 FunAudio ASR。对应 DASHSCOPE_API_KEY，到百炼控制台 bailian.console.aliyun.com 申请。",
			"settings.secret.cover": "封面 · 生图服务",
			"settings.secret.coverHint": "用于已配置的生图服务；画面分析使用 Harness 当前 Agent。",
			"settings.secret.placeholder": "留空保留当前 Key",
			"settings.secret.configured": "已配置",
			"settings.secret.missing": "未配置",
			"settings.secret.loadFailed": "状态未知",
			"settings.secret.readOnly": "当前 Key 来自只读环境变量。",
			"settings.secret.saveFailed": "API Key 保存失败，已保留当前输入。",
			"inspector.make": "制作",
			"inspector.cover.generate": "一键生成封面",
			"inspector.cover.regenerate": "再生成封面",
			"inspector.cover.generating": "封面生成中",
			"inspector.cover.ready": "封面已生成",
			"inspector.cover.failed": "封面生成失败",
			"inspector.cover.needKey": "先到设置 → 插件 → 内容工作台 填写 生图服务 API Key",
			"inspector.cover.needVideo": "先有成片才能生成封面",
			"inspector.subtitle.generate": "生成字幕稿",
			"inspector.subtitle.regenerate": "再生成字幕",
			"inspector.subtitle.generating": "字幕生成中",
			"inspector.subtitle.failed": "字幕生成失败",
			"inspector.subtitle.needKey": "先到设置 → 插件 → 内容工作台 填写百炼 API Key",
			"inspector.subtitle.needVideo": "先有成片才能生成字幕"
		};
		const en = {
			"video.title": "Video",
			"video.import": "Import video",
			"video.importHint": "MP4 and MOV. Copies into this episode; the source stays intact. Separate subtitles are optional.",
			"video.importName": "Imported filename",
			"video.start": "Start import",
			"video.cancel": "Cancel import",
			"video.running": "Importing video…",
			"video.completed": "Imported and selected as current video",
			"video.failed": "Import failed",
			"video.cancelled": "Import cancelled",
			"video.current": "Current video",
			"video.cleared": "No current video selected",
			"video.empty": "No video yet. Import a video to begin.",
			"video.choose": "Multiple videos. Choose the current video.",
			"video.missing": "Video is missing. Choose a video again.",
			"video.selected": "Selected",
			"video.desktopRequired": "Open this workbench in DSH Desktop to import local videos.",
			"video.playbackError": "Cannot play this video; the codec may be unsupported. The file is retained and can be opened in an external player.",
			"workbench.restoring": "Restoring this session’s content location…",
			"workbench.relocate": "Choose library again",
			"workbench.relocateHint": "Choose the relocated episode folder. The old session keeps its content link; Open content session starts a session in the new location.",
			"markdown.copy": "Copy",
			"markdown.copied": "Copied",
			"markdown.footnotes": "Footnotes",
			"workbench.title": "Creator workbench",
			"workbench.session": "Open project conversation",
			"workbench.starting": "Opening conversation…",
			"workbench.settings": "Settings",
			"workbench.library": "Back to library",
			"workbench.select": "Select content to view its script, subtitles, covers and publishing status.",
			tab: "Library",
			"tab.sessions": "Chats",
			"session.new.label": "New session",
			"toggle.open": "Open sidebar",
			"toggle.collapse": "Collapse sidebar",
			"toolbar.search": "Search titles",
			"toolbar.search.aria": "Search content",
			"toolbar.search.clear": "Clear search",
			"toolbar.refresh": "Refresh",
			"toolbar.create": "New content",
			"toolbar.create.aria": "New content",
			"create.title": "New content",
			"create.name": "Project name",
			"create.name.placeholder": "e.g. Getting started with DeepSeek Harness",
			"create.confirm": "Create",
			"create.cancel": "Cancel",
			"create.failed": "Could not create",
			"inspector.tab.overview": "Overview",
			"inspector.tab.video": "Video",
			"inspector.tab.article": "Article",
			"inspector.tab.images": "Images",
			"inspector.tab.publishing": "Publishing",
			"inspector.tab.script": "Script",
			"inspector.tab.subtitle": "Subtitles",
			"inspector.stage.idle": "Not started",
			"inspector.stage.finish": "Prepare cover",
			"inspector.stage.publish": "Ready to publish",
			"inspector.stage.live": "Published",
			"inspector.article": "WeChat article",
			"inspector.article.draft": "Article draft",
			"inspector.article.ready": "Draft ready",
			"inspector.article.missing": "Not written",
			"inspector.article.empty": "No article yet. Finished drafts go in this episode's 公众号文章/ folder.",
			"inspector.video.empty": "No video yet.",
			"inspector.publish.unpublished": "Not published",
			"inspector.publish.draft": "Draft ready",
			"inspector.publish.published": "Published",
			"inspector.step.topic": "Topic",
			"inspector.step.finish": "Prepare materials",
			"inspector.step.publish": "Publish",
			"inspector.step.topicHint": "Decide this episode's topic in chat; notes go into topic.md.",
			"inspector.step.finishHint": "Prepare cover and publishing materials. Separate subtitles are optional.",
			"inspector.track.subtitle": "Subtitles (optional)",
			"inspector.track.cover": "Cover",
			"inspector.track.notGenerated": "Not generated",
			"inspector.subtitle.empty": "No subtitle draft yet. Generate one from the overview.",
			"inspector.subtitle.proofPending": "Ready to proofread",
			"inspector.subtitle.burning": "Burning",
			"inspector.subtitle.burned": "Burn finished",
			"inspector.subtitle.burnFailed": "Burn failed",
			"inspector.subtitle.burn": "Burn subtitles",
			"inspector.subtitle.reburn": "Burn again",
			"inspector.subtitle.needDraft": "Generate and preview the subtitle draft before burning",
			"empty.library": "No episodes yet. Create the first one from the top-right button.",
			"empty.detail": "Select an episode from the list.",
			"empty.remote": "Library service is not ready",
			"empty.error": "Failed to load",
			"empty.gone": "This episode was moved or deleted.",
			"empty.loading": "Loading",
			"detail.tags": "Tags",
			"time.justNow": "Just now",
			"time.minutes": "{n}m ago",
			"time.hours": "{n}h ago",
			"time.yesterday": "Yesterday",
			"time.days": "{n}d ago",
			"time.monthDay": "{m}/{d}",
			"time.yearMonthDay": "{y}/{m}/{d}",
			"inspector.close": "Close",
			"inspector.resize": "Resize inspector",
			"inspector.openFolder": "Open folder",
			"inspector.subtitle.previewEdit": "Preview & edit",
			"inspector.platforms": "Video platforms",
			"inspector.sync.title": "Published data",
			"inspector.sync.hint": "Pull views, likes, and comments back from the creator dashboards.",
			"inspector.publish.open": "Open post",
			"inspector.script.placeholder": "No script yet. Write it here, or ask the AI to draft one in chat.",
			"inspector.platform.xhs": "Xiaohongshu",
			"inspector.platform.bilibili": "Bilibili",
			"inspector.platform.douyin": "Douyin",
			"inspector.platform.wechat": "Channels",
			"inspector.publish.sync": "Already published, sync data",
			"inspector.publish.syncing": "Syncing",
			"inspector.publish.platformsLoading": "Reading enabled platforms.",
			"inspector.publish.enablePlatforms": "No platforms are enabled. Enable one in Settings first.",
			"inspector.publish.synced": "Matched {n}",
			"inspector.publish.cached": "Matched {n} · reused last snapshot",
			"inspector.publish.login": "{name} needs an Ego login on the creator site",
			"inspector.publish.views": "{n} views",
			"inspector.publish.likes": "{n} likes",
			"inspector.publish.comments": "{n} comments",
			"settings.title": "Content workbench",
			"settings.description": "Library folder, enabled platforms, and the API keys for subtitles and covers.",
			"settings.libraryRoot": "Library folder",
			"settings.libraryRootHint": "Each subfolder is one episode, named date_readable title.",
			"settings.enabledPlatforms": "Enabled platforms",
			"settings.enabledPlatformsHint": "Choose the platforms used by AI publishing and data sync.",
			"settings.scriptRules": "Script rules (persona)",
			"settings.scriptRulesHint": "Tone, structure, and taboos the AI must follow when writing scripts. The AI can also record and update these in chat.",
			"settings.scriptRulesPlaceholder": "e.g. Conversational, few buzzwords; lead with the conclusion in 3 seconds; no emoji piles.",
			"settings.platform.xiaohongshu": "Xiaohongshu",
			"settings.platform.douyin": "Douyin",
			"settings.platform.bilibili": "Bilibili",
			"settings.platform.wechat": "Channels",
			"settings.libraryRootEmpty": "Not chosen",
			"settings.pick": "Choose",
			"settings.save": "Save",
			"settings.saving": "Saving",
			"settings.discard": "Discard",
			"settings.saved": "Saved",
			"settings.saveFailed": "Save failed",
			"settings.expand": "Expand",
			"settings.collapse": "Collapse",
			"settings.secrets": "API keys",
			"settings.capabilities": "Environment",
			"settings.capabilitiesHint": "Missing pieces can be installed later; the AI will guide you.",
			"settings.capability.library": "Library",
			"settings.capability.subtitle": "Subtitles",
			"settings.capability.cover": "Covers",
			"settings.capability.publish": "Auto publish",
			"settings.capability.article": "Article",
			"settings.capability.ego": "Ego Browser",
			"settings.state.ready": "Ready",
			"settings.state.missing": "Unavailable",
			"settings.state.unsupported": "Unsupported",
			"settings.secretsHint": "Keys are stored by the Harness credential service. This page only shows configuration status and never reads saved keys.",
			"settings.secret.subtitle": "Subtitles · Bailian",
			"settings.secret.subtitleHint": "FunAudio ASR for generating subtitles. Uses DASHSCOPE_API_KEY; apply at bailian.console.aliyun.com.",
			"settings.secret.cover": "Covers · Image service",
			"settings.secret.coverHint": "For the configured image service. Frame analysis uses the current Harness Agent.",
			"settings.secret.placeholder": "Leave blank to keep the current key",
			"settings.secret.configured": "Configured",
			"settings.secret.missing": "Missing",
			"settings.secret.loadFailed": "Status unknown",
			"settings.secret.readOnly": "The current key comes from a read-only environment variable.",
			"settings.secret.saveFailed": "The API key could not be saved. Your input was preserved.",
			"inspector.make": "Produce",
			"inspector.cover.generate": "Generate covers",
			"inspector.cover.regenerate": "Generate covers again",
			"inspector.cover.generating": "Generating covers",
			"inspector.cover.ready": "Covers ready",
			"inspector.cover.failed": "Cover generation failed",
			"inspector.cover.needKey": "Configure an image API key in the workbench settings",
			"inspector.cover.needVideo": "A finished video is required to generate covers",
			"inspector.subtitle.generate": "Generate subtitle draft",
			"inspector.subtitle.regenerate": "Regenerate subtitle draft",
			"inspector.subtitle.generating": "Generating subtitles",
			"inspector.subtitle.failed": "Subtitle generation failed",
			"inspector.subtitle.needKey": "Add a Bailian API key in Settings → Plugins → Content workbench",
			"inspector.subtitle.needVideo": "A finished video is required to generate subtitles"
		};
		//#endregion
		//#region src/client/SettingsNavigation.tsx
		const SettingsNavigation = (0, react.createContext)(() => void 0);
		const useSettingsNavigation = () => (0, react.useContext)(SettingsNavigation);
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ui/ActionButton.css.mjs
		registerPluginCss("dsh-creator-workbench/ActionButton.css", "[data-plugin=\"dsh-creator-workbench\"] .oilActionBar {\r\n  display: flex;\r\n  flex-wrap: wrap;\r\n  gap: 8px;\r\n}\r\n");
		//#endregion
		//#region src/client/ui/ActionButton.tsx
		const VARIANT = {
			primary: "primary",
			secondary: "outline",
			ghost: "ghost"
		};
		function ActionButton({ tone = "secondary", children, ...rest }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: VARIANT[tone],
				...rest,
				"data-creator-tone": tone,
				children
			});
		}
		function ActionBar({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "oilActionBar",
				children
			});
		}
		//#endregion
		//#region src/client/ui/useControlMotion.ts
		/** Presentation only: hiding a page or reducing motion never delays a business operation. */
		function useControlMotion() {
			const available = () => document.visibilityState !== "hidden" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
			const [enabled, setEnabled] = (0, react.useState)(available);
			(0, react.useEffect)(() => {
				const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
				const update = () => setEnabled(available());
				media?.addEventListener("change", update);
				document.addEventListener("visibilitychange", update);
				return () => {
					media?.removeEventListener("change", update);
					document.removeEventListener("visibilitychange", update);
				};
			}, []);
			return enabled;
		}
		//#endregion
		//#region src/client/ui/SelectionRail.tsx
		/** Only the accepted ARIA selection owns this decorative indicator. */
		function SelectionRail({ selected, children, as = "nav", indicator = "surface", ...props }) {
			const root = (0, react.useRef)(null), marker = (0, react.useRef)(null);
			const primed = (0, react.useRef)(false), geometry = (0, react.useRef)(""), measure = (0, react.useRef)(() => {});
			const motion = useControlMotion();
			(0, react.useLayoutEffect)(() => {
				const host = root.current, layer = marker.current;
				if (!host || !layer) return;
				const reveal = (item) => {
					if (!host.clientWidth || host.scrollWidth <= host.clientWidth) return;
					const left = item.offsetLeft, right = left + item.offsetWidth;
					host.scrollLeft = Math.max(0, Math.min(left < host.scrollLeft ? left : right > host.scrollLeft + host.clientWidth ? right - host.clientWidth : host.scrollLeft, host.scrollWidth - host.clientWidth));
				};
				measure.current = (layout = false) => {
					const item = host.querySelector(":scope > button[aria-selected=\"true\"],:scope > button[aria-current]:not([aria-current=\"false\"]),:scope > button[aria-pressed=\"true\"]");
					if (!item) {
						layer.hidden = true;
						return;
					}
					reveal(item);
					const underline = indicator === "underline";
					const style = underline ? getComputedStyle(item) : void 0;
					const insetLeft = style ? parseFloat(style.paddingLeft) || 0 : 0, insetRight = style ? parseFloat(style.paddingRight) || 0 : 0;
					const nextGeometry = `${item.offsetLeft}:${item.offsetTop}:${item.offsetWidth}:${item.offsetHeight}`;
					if (layout && geometry.current === nextGeometry) return;
					geometry.current = nextGeometry;
					layer.hidden = false;
					layer.style.transitionDuration = motion && primed.current && !layout ? "var(--creator-glide-duration)" : "0ms";
					layer.style.width = `${Math.max(0, item.offsetWidth - insetLeft - insetRight)}px`;
					layer.style.height = `${underline ? 2 : item.offsetHeight}px`;
					layer.style.transform = `translate(${item.offsetLeft + insetLeft}px, ${item.offsetTop + (underline ? item.offsetHeight - 3 : 0)}px)`;
					primed.current = true;
				};
				measure.current();
				const frame = requestAnimationFrame(() => measure.current(true));
				return () => cancelAnimationFrame(frame);
			}, [
				selected,
				children,
				indicator,
				motion
			]);
			(0, react.useLayoutEffect)(() => {
				const host = root.current;
				if (!host) return;
				const layout = () => measure.current(true);
				const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(layout) : void 0;
				observer?.observe(host);
				for (const item of host.children) if (item.tagName === "BUTTON") observer?.observe(item);
				const focus = (event) => {
					const item = event.target instanceof HTMLElement ? event.target.closest("button") : null;
					if (item?.parentElement !== host || !item || host.scrollWidth <= host.clientWidth) return;
					host.scrollLeft = Math.max(0, Math.min(item.offsetLeft < host.scrollLeft ? item.offsetLeft : item.offsetLeft + item.offsetWidth > host.scrollLeft + host.clientWidth ? item.offsetLeft + item.offsetWidth - host.clientWidth : host.scrollLeft, host.scrollWidth - host.clientWidth));
				};
				host.addEventListener("focusin", focus);
				window.addEventListener("resize", layout);
				return () => {
					observer?.disconnect();
					host.removeEventListener("focusin", focus);
					window.removeEventListener("resize", layout);
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(as, {
				...props,
				ref: root,
				"data-selection-rail": indicator,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					ref: marker,
					className: "creatorSelectionIndicator",
					"aria-hidden": "true"
				}), children]
			});
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ImagePreview.css.mjs
		registerPluginCss("dsh-creator-workbench/ImagePreview.css", "/* The host owns the viewport layer; only this plugin's media card changes. */\n.creatorLightbox.creatorLightbox {\n  display:flex;align-items:center;justify-content:center;position:relative;\n  width:max-content;max-width:calc(100vw - 112px);max-height:calc(100dvh - max(112px,var(--dsh-frame-overlay-top,24px) + 64px));\n  min-width:0;min-height:0;padding:0;gap:0;overflow:visible;border:0;background:transparent;box-shadow:none;\n  color:var(--dsw-alias-label-primary);animation:creatorLightboxEnter 180ms ease-out;\n}\n.creatorLightbox.creatorLightboxClosing { animation:creatorLightboxExit 120ms ease-in both; }\n.creatorLightboxContent { position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0; }\n.creatorLightboxImage { display:block;width:auto;height:auto;max-width:calc(100vw - 112px);max-height:calc(100dvh - max(112px,var(--dsh-frame-overlay-top,24px) + 64px));object-fit:contain;border-radius:8px;box-shadow:var(--dsw-elevation-prominent);animation:creatorImageChange 120ms ease-out; }\n.creatorLightboxImage { background:#f1f4f8 conic-gradient(#e3eaf5 25%,transparent 0 50%,#e3eaf5 0 75%,transparent 0) 0 0/16px 16px; }\n.creatorLightboxControl { display:grid;place-items:center;position:absolute;z-index:1;width:36px;height:36px;flex:none;padding:0;border:0;border-radius:50%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);cursor:pointer;transition:background 120ms ease-out; }\n.creatorLightboxControl:hover { background:var(--dsw-alias-interactive-bg-hover); }\n.creatorLightboxControl:focus-visible,.creatorLightboxMessage button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:3px; }\n.creatorLightboxControl:disabled { visibility:hidden;pointer-events:none; }\n.creatorLightboxClose { right:-42px;top:0; }\n.creatorLightboxPrevious { left:-44px;top:calc(50% - 18px); }\n.creatorLightboxNext { right:-44px;top:calc(50% - 18px); }\n.creatorLightboxCount { position:absolute;bottom:-34px;left:50%;transform:translateX(-50%);font-size:12px;line-height:22px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);border-radius:6px;padding:0 9px;white-space:nowrap; }\n.creatorLightboxMessage { display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px;max-width:min(440px,calc(100vw - 112px));background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;font:var(--dsw-font-markdown-base);overflow-wrap:anywhere; }\n.creatorLightboxMessage button { border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 16px;background:transparent;color:inherit;font:inherit;cursor:pointer; }\n.creatorLightboxFallback { position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:1000;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1);padding:56px;box-sizing:border-box; }\n@keyframes creatorLightboxEnter { from { opacity:0; } to { opacity:1; } }\n@keyframes creatorLightboxExit { to { opacity:0; } }\n@keyframes creatorImageChange { from { opacity:.65; } to { opacity:1; } }\n@media (max-width:520px) {\n  .creatorLightbox.creatorLightbox,.creatorLightboxImage { max-width:calc(100vw - 40px);max-height:calc(100dvh - 128px); }\n  .creatorLightboxClose { right:0;top:0; }\n  .creatorLightboxPrevious { left:8px; }\n  .creatorLightboxNext { right:8px; }\n}\n@media (prefers-reduced-motion:reduce) {\n  .creatorLightbox.creatorLightbox,.creatorLightboxImage { animation:none; }\n  .creatorLightboxControl { transition:none; }\n}\n");
		//#endregion
		//#region src/client/ImagePreview.tsx
		const Context = (0, react.createContext)(void 0);
		/** Each entrance owns its lifetime; removing a source or unmounting closes its viewer. */
		function useImagePreview(available) {
			const api = (0, react.useContext)(Context), owner = (0, react.useId)();
			(0, react.useLayoutEffect)(() => {
				if (available) api?.reconcile(owner, available);
			}, [
				api,
				owner,
				available
			]);
			(0, react.useEffect)(() => () => api?.dismiss(owner, false), [api, owner]);
			return {
				open: (images, id, trigger) => {
					if (!api) throw new Error("图片预览未接入当前业务区域。");
					api.open(images, id, owner, trigger);
				},
				dismiss: () => api?.dismiss(owner, false)
			};
		}
		function ImagePreviewProvider({ children }) {
			return (0, react.useContext)(Context) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImagePreviewScope, { children });
		}
		function topLayer(dialog) {
			const top = [...document.querySelectorAll("[role=\"dialog\"][aria-modal=\"true\"], [role=\"menu\"]")].at(-1);
			return Boolean(dialog && top === dialog);
		}
		function ImagePreviewScope({ children }) {
			const [request, setRequest] = (0, react.useState)(), [closing, setClosing] = (0, react.useState)(false);
			const current = (0, react.useRef)(request);
			current.current = request;
			const availableOwners = (0, react.useRef)(/* @__PURE__ */ new Map());
			const anchor = (0, react.useRef)(null), frame = (0, react.useRef)(null);
			const timer = (0, react.useRef)(), restoreTimer = (0, react.useRef)();
			const alive = (0, react.useRef)(true), pointerInside = (0, react.useRef)(false);
			const clear = (0, react.useCallback)((restore) => {
				const previous = current.current;
				clearTimeout(timer.current);
				timer.current = void 0;
				current.current = void 0;
				setRequest(void 0);
				setClosing(false);
				clearTimeout(restoreTimer.current);
				if (restore && previous) restoreTimer.current = setTimeout(() => {
					if (!alive.current || current.current) return;
					const trigger = previous.trigger;
					if (trigger?.isConnected) trigger.focus({ preventScroll: true });
					else anchor.current?.closest("[data-surface=\"inspector\"]")?.querySelector("[role=\"tab\"][aria-selected=\"true\"]")?.focus({ preventScroll: true });
				}, 0);
			}, []);
			const close = (0, react.useCallback)((restore = true) => {
				if (!current.current) return;
				if (!restore || document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
					clear(restore);
					return;
				}
				setClosing(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => clear(true), 120);
			}, [clear]);
			const availableRequest = (0, react.useCallback)(() => {
				const value = current.current;
				if (!value) return;
				const allowed = availableOwners.current.get(value.owner);
				if (!allowed) return value;
				const item = value.images[value.index], images = value.images.filter((image) => allowed.some((valid) => valid.id === image.id && valid.revision === image.revision));
				const index = images.findIndex((image) => image === item);
				if (index < 0) {
					close(false);
					return;
				}
				if (images.length !== value.images.length) {
					const next = {
						...value,
						images,
						index
					};
					current.current = next;
					setRequest(next);
					return next;
				}
				return value;
			}, [close]);
			const api = (0, react.useRef)();
			if (!api.current) api.current = {
				open: (images, id, owner, trigger) => {
					const allowed = availableOwners.current.get(owner);
					const valid = allowed ? images.filter((image) => allowed.some((value) => value.id === image.id && value.revision === image.revision)) : images;
					const index = valid.findIndex((image) => image.id === id);
					if (index < 0) return;
					clearTimeout(timer.current);
					clearTimeout(restoreTimer.current);
					setClosing(false);
					const next = {
						images: [...valid],
						index,
						owner,
						trigger: trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : void 0)
					};
					current.current = next;
					setRequest(next);
				},
				reconcile: (owner, images) => {
					availableOwners.current.set(owner, images);
					if (current.current?.owner === owner) availableRequest();
				},
				dismiss: (owner, restore = false) => {
					availableOwners.current.delete(owner);
					if (current.current?.owner === owner) close(restore);
				}
			};
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
					clearTimeout(timer.current);
					clearTimeout(restoreTimer.current);
				};
			}, []);
			const move = (0, react.useCallback)((delta) => {
				const value = availableRequest();
				if (!value) return;
				const index = value.index + delta;
				if (index >= 0 && index < value.images.length) {
					const next = {
						...value,
						index
					};
					current.current = next;
					setRequest(next);
				}
			}, [availableRequest]);
			const open = Boolean(request);
			let hostModal = false;
			try {
				hostModal = typeof _deepseek_ai_dsh_client_ui_primitives.Modal === "function";
			} catch {}
			(0, react.useEffect)(() => {
				if (!open) return;
				const dialog = frame.current?.closest("[role=\"dialog\"]") ?? frame.current;
				if (!hostModal) dialog?.querySelector("[data-modal-autofocus]")?.focus({ preventScroll: true });
				const body = anchor.current?.closest("[data-surface=\"inspector\"]")?.querySelector(".body");
				const overflow = body?.style.overflow;
				if (body) body.style.overflow = "hidden";
				const pointer = (event) => {
					pointerInside.current = Boolean(dialog?.contains(event.target));
				};
				const keyboard = (event) => {
					if (!topLayer(dialog ?? null) || event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
					if (event.key === "Escape") pointerInside.current = false;
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
						event.preventDefault();
						event.stopPropagation();
						move(event.key === "ArrowLeft" ? -1 : 1);
					}
					if (hostModal) return;
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						close();
					}
					if (event.key === "Tab") {
						const items = [...dialog?.querySelectorAll("button:not(:disabled),[tabindex=\"0\"]") ?? []], first = items[0], last = items.at(-1), active = document.activeElement;
						if (!dialog?.contains(active) || event.shiftKey && active === first || !event.shiftKey && active === last) {
							event.preventDefault();
							(event.shiftKey ? last : first)?.focus();
						}
					}
				};
				const visibility = () => {
					if (document.hidden && timer.current) clear(true);
				};
				document.addEventListener("pointerdown", pointer, true);
				document.addEventListener("keydown", keyboard, true);
				document.addEventListener("visibilitychange", visibility);
				return () => {
					document.removeEventListener("pointerdown", pointer, true);
					document.removeEventListener("keydown", keyboard, true);
					document.removeEventListener("visibilitychange", visibility);
					if (body?.style.overflow === "hidden") body.style.overflow = overflow ?? "";
				};
			}, [
				open,
				hostModal,
				close,
				move,
				clear
			]);
			const item = request?.images[request.index];
			const dismissMask = () => {
				if (topLayer(frame.current?.closest("[role=\"dialog\"]") ?? null) && !pointerInside.current) close();
				pointerInside.current = false;
			};
			const content = request && item && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: frame,
				"data-plugin": "dsh-creator-workbench",
				"data-lightbox-phase": closing ? "closing" : "open",
				className: "creatorLightboxContent",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						"data-modal-autofocus": true,
						type: "button",
						className: "creatorLightboxClose creatorLightboxControl",
						"aria-label": "关闭图片",
						onClick: () => close(),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							width: "20",
							height: "20",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.8",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6 6 12 12M18 6 6 18" })
						})
					}),
					request.images.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "creatorLightboxPrevious creatorLightboxControl",
							"aria-label": "上一张",
							disabled: request.index === 0,
							onClick: () => move(-1),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, { direction: "left" })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "creatorLightboxNext creatorLightboxControl",
							"aria-label": "下一张",
							disabled: request.index === request.images.length - 1,
							onClick: () => move(1),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, { direction: "right" })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "creatorLightboxCount",
							"aria-live": "polite",
							children: [
								request.index + 1,
								" / ",
								request.images.length
							]
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreviewMedia, {
						image: item,
						active: !closing
					}, `${item.id}:${item.revision ?? ""}`)
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Context.Provider, {
				value: api.current,
				children: [
					children,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						ref: anchor,
						hidden: true
					}),
					request && item && (hostModal ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: true,
						headless: true,
						backdropBlur: false,
						title: item.title,
						className: `creatorLightbox ${closing ? "creatorLightboxClosing" : ""}`,
						onClose: dismissMask,
						children: content
					}) : (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `creatorLightboxFallback ${closing ? "creatorLightboxClosing" : ""}`,
						onClick: (event) => {
							if (event.target === event.currentTarget) dismissMask();
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "dialog",
							"aria-modal": "true",
							"aria-label": item.title,
							className: "creatorLightbox",
							children: content
						})
					}), document.body))
				]
			});
		}
		function PreviewMedia({ image, active }) {
			const [src, setSrc] = (0, react.useState)(image.src), [error, setError] = (0, react.useState)(""), [retry, setRetry] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				if (!active) return () => controller.abort();
				setError("");
				setSrc(image.src);
				if (!image.src) Promise.resolve().then(() => image.load?.(controller.signal)).then((value) => {
					if (!controller.signal.aborted) {
						if (value) setSrc(value);
						else setError("图片无法读取");
					}
				}, (cause) => {
					if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "图片无法读取");
				});
				return () => controller.abort();
			}, [
				image,
				retry,
				active
			]);
			return src && !error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				className: "creatorLightboxImage",
				src,
				alt: image.title,
				draggable: false,
				onError: () => setError("图片无法显示")
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "creatorLightboxMessage",
				role: error ? "alert" : "status",
				children: [error || "正在读取图片…", error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => {
						image.reload?.();
						setRetry((value) => value + 1);
					},
					children: "重试"
				})]
			});
		}
		function Arrow({ direction }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "20",
				height: "20",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.8",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7" })
			});
		}
		//#endregion
		//#region src/client/ui/useControlPopup.ts
		/** Shared geometry and lifetime; callers retain their own menu/listbox keyboard semantics. */
		function useControlPopup(open, close, root, anchor, popup, align = "start", matchWidth = false, onLayout) {
			const motion = useControlMotion(), [exiting, setExiting] = (0, react.useState)(false);
			const lastOpen = (0, react.useRef)(open), current = (0, react.useRef)({
				open,
				close,
				onLayout
			});
			current.current = {
				open,
				close,
				onLayout
			};
			const mounted = open || exiting || motion && lastOpen.current;
			(0, react.useLayoutEffect)(() => {
				const wasOpen = lastOpen.current;
				lastOpen.current = open;
				if (open) {
					setExiting(false);
					return;
				}
				if (!wasOpen || !motion) {
					setExiting(false);
					return;
				}
				setExiting(true);
				const timer = setTimeout(() => setExiting(false), 120);
				return () => clearTimeout(timer);
			}, [open, motion]);
			(0, react.useLayoutEffect)(() => {
				const layer = popup.current, trigger = anchor.current;
				if (!mounted || !layer || !trigger) return;
				const place = () => {
					const bounds = root.current?.closest("[data-plugin=\"dsh-creator-workbench\"]")?.getBoundingClientRect();
					const a = trigger.getBoundingClientRect();
					const left = Math.max(0, bounds?.left ?? 0) + 4, right = Math.min(window.innerWidth, bounds?.right ?? window.innerWidth) - 4;
					const top = Math.max(0, bounds?.top ?? 0) + 4, bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 4;
					layer.style.maxWidth = `${Math.max(0, right - left)}px`;
					if (matchWidth) layer.style.width = `${Math.min(a.width, Math.max(0, right - left))}px`;
					const below = bottom - a.bottom - 4, above = a.top - top - 4;
					const upward = below < Math.min(layer.scrollHeight, 280) && above > below;
					layer.style.maxHeight = `${Math.max(0, Math.min(360, upward ? above : below))}px`;
					if (layer.showPopover) {
						layer.setAttribute("popover", "manual");
						if (!layer.matches(":popover-open")) layer.showPopover();
					}
					layer.style.position = "fixed";
					layer.style.left = `${Math.max(left, Math.min(align === "end" ? a.right - layer.offsetWidth : a.left, right - layer.offsetWidth))}px`;
					layer.style.top = `${Math.max(top, upward ? a.top - layer.offsetHeight - 4 : a.bottom + 4)}px`;
					layer.dataset.direction = upward ? "up" : "down";
					current.current.onLayout?.();
				};
				place();
				const outside = (event) => {
					if (current.current.open && event.target instanceof Node && !root.current?.contains(event.target) && !layer.contains(event.target)) current.current.close();
				};
				const scrolled = (event) => {
					if (current.current.open && event.target instanceof Node && !layer.contains(event.target)) current.current.close();
				};
				document.addEventListener("pointerdown", outside);
				document.addEventListener("scroll", scrolled, true);
				window.addEventListener("resize", place);
				const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : void 0;
				observer?.observe(trigger);
				observer?.observe(layer);
				return () => {
					observer?.disconnect();
					document.removeEventListener("pointerdown", outside);
					document.removeEventListener("scroll", scrolled, true);
					window.removeEventListener("resize", place);
					if (layer.hidePopover && layer.matches(":popover-open")) layer.hidePopover();
				};
			}, [
				mounted,
				align,
				matchWidth
			]);
			return {
				mounted,
				phase: open ? "open" : "closing",
				motion
			};
		}
		/** Move the highlight in scroll-content coordinates, never moving focus or ancestors. */
		function placeOptionHighlight(layer, item, marker, animate) {
			const top = item.offsetTop, bottom = top + item.offsetHeight;
			if (top < layer.scrollTop) layer.scrollTop = top;
			else if (bottom > layer.scrollTop + layer.clientHeight && layer.clientHeight) layer.scrollTop = bottom - layer.clientHeight;
			marker.style.transitionDuration = animate ? "var(--creator-glide-duration)" : "0ms";
			marker.style.transform = `translate(${item.offsetLeft}px, ${top}px)`;
			marker.style.width = `${item.offsetWidth}px`;
			marker.style.height = `${item.offsetHeight}px`;
		}
		/** A portaled menu leaves from its trigger's place in the document, not the end of body. */
		function adjacentTabStop(anchor, backwards, popup) {
			const stops = [...document.querySelectorAll("a[href],button,input,textarea,select,[tabindex]")].filter((item) => {
				if (item.tabIndex < 0 || item.matches(":disabled") || popup?.contains(item) || item.closest("[hidden],[inert],[aria-hidden=\"true\"]")) return false;
				for (let parent = item; parent; parent = parent.parentElement) {
					const style = getComputedStyle(parent);
					if (style.display === "none" || style.visibility === "hidden") return false;
				}
				return true;
			});
			stops.sort((a, b) => (a.tabIndex || Number.MAX_SAFE_INTEGER) - (b.tabIndex || Number.MAX_SAFE_INTEGER));
			const position = stops.indexOf(anchor);
			return position < 0 ? void 0 : stops[position + (backwards ? -1 : 1)];
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ui/ControlPopup.css.mjs
		registerPluginCss("dsh-creator-workbench/ControlPopup.css", "[data-plugin=\"dsh-creator-workbench\"] .creatorSelect { position:relative;display:inline-flex;min-width:0;max-width:100%;width:100%;vertical-align:middle; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectTrigger { display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:36px;padding:6px 10px;border:1px solid var(--creator-field-border,var(--dsw-alias-border-l2));border-radius:var(--creator-control-radius,12px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectValue { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectChevron { flex:none;transition:transform var(--creator-glide-duration,220ms) var(--creator-ease,ease-out); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectTrigger[aria-expanded=\"true\"] .creatorSelectChevron { transform:rotate(180deg); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectTrigger:disabled { cursor:default;opacity:.5; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectTrigger:not(:disabled):hover { border-color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectTrigger:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectTrigger[aria-invalid=\"true\"] { border-color:var(--dsw-alias-state-error-primary); }\n[data-plugin=\"dsh-creator-workbench\"].creatorControlPopup { position:absolute;top:calc(100% + 4px);left:0;z-index:20;display:flex;flex-direction:column;gap:2px;min-width:0;box-sizing:border-box;max-height:360px;overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--creator-control-radius,12px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 6px 20px var(--dsw-alias-bg-mask-1);isolation:isolate;overscroll-behavior:contain; }\n[data-plugin=\"dsh-creator-workbench\"].creatorControlPopup[popover] { position:fixed;inset:auto;margin:0; }\n[data-plugin=\"dsh-creator-workbench\"].creatorControlPopup { overflow-x:hidden; }\n[data-plugin=\"dsh-creator-workbench\"].creatorControlPopup[data-phase=\"open\"] { animation:creatorPopupEnter 180ms var(--creator-ease,ease-out) both; }\n[data-plugin=\"dsh-creator-workbench\"].creatorControlPopup[data-phase=\"closing\"] { pointer-events:none;animation:creatorPopupExit 120ms ease-out both; }\n[data-plugin=\"dsh-creator-workbench\"].creatorControlPopup[data-motion=\"false\"] { animation:none; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectOption { position:relative;display:flex;box-sizing:border-box;align-items:center;gap:8px;min-height:32px;flex:none;padding:4px 8px;border-radius:8px;font:inherit;font-size:13px;line-height:20px;cursor:pointer;overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectOption>span:first-child { flex:1;min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectCheck { width:16px;flex:none;color:var(--dsw-alias-state-business-primary); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectOption[aria-disabled=\"true\"] { opacity:.4;cursor:default; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectOption[aria-selected=\"true\"] { font-weight:500; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorOptionHighlight { pointer-events:none;position:absolute;left:0;top:0;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);z-index:-1;transition-property:transform,width,height;transition-timing-function:var(--creator-ease,ease-out); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorPopupMessage { margin:0;padding:10px;font-size:13px;overflow-wrap:anywhere; }\n@keyframes creatorPopupEnter { from { opacity:0;transform:translateY(-3px); } to { opacity:1;transform:translateY(0); } }\n@keyframes creatorPopupExit { from { opacity:1; } to { opacity:0; } }\n@media(prefers-reduced-motion:reduce) {\n  [data-plugin=\"dsh-creator-workbench\"].creatorControlPopup { animation:none; }\n  [data-plugin=\"dsh-creator-workbench\"] :is(.creatorSelectChevron,.creatorOptionHighlight) { transition:none; }\n}\n");
		//#endregion
		//#region src/client/ui/CreatorSelect.tsx
		function textOf(node) {
			return react.Children.toArray(node).map((child) => (0, react.isValidElement)(child) ? textOf(child.props.children) : String(child)).join("");
		}
		function optionsOf(children) {
			return react.Children.toArray(children).flatMap((child) => {
				if (!(0, react.isValidElement)(child)) return [];
				if (child.type === react.Fragment) return optionsOf(child.props.children);
				if (child.type !== "option") return [];
				return [{
					value: String(child.props.value ?? textOf(child.props.children)),
					label: child.props.children,
					text: textOf(child.props.children),
					disabled: !!child.props.disabled
				}];
			});
		}
		/** Controlled selection: browsing is local; only explicit confirmation invokes the caller. */
		function CreatorSelect({ value, onValueChange, children, disabled, loading, error, className = "", name, required, ...props }) {
			const options = optionsOf(children), selected = options.findIndex((option) => option.value === value);
			const [open, setOpen] = (0, react.useState)(false), [active, setActive] = (0, react.useState)(-1);
			const root = (0, react.useRef)(null), trigger = (0, react.useRef)(null), popup = (0, react.useRef)(null), highlight = (0, react.useRef)(null);
			const composing = (0, react.useRef)(false), search = (0, react.useRef)({
				value: "",
				at: 0
			}), primed = (0, react.useRef)(false), committed = (0, react.useRef)(false);
			const uid = (0, react.useId)(), id = `${uid}-list`;
			const close = () => setOpen(false);
			const layoutHighlight = () => {
				const item = popup.current?.querySelector(`[data-option-index="${active}"]`);
				if (popup.current && item && highlight.current) placeOptionHighlight(popup.current, item, highlight.current, false);
			};
			const layer = useControlPopup(open, close, root, trigger, popup, "start", true, layoutHighlight);
			const enabled = error ? [] : options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
			(0, react.useLayoutEffect)(() => {
				if (open && (error || !options[active] || options[active]?.disabled)) setActive(enabled[0] ?? -1);
			}, [
				open,
				active,
				error,
				options.map((option) => `${option.value}:${option.disabled}`).join("\0")
			]);
			(0, react.useLayoutEffect)(() => {
				if (!open) {
					primed.current = false;
					return;
				}
				const item = popup.current?.querySelector(`[data-option-index="${active}"]`);
				if (popup.current && item && highlight.current) placeOptionHighlight(popup.current, item, highlight.current, primed.current && layer.motion);
				primed.current = true;
			}, [
				open,
				active,
				options.length,
				layer.motion
			]);
			(0, react.useLayoutEffect)(() => {
				if (disabled || loading) setOpen(false);
			}, [disabled, loading]);
			const show = (last = false) => {
				if (disabled || loading) return;
				committed.current = false;
				search.current = {
					value: "",
					at: 0
				};
				setActive(!error && selected >= 0 && !options[selected]?.disabled ? selected : enabled[last ? enabled.length - 1 : 0] ?? -1);
				setOpen(true);
			};
			const confirm = (index) => {
				const option = options[index];
				if (!open || error || committed.current || !option || option.disabled) return;
				committed.current = true;
				close();
				trigger.current?.focus({ preventScroll: true });
				if (option.value !== value) onValueChange(option.value);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: root,
				className: `creatorSelect ${className}`,
				onBlurCapture: (event) => {
					if (event.relatedTarget instanceof Node) {
						if (!event.currentTarget.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) close();
					} else queueMicrotask(() => {
						if (root.current?.isConnected && !root.current.contains(document.activeElement) && !popup.current?.contains(document.activeElement)) close();
					});
				},
				children: [
					name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "hidden",
						name,
						value,
						disabled
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						...props,
						id: props.id ?? `${uid}-trigger`,
						value,
						ref: trigger,
						type: "button",
						role: "combobox",
						className: "creatorSelectTrigger",
						disabled: disabled || loading,
						"aria-expanded": open,
						"aria-controls": open ? id : void 0,
						"aria-haspopup": "listbox",
						"aria-required": required,
						"aria-busy": loading || void 0,
						"aria-activedescendant": open && active >= 0 ? `${id}-${active}` : void 0,
						onClick: () => open ? close() : show(),
						onCompositionStart: () => {
							composing.current = true;
						},
						onCompositionEnd: () => {
							composing.current = false;
						},
						onKeyDown: (event) => {
							if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
							if (event.key === "Tab") {
								close();
								return;
							}
							if (event.key === "Escape" && open) {
								event.preventDefault();
								event.stopPropagation();
								close();
								return;
							}
							if ([
								"ArrowDown",
								"ArrowUp",
								"Home",
								"End"
							].includes(event.key)) {
								event.preventDefault();
								event.stopPropagation();
								if (!open) {
									show(event.key === "ArrowUp" || event.key === "End");
									return;
								}
								const position = enabled.indexOf(active);
								setActive(enabled[event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (position + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length] ?? -1);
								return;
							}
							if (event.key === "Enter" || event.key === " " && !search.current.value) {
								event.preventDefault();
								event.stopPropagation();
								if (open) confirm(active);
								else show();
								return;
							}
							if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
								event.preventDefault();
								if (!open) show();
								const now = Date.now(), previous = search.current;
								const query = (now - previous.at < 650 ? previous.value : "") + event.key.toLocaleLowerCase();
								search.current = {
									value: query,
									at: now
								};
								const needle = [...query].every((character) => character === query[0]) ? query.charAt(0) : query;
								const found = [...enabled.filter((i) => i > active), ...enabled.filter((i) => i <= active)].find((i) => options[i]?.text.toLocaleLowerCase().startsWith(needle));
								if (found !== void 0) setActive(found);
							}
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "creatorSelectValue",
							title: options[selected]?.text,
							children: loading ? "正在读取…" : options[selected]?.label ?? "请选择"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							className: "creatorSelectChevron",
							"aria-hidden": "true",
							width: "16",
							height: "16",
							viewBox: "0 0 16 16",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: "m4 6 4 4 4-4",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "1.5",
								strokeLinecap: "round",
								strokeLinejoin: "round"
							})
						})]
					}),
					layer.mounted && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: popup,
						id,
						role: open ? "listbox" : void 0,
						"aria-label": props["aria-label"] ? `${props["aria-label"]}选项` : void 0,
						"aria-labelledby": !props["aria-label"] ? props["aria-labelledby"] ?? props.id ?? `${uid}-trigger` : void 0,
						"aria-hidden": !open || void 0,
						"data-plugin": "dsh-creator-workbench",
						"data-control-popup": "select",
						"data-phase": layer.phase,
						"data-motion": layer.motion,
						className: "creatorControlPopup creatorSelectPopup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							ref: highlight,
							className: "creatorOptionHighlight",
							"aria-hidden": "true",
							hidden: active < 0
						}), error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							className: "creatorPopupMessage",
							children: error
						}) : !options.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "creatorPopupMessage",
							children: "暂无选项"
						}) : options.map((option, index) => option.disabled && option.value === "" && value !== "" && selected >= 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							id: `${id}-${index}`,
							role: "option",
							"aria-selected": option.value === value,
							"aria-disabled": option.disabled || void 0,
							"data-option-value": option.value,
							"data-option-index": index,
							"data-highlighted": active === index || void 0,
							className: "creatorSelectOption",
							onPointerMove: (event) => {
								if (open && !option.disabled && event.pointerType !== "touch") setActive(index);
							},
							onPointerDown: (event) => event.preventDefault(),
							onClick: (event) => {
								event.preventDefault();
								event.stopPropagation();
								confirm(index);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: option.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "creatorSelectCheck",
								"aria-hidden": "true",
								children: option.value === value ? "✓" : ""
							})]
						}, option.value))]
					}), document.body)
				]
			});
		}
		//#endregion
		//#region src/client/publicationText.ts
		/** Adapt an explicit reuse/copy operation, without changing the source document. */
		function publicationText(source, platform, type, format) {
			if (type === "article" && (platform === "official-account" || platform === "bilibili")) return source;
			if (format !== "html" && !/^\s*(?:<!doctype\s+html|<(?:html|head|style|script|body|article|section|div|p|h[1-6])\b)/i.test(source.replace(/<!--([\s\S]*?)-->/g, ""))) return source;
			const text = source.replace(/<!--([\s\S]*?)-->/g, "").replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|h[1-6]|div|section|article|li|ul|ol|blockquote|tr)\s*>/gi, "\n\n").replace(/<li\b[^>]*>/gi, "• ").replace(/<[^>]*>/g, "");
			const decoder = document.createElement("textarea");
			return text.replace(/&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g, (entity) => {
				decoder.innerHTML = entity;
				return decoder.value;
			}).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
		}
		//#endregion
		//#region src/client/platformIcons.ts
		const PLATFORM_ICONS = {
			xhs: "data:image/svg+xml,%3Csvg%20fill%3D%22%23FF2442%22%20role%3D%22img%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Ctitle%3EXiaohongshu%3C/title%3E%3Cpath%20d%3D%22M22.405%209.879c.002.016.01.02.07.019h.725a.797.797%200%200%200%20.78-.972.794.794%200%200%200-.884-.618.795.795%200%200%200-.692.794c0%20.101-.002.666.001.777zm-11.509%204.808c-.203.001-1.353.004-1.685.003a2.528%202.528%200%200%201-.766-.126.025.025%200%200%200-.03.014L7.7%2016.127a.025.025%200%200%200%20.01.032c.111.06.336.124.495.124.66.01%201.32.002%201.981%200%20.01%200%20.02-.006.023-.015l.712-1.545a.025.025%200%200%200-.024-.036zM.477%209.91c-.071%200-.076.002-.076.01a.834.834%200%200%200-.01.08c-.027.397-.038.495-.234%203.06-.012.24-.034.389-.135.607-.026.057-.033.042.003.112.046.092.681%201.523.787%201.74.008.015.011.02.017.02.008%200%20.033-.026.047-.044.147-.187.268-.391.371-.606.306-.635.44-1.325.486-1.706.014-.11.021-.22.03-.33l.204-2.616.022-.293c.003-.029%200-.033-.03-.034zm7.203%203.757a1.427%201.427%200%200%201-.135-.607c-.004-.084-.031-.39-.235-3.06a.443.443%200%200%200-.01-.082c-.004-.011-.052-.008-.076-.008h-1.48c-.03.001-.034.005-.03.034l.021.293c.076.982.153%201.964.233%202.946.05.4.186%201.085.487%201.706.103.215.223.419.37.606.015.018.037.051.048.049.02-.003.742-1.642.804-1.765.036-.07.03-.055.003-.112zm3.861-.913h-.872a.126.126%200%200%201-.116-.178l1.178-2.625a.025.025%200%200%200-.023-.035l-1.318-.003a.148.148%200%200%201-.135-.21l.876-1.954a.025.025%200%200%200-.023-.035h-1.56c-.01%200-.02.006-.024.015l-.926%202.068c-.085.169-.314.634-.399.938a.534.534%200%200%200-.02.191.46.46%200%200%200%20.23.378.981.981%200%200%200%20.46.119h.59c.041%200-.688%201.482-.834%201.972a.53.53%200%200%200-.023.172.465.465%200%200%200%20.23.398c.15.092.342.12.475.12l1.66-.001c.01%200%20.02-.006.023-.015l.575-1.28a.025.025%200%200%200-.024-.035zm-6.93-4.937H3.1a.032.032%200%200%200-.034.033c0%201.048-.01%202.795-.01%206.829%200%20.288-.269.262-.28.262h-.74c-.04.001-.044.004-.04.047.001.037.465%201.064.555%201.263.01.02.03.033.051.033.157.003.767.009.938-.014.153-.02.3-.06.438-.132.3-.156.49-.419.595-.765.052-.172.075-.353.075-.533.002-2.33%200-4.66-.007-6.991a.032.032%200%200%200-.032-.032zm11.784%206.896c0-.014-.01-.021-.024-.022h-1.465c-.048-.001-.049-.002-.05-.049v-4.66c0-.072-.005-.07.07-.07h.863c.08%200%20.075.004.075-.074V8.393c0-.082.006-.076-.08-.076h-3.5c-.064%200-.075-.006-.075.073v1.445c0%20.083-.006.077.08.077h.854c.075%200%20.07-.004.07.07v4.624c0%20.095.008.084-.085.084-.37%200-1.11-.002-1.304%200-.048.001-.06.03-.06.03l-.697%201.519s-.014.025-.008.036c.006.01.013.008.058.008%201.748.003%203.495.002%205.243.002.03-.001.034-.006.035-.033v-1.539zm4.177-3.43c0%20.013-.007.023-.02.024-.346.006-.692.004-1.037.004-.014-.002-.022-.01-.022-.024-.005-.434-.007-.869-.01-1.303%200-.072-.006-.071.07-.07l.733-.003c.041%200%20.081.002.12.015.093.025.16.107.165.204.006.431.002%201.153.001%201.153zm2.67.244a1.953%201.953%200%200%200-.883-.222h-.18c-.04-.001-.04-.003-.042-.04V10.21c0-.132-.007-.263-.025-.394a1.823%201.823%200%200%200-.153-.53%201.533%201.533%200%200%200-.677-.71%202.167%202.167%200%200%200-1-.258c-.153-.003-.567%200-.72%200-.07%200-.068.004-.068-.065V7.76c0-.031-.01-.041-.046-.039H17.93s-.016%200-.023.007c-.006.006-.008.012-.008.023v.546c-.008.036-.057.015-.082.022h-.95c-.022.002-.028.008-.03.032v1.481c0%20.09-.004.082.082.082h.913c.082%200%20.072.128.072.128V11.19s.003.117-.06.117h-1.482c-.068%200-.06.082-.06.082v1.445s-.01.068.064.068h1.457c.082%200%20.076-.006.076.079v3.225c0%20.088-.007.081.082.081h1.43c.09%200%20.082.007.082-.08v-3.27c0-.029.006-.035.033-.035l2.323-.003c.098%200%20.191.02.28.061a.46.46%200%200%201%20.274.407c.008.395.003.79.003%201.185%200%20.259-.107.367-.33.367h-1.218c-.023.002-.029.008-.028.033.184.437.374.871.57%201.303a.045.045%200%200%200%20.04.026c.17.005.34.002.51.003.15-.002.517.004.666-.01a2.03%202.03%200%200%200%20.408-.075c.59-.18.975-.698.976-1.313v-1.981c0-.128-.01-.254-.034-.38%200%20.078-.029-.641-.724-.998z%22/%3E%3C/svg%3E",
			bilibili: "data:image/svg+xml,%3Csvg%20fill%3D%22%2300A1D6%22%20role%3D%22img%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Ctitle%3EBilibili%3C/title%3E%3Cpath%20d%3D%22M17.813%204.653h.854c1.51.054%202.769.578%203.773%201.574%201.004.995%201.524%202.249%201.56%203.76v7.36c-.036%201.51-.556%202.769-1.56%203.773s-2.262%201.524-3.773%201.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036%2018.858%200%2017.347v-7.36c.036-1.511.556-2.765%201.56-3.76%201.004-.996%202.262-1.52%203.773-1.574h.774l-1.174-1.12a1.234%201.234%200%200%201-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347%200%20.653.124.92.373L9.653%204.44c.071.071.134.142.187.213h4.267a.836.836%200%200%201%20.16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347%200%20.662.151.929.4.267.249.391.551.391.907%200%20.355-.124.657-.373.906zM5.333%207.24c-.746.018-1.373.276-1.88.773-.506.498-.769%201.13-.786%201.894v7.52c.017.764.28%201.395.786%201.893.507.498%201.134.756%201.88.773h13.334c.746-.017%201.373-.275%201.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8%2011.107c.373%200%20.684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8%200c.373%200%20.684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z%22/%3E%3C/svg%3E",
			douyin: "data:image/svg+xml,%3Csvg%20fill%3D%22%23000000%22%20role%3D%22img%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Ctitle%3ETikTok%3C/title%3E%3Cpath%20d%3D%22M12.525.02c1.31-.02%202.61-.01%203.91-.02.08%201.53.63%203.09%201.75%204.17%201.12%201.11%202.7%201.62%204.24%201.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01%202.92.01%205.84-.02%208.75-.08%201.4-.54%202.79-1.35%203.94-1.31%201.92-3.58%203.17-5.91%203.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9%201.12-3.72%202.58-4.96%201.66-1.44%203.98-2.13%206.15-1.72.02%201.48-.04%202.96-.04%204.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11%201.04-1.36%201.75-.21.51-.15%201.07-.14%201.61.24%201.64%201.82%203.02%203.5%202.87%201.12-.01%202.19-.66%202.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z%22/%3E%3C/svg%3E",
			wechat: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cg%20stroke-linejoin%3D%22round%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20fill%3D%22%23F5C84A%22%20stroke%3D%22%23F5C84A%22%20stroke-width%3D%222.2%22%20d%3D%22M2.2%206.1v11.8L13.4%2012z%22/%3E%3Cpath%20fill%3D%22%23EE8A28%22%20stroke%3D%22%23EE8A28%22%20stroke-width%3D%222.2%22%20d%3D%22M9.4%206.1v11.8L20.6%2012z%22/%3E%3C/g%3E%3C/svg%3E",
			article: "data:image/svg+xml,%3Csvg%20fill%3D%22%2307C160%22%20role%3D%22img%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Ctitle%3EWeChat%3C/title%3E%3Cpath%20d%3D%22M8.691%202.188C3.891%202.188%200%205.476%200%209.53c0%202.212%201.17%204.203%203.002%205.55a.59.59%200%200%201%20.213.665l-.39%201.48c-.019.07-.048.141-.048.213%200%20.163.13.295.29.295a.326.326%200%200%200%20.167-.054l1.903-1.114a.864.864%200%200%201%20.717-.098%2010.16%2010.16%200%200%200%202.837.403c.276%200%20.543-.027.811-.05-.857-2.578.157-4.972%201.932-6.446%201.703-1.415%203.882-1.98%205.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785%205.991c.642%200%201.162.529%201.162%201.18a1.17%201.17%200%200%201-1.162%201.178A1.17%201.17%200%200%201%204.623%207.17c0-.651.52-1.18%201.162-1.18zm5.813%200c.642%200%201.162.529%201.162%201.18a1.17%201.17%200%200%201-1.162%201.178%201.17%201.17%200%200%201-1.162-1.178c0-.651.52-1.18%201.162-1.18zm5.34%202.867c-1.797-.052-3.746.512-5.28%201.786-1.72%201.428-2.687%203.72-1.78%206.22.942%202.453%203.666%204.229%206.884%204.229.826%200%201.622-.12%202.361-.336a.722.722%200%200%201%20.598.082l1.584.926a.272.272%200%200%200%20.14.047c.134%200%20.24-.111.24-.247%200-.06-.023-.12-.038-.177l-.327-1.233a.582.582%200%200%201-.023-.156.49.49%200%200%201%20.201-.398C23.024%2018.48%2024%2016.82%2024%2014.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53%203.274c.535%200%20.969.44.969.982a.976.976%200%200%201-.969.983.976.976%200%200%201-.969-.983c0-.542.434-.982.97-.982zm4.844%200c.535%200%20.969.44.969.982a.976.976%200%200%201-.969.983.976.976%200%200%201-.969-.983c0-.542.434-.982.969-.982z%22/%3E%3C/svg%3E"
		};
		//#endregion
		//#region src/client/PlatformMark.tsx
		function PlatformMark({ id, size = 18 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				className: "platformMark",
				"data-platform": id,
				src: PLATFORM_ICONS[id],
				width: size,
				height: size,
				alt: "",
				draggable: false
			});
		}
		//#endregion
		//#region src/client/publicationAutosave.ts
		const publicationInput = (p) => ({
			platform: p.platform,
			type: p.type,
			title: p.title,
			body: p.body ?? "",
			tags: [...p.tags],
			imageIds: [...p.imageIds],
			...p.video ? { video: p.video } : {},
			...p.articleId ? { articleId: p.articleId } : {},
			...p.articleFile ? { articleFile: p.articleFile } : {},
			...p.coverImageId ? { coverImageId: p.coverImageId } : {},
			...p.coverFiles ? { coverFiles: p.coverFiles } : {},
			...p.category ? { category: p.category } : {},
			...p.source ? { source: p.source } : {}
		});
		const copy = (value) => structuredClone(value);
		const serialize = (input) => JSON.stringify(input);
		/** Survives page unmounts. Each material owns its queue and exact uncertain request. */
		var PublicationEditor = class {
			send;
			persist;
			delay;
			state;
			listeners = /* @__PURE__ */ new Set();
			timer;
			flight;
			holds = 0;
			retired = false;
			constructor(initial, send, persist, delay = 700) {
				this.send = send;
				this.persist = persist;
				this.delay = delay;
				this.state = copy(initial);
				if (this.state.phase === "saving") this.state.phase = "pending";
			}
			getSnapshot = () => this.state;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			};
			get dirty() {
				return serialize(this.state.input) !== this.state.baseline || Boolean(this.state.pending);
			}
			emit(next) {
				this.state = {
					...this.state,
					...next
				};
				try {
					this.persist(this.state);
				} catch {
					this.state = {
						...this.state,
						phase: "error",
						error: "本地草稿无法保存，请保留输入后重试。"
					};
					for (const l of this.listeners) l();
					throw new Error(this.state.error);
				}
				for (const l of this.listeners) l();
			}
			update(input) {
				if (this.retired) return;
				if (input.platform !== this.state.input.platform || input.type !== this.state.input.type) throw new Error("请为其他平台或形式另建材料。");
				try {
					this.emit({
						input: copy(input),
						phase: this.state.phase === "conflict" ? "conflict" : this.state.phase === "saving" ? "saving" : "pending",
						error: this.state.phase === "conflict" ? this.state.error : void 0
					});
					this.schedule();
				} catch {}
			}
			resume() {
				if (this.dirty && !["error", "conflict"].includes(this.state.phase)) this.schedule();
			}
			schedule() {
				clearTimeout(this.timer);
				if (this.retired || this.holds || this.state.phase === "conflict") return;
				this.timer = setTimeout(() => {
					this.flush().catch(() => void 0);
				}, this.delay);
			}
			async pump() {
				while (this.dirty) {
					if (this.state.phase === "conflict") throw new Error(this.state.error);
					const operation = this.state.pending ?? {
						action: "save-publication",
						id: "",
						folderPath: "",
						saveId: crypto.randomUUID(),
						...this.state.publicationId ? {
							publicationId: this.state.publicationId,
							expectedRevision: this.state.revision
						} : {},
						input: copy(this.state.input)
					};
					this.emit({
						pending: operation,
						phase: "saving",
						error: void 0
					});
					try {
						const receipt = await this.send(copy(operation));
						const unchanged = serialize(this.state.input) === serialize(operation.input), acknowledged = unchanged && receipt.input ? copy(receipt.input) : operation.input;
						this.emit({
							publicationId: receipt.id,
							revision: receipt.revision,
							...unchanged ? { input: acknowledged } : {},
							baseline: serialize(acknowledged),
							pending: void 0,
							phase: unchanged ? "saved" : "pending",
							error: void 0
						});
					} catch (e) {
						const error = e instanceof Error ? e.message : "保存未完成，请重试。";
						this.emit({
							phase: /发布内容已被修改|读取后合并/.test(error) ? "conflict" : "error",
							error
						});
						throw e;
					}
				}
				if (this.state.phase !== "saved") this.emit({
					phase: "saved",
					error: void 0
				});
			}
			async flush() {
				if (this.retired) throw new Error("发布内容已移除。");
				clearTimeout(this.timer);
				if (!this.flight) {
					this.flight = this.pump();
					this.flight.finally(() => {
						this.flight = void 0;
					}).catch(() => void 0);
				}
				await this.flight;
				if (this.dirty) return this.flush();
				if (!this.state.publicationId || !this.state.revision) throw new Error("发布材料尚未保存。");
				return {
					id: this.state.publicationId,
					revision: this.state.revision,
					input: copy(this.state.input)
				};
			}
			async withSaved(work) {
				this.holds++;
				try {
					return await work(await this.flush());
				} finally {
					this.holds--;
					if (this.dirty) this.schedule();
				}
			}
			/** Read-side refresh cannot replace local typing or an uncertain operation. */
			acceptRemote(p) {
				if (p.id !== this.state.publicationId || !p.body && p.body !== "" || this.dirty || p.revision <= (this.state.revision ?? 0)) return;
				const input = publicationInput(p);
				this.emit({
					input,
					revision: p.revision,
					baseline: serialize(input),
					phase: "saved"
				});
			}
			dispose() {
				this.retired = true;
				clearTimeout(this.timer);
			}
		};
		var PublicationEditors = class {
			send;
			storage;
			delay;
			rows = /* @__PURE__ */ new Map();
			version = 0;
			listeners = /* @__PURE__ */ new Set();
			getSnapshot = () => this.version;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			};
			storageKey;
			constructor(folder, send, storage, delay = 700) {
				this.send = send;
				this.storage = storage;
				this.delay = delay;
				this.storageKey = `dsh-creator-workbench:publication-editors:v1:${folder.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase()}`;
				let saved = [];
				try {
					saved = JSON.parse(storage?.getItem(this.storageKey) ?? "[]");
				} catch {}
				for (const row of saved) if (row?.key && row.input && typeof row.input.body === "string") this.make(row);
			}
			persist = () => {
				this.version++;
				for (const l of this.listeners) l();
				this.storage?.setItem(this.storageKey, JSON.stringify([...this.rows.values()].map((e) => e.getSnapshot())));
			};
			make(row) {
				const editor = new PublicationEditor(row, this.send, this.persist, this.delay);
				this.rows.set(row.key, editor);
				return editor;
			}
			list() {
				return [...this.rows.values()];
			}
			forId(id) {
				return this.list().find((e) => e.getSnapshot().publicationId === id);
			}
			create(input) {
				const editor = this.make({
					key: crypto.randomUUID(),
					input: copy(input),
					baseline: "",
					phase: "pending"
				});
				try {
					this.persist();
				} catch {}
				editor.resume();
				return editor;
			}
			open(p) {
				let editor = this.forId(p.id);
				if (editor) editor.acceptRemote(p);
				else {
					const input = publicationInput(p);
					editor = this.make({
						key: p.id,
						publicationId: p.id,
						revision: p.revision,
						input,
						baseline: serialize(input),
						phase: "saved"
					});
				}
				this.persist();
				editor.resume();
				return editor;
			}
			resume() {
				for (const e of this.rows.values()) e.resume();
			}
			remove(key) {
				this.rows.get(key)?.dispose();
				this.rows.delete(key);
				this.persist();
			}
		};
		//#endregion
		//#region src/client/ImageThumb.tsx
		const imageCaches = /* @__PURE__ */ new WeakMap();
		function invalidateImageThumb(api, folder, image) {
			imageCaches.get(api)?.delete(`${folder}:${image.id}:${image.sha256}`);
		}
		function loadImageThumb(api, detail, image) {
			if (!api.image) return Promise.reject(/* @__PURE__ */ new Error("图片读取能力暂不可用"));
			let cache = imageCaches.get(api);
			if (!cache) {
				cache = /* @__PURE__ */ new Map();
				imageCaches.set(api, cache);
			}
			const target = cache, key = `${detail.folderPath}:${image.id}:${image.sha256}`;
			let request = target.get(key);
			if (!request) {
				request = api.image({
					id: detail.id,
					folderPath: detail.folderPath,
					imageId: image.id
				}).then((r) => `data:${r.mime};base64,${r.base64}`, (error) => {
					target.delete(key);
					throw error;
				});
				target.set(key, request);
				if (target.size > 12) target.delete(target.keys().next().value);
			}
			return request;
		}
		function ImageThumb({ image, detail, api, large = false }) {
			const node = (0, react.useRef)(null), [visible, setVisible] = (0, react.useState)(typeof IntersectionObserver === "undefined");
			(0, react.useEffect)(() => {
				if (visible || !node.current) return;
				const observer = new IntersectionObserver((entries) => {
					if (entries.some((e) => e.isIntersecting)) {
						setVisible(true);
						observer.disconnect();
					}
				}, { rootMargin: "160px" });
				observer.observe(node.current);
				return () => observer.disconnect();
			}, [visible]);
			const key = `${detail.folderPath}:${image.id}:${image.sha256}`, [src, setSrc] = (0, react.useState)(), [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				setSrc(void 0);
				setError("");
				if (!api.image || !visible) return;
				let current = true;
				loadImageThumb(api, detail, image).then((url) => {
					if (current) setSrc(url);
				}, (e) => {
					if (current) setError(e.message);
				});
				return () => {
					current = false;
				};
			}, [
				key,
				api,
				visible
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "creationThumb",
				ref: node,
				children: src ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: large ? "creationImageLarge" : "creationImageThumb",
					src,
					loading: "lazy",
					alt: image.purpose === "cover" ? "封面" : image.purpose === "card" ? "图文图片" : "正文配图"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "creatorMuted",
					children: error || "读取图片…"
				})
			});
		}
		//#endregion
		//#region src/client/OverviewMedia.tsx
		function OverviewVideo({ detail, getVideoPlayback }) {
			const player = (0, react.useRef)(null), [url, setUrl] = (0, react.useState)(), [error, setError] = (0, react.useState)("");
			const video = detail.videos?.find((v) => v.name === detail.selectedVideo);
			(0, react.useEffect)(() => {
				let live = true;
				player.current?.pause();
				setUrl(void 0);
				setError("");
				if (detail.videoSelection !== "selected") return;
				getVideoPlayback(detail.id).then((value) => {
					if (live) {
						if (value.found) setUrl(value.url);
						else setError("当前视频无法读取，请在视频页重新选择。");
					}
				}, (e) => {
					if (live) setError(e instanceof Error ? e.message : "视频读取失败");
				});
				return () => {
					live = false;
					player.current?.pause();
				};
			}, [
				detail.folderPath,
				detail.selectedVideo,
				detail.videoSelection,
				video?.modifiedAt,
				video?.size,
				getVideoPlayback
			]);
			(0, react.useEffect)(() => {
				const element = player.current;
				return () => element?.pause();
			}, [url]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [url ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
				ref: player,
				className: "overviewVideo",
				"aria-label": "概览视频预览",
				src: url,
				controls: true,
				preload: "metadata",
				onError: () => setError("浏览器无法播放此编码，请在视频页核对文件。")
			}) : !error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "creatorMuted",
				role: "status",
				children: "正在读取视频…"
			}), error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "creatorError",
				role: "alert",
				children: error
			})] });
		}
		const coverCaches = /* @__PURE__ */ new WeakMap();
		function invalidateOverviewCover(folder, version, getCoverImage) {
			coverCaches.get(getCoverImage)?.delete(`${folder}:${version.id}:${version.file}`);
		}
		function loadOverviewCover(detail, version, getCoverImage) {
			let cache = coverCaches.get(getCoverImage);
			if (!cache) {
				cache = /* @__PURE__ */ new Map();
				coverCaches.set(getCoverImage, cache);
			}
			const key = `${detail.folderPath}:${version.id}:${version.file}`, target = cache;
			let request = target.get(key);
			if (!request) {
				request = getCoverImage({
					id: detail.id,
					folderPath: detail.folderPath,
					versionId: version.id
				}).then((r) => `data:${r.mime};base64,${r.base64}`, (error) => {
					target.delete(key);
					throw error;
				});
				target.set(key, request);
				if (target.size > 12) target.delete(target.keys().next().value);
			}
			return request;
		}
		function OverviewCover({ version, detail, getCoverImage }) {
			const node = (0, react.useRef)(null), [visible, setVisible] = (0, react.useState)(typeof IntersectionObserver === "undefined"), [src, setSrc] = (0, react.useState)(), [error, setError] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (visible || !node.current) return;
				const observer = new IntersectionObserver((entries) => {
					if (entries.some((e) => e.isIntersecting)) {
						setVisible(true);
						observer.disconnect();
					}
				}, { rootMargin: "160px" });
				observer.observe(node.current);
				return () => observer.disconnect();
			}, [visible]);
			(0, react.useEffect)(() => {
				let live = true;
				setSrc(void 0);
				setError("");
				if (!visible) return;
				loadOverviewCover(detail, version, getCoverImage).then((value) => {
					if (live) setSrc(value);
				}, (e) => {
					if (live) setError(e instanceof Error ? e.message : "封面读取失败");
				});
				return () => {
					live = false;
				};
			}, [
				visible,
				detail.folderPath,
				version.id,
				version.file,
				getCoverImage
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref: node,
				className: "overviewCover",
				children: src ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src,
					alt: `${version.ratio.replace("x", ":")} 视频封面`,
					loading: "lazy"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "creatorMuted",
					children: error || "读取封面…"
				})
			});
		}
		//#endregion
		//#region src/client/imageDescriptors.ts
		function creationPreviewImages(images, detail, api, title = "项目图片") {
			return images.filter((image) => !image.hidden).map((image) => ({
				id: image.id,
				title: `${title}：${image.file.replaceAll("\\", "/").split("/").at(-1)}`,
				revision: `${detail.folderPath}:${image.sha256}`,
				load: (signal) => {
					signal.throwIfAborted();
					return loadImageThumb(api, detail, image);
				},
				reload: () => invalidateImageThumb(api, detail.folderPath, image)
			}));
		}
		function coverPreviewImages(versions, detail, getCoverImage) {
			return versions.filter((version) => !version.hidden).map((version) => ({
				id: version.id,
				title: `${version.ratio.replace("x", ":")} 视频封面`,
				revision: `${detail.folderPath}:${version.file}`,
				load: (signal) => {
					signal.throwIfAborted();
					return loadOverviewCover(detail, version, getCoverImage);
				},
				reload: () => invalidateOverviewCover(detail.folderPath, version, getCoverImage)
			}));
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
		const PROJECT_TABS = [
			"overview",
			"video",
			"script",
			"subtitle",
			"article",
			"images",
			"publishing"
		];
		function publicationLabel(state, id, accounts) {
			const draft = state.publications?.find((p) => p.id === id);
			const records = state.records?.filter((r) => r.publicationId === id && r.platform === draft?.platform && r.type === draft?.type && (!accounts || r.accountId === accounts[r.platform])) ?? [];
			if (!records.length && state.records?.some((r) => r.publicationId === id)) return "历史作品";
			if (records.some((r) => r.state === "published")) return records.some((r) => r.state === "published" && r.revision === draft?.revision) ? "已发表" : "已发表 · 本地有修改";
			if (records.some((r) => r.state === "draft")) return "平台草稿已保存";
			if (records.some((r) => r.state === "uploaded")) return "已上传待发表";
			return "本地材料";
		}
		function publicationMetric(state, draft, accountId) {
			if (!accountId) return;
			const records = state.records?.filter((r) => r.publicationId === draft.id && r.platform === draft.platform && r.type === draft.type && r.accountId === accountId && r.state === "published") ?? [];
			return [...state.metrics].reverse().find((m) => m.publicationId === draft.id && m.platform === draft.platform && m.accountId === accountId && m.state === "ok" && records.some((r) => r.remoteId === m.remoteId));
		}
		const isActiveTask = (task) => [
			"queued",
			"running",
			"waiting-agent"
		].includes(task.status);
		//#endregion
		//#region src/client/projectQuery.ts
		async function bounded(request) {
			let timer;
			try {
				return await Promise.race([request, new Promise((_, reject) => {
					timer = setTimeout(() => reject(/* @__PURE__ */ new Error("状态暂不可用，请重新查询原任务。")), 15e3);
				})]);
			} finally {
				clearTimeout(timer);
			}
		}
		const settingsCache = /* @__PURE__ */ new WeakMap();
		/** One request/clock per mounted project; drafts are deliberately outside this cache. */
		var ProjectQuery = class {
			api;
			scope;
			snapshot = {};
			listeners = /* @__PURE__ */ new Set();
			request;
			readTicket = 0;
			epoch = 0;
			timer;
			recovery;
			reconciled = false;
			constructor(api, scope) {
				this.api = api;
				this.scope = scope;
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				if (this.listeners.size === 1) this.open();
				return () => {
					this.listeners.delete(listener);
					if (!this.listeners.size) {
						clearTimeout(this.timer);
						this.timer = void 0;
					}
				};
			};
			getSnapshot = () => this.snapshot;
			emit() {
				for (const listener of this.listeners) listener();
			}
			seed(view) {
				if (!this.snapshot.view) {
					this.snapshot = {
						...this.snapshot,
						view,
						state: view.production
					};
					this.emit();
				}
			}
			async open() {
				try {
					if (!this.reconciled) {
						this.recovery ??= bounded(Promise.resolve(this.api.reconcile?.(this.scope)));
						await this.recovery;
						this.reconciled = true;
					}
					await this.refresh();
				} catch (error) {
					this.recovery = void 0;
					this.fail(error);
				}
			}
			fail(error) {
				this.snapshot = {
					...this.snapshot,
					error: error instanceof Error ? error.message : "读取失败，请重试。"
				};
				this.emit();
			}
			schedule() {
				clearTimeout(this.timer);
				const running = this.snapshot.state?.tasks.some(isActiveTask) || this.snapshot.view?.covers.runs.some((r) => ["running", "preparing"].includes(r.status));
				if (this.listeners.size && running) this.timer = setTimeout(() => {
					this.refresh().catch(() => void 0);
				}, 2e3);
			}
			refresh = () => {
				if (this.request) return this.request;
				const epoch = this.epoch, ticket = ++this.readTicket;
				const work = async () => {
					try {
						const view = this.api.projectView ? await bounded(this.api.projectView(this.scope)) : void 0, state = view?.production ?? await bounded(this.api.state(this.scope));
						if (epoch === this.epoch) {
							if (view?.settingsRevision && this.snapshot.view?.settingsRevision && view.settingsRevision !== this.snapshot.view.settingsRevision) {
								settingsCache.delete(this.api);
								if (this.snapshot.settings) this.settings().catch(() => void 0);
							}
							this.snapshot = {
								...this.snapshot,
								...view ? { view } : {},
								state,
								error: void 0
							};
							this.emit();
						}
						return state;
					} catch (error) {
						if (epoch === this.epoch) this.fail(error);
						throw error;
					} finally {
						if (ticket === this.readTicket) {
							this.request = void 0;
							this.schedule();
						}
					}
				};
				this.request = work();
				return this.request;
			};
			accept = (full) => {
				const state = productionView(full);
				this.epoch++;
				this.snapshot = {
					...this.snapshot,
					state,
					...this.snapshot.view ? { view: {
						...this.snapshot.view,
						production: state
					} } : {},
					error: void 0
				};
				this.emit();
				this.schedule();
			};
			invalidate = () => {
				this.epoch++;
				this.request = void 0;
				return this.refresh();
			};
			retry = async () => {
				try {
					if (this.api.reconcile) await bounded(this.api.reconcile(this.scope));
					this.reconciled = true;
					this.recovery = void 0;
					return await this.invalidate();
				} catch (error) {
					this.recovery = void 0;
					this.fail(error);
					throw error;
				}
			};
			settings = async () => {
				let request = settingsCache.get(this.api);
				if (!request) {
					request = this.api.settings();
					settingsCache.set(this.api, request);
					request.catch(() => settingsCache.delete(this.api));
				}
				const settings = await request;
				this.snapshot = {
					...this.snapshot,
					settings
				};
				this.emit();
				return settings;
			};
		};
		const queries = /* @__PURE__ */ new WeakMap();
		function projectQuery(api, scope) {
			let bucket = queries.get(api);
			if (!bucket) {
				bucket = /* @__PURE__ */ new Map();
				queries.set(api, bucket);
			}
			const key = scope.folderPath.replace(/\\/g, "/").replace(/\/$/, "");
			let query = bucket.get(key);
			if (!query) {
				query = new ProjectQuery(api, scope);
				bucket.set(key, query);
			}
			return query;
		}
		function invalidateProjectSettings(api) {
			settingsCache.delete(api);
		}
		//#endregion
		//#region src/client/ProjectData.tsx
		const ProjectContext = (0, react.createContext)(void 0);
		function ProjectDataProvider({ api, scope, children }) {
			const query = (0, react.useMemo)(() => projectQuery(api, scope), [api, scope.folderPath]);
			const epoch = useLibraryEpoch(), previousEpoch = (0, react.useRef)(epoch);
			(0, react.useSyncExternalStore)(query.subscribe, query.getSnapshot);
			(0, react.useEffect)(() => {
				if (previousEpoch.current !== epoch) {
					previousEpoch.current = epoch;
					query.invalidate().catch(() => void 0);
				}
			}, [query, epoch]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectContext.Provider, {
				value: query,
				children
			});
		}
		function useProjectData(api, scope) {
			const inherited = (0, react.useContext)(ProjectContext);
			const query = (0, react.useMemo)(() => inherited ?? projectQuery(api, scope), [
				inherited,
				api,
				scope.folderPath
			]);
			return {
				...(0, react.useSyncExternalStore)(query.subscribe, query.getSnapshot),
				query
			};
		}
		//#endregion
		//#region src/client/productionApi.ts
		function localFilePath(file) {
			const value = globalThis.__DSH_HOST_PATHS__?.pathFor(file);
			if (!value) throw new Error("请在 DSH Desktop 中选择本机文件。");
			return value;
		}
		async function wechatCredentialRef(appid) {
			const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(appid));
			return `CREATOR_WECHAT_SECRET_${Array.from(new Uint8Array(value)).map((n) => n.toString(16).padStart(2, "0")).join("").slice(0, 16).toUpperCase()}`;
		}
		//#endregion
		//#region node_modules/.pnpm/dompurify@3.4.17/node_modules/dompurify/dist/purify.es.mjs
		/*! @license DOMPurify 3.4.17 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.17/LICENSE */
		function _OverloadYield(e, d) {
			this.v = e, this.k = d;
		}
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = !0, o = !1;
				try {
					if (i = (t = t.call(r)).next, 0 === l) {
						if (Object(t) !== t) return;
						f = !1;
					} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = !0, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		function AsyncGenerator(e) {
			var t, n;
			function resume(t, n) {
				try {
					var r = e[t](n), o = r.value, u = o instanceof _OverloadYield;
					Promise.resolve(u ? o.v : o).then(function(n) {
						if (u) {
							var i = "return" === t && o.k ? t : "next";
							if (!o.k || n.done) return resume(i, n);
							n = e[i](n).value;
						}
						settle(!!r.done, n);
					}, function(e) {
						resume("throw", e);
					});
				} catch (e) {
					settle(2, e);
				}
			}
			function settle(e, r) {
				2 === e ? t.reject(r) : t.resolve({
					value: r,
					done: e
				}), (t = t.next) ? resume(t.key, t.arg) : n = null;
			}
			this._invoke = function(e, r) {
				return new Promise(function(o, u) {
					var i = {
						key: e,
						arg: r,
						resolve: o,
						reject: u,
						next: null
					};
					n ? n = n.next = i : (t = n = i, resume(e, r));
				});
			}, "function" != typeof e.return && (this.return = void 0);
		}
		AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function() {
			return this;
		}, AsyncGenerator.prototype.next = function(e) {
			return this._invoke("next", e);
		}, AsyncGenerator.prototype.throw = function(e) {
			return this._invoke("throw", e);
		}, AsyncGenerator.prototype.return = function(e) {
			return this._invoke("return", e);
		};
		const entries = Object.entries;
		const setPrototypeOf = Object.setPrototypeOf;
		const isFrozen = Object.isFrozen;
		const getPrototypeOf = Object.getPrototypeOf;
		const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
		let freeze = Object.freeze;
		let seal = Object.seal;
		let create = Object.create;
		let _ref = typeof Reflect !== "undefined" && Reflect;
		let apply$1 = _ref.apply;
		let construct = _ref.construct;
		if (!freeze) freeze = function freeze(x) {
			return x;
		};
		if (!seal) seal = function seal(x) {
			return x;
		};
		if (!apply$1) apply$1 = function apply(func, thisArg) {
			for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
			return func.apply(thisArg, args);
		};
		if (!construct) construct = function construct(Func) {
			for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
			return new Func(...args);
		};
		const arrayForEach = unapply(Array.prototype.forEach);
		Array.prototype.indexOf;
		const arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
		const arrayPop = unapply(Array.prototype.pop);
		const arrayPush = unapply(Array.prototype.push);
		const arraySlice = unapply(Array.prototype.slice);
		const arraySplice = unapply(Array.prototype.splice);
		const arrayIsArray = Array.isArray;
		const setCreate = unconstruct(Set);
		const setAdd = unapply(Set.prototype.add);
		const setHas = unapply(Set.prototype.has);
		const stringToLowerCase = unapply(String.prototype.toLowerCase);
		const stringToString = unapply(String.prototype.toString);
		const stringMatch = unapply(String.prototype.match);
		const stringReplace = unapply(String.prototype.replace);
		const stringIndexOf = unapply(String.prototype.indexOf);
		const stringTrim = unapply(String.prototype.trim);
		const numberToString = unapply(Number.prototype.toString);
		const booleanToString = unapply(Boolean.prototype.toString);
		const bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
		const symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
		const objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
		const objectToString = unapply(Object.prototype.toString);
		const regExpTest = unapply(RegExp.prototype.test);
		const typeErrorCreate = unconstruct(TypeError);
		/**
		* Creates a new function that calls the given function with a specified thisArg and arguments.
		*
		* @param func - The function to be wrapped and called.
		* @returns A new function that calls the given function with a specified thisArg and arguments.
		*/
		function unapply(func) {
			return function(thisArg) {
				if (thisArg instanceof RegExp) thisArg.lastIndex = 0;
				for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) args[_key3 - 1] = arguments[_key3];
				return apply$1(func, thisArg, args);
			};
		}
		/**
		* Creates a new function that constructs an instance of the given constructor function with the provided arguments.
		*
		* @param func - The constructor function to be wrapped and called.
		* @returns A new function that constructs an instance of the given constructor function with the provided arguments.
		*/
		function unconstruct(Func) {
			return function() {
				for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) args[_key4] = arguments[_key4];
				return construct(Func, args);
			};
		}
		/**
		* Add properties to a lookup table
		*
		* @param set - The set to which elements will be added.
		* @param array - The array containing elements to be added to the set.
		* @param transformCaseFunc - An optional function to transform the case of each element before adding to the set.
		* @returns The modified set with added elements.
		*/
		function addToSet(set, array) {
			let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
			if (setPrototypeOf) setPrototypeOf(set, null);
			if (!arrayIsArray(array)) return set;
			let l = array.length;
			while (l--) {
				let element = array[l];
				if (typeof element === "string") {
					const lcElement = transformCaseFunc(element);
					if (lcElement !== element) {
						if (!isFrozen(array)) array[l] = lcElement;
						element = lcElement;
					}
				}
				set[element] = true;
			}
			return set;
		}
		/**
		* Clean up an array to harden against CSPP
		*
		* @param array - The array to be cleaned.
		* @returns The cleaned version of the array
		*/
		function cleanArray(array) {
			for (let index = 0; index < array.length; index++) if (!objectHasOwnProperty(array, index)) array[index] = null;
			return array;
		}
		/**
		* Shallow clone an object
		*
		* @param object - The object to be cloned.
		* @returns A new object that copies the original.
		*/
		function clone(object) {
			const newObject = create(null);
			for (const _ref2 of entries(object)) {
				var _ref3 = _slicedToArray(_ref2, 2);
				const property = _ref3[0];
				const value = _ref3[1];
				if (objectHasOwnProperty(object, property)) {
					if (arrayIsArray(value)) newObject[property] = cleanArray(value);
					else if (value && typeof value === "object" && value.constructor === Object) newObject[property] = clone(value);
					else newObject[property] = value;
				}
			}
			return newObject;
		}
		/**
		* Convert non-node values into strings without depending on direct property access.
		*
		* @param value - The value to stringify.
		* @returns A string representation of the provided value.
		*/
		function stringifyValue(value) {
			switch (typeof value) {
				case "string": return value;
				case "number": return numberToString(value);
				case "boolean": return booleanToString(value);
				case "bigint": return bigintToString ? bigintToString(value) : "0";
				case "symbol": return symbolToString ? symbolToString(value) : "Symbol()";
				case "undefined": return objectToString(value);
				case "function":
				case "object": {
					if (value === null) return objectToString(value);
					const valueAsRecord = value;
					const valueToString = lookupGetter(valueAsRecord, "toString");
					if (typeof valueToString === "function") {
						const stringified = valueToString(valueAsRecord);
						return typeof stringified === "string" ? stringified : objectToString(stringified);
					}
					return objectToString(value);
				}
				default: return objectToString(value);
			}
		}
		/**
		* This method automatically checks if the prop is function or getter and behaves accordingly.
		*
		* @param object - The object to look up the getter function in its prototype chain.
		* @param prop - The property name for which to find the getter function.
		* @returns The getter function found in the prototype chain or a fallback function.
		*/
		function lookupGetter(object, prop) {
			while (object !== null) {
				const desc = getOwnPropertyDescriptor(object, prop);
				if (desc) {
					if (desc.get) return unapply(desc.get);
					if (typeof desc.value === "function") return unapply(desc.value);
				}
				object = getPrototypeOf(object);
			}
			function fallbackValue() {
				return null;
			}
			return fallbackValue;
		}
		/**
		* Like lookupGetter, but for accessor properties only, and returns null
		* instead of a null-returning fallback when no getter exists on the chain.
		* Lets a caller fall back to a direct property read in environments that
		* lack the getter, where a fallback returning null would be indistinguishable
		* from a legitimate null value (e.g. namespaceURI of a no-namespace element).
		*
		* @param object - The object (usually a prototype) to start the lookup at.
		* @param prop - The accessor property name.
		* @returns The unapplied getter, or null if none was found.
		*/
		function lookupAccessor(object, prop) {
			while (object !== null) {
				const desc = getOwnPropertyDescriptor(object, prop);
				if (desc) return desc.get ? unapply(desc.get) : null;
				object = getPrototypeOf(object);
			}
			return null;
		}
		function isRegex(value) {
			try {
				regExpTest(value, "");
				return true;
			} catch (_unused) {
				return false;
			}
		}
		const html$1 = freeze([
			"a",
			"abbr",
			"acronym",
			"address",
			"area",
			"article",
			"aside",
			"audio",
			"b",
			"bdi",
			"bdo",
			"big",
			"blink",
			"blockquote",
			"body",
			"br",
			"button",
			"canvas",
			"caption",
			"center",
			"cite",
			"code",
			"col",
			"colgroup",
			"content",
			"data",
			"datalist",
			"dd",
			"decorator",
			"del",
			"details",
			"dfn",
			"dialog",
			"dir",
			"div",
			"dl",
			"dt",
			"element",
			"em",
			"fieldset",
			"figcaption",
			"figure",
			"font",
			"footer",
			"form",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"head",
			"header",
			"hgroup",
			"hr",
			"html",
			"i",
			"img",
			"input",
			"ins",
			"kbd",
			"label",
			"legend",
			"li",
			"main",
			"map",
			"mark",
			"marquee",
			"menu",
			"menuitem",
			"meter",
			"nav",
			"nobr",
			"ol",
			"optgroup",
			"option",
			"output",
			"p",
			"picture",
			"pre",
			"progress",
			"q",
			"rp",
			"rt",
			"ruby",
			"s",
			"samp",
			"search",
			"section",
			"select",
			"shadow",
			"slot",
			"small",
			"source",
			"spacer",
			"span",
			"strike",
			"strong",
			"style",
			"sub",
			"summary",
			"sup",
			"table",
			"tbody",
			"td",
			"template",
			"textarea",
			"tfoot",
			"th",
			"thead",
			"time",
			"tr",
			"track",
			"tt",
			"u",
			"ul",
			"var",
			"video",
			"wbr"
		]);
		const svg$1 = freeze([
			"svg",
			"a",
			"altglyph",
			"altglyphdef",
			"altglyphitem",
			"animatecolor",
			"animatemotion",
			"animatetransform",
			"circle",
			"clippath",
			"defs",
			"desc",
			"ellipse",
			"enterkeyhint",
			"exportparts",
			"filter",
			"font",
			"g",
			"glyph",
			"glyphref",
			"hkern",
			"image",
			"inputmode",
			"line",
			"lineargradient",
			"marker",
			"mask",
			"metadata",
			"mpath",
			"part",
			"path",
			"pattern",
			"polygon",
			"polyline",
			"radialgradient",
			"rect",
			"stop",
			"style",
			"switch",
			"symbol",
			"text",
			"textpath",
			"title",
			"tref",
			"tspan",
			"view",
			"vkern"
		]);
		const svgFilters = freeze([
			"feBlend",
			"feColorMatrix",
			"feComponentTransfer",
			"feComposite",
			"feConvolveMatrix",
			"feDiffuseLighting",
			"feDisplacementMap",
			"feDistantLight",
			"feDropShadow",
			"feFlood",
			"feFuncA",
			"feFuncB",
			"feFuncG",
			"feFuncR",
			"feGaussianBlur",
			"feImage",
			"feMerge",
			"feMergeNode",
			"feMorphology",
			"feOffset",
			"fePointLight",
			"feSpecularLighting",
			"feSpotLight",
			"feTile",
			"feTurbulence"
		]);
		const svgDisallowed = freeze([
			"animate",
			"color-profile",
			"cursor",
			"discard",
			"font-face",
			"font-face-format",
			"font-face-name",
			"font-face-src",
			"font-face-uri",
			"foreignobject",
			"hatch",
			"hatchpath",
			"mesh",
			"meshgradient",
			"meshpatch",
			"meshrow",
			"missing-glyph",
			"script",
			"set",
			"solidcolor",
			"unknown",
			"use"
		]);
		const mathMl$1 = freeze([
			"math",
			"menclose",
			"merror",
			"mfenced",
			"mfrac",
			"mglyph",
			"mi",
			"mlabeledtr",
			"mmultiscripts",
			"mn",
			"mo",
			"mover",
			"mpadded",
			"mphantom",
			"mroot",
			"mrow",
			"ms",
			"mspace",
			"msqrt",
			"mstyle",
			"msub",
			"msup",
			"msubsup",
			"mtable",
			"mtd",
			"mtext",
			"mtr",
			"munder",
			"munderover",
			"mprescripts"
		]);
		const mathMlDisallowed = freeze([
			"maction",
			"maligngroup",
			"malignmark",
			"mlongdiv",
			"mscarries",
			"mscarry",
			"msgroup",
			"mstack",
			"msline",
			"msrow",
			"semantics",
			"annotation",
			"annotation-xml",
			"mprescripts",
			"none"
		]);
		const text = freeze(["#text"]);
		const html = freeze([
			"accept",
			"action",
			"align",
			"alt",
			"autocapitalize",
			"autocomplete",
			"autopictureinpicture",
			"autoplay",
			"background",
			"bgcolor",
			"border",
			"capture",
			"cellpadding",
			"cellspacing",
			"checked",
			"cite",
			"class",
			"clear",
			"color",
			"cols",
			"colspan",
			"command",
			"commandfor",
			"controls",
			"controlslist",
			"coords",
			"crossorigin",
			"datetime",
			"decoding",
			"default",
			"dir",
			"disabled",
			"disablepictureinpicture",
			"disableremoteplayback",
			"download",
			"draggable",
			"enctype",
			"enterkeyhint",
			"exportparts",
			"face",
			"for",
			"headers",
			"height",
			"hidden",
			"high",
			"href",
			"hreflang",
			"id",
			"inert",
			"inputmode",
			"integrity",
			"ismap",
			"kind",
			"label",
			"lang",
			"list",
			"loading",
			"loop",
			"low",
			"max",
			"maxlength",
			"media",
			"method",
			"min",
			"minlength",
			"multiple",
			"muted",
			"name",
			"nonce",
			"noshade",
			"novalidate",
			"nowrap",
			"open",
			"optimum",
			"part",
			"pattern",
			"placeholder",
			"playsinline",
			"popover",
			"popovertarget",
			"popovertargetaction",
			"poster",
			"preload",
			"pubdate",
			"radiogroup",
			"readonly",
			"rel",
			"required",
			"rev",
			"reversed",
			"role",
			"rows",
			"rowspan",
			"spellcheck",
			"scope",
			"selected",
			"shape",
			"size",
			"sizes",
			"slot",
			"span",
			"srclang",
			"start",
			"src",
			"srcset",
			"step",
			"style",
			"summary",
			"tabindex",
			"title",
			"translate",
			"type",
			"usemap",
			"valign",
			"value",
			"width",
			"wrap",
			"xmlns"
		]);
		const svg = freeze([
			"accent-height",
			"accumulate",
			"additive",
			"alignment-baseline",
			"amplitude",
			"ascent",
			"attributename",
			"attributetype",
			"azimuth",
			"basefrequency",
			"baseline-shift",
			"begin",
			"bias",
			"by",
			"class",
			"clip",
			"clippathunits",
			"clip-path",
			"clip-rule",
			"color",
			"color-interpolation",
			"color-interpolation-filters",
			"color-profile",
			"color-rendering",
			"cx",
			"cy",
			"d",
			"dx",
			"dy",
			"diffuseconstant",
			"direction",
			"display",
			"divisor",
			"dominant-baseline",
			"dur",
			"edgemode",
			"elevation",
			"end",
			"exponent",
			"fill",
			"fill-opacity",
			"fill-rule",
			"filter",
			"filterunits",
			"flood-color",
			"flood-opacity",
			"font-family",
			"font-size",
			"font-size-adjust",
			"font-stretch",
			"font-style",
			"font-variant",
			"font-weight",
			"fx",
			"fy",
			"g1",
			"g2",
			"glyph-name",
			"glyphref",
			"gradientunits",
			"gradienttransform",
			"height",
			"href",
			"id",
			"image-rendering",
			"in",
			"in2",
			"intercept",
			"k",
			"k1",
			"k2",
			"k3",
			"k4",
			"kerning",
			"keypoints",
			"keysplines",
			"keytimes",
			"lang",
			"lengthadjust",
			"letter-spacing",
			"kernelmatrix",
			"kernelunitlength",
			"lighting-color",
			"local",
			"marker-end",
			"marker-mid",
			"marker-start",
			"markerheight",
			"markerunits",
			"markerwidth",
			"maskcontentunits",
			"maskunits",
			"max",
			"mask",
			"mask-type",
			"media",
			"method",
			"mode",
			"min",
			"name",
			"numoctaves",
			"offset",
			"operator",
			"opacity",
			"order",
			"orient",
			"orientation",
			"origin",
			"overflow",
			"paint-order",
			"path",
			"pathlength",
			"patterncontentunits",
			"patterntransform",
			"patternunits",
			"pointer-events",
			"points",
			"preservealpha",
			"preserveaspectratio",
			"primitiveunits",
			"r",
			"rx",
			"ry",
			"radius",
			"refx",
			"refy",
			"repeatcount",
			"repeatdur",
			"restart",
			"result",
			"rotate",
			"scale",
			"seed",
			"shape-rendering",
			"slope",
			"specularconstant",
			"specularexponent",
			"spreadmethod",
			"startoffset",
			"stddeviation",
			"stitchtiles",
			"stop-color",
			"stop-opacity",
			"stroke-dasharray",
			"stroke-dashoffset",
			"stroke-linecap",
			"stroke-linejoin",
			"stroke-miterlimit",
			"stroke-opacity",
			"stroke",
			"stroke-width",
			"style",
			"surfacescale",
			"systemlanguage",
			"tabindex",
			"tablevalues",
			"targetx",
			"targety",
			"transform",
			"transform-origin",
			"text-anchor",
			"text-decoration",
			"text-orientation",
			"text-rendering",
			"textlength",
			"type",
			"u1",
			"u2",
			"unicode",
			"values",
			"vector-effect",
			"viewbox",
			"visibility",
			"version",
			"vert-adv-y",
			"vert-origin-x",
			"vert-origin-y",
			"width",
			"word-spacing",
			"wrap",
			"writing-mode",
			"xchannelselector",
			"ychannelselector",
			"x",
			"x1",
			"x2",
			"xmlns",
			"y",
			"y1",
			"y2",
			"z",
			"zoomandpan"
		]);
		const mathMl = freeze([
			"accent",
			"accentunder",
			"align",
			"bevelled",
			"close",
			"columnalign",
			"columnlines",
			"columnspacing",
			"columnspan",
			"denomalign",
			"depth",
			"dir",
			"display",
			"displaystyle",
			"encoding",
			"fence",
			"frame",
			"height",
			"href",
			"id",
			"largeop",
			"length",
			"linethickness",
			"lquote",
			"lspace",
			"mathbackground",
			"mathcolor",
			"mathsize",
			"mathvariant",
			"maxsize",
			"minsize",
			"movablelimits",
			"notation",
			"numalign",
			"open",
			"rowalign",
			"rowlines",
			"rowspacing",
			"rowspan",
			"rspace",
			"rquote",
			"scriptlevel",
			"scriptminsize",
			"scriptsizemultiplier",
			"selection",
			"separator",
			"separators",
			"stretchy",
			"subscriptshift",
			"supscriptshift",
			"symmetric",
			"voffset",
			"width",
			"xmlns"
		]);
		const xml = freeze([
			"xlink:href",
			"xml:id",
			"xlink:title",
			"xml:space",
			"xmlns:xlink"
		]);
		const MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
		const ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
		const TMPLIT_EXPR = seal(/\${[\w\W]*/g);
		const DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
		const ARIA_ATTR = seal(/^aria-[\-\w]+$/);
		const IS_ALLOWED_URI = seal(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i);
		const IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
		const ATTR_WHITESPACE = seal(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g);
		const DOCTYPE_NAME = seal(/^html$/i);
		const CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
		const ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
		const COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
		const FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
		const SELF_CLOSING_TAG = seal(/\/>/i);
		const NODE_TYPE = {
			element: 1,
			attribute: 2,
			text: 3,
			cdataSection: 4,
			entityReference: 5,
			entityNode: 6,
			processingInstruction: 7,
			comment: 8,
			document: 9,
			documentType: 10,
			documentFragment: 11,
			notation: 12
		};
		const LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, [
			"style",
			"script",
			"xmp",
			"iframe",
			"noembed",
			"noframes",
			"plaintext",
			"noscript"
		]));
		const getGlobal = function getGlobal() {
			return typeof window === "undefined" ? null : window;
		};
		/**
		* Creates a no-op policy for internal use only.
		* Don't export this function outside this module!
		* @param trustedTypes The policy factory.
		* @param purifyHostElement The Script element used to load DOMPurify (to determine policy name suffix).
		* @return The policy created (or null, if Trusted Types
		* are not supported or creating the policy failed).
		*/
		const _createTrustedTypesPolicy = function _createTrustedTypesPolicy(trustedTypes, purifyHostElement) {
			if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") return null;
			let suffix = null;
			const ATTR_NAME = "data-tt-policy-suffix";
			if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) suffix = purifyHostElement.getAttribute(ATTR_NAME);
			const policyName = "dompurify" + (suffix ? "#" + suffix : "");
			try {
				return trustedTypes.createPolicy(policyName, {
					createHTML(html) {
						return html;
					},
					createScriptURL(scriptUrl) {
						return scriptUrl;
					}
				});
			} catch (_) {
				console.warn("TrustedTypes policy " + policyName + " could not be created.");
				return null;
			}
		};
		const _createHooksMap = function _createHooksMap() {
			return {
				afterSanitizeAttributes: [],
				afterSanitizeElements: [],
				afterSanitizeShadowDOM: [],
				beforeSanitizeAttributes: [],
				beforeSanitizeElements: [],
				beforeSanitizeShadowDOM: [],
				uponSanitizeAttribute: [],
				uponSanitizeElement: [],
				uponSanitizeShadowNode: []
			};
		};
		/**
		* Resolve a set-valued configuration option: a fresh set built from
		* cfg[key] when it is an own array property (seeded with a clone of
		* options.base when given, case-normalized via options.transform),
		* the fallback set otherwise.
		*
		* @param cfg the cloned, prototype-free configuration object
		* @param key the configuration property to read
		* @param fallback the set to use when the option is absent or not an array
		* @param options transform and optional base set to merge into
		* @returns the resolved set
		*/
		const _resolveSetOption = function _resolveSetOption(cfg, key, fallback, options) {
			return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
		};
		/**
		* Resolve an object-valued configuration option: a prototype-free clone
		* of cfg[key] when it is an own, truthy object property, else a fresh
		* fallback built by makeFallback (fresh on every parse, so a previous
		* parse can never leak state into the next one).
		*
		* @param cfg the cloned, prototype-free configuration object
		* @param key the configuration property to read
		* @param makeFallback builds the fallback value when the option is absent
		* @returns the resolved object
		*/
		const _resolveObjectOption = function _resolveObjectOption(cfg, key, makeFallback) {
			const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
			return value && typeof value === "object" ? clone(value) : makeFallback();
		};
		function createDOMPurify() {
			let window = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
			const DOMPurify = (root) => createDOMPurify(root);
			DOMPurify.version = "3.4.17";
			DOMPurify.removed = [];
			if (!window || !window.document || window.document.nodeType !== NODE_TYPE.document || !window.Element) {
				DOMPurify.isSupported = false;
				return DOMPurify;
			}
			let document = window.document;
			const originalDocument = document;
			const currentScript = originalDocument.currentScript;
			window.DocumentFragment;
			const HTMLTemplateElement = window.HTMLTemplateElement, Node = window.Node, Element = window.Element, NodeFilter = window.NodeFilter;
			window.NamedNodeMap === void 0 && (window.NamedNodeMap || window.MozNamedAttrMap);
			window.HTMLFormElement;
			const DOMParser = window.DOMParser, trustedTypes = window.trustedTypes;
			const ElementPrototype = Element.prototype;
			const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
			const remove = lookupGetter(ElementPrototype, "remove");
			const removeAttributeNode = lookupGetter(ElementPrototype, "removeAttributeNode");
			const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
			const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
			const getParentNode = lookupGetter(ElementPrototype, "parentNode");
			const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
			const getAttributes = lookupGetter(ElementPrototype, "attributes");
			const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
			const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
			const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
			const _readNodeType = function _readNodeType(node) {
				return getNodeType ? getNodeType(node) : node.nodeType;
			};
			const _readNodeName = function _readNodeName(node) {
				return getNodeName ? getNodeName(node) : node.nodeName;
			};
			const getNamespaceURI = lookupAccessor(ElementPrototype, "namespaceURI");
			const _readNamespaceURI = function _readNamespaceURI(element) {
				return getNamespaceURI ? getNamespaceURI(element) : element.namespaceURI;
			};
			if (typeof HTMLTemplateElement === "function") {
				const template = document.createElement("template");
				if (template.content && template.content.ownerDocument) document = template.content.ownerDocument;
			}
			let trustedTypesPolicy;
			let emptyHTML = "";
			let defaultTrustedTypesPolicy;
			let defaultTrustedTypesPolicyResolved = false;
			let IN_TRUSTED_TYPES_POLICY = 0;
			const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy() {
				if (IN_TRUSTED_TYPES_POLICY > 0) throw typeErrorCreate("A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the \"DOMPurify and Trusted Types\" section of the README.");
			};
			const _createTrustedHTML = function _createTrustedHTML(html) {
				_assertNotInTrustedTypesPolicy();
				IN_TRUSTED_TYPES_POLICY++;
				try {
					return trustedTypesPolicy.createHTML(html);
				} finally {
					IN_TRUSTED_TYPES_POLICY--;
				}
			};
			const _createTrustedScriptURL = function _createTrustedScriptURL(scriptUrl) {
				_assertNotInTrustedTypesPolicy();
				IN_TRUSTED_TYPES_POLICY++;
				try {
					return trustedTypesPolicy.createScriptURL(scriptUrl);
				} finally {
					IN_TRUSTED_TYPES_POLICY--;
				}
			};
			const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy() {
				if (!defaultTrustedTypesPolicyResolved) {
					defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
					defaultTrustedTypesPolicyResolved = true;
				}
				return defaultTrustedTypesPolicy;
			};
			const _document = document, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
			const importNode = originalDocument.importNode;
			let hooks = _createHooksMap();
			/**
			* Expose whether this browser supports running the full DOMPurify.
			*/
			DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
			const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
			let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
			/**
			* We consider the elements and attributes below to be safe. Ideally
			* don't add any new ones but feel free to remove unwanted ones.
			*/
			let ALLOWED_TAGS = null;
			const DEFAULT_ALLOWED_TAGS = addToSet({}, [
				...html$1,
				...svg$1,
				...svgFilters,
				...mathMl$1,
				...text
			]);
			let ALLOWED_ATTR = null;
			const DEFAULT_ALLOWED_ATTR = addToSet({}, [
				...html,
				...svg,
				...mathMl,
				...xml
			]);
			let CUSTOM_ELEMENT_HANDLING = Object.seal(create(null, {
				tagNameCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				},
				attributeNameCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				},
				allowCustomizedBuiltInElements: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: false
				}
			}));
			let FORBID_TAGS = null;
			let FORBID_ATTR = null;
			const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
				tagCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				},
				attributeCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				}
			}));
			let ALLOW_ARIA_ATTR = true;
			let ALLOW_DATA_ATTR = true;
			let ALLOW_UNKNOWN_PROTOCOLS = false;
			let ALLOW_SELF_CLOSE_IN_ATTR = true;
			let SAFE_FOR_TEMPLATES = false;
			let SAFE_FOR_XML = true;
			let WHOLE_DOCUMENT = false;
			let SET_CONFIG = false;
			let SET_CONFIG_ALLOWED_TAGS = null;
			let SET_CONFIG_ALLOWED_ATTR = null;
			let FORCE_BODY = false;
			let RETURN_DOM = false;
			let RETURN_DOM_FRAGMENT = false;
			let RETURN_TRUSTED_TYPE = false;
			let SANITIZE_DOM = true;
			let SANITIZE_NAMED_PROPS = false;
			const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
			let KEEP_CONTENT = true;
			let IN_PLACE = false;
			let IN_PLACE_VISITED = null;
			let USE_PROFILES = {};
			let FORBID_CONTENTS = null;
			const DEFAULT_FORBID_CONTENTS = addToSet({}, [
				"annotation-xml",
				"audio",
				"colgroup",
				"desc",
				"foreignobject",
				"head",
				"iframe",
				"math",
				"mi",
				"mn",
				"mo",
				"ms",
				"mtext",
				"noembed",
				"noframes",
				"noscript",
				"plaintext",
				"script",
				"selectedcontent",
				"style",
				"svg",
				"template",
				"thead",
				"title",
				"video",
				"xmp"
			]);
			let DATA_URI_TAGS = null;
			const DEFAULT_DATA_URI_TAGS = addToSet({}, [
				"audio",
				"video",
				"img",
				"source",
				"image",
				"track"
			]);
			let URI_SAFE_ATTRIBUTES = null;
			const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
				"alt",
				"class",
				"for",
				"id",
				"label",
				"name",
				"pattern",
				"placeholder",
				"role",
				"summary",
				"title",
				"value",
				"style",
				"xmlns"
			]);
			const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
			const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
			const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
			let NAMESPACE = HTML_NAMESPACE;
			let IS_EMPTY_INPUT = false;
			let ALLOWED_NAMESPACES = null;
			const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [
				MATHML_NAMESPACE,
				SVG_NAMESPACE,
				HTML_NAMESPACE
			], stringToString);
			const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze([
				"mi",
				"mo",
				"mn",
				"ms",
				"mtext"
			]);
			let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
			const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
			let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
			const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
				"title",
				"style",
				"font",
				"a",
				"script"
			]);
			let PARSER_MEDIA_TYPE = null;
			const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
			const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
			let transformCaseFunc = null;
			let CONFIG = null;
			const formElement = document.createElement("form");
			const isRegexOrFunction = function isRegexOrFunction(testValue) {
				return testValue instanceof RegExp || testValue instanceof Function;
			};
			/**
			* _parseConfig
			*
			* @param cfg optional config literal
			*/
			const _parseConfig = function _parseConfig() {
				let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
				if (CONFIG && CONFIG === cfg) return;
				if (!cfg || typeof cfg !== "object") cfg = {};
				cfg = clone(cfg);
				PARSER_MEDIA_TYPE = SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
				transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
				ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, { transform: transformCaseFunc });
				ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, { transform: transformCaseFunc });
				ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, { transform: stringToString });
				URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
					transform: transformCaseFunc,
					base: DEFAULT_URI_SAFE_ATTRIBUTES
				});
				DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
					transform: transformCaseFunc,
					base: DEFAULT_DATA_URI_TAGS
				});
				FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, { transform: transformCaseFunc });
				FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), { transform: transformCaseFunc });
				FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), { transform: transformCaseFunc });
				USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
				ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
				ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
				ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
				ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
				SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
				SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
				WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
				RETURN_DOM = cfg.RETURN_DOM || false;
				RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
				RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
				FORCE_BODY = cfg.FORCE_BODY || false;
				SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
				SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
				KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
				IN_PLACE = cfg.IN_PLACE || false;
				IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
				NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
				MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(cfg, "MATHML_TEXT_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS));
				HTML_INTEGRATION_POINTS = _resolveObjectOption(cfg, "HTML_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS));
				const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", () => create(null));
				CUSTOM_ELEMENT_HANDLING = create(null);
				if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
				if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
				if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
				seal(CUSTOM_ELEMENT_HANDLING);
				if (SAFE_FOR_TEMPLATES) ALLOW_DATA_ATTR = false;
				if (RETURN_DOM_FRAGMENT) RETURN_DOM = true;
				if (USE_PROFILES) {
					ALLOWED_TAGS = addToSet({}, text);
					ALLOWED_ATTR = create(null);
					if (USE_PROFILES.html === true) {
						addToSet(ALLOWED_TAGS, html$1);
						addToSet(ALLOWED_ATTR, html);
					}
					if (USE_PROFILES.svg === true) {
						addToSet(ALLOWED_TAGS, svg$1);
						addToSet(ALLOWED_ATTR, svg);
						addToSet(ALLOWED_ATTR, xml);
					}
					if (USE_PROFILES.svgFilters === true) {
						addToSet(ALLOWED_TAGS, svgFilters);
						addToSet(ALLOWED_ATTR, svg);
						addToSet(ALLOWED_ATTR, xml);
					}
					if (USE_PROFILES.mathMl === true) {
						addToSet(ALLOWED_TAGS, mathMl$1);
						addToSet(ALLOWED_ATTR, mathMl);
						addToSet(ALLOWED_ATTR, xml);
					}
				}
				EXTRA_ELEMENT_HANDLING.tagCheck = null;
				EXTRA_ELEMENT_HANDLING.attributeCheck = null;
				if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
					if (typeof cfg.ADD_TAGS === "function") EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
					else if (arrayIsArray(cfg.ADD_TAGS)) {
						if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) ALLOWED_TAGS = clone(ALLOWED_TAGS);
						addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
					}
				}
				if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
					if (typeof cfg.ADD_ATTR === "function") EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
					else if (arrayIsArray(cfg.ADD_ATTR)) {
						if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) ALLOWED_ATTR = clone(ALLOWED_ATTR);
						addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
					}
				}
				if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
					if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) FORBID_CONTENTS = clone(FORBID_CONTENTS);
					addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
				}
				if (KEEP_CONTENT) ALLOWED_TAGS["#text"] = true;
				if (WHOLE_DOCUMENT) addToSet(ALLOWED_TAGS, [
					"html",
					"head",
					"body"
				]);
				if (ALLOWED_TAGS.table) {
					addToSet(ALLOWED_TAGS, ["tbody"]);
					delete FORBID_TAGS.tbody;
				}
				if (cfg.TRUSTED_TYPES_POLICY) {
					if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createHTML\" hook.");
					if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createScriptURL\" hook.");
					const previousTrustedTypesPolicy = trustedTypesPolicy;
					trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
					try {
						emptyHTML = _createTrustedHTML("");
					} catch (error) {
						trustedTypesPolicy = previousTrustedTypesPolicy;
						throw error;
					}
				} else if (cfg.TRUSTED_TYPES_POLICY === null) {
					trustedTypesPolicy = void 0;
					emptyHTML = "";
				} else {
					if (trustedTypesPolicy === void 0) trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
					if (trustedTypesPolicy && typeof emptyHTML === "string") emptyHTML = _createTrustedHTML("");
				}
				if (freeze) freeze(cfg);
				CONFIG = cfg;
			};
			const ALL_SVG_TAGS = addToSet({}, [
				...svg$1,
				...svgFilters,
				...svgDisallowed
			]);
			const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
			/**
			* Namespace rules for an element in the SVG namespace.
			*
			* @param tagName the element's lowercase tag name
			* @param parent the (possibly simulated) parent node
			* @param parentTagName the parent's lowercase tag name
			* @returns true if a spec-compliant parser could produce this element
			*/
			const _checkSvgNamespace = function _checkSvgNamespace(tagName, parent, parentTagName) {
				if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "svg";
				if (parent.namespaceURI === MATHML_NAMESPACE) return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
				return Boolean(ALL_SVG_TAGS[tagName]);
			};
			/**
			* Namespace rules for an element in the MathML namespace.
			*
			* @param tagName the element's lowercase tag name
			* @param parent the (possibly simulated) parent node
			* @param parentTagName the parent's lowercase tag name
			* @returns true if a spec-compliant parser could produce this element
			*/
			const _checkMathMlNamespace = function _checkMathMlNamespace(tagName, parent, parentTagName) {
				if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "math";
				if (parent.namespaceURI === SVG_NAMESPACE) return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
				return Boolean(ALL_MATHML_TAGS[tagName]);
			};
			/**
			* Namespace rules for an element in the HTML namespace.
			*
			* @param tagName the element's lowercase tag name
			* @param parent the (possibly simulated) parent node
			* @param parentTagName the parent's lowercase tag name
			* @returns true if a spec-compliant parser could produce this element
			*/
			const _checkHtmlNamespace = function _checkHtmlNamespace(tagName, parent, parentTagName) {
				if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) return false;
				if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) return false;
				return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
			};
			/**
			* @param element a DOM element whose namespace is being checked
			* @returns Return false if the element has a
			*  namespace that a spec-compliant parser would never
			*  return. Return true otherwise.
			*/
			const _checkValidNamespace = function _checkValidNamespace(element) {
				const elementNamespace = _readNamespaceURI(element);
				const tagName = stringToLowerCase(_readNodeName(element));
				const parentNode = getParentNode(element);
				let parent;
				let parentTagName;
				if (parentNode && _readNodeType(parentNode) === NODE_TYPE.element) {
					parent = { namespaceURI: _readNamespaceURI(parentNode) };
					parentTagName = stringToLowerCase(_readNodeName(parentNode));
				} else {
					parent = { namespaceURI: NAMESPACE };
					parentTagName = "template";
				}
				if (!ALLOWED_NAMESPACES[elementNamespace]) return false;
				if (elementNamespace === SVG_NAMESPACE) return _checkSvgNamespace(tagName, parent, parentTagName);
				if (elementNamespace === MATHML_NAMESPACE) return _checkMathMlNamespace(tagName, parent, parentTagName);
				if (elementNamespace === HTML_NAMESPACE) return _checkHtmlNamespace(tagName, parent, parentTagName);
				if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[elementNamespace]) return true;
				return false;
			};
			/**
			* _forceRemove
			*
			* @param node a DOM node
			*/
			const _forceRemove = function _forceRemove(node) {
				arrayPush(DOMPurify.removed, { element: node });
				try {
					getParentNode(node).removeChild(node);
				} catch (_) {
					remove(node);
					if (!getParentNode(node)) throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
				}
			};
			/**
			* _stripAttributeNode
			*
			* Remove a single Attr node case/namespace-exactly on an attribute-teardown
			* path. Name-based removeAttribute() ASCII-lowercases its lookup key for an
			* HTML element in an HTML document and so silently misses a case-preserved
			* handler (e.g. `ONERROR` off an XML/XHTML import) - the same defect
			* _removeAttribute() was fixed for, which a name-based call would reintroduce
			* on these IN_PLACE teardown paths. Unlike _removeAttribute this does not
			* record into DOMPurify.removed: the neutralize passes intentionally do not
			* book-keep. A clobbered/detached node falls back to best-effort name-based
			* removal.
			*
			* @param element the element to strip the attribute from
			* @param attribute the Attr node to remove
			* @param name the attribute's name, for the fallback path
			*/
			const _stripAttributeNode = function _stripAttributeNode(element, attribute, name) {
				try {
					removeAttributeNode(element, attribute);
				} catch (_) {
					try {
						element.removeAttribute(name);
					} catch (_) {}
				}
			};
			/**
			* Fail-closed teardown of an in-place root: strip every disallowed attribute
			* in the subtree first, so nothing armed is left behind, then remove all
			* children and the root's own attributes.
			*
			* @param root the in-place root to empty
			*/
			const _neutralizeRoot = function _neutralizeRoot(root) {
				_neutralizeSubtree(root);
				const childNodes = getChildNodes(root);
				if (childNodes) arrayForEach(arraySlice(childNodes), (child) => {
					try {
						remove(child);
					} catch (_) {}
				});
				const attributes = _readNodeType(root) === NODE_TYPE.element ? getAttributes(root) : null;
				if (attributes) for (let i = attributes.length - 1; i >= 0; --i) {
					const attribute = attributes[i];
					const name = attribute && attribute.name;
					if (typeof name === "string") _stripAttributeNode(root, attribute, name);
				}
			};
			/**
			* Removes an attribute, preferably as its exact Attr node: name-based
			* removal lowercases the name in HTML documents and misses case-preserved
			* names, e.g. from imported XHTML.
			*
			* @param name an Attribute name
			* @param element a DOM node
			* @param attr the exact Attr node to remove, when the caller has it
			*/
			const _removeAttribute = function _removeAttribute(name, element, attr) {
				if (!attr) try {
					attr = element.getAttributeNode(name);
				} catch (_) {
					attr = null;
				}
				arrayPush(DOMPurify.removed, {
					attribute: attr || null,
					from: element
				});
				try {
					if (attr) removeAttributeNode(element, attr);
					else element.removeAttribute(name);
				} catch (_) {
					try {
						element.removeAttribute(name);
					} catch (_) {}
				}
				if (name === "is") {
					if (RETURN_DOM || RETURN_DOM_FRAGMENT) try {
						_forceRemove(element);
					} catch (_) {}
					else try {
						element.setAttribute(name, "");
					} catch (_) {}
				}
			};
			/**
			* Removes every attribute the configuration does not allow. Used to
			* neutralize nodes discarded from an in-place tree.
			*
			* @param element the element to strip
			*/
			const _stripDisallowedAttributes = function _stripDisallowedAttributes(element) {
				const attributes = getAttributes(element);
				if (!attributes) return;
				for (let i = attributes.length - 1; i >= 0; --i) {
					const attribute = attributes[i];
					const name = attribute && attribute.name;
					if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) continue;
					_stripAttributeNode(element, attribute, name);
				}
			};
			/**
			* Iterative depth-first walk, so deep trees cannot overflow the call stack,
			* reading through the cached getters, so clobbering cannot hide children.
			* When `visit` returns false, the node's children are skipped. With
			* `intoShadow`, open shadow roots are walked after their host's children.
			*
			* @param root where to start
			* @param visit called for every node
			* @param intoShadow whether to enter open shadow roots
			*/
			const _walkTree = function _walkTree(root, visit) {
				let intoShadow = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
				const stack = [root];
				while (stack.length > 0) {
					const node = stack.pop();
					if (visit(node) === false) continue;
					if (intoShadow && _readNodeType(node) === NODE_TYPE.element) {
						const shadowRoot = getShadowRoot(node);
						if (_isDocumentFragment(shadowRoot)) stack.push(shadowRoot);
					}
					const childNodes = getChildNodes(node);
					if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push(childNodes[i]);
				}
			};
			/**
			* Strips disallowed attributes from every element of a discarded subtree,
			* so a handler that is already queued (a loading image) cannot fire.
			*
			* @param root the root of a removed subtree
			*/
			const _neutralizeSubtree = function _neutralizeSubtree(root) {
				_walkTree(root, (node) => {
					if (_readNodeType(node) === NODE_TYPE.element) _stripDisallowedAttributes(node);
				});
			};
			/**
			* All nodes under `root`, root first, including open shadow roots. Template
			* content is not entered, it is inert.
			*
			* @param root the in-place root
			* @return the nodes
			*/
			const _collectLiveNodes = function _collectLiveNodes(root) {
				const nodes = [];
				_walkTree(root, (node) => {
					nodes.push(node);
				}, true);
				return nodes;
			};
			/**
			* Strips disallowed attributes from every element that was under the
			* in-place root when the call started and no longer is, whatever removed
			* or moved it.
			*
			* @param root the in-place root
			* @param before the root's nodes, collected before the walk
			*/
			const _neutralizeEscapedElements = function _neutralizeEscapedElements(root, before) {
				const reachable = setCreate();
				arrayForEach(_collectLiveNodes(root), (node) => {
					if (_readNodeType(node) === NODE_TYPE.element) setAdd(reachable, node);
				});
				arrayForEach(before, (node) => {
					if (_readNodeType(node) === NODE_TYPE.element && !setHas(reachable, node)) _stripDisallowedAttributes(node);
				});
			};
			/**
			* Neutralizes everything that left the in-place tree during the call: what
			* DOMPurify removed, and what hooks or custom elements removed or moved out.
			*
			* @param root the in-place root
			* @param before the root's nodes, collected before the walk
			* @return true if the root itself was removed
			*/
			const _neutralizeDiscarded = function _neutralizeDiscarded(root, before) {
				let rootRemoved = false;
				arrayForEach(DOMPurify.removed, (entry) => {
					if (entry.element) {
						rootRemoved = rootRemoved || entry.element === root;
						_neutralizeSubtree(entry.element);
					}
				});
				_neutralizeEscapedElements(root, before);
				return rootRemoved;
			};
			const MAX_UNVISITED_ROUNDS = 8;
			/**
			* The walk only moves forward, so a node moved to a position it already
			* passed is never visited. Give every original node that is still in the
			* tree but unvisited the normal treatment, hooks included. Nodes created
			* during the call are left alone. Fails closed if the tree keeps changing.
			*
			* @param root the in-place root
			* @param before the root's nodes, collected before the walk
			*/
			const _sanitizeUnvisitedNodes = function _sanitizeUnvisitedNodes(root, before) {
				const visited = IN_PLACE_VISITED;
				let original = null;
				const getOriginal = () => {
					if (!original) {
						original = setCreate();
						arrayForEach(before, (beforeNode) => {
							setAdd(original, beforeNode);
						});
					}
					return original;
				};
				for (let round = 0;; round++) {
					const live = _collectLiveNodes(root);
					const containers = [root];
					let pending = false;
					arrayForEach(live, (node) => {
						if (_readNodeType(node) === NODE_TYPE.documentFragment) arrayPush(containers, node);
						else if (!pending && !setHas(visited, node)) pending = setHas(getOriginal(), node);
					});
					if (!pending) return;
					if (round >= MAX_UNVISITED_ROUNDS) throw typeErrorCreate("the tree kept changing during in-place sanitization; refusing to return it");
					arrayForEach(containers, (container, index) => {
						_sanitizeUnvisitedIn(container, index > 0, root, getOriginal());
					});
				}
			};
			/**
			* One _sanitizeUnvisitedNodes pass over the root or an open shadow root.
			*
			* @param container the root or an open shadow root
			* @param inShadow whether container is a shadow root
			* @param root the in-place root
			* @param original the root's nodes collected before the walk, as a set
			*/
			const _sanitizeUnvisitedIn = function _sanitizeUnvisitedIn(container, inShadow, root, original) {
				const iterator = _createNodeIterator(container);
				let node;
				while (node = iterator.nextNode()) {
					if (!setHas(original, node) || setHas(IN_PLACE_VISITED, node)) continue;
					if (inShadow) _executeHooks(hooks.uponSanitizeShadowNode, node, null);
					_sanitizeElements(node, root);
					_sanitizeAttributes(node, root);
					if (_isDocumentFragment(node.content)) _sanitizeShadowDOM2(node.content);
				}
			};
			/**
			* Records that _sanitizeElements processed `node`. No-op outside IN_PLACE.
			*
			* @param node the node being processed
			*/
			const _markVisited = function _markVisited(node) {
				if (IN_PLACE_VISITED) setAdd(IN_PLACE_VISITED, node);
			};
			/**
			* Patch-linkage attributes (declarative partial updates): `patchsrc`
			* always, `for` everywhere except on <label> and <output>. Gated on
			* SAFE_FOR_XML. Shared by the IN_PLACE pre-pass and _isValidAttribute.
			*
			* @param lcName the transformCaseFunc'd attribute name
			* @param lcTag the transformCaseFunc'd tag name of the carrying element
			* @return true if the attribute is patch linkage and must be dropped
			*/
			const _isPatchLinkageAttribute = function _isPatchLinkageAttribute(lcName, lcTag) {
				if (!SAFE_FOR_XML) return false;
				if (lcName === "patchsrc") return true;
				return lcName === "for" && lcTag !== "label" && lcTag !== "output";
			};
			/**
			* IN_PLACE pre-pass: sever all patch linkage before the walk, so no patch
			* can fire mid-walk into a part of the tree the walker already passed.
			* Removes range markers (processing instructions, comments with markup)
			* and strips linkage attributes. It cannot undo a patch that already fired.
			*
			* TODO: if the shipped feature can patch through `for` on <label>/<output>,
			* drop that pair here too (see test/declarative-patch-probe.html).
			*
			* @param root the in-place root to sweep
			*/
			const _neutralizePatchLinkage = function _neutralizePatchLinkage(root) {
				if (!SAFE_FOR_XML) return;
				_walkTree(root, (node) => {
					const nodeType = _readNodeType(node);
					if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
						try {
							remove(node);
						} catch (_) {}
						return false;
					}
					if (nodeType === NODE_TYPE.element) {
						const element = node;
						const lcTag = transformCaseFunc(_readNodeName(node));
						try {
							if (element.hasAttribute && element.hasAttribute("patchsrc")) element.removeAttribute("patchsrc");
							if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) element.removeAttribute("for");
						} catch (_) {}
					}
					return true;
				});
			};
			/**
			* _initDocument
			*
			* @param dirty - a string of dirty markup
			* @return a DOM, filled with the dirty markup
			*/
			const _initDocument = function _initDocument(dirty) {
				let doc = null;
				let leadingWhitespace = null;
				if (FORCE_BODY) dirty = "<remove></remove>" + dirty;
				else {
					const matches = stringMatch(dirty, /^[\r\n\t ]+/);
					leadingWhitespace = matches && matches[0];
				}
				if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) dirty = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head></head><body>" + dirty + "</body></html>";
				const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
				if (NAMESPACE === HTML_NAMESPACE) try {
					doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
				} catch (_) {}
				if (!doc || !doc.documentElement) {
					doc = implementation.createDocument(NAMESPACE, "template", null);
					try {
						doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
					} catch (_) {}
				}
				const body = doc.body || doc.documentElement;
				if (dirty && leadingWhitespace) body.insertBefore(document.createTextNode(leadingWhitespace), body.childNodes[0] || null);
				if (NAMESPACE === HTML_NAMESPACE) return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
				return WHOLE_DOCUMENT ? doc.documentElement : body;
			};
			/**
			* Creates a NodeIterator object that you can use to traverse filtered lists of nodes or elements in a document.
			*
			* @param root The root element or node to start traversing on.
			* @return The created NodeIterator
			*/
			const _createNodeIterator = function _createNodeIterator(root) {
				const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
				return createNodeIterator.call(doc || root, root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION, null);
			};
			/**
			* Replace template expression syntax (mustache, ERB, template
			* literal) with a space; shared by all SAFE_FOR_TEMPLATES scrub
			* sites. Order matters: mustache, then ERB, then template literal.
			*
			* @param value the string to scrub
			* @returns the scrubbed string
			*/
			const _stripTemplateExpressions = function _stripTemplateExpressions(value) {
				value = stringReplace(value, MUSTACHE_EXPR$1, " ");
				value = stringReplace(value, ERB_EXPR$1, " ");
				value = stringReplace(value, TMPLIT_EXPR$1, " ");
				return value;
			};
			/**
			* Strip template-engine expressions ({{...}}, ${...}, <%...%>) from the
			* character data of an element subtree. Used as the final safety net for
			* SAFE_FOR_TEMPLATES on every DOM-returning code path so that expressions
			* which only form after text-node normalization (e.g. fragments split across
			* stripped elements) cannot survive into a template-evaluating framework.
			*
			* Walks text/comment/CDATA/processing-instruction nodes and mutates `.data`
			* in place rather than round-tripping through innerHTML. This preserves
			* descendant node references (important for IN_PLACE callers), avoids a
			* serialize/reparse cycle, and reads literal character data — which means
			* `<%...%>` in text content matches the ERB regex against its real bytes
			* instead of the HTML-entity-escaped form innerHTML would produce.
			*
			* Attribute values are not visited here; SAFE_FOR_TEMPLATES handling for
			* attributes is performed during the per-node `_sanitizeAttributes` pass.
			*
			* @param node The root element whose character data should be scrubbed.
			*/
			const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
				var _node$querySelectorAl;
				_scrubOwnCharacterData(node);
				const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
				if (templates) arrayForEach(templates, (tmpl) => {
					if (_isDocumentFragment(tmpl.content)) _scrubTemplateExpressions2(tmpl.content);
				});
			};
			/**
			* _scrubOwnCharacterData
			*
			* Non-recursive core of _scrubTemplateExpressions: normalize `node` and
			* strip template expressions from its own character data only. Does not
			* enter <template>.content or attached shadow roots (NodeIterator never
			* does). Used by _sanitizeShadowDOM, where every nested template content
			* and shadow root is already walked - and therefore scrubbed - by its own
			* recursive _sanitizeShadowDOM call; recursing here as well would rescrub
			* each nested fragment once per ancestor, which is quadratic in nesting
			* depth.
			*
			* @param node The root whose own character data should be scrubbed.
			*/
			const _scrubOwnCharacterData = function _scrubOwnCharacterData(node) {
				node.normalize();
				const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
				const walker = createNodeIterator.call(doc || node, node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION, null);
				let currentNode = walker.nextNode();
				while (currentNode) {
					currentNode.data = _stripTemplateExpressions(currentNode.data);
					currentNode = walker.nextNode();
				}
			};
			/**
			* _isClobbered
			*
			* Detect DOM-clobbering on HTMLFormElement nodes. Form is the only HTML
			* interface with [LegacyOverrideBuiltIns]; a descendant element with a
			* `name` attribute matching a prototype property shadows that property
			* on direct reads. We use this check at the IN_PLACE entry-point and
			* during attribute sanitization to refuse clobbered forms.
			*
			* @param element element to check for clobbering attacks
			* @return true if clobbered, false if safe
			*/
			const _isClobbered = function _isClobbered(element) {
				const realTagName = getNodeName ? getNodeName(element) : null;
				if (typeof realTagName !== "string") return false;
				if (transformCaseFunc(realTagName) !== "form") return false;
				return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.removeAttributeNode !== "function" || typeof element.getAttributeNode !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || element.nodeType !== getNodeType(element) || element.childNodes !== getChildNodes(element);
			};
			/**
			* Checks whether the given value is a DocumentFragment from any realm.
			*
			* The realm-independent replacement reads `nodeType` through the cached
			* Node.prototype getter and compares to the DOCUMENT_FRAGMENT_NODE
			* constant (11). nodeType is a numeric value resolved from the node's
			* internal slot, identical across realms for the same kind of node.
			*
			* @param value object to check
			* @return true if value is a DocumentFragment-shaped node from any realm
			*/
			const _isDocumentFragment = function _isDocumentFragment(value) {
				if (!getNodeType || typeof value !== "object" || value === null) return false;
				try {
					return getNodeType(value) === NODE_TYPE.documentFragment;
				} catch (_) {
					return false;
				}
			};
			/**
			* Checks whether the given object is a DOM node, including nodes that
			* originate from a different window/realm (e.g. an iframe's
			* contentDocument). The previous `value instanceof Node` check was
			* realm-bound: nodes from a different window failed it, causing
			* sanitize() to silently stringify them and reset IN_PLACE to false,
			* returning the original node unsanitized. See GHSA-4w3q-35jp-p934.
			*
			* @param value object to check whether it's a DOM node
			* @return true if value is a DOM node from any realm
			*/
			const _isNode = function _isNode(value) {
				if (!getNodeType || typeof value !== "object" || value === null) return false;
				try {
					return typeof getNodeType(value) === "number";
				} catch (_) {
					return false;
				}
			};
			function _executeHooks(hooks, currentNode, data) {
				if (hooks.length === 0) return;
				arrayForEach(hooks, (hook) => {
					hook.call(DOMPurify, currentNode, data, CONFIG);
				});
			}
			/**
			* Structural-threat checks that condemn a node regardless of the
			* allowlists: mXSS via namespace confusion, risky CSS construction,
			* processing instructions, markup-bearing comments. Pure predicate;
			* the caller removes. Check order is load-bearing.
			*
			* @param currentNode the node to inspect
			* @param tagName the node's transformCaseFunc'd tag name
			* @return true if the node must be removed
			*/
			const _isUnsafeNode = function _isUnsafeNode(currentNode, tagName) {
				if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) return true;
				if (SAFE_FOR_XML && LITERAL_TEXT_ELEMENTS[tagName] && _readNodeType(currentNode) === NODE_TYPE.element && _readNamespaceURI(currentNode) === HTML_NAMESPACE && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent))) return true;
				if (currentNode.nodeType === NODE_TYPE.processingInstruction) return true;
				if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) return true;
				return false;
			};
			/**
			* Evaluate a CUSTOM_ELEMENT_HANDLING check (a RegExp or a predicate
			* function, per the validation in _parseConfig) against a name.
			* Additional arguments are forwarded to predicate functions - the
			* attributeNameCheck predicate receives the tag name as its second
			* argument. A null/absent check never matches.
			*
			* @param check the configured tagNameCheck / attributeNameCheck value
			* @param name the name to test
			* @param args extra arguments forwarded to a predicate function
			* @return true if the check matches the name
			*/
			const _matchesNameCheck = function _matchesNameCheck(check, name) {
				if (check instanceof RegExp) return regExpTest(check, name);
				if (check instanceof Function) {
					for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
					return Boolean(check(name, ...args));
				}
				return false;
			};
			/**
			* Handle a node whose tag is forbidden or not allowlisted: keep
			* allowed custom elements (false return exits _sanitizeElements
			* early - the namespace and fallback-tag removal checks are
			* intentionally skipped for kept custom elements), else hoist
			* content per KEEP_CONTENT and remove.
			*
			* A kept custom element is the ONLY case in which this function
			* returns false, so the caller uses that return value to run the
			* afterSanitizeElements hook on the kept element and keep the
			* element-hook lifecycle consistent with normal allowlisted
			* elements (GHSA-c2j3-45gr-mqc4).
			*
			* @param currentNode the disallowed node
			* @param tagName the node's transformCaseFunc'd tag name
			* @return true if the node was removed, false if kept
			*/
			const _sanitizeDisallowedNode = function _sanitizeDisallowedNode(currentNode, tagName, root) {
				if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) return false;
				if (KEEP_CONTENT && !FORBID_CONTENTS[tagName] && !FORBID_CONTENTS[stringToLowerCase(tagName)]) {
					const parentNode = getParentNode(currentNode);
					const childNodes = getChildNodes(currentNode);
					if (childNodes && parentNode) {
						const childCount = childNodes.length;
						for (let i = childCount - 1; i >= 0; --i) {
							const hoisted = currentNode === root ? cloneNode(childNodes[i], true) : childNodes[i];
							parentNode.insertBefore(hoisted, getNextSibling(currentNode));
						}
					}
				}
				_forceRemove(currentNode);
				return true;
			};
			/**
			* Fork a hook-mutable allowlist off its shared binding the first time a
			* (possibly lazily-installed) uponSanitize* hook is about to see it, so the
			* hook cannot widen the per-instance default or the setConfig binding by
			* reference and leak past the call. Returns the set unchanged once it is
			* already call-local, so repeated calls across elements are idempotent.
			*
			* @param hookList the uponSanitize* hook array for this event
			* @param set the current ALLOWED_TAGS / ALLOWED_ATTR binding
			* @param defaultSet the per-instance DEFAULT_ALLOWED_* constant
			* @param setConfigSet the captured setConfig() binding, or null
			* @return a call-local clone if a hook is present and set is still shared,
			*   else set unchanged
			*/
			const _forkSharedAllowlist = function _forkSharedAllowlist(hookList, set, defaultSet, setConfigSet) {
				if (hookList.length === 0) return set;
				return set === defaultSet || set === setConfigSet ? clone(set) : set;
			};
			/**
			* A hook may have detached the node it was called for. If so, treat it as
			* removed and stop processing it; the walk root is exempt. On the IN_PLACE
			* path the detached subtree is neutralized right away.
			*
			* @param currentNode the node a hook may have detached
			* @param root the current walk root
			* @return true if the node was detached
			*/
			const _handleHookDetachedNode = function _handleHookDetachedNode(currentNode, root) {
				if (currentNode === root || getParentNode(currentNode) !== null) return false;
				if (IN_PLACE) _neutralizeSubtree(currentNode);
				return true;
			};
			/**
			* _sanitizeElements
			*
			* @protect nodeName
			* @protect textContent
			* @protect removeChild
			* @param currentNode to check for permission to exist
			* @return true if node was killed, false if left alive
			*/
			const _sanitizeElements = function _sanitizeElements(currentNode, root) {
				_markVisited(currentNode);
				_executeHooks(hooks.beforeSanitizeElements, currentNode, null);
				if (_handleHookDetachedNode(currentNode, root)) return true;
				if (_isClobbered(currentNode)) {
					_forceRemove(currentNode);
					return true;
				}
				const tagName = transformCaseFunc(_readNodeName(currentNode));
				ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
				_executeHooks(hooks.uponSanitizeElement, currentNode, {
					tagName,
					allowedTags: ALLOWED_TAGS
				});
				if (_handleHookDetachedNode(currentNode, root)) return true;
				if (_isUnsafeNode(currentNode, tagName)) {
					_forceRemove(currentNode);
					return true;
				}
				if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
					const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
					if (removed === false) {
						_executeHooks(hooks.afterSanitizeElements, currentNode, null);
						if (_handleHookDetachedNode(currentNode, root)) return true;
					}
					return removed;
				}
				if (_readNodeType(currentNode) === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
					_forceRemove(currentNode);
					return true;
				}
				if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
					_forceRemove(currentNode);
					return true;
				}
				if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
					const content = _stripTemplateExpressions(currentNode.textContent);
					if (currentNode.textContent !== content) {
						arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
						currentNode.textContent = content;
					}
				}
				_executeHooks(hooks.afterSanitizeElements, currentNode, null);
				return _handleHookDetachedNode(currentNode, root);
			};
			/**
			* _isValidAttribute
			*
			* @param lcTag Lowercase tag name of containing element.
			* @param lcName Lowercase attribute name.
			* @param value Attribute value.
			* @return Returns true if `value` is valid, otherwise false.
			*/
			const _isValidAttribute = function _isValidAttribute(lcTag, lcName, value) {
				if (FORBID_ATTR[lcName]) return false;
				if (_isPatchLinkageAttribute(lcName, lcTag)) return false;
				if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document || value in formElement)) return false;
				const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
				if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) return true;
				if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) return true;
				if (!nameIsPermitted) return _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value);
				if (URI_SAFE_ATTRIBUTES[lcName]) return true;
				if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
				if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) return true;
				if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
				return !value;
			};
			const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
				"annotation-xml",
				"color-profile",
				"font-face",
				"font-face-format",
				"font-face-name",
				"font-face-src",
				"font-face-uri",
				"missing-glyph"
			]);
			/**
			* _isBasicCustomElement
			* checks if at least one dash is included in tagName, and it's not the first char
			* for more sophisticated checking see https://github.com/sindresorhus/validate-element-name
			*
			* @param tagName name of the tag of the node to sanitize
			* @returns Returns true if the tag name meets the basic criteria for a custom element, otherwise false.
			*/
			const _isBasicCustomElement = function _isBasicCustomElement(tagName) {
				return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
			};
			/**
			* Wrap an attribute value in the matching Trusted Types object when
			* the active policy requires it. Namespaced attributes pass through
			* unchanged (no TT support yet, see
			* https://bugs.chromium.org/p/chromium/issues/detail?id=1305293).
			*
			* @param lcTag lowercase tag name of the containing element
			* @param lcName lowercase attribute name
			* @param namespaceURI the attribute's namespace, if any
			* @param value the attribute value to wrap
			* @return the value, wrapped when Trusted Types demand it
			*/
			const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value) {
				if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) switch (trustedTypes.getAttributeType(lcTag, lcName)) {
					case "TrustedHTML": return _createTrustedHTML(value);
					case "TrustedScriptURL": return _createTrustedScriptURL(value);
				}
				return value;
			};
			/**
			* Write a modified attribute value back onto the element. On
			* success, re-probe for clobbering introduced by the new value and
			* remove the element when found; otherwise, when this writeback is the
			* recreate half of the SANITIZE_NAMED_PROPS remove-and-recreate, pop the
			* removal entry that path recorded so it does not show as removed. On
			* failure, remove the attribute instead.
			*
			* Returns true only on a clean write (the value was set and the new value
			* introduced no clobbering). The caller uses that, together with its own
			* knowledge of whether this attribute pushed a DOMPurify.removed record, to
			* decide whether to pop that record. The pop must happen ONLY for the
			* named-prop remove-and-recreate; popping on any other value change (trim,
			* template scrubbing, Trusted Types) would consume an unrelated _forceRemove
			* subtree-cleanup record and let that detached subtree keep a live event
			* handler through the IN_PLACE neutralization pass (SO-001).
			*
			* @param currentNode the element carrying the attribute
			* @param name the attribute name as present on the element
			* @param namespaceURI the attribute's namespace, if any
			* @param value the new attribute value
			* @return true if the value was written without introducing clobbering
			*/
			const _setAttributeValue = function _setAttributeValue(currentNode, name, namespaceURI, value) {
				try {
					if (namespaceURI) currentNode.setAttributeNS(namespaceURI, name, value);
					else currentNode.setAttribute(name, value);
					if (_isClobbered(currentNode)) {
						_forceRemove(currentNode);
						return false;
					}
					return true;
				} catch (_) {
					_removeAttribute(name, currentNode);
					return false;
				}
			};
			/**
			* _isUnsafeAttributeValue
			*
			* Value-based attribute checks that the attribute walk applies before any
			* hook can force-keep an attribute, shared with the public
			* isValidAttribute() so that it never approves a value sanitize() would
			* strip.
			*
			* @param name the attribute name as found on the node (case preserved)
			* @param value the attribute value
			* @returns true if the attribute must be removed because of its value
			*/
			const _isUnsafeAttributeValue = function _isUnsafeAttributeValue(name, value) {
				if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) return true;
				return stringToLowerCase(name) === "attributename" && stringMatch(value, "href") !== null;
			};
			/**
			* _sanitizeAttributes
			*
			* @protect attributes
			* @protect nodeName
			* @protect removeAttribute
			* @protect setAttribute
			*
			* @param currentNode to sanitize
			* @param root the current walk root
			*/
			const _sanitizeAttributes = function _sanitizeAttributes(currentNode, root) {
				_executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
				if (_handleHookDetachedNode(currentNode, root)) return;
				const attributes = currentNode.attributes;
				if (!attributes || _isClobbered(currentNode)) return;
				ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
				const hookEvent = {
					attrName: "",
					attrValue: "",
					keepAttr: true,
					allowedAttributes: ALLOWED_ATTR,
					forceKeepAttr: void 0
				};
				let l = attributes.length;
				const lcTag = transformCaseFunc(currentNode.nodeName);
				while (l--) {
					const attr = attributes[l];
					const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
					const lcName = transformCaseFunc(name);
					const initValue = attrValue;
					let value = name === "value" ? initValue : stringTrim(initValue);
					let recreatedNamedProp = false;
					hookEvent.attrName = lcName;
					hookEvent.attrValue = value;
					hookEvent.keepAttr = true;
					hookEvent.forceKeepAttr = void 0;
					_executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
					value = hookEvent.attrValue;
					if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
						_removeAttribute(name, currentNode, attr);
						value = SANITIZE_NAMED_PROPS_PREFIX + value;
						recreatedNamedProp = true;
					}
					if (_isUnsafeAttributeValue(name, value)) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					if (hookEvent.forceKeepAttr) continue;
					if (!hookEvent.keepAttr) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					if (SAFE_FOR_TEMPLATES) value = _stripTemplateExpressions(value);
					if (!_isValidAttribute(lcTag, lcName, value)) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
					if (value !== initValue) {
						if (_setAttributeValue(currentNode, name, namespaceURI, value) && recreatedNamedProp) arrayPop(DOMPurify.removed);
					}
				}
				_executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
				_handleHookDetachedNode(currentNode, root);
			};
			/**
			* _sanitizeShadowDOM
			*
			* @param fragment to iterate over recursively
			*/
			const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
				let shadowNode = null;
				const shadowIterator = _createNodeIterator(fragment);
				_executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
				while (shadowNode = shadowIterator.nextNode()) {
					_executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
					_sanitizeElements(shadowNode, fragment);
					_sanitizeAttributes(shadowNode, fragment);
					if (_isDocumentFragment(shadowNode.content)) _sanitizeShadowDOM2(shadowNode.content);
					if (_readNodeType(shadowNode) === NODE_TYPE.element) {
						const innerSr = getShadowRoot(shadowNode);
						if (_isDocumentFragment(innerSr)) {
							_sanitizeAttachedShadowRoots(innerSr);
							_sanitizeShadowDOM2(innerSr);
						}
					}
				}
				if (SAFE_FOR_TEMPLATES) _scrubOwnCharacterData(fragment);
				_executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
			};
			/**
			* Sanitizes every attached shadow root under `root`, since the node
			* iterator does not enter shadow trees. Needed for IN_PLACE input and for
			* DOM input whose clonable shadow roots were copied by importNode().
			*
			* @param root the subtree root to walk for attached shadow roots
			*/
			const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots(root) {
				const stack = [{
					node: root,
					shadow: null
				}];
				while (stack.length > 0) {
					const item = stack.pop();
					if (item.shadow) {
						_sanitizeShadowDOM2(item.shadow);
						continue;
					}
					const node = item.node;
					const isElement = _readNodeType(node) === NODE_TYPE.element;
					const childNodes = getChildNodes(node);
					if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push({
						node: childNodes[i],
						shadow: null
					});
					if (isElement) {
						const rootName = getNodeName ? getNodeName(node) : null;
						if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
							const content = node.content;
							if (_isDocumentFragment(content)) stack.push({
								node: content,
								shadow: null
							});
						}
					}
					if (isElement) {
						const sr = getShadowRoot(node);
						if (_isDocumentFragment(sr)) stack.push({
							node: null,
							shadow: sr
						}, {
							node: sr,
							shadow: null
						});
					}
				}
			};
			DOMPurify.sanitize = function(dirty) {
				let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
				let body = null;
				let importedNode = null;
				let currentNode = null;
				let returnNode = null;
				IS_EMPTY_INPUT = !dirty;
				if (IS_EMPTY_INPUT) dirty = "<!-->";
				if (typeof dirty !== "string" && !_isNode(dirty)) {
					dirty = stringifyValue(dirty);
					if (typeof dirty !== "string") throw typeErrorCreate("dirty is not a string, aborting");
				}
				if (!DOMPurify.isSupported) return dirty;
				if (SET_CONFIG) {
					ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
					ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
				} else _parseConfig(cfg);
				if (hooks.uponSanitizeElement.length > 0 || hooks.uponSanitizeAttribute.length > 0) ALLOWED_TAGS = clone(ALLOWED_TAGS);
				if (hooks.uponSanitizeAttribute.length > 0) ALLOWED_ATTR = clone(ALLOWED_ATTR);
				DOMPurify.removed = [];
				const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
				let inPlaceNodes = [];
				const outerVisited = IN_PLACE_VISITED;
				if (inPlace) {
					_neutralizePatchLinkage(dirty);
					const nn = _readNodeName(dirty);
					if (typeof nn === "string") {
						const tagName = transformCaseFunc(nn);
						if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
							_neutralizeRoot(dirty);
							throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
						}
					}
					if (_isClobbered(dirty)) {
						_neutralizeRoot(dirty);
						throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
					}
					inPlaceNodes = _collectLiveNodes(dirty);
					IN_PLACE_VISITED = setCreate();
				} else if (_isNode(dirty)) {
					body = _initDocument("<!---->");
					importedNode = body.ownerDocument.importNode(dirty, true);
					if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") body = importedNode;
					else if (importedNode.nodeName === "HTML") body = importedNode;
					else body.appendChild(importedNode);
					_sanitizeAttachedShadowRoots(body);
				} else {
					if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && dirty.indexOf("<") === -1) return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
					body = _initDocument(dirty);
					if (!body) return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
				}
				if (body && FORCE_BODY) _forceRemove(body.firstChild);
				const walkRoot = inPlace ? dirty : body;
				try {
					if (inPlace) _sanitizeAttachedShadowRoots(dirty);
					const nodeIterator = _createNodeIterator(walkRoot);
					while (currentNode = nodeIterator.nextNode()) {
						_sanitizeElements(currentNode, walkRoot);
						_sanitizeAttributes(currentNode, walkRoot);
						if (_isDocumentFragment(currentNode.content)) _sanitizeShadowDOM2(currentNode.content);
					}
					if (inPlace) _sanitizeUnvisitedNodes(dirty, inPlaceNodes);
				} catch (error) {
					if (inPlace) {
						_neutralizeRoot(dirty);
						_neutralizeDiscarded(dirty, inPlaceNodes);
					}
					throw error;
				} finally {
					IN_PLACE_VISITED = outerVisited;
				}
				if (inPlace) {
					if (_neutralizeDiscarded(dirty, inPlaceNodes)) throw typeErrorCreate("a node selected for removal could not be safely returned; refusing to sanitize in place");
					if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(dirty);
					return dirty;
				}
				if (RETURN_DOM) {
					if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(body);
					if (RETURN_DOM_FRAGMENT) {
						returnNode = createDocumentFragment.call(body.ownerDocument);
						while (body.firstChild) returnNode.appendChild(body.firstChild);
					} else returnNode = body;
					if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) returnNode = importNode.call(originalDocument, returnNode, true);
					return returnNode;
				}
				let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
				if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
				if (SAFE_FOR_TEMPLATES) serializedHTML = _stripTemplateExpressions(serializedHTML);
				return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
			};
			DOMPurify.setConfig = function() {
				let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
				_parseConfig(cfg);
				SET_CONFIG = true;
				SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
				SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
			};
			DOMPurify.clearConfig = function() {
				CONFIG = null;
				SET_CONFIG = false;
				SET_CONFIG_ALLOWED_TAGS = null;
				SET_CONFIG_ALLOWED_ATTR = null;
				trustedTypesPolicy = defaultTrustedTypesPolicy;
				emptyHTML = "";
			};
			DOMPurify.isValidAttribute = function(tag, attr, value) {
				if (!CONFIG) _parseConfig({});
				const lcTag = transformCaseFunc(tag);
				const lcName = transformCaseFunc(attr);
				if (typeof value === "string" && (_isUnsafeAttributeValue(attr, value) || !ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value))) return false;
				return _isValidAttribute(lcTag, lcName, value);
			};
			DOMPurify.addHook = function(entryPoint, hookFunction) {
				if (typeof hookFunction !== "function") return;
				if (!objectHasOwnProperty(hooks, entryPoint)) return;
				arrayPush(hooks[entryPoint], hookFunction);
			};
			DOMPurify.removeHook = function(entryPoint, hookFunction) {
				if (!objectHasOwnProperty(hooks, entryPoint)) return;
				if (hookFunction !== void 0) {
					const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
					return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
				}
				return arrayPop(hooks[entryPoint]);
			};
			DOMPurify.removeHooks = function(entryPoint) {
				if (!objectHasOwnProperty(hooks, entryPoint)) return;
				hooks[entryPoint] = [];
			};
			DOMPurify.removeAllHooks = function() {
				hooks = _createHooksMap();
			};
			return DOMPurify;
		}
		var purify_default = createDOMPurify();
		//#endregion
		//#region src/client/ArticlePreview.tsx
		/** Scripts stay disabled. Same-origin access is only used to wire image events. */
		function ArticlePreview({ html, title = "文章排版预览" }) {
			const preview = useImagePreview();
			(0, react.useEffect)(() => {
				preview.dismiss();
			}, [html]);
			const content = (0, react.useMemo)(() => purify_default.sanitize(html, {
				WHOLE_DOCUMENT: true,
				FORBID_TAGS: [
					"script",
					"iframe",
					"object",
					"embed",
					"form",
					"base",
					"meta",
					"link"
				],
				FORBID_ATTR: ["srcdoc", "formaction"],
				RETURN_TRUSTED_TYPE: false
			}), [html]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
				title,
				sandbox: "allow-same-origin",
				referrerPolicy: "no-referrer",
				srcDoc: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">${content}`,
				onLoad: (e) => {
					const doc = e.currentTarget.contentDocument;
					if (!doc) return;
					const images = [...doc.querySelectorAll("img")].filter((i) => /^(?:data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml);|blob:)/i.test(i.src));
					images.forEach((image, index) => {
						image.tabIndex = 0;
						image.setAttribute("role", "button");
						image.setAttribute("aria-label", `查看图片：${image.alt || `图片 ${index + 1}`}`);
						image.style.cursor = "pointer";
						const open = () => preview.open(images.map((item, n) => ({
							id: String(n),
							title: item.alt || `文章图片 ${n + 1}`,
							src: item.src,
							revision: item.src
						})), String(index), image);
						image.addEventListener("click", (event) => {
							event.preventDefault();
							open();
						});
						image.addEventListener("keydown", (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								open();
							}
						});
					});
				}
			});
		}
		//#endregion
		//#region src/client/PublicationResults.tsx
		const uploadLabels = {
			unconfirmed: "上传结果待核对",
			blocked: "需要继续处理",
			cancelled: "已取消",
			failed: "上传未完成",
			ready: "已上传待人工发表"
		};
		const syncLabels = {
			completed: "同步完成",
			cancelled: "同步已取消",
			failed: "本次同步未完成"
		};
		function PublicationResults({ detail, api, edit, accountId, run }) {
			const data = useProjectData(api, detail), scope = {
				id: detail.id,
				folderPath: detail.folderPath
			}, platform = edit.input.platform;
			const [association, setAssociation] = (0, react.useState)(), [notice, setNotice] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (association && association.accountId !== accountId) {
					setAssociation(void 0);
					setNotice("账号已变化，请重新选择作品。");
				}
			}, [accountId, association?.accountId]);
			const tasks = data.state?.tasks.filter((t) => t.publicationId === edit.publicationId && t.kind === "upload" && (t.platform ?? t.account?.platform ?? "official-account") === platform && (!t.publicationType || t.publicationType === edit.input.type)) ?? [];
			const records = data.state?.records?.filter((r) => r.publicationId === edit.publicationId && r.platform === platform && r.type === edit.input.type) ?? [];
			const syncing = data.state?.tasks.filter((t) => t.kind === "metrics" && t.metricsTargets?.some((m) => m.platform === platform && m.accountId === accountId && m.publicationId === edit.publicationId)) ?? [];
			const associate = (record) => {
				if (accountId) setAssociation({
					accountId,
					platform,
					...record ? { recordId: record.id } : {},
					remoteId: record?.remoteId ?? "",
					url: record?.url ?? ""
				});
			};
			const sync = (recordId) => void run({
				...scope,
				action: "refresh-metrics",
				platform,
				...edit.publicationId ? { publicationId: edit.publicationId } : {},
				...recordId ? { recordId } : {},
				...accountId ? { expectedAccountId: accountId } : {}
			}).catch(() => void 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "publicationGroup",
				"aria-label": "上传与平台草稿",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "上传与平台草稿" }),
					!tasks.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorMuted",
						children: "尚未上传"
					}),
					tasks.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationResultRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t.step || (uploadLabels[t.status] ?? "正在上传") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [new Date(t.updatedAt).toLocaleString(), (t.account?.id ?? t.wechatAppId) !== accountId ? " · 历史账号" : ""] }),
							t.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorError",
								children: t.error
							})
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionBar, { children: isActiveTask(t) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								...scope,
								action: "cancel",
								taskId: t.id
							}).catch(() => void 0),
							children: "取消任务"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								...scope,
								action: "inspect-upload",
								taskId: t.id
							}).catch(() => void 0),
							children: "检查原任务"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								...scope,
								action: "resume-upload",
								taskId: t.id
							}).catch(() => void 0),
							children: "继续原任务"
						})] }) })]
					}, t.id))
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "publicationGroup",
				"aria-label": "此材料的作品数据",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "productionHeading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "作品数据" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							disabled: !accountId || !edit.publicationId,
							onClick: () => associate(),
							children: "关联已发表作品"
						})]
					}),
					!records.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorMuted",
						children: "关联已发表的作品后查看数据"
					}),
					records.map((r) => {
						const current = r.platform === platform && r.accountId === accountId;
						const metric = data.state?.metrics.find((m) => m.recordId === r.id && m.platform === r.platform && m.accountId === r.accountId && m.remoteId === r.remoteId);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "publicationResultRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: r.state === "published" ? "已发表" : r.state === "draft" ? "平台草稿已保存" : r.state === "linked" ? "已关联，待核对" : "已上传待发表" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [!current && "历史账号 · ", r.remoteId || "尚无作品标识"] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									"播放／阅读 ",
									metric?.views ?? "—",
									" · 赞 ",
									metric?.likes ?? "—",
									" · 评论 ",
									metric?.comments ?? "—"
								] }),
								metric?.syncedAt && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: ["数据更新于 ", new Date(metric.syncedAt).toLocaleString()] }),
								metric?.error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "creatorError",
									children: [metric.error, metric.syncedAt ? "，保留上次成功数据" : ""]
								}),
								r.url && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: r.url,
									target: "_blank",
									rel: "noreferrer",
									children: "查看作品"
								})
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: !current || !r.remoteId || syncing.some(isActiveTask),
								onClick: () => sync(r.id),
								children: "同步此作品"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: !current,
								onClick: () => associate(r),
								children: "更改关联"
							})] })]
						}, r.id);
					}),
					syncing.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorInlineStatus",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: isActiveTask(t) ? data.error ? "状态暂不可用" : t.step || "正在同步此作品" : t.error || (syncLabels[t.status] ?? "本次同步已结束") }), isActiveTask(t) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								...scope,
								action: "cancel",
								taskId: t.id
							}).catch(() => void 0),
							children: "取消同步"
						})]
					}, t.id)),
					association && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationAssociation",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "选择当前账号的作品" }),
							data.state?.candidates?.filter((c) => c.platform === association.platform && c.accountId === association.accountId && c.accountId === accountId).map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "creatorAssetRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: c.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => setAssociation({
										...association,
										remoteId: c.remoteId,
										url: c.url ?? "",
										candidateAccountId: c.accountId
									}),
									children: "选择此作品"
								})]
							}, `${c.platform}:${c.accountId}:${c.remoteId}`)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["作品标识", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: association.remoteId,
								onChange: (e) => {
									const { candidateAccountId: _candidate, ...manual } = association;
									setAssociation({
										...manual,
										remoteId: e.target.value
									});
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["作品链接", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: association.url,
								onChange: (e) => setAssociation({
									...association,
									url: e.target.value
								})
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: !association.remoteId.trim() || association.accountId !== accountId,
								onClick: async () => {
									const captured = association;
									try {
										await run({
											...scope,
											action: "associate-publication",
											platform: captured.platform,
											remoteId: captured.remoteId,
											expectedAccountId: captured.accountId,
											...captured.candidateAccountId ? { candidateAccountId: captured.candidateAccountId } : {},
											...edit.publicationId ? { publicationId: edit.publicationId } : {},
											...captured.recordId ? { recordId: captured.recordId } : {},
											...captured.url ? { url: captured.url } : {}
										});
										setAssociation((previous) => previous === captured ? void 0 : previous);
									} catch {}
								},
								children: "保存关联并读取数据"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "ghost",
								onClick: () => setAssociation(void 0),
								children: "取消"
							})] })
						]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "creatorMuted",
						children: notice
					})
				]
			})] });
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ui/ActionMenu.css.mjs
		registerPluginCss("dsh-creator-workbench/ActionMenu.css", "[data-plugin=\"dsh-creator-workbench\"] .creatorMenu { position:relative;flex:none; }\n[data-plugin=\"dsh-creator-workbench\"].creatorMenuItems { min-width:148px; }\n[data-plugin=\"dsh-creator-workbench\"].creatorMenuItems.creatorControlPopup [role=\"menuitem\"] { position:relative;justify-content:flex-start;width:100%;text-align:left;white-space:normal;overflow-wrap:anywhere;flex:none;border-radius:var(--creator-compact-radius,8px);background:transparent; }\n[data-plugin=\"dsh-creator-workbench\"].creatorMenuItems [role=\"menuitem\"]:hover:not(:disabled),html[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"].creatorMenuItems [role=\"menuitem\"]:hover:not(:disabled) { background:transparent; }\n\n[data-plugin=\"dsh-creator-workbench\"].creatorMenuItems[popover] { position:fixed;inset:auto;margin:0;box-sizing:border-box;max-height:70vh;overflow:auto; }\n");
		//#endregion
		//#region src/client/ui/ActionMenu.tsx
		function menuChildren(children) {
			return react.Children.toArray(children).flatMap((child) => (0, react.isValidElement)(child) && child.type === react.Fragment ? menuChildren(child.props.children) : [child]);
		}
		/** A single-level action menu. Callers retain their existing guarded business handlers. */
		function ActionMenu({ label, ariaLabel, children, tone = "ghost", align = "start" }) {
			const [open, setOpen] = (0, react.useState)(false), root = (0, react.useRef)(null), popup = (0, react.useRef)(null), trigger = (0, react.useRef)(null), focusLast = (0, react.useRef)(false), id = (0, react.useId)();
			const highlight = (0, react.useRef)(null), highlighted = (0, react.useRef)(false), highlightTarget = (0, react.useRef)();
			const layer = useControlPopup(open, () => setOpen(false), root, trigger, popup, align, false, () => {
				if (popup.current && highlight.current && highlightTarget.current && popup.current.contains(highlightTarget.current)) placeOptionHighlight(popup.current, highlightTarget.current, highlight.current, false);
			});
			const highlightItem = (item) => {
				highlightTarget.current = item;
				if (popup.current && highlight.current) {
					placeOptionHighlight(popup.current, item, highlight.current, highlighted.current && layer.motion);
					highlighted.current = true;
				}
			};
			const items = () => Array.from(popup.current?.querySelectorAll("[role=\"menuitem\"]:not(:disabled)") ?? []);
			(0, react.useEffect)(() => {
				if (!open) return;
				highlighted.current = false;
				const focusFrame = requestAnimationFrame(() => {
					const buttons = items();
					buttons[focusLast.current ? buttons.length - 1 : 0]?.focus({ preventScroll: true });
				});
				return () => cancelAnimationFrame(focusFrame);
			}, [open]);
			const close = (focus = true) => {
				setOpen(false);
				if (focus && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "creatorMenu",
				"data-menu-align": align,
				ref: root,
				onBlurCapture: (event) => {
					if (event.relatedTarget instanceof Node) {
						if (!event.currentTarget.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) setOpen(false);
					} else queueMicrotask(() => {
						const host = root.current;
						if (host?.isConnected && !host.contains(document.activeElement) && !popup.current?.contains(document.activeElement)) setOpen(false);
					});
				},
				onKeyDown: (event) => {
					if (event.key === "Tab" && open) {
						const next = trigger.current ? adjacentTabStop(trigger.current, event.shiftKey, popup.current) : void 0;
						close(false);
						if (next) {
							event.preventDefault();
							next.focus({ preventScroll: true });
						}
						return;
					}
					if (event.key === "Escape" && open) {
						event.preventDefault();
						event.stopPropagation();
						close();
					}
					if ([
						"ArrowDown",
						"ArrowUp",
						"Home",
						"End"
					].includes(event.key) && open) {
						const buttons = items();
						if (!buttons.length) return;
						event.preventDefault();
						const i = buttons.indexOf(document.activeElement);
						buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : i < 0 ? event.key === "ArrowUp" ? buttons.length - 1 : 0 : (i + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus({ preventScroll: true });
					}
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					tone,
					"aria-label": ariaLabel ?? label,
					"aria-haspopup": "menu",
					"aria-expanded": open,
					"aria-controls": open ? id : void 0,
					onClick: (event) => {
						trigger.current = event.currentTarget;
						focusLast.current = false;
						setOpen((value) => !value);
					},
					onKeyDown: (event) => {
						if ([
							"ArrowDown",
							"ArrowUp",
							"Enter",
							" "
						].includes(event.key) && !open) {
							event.preventDefault();
							event.stopPropagation();
							trigger.current = event.currentTarget;
							focusLast.current = event.key === "ArrowUp";
							setOpen(true);
						}
					},
					children: label
				}), layer.mounted && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: popup,
					"data-plugin": "dsh-creator-workbench",
					id,
					role: open ? "menu" : void 0,
					"aria-hidden": !open || void 0,
					"aria-label": open ? ariaLabel ?? label : void 0,
					"data-phase": layer.phase,
					"data-motion": layer.motion,
					className: "creatorMenuItems creatorControlPopup",
					onFocusCapture: (event) => {
						if (event.target instanceof HTMLElement && event.target.getAttribute("role") === "menuitem") highlightItem(event.target);
					},
					onPointerMove: (event) => {
						const item = event.target instanceof Element ? event.target.closest("[role=\"menuitem\"]:not(:disabled)") : null;
						if (item && open) highlightItem(item);
					},
					onClick: (event) => {
						if (open && event.target instanceof Element && event.target.closest("[role=\"menuitem\"]:not(:disabled)")) close();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						ref: highlight,
						className: "creatorOptionHighlight",
						"aria-hidden": "true"
					}), menuChildren(children).map((child, index) => (0, react.isValidElement)(child) ? (0, react.cloneElement)(child, {
						key: index,
						role: "menuitem",
						tabIndex: -1
					}) : child)]
				}), document.body)]
			});
		}
		//#endregion
		//#region src/client/mediaPresentation.ts
		/** Factual image identity, shared by the gallery, overview and publication picker. */
		function imageName(image) {
			return image.file.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "项目图片";
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/MediaLayout.css.mjs
		registerPluginCss("dsh-creator-workbench/MediaLayout.css", "/* This stylesheet owns media geometry; pages retain their business actions. */\n[data-plugin=\"dsh-creator-workbench\"] :is(.projectOverview,.creationPanel,.publicationWorkspace) { container-name:creator-media; container-type:inline-size; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaGrid { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; margin:12px 0; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaGrid>*,\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaCaption { min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaFrame { display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:100%; aspect-ratio:4/3; padding:8px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); cursor:zoom-in; overflow:hidden; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaFrame:hover { border-color:var(--dsw-alias-state-business-primary); background:var(--dsw-alias-interactive-bg-hover); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaFrame:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaFrame :is(.creationThumb,.overviewCover) { display:flex; align-items:center; justify-content:center; width:100%; height:100%; min-height:0; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaFrame :is(img,.creationImageThumb) { display:block; width:100%; height:100%; max-height:100%; object-fit:contain; }\n/* A neutral image canvas keeps transparent artwork legible in either theme. */\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaFrame img { background:#f1f4f8 conic-gradient(#e3eaf5 25%,transparent 0 50%,#e3eaf5 0 75%,transparent 0) 0 0/16px 16px; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaCaption { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:6px; font-size:13px; line-height:20px; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaName { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaDetails { margin:12px 0; display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px 16px; font-size:13px; line-height:1.6; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaDetails dt { color:var(--dsw-alias-label-secondary); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorMediaDetails dd { margin:0; overflow-wrap:anywhere; }\n@container creator-media (min-width:400px) { [data-plugin=\"dsh-creator-workbench\"] .creatorMediaGrid { grid-template-columns:repeat(2,minmax(0,1fr)); } }\n@container creator-media (min-width:680px) { [data-plugin=\"dsh-creator-workbench\"] .creatorMediaGrid { grid-template-columns:repeat(3,minmax(0,1fr)); } }\n");
		//#endregion
		//#region src/client/publicationReadiness.ts
		/** The button and explanation share the existing UI guards. */
		function uploadPrerequisites(input, accountId, rights, conflict) {
			const missing = [];
			if (!accountId) missing.push({
				field: "account",
				label: "连接发布账号"
			});
			if (!input.title.trim()) missing.push({
				field: "title",
				label: "填写标题"
			});
			if (input.type === "video" && !input.video) missing.push({
				field: "video",
				label: "选择视频"
			});
			if (input.type === "images" && !input.imageIds.length) missing.push({
				field: "images",
				label: "选择图片"
			});
			if (input.type === "article" && !input.body.trim()) missing.push({
				field: "body",
				label: "填写正文"
			});
			if (input.platform === "official-account" && !input.coverImageId) missing.push({
				field: "cover",
				label: "选择文章封面"
			});
			if (!rights) missing.push({
				field: "rights",
				label: "确认素材发布授权"
			});
			if (conflict) missing.push({
				field: "conflict",
				label: "处理材料版本冲突"
			});
			return missing;
		}
		//#endregion
		//#region src/client/PublicationEditorPanel.tsx
		function PublicationEditorPanel({ editor, manager, detail, api, accountId, onRemoved, getCoverImage, materialActions }) {
			const snap = (0, react.useSyncExternalStore)(editor.subscribe, editor.getSnapshot), input = snap.input, data = useProjectData(api, detail), scope = {
				id: detail.id,
				folderPath: detail.folderPath
			};
			const [error, setError] = (0, react.useState)(""), [notice, setNotice] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)(false), [rights, setRights] = (0, react.useState)(false), [tags, setTags] = (0, react.useState)(input.tags.join("，")), [picker, setPicker] = (0, react.useState)(false), [request, setRequest] = (0, react.useState)("");
			const prerequisitesId = (0, react.useId)(), fields = (0, react.useRef)(null), openSettings = useSettingsNavigation();
			const focusPrerequisite = (field) => {
				if (field === "account") {
					openSettings(input.platform === "official-account" ? "wechat" : "platforms");
					return;
				}
				if (field === "images") {
					setPicker(true);
					return;
				}
				fields.current?.querySelector(`[data-upload-field="${field}"]`)?.focus();
			};
			const tagValue = JSON.stringify(input.tags), tagBaseline = (0, react.useRef)(tagValue);
			(0, react.useEffect)(() => {
				if (tagBaseline.current !== tagValue) {
					tagBaseline.current = tagValue;
					setTags(input.tags.join("，"));
				}
			}, [tagValue]);
			const [ownedUploadNotice, setUploadNotice] = (0, react.useState)();
			const uploadNotice = ownedUploadNotice?.ownerAccountId === accountId ? ownedUploadNotice : void 0;
			const [preview, setPreview] = (0, react.useState)(), [previewBusy, setPreviewBusy] = (0, react.useState)(false);
			const alive = (0, react.useRef)(true), mutating = (0, react.useRef)(false), readTicket = (0, react.useRef)(0), previewTicket = (0, react.useRef)(0), file = (0, react.useRef)(null), images = data.state?.images?.filter((i) => !i.hidden) ?? [], lightbox = useImagePreview([...creationPreviewImages(images, detail, api), ...getCoverImage ? coverPreviewImages(data.view?.covers.versions ?? [], detail, getCoverImage) : []]);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
					readTicket.current++;
					previewTicket.current++;
				};
			}, []);
			const update = (values) => {
				const next = {
					...editor.getSnapshot().input,
					...values
				};
				if (next.type === "images") {
					if (values.coverImageId) next.imageIds = [values.coverImageId, ...next.imageIds.filter((id) => id !== values.coverImageId)];
					else if (values.imageIds && next.coverImageId) {
						if (next.imageIds[0]) next.coverImageId = next.imageIds[0];
						else delete next.coverImageId;
					}
				}
				editor.update(next);
			};
			const run = async (action) => {
				if (mutating.current) throw new Error("当前操作尚未完成。");
				mutating.current = true;
				setBusy(true);
				setError("");
				try {
					const next = await api.action(action);
					data.query.accept(next);
					return next;
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "操作未完成");
					throw e;
				} finally {
					mutating.current = false;
					if (alive.current) setBusy(false);
				}
			};
			const ask = async (kind, append = false) => {
				try {
					const saved = await editor.flush(), text = `请${kind === "多图" ? "为这份发布内容制作或修改有序多图，保留其余已确认材料" : "按我的要求改写这份平台发布文案，保留其余素材"}。发布内容：${saved.id}，版本：${saved.revision}。请先读取当前材料，保存时核对版本并使用稳定saveId；不上传或发表。`;
					setRequest(text);
					if (!api.prepareRequest) throw new Error("请在左侧项目对话提出此要求。");
					await api.prepareRequest(detail, text, append);
					if (alive.current) setNotice("请求已放入项目对话，请发送。");
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "请求未准备好");
				}
			};
			const reuseArticle = async (id) => {
				if (!id || !api.articleSource) return;
				const ticket = ++readTicket.current, before = JSON.stringify(editor.getSnapshot().input);
				setError("");
				try {
					const source = await api.articleSource({
						...scope,
						articleId: id
					});
					if (!alive.current || ticket !== readTicket.current) return;
					if (JSON.stringify(editor.getSnapshot().input) !== before) throw new Error("读取期间内容已修改，当前输入已保留，请再次选择文章。");
					update({
						title: source.article.title || input.title,
						body: publicationText(source.source, input.platform, input.type, source.article.format),
						articleId: id,
						articleFile: source.article.file,
						imageIds: [...source.article.imageIds ?? []],
						source: {
							kind: "article",
							articleId: id
						}
					});
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "文章读取失败");
				}
			};
			const makePreview = async () => {
				const ticket = ++previewTicket.current;
				setPreviewBusy(true);
				setError("");
				try {
					const saved = await editor.flush();
					const result = await api.preview({
						...scope,
						publicationId: saved.id,
						revision: saved.revision
					});
					if (alive.current && ticket === previewTicket.current) setPreview({
						html: result.html,
						revision: saved.revision
					});
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "排版预览未完成");
				} finally {
					if (alive.current && ticket === previewTicket.current) setPreviewBusy(false);
				}
			};
			(0, react.useEffect)(() => {
				if (input.type === "article" && snap.phase === "saved" && input.body.trim() && !preview && !previewBusy) makePreview();
			}, [
				snap.publicationId,
				input.articleId,
				snap.phase
			]);
			const showImage = (id, trigger, ids) => lightbox.open(creationPreviewImages(ids ? ids.map((key) => images.find((i) => i.id === key)).filter((i) => Boolean(i)) : images, detail, api, "发布图片"), id, trigger);
			const move = (index, delta) => {
				const ids = [...editor.getSnapshot().input.imageIds];
				[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
				update({ imageIds: ids });
			};
			const covers = data.view?.covers.versions.filter((v) => !v.hidden && Object.values(input.coverFiles ?? {}).includes(v.file)) ?? [];
			const prerequisites = uploadPrerequisites(input, accountId, rights, snap.phase === "conflict"), uploadReady = prerequisites.length === 0;
			const upload = async (after) => {
				try {
					const next = await editor.withSaved((saved) => run({
						...scope,
						action: "upload-publication",
						publicationId: saved.id,
						expectedRevision: saved.revision,
						originalRightsConfirmed: rights,
						...accountId ? { expectedAccountId: accountId } : {},
						...after ? { newUploadAfter: after } : {}
					}));
					if (alive.current) setUploadNotice(next.uploadNotice ? {
						...next.uploadNotice,
						ownerAccountId: accountId
					} : void 0);
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "上传未开始");
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "publicationEditor",
				"aria-label": "当前发布内容",
				ref: fields,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationEditHeading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "publicationSaveStatus",
							role: "status",
							children: [
								{
									saved: "已保存",
									pending: "本地待同步",
									saving: "保存中…",
									error: "保存失败，草稿已保留",
									conflict: "有其他修改，草稿已保留"
								}[snap.phase],
								snap.phase === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									onClick: () => void editor.flush().catch(() => void 0),
									children: "重试保存"
								}),
								snap.phase === "conflict" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => {
										manager.create({ ...input });
										setNotice("当前草稿已保留为另一份本地材料，可在材料选择区打开。");
									},
									children: "保留为另一份"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionMenu, {
							label: "材料操作",
							align: "end",
							children: [materialActions, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "ghost",
								disabled: busy,
								onClick: async () => {
									try {
										await editor.withSaved((saved) => run({
											...scope,
											action: "remove-publication",
											publicationId: saved.id,
											expectedRevision: saved.revision
										}));
										manager.remove(snap.key);
										onRemoved();
									} catch {}
								},
								children: "移除这份材料"
							})]
						})]
					}),
					snap.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorError",
						role: "alert",
						children: snap.error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "publicationGroup",
						"aria-label": "文案与素材",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "productionHeading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "文案与素材" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => void ask("文案"),
									children: "让 Agent 改文案"
								}), input.type !== "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => void ask("多图"),
									children: "制作多图"
								})] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "publicationFields",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["标题", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										"data-upload-field": "title",
										value: input.title,
										maxLength: 500,
										onChange: (e) => update({ title: e.target.value })
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["正文", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										"data-upload-field": "body",
										rows: 7,
										value: input.body,
										maxLength: 3e5,
										onChange: (e) => update({ body: e.target.value })
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["话题／标签", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: tags,
										onChange: (e) => {
											setTags(e.target.value);
											const nextTags = e.target.value.split(/[,，]/).map((v) => v.trim()).filter(Boolean);
											tagBaseline.current = JSON.stringify(nextTags);
											update({ tags: nextTags });
										}
									})] }),
									input.type === "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["本次视频", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
										"data-upload-field": "video",
										value: input.video ?? "",
										onValueChange: (value) => update({ video: value }),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: "选择视频"
										}), detail.videos?.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: v.name,
											children: v.name
										}, v.name))]
									})] }),
									input.type !== "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["复用文章内容", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
										value: input.articleId ?? "",
										onValueChange: (value) => void reuseArticle(value),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: "选择已有文章版本"
										}), data.state?.articles.map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: a.id,
											children: [
												a.title || "文章",
												" · ",
												new Date(a.createdAt).toLocaleString()
											]
										}, a.id))]
									})] }),
									input.platform === "bilibili" && input.type === "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["分区", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: input.category ?? "",
										onChange: (e) => update({ category: e.target.value })
									})] })
								]
							}),
							input.type !== "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "productionHeading",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: input.platform === "official-account" ? "正文配图" : "图片顺序" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => setPicker((v) => !v),
										children: "选择已有图片"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										disabled: busy,
										onClick: () => file.current?.click(),
										children: "导入图片"
									})] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "creatorMediaGrid",
									children: input.imageIds.map((id, index) => {
										const image = images.find((i) => i.id === id);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "publicationOrderedItem",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													className: "creatorMediaFrame",
													"aria-label": `放大第${index + 1}张图片`,
													disabled: !image,
													onClick: (e) => showImage(id, e.currentTarget, input.imageIds),
													children: image ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageThumb, {
														image,
														detail,
														api
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "图片已移除" })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "creatorMediaName",
													title: image ? imageName(image) : void 0,
													children: [
														index + 1,
														" · ",
														image ? imageName(image) : "图片已移除"
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
														tone: "ghost",
														disabled: index === 0,
														"aria-label": `第${index + 1}张上移`,
														onClick: () => move(index, -1),
														children: "上移"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
														tone: "ghost",
														disabled: index === input.imageIds.length - 1,
														"aria-label": `第${index + 1}张下移`,
														onClick: () => move(index, 1),
														children: "下移"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
														tone: "ghost",
														onClick: () => update({ imageIds: input.imageIds.filter((i) => i !== id) }),
														children: "移出"
													})
												] })
											]
										}, id);
									})
								}),
								picker && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "creatorMediaGrid",
									children: [images.filter((i) => !input.imageIds.includes(i.id)).map((i, n) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "creatorMediaFrame",
										"aria-label": `放大候选图片${n + 1}`,
										onClick: (e) => showImage(i.id, e.currentTarget),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageThumb, {
											image: i,
											detail,
											api
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => update({ imageIds: [...input.imageIds, i.id] }),
										children: "加入图集"
									})] }, i.id)), !images.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "creatorMuted",
										children: "还没有项目图片，可导入或让 Agent 制作。"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "publicationCoverField",
									children: [input.platform === "official-account" ? "文章封面" : "首图／封面", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
										"data-upload-field": "cover",
										value: input.coverImageId ?? "",
										onValueChange: (value) => update({ coverImageId: value }),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: input.platform === "official-account" ? "请选择文章封面" : "使用图集首图"
										}), images.map((i, n) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: i.id,
											children: [
												n + 1,
												" · ",
												imageName(i)
											]
										}, i.id))]
									})]
								}),
								input.coverImageId && images.some((i) => i.id === input.coverImageId) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "publicationImage publicationCover",
									"aria-label": "放大发布封面",
									onClick: (e) => showImage(input.coverImageId, e.currentTarget, [input.coverImageId]),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageThumb, {
										image: images.find((i) => i.id === input.coverImageId),
										detail,
										api
									})
								})
							] }),
							input.type === "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "productionHeading",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "本次视频封面" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => update({ coverFiles: { ...detail.covers } }),
										children: "使用项目当前封面"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "publicationImageOrder",
									children: covers.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "publicationImage",
										onClick: (e) => {
											if (getCoverImage) lightbox.open(coverPreviewImages(covers, detail, getCoverImage), v.id, e.currentTarget);
										},
										children: getCoverImage ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewCover, {
											version: v,
											detail,
											getCoverImage
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: v.ratio.replace("x", ":") })
									}, v.id))
								}),
								!covers.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "creatorMuted",
									children: "尚未选择本次视频封面"
								})
							] }),
							input.type === "article" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "publicationArticlePreview",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: previewBusy || !input.body.trim(),
									onClick: () => void makePreview(),
									children: previewBusy ? "正在排版…" : "查看排版预览"
								}), preview && (preview.revision !== snap.revision || editor.dirty) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "creatorMuted",
									children: "正文有更新，可重新预览"
								})] }), preview && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArticlePreview, {
									html: preview.html,
									title: "发布文章排版预览"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: file,
						hidden: true,
						type: "file",
						accept: "image/png,image/jpeg,image/webp",
						"aria-label": "导入发布图片",
						onChange: (e) => {
							const picked = e.currentTarget.files?.[0];
							e.currentTarget.value = "";
							if (!picked) return;
							try {
								const before = new Set(images.map((i) => i.id));
								run({
									...scope,
									action: "import-image",
									sourcePath: localFilePath(picked),
									purpose: "card"
								}).then((next) => {
									const ids = next.images?.filter((i) => !i.hidden && !before.has(i.id)).map((i) => i.id) ?? [];
									if (ids.length) update({ imageIds: [...editor.getSnapshot().input.imageIds, ...ids] });
								}).catch(() => void 0);
							} catch (e) {
								setError(e instanceof Error ? e.message : "图片选择失败");
							}
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "publicationGroup publicationSubmission",
						"aria-label": "上传",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "上传" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "publicationUploadActions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									"data-upload-field": "rights",
									type: "checkbox",
									checked: rights,
									onChange: (e) => setRights(e.target.checked)
								}), "确认本次素材拥有发布授权"] }),
								prerequisites.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									id: prerequisitesId,
									className: "publicationPrerequisites",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "还需完成" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: prerequisites.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: item.field === "conflict" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.label }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => focusPrerequisite(item.field),
										children: item.label
									}) }, item.field)) })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionBar, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "primary",
									disabled: busy || !uploadReady,
									"aria-describedby": prerequisites.length ? prerequisitesId : void 0,
									onClick: () => void upload(),
									children: "上传并准备草稿"
								}) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "creatorMuted",
									children: "最终发表请到平台核对后手动完成。"
								})
							]
						})]
					}),
					snap.publicationId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PublicationResults, {
						detail,
						api,
						edit: snap,
						accountId,
						run
					}),
					uploadNotice && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorInlineStatus",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: uploadNotice.message }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void run({
									...scope,
									action: "inspect-upload",
									taskId: uploadNotice.taskId
								}).catch(() => void 0),
								children: "检查已有上传"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void run({
									...scope,
									action: "resume-upload",
									taskId: uploadNotice.taskId
								}).catch(() => void 0),
								children: "继续已有上传"
							}),
							uploadNotice.canCreateNew && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy || !uploadReady || !rights,
								onClick: () => void upload(uploadNotice.taskId),
								children: "确认另建一份上传"
							})
						]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "creatorMuted",
						children: notice
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "creatorError",
							children: error
						}), error.includes("已有草稿") && request && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void ask("文案", true),
							children: "追加创作请求"
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/PublicationHistory.tsx
		/** Existing task and remote IDs remain readable in their original platform. */
		function PublicationHistory({ state, platform, accountId, run, openPath, folder, detail, onPublish, publishPending }) {
			const owns = (id, ownerPlatform, type) => Boolean(id && state?.publications?.some((p) => p.id === id && !p.hidden && p.platform === ownerPlatform && (!type || p.type === type)));
			const tasks = state?.tasks.filter((t) => {
				if (t.kind === "upload") return (t.platform ?? t.account?.platform ?? "official-account") === platform && !owns(t.publicationId, platform, t.publicationType);
				if (t.kind === "wechat") return platform === "official-account" && !owns(t.publicationId, platform);
				return t.kind === "metrics" && t.metricsTargets?.some((target) => target.platform === platform && !owns(target.publicationId, platform));
			}) ?? [];
			const records = state?.records?.filter((r) => r.platform === platform && !owns(r.publicationId, platform, r.type)) ?? [];
			const drafts = platform === "official-account" ? state?.drafts ?? [] : [];
			const metrics = state?.metrics.filter((m) => m.platform === platform && !records.some((r) => r.id === m.recordId) && !owns(m.publicationId, platform)) ?? [];
			const manual = Boolean(detail.selectedVideo && platform !== "official-account" && onPublish);
			if (!tasks.length && !drafts.length && !metrics.length && !records.length && !manual) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "publicationGroup",
				"aria-label": "以前的作品记录",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "以前的作品" }),
					tasks.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationResultRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t.step || t.status }),
							(t.account?.id ?? t.wechatAppId) !== accountId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "历史账号" }),
							t.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorError",
								children: t.error
							})
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionBar, { children: isActiveTask(t) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								...folder,
								action: "cancel",
								taskId: t.id
							}),
							children: "取消任务"
						}) : t.kind === "upload" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								...folder,
								action: "inspect-upload",
								taskId: t.id
							}),
							children: "检查原任务"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								...folder,
								action: "resume-upload",
								taskId: t.id
							}),
							children: "继续原任务"
						})] }) : t.receipt && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void openPath(`${folder.folderPath}/${t.receipt}`),
							children: "查看记录"
						}) })]
					}, t.id)),
					records.map((r) => {
						const metric = state?.metrics.find((m) => m.recordId === r.id && m.platform === r.platform && m.accountId === r.accountId && m.remoteId === r.remoteId);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "publicationResultRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
									r.type === "video" ? "视频" : r.type === "images" ? "图文" : "文章",
									" · ",
									r.remoteId || "原上传记录"
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									r.accountId === accountId ? "当前账号" : "历史账号",
									" · 播放／阅读 ",
									metric?.views ?? "—",
									" · 赞 ",
									metric?.likes ?? "—",
									" · 评论 ",
									metric?.comments ?? "—"
								] }),
								metric?.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "creatorError",
									children: metric.error
								})
							] }), r.remoteId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: r.accountId !== accountId,
								onClick: () => void run({
									...folder,
									action: "refresh-metrics",
									platform,
									recordId: r.id,
									...accountId ? { expectedAccountId: accountId } : {}
								}),
								children: "同步此作品"
							})]
						}, r.id);
					}),
					drafts.map((d) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationResultRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: d.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
							d.appid === accountId ? "公众号草稿已保存" : "历史账号的公众号草稿",
							" · ",
							new Date(d.updatedAt).toLocaleString()
						] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void openPath(`${folder.folderPath}/${d.submittedFile}`),
							children: "查看提交内容"
						})]
					}, d.id)),
					metrics.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationResultRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: m.remoteId }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								m.accountId === accountId ? "当前账号" : "历史账号",
								" · 阅读／播放 ",
								m.views ?? "—",
								" · 赞 ",
								m.likes ?? "—",
								" · 评论 ",
								m.comments ?? "—"
							] }),
							m.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorError",
								children: m.error
							})
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							disabled: m.accountId !== accountId,
							onClick: () => void run({
								...folder,
								action: "refresh-metrics",
								platform,
								remoteId: m.remoteId,
								...accountId ? { expectedAccountId: accountId } : {}
							}),
							children: "同步此作品"
						})]
					}, `${m.platform}:${m.accountId}:${m.recordId ?? m.remoteId}`)),
					manual && platform !== "official-account" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "creatorDisclosure",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "本期视频的手动状态" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
							"aria-label": "本期视频的手动发布状态",
							value: detail.publish?.[platform]?.status ?? "unpublished",
							disabled: publishPending === platform,
							onValueChange: (value) => onPublish?.(platform, value),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "unpublished",
									children: "未发表"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "draft",
									children: "草稿"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "published",
									children: "已发表（手动标记）"
								})
							]
						})]
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/CreationPanel.css.mjs
		registerPluginCss("dsh-creator-workbench/CreationPanel.css", "[data-plugin=\"dsh-creator-workbench\"] .creationPanel { container-type:inline-size; min-width:0; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationSection { padding:20px 0; border-top:1px solid var(--dsw-alias-border-l1); }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .body>.creationPanel>.creationSection:first-child { border-top:0; padding-top:0; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationImageThumb { width:100%; height:130px; object-fit:contain; display:block; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationImageLarge { display:block; width:100%; max-height:580px; object-fit:contain; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationPreview { margin:18px 0; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationPublicationList { display:grid; margin:12px 0; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationPublicationList>button { display:flex; flex-direction:column; text-align:left; gap:5px; color:var(--dsw-alias-label-primary); font:inherit; padding:12px; border:0; border-bottom:1px solid var(--dsw-alias-border-l1); background:transparent; cursor:pointer; min-width:0; overflow-wrap:anywhere; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationPublicationList>button:is(:hover,[aria-pressed=\"true\"]) { background:var(--dsw-alias-bg-layer-2); }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationPublicationList span { color:var(--dsw-alias-label-secondary); font-size:12px; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationPublicationEditor { padding-top:14px; min-width:0; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationOrderedImage { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationOrderedImage img { width:64px; height:80px; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationImageChoices { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationProgress { border-top:1px solid var(--dsw-alias-border-l1); padding:10px 0; overflow-wrap:anywhere; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationProgress p { margin:5px 0; }\r\n[data-plugin=\"dsh-creator-workbench\"] .creationPanel button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }\r\n\r\n[data-plugin=\"dsh-creator-workbench\"] .creationOrderedImage .creationThumb { display:block; width:64px; flex:none; }\r\n");
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/PublicationPanel.css.mjs
		registerPluginCss("dsh-creator-workbench/PublicationPanel.css", "[data-plugin=\"dsh-creator-workbench\"] .publicationWorkspace { min-width:0;container-type:inline-size; }\nhtml[style*=\"color-scheme: dark\"] [data-plugin=\"dsh-creator-workbench\"] .publicationPlatforms .platformMark[data-platform=\"douyin\"] { filter:invert(1); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPlatforms { display:flex;gap:6px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPlatforms button { display:flex;align-items:center;gap:6px;min-height:36px;flex:none;padding:6px 10px;border:1px solid transparent;border-radius:var(--creator-control-radius,12px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-weight:500;white-space:nowrap;cursor:pointer; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPlatforms button:hover { background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPlatforms button[aria-current] { color:var(--dsw-alias-state-business-primary); }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationPlatforms button,.publicationImage):focus-visible { outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationAccount { display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 0; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationAccount>div { flex:1;min-width:140px;display:flex;flex-direction:column;gap:4px; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationAccount span,.publicationSaveStatus,.publicationResultRow small) { color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationMaterialBar,.publicationReuse) { display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:0 0 16px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationMaterialBar>label { flex:1;min-width:min(100%,220px); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationMaterialBar>.creatorMenu { margin-left:auto; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationAccount strong { font-size:14px;line-height:22px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPrerequisites { font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPrerequisites ul { display:flex;flex-wrap:wrap;gap:4px 16px;margin:4px 0 0;padding-left:18px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPrerequisites button { border:0;background:transparent;padding:0;color:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationPrerequisites button:hover { text-decoration:underline; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationFields,.publicationAssociation) { display:grid;gap:14px;min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationFields,.publicationMaterialBar,.publicationReuse,.publicationAssociation) label,[data-plugin=\"dsh-creator-workbench\"] .publicationCoverField { display:flex;flex-direction:column;gap:6px;min-width:0;font-size:13px; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationFields,.publicationMaterialBar,.publicationReuse,.publicationAssociation,.publicationCoverField) :is(input,textarea) { width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--creator-control-radius,12px);padding:8px 10px;min-height:36px;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationFields textarea { resize:vertical;line-height:1.7; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationFields,.publicationMaterialBar,.publicationReuse,.publicationAssociation,.publicationCoverField) :is(input,textarea):focus-visible { outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationGroup { padding:20px 0;border-top:1px solid var(--dsw-alias-border-l1);min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationGroup h4 { margin:0 0 12px;font-size:14px;font-weight:600; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationSaveStatus { display:flex;align-items:center;gap:8px;min-height:32px;margin-bottom:8px; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationImageOrder,.publicationImagePicker) { display:flex;align-items:start;flex-wrap:wrap;gap:12px;margin:12px 0; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.publicationOrderedItem,.publicationImagePicker>div) { display:flex;flex-direction:column;gap:6px;min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationImage { display:flex;align-items:center;justify-content:center;width:120px;height:130px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:zoom-in;padding:6px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationImage:hover { border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationImage :is(img,.creationThumb,.overviewCover) { max-width:100%;max-height:100%;object-fit:contain; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationCover { margin-top:12px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationArticlePreview { margin-top:20px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationArticlePreview iframe { width:100%;height:480px;max-height:70vh;border:0;margin-top:12px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationUploadActions { padding:12px 0 20px;display:grid;gap:12px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationResultRow { display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationResultRow>div:first-child { flex:1;min-width:min(100%,160px);overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationResultRow p { margin:4px 0;font-size:13px;line-height:1.65; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationEmpty { padding:20px 0;color:var(--dsw-alias-label-secondary);line-height:1.7; }\n@container (max-width:400px) { [data-plugin=\"dsh-creator-workbench\"] .publicationReuse { align-items:stretch; } [data-plugin=\"dsh-creator-workbench\"] .publicationImage { width:104px;height:116px; } }\n\n[data-plugin=\"dsh-creator-workbench\"] .publicationEditHeading { display:flex;align-items:center;justify-content:space-between;gap:12px; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationEditHeading .publicationSaveStatus { margin:0;min-width:0;flex-wrap:wrap; }\n[data-plugin=\"dsh-creator-workbench\"] .publicationHistoryEntry { padding:16px 0;border-top:1px solid var(--dsw-alias-border-l1); }\n[data-plugin=\"dsh-creator-workbench\"] .publicationSubmission { margin-top:4px; }\n");
		//#endregion
		//#region src/client/PublicationPanel.tsx
		const platforms = [...PUBLISH_PLATFORMS, "official-account"];
		const name = (p) => p === "official-account" ? "公众号" : PUBLISH_PLATFORM_DEFINITIONS[p].name;
		const typeName = {
			video: "视频",
			images: "图文",
			article: "文章"
		};
		const managers = /* @__PURE__ */ new WeakMap();
		function localStore() {
			try {
				if (globalThis.localStorage) return globalThis.localStorage;
			} catch {}
			return {
				getItem: () => null,
				removeItem: () => void 0,
				setItem: () => {
					throw new Error("本地草稿缓存不可用");
				}
			};
		}
		function navKey(folder) {
			return `dsh-creator-workbench:publication-navigation:${folder.replaceAll("\\", "/").toLowerCase()}`;
		}
		function readNav(folder) {
			try {
				return JSON.parse(localStore()?.getItem(navKey(folder)) ?? "{}");
			} catch {
				return {};
			}
		}
		function PublicationPanel({ initialArticleId, initialPublicationId, detail, api, enabledPlatforms = [], openPath = async () => void 0, getCoverImage, onPublish, publishPending }) {
			const scope = {
				id: detail.id,
				folderPath: detail.folderPath
			}, data = useProjectData(api, scope), settings = data.settings, openSettings = useSettingsNavigation();
			const manager = (0, react.useMemo)(() => {
				let byFolder = managers.get(api);
				if (!byFolder) {
					byFolder = /* @__PURE__ */ new Map();
					managers.set(api, byFolder);
				}
				const key = detail.folderPath.replaceAll("\\", "/").toLowerCase();
				let value = byFolder.get(key);
				if (!value) {
					value = new PublicationEditors(detail.folderPath, async (action) => {
						const next = await api.action({
							...action,
							...scope
						});
						if (!next.savedPublication) throw new Error("保存回执暂不可用，请重试原保存请求。");
						setTimeout(() => {
							data.query.invalidate().catch(() => void 0);
						}, 0);
						const saved = next.publications?.find((p) => p.id === next.savedPublication.id && p.revision === next.savedPublication.revision);
						return {
							...next.savedPublication,
							...saved && saved.body !== void 0 ? { input: publicationInput(saved) } : {}
						};
					}, localStore());
					byFolder.set(key, value);
					value.resume();
				}
				return value;
			}, [api, detail.folderPath]);
			const version = (0, react.useSyncExternalStore)(manager.subscribe, manager.getSnapshot), nav = (0, react.useRef)(readNav(detail.folderPath));
			const [platform, setPlatform] = (0, react.useState)(initialArticleId ? "official-account" : nav.current.platform && platforms.includes(nav.current.platform) ? nav.current.platform : enabledPlatforms[0] ?? "xiaohongshu");
			const [selected, setSelected] = (0, react.useState)(nav.current.selected?.[platform] ?? ""), [reading, setReading] = (0, react.useState)(false), [error, setError] = (0, react.useState)(""), [settingsError, setSettingsError] = (0, react.useState)(""), [copyPlatform, setCopyPlatform] = (0, react.useState)(platform);
			const [copyOpen, setCopyOpen] = (0, react.useState)(false), [historyOpen, setHistoryOpen] = (0, react.useState)(false);
			const selectionTicket = (0, react.useRef)(0), platformRef = (0, react.useRef)(platform), alive = (0, react.useRef)(true), handledTarget = (0, react.useRef)("");
			platformRef.current = platform;
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
					selectionTicket.current++;
				};
			}, []);
			(0, react.useEffect)(() => {
				data.query.settings().catch((e) => {
					if (alive.current) setSettingsError(e instanceof Error ? e.message : "账号设置读取失败");
				});
			}, [api]);
			const all = data.state?.publications ?? [], publications = all.filter((p) => !p.hidden && p.platform === platform);
			const local = manager.list().filter((e) => e.getSnapshot().input.platform === platform && !all.some((p) => p.id === e.getSnapshot().publicationId));
			const choices = [...publications.map((p) => ({
				key: manager.forId(p.id)?.getSnapshot().key ?? p.id,
				id: p.id,
				title: manager.forId(p.id)?.getSnapshot().input.title ?? p.title,
				type: p.type
			})), ...local.map((e) => ({
				key: e.getSnapshot().key,
				title: e.getSnapshot().input.title,
				type: e.getSnapshot().input.type
			}))];
			const editor = manager.list().find((e) => e.getSnapshot().key === selected && e.getSnapshot().input.platform === platform && !all.some((p) => p.id === e.getSnapshot().publicationId && p.hidden));
			const accountId = platform === "official-account" ? settings?.wechat.appid : settings?.accounts[platform]?.id;
			const configured = platform === "official-account" ? Boolean(settings?.wechatConfigured) : Boolean(settings?.accounts[platform]);
			const choose = async (key, targetPlatform = platformRef.current) => {
				const ticket = ++selectionTicket.current;
				setError("");
				const existing = manager.list().find((e) => e.getSnapshot().key === key || e.getSnapshot().publicationId === key);
				if (existing) {
					if (existing.getSnapshot().input.platform !== targetPlatform) return;
					const current = all.find((p) => p.id === existing.getSnapshot().publicationId);
					if (existing.dirty || !current || current.revision <= (existing.getSnapshot().revision ?? 0)) {
						setSelected(existing.getSnapshot().key);
						return;
					}
				}
				const publication = all.find((p) => (p.id === key || p.id === existing?.getSnapshot().publicationId) && !p.hidden && p.platform === targetPlatform);
				if (!publication) return;
				setReading(true);
				try {
					if (!api.publication) throw new Error("此版本暂时无法读取发布正文，请重试。");
					const full = await api.publication({
						...scope,
						publicationId: publication.id,
						revision: publication.revision
					});
					if (!alive.current || ticket !== selectionTicket.current || platformRef.current !== targetPlatform) return;
					if (full.bodyError) throw new Error(full.bodyError);
					setSelected(manager.open(full).getSnapshot().key);
				} catch (e) {
					if (alive.current && ticket === selectionTicket.current) setError(e instanceof Error ? e.message : "材料读取失败");
				} finally {
					if (alive.current && ticket === selectionTicket.current) setReading(false);
				}
			};
			(0, react.useEffect)(() => {
				if (!data.state || editor || reading || error) return;
				const first = choices.find((c) => c.key === selected) || choices[0];
				if (first) choose(first.key);
			}, [
				data.state,
				platform,
				selected,
				version
			]);
			(0, react.useEffect)(() => {
				const latest = all.find((p) => p.id === editor?.getSnapshot().publicationId);
				if (editor && latest && !editor.dirty && !reading && latest.revision > (editor.getSnapshot().revision ?? 0)) choose(latest.id);
			}, [
				data.state,
				selected,
				platform,
				version
			]);
			(0, react.useEffect)(() => {
				nav.current = {
					platform,
					selected: {
						...nav.current.selected,
						...selected ? { [platform]: selected } : {}
					}
				};
				try {
					localStore()?.setItem(navKey(detail.folderPath), JSON.stringify(nav.current));
				} catch {}
			}, [platform, selected]);
			const switchPlatform = (next) => {
				selectionTicket.current++;
				platformRef.current = next;
				setPlatform(next);
				setCopyPlatform(next);
				setCopyOpen(false);
				setSelected(nav.current.selected?.[next] ?? "");
				setReading(false);
				setError("");
			};
			const fresh = (type, target = platform) => ({
				platform: target,
				type,
				title: detail.title,
				body: "",
				tags: [...detail.tags],
				imageIds: [],
				...type === "video" && detail.selectedVideo ? {
					video: detail.selectedVideo,
					coverFiles: { ...detail.covers }
				} : {}
			});
			const create = (type) => {
				selectionTicket.current++;
				setReading(false);
				setError("");
				setSelected(manager.create(fresh(type)).getSnapshot().key);
			};
			(0, react.useEffect)(() => {
				if (!data.state) return;
				const target = initialPublicationId ? `publication:${initialPublicationId}` : initialArticleId ? `article:${initialArticleId}` : "";
				if (!target || handledTarget.current === target) return;
				handledTarget.current = target;
				if (initialPublicationId) {
					const p = all.find((p) => p.id === initialPublicationId && !p.hidden);
					if (p) {
						switchPlatform(p.platform);
						choose(p.id, p.platform);
					}
					return;
				}
				if (initialArticleId) {
					switchPlatform("official-account");
					const previous = all.find((p) => !p.hidden && p.platform === "official-account" && p.articleId === initialArticleId);
					if (previous) {
						choose(previous.id, "official-account");
						return;
					}
					const ticket = ++selectionTicket.current;
					api.articleSource?.({
						...scope,
						articleId: initialArticleId
					}).then((source) => {
						if (!alive.current || ticket !== selectionTicket.current || platformRef.current !== "official-account") return;
						setSelected(manager.create({
							...fresh("article", "official-account"),
							title: source.article.title || detail.title,
							body: source.source,
							articleId: source.article.id,
							articleFile: source.article.file,
							imageIds: [...source.article.imageIds ?? []],
							source: {
								kind: "article",
								articleId: source.article.id
							}
						}).getSnapshot().key);
					}, (e) => {
						if (alive.current) setError(e instanceof Error ? e.message : "文章读取失败");
					});
				}
			}, [
				data.state,
				initialArticleId,
				initialPublicationId
			]);
			const duplicate = () => {
				if (!editor) return;
				const source = editor.getSnapshot().input;
				let type = source.type;
				if (copyPlatform === "official-account") type = "article";
				else if (copyPlatform === "wechat") type = "video";
				else if (type === "article" && copyPlatform !== "bilibili") type = "images";
				const copied = {
					...structuredClone(source),
					platform: copyPlatform,
					type,
					body: publicationText(source.body, copyPlatform, type)
				};
				switchPlatform(copyPlatform);
				setSelected(manager.create(copied).getSnapshot().key);
			};
			const historyRun = async (action) => {
				try {
					const next = await api.action(action);
					data.query.accept(next);
					return next;
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "操作未完成");
					return;
				}
			};
			const materialActions = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				platform !== "official-account" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					tone: "ghost",
					onClick: () => create("video"),
					children: "新建视频材料"
				}),
				!["official-account", "wechat"].includes(platform) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					tone: "ghost",
					onClick: () => create("images"),
					children: "新建图文材料"
				}),
				["official-account", "bilibili"].includes(platform) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					tone: "ghost",
					onClick: () => create("article"),
					children: "新建文章材料"
				}),
				editor && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					tone: "ghost",
					onClick: () => setCopyOpen(true),
					children: "复制到其他平台"
				})
			] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "publicationWorkspace",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectionRail, {
						selected: platform,
						className: "publicationPlatforms",
						"aria-label": "发布平台",
						children: platforms.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"aria-current": platform === p ? "page" : void 0,
							onClick: () => switchPlatform(p),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlatformMark, {
								id: p === "official-account" ? "article" : PUBLISH_PLATFORM_DEFINITIONS[p].icon,
								size: 20
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: name(p) })]
						}, p))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationAccount",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "发布账号" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: settingsError ? "账号信息读取失败" : !settings ? "正在读取账号…" : platform === "official-account" ? settings.wechat.appid ? `账号 ${settings.wechat.appid}${configured ? "" : " · 凭据未配置"}` : "尚未配置公众号" : settings.accounts[platform] ? `${settings.accounts[platform].name}${enabledPlatforms.includes(platform) ? "" : " · 平台未启用"}` : "尚未连接账号" })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "ghost",
								onClick: () => openSettings(platform === "official-account" ? "wechat" : "platforms"),
								children: "账号设置"
							}),
							settingsError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => {
									setSettingsError("");
									data.query.settings().catch((e) => setSettingsError(e.message));
								},
								children: "重新读取"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationMaterialBar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["发布内容", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
							"aria-label": "选择发布内容",
							value: editor?.getSnapshot().key ?? "",
							onValueChange: (value) => void choose(value),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: reading ? "正在读取…" : choices.length ? "请选择内容" : "还没有发布内容"
							}), choices.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: c.key,
								children: [
									c.title || "未命名内容",
									" · ",
									typeName[c.type]
								]
							}, c.key))]
						})] }), !editor && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionMenu, {
							label: "新建发布内容",
							align: "end",
							children: materialActions
						})]
					}),
					editor && copyOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "publicationReuse",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["复制到", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreatorSelect, {
								value: copyPlatform,
								onValueChange: (value) => setCopyPlatform(value),
								children: platforms.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: p,
									children: name(p)
								}, p))
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: duplicate,
								children: "创建副本"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "ghost",
								onClick: () => setCopyOpen(false),
								children: "取消"
							})
						]
					}),
					editor ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PublicationEditorPanel, {
						editor,
						materialActions,
						manager,
						detail,
						api,
						accountId: configured && (platform === "official-account" || enabledPlatforms.includes(platform)) ? accountId : void 0,
						onRemoved: () => setSelected(""),
						...getCoverImage ? { getCoverImage } : {}
					}, editor.getSnapshot().key) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "publicationEmpty",
						children: reading ? "正在读取内容…" : "选择已有内容，或另建一份发布材料。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "publicationHistoryEntry",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							tone: "ghost",
							"aria-expanded": historyOpen,
							onClick: () => setHistoryOpen((value) => !value),
							children: historyOpen ? "收起作品记录" : "作品记录"
						})
					}),
					historyOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PublicationHistory, {
						...data.state ? { state: data.state } : {},
						platform,
						...accountId ? { accountId } : {},
						run: historyRun,
						openPath,
						folder: scope,
						detail,
						...onPublish ? { onPublish } : {},
						...publishPending ? { publishPending } : {}
					}),
					(error || data.error) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "creatorError",
							children: error || data.error
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => {
								setError("");
								data.query.retry().catch(() => void 0);
							},
							children: "重新读取内容"
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/ui/SectionPanel.tsx
		/** Expands inside the owning business section; never covers native navigation/chat. */
		function SectionPanel({ title, children, onClose, returnFocus }) {
			const root = (0, react.useRef)(null);
			const returnTarget = (0, react.useRef)(returnFocus);
			returnTarget.current = returnFocus;
			(0, react.useEffect)(() => {
				const origin = document.activeElement;
				root.current?.focus({ preventScroll: true });
				return () => {
					(returnTarget.current?.() ?? (origin?.isConnected ? origin : null))?.focus({ preventScroll: true });
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "creatorSectionPanel",
				role: "region",
				"aria-label": title,
				ref: root,
				tabIndex: -1,
				onKeyDown: (e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						onClose();
					}
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "creatorSectionHeading",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						tone: "ghost",
						onClick: onClose,
						children: "返回"
					})]
				}), children]
			});
		}
		//#endregion
		//#region src/client/ImageLibraryPanel.tsx
		const imageStatus = {
			pending: "等待制作",
			running: "正在制作",
			completed: "已保存",
			failed: "未完成",
			cancelled: "已取消",
			unconfirmed: "结果待核对"
		};
		function ImageLibraryPanel({ detail, api }) {
			const data = useProjectData(api, detail), scope = {
				id: detail.id,
				folderPath: detail.folderPath
			};
			const [error, setError] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)(false), [notice, setNotice] = (0, react.useState)(""), [acknowledge, setAcknowledge] = (0, react.useState)(false), [request, setRequest] = (0, react.useState)("");
			const file = (0, react.useRef)(null), alive = (0, react.useRef)(true), mutation = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			const [inspecting, setInspecting] = (0, react.useState)();
			const root = (0, react.useRef)(null), detailOrigin = (0, react.useRef)();
			const inspect = (id) => {
				const host = root.current?.closest("[role=\"tabpanel\"]");
				if (host) detailOrigin.current = {
					host,
					scrollTop: host.scrollTop
				};
				setInspecting(id);
			};
			const closeDetails = () => {
				setInspecting(void 0);
				const origin = detailOrigin.current;
				if (origin?.host.isConnected) origin.host.scrollTop = origin.scrollTop;
				detailOrigin.current = void 0;
			};
			(0, react.useEffect)(() => {
				if (!inspecting) return;
				const panel = root.current?.querySelector(".creatorSectionPanel"), host = detailOrigin.current?.host;
				if (!panel || !host) return;
				const bounds = panel.getBoundingClientRect(), viewport = host.getBoundingClientRect();
				if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) host.scrollTop += bounds.top - viewport.top - 12;
			}, [inspecting]);
			const images = data.state?.images?.filter((i) => !i.hidden) ?? [];
			const previews = creationPreviewImages(images, detail, api), preview = useImagePreview(previews);
			const run = async (action) => {
				if (mutation.current) return;
				mutation.current = true;
				setBusy(true);
				setError("");
				try {
					const state = await api.action(action);
					data.query.accept(state);
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "操作未完成");
				} finally {
					mutation.current = false;
					if (alive.current) setBusy(false);
				}
			};
			const ask = async (append = false) => {
				const text = "请按本项目选题和我的要求制作配图或封面，使用已配置的生图服务，保存并登记图片；完成后查看实际图片检查结果。";
				setRequest(text);
				setError("");
				try {
					if (!api.prepareRequest) throw new Error("请在项目对话提出图片制作要求。");
					await api.prepareRequest(detail, text, append);
					setNotice("请求已放入项目对话，请发送。");
				} catch (e) {
					setError(e instanceof Error ? e.message : "请求未准备好");
				}
			};
			const tasks = data.state?.tasks.filter((t) => t.kind === "images" && (isActiveTask(t) || ["failed", "unconfirmed"].includes(t.status))) ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: root,
				className: "creationPanel",
				"aria-label": "项目图片",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "productionHeading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "项目图片" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void ask(),
							children: "让 Agent 制作图片"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							disabled: busy,
							onClick: () => file.current?.click(),
							children: "导入图片"
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: file,
						hidden: true,
						type: "file",
						accept: "image/png,image/jpeg,image/webp",
						"aria-label": "导入项目图片",
						onChange: (e) => {
							const selected = e.currentTarget.files?.[0];
							e.currentTarget.value = "";
							if (selected) try {
								run({
									...scope,
									action: "import-image",
									sourcePath: localFilePath(selected),
									purpose: "illustration"
								});
							} catch (e) {
								setError(e instanceof Error ? e.message : "文件选择失败");
							}
						}
					}),
					!images.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorMuted",
						children: "还没有图片"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "creatorMediaGrid",
						children: images.map((image) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "creatorMediaFrame",
							"aria-label": `预览图片：${imageName(image)}`,
							onClick: (e) => preview.open(previews, image.id, e.currentTarget),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageThumb, {
								image,
								detail,
								api
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "creatorMediaCaption",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "creatorMediaName",
								title: imageName(image),
								children: imageName(image)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionMenu, {
								label: "更多",
								ariaLabel: `图片操作：${imageName(image)}`,
								align: "end",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									onClick: () => inspect(image.id),
									children: "查看详情"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									disabled: busy,
									onClick: () => void run({
										...scope,
										action: "remove-image",
										imageId: image.id
									}),
									children: "移除图片"
								})]
							})]
						})] }, image.id))
					}),
					inspecting && images.find((i) => i.id === inspecting) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionPanel, {
						title: "图片详情",
						onClose: closeDetails,
						children: images.filter((i) => i.id === inspecting).map((i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: "creatorMediaDetails",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "名称" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: imageName(i) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "尺寸" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
									i.width,
									" × ",
									i.height
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "来源" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: i.source === "imported" ? "导入图片" : "AI 制作" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "文件" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: i.file })
							]
						}, i.id))
					}),
					tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creationProgress",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: task.step ?? "图片制作" }),
							task.imageItems?.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								"第 ",
								index + 1,
								" 张 · ",
								item.error ?? imageStatus[item.status],
								[
									"failed",
									"cancelled",
									"unconfirmed"
								].includes(item.status) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: busy || item.status === "unconfirmed" && !acknowledge,
									onClick: () => void run({
										...scope,
										action: "retry-images",
										taskId: task.id,
										itemIds: [item.id],
										acknowledgeUnknown: acknowledge
									}),
									children: "重试此图"
								})
							] }, item.id)),
							isActiveTask(task) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void run({
									...scope,
									action: "cancel",
									taskId: task.id
								}),
								children: "取消制作"
							}),
							task.status === "unconfirmed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: acknowledge,
								onChange: (e) => setAcknowledge(e.target.checked)
							}), "已核对上次结果，确认重试"] })
						]
					}, task.id)),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "creatorMuted",
						children: notice
					}),
					(error || data.error) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "alert",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorError",
								children: error || data.error
							}),
							error.includes("已有草稿") && request && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void ask(true),
								children: "追加创作请求"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void data.query.retry().catch(() => void 0),
								children: "重新读取"
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ProjectPages.css.mjs
		registerPluginCss("dsh-creator-workbench/ProjectPages.css", "[data-plugin=\"dsh-creator-workbench\"] .projectOverview { padding:4px 0 20px; }\n[data-plugin=\"dsh-creator-workbench\"] .projectSummaryRow { display:grid; grid-template-columns:58px minmax(0,1fr) 12px; gap:14px; align-items:center; width:100%; min-height:72px; padding:18px 4px; text-align:left; color:var(--dsw-alias-label-primary); background:transparent; border:0; border-bottom:1px solid var(--dsw-alias-border-l1); font:inherit; cursor:pointer; }\n[data-plugin=\"dsh-creator-workbench\"] .projectSummaryRow strong { font-size:14px; font-weight:600; }\n[data-plugin=\"dsh-creator-workbench\"] .projectSummaryRow span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-secondary); font-size:13px; }\n[data-plugin=\"dsh-creator-workbench\"] .projectSummaryRow:hover { background:var(--dsw-alias-interactive-bg-hover); }\n[data-plugin=\"dsh-creator-workbench\"] .projectSummaryRow:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:-2px; }\n[data-plugin=\"dsh-creator-workbench\"] .projectTaskLink { margin-top:18px; padding:8px 0; border:0; background:transparent; color:var(--dsw-alias-state-business-primary); font:inherit; text-align:left; cursor:pointer; overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .articleWorkspace { min-width:0; min-height:0; height:100%; display:flex; flex-direction:column; gap:14px; }\n[data-plugin=\"dsh-creator-workbench\"] .articleToolbar { display:flex;flex:none;flex-wrap:wrap;gap:8px;align-items:center; }\n[data-plugin=\"dsh-creator-workbench\"] .articleCurrentToolbar { padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1); }\n[data-plugin=\"dsh-creator-workbench\"] .articleCurrentActions { display:flex;flex:1 1 auto;min-width:0;align-items:center;flex-wrap:wrap;gap:8px; }\n[data-plugin=\"dsh-creator-workbench\"] .articleCurrentActions>.creatorMenu { margin-left:auto; }\n[data-plugin=\"dsh-creator-workbench\"] .articleMode { display:flex;gap:4px; }\n[data-plugin=\"dsh-creator-workbench\"] .articleToolbar>label { display:flex; align-items:center; gap:8px; min-width:0; max-width:100%; flex:1 1 220px; }\n[data-plugin=\"dsh-creator-workbench\"] .articleSourceEditor { box-sizing:border-box; width:100%; min-height:240px; flex:1; resize:vertical; padding:14px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l1); border-radius:6px; font:inherit; font-size:14px; line-height:1.7; tab-size:2; }\n[data-plugin=\"dsh-creator-workbench\"] .articleWorkspace>section[aria-label=\"文章成品\"] { flex:1; min-height:240px; }\n[data-plugin=\"dsh-creator-workbench\"] .articleWorkspace iframe { box-sizing:border-box; display:block; width:100%; height:100%; min-height:240px; background:white; border:0; }\n[data-plugin=\"dsh-creator-workbench\"] .articleSaveStatus { min-height:20px; margin:0; color:var(--dsw-alias-label-secondary); font-size:13px; }\n\n[data-plugin=\"dsh-creator-workbench\"] .overviewSection { padding:20px 0; border-bottom:1px solid var(--dsw-alias-border-l1); min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewSection:first-child { padding-top:0; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewHeading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewHeading h3 { margin:0; font-size:14px; font-weight:600; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewSection h4 { margin:0 0 8px; font-size:14px; line-height:1.6; font-weight:500; overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewExcerpt { margin:0; line-height:1.75; font-size:13px; white-space:pre-line; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:4; overflow:hidden; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewCaption { margin:8px 0 0; color:var(--dsw-alias-label-secondary); font-size:12px; overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewVideo { display:block; width:100%; max-height:280px; aspect-ratio:16/9; background:var(--dsw-alias-bg-overlay); border-radius:6px; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewArticleWithImage { display:grid; grid-template-columns:minmax(150px,34%) minmax(0,1fr); gap:16px; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewPublication { display:grid; grid-template-columns:22px minmax(0,1fr) auto; align-items:center; gap:12px; padding:12px 0; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewPublication h4 { margin-bottom:4px; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewPublication p { margin:0; font-size:12px; line-height:1.6; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] { position:relative; }\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] { container-type:inline-size; }\n@container (max-width:420px) { [data-plugin=\"dsh-creator-workbench\"] .articleToolbar>label { flex-basis:100%; } }\n\n[data-plugin=\"dsh-creator-workbench\"] .overviewEmpty { padding:12px 0; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewEmpty .overviewHeading { margin-bottom:0; }\n[data-plugin=\"dsh-creator-workbench\"] .overviewCoverGroup { margin-top:20px; }\n@container creator-media (max-width:399px) { [data-plugin=\"dsh-creator-workbench\"] .overviewArticleWithImage { grid-template-columns:minmax(0,1fr); } }\n");
		//#endregion
		//#region src/client/ArticlePanel.tsx
		const drafts = /* @__PURE__ */ new Map();
		const selections = /* @__PURE__ */ new Map();
		const draftKey = (folder, id) => `dsh-creator-workbench:article-draft:${globalThis.location?.origin ?? "local"}:${folder.replace(/\\/g, "/")}:${id}`;
		function cachedDraft(folder, id) {
			try {
				const cached = drafts.get(draftKey(folder, id));
				if (cached) return cached;
				const raw = sessionStorage.getItem(draftKey(folder, id));
				if (!raw) return;
				const value = JSON.parse(raw);
				return value && typeof value.text === "string" && typeof value.base?.sourceHash === "string" ? value : void 0;
			} catch {
				return;
			}
		}
		function persistDraft(folder, id, value) {
			const key = draftKey(folder, id);
			drafts.set(key, value);
			try {
				sessionStorage.setItem(key, JSON.stringify(value));
			} catch {}
		}
		function ArticlePanel({ initialArticleId, detail, api, goPublish, openPath }) {
			const data = useProjectData(api, detail), scope = {
				id: detail.id,
				folderPath: detail.folderPath
			};
			const [selected, setSelected] = (0, react.useState)(initialArticleId ?? selections.get(detail.folderPath) ?? ""), [base, setBase] = (0, react.useState)(), [text, setText] = (0, react.useState)(""), [editing, setEditing] = (0, react.useState)(false), [mode, setMode] = (0, react.useState)("source");
			const [incoming, setIncoming] = (0, react.useState)(), [readRetry, setReadRetry] = (0, react.useState)(0);
			const [preview, setPreview] = (0, react.useState)(), [error, setError] = (0, react.useState)(""), [notice, setNotice] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)(false), [switchTo, setSwitchTo] = (0, react.useState)();
			const file = (0, react.useRef)(null), alive = (0, react.useRef)(true), readTicket = (0, react.useRef)(0), editEpoch = (0, react.useRef)(0), previewTicket = (0, react.useRef)(0), saving = (0, react.useRef)(false), pendingSave = (0, react.useRef)();
			const selectedRef = (0, react.useRef)(selected);
			selectedRef.current = selected;
			const baseRef = (0, react.useRef)(base);
			baseRef.current = base;
			const textRef = (0, react.useRef)(text);
			textRef.current = text;
			const versions = data.state?.articles ?? [], dirty = Boolean(base && text !== base.source);
			(0, react.useEffect)(() => {
				if (selected) selections.set(detail.folderPath, selected);
			}, [selected, detail.folderPath]);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
					readTicket.current++;
					previewTicket.current++;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!selected && data.state) {
					const id = versions.at(-1)?.id ?? (detail.articlePath ? "legacy" : "");
					if (id) {
						setSelected(id);
						selections.set(detail.folderPath, id);
					}
				}
			}, [
				versions,
				detail.articlePath,
				selected,
				data.state
			]);
			const makePreview = async (source, value) => {
				const ticket = ++previewTicket.current;
				setError("");
				try {
					const result = api.articlePreview ? await api.articlePreview({
						...scope,
						articleId: source.article.id,
						expectedSourceHash: source.sourceHash,
						source: value
					}) : await api.preview({
						...scope,
						articleFile: source.article.file
					});
					if (alive.current && ticket === previewTicket.current) setPreview(result);
				} catch (e) {
					if (alive.current && ticket === previewTicket.current) setError(e instanceof Error ? e.message : "排版未完成");
				}
			};
			(0, react.useEffect)(() => {
				if (!selected || !api.articleSource || baseRef.current?.article.id === selected) return;
				const ticket = ++readTicket.current, epoch = editEpoch.current;
				setError("");
				api.articleSource({
					...scope,
					articleId: selected
				}).then((source) => {
					if (!alive.current || ticket !== readTicket.current || epoch !== editEpoch.current) return;
					const draft = cachedDraft(detail.folderPath, selected), restored = draft?.base ?? source, value = draft?.text ?? source.source;
					pendingSave.current = draft?.pending;
					setBase(restored);
					setText(value);
					setEditing(Boolean(draft && (value !== restored.source || draft.pending)));
					if (draft && draft.base.sourceHash !== source.sourceHash) setError("来源文章已被修改，当前草稿已保留。请核对后重新读取。");
					setMode("source");
					setPreview(void 0);
					setNotice(draft?.pending ? "上次保存结果待核对，可重试原保存" : "");
					editEpoch.current++;
					if (!draft || draft.base.sourceHash === source.sourceHash) makePreview(restored, value);
				}, (e) => {
					if (alive.current && ticket === readTicket.current) setError(e.message);
				});
				return () => {
					readTicket.current++;
				};
			}, [
				selected,
				detail.folderPath,
				api,
				readRetry
			]);
			(0, react.useEffect)(() => {
				if (!base) return;
				const key = draftKey(detail.folderPath, base.article.id);
				const cache = {
					text,
					base,
					...pendingSave.current ? { pending: pendingSave.current } : {}
				};
				if (dirty || pendingSave.current) drafts.set(key, cache);
				else drafts.delete(key);
				try {
					if (dirty || pendingSave.current) sessionStorage.setItem(key, JSON.stringify(cache));
					else sessionStorage.removeItem(key);
				} catch {
					if (dirty) setNotice("修改保留在当前应用中，请及时保存。");
				}
			}, [
				text,
				base,
				dirty,
				detail.folderPath
			]);
			const agentRequest = (0, react.useRef)("write");
			const themeRevision = (0, react.useRef)();
			(0, react.useEffect)(() => {
				const revision = data.view?.settingsRevision;
				if (themeRevision.current && revision && themeRevision.current !== revision && base && !dirty) makePreview(base, text);
				themeRevision.current = revision;
			}, [data.view?.settingsRevision]);
			const select = (id) => {
				if (id === selected) return;
				if (dirty) {
					setSwitchTo(id);
					return;
				}
				switchVersion(id);
			};
			const switchVersion = (id) => {
				readTicket.current++;
				previewTicket.current++;
				setBase(void 0);
				baseRef.current = void 0;
				setPreview(void 0);
				selectedRef.current = id;
				setSelected(id);
				selections.set(detail.folderPath, id);
				setSwitchTo(void 0);
				setIncoming(void 0);
			};
			const discard = () => {
				if (base) {
					const key = draftKey(detail.folderPath, base.article.id);
					drafts.delete(key);
					try {
						sessionStorage.removeItem(key);
					} catch {}
				}
				if (switchTo) switchVersion(switchTo);
			};
			const save = async () => {
				if (!base || !api.articleSave || saving.current) return false;
				const epoch = editEpoch.current, target = selected, value = text;
				const key = JSON.stringify([
					base.article.id,
					base.sourceHash,
					value
				]);
				if (pendingSave.current?.rejected && pendingSave.current.key !== key) pendingSave.current = void 0;
				if (!pendingSave.current) {
					const id = crypto.randomUUID();
					pendingSave.current = {
						key,
						id,
						request: {
							...scope,
							articleId: base.article.id,
							expectedSourceHash: base.sourceHash,
							source: value,
							saveId: id
						}
					};
				}
				const operation = pendingSave.current;
				persistDraft(detail.folderPath, base.article.id, {
					text,
					base,
					pending: operation
				});
				saving.current = true;
				setBusy(true);
				setError("");
				try {
					const saved = await api.articleSave(operation.request);
					data.query.invalidate().catch(() => {
						if (alive.current) setNotice("正文已保存，列表刷新未完成，可稍后重新读取");
					});
					if (!alive.current || selectedRef.current !== target) return false;
					const same = epoch === editEpoch.current && value === operation.request.source;
					if (same) {
						const cacheKey = draftKey(detail.folderPath, base.article.id);
						drafts.delete(cacheKey);
						try {
							sessionStorage.removeItem(cacheKey);
						} catch {}
						selectedRef.current = saved.article.id;
						selections.set(detail.folderPath, saved.article.id);
						setSelected(saved.article.id);
						baseRef.current = saved;
						setBase(saved);
						setText(saved.source);
						setEditing(false);
						setPreview(saved.preview);
						pendingSave.current = void 0;
					}
					if (!same) {
						pendingSave.current = void 0;
						persistDraft(detail.folderPath, base.article.id, {
							text: textRef.current,
							base: baseRef.current ?? base
						});
					}
					setNotice(same ? saved.previewError ? "正文已保存，预览未完成" : "已保存新版本" : "上一版已保存，当前修改仍未保存");
					if (saved.previewError) setError(saved.previewError);
					return same;
				} catch (e) {
					if (e?.remoteResponse) {
						operation.rejected = true;
						const latest = cachedDraft(detail.folderPath, base.article.id);
						if (latest?.pending?.id === operation.id) persistDraft(detail.folderPath, base.article.id, {
							...latest,
							pending: operation
						});
					}
					if (alive.current && selectedRef.current === target) setError(e instanceof Error ? e.message : "保存结果暂未确认，输入和原保存请求已保留");
					return false;
				} finally {
					saving.current = false;
					if (alive.current) setBusy(false);
				}
			};
			const ask = async (video = false, append = false) => {
				agentRequest.current = "write";
				try {
					if (video && api.prepareRequest) await api.prepareRequest(detail, `请将当前视频《${detail.selectedVideo}》转成文章。使用真实转写与画面，通过 WeWrite 写作和排版，保存到本项目。`, append);
					else await api.prepareArticleDraft(detail, append);
					setNotice("请求已放入项目对话，请发送。");
				} catch (e) {
					setError(e instanceof Error ? e.message : "请求未准备好");
				}
			};
			const askEdit = async (append = false) => {
				agentRequest.current = "edit";
				try {
					if (!base || !api.prepareRequest) throw new Error("请在项目对话提出文章修改要求。");
					await api.prepareRequest(detail, `请精简修改本项目文章《${base.article.title ?? "文章"}》，保留事实、图片和主要内容。先调用 creator_read_article_source 读取文章 ${base.article.id}，使用返回的 sourceHash 调用 creator_save_article_revision 保存新版本。保留原版本，不改平台发布材料，不上传或发表。`, append);
					setNotice("修改请求已放入项目对话，请发送。");
				} catch (e) {
					setError(e instanceof Error ? e.message : "修改请求未准备好");
				}
			};
			const inspectLatest = async () => {
				const target = selected;
				try {
					if (!api.articleSource) return;
					const latest = await api.articleSource({
						...scope,
						articleId: target
					});
					if (alive.current && selectedRef.current === target) setIncoming(latest);
				} catch (e) {
					if (alive.current) setError(e instanceof Error ? e.message : "来源读取失败");
				}
			};
			const acceptLatest = (keepDraft) => {
				if (!incoming) return;
				previewTicket.current++;
				editEpoch.current++;
				baseRef.current = incoming;
				setBase(incoming);
				if (!keepDraft) setText(incoming.source);
				setIncoming(void 0);
				setError("");
				setNotice(keepDraft ? "已核对最新来源，当前文稿保留；请保存新版本" : "已采用最新文稿");
				setEditing(keepDraft);
				setMode("source");
				pendingSave.current = void 0;
			};
			const articleTasks = data.state?.tasks.filter((task) => task.kind === "article") ?? [];
			const currentTask = [...articleTasks].reverse().find((task) => [
				"queued",
				"running",
				"waiting-agent"
			].includes(task.status)) ?? articleTasks.filter((task) => [
				"blocked",
				"failed",
				"unconfirmed"
			].includes(task.status)).at(-1);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "articleWorkspace",
				"aria-label": "文章",
				children: [
					!selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "articleToolbar",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionMenu, {
							label: "新建文章",
							tone: "primary",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									onClick: () => void ask(),
									children: "让 Agent 写文章"
								}),
								detail.selectedVideo && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									onClick: () => void ask(true),
									children: "视频转文章"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									disabled: busy,
									onClick: () => file.current?.click(),
									children: "导入文章"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						hidden: true,
						ref: file,
						type: "file",
						accept: ".md,.html,.htm",
						"aria-label": "导入文章",
						onChange: (e) => {
							const selectedFile = e.currentTarget.files?.[0];
							e.currentTarget.value = "";
							if (selectedFile) try {
								api.action({
									...scope,
									action: "import-article",
									sourcePath: localFilePath(selectedFile)
								}).then((state) => {
									data.query.accept(state);
									const id = state.articles.at(-1)?.id;
									if (id) select(id);
								}, (e) => setError(e.message));
							} catch (e) {
								setError(e instanceof Error ? e.message : "文件选择失败");
							}
						}
					}),
					selected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "articleToolbar articleCurrentToolbar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["当前文章", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
							"aria-label": "文章版本",
							value: selected,
							onValueChange: (value) => select(value),
							children: [
								selected === "legacy" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "legacy",
									children: "已有文章"
								}),
								base && base.article.id !== "legacy" && !versions.some((v) => v.id === base.article.id) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: base.article.id,
									children: base.article.title ?? "已保存版本"
								}),
								versions.map((version) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: version.id,
									children: [
										version.title ?? "文章",
										" · ",
										new Date(version.createdAt).toLocaleString()
									]
								}, version.id))
							]
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "articleCurrentActions",
							children: [
								base && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => {
											setEditing(true);
											setMode("source");
										},
										children: "编辑"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: "ghost",
										disabled: busy || dirty,
										title: dirty ? "保存后可让 Agent 修改" : void 0,
										onClick: () => void askEdit(),
										children: "让 Agent 修改"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: editing ? "secondary" : "primary",
										disabled: busy,
										onClick: () => {
											if (dirty) save().then((ok) => {
												if (ok) goPublish(selectedRef.current);
											});
											else goPublish(base.article.id);
										},
										children: dirty ? "保存后去发布" : "去发布"
									})
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionMenu, {
									label: "新建文章",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
											tone: "ghost",
											onClick: () => void ask(),
											children: "让 Agent 写新文章"
										}),
										detail.selectedVideo && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
											tone: "ghost",
											onClick: () => void ask(true),
											children: "视频转文章"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
											tone: "ghost",
											disabled: busy,
											onClick: () => file.current?.click(),
											children: "导入文章"
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionMenu, {
									label: "更多",
									align: "end",
									children: preview && openPath && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: "ghost",
										onClick: () => void openPath(preview.path).catch((e) => setError(e.message)),
										children: "打开 HTML 成品"
									})
								})
							]
						})]
					}),
					!selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorMuted",
						children: "还没有文章"
					}),
					switchTo && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorInlineStatus",
						children: ["当前修改尚未保存", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy,
								onClick: () => void save().then((ok) => {
									if (ok) switchVersion(switchTo);
								}),
								children: "保存并切换"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: discard,
								children: "放弃修改"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => setSwitchTo(void 0),
								children: "继续编辑"
							})
						] })]
					}),
					editing && base && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "articleToolbar articleEditToolbar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SelectionRail, {
								as: "div",
								selected: mode,
								className: "articleMode",
								role: "group",
								"aria-label": "文章显示方式",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									"aria-pressed": mode === "source",
									onClick: () => setMode("source"),
									children: "文稿"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									"aria-pressed": mode === "preview",
									onClick: () => {
										setMode("preview");
										makePreview(base, text);
									},
									children: "预览"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy || !dirty && !pendingSave.current,
								tone: dirty || pendingSave.current ? "primary" : "secondary",
								onClick: () => void save(),
								children: busy ? "保存中…" : pendingSave.current ? "重试保存" : "保存新版本"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "creatorMuted",
								children: base.article.format === "html" ? "HTML" : "Markdown"
							})
						]
					}), mode === "source" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "articleSourceEditor",
						"aria-label": "文章源稿",
						value: text,
						onChange: (e) => {
							editEpoch.current++;
							previewTicket.current++;
							setText(e.target.value);
							if (base) persistDraft(detail.folderPath, base.article.id, {
								text: e.target.value,
								base,
								...pendingSave.current ? { pending: pendingSave.current } : {}
							});
							setError("");
						}
					})] }),
					(!editing || mode === "preview") && base && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
						"aria-label": "文章成品",
						children: preview ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArticlePreview, { html: preview.html }) : !error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							className: "creatorMuted",
							children: "正在排版…"
						})
					}),
					currentTask && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorInlineStatus",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [currentTask.step ?? (currentTask.status === "waiting-agent" ? "请求已交给对话" : "文章制作"), currentTask.error ? ` · ${currentTask.error}` : ""] }), [
							"queued",
							"running",
							"waiting-agent"
						].includes(currentTask.status) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void api.action({
								...scope,
								action: "cancel",
								taskId: currentTask.id
							}).then((state) => data.query.accept(state), (e) => setError(e.message)),
							children: "取消制作"
						})]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "articleSaveStatus",
						children: notice
					}),
					incoming && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						"aria-label": "核对最新来源",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "最新来源" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "articleSourceEditor",
								readOnly: true,
								"aria-label": "最新来源文稿",
								value: incoming.source
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => acceptLatest(true),
									children: "保留我的文稿"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => acceptLatest(false),
									children: "采用最新文稿"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => setIncoming(void 0),
									children: "继续编辑"
								})
							] })
						]
					}),
					(error || data.error) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "alert",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorError",
								children: error || data.error
							}),
							base && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void makePreview(base, text),
								children: "重试预览"
							}),
							base && error.includes("来源") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void inspectLatest(),
								children: "核对最新来源"
							}),
							!base && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => setReadRetry((n) => n + 1),
								children: "重新读取"
							}),
							error.includes("已有草稿") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => void (agentRequest.current === "edit" ? askEdit(true) : ask(false, true)),
								children: "追加文章请求"
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/SubtitlePanel.tsx
		function SubtitlePanel({ detail, api, openPath }) {
			const data = useProjectData(api, detail), file = (0, react.useRef)(null), mutation = (0, react.useRef)(false);
			const [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)(""), [ack, setAck] = (0, react.useState)(false);
			const video = detail.videos?.find((v) => v.name === detail.selectedVideo);
			const transcript = [...data.state?.transcripts ?? []].reverse().find((t) => video && t.video.name === video.name && t.video.size === video.size && t.video.modifiedAt === video.modifiedAt);
			const tasks = data.state?.tasks.filter((t) => t.kind === "asr") ?? [], active = tasks.find(isActiveTask), uncertain = tasks.some((t) => t.status === "unconfirmed");
			const statusId = (0, react.useId)();
			const latest = [...tasks].reverse().find((task) => video && task.video?.name === video.name && task.video.size === video.size && task.video.modifiedAt === video.modifiedAt);
			const taskFailure = !active && latest?.error && (!transcript || latest.updatedAt >= transcript.createdAt) ? latest.error : void 0;
			const failure = error || data.error || taskFailure;
			const noAudio = Boolean(failure && /没有音轨|no audio/i.test(failure));
			const run = async (action) => {
				if (mutation.current) return;
				mutation.current = true;
				setBusy(true);
				setError("");
				try {
					data.query.accept(await api.action(action));
				} catch (e) {
					setError(e instanceof Error ? e.message : "操作失败");
				} finally {
					mutation.current = false;
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "productionPanel",
				"aria-label": "视频转文字",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "productionHeading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "字幕" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							"aria-describedby": statusId,
							disabled: busy || !video || noAudio || Boolean(active) || uncertain && !ack,
							onClick: () => void run({
								id: detail.id,
								folderPath: detail.folderPath,
								action: "transcribe",
								acknowledgeUnknown: ack
							}),
							children: transcript ? "使用已有转写" : "视频转文字"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							tone: noAudio ? "primary" : "secondary",
							disabled: busy || !video,
							onClick: () => file.current?.click(),
							children: "导入字幕"
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: file,
						hidden: true,
						type: "file",
						accept: ".srt,.ass",
						"aria-label": "导入字幕",
						onChange: (e) => {
							const selected = e.currentTarget.files?.[0];
							e.currentTarget.value = "";
							if (selected) try {
								run({
									id: detail.id,
									folderPath: detail.folderPath,
									action: "import-subtitle",
									sourcePath: localFilePath(selected)
								});
							} catch (e) {
								setError(e instanceof Error ? e.message : "路径读取失败");
							}
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						id: statusId,
						className: failure ? "creatorError" : "creatorMuted",
						role: failure ? "alert" : void 0,
						children: failure ? noAudio ? "当前视频没有音轨，可导入字幕" : failure : transcript ? `${transcript.source === "volcano" ? "火山转写" : "已导入字幕"} · ${transcript.cues} 段 · ${transcript.video.name}` : video ? "尚无当前视频的字幕，可转写或导入" : "请先选择视频"
					}),
					failure && transcript && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "creatorMuted",
						children: [
							"已保留当前字幕 · ",
							transcript.cues,
							" 段 · ",
							transcript.video.name
						]
					}),
					transcript && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						onClick: () => void openPath(`${detail.folderPath}/${transcript.srtFile}`).catch((e) => setError(e.message)),
						children: "打开字幕文件"
					}),
					active && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "status",
						children: [active.step ?? "正在转写", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void run({
								id: detail.id,
								folderPath: detail.folderPath,
								action: "cancel",
								taskId: active.id
							}),
							children: "取消"
						})]
					}),
					uncertain && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: ack,
						onChange: (e) => setAck(e.target.checked)
					}), "已核对上次结果，确认重新请求"] })
				]
			});
		}
		//#endregion
		//#region src/client/OverviewPage.tsx
		function OverviewPage({ detail, api, navigate, ...media }) {
			const data = useProjectData(api, detail), state = data.state, current = data.view?.detail ?? detail;
			const pictures = state?.images?.filter((i) => !i.hidden) ?? [], article = state?.articles.at(-1);
			const covers = data.view?.covers.versions.filter((v) => !v.hidden && current.covers[v.ratio] && data.view?.covers.selected[v.ratio] === v.id) ?? [];
			const missingCovers = Object.values(data.view?.covers.selected ?? {}).filter(Boolean).length - covers.length;
			const articleImage = pictures.find((i) => article?.imageIds?.includes(i.id));
			const articleExcerpt = data.view?.excerpts?.article;
			const articleText = article?.title && articleExcerpt?.text.startsWith(article.title) ? articleExcerpt.text.slice(article.title.length).trim() : articleExcerpt?.text;
			const publications = state?.publications?.filter((p) => !p.hidden) ?? [];
			const task = state?.tasks.find(isActiveTask), script = data.view ? data.view.script.excerpt : detail.script?.slice(0, 240);
			const picturePreviews = creationPreviewImages(pictures, current, api), coverPreviews = coverPreviewImages(covers, current, media.getCoverImage);
			const preview = useImagePreview([...picturePreviews, ...coverPreviews]);
			const show = (kind, id, element) => preview.open(kind === "image" ? picturePreviews : coverPreviews, id, element);
			const heading = (name, tab, label, id) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "overviewHeading",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
					tone: "ghost",
					"aria-label": label,
					onClick: () => navigate(tab, id),
					children: label
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "projectOverview",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: `overviewSection${current.videoSelection === "selected" ? "" : " overviewEmpty"}`,
						"aria-label": "视频摘要",
						children: [heading("视频", "video", current.videos?.length ? "管理视频" : "导入视频"), current.videoSelection === "selected" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewVideo, {
							detail: current,
							getVideoPlayback: media.getVideoPlayback
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "overviewCaption",
							title: current.selectedVideo,
							children: current.selectedVideo
						})] }) : current.videoSelection === "missing" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "creatorError",
							children: "选中的视频已找不到"
						}) : current.videos?.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "creatorMuted",
							children: "尚未选择当前视频"
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: `overviewSection${script ? "" : " overviewEmpty"}`,
						"aria-label": "脚本摘要",
						children: [heading("脚本", "script", script ? "编辑脚本" : "写脚本"), script && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "overviewExcerpt",
							children: script
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: `overviewSection${data.view?.excerpts?.subtitle ? "" : " overviewEmpty"}`,
						"aria-label": "字幕摘要",
						children: [heading("字幕", "subtitle", data.view?.excerpts?.subtitle || state?.transcripts.length ? "查看字幕" : "转写或导入"), data.view?.excerpts?.subtitle && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "overviewCaption",
							children: data.view.excerpts.subtitle.source
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "overviewExcerpt",
							children: data.view.excerpts.subtitle.text
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: `overviewSection${article || current.hasArticle ? "" : " overviewEmpty"}`,
						"aria-label": "文章摘要",
						children: [heading("文章", "article", article || current.hasArticle ? "阅读文章" : "写文章", article?.id), (article || current.hasArticle) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: articleImage ? "overviewArticleWithImage" : "",
							children: [articleImage && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "creatorMediaFrame",
								"aria-label": "查看文章配图",
								onClick: (e) => show("image", articleImage.id, e.currentTarget),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageThumb, {
									image: articleImage,
									detail: current,
									api
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: article?.title ?? current.title }), articleExcerpt?.id === (article?.id ?? "legacy") && articleText && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "overviewExcerpt",
								children: articleText
							})] })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: `overviewSection${pictures.length || covers.length || missingCovers ? "" : " overviewEmpty"}`,
						"aria-label": "图片摘要",
						children: [
							heading("图片", "images", pictures.length || covers.length ? "查看图库" : "制作或导入"),
							pictures.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "creatorMediaGrid",
								"aria-label": "项目图片",
								children: pictures.slice(0, 4).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "creatorMediaFrame",
									"aria-label": `查看图片：${imageName(item)}`,
									onClick: (e) => show("image", item.id, e.currentTarget),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageThumb, {
										image: item,
										detail: current,
										api
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "creatorMediaCaption",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "creatorMediaName",
										title: imageName(item),
										children: imageName(item)
									})
								})] }, item.id))
							}),
							covers.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "overviewCoverGroup",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "视频封面" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "creatorMediaGrid",
									children: covers.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "creatorMediaFrame",
										"aria-label": `查看 ${item.ratio.replace("x", ":")} 封面`,
										onClick: (e) => show("cover", item.id, e.currentTarget),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewCover, {
											version: item,
											detail: current,
											getCoverImage: media.getCoverImage
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "creatorMediaCaption",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.ratio.replace("x", ":") })
									})] }, item.id))
								})]
							}),
							missingCovers > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "creatorError",
								children: [missingCovers, " 个已选封面无法读取，请在图片页核对。"]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: `overviewSection${publications.length ? "" : " overviewEmpty"}`,
						"aria-label": "发布摘要",
						children: [heading("发布", "publishing", publications.length ? "查看发布内容" : "准备发布内容"), publications.map((item) => {
							const platform = item.platform === "official-account" ? {
								name: "公众号",
								icon: "article"
							} : PUBLISH_PLATFORM_DEFINITIONS[item.platform];
							const metric = state ? publicationMetric(state, item, data.view?.accountIds?.[item.platform]) : void 0;
							const metricText = metric ? [
								metric.views !== void 0 ? `浏览 ${metric.views}` : "",
								metric.likes !== void 0 ? `赞 ${metric.likes}` : "",
								metric.comments !== void 0 ? `评论 ${metric.comments}` : ""
							].filter(Boolean).join(" · ") : "";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "overviewPublication",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlatformMark, {
										id: platform.icon,
										size: 22
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: item.title }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
											platform.name,
											" · ",
											{
												video: "视频",
												images: "图文",
												article: "文章"
											}[item.type],
											" · ",
											state ? publicationLabel(state, item.id, data.view?.accountIds) : "本地材料"
										] }),
										metricText && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: metricText })
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: "ghost",
										"aria-label": `编辑发布内容：${item.title}`,
										onClick: () => navigate("publishing", item.id),
										children: "编辑内容"
									})
								]
							}, item.id);
						})]
					}),
					task && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: "projectTaskLink",
						onClick: () => navigate(task.kind === "asr" ? "subtitle" : task.kind === "article" ? "article" : task.kind === "images" ? "images" : "publishing"),
						children: [task.step ?? "任务处理中", " · 查看进度"]
					}),
					data.error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "creatorError",
							children: data.error
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => void data.query.retry().catch(() => void 0),
							children: "重新读取"
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/covers/types.ts
		const IMAGE_CREDENTIAL = "DSH_CREATOR_IMAGE_API_KEY";
		const COVER_RATIOS = [
			"3x4",
			"4x3",
			"16x9"
		];
		/** Review belongs to this run's exact output versions, not the current cover selection. */
		function coverRunReview(run, versions) {
			const reviews = run.ratios.map((ratio) => versions.find((version) => version.id === run.slots[ratio]?.versionId && version.runId === run.id && version.ratio === ratio)?.review);
			if (reviews.includes("needs_changes")) return "needs_changes";
			return reviews.length && reviews.every((review) => review === "pass") ? "pass" : "pending";
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/CoverPanel.css.mjs
		registerPluginCss("dsh-creator-workbench/CoverPanel.css", "[data-plugin=\"dsh-creator-workbench\"] .creatorCoverPanel {\r\n  container-type: inline-size;\r\n  container-name:creator-cover;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 14px;\r\n  min-width: 0;\r\n  padding-block: 20px;\r\n  border-top: 1px solid var(--dsw-alias-border-l1);\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverRatioGrid {\r\n  display: grid;\r\n  grid-template-columns: minmax(0, 1fr);\r\n  gap: 16px;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverRatio {\r\n  min-width: 0;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverRatioHeading {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  gap: 6px;\r\n  margin-bottom: 10px;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverRatio h4 {\r\n  margin: 0;\r\n  font-size: 14px;\r\n  font-weight: 600;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverPreview,\r\n[data-plugin=\"dsh-creator-workbench\"] .coverEmpty {\r\n  display: flex;\r\n  width: 100%;\r\n  aspect-ratio:4/3;\r\n  min-height:180px;\r\n  align-items: center;\r\n  justify-content: center;\r\n  border: 0;\r\n  border-radius: 6px;\r\n  padding: 8px;\r\n  box-sizing: border-box;\r\n  overflow: hidden;\r\n  background: var(--dsw-alias-interactive-bg-hover);\r\n  color: var(--dsw-alias-label-secondary);\r\n  cursor: pointer;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverPreview img {\r\n  max-width: 100%;\r\n  max-height: 100%;\r\n  object-fit: contain;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverRatio > p {\r\n  margin: 8px 0 0;\r\n  font-size: 12px;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverVersionRow {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 12px;\r\n  padding: 12px 0;\r\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\r\n  min-width: 0;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverVersionRow .coverPreview {\r\n  width: 72px;\r\n  height: 72px;\r\n  min-height: 0;\r\n  aspect-ratio: auto;\r\n  flex: none;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"] .coverTaskRatio {\r\n  padding: 12px 0;\r\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\r\n}\r\n@container creator-cover (min-width:400px) {\r\n  [data-plugin=\"dsh-creator-workbench\"] .coverRatioGrid { grid-template-columns:repeat(2,minmax(0,1fr)); }\r\n}\r\n@container creator-cover (min-width:680px) {\r\n  [data-plugin=\"dsh-creator-workbench\"] .coverRatioGrid { grid-template-columns:repeat(3,minmax(0,1fr)); }\r\n}\r\n");
		//#endregion
		//#region src/client/CoverPanel.tsx
		const labels = {
			waiting_agent: "等待 Agent 制作",
			preparing: "准备画面",
			running: "生成中",
			pending: "待生成",
			partial: "部分完成",
			completed: "已生成，待检查",
			failed: "失败",
			cancelled: "已取消",
			unconfirmed: "结果未确认",
			pass: "检查通过",
			needs_changes: "需要修改"
		};
		const sourceLabel = (v) => v.source === "import" ? "已导入" : v.source === "legacy" ? "已有封面" : v.review === "pending" ? "待检查" : labels[v.review];
		function imageUrl(detail, version, face) {
			return loadOverviewCover(detail, version, face.getCoverImage);
		}
		function Thumbnail({ version, detail, face, onOpen }) {
			const [url, setUrl] = (0, react.useState)(), [error, setError] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let live = true;
				imageUrl(detail, version, face).then((v) => {
					if (live) setUrl(v);
				}, () => {
					if (live) setError(true);
				});
				return () => {
					live = false;
				};
			}, [
				version.id,
				version.file,
				detail.folderPath
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				"data-cover-trigger": version.ratio,
				className: "coverPreview",
				type: "button",
				onClick: onOpen,
				"aria-label": `预览 ${version.ratio.replace("x", ":")} 封面`,
				children: url ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: url,
					alt: version.ratio.replace("x", ":") + " 封面"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error ? "图片无法读取" : "读取图片…" })
			});
		}
		function CoverPanel({ detail, api, ...face }) {
			return api ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SharedCoverPanel, {
				detail,
				api,
				...face
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CoverPanelBody, {
				detail,
				...face
			});
		}
		function SharedCoverPanel({ detail, api, ...face }) {
			const data = useProjectData(api, detail);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CoverPanelBody, {
				detail,
				...face,
				shared: {
					state: data.view?.covers,
					query: data.query,
					refresh: () => data.query.invalidate()
				}
			});
		}
		function CoverPanelBody({ detail, shared, ...face }) {
			const [state, setState] = (0, react.useState)({
				versions: [],
				selected: {},
				runs: []
			});
			const [error, setError] = (0, react.useState)(), [loadError, setLoadError] = (0, react.useState)(false), [loaded, setLoaded] = (0, react.useState)(false), [retry, setRetry] = (0, react.useState)(0);
			const [busy, setBusy] = (0, react.useState)(false), [notice, setNotice] = (0, react.useState)(), [draftRun, setDraftRun] = (0, react.useState)(), [selectedRunId, setSelectedRunId] = (0, react.useState)();
			const [panel, setPanel] = (0, react.useState)(), [ratio, setRatio] = (0, react.useState)("3x4");
			const [ack, setAck] = (0, react.useState)(false);
			const imagePreview = useImagePreview(coverPreviewImages(state.versions, detail, face.getCoverImage));
			const coverRoot = (0, react.useRef)(null);
			const fileInput = (0, react.useRef)(null), importRatio = (0, react.useRef)("3x4");
			const alive = (0, react.useRef)(true), epoch = useLibraryEpoch();
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!notice) return;
				const timer = setTimeout(() => setNotice(void 0), 7e3);
				return () => clearTimeout(timer);
			}, [notice]);
			const scope = {
				id: detail.id,
				folderPath: detail.folderPath
			};
			(0, react.useEffect)(() => {
				if (shared) {
					if (shared.state) {
						setState(shared.state);
						setLoaded(true);
						setLoadError(false);
					}
					return;
				}
				let live = true;
				let timer;
				const refresh = async () => {
					try {
						const next = await face.getCoverState(scope);
						if (!live) return;
						setState(next);
						setLoaded(true);
						setLoadError(false);
						if (next.runs.some((r) => ["running", "preparing"].includes(r.status))) timer = setTimeout(() => {
							refresh();
						}, 1500);
					} catch (cause) {
						if (live) {
							setLoadError(true);
							setError(cause instanceof Error ? cause.message : String(cause));
						}
					}
				};
				refresh();
				return () => {
					live = false;
					clearTimeout(timer);
				};
			}, [
				detail.folderPath,
				epoch,
				retry,
				shared?.state
			]);
			const apply = async (action, rethrow = false) => {
				setBusy(true);
				setError(void 0);
				setNotice(void 0);
				try {
					const next = await face.coverAction(action);
					if (alive.current) setState(next);
					if (shared) shared.refresh().catch(() => void 0);
					return next;
				} catch (cause) {
					if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
					if (rethrow) throw cause;
					return;
				} finally {
					if (alive.current) setBusy(false);
				}
			};
			const draft = async (run, append = false) => {
				setBusy(true);
				setError(void 0);
				try {
					await face.prepareCoverDraft(detail, run.id, append);
					if (alive.current) {
						setNotice("制作请求已放入原生对话，请发送。");
						setDraftRun(void 0);
					}
				} catch (cause) {
					if (alive.current) {
						const message = cause instanceof Error ? cause.message : String(cause);
						setError(message);
						if (message.includes("已有草稿")) setDraftRun(run.id);
					}
				} finally {
					if (alive.current) setBusy(false);
				}
			};
			const [pendingRatios, setPendingRatios] = (0, react.useState)();
			const begin = async (ratios, append = false) => {
				if (face.prepareCoverRequest) {
					setBusy(true);
					setError(void 0);
					try {
						await face.prepareCoverRequest(detail, ratios, append);
						setPendingRatios(void 0);
						setNotice("制作请求已放入原生对话，请发送。");
						shared ? shared.refresh() : setRetry((n) => n + 1);
					} catch (cause) {
						const message = cause instanceof Error ? cause.message : String(cause);
						setError(message);
						if (message.includes("已有草稿")) setPendingRatios(ratios);
					} finally {
						setBusy(false);
					}
					return;
				}
				if (!detail.selectedVideo) {
					setError("请先选择当前视频。");
					return;
				}
				const run = [...(await apply({
					...scope,
					action: "create",
					video: detail.selectedVideo,
					ratios
				}))?.runs ?? []].reverse().find((r) => (r.purpose ?? "cover") === "cover" && r.video.name === detail.selectedVideo && r.ratios.length === ratios.length && ratios.every((ratio) => r.ratios.includes(ratio)) && [
					"waiting_agent",
					"preparing",
					"running"
				].includes(r.status));
				if (run) {
					setSelectedRunId(run.id);
					await draft(run);
				}
			};
			const metadataRun = state.runs.find((r) => r.id === selectedRunId) ?? state.runs.at(-1);
			const [runDetails, setRunDetails] = (0, react.useState)();
			const latest = runDetails && metadataRun && runDetails.id === metadataRun.id ? {
				...metadataRun,
				...runDetails.analysis ? { analysis: runDetails.analysis } : {},
				slots: Object.fromEntries(Object.entries(metadataRun.slots).map(([ratio, slot]) => {
					const full = runDetails.slots[ratio];
					return [ratio, {
						...slot,
						...full?.versionId === slot.versionId ? { prompt: full.prompt } : {}
					}];
				}))
			} : metadataRun;
			(0, react.useEffect)(() => {
				if (!shared || !panel) return;
				let current = true;
				face.getCoverState(scope).then((full) => {
					if (current) {
						setRunDetails(full.runs.find((r) => r.id === metadataRun?.id));
						setState((previous) => ({
							...previous,
							versions: full.versions
						}));
					}
				}, (e) => {
					if (current) setError(e instanceof Error ? e.message : "详情读取失败");
				});
				return () => {
					current = false;
				};
			}, [
				panel,
				metadataRun?.id,
				metadataRun?.updatedAt
			]);
			const active = [...state.runs].reverse().find((r) => (r.purpose ?? "cover") === "cover" && r.video.name === detail.selectedVideo && r.video.size === detail.videos?.find((v) => v.name === detail.selectedVideo)?.size && r.video.modifiedAt === detail.videos?.find((v) => v.name === detail.selectedVideo)?.modifiedAt && (r.status !== "waiting_agent" || r.deliveredAt || r.frames.length) && [
				"waiting_agent",
				"preparing",
				"running"
			].includes(r.status));
			const incoming = state.versions.find((version) => !version.hidden && version.review === "pending" && state.runs.some((run) => run.id === version.runId && (run.purpose ?? "cover") === "cover" && run.video.name === detail.selectedVideo));
			const hasSelectedCover = Object.values(state.selected).some((id) => state.versions.some((v) => v.id === id && !v.hidden));
			const runLabel = (run) => run.status === "waiting_agent" ? run.frames.length ? "画面已准备" : hasSelectedCover ? "重做请求待发送" : "请到对话发送制作请求" : run.status === "completed" ? coverRunReview(run, state.versions) === "pass" ? "制作完成" : coverRunReview(run, state.versions) === "needs_changes" ? "需要修改" : "待检查" : labels[run.status];
			const view = (version) => {
				imagePreview.open(coverPreviewImages(state.versions.filter((v) => v.ratio === version.ratio).reverse(), detail, face.getCoverImage), version.id);
			};
			const selectVersion = async (version) => {
				const checked = await apply(version.review === "pass" ? {
					...scope,
					action: "select",
					versionId: version.id
				} : {
					...scope,
					action: "review",
					versionId: version.id,
					verdict: "pass",
					note: "用户明确检查并选用此版本。",
					select: false
				});
				const next = checked && (version.review === "pass" ? checked : await apply({
					...scope,
					action: "select",
					versionId: version.id
				}));
				if (next?.selected[version.ratio] === version.id) setNotice("已选用此版本");
				else if (next) setError("选用未完成，请核对后重试。");
			};
			const focusReturn = () => coverRoot.current?.querySelector(`[data-cover-trigger="${ratio}"]`) ?? coverRoot.current?.querySelector("[data-cover-start]") ?? null;
			const close = () => {
				setPanel(void 0);
			};
			const importFile = (r) => {
				importRatio.current = r;
				fileInput.current?.click();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: coverRoot,
				className: "creatorCoverPanel",
				"aria-label": "封面制作与版本",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorSectionHeading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "封面" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							"data-cover-start": true,
							tone: Object.keys(state.selected).length ? "secondary" : "primary",
							disabled: busy || !loaded || loadError || !detail.selectedVideo,
							onClick: () => {
								begin(COVER_RATIOS.every((r) => state.selected[r]) ? [...COVER_RATIOS] : COVER_RATIOS.filter((r) => !state.selected[r]));
							},
							children: COVER_RATIOS.every((r) => state.selected[r]) ? "重新制作封面" : COVER_RATIOS.some((r) => state.selected[r]) ? "补齐封面" : "让 Agent 制作封面"
						})]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "creatorError",
						children: error
					}),
					loadError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						onClick: () => shared ? void shared.refresh() : setRetry((n) => n + 1),
						children: "重新读取封面"
					}),
					draftRun && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						disabled: busy,
						onClick: () => {
							const run = state.runs.find((r) => r.id === draftRun);
							if (run) draft(run, true);
						},
						children: "追加制作请求"
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "creatorMuted",
						children: notice
					}),
					!loaded && !loadError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "creatorMuted",
						children: "正在读取封面…"
					}),
					loaded && !loadError && !panel && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "coverRatioGrid",
						children: COVER_RATIOS.map((r) => {
							const versions = state.versions.filter((v) => v.ratio === r && !v.hidden), current = versions.find((v) => v.id === state.selected[r]);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: "coverRatio",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "coverRatioHeading",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: r.replace("x", ":") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionMenu, {
											label: "更多",
											ariaLabel: r.replace("x", ":") + " 封面操作",
											align: "end",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
													tone: "ghost",
													disabled: busy,
													onClick: () => importFile(r),
													children: "导入图片"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionButton, {
													tone: "ghost",
													disabled: !versions.length,
													onClick: () => {
														setRatio(r);
														setPanel("versions");
													},
													children: ["历史版本 · ", versions.length]
												}),
												current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
													tone: "ghost",
													disabled: busy,
													onClick: () => {
														apply({
															...scope,
															action: "remove",
															versionId: current.id
														});
													},
													children: "移除当前封面"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
													tone: "ghost",
													disabled: busy || !detail.selectedVideo,
													onClick: () => {
														begin([r]);
													},
													children: "重做此画幅"
												})
											]
										})]
									}),
									current ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Thumbnail, {
										detail,
										version: current,
										face,
										onOpen: () => {
											view(current);
										}
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "coverEmpty",
										onClick: () => {
											if (versions.length) {
												setRatio(r);
												setPanel("versions");
											} else importFile(r);
										},
										children: versions.length ? "选择封面" : "导入图片"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "creatorMuted",
										children: current ? "已选用" : "尚未选用"
									}),
									current?.video && detail.selectedVideo && current.video !== detail.selectedVideo && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "creatorMuted",
										children: "来自其他视频，请核对"
									})
								]
							}, r);
						})
					}),
					pendingRatios && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						onClick: () => {
							begin(pendingRatios, true);
						},
						children: "追加制作请求"
					}),
					panel === "versions" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionPanel, {
						title: ratio.replace("x", ":") + " 历史版本",
						onClose: close,
						returnFocus: focusReturn,
						children: state.versions.filter((v) => v.ratio === ratio && !v.hidden).reverse().map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "coverVersionRow",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Thumbnail, {
									detail,
									version: v,
									face,
									onOpen: () => {
										view(v);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "creatorRowCopy",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: state.selected[ratio] === v.id ? "当前选用" : sourceLabel(v) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: new Date(v.createdAt).toLocaleString() }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
											v.width,
											" × ",
											v.height
										] })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: busy || state.selected[v.ratio] === v.id,
									onClick: () => void selectVersion(v),
									children: state.selected[v.ratio] === v.id ? "已选用" : v.review === "pass" ? "选用" : "检查并选用"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: busy,
									tone: "ghost",
									onClick: () => {
										apply({
											...scope,
											action: "remove",
											versionId: v.id
										});
									},
									children: "移除"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									onClick: () => {
										view(v);
									},
									children: "预览"
								})
							]
						}, v.id))
					}),
					active && !panel && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorInlineStatus",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: runLabel(active) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							tone: "ghost",
							onClick: () => {
								setSelectedRunId(active.id);
								setPanel("run");
							},
							children: "查看进度"
						})]
					}),
					!panel && incoming && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						onClick: () => {
							view(incoming);
						},
						children: "检查新封面"
					}),
					!panel && !active && state.runs.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						tone: "ghost",
						onClick: () => setPanel("run"),
						children: "制作详情"
					}),
					panel === "run" && latest && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionPanel, {
						title: "制作详情",
						onClose: close,
						returnFocus: focusReturn,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorField",
								children: ["制作记录", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreatorSelect, {
									value: latest.id,
									onValueChange: (value) => {
										setSelectedRunId(value);
										setAck(false);
									},
									children: [...state.runs].reverse().map((run) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: run.id,
										children: [
											new Date(run.createdAt).toLocaleString(),
											" ·",
											" ",
											run.purpose === "service_test" ? "服务测试" : runLabel(run)
										]
									}, run.id))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorFileName",
								title: latest.video.name,
								children: latest.video.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								children: runLabel(latest)
							}),
							latest.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: "creatorError",
								children: latest.error
							}),
							latest.ratios.map((r) => {
								const slot = latest.slots[r], version = state.versions.find((v) => v.id === slot?.versionId && !v.hidden);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "coverTaskRatio",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "creatorInlineStatus",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: r.replace("x", ":") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: version ? sourceLabel(version) : labels[slot?.status ?? latest.status] }),
												version && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
													onClick: () => {
														view(version);
													},
													children: "查看图片"
												}),
												slot && [
													"failed",
													"cancelled",
													"unconfirmed"
												].includes(slot.status) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
													disabled: busy || slot.status === "unconfirmed" && !ack,
													onClick: () => {
														apply({
															...scope,
															action: "retry",
															runId: latest.id,
															ratios: [r],
															acknowledgeUnknown: ack
														});
													},
													children: "仅重试此画幅"
												})
											]
										}),
										slot?.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "creatorError",
											children: slot.error
										}),
										slot?.prompt && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "提示词" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "creatorPrewrap",
											children: slot.prompt
										})] })
									]
								}, r);
							}),
							latest.status === "unconfirmed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorCheckbox",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: ack,
									onChange: (e) => setAck(e.target.checked)
								}), "已核对服务端结果，重新请求可能再次计费"]
							}),
							latest.analysis && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: "creatorDisclosure",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "选帧与分析" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "creatorPrewrap",
									children: latest.analysis
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [[
								"running",
								"preparing",
								"waiting_agent"
							].includes(latest.status) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy,
								onClick: () => {
									apply({
										...scope,
										action: "cancel",
										runId: latest.id
									});
								},
								children: "取消本次制作"
							}), latest.status === "waiting_agent" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy,
								onClick: () => {
									draft(latest);
								},
								children: "准备会话制作请求"
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "creatorDisclosure",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "高级操作" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorMuted",
								children: "画面分析与检查使用 Harness 当前支持看图的 Agent。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy || !detail.selectedVideo,
								onClick: async () => {
									if (!detail.selectedVideo) return;
									const next = await apply({
										...scope,
										action: "test",
										video: detail.selectedVideo
									});
									if (next) {
										setSelectedRunId(next.runs.at(-1)?.id);
										setPanel("run");
									}
								},
								children: "测试生图 · 1 张，可能计费"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: fileInput,
						hidden: true,
						type: "file",
						"aria-label": "导入已有封面",
						accept: ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp",
						disabled: busy,
						onChange: (e) => {
							const file = e.currentTarget.files?.[0];
							e.currentTarget.value = "";
							if (!file) return;
							const path = globalThis.__DSH_HOST_PATHS__?.pathFor(file);
							if (!path) {
								setError("请在 DSH Desktop 中选择本机图片。");
								return;
							}
							apply({
								...scope,
								action: "import",
								sourcePath: path,
								ratio: importRatio.current
							});
						}
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/VideoPanel.css.mjs
		registerPluginCss("dsh-creator-workbench/VideoPanel.css", "[data-plugin=\"dsh-creator-workbench\"] .creatorVideoPanel {\n  container-type: inline-size;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  min-width: 0;\n  padding-block: 18px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorVideoPanel video {\n  width: 100%;\n  max-height: 300px;\n  object-fit: contain;\n  background: #151619;\n  border-radius: 8px;\n  display: block;\n}\n[data-plugin=\"dsh-creator-workbench\"] .videoImportConfirmation {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 14px;\n  background: var(--dsw-alias-interactive-bg-hover);\n  border-radius: 8px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .videoImportConfirmation summary {\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n}\n");
		//#endregion
		//#region src/client/VideoPanel.tsx
		const importsByFolder = /* @__PURE__ */ new Map();
		function VideoPanel({ detail, t, ...face }) {
			const [source, setSource] = (0, react.useState)();
			const [name, setName] = (0, react.useState)("");
			const [task, setTask] = (0, react.useState)(() => importsByFolder.get(detail.folderPath));
			const [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)(), [url, setUrl] = (0, react.useState)();
			const fileInput = (0, react.useRef)(null), player = (0, react.useRef)(null);
			const alive = (0, react.useRef)(true);
			const playbackRequest = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
					player.current?.pause();
				};
			}, []);
			const report = (cause) => {
				if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
			};
			(0, react.useEffect)(() => {
				let active = true;
				const ticket = ++playbackRequest.current;
				player.current?.pause();
				setUrl(void 0);
				if (detail.videoSelection !== "selected") return;
				face.getVideoPlayback(detail.id).then((value) => {
					if (active && ticket === playbackRequest.current) setUrl(value.found ? value.url : void 0);
				}, (cause) => {
					if (active) report(cause);
				});
				return () => {
					active = false;
					player.current?.pause();
				};
			}, [
				detail.folderPath,
				detail.selectedVideo,
				detail.videos?.find((v) => v.name === detail.selectedVideo)?.modifiedAt
			]);
			(0, react.useEffect)(() => {
				if (task?.status !== "running") return;
				let active = true;
				let timer;
				const poll = async () => {
					try {
						const next = await face.getVideoImport(task.token);
						importsByFolder.set(detail.folderPath, next);
						if (!active) return;
						setTask(next);
						if (next.status === "running") timer = setTimeout(() => {
							poll();
						}, 300);
						else {
							bumpLibrary();
							if (next.status === "completed") setSource(void 0);
						}
					} catch (cause) {
						if (active) {
							report(cause);
							setTask(void 0);
							bumpLibrary();
						}
					}
				};
				poll();
				return () => {
					active = false;
					clearTimeout(timer);
				};
			}, [
				task?.token,
				task?.status,
				detail.folderPath
			]);
			const visibility = async (file, hidden) => {
				setBusy(true);
				setError(void 0);
				if (hidden && file === detail.selectedVideo) {
					playbackRequest.current++;
					player.current?.pause();
					setUrl(void 0);
				}
				try {
					await face.setVideoVisibility(detail.id, file, detail.folderPath, hidden);
					if (alive.current) bumpLibrary();
				} catch (cause) {
					report(cause);
				} finally {
					if (alive.current) setBusy(false);
				}
			};
			const running = task?.status === "running";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "creatorVideoPanel",
				"aria-label": t("video.title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorSectionHeading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "视频" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							tone: detail.videoSelection === "selected" ? "secondary" : "primary",
							disabled: busy || running,
							onClick: () => fileInput.current?.click(),
							children: "导入视频"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: fileInput,
						hidden: true,
						type: "file",
						"aria-label": "选择导入视频",
						accept: ".mp4,.mov,video/mp4,video/quicktime",
						disabled: busy || running,
						onChange: (event) => {
							const file = event.currentTarget.files?.[0];
							event.currentTarget.value = "";
							if (!file) return;
							try {
								const path = globalThis.__DSH_HOST_PATHS__?.pathFor(file);
								if (!path) throw new Error(t("video.desktopRequired"));
								setSource(path);
								setName(file.name);
								setError(void 0);
							} catch (cause) {
								report(cause);
							}
						}
					}),
					source && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "videoImportConfirmation",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "creatorFileName",
								title: name,
								children: ["待导入：", name]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "修改文件名" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorField",
								children: ["保存文件名", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: name,
									disabled: busy || running,
									onChange: (e) => setName(e.target.value)
								})]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "primary",
								disabled: busy || running || !name.trim(),
								onClick: () => {
									setBusy(true);
									setError(void 0);
									face.startVideoImport(detail.id, source, name, detail.folderPath).then((next) => {
										importsByFolder.set(detail.folderPath, next);
										if (alive.current) {
											setTask(next);
											if (next.status === "completed") {
												setSource(void 0);
												bumpLibrary();
											}
										}
									}, report).finally(() => {
										if (alive.current) setBusy(false);
									});
								},
								children: "确认导入"
							}), !running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "ghost",
								disabled: busy,
								onClick: () => {
									setSource(void 0);
									setError(void 0);
								},
								children: "取消"
							})] })
						]
					}),
					task && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorInlineStatus",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t(`video.${task.status}`), task.status === "failed" ? "：" + (task.error ?? "") : ""] }), running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							onClick: () => {
								face.cancelVideoImport(task.token).then((next) => {
									if (alive.current) setTask(next);
									bumpLibrary();
								}, report);
							},
							children: "取消导入"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "creatorField",
						children: ["当前视频", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
							value: detail.selectedVideo ?? "",
							disabled: busy || running || !detail.videos?.length,
							onValueChange: (value) => {
								if (!value) return;
								setBusy(true);
								setError(void 0);
								face.selectVideo(detail.id, value, detail.folderPath).then(() => bumpLibrary(), report).finally(() => {
									if (alive.current) setBusy(false);
								});
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								disabled: true,
								children: t(`video.${detail.videoSelection ?? "empty"}`)
							}), detail.videos?.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: v.name,
								children: v.name
							}, v.name))]
						})]
					}),
					detail.videoSelection === "missing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorMuted",
						children: t(`video.${detail.videoSelection ?? "empty"}`)
					}),
					url && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
						ref: player,
						controls: true,
						playsInline: true,
						preload: "metadata",
						src: url,
						onError: () => setError("视频编码暂时无法播放。文件已保留，可选择其他兼容视频。")
					}, url),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorError",
						role: "alert",
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "creatorDisclosure",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: ["管理视频 · ", detail.videos?.length ?? 0] }), (detail.videos ?? []).map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "creatorAssetRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "creatorRowCopy",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									title: v.name,
									children: v.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
									(v.size / 1048576).toFixed(1),
									" MB",
									v.name === detail.selectedVideo ? " · 当前视频" : ""
								] })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "ghost",
								disabled: busy || running,
								onClick: () => {
									visibility(v.name, true);
								},
								children: "从列表移除"
							})]
						}, v.name))]
					})
				]
			});
		}
		PUBLISH_PLATFORMS.map((platform) => ({
			platform,
			url: PUBLISH_PLATFORM_DEFINITIONS[platform].collectUrl
		}));
		//#endregion
		//#region src/articleMarkdown.ts
		function rewriteArticleImages(markdown, origin) {
			const base = origin.replace(/\/$/, "");
			return markdown.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g, (all, alt, src, title) => {
				const dest = src.trim();
				if (/^(https?:|data:|file:)/i.test(dest)) return all;
				const rel = dest.replace(/^\.\//, "").replace(/^\/+/, "");
				return `![${alt}](${base}/${rel}${title})`;
			});
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ui/StatusPill.css.mjs
		registerPluginCss("dsh-creator-workbench/StatusPill.css", ".statusPill {\r\n  gap: 5px;\r\n  max-width: 100%;\r\n  font-weight: 500;\r\n  white-space: nowrap;\r\n}\r\n\r\n.statusPill.pending {\r\n  color: var(--dsw-alias-state-warn-label);\r\n}\r\n\r\n.statusPill.active {\r\n  color: var(--dsw-alias-state-business-primary);\r\n}\r\n\r\n.statusPill.success {\r\n  color: var(--dsw-alias-state-success-primary);\r\n}\r\n\r\n.statusPill.error {\r\n  color: var(--dsw-alias-state-error-primary);\r\n}\r\n\r\nbutton.statusPill:disabled {\r\n  opacity: 0.5;\r\n  cursor: default;\r\n}\r\n");
		//#endregion
		//#region src/client/ui/StatusPill.tsx
		const TONE_STATE = {
			neutral: void 0,
			pending: "warning",
			active: "ongoing",
			success: "done",
			error: "error"
		};
		function statusPillClass(tone, extra) {
			return [
				"statusPill",
				tone,
				extra
			].filter((part) => part !== void 0 && part !== "").join(" ");
		}
		function StatusPill({ tone = "neutral", title, children, onClick, ...rest }) {
			const state = TONE_STATE[tone];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
				className: statusPillClass(tone),
				...title === void 0 ? {} : { title },
				...onClick === void 0 ? {} : { onClick },
				...rest,
				children: [state !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state,
					size: 10
				}) : null, children]
			});
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ContentInspector.css.mjs
		registerPluginCss("dsh-creator-workbench/ContentInspector.css", "[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  min-width: 0;\n  min-height: 0;\n  overflow: hidden;\n  background: var(--dsw-alias-bg-base);\n  box-sizing: border-box;\n  font: var(--dsw-font-markdown-base);\n  color: var(--dsw-alias-label-primary);\n  --dsh-scrollbar-thumb: transparent;\n  --dsh-scrollbar-thumb-hover: transparent;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .header {\n  flex: none;\n  padding: 8px 12px 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .titleRow {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-height: 32px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .title {\n  min-width: 0;\n  overflow: hidden;\n  font-size: 16px;\n  font-weight: 600;\n  line-height: 24px;\n  color: var(--dsw-alias-label-primary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .titleActions {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .close {\n  flex: none;\n  display: grid;\n  place-items: center;\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  border: none;\n  border-radius: var(--dsw-radius-sm);\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .close:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .close:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tabs {\n  display: flex;\n  flex: none;\n  overflow-x: auto;\n  gap: 12px;\n  margin-top: 4px;\n  padding: 0 0 2px;\n  scrollbar-width: thin;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tab {\n  flex: none;\n  white-space: nowrap;\n  position: relative;\n  min-height: 36px;\n  padding: 0 6px 8px;\n  border-radius: 6px 6px 0 0;\n  border: none;\n  background: transparent;\n  font-size: 13px;\n  line-height: 16px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-tertiary);\n  cursor: pointer;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tab.active {\n  color: var(--dsw-alias-state-business-primary);\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tab:hover { background:var(--dsw-alias-interactive-bg-hover); }\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tab:first-child { padding-left:0; }\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tab:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: -2px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .body {\n  flex: 1;\n  min-height: 0;\n  padding: 16px 12px 24px;\n  overflow-y: auto;\n  scrollbar-width: thin;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .body::-webkit-scrollbar {\n  width: 6px;\n  height: 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .empty {\n  padding: 8px 0;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-markdown-small);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .lede {\n  display: flex;\n  gap: 16px;\n  align-items: flex-start;\n  margin-bottom: 20px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .coverPair {\n  flex: none;\n  display: flex;\n  align-items: stretch;\n  gap: 10px;\n  height: calc(80px * 4 / 3);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .coverHero {\n  flex: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  height: 100%;\n  aspect-ratio: 3 / 4;\n  overflow: hidden;\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .coverWide {\n  flex: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  height: 100%;\n  aspect-ratio: 4 / 3;\n  overflow: hidden;\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .coverHero img,\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .coverWide img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .coverFallback {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .ledeText {\n  min-width: 0;\n  padding-top: 2px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .stepper {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n  margin: -8px 0 16px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .step {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .step + .step::before {\n  content: \"\";\n  width: 14px;\n  height: 1px;\n  margin-right: 2px;\n  background: var(--dsw-alias-border-l2);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .stepDot {\n  flex: none;\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--dsw-alias-border-l2);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .step.done {\n  color: var(--dsw-alias-label-secondary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .step.done .stepDot {\n  background: var(--dsw-alias-state-success-primary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .step.current {\n  color: var(--dsw-alias-state-business-primary);\n  font-weight: 500;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .step.current .stepDot {\n  background: var(--dsw-alias-state-business-primary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .time {\n  margin-top: 4px;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-markdown-small);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .workList {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .workRow {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .workMain {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  min-width: 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .workName {\n  font: var(--dsw-font-markdown-base);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .workMain .statusPill {\n  align-self: center;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .jobNote {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin: 12px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-markdown-small);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .oilSurface .jobNote {\n  margin: 0 0 12px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .jobNote.done {\n  color: var(--dsw-alias-state-success-primary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .jobNote.error {\n  color: var(--dsw-alias-state-error-primary);\n  max-height: 72px;\n  overflow: hidden;\n  overflow-wrap: anywhere;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishGrid {\n  display: grid;\n  grid-template-columns: 1fr;\n  gap: 10px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"].wide .publishGrid {\n  grid-template-columns: 1fr 1fr;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishCard {\n  padding: 10px 12px;\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .scriptEditor {\n  display: block;\n  flex: 1;\n  width: 100%;\n  min-height: 240px;\n  margin: 0;\n  padding: 0;\n  border: none;\n  border-radius: 0;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: var(--dsw-font-markdown-base);\n  line-height: 24px;\n  resize: none;\n  box-sizing: border-box;\n  outline: none;\n  box-shadow: none;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .scriptEditor:focus {\n  outline: none;\n  box-shadow: none;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .scriptEditor::placeholder {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .body:has(.scriptEditor) {\n  display: flex;\n  flex-direction: column;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .videoPlayer {\n  display: block;\n  width: 100%;\n  max-height: min(70vh, 520px);\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-overlay);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishRow {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishName {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  font: var(--dsw-font-markdown-base);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishRow.articleRow {\n  width: 100%;\n  padding: 0;\n  border: none;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishRow.articleRow:hover .publishName {\n  color: var(--dsw-alias-state-business-primary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .oilSurface .oilActionBar + .publishRows {\n  margin-top: 12px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishMetrics {\n  margin-top: 4px;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-markdown-small);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .publishUrl {\n  display: block;\n  margin-top: 4px;\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-markdown-small);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .cues {\n  margin: 20px 0 0;\n  padding: 0;\n  list-style: none;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .cue + .cue {\n  margin-top: 16px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .cueTime {\n  margin-bottom: 4px;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-markdown-small);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .cueText {\n  margin: 0;\n  font: var(--dsw-font-markdown-base);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .block {\n  margin-top: 20px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .blockLabel {\n  margin-bottom: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-markdown-small);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .platformMark {\n  flex: none;\n  display: block;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .copyTitle {\n  margin-bottom: 6px;\n  font: var(--dsw-font-markdown-base-strong);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .article {\n  min-width: 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .article > :first-child > :first-child {\n  margin-top: 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .article img {\n  display: block;\n  max-width: 100%;\n  height: auto;\n  margin: 16px 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tags:first-child {\n  margin-top: 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tags {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  margin-top: 12px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .tag {\n  color: var(--dsw-alias-label-secondary);\n  font: var(--dsw-font-markdown-small);\n}\n");
		//#endregion
		//#region src/client/ContentInspector.tsx
		const TABS = PROJECT_TABS;
		const INSPECTOR_WIDE_PX = 720;
		const TAB_KEY = {
			overview: "inspector.tab.overview",
			video: "inspector.tab.video",
			script: "inspector.tab.script",
			subtitle: "inspector.tab.subtitle",
			article: "inspector.tab.article",
			images: "inspector.tab.images",
			publishing: "inspector.tab.publishing"
		};
		function cuesFromSubtitle(nextSubtitle) {
			if (nextSubtitle.cues.length > 0) return nextSubtitle.cues;
			if (nextSubtitle.text === "") return [];
			return nextSubtitle.text.split("\n").filter((line) => line.trim() !== "").map((text) => ({ text }));
		}
		function friendlyError(cause, t) {
			if (cause instanceof Error) {
				if (cause.message.startsWith("content not found")) return t("empty.gone");
				return cause.message;
			}
			return t("empty.error");
		}
		function JobNote({ tone, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: tone === void 0 ? "jobNote" : `jobNote ${tone}`,
				children: [
					tone === "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "ongoing",
						size: 12
					}),
					tone === "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "done",
						size: 12
					}),
					tone === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "error",
						size: 12
					}),
					children
				]
			});
		}
		const pendingScriptDrafts = /* @__PURE__ */ new Map();
		function scriptMatchesSaved(draft, saved) {
			const fileText = draft.trim() === "" ? "" : draft.endsWith("\n") ? draft : `${draft}\n`;
			return draft === saved || fileText === saved;
		}
		const projectNavigation = /* @__PURE__ */ new Map();
		function ContentInspector({ production, t, suspended = false, ready, getContent, getProjectView, getCoverThumb, getCoverState, coverAction, getCoverImage, prepareCoverDraft, prepareCoverRequest, getVideoPlayback, startVideoImport, getVideoImport, cancelVideoImport, selectVideo, setVideoVisibility, getArticleMedia, getSubtitleText, getSettings, setPublish, startSubtitleGenerate, startSubtitleBurn, startCoverGenerate, setScript, openSubtitlePreview, openPath }) {
			const tabGroupId = (0, react.useId)();
			const tabRefs = (0, react.useRef)([]);
			const [selectedId, setSelectedId] = useSelectedContentId();
			const libraryEpoch = useLibraryEpoch();
			const profileEpoch = useProfileEpoch();
			const [enabledPlatforms, setEnabledPlatforms] = (0, react.useState)(void 0);
			const scriptSavedRef = (0, react.useRef)(true);
			const loadedFolder = (0, react.useRef)(null);
			const loadedId = (0, react.useRef)(null);
			const pane = (0, react.useRef)(null);
			const [loadedDetail, setDetail] = (0, react.useState)(void 0);
			const detail = loadedDetail?.id === selectedId ? loadedDetail : void 0;
			const [cues, setCues] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(void 0);
			const [tab, setTab] = (0, react.useState)("overview");
			const [publicationArticle, setPublicationArticle] = (0, react.useState)();
			const [overviewTarget, setOverviewTarget] = (0, react.useState)();
			const tabMemory = (0, react.useRef)(projectNavigation);
			const navigationKey = (0, react.useRef)();
			const changeTab = (next) => {
				setOverviewTarget(void 0);
				if (detail) tabMemory.current.set(detail.folderPath, {
					tab: next,
					scroll: tabMemory.current.get(detail.folderPath)?.scroll ?? {}
				});
				setTab(next);
			};
			const [wide, setWide] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)(void 0);
			const [scriptRequest, setScriptRequest] = (0, react.useState)("idle");
			const [scriptRequestError, setScriptRequestError] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(void 0);
			const expectSubtitlePreview = (0, react.useRef)(false);
			const [scriptDraft, setScriptDraft] = (0, react.useState)("");
			const [scriptSaved, setScriptSaved] = (0, react.useState)(true);
			const [scriptError, setScriptError] = (0, react.useState)();
			const [scriptRetry, setScriptRetry] = (0, react.useState)(0);
			scriptSavedRef.current = scriptSaved;
			const [articleOrigin, setArticleOrigin] = (0, react.useState)(void 0);
			const [publishPending, setPublishPending] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setTab("overview");
				setPublicationArticle(void 0);
				setActionError(void 0);
				setScriptRequest("idle");
				setScriptRequestError("");
				setScriptDraft("");
				setScriptSaved(true);
				setScriptError(void 0);
				setArticleOrigin(void 0);
				setBusy(void 0);
				expectSubtitlePreview.current = false;
				setPublishPending(null);
			}, [selectedId]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				if (!ready()) {
					setEnabledPlatforms([]);
					return () => {
						cancelled = true;
					};
				}
				getSettings().then((settings) => {
					if (!cancelled) setEnabledPlatforms(settings.profile.enabledPlatforms);
				}, () => {
					if (!cancelled) setEnabledPlatforms([]);
				});
				return () => {
					cancelled = true;
				};
			}, [
				getSettings,
				profileEpoch,
				ready
			]);
			(0, react.useEffect)(() => {
				const el = pane.current;
				if (el === null) return;
				const update = () => {
					setWide(el.getBoundingClientRect().width >= INSPECTOR_WIDE_PX);
				};
				update();
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(() => {
					update();
				});
				observer.observe(el);
				return () => {
					observer.disconnect();
				};
			}, []);
			(0, react.useEffect)(() => {
				if (suspended) return;
				if (selectedId === null) {
					loadedId.current = null;
					setDetail(void 0);
					setCues([]);
					setError(void 0);
					return;
				}
				if (!ready()) {
					setError(t("empty.remote"));
					return;
				}
				const switched = loadedId.current !== selectedId;
				let cancelled = false;
				setError(void 0);
				Promise.all([getProjectView && tab !== "script" ? getProjectView(selectedId).then((view) => view.detail) : getContent(selectedId), tab === "subtitle" ? getSubtitleText(selectedId) : Promise.resolve({
					text: "",
					cues: []
				})]).then(([nextDetail, nextSubtitle]) => {
					if (cancelled) return;
					if (navigationKey.current !== nextDetail.folderPath) {
						navigationKey.current = nextDetail.folderPath;
						setTab(tabMemory.current.get(nextDetail.folderPath)?.tab ?? "overview");
					}
					loadedId.current = selectedId;
					setDetail(nextDetail);
					if ((!getProjectView || tab === "script") && (switched || loadedFolder.current !== nextDetail.folderPath || scriptSavedRef.current)) {
						const draft = pendingScriptDrafts.get(nextDetail.folderPath) ?? nextDetail.script;
						setScriptDraft(draft);
						setScriptSaved(scriptMatchesSaved(draft, nextDetail.script));
					}
					loadedFolder.current = nextDetail.folderPath;
					setCues(cuesFromSubtitle(nextSubtitle));
				}, (cause) => {
					if (cancelled) return;
					if (switched) {
						setDetail(void 0);
						setCues([]);
					}
					setError(friendlyError(cause, t));
				});
				return () => {
					cancelled = true;
				};
			}, [
				selectedId,
				libraryEpoch,
				suspended,
				tab === "script",
				tab === "subtitle"
			]);
			(0, react.useEffect)(() => {
				if (production || suspended || tab !== "article" || selectedId === null || !ready()) return;
				let cancelled = false;
				getArticleMedia(selectedId).then((next) => {
					if (cancelled) return;
					setArticleOrigin(next.found ? next.origin : void 0);
				}, () => {
					if (!cancelled) setArticleOrigin(void 0);
				});
				return () => {
					cancelled = true;
				};
			}, [
				tab,
				selectedId,
				libraryEpoch,
				suspended
			]);
			(0, react.useEffect)(() => {
				if (suspended || detail === void 0 || scriptSaved) return;
				let cancelled = false;
				const folder = detail.folderPath;
				setScriptError(void 0);
				const timer = window.setTimeout(() => {
					setScript(detail.id, scriptDraft, folder).then((next) => {
						if (pendingScriptDrafts.get(folder) === scriptDraft && scriptMatchesSaved(scriptDraft, next.script)) pendingScriptDrafts.delete(folder);
						if (cancelled) return;
						setDetail(next);
						setScriptSaved(scriptMatchesSaved(scriptDraft, next.script));
					}, (cause) => {
						if (!cancelled) setScriptError(cause instanceof Error ? cause.message : t("empty.error"));
					});
				}, 700);
				return () => {
					cancelled = true;
					window.clearTimeout(timer);
				};
			}, [
				detail?.id,
				detail?.folderPath,
				scriptDraft,
				scriptSaved,
				suspended,
				scriptRetry
			]);
			(0, react.useEffect)(() => {
				const running = detail?.burn.status === "running" || detail?.subtitleJob.status === "running" || detail?.coverJob.status === "running";
				if (production || suspended || !running || selectedId === null || !ready()) return;
				const timer = window.setInterval(() => {
					getContent(selectedId).then((next) => {
						setDetail(next);
					});
				}, 3e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [
				selectedId,
				detail?.burn.status,
				detail?.subtitleJob.status,
				detail?.coverJob.status,
				suspended
			]);
			(0, react.useEffect)(() => {
				if (suspended || selectedId === null || detail?.subtitleJob.status !== "done" || !ready()) return;
				getSubtitleText(selectedId).then((nextSubtitle) => {
					setCues(cuesFromSubtitle(nextSubtitle));
				});
			}, [
				selectedId,
				detail?.subtitleJob.status,
				suspended
			]);
			(0, react.useEffect)(() => {
				if (suspended || !expectSubtitlePreview.current || selectedId === null || !ready()) return;
				if (detail?.subtitleJob.status === "done") {
					expectSubtitlePreview.current = false;
					openSubtitlePreview(selectedId).then(() => void 0, (cause) => {
						setActionError(cause instanceof Error ? cause.message : t("empty.error"));
					});
					return;
				}
				if (detail?.subtitleJob.status === "error") expectSubtitlePreview.current = false;
			}, [
				selectedId,
				detail?.subtitleJob.status,
				suspended
			]);
			const applyPublish = (platform, status) => {
				if (publishPending !== null || detail === void 0 || detail.publish[platform].status === status) return;
				setPublishPending(platform);
				const scope = detail.folderPath, id = selectedId;
				const isCurrentSelection = captureContentSelection();
				setPublish(detail.id, platform, status, void 0, scope).then((next) => {
					if (!isCurrentSelection() || loadedFolder.current !== scope || loadedId.current !== id) return;
					setDetail(next);
					setPublishPending(null);
				}, (cause) => {
					if (!isCurrentSelection() || loadedFolder.current !== scope || loadedId.current !== id) return;
					setActionError(cause instanceof Error ? cause.message : t("empty.error"));
					setPublishPending(null);
				});
			};
			if (selectedId === null) return null;
			const hasVideo = detail?.videoRaw !== void 0 || detail?.videoSubtitled !== void 0;
			const hasSubtitleDraft = detail?.subtitles.srt !== void 0 || detail?.subtitles.transcript !== void 0;
			const canPreviewSubtitle = hasSubtitleDraft || detail?.subtitleJob.status === "done";
			const subtitleFeedback = production ? {
				status: "idle",
				error: void 0
			} : detail?.subtitleJob;
			detail !== void 0 && (detail.covers["3x4"] !== void 0 || detail.covers["4x3"] !== void 0 || detail.covers["16x9"]);
			const onGenerateSubtitle = () => {
				if (detail === void 0) return;
				if (detail.videoRaw === void 0 && detail.videoSubtitled === void 0) {
					setActionError(t("inspector.subtitle.needVideo"));
					return;
				}
				if (!detail.secrets.subtitle.configured) {
					setActionError(t("inspector.subtitle.needKey"));
					return;
				}
				setActionError(void 0);
				setBusy("subtitle");
				expectSubtitlePreview.current = true;
				startSubtitleGenerate(detail.id).then((next) => {
					setDetail(next);
					setBusy(void 0);
				}, (cause) => {
					expectSubtitlePreview.current = false;
					setActionError(cause instanceof Error ? cause.message : t("empty.error"));
					setBusy(void 0);
				});
			};
			const onBurnSubtitle = () => {
				if (detail === void 0) return;
				if (detail.videoRaw === void 0) {
					setActionError(t("inspector.subtitle.needVideo"));
					return;
				}
				if (!hasSubtitleDraft && detail.subtitleJob.status !== "done") {
					setActionError(t("inspector.subtitle.needDraft"));
					return;
				}
				setActionError(void 0);
				setBusy("burn");
				startSubtitleBurn(detail.id).then((next) => {
					setDetail(next);
					setBusy(void 0);
				}, (cause) => {
					setActionError(cause instanceof Error ? cause.message : t("empty.error"));
					setBusy(void 0);
				});
			};
			const onPreviewSubtitle = () => {
				if (detail === void 0) return;
				openSubtitlePreview(detail.id).then(() => void 0, (cause) => {
					setActionError(cause instanceof Error ? cause.message : t("empty.error"));
				});
			};
			(0, react.useEffect)(() => {
				if (!detail) return;
				const body = pane.current?.querySelector(".body");
				if (body) body.scrollTop = tabMemory.current.get(detail.folderPath)?.scroll[tab] ?? 0;
			}, [tab, detail?.folderPath]);
			const moveTabFocus = (event, index) => {
				let target = index;
				if (event.key === "ArrowRight") target = (index + 1) % TABS.length;
				else if (event.key === "ArrowLeft") target = (index - 1 + TABS.length) % TABS.length;
				else if (event.key === "Home") target = 0;
				else if (event.key === "End") target = TABS.length - 1;
				else return;
				event.preventDefault();
				const next = TABS[target];
				if (next === void 0) return;
				setTab(next);
				tabRefs.current[target]?.focus({ preventScroll: true });
			};
			const prepareScript = async (append = false) => {
				if (!detail || !production?.prepareRequest || scriptRequest === "preparing") return;
				const current = captureContentSelection(), folder = detail.folderPath;
				setScriptRequest("preparing");
				setScriptRequestError("");
				try {
					await production.prepareRequest(detail, `请${detail.script ? "修改" : "编写"}本项目的口播脚本或拍摄提纲。先读取已有写稿偏好和选题，按我的要求完成并保存 script.md。`, append);
					if (current() && loadedFolder.current === folder) setScriptRequest("ready");
				} catch (error) {
					if (current() && loadedFolder.current === folder) {
						setScriptRequest("failed");
						setScriptRequestError(error instanceof Error ? error.message : "脚本请求未准备好，请重试。");
					}
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: pane,
				"data-plugin": "dsh-creator-workbench",
				"data-surface": "inspector",
				className: wide ? "wide" : void 0,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ImagePreviewProvider, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "header",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "titleRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "title",
							title: detail?.title,
							children: detail?.title ?? (error === void 0 ? t("empty.loading") : "")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "titleActions",
							children: [detail !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "close",
								"aria-label": t("inspector.openFolder"),
								onClick: () => {
									openPath(detail.folderPath);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenOutlineRegular, { size: 14 })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								"data-detail-focus": "true",
								type: "button",
								className: "close",
								"aria-label": t("inspector.close"),
								onClick: () => {
									setSelectedId(null);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 14 })
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectionRail, {
						as: "div",
						selected: tab,
						indicator: "underline",
						className: "tabs",
						role: "tablist",
						children: TABS.map((id, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							ref: (node) => {
								tabRefs.current[index] = node;
							},
							id: `${tabGroupId}-tab-${id}`,
							type: "button",
							role: "tab",
							"aria-selected": tab === id,
							"aria-controls": `${tabGroupId}-panel-${id}`,
							tabIndex: tab === id ? 0 : -1,
							className: tab === id ? "tab active" : "tab",
							onClick: () => {
								changeTab(id);
							},
							onKeyDown: (event) => {
								moveTabFocus(event, index);
							},
							children: t(TAB_KEY[id])
						}, id))
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectBoundary, {
					api: production,
					detail,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						id: `${tabGroupId}-panel-${tab}`,
						className: "body",
						onScroll: (event) => {
							if (detail) {
								const previous = tabMemory.current.get(detail.folderPath);
								tabMemory.current.set(detail.folderPath, {
									tab,
									scroll: {
										...previous?.scroll,
										[tab]: event.currentTarget.scrollTop
									}
								});
							}
						},
						role: "tabpanel",
						"aria-labelledby": `${tabGroupId}-tab-${tab}`,
						children: [
							error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "empty",
								children: error
							}),
							error === void 0 && detail === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "empty",
								children: t("empty.loading")
							}),
							detail !== void 0 && tab === "overview" && (production ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewPage, {
								detail,
								api: production,
								getVideoPlayback,
								getCoverImage,
								navigate: (next, id) => {
									changeTab(next);
									setOverviewTarget(id ? {
										folder: detail.folderPath,
										tab: next,
										id
									} : void 0);
									if (next === "publishing") setPublicationArticle(void 0);
								}
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "projectOverview",
								children: TABS.filter((t) => t !== "overview").map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "projectSummaryRow",
									onClick: () => changeTab(id),
									children: t(TAB_KEY[id])
								}, id))
							})),
							detail !== void 0 && tab === "video" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(VideoPanel, {
								detail,
								t,
								getVideoPlayback,
								startVideoImport,
								getVideoImport,
								cancelVideoImport,
								selectVideo,
								setVideoVisibility
							}, detail.folderPath), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionBar, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								tone: "ghost",
								onClick: () => changeTab("images"),
								children: "查看视频封面"
							}) })] }),
							detail !== void 0 && tab === "images" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [production && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageLibraryPanel, {
								detail,
								api: production
							}), (hasVideo || Object.keys(detail.covers).length > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CoverPanel, {
								detail,
								...production ? { api: production } : {},
								getCoverState,
								coverAction,
								getCoverImage,
								prepareCoverDraft,
								...prepareCoverRequest ? { prepareCoverRequest } : {}
							})] }),
							detail !== void 0 && tab === "publishing" && production && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PublicationPanel, {
								detail,
								api: production,
								getCoverImage,
								enabledPlatforms: enabledPlatforms ?? [],
								onPublish: applyPublish,
								publishPending,
								openPath,
								...publicationArticle ? { initialArticleId: publicationArticle } : {},
								...overviewTarget?.folder === detail.folderPath && overviewTarget.tab === "publishing" ? { initialPublicationId: overviewTarget.id } : {}
							}, `publishing:${detail.folderPath}`),
							detail !== void 0 && tab === "script" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								production?.prepareRequest && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionBar, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: scriptRequest === "preparing",
									onClick: () => void prepareScript(),
									children: scriptRequest === "preparing" ? "正在准备请求…" : detail.script ? "让 Agent 修改脚本" : "让 Agent 写脚本"
								}) }),
								scriptRequest === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "status",
									className: "creatorMuted",
									children: "请求已放入左侧对话，请发送。"
								}),
								scriptRequestError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									role: "alert",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "creatorError",
										children: scriptRequestError
									}), scriptRequestError.includes("已有草稿") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => void prepareScript(true),
										children: "追加脚本请求"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "scriptStatus",
									role: "status",
									children: scriptError ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "creatorError",
										children: ["保存失败：", scriptError]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => setScriptRetry((n) => n + 1),
										children: "重试保存"
									})] }) : scriptSaved ? "已保存" : "保存中…"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									"aria-label": "脚本正文",
									className: "scriptEditor",
									value: scriptDraft,
									placeholder: t("inspector.script.placeholder"),
									onChange: (event) => {
										const saved = scriptMatchesSaved(event.target.value, detail.script);
										if (saved) pendingScriptDrafts.delete(detail.folderPath);
										else pendingScriptDrafts.set(detail.folderPath, event.target.value);
										setScriptDraft(event.target.value);
										setScriptError(void 0);
										setScriptSaved(saved);
									}
								})
							] }),
							detail !== void 0 && tab === "article" && production && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArticlePanel, {
								detail,
								api: production,
								openPath,
								...overviewTarget?.folder === detail.folderPath && overviewTarget.tab === "article" ? { initialArticleId: overviewTarget.id } : {},
								goPublish: (id) => {
									setOverviewTarget(void 0);
									setPublicationArticle(id);
									changeTab("publishing");
								}
							}, `article:${detail.folderPath}`),
							detail !== void 0 && tab === "article" && !production && (detail.article.trim() === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "empty",
								children: t("inspector.article.empty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "article",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
									labels: {
										code: {
											copyLabel: t("markdown.copy"),
											copiedLabel: t("markdown.copied")
										},
										footnotes: t("markdown.footnotes")
									},
									text: articleOrigin === void 0 ? detail.article : rewriteArticleImages(detail.article, articleOrigin)
								})
							})),
							detail !== void 0 && tab === "subtitle" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								production && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubtitlePanel, {
									detail,
									api: production,
									openPath
								}, `subtitle:${detail.folderPath}`),
								hasVideo && !production && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [
									canPreviewSubtitle && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: "ghost",
										onClick: onPreviewSubtitle,
										children: t("inspector.subtitle.previewEdit")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: !hasSubtitleDraft && detail.videoSubtitled === void 0 ? "primary" : "secondary",
										onClick: onGenerateSubtitle,
										disabled: busy !== void 0 || detail.subtitleJob.status === "running" || detail.burn.status === "running",
										children: t(!hasSubtitleDraft ? "inspector.subtitle.generate" : "inspector.subtitle.regenerate")
									}),
									hasSubtitleDraft && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: detail.videoSubtitled === void 0 ? "primary" : "secondary",
										onClick: onBurnSubtitle,
										disabled: busy !== void 0 || detail.subtitleJob.status === "running" || detail.burn.status === "running",
										children: t(detail.videoSubtitled === void 0 ? "inspector.subtitle.burn" : "inspector.subtitle.reburn")
									})
								] }),
								actionError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobNote, {
									tone: "error",
									children: actionError
								}) : subtitleFeedback?.status === "running" || detail.burn.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobNote, {
									tone: "running",
									children: t(subtitleFeedback?.status === "running" ? "inspector.subtitle.generating" : "inspector.subtitle.burning")
								}) : subtitleFeedback?.status === "error" || detail.burn.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobNote, {
									tone: "error",
									children: (subtitleFeedback?.error ?? detail.burn.error ?? "").includes("process exited") ? t("inspector.subtitle.burnFailed") : subtitleFeedback?.error ?? detail.burn.error ?? t("inspector.subtitle.burnFailed")
								}) : null,
								cues.length === 0 ? !production && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "empty",
									children: t("inspector.subtitle.empty")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
									className: "cues",
									children: cues.map((cue, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: "cue",
										children: [cue.at !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "cueTime",
											children: cue.at
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "cueText",
											children: cue.text
										})]
									}, `${cue.at ?? "cue"}-${index}`))
								})
							] })
						]
					})
				})] }, detail?.folderPath ?? "empty")
			});
		}
		function ProjectBoundary({ api, detail, children }) {
			return api && detail ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectDataProvider, {
				api,
				scope: {
					id: detail.id,
					folderPath: detail.folderPath
				},
				children
			}, detail.folderPath) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children });
		}
		//#endregion
		//#region src/projectNames.ts
		/** Shared by creation and its path preview; contains no filesystem or UI dependencies. */
		function projectTitle(title) {
			return title.trim().replace(/[\\/:*?"<>|\n\r]/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/, "");
		}
		function datedProjectName(title, now = /* @__PURE__ */ new Date()) {
			return `${`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`}_${projectTitle(title)}`;
		}
		//#endregion
		//#region src/client/CoverThumb.tsx
		function coverThumbRevision(covers) {
			return `${covers["3x4"] ?? ""}|${covers["4x3"] ?? ""}|${covers["16x9"] ?? ""}`;
		}
		function CoverThumb({ id, load, fallback = null, revision = 0 }) {
			const [src, setSrc] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				setSrc(void 0);
			}, [id]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				load(id).then((thumb) => {
					if (cancelled || !thumb.found) return;
					setSrc(`data:${thumb.mime};base64,${thumb.base64}`);
				});
				return () => {
					cancelled = true;
				};
			}, [
				id,
				load,
				revision
			]);
			if (src === void 0) return fallback;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				src,
				alt: ""
			});
		}
		//#endregion
		//#region src/client/relativeTime.ts
		function formatRelativeTime(recordedAt, now, t) {
			const delta = now - recordedAt;
			if (delta < 45e3) return t("time.justNow");
			if (delta < 36e5) return t("time.minutes").replace("{n}", String(Math.max(1, Math.round(delta / 6e4))));
			if (delta < 864e5) return t("time.hours").replace("{n}", String(Math.max(1, Math.round(delta / 36e5))));
			const days = Math.round(delta / 864e5);
			if (days === 1) return t("time.yesterday");
			if (days < 7) return t("time.days").replace("{n}", String(days));
			const date = new Date(recordedAt);
			const current = new Date(now);
			if (date.getFullYear() === current.getFullYear()) return t("time.monthDay").replace("{m}", String(date.getMonth() + 1)).replace("{d}", String(date.getDate()));
			return t("time.yearMonthDay").replace("{y}", String(date.getFullYear())).replace("{m}", String(date.getMonth() + 1)).replace("{d}", String(date.getDate()));
		}
		//#endregion
		//#region src/client/workflowTone.ts
		const WORKFLOW_TONE = {
			idle: "neutral",
			finish: "pending",
			publish: "pending",
			live: "success"
		};
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/sidebar/ContentSidebarPanel.css.mjs
		registerPluginCss("dsh-creator-workbench/ContentSidebarPanel.css", "[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"].contentPanel {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-width: 0;\n  min-height: 0;\n  height: auto;\n  padding-right: var(--dsh-sidebar-inline-padding, 12px);\n  box-sizing: border-box;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentHeader {\n  flex: none;\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 4px;\n  height: 36px;\n  padding-left: 4px;\n  margin: 2px -4px 4px 0;\n  box-sizing: border-box;\n  border-radius: var(--dsw-radius-lg);\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchSlot {\n  flex: 1;\n  max-width: 28px;\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  margin-left: auto;\n  padding-left: 0;\n  box-sizing: border-box;\n  transition:\n    max-width 180ms var(--ds-ease-in-out),\n    padding-left 180ms var(--ds-ease-in-out);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchSlot.expanded {\n  max-width: 100%;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentSearch {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 0;\n  width: 100%;\n  height: 28px;\n  margin: 0;\n  padding: 0;\n  box-sizing: border-box;\n  border: none;\n  border-radius: 50%;\n  background: transparent;\n  cursor: text;\n  color: var(--dsw-alias-label-secondary);\n  overflow: hidden;\n  transition:\n    width 180ms var(--ds-ease-in-out),\n    padding 180ms var(--ds-ease-in-out),\n    border-color 180ms var(--ds-ease-in-out),\n    background-color 180ms var(--ds-ease-in-out);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentSearch.expanded {\n  width: calc(100% + 4px);\n  height: 30px;\n  margin-inline: -2px;\n  padding: 0 4px 0 0;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 10px;\n  background: transparent;\n  color: var(--dsw-alias-label-caption);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchButton {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  border: none;\n  border-radius: 50%;\n  background: transparent;\n  color: inherit;\n  cursor: pointer;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentSearch.expanded .searchButton {\n  width: 28px;\n  height: 30px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .iconButton {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  border: none;\n  border-radius: 50%;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchButton:hover,\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .iconButton:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchButton:focus-visible,\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .iconButton:focus-visible,\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .clearButton:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentSearch.expanded .searchButton:hover {\n  background: transparent;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchInput {\n  flex: 1;\n  width: 0;\n  min-width: 0;\n  border: none;\n  outline: none;\n  background: transparent;\n  opacity: 0;\n  pointer-events: none;\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  line-height: 18px;\n  transition: opacity 120ms var(--ds-ease-in-out);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentSearch.expanded .searchInput {\n  margin-left: -2px;\n  opacity: 1;\n  pointer-events: auto;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchInput::placeholder {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .clearButton {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 24px;\n  height: 24px;\n  padding: 0;\n  border: none;\n  border-radius: 50%;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .clearButton:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .headerActions {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  max-width: 64px;\n  opacity: 1;\n  overflow: hidden;\n  visibility: visible;\n  transition:\n    max-width 180ms var(--ds-ease-in-out),\n    opacity 120ms var(--ds-ease-in-out),\n    transform 180ms var(--ds-ease-in-out),\n    visibility 0s linear;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .headerActions.hidden {\n  max-width: 0;\n  opacity: 0;\n  transform: translateX(4px);\n  visibility: hidden;\n  pointer-events: none;\n  transition-delay: 0s, 0s, 0s, 180ms;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentList {\n  flex: 1;\n  min-width: 0;\n  min-height: 0;\n  overflow: auto;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentEmpty {\n  padding: 16px 8px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n  line-height: 20px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentRow {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  width: 100%;\n  min-height: 64px;\n  box-sizing: border-box;\n  margin: 0 0 4px;\n  padding: 8px;\n  border: none;\n  border-radius: 10px;\n  background: transparent;\n  color: inherit;\n  text-align: left;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentRowSelect {\n  display: flex;\n  align-items: center;\n  flex: 1;\n  gap: 10px;\n  min-width: 0;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .removedContents {\n  padding: 8px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .removedContentRow {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  margin-top: 6px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .removedContentRow > span {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentRow:hover,\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentRow.selected {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentRowSelect:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .rowCover {\n  flex: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 48px;\n  height: 64px;\n  overflow: hidden;\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .rowCover img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .coverFallback {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .rowBody {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-width: 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .rowTitle {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 14px;\n  line-height: 20px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"create-dialog\"] {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  width: 100%;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .createField,\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"create-dialog\"] .createField {\n  display: flex;\n  flex-direction: column;\n  align-items: stretch;\n  gap: 8px;\n  width: 100%;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"create-dialog\"] .createLabel {\n  display: block;\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n  line-height: 20px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"create-dialog\"] .createInput {\n  display: flex;\n  width: 100%;\n  box-sizing: border-box;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .createError,\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"create-dialog\"] .createError {\n  margin-top: 0;\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .rowMeta {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .rowCover .coverFallback {\n  opacity: 0.5;\n}\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .rowDate {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 17px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchSlot,\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .contentSearch,\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .searchInput,\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"library\"] .headerActions {\n    transition: none;\n  }\n}\n\n[data-plugin=\"dsh-creator-workbench\"] .contentHeader { position:relative; }\n[data-plugin=\"dsh-creator-workbench\"] .contentRefreshStatus { position:absolute; inset-inline-end:0; top:0; color:var(--dsw-alias-label-secondary); }\n\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"create-dialog\"] .createPath { color:var(--dsw-alias-label-secondary); font-size:12px; overflow-wrap:anywhere; line-height:1.5; }\n\n[data-plugin=\"dsh-creator-workbench\"] .rowLocation { display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px; }\n\n[data-plugin=\"dsh-creator-workbench\"] .contentRow>.creatorMenu>button { min-width:32px;padding-inline:4px; }\n");
		//#endregion
		//#region src/client/sidebar/ContentSidebarPanel.tsx
		function sortByRecency(items) {
			return [...items].sort((a, b) => {
				if (a.recordedAt !== b.recordedAt) return b.recordedAt - a.recordedAt;
				return b.createdMs - a.createdMs;
			});
		}
		function ContentSidebarPanel({ t, suspended = false, ready, captureNavigation, listContents, getCoverThumb, refreshCatalog, createContent, getSettings, getProjectLocations, pickDirectory, setContentVisibility, inspectProject, removeProject, joinProject }) {
			const requestVersion = (0, react.useRef)(0);
			const listLifetime = (0, react.useRef)({
				mounted: true,
				suspended,
				generation: 0
			});
			listLifetime.current.suspended = suspended;
			(0, react.useEffect)(() => {
				listLifetime.current.mounted = true;
				return () => {
					listLifetime.current.mounted = false;
					listLifetime.current.generation += 1;
					requestVersion.current += 1;
				};
			}, []);
			const [query, setQuery] = (0, react.useState)("");
			const [searchOpen, setSearchOpen] = (0, react.useState)(false);
			const searchRoot = (0, react.useRef)(null);
			const searchInput = (0, react.useRef)(null);
			const libraryEpoch = useLibraryEpoch();
			const profileEpoch = useProfileEpoch();
			const [selectedId, setSelectedId] = useSelectedContentId();
			const selectedIdRef = (0, react.useRef)(selectedId);
			selectedIdRef.current = selectedId;
			const [items, setItems] = (0, react.useState)([]);
			const [removalTasks, setRemovalTasks] = (0, react.useState)([]);
			const [inspecting, setInspecting] = (0, react.useState)(false);
			const [deleteItem, setDeleteItem] = (0, react.useState)(null);
			const [updatingId, setUpdatingId] = (0, react.useState)(null);
			const currentEpoch = (0, react.useRef)(libraryEpoch);
			currentEpoch.current = libraryEpoch;
			const [error, setError] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(false);
			const [creating, setCreating] = (0, react.useState)(false);
			const [createOpen, setCreateOpen] = (0, react.useState)(false);
			const [createName, setCreateName] = (0, react.useState)("");
			const [createParent, setCreateParent] = (0, react.useState)("");
			const [parents, setParents] = (0, react.useState)([]);
			const [parentBusy, setParentBusy] = (0, react.useState)(false);
			const createRequest = (0, react.useRef)(crypto.randomUUID());
			const pickingParent = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (!createOpen) return;
				let live = true;
				setParentBusy(true);
				setCreateError(void 0);
				setCreateParent("");
				createRequest.current = crypto.randomUUID();
				(getProjectLocations?.() ?? getSettings()).then((settings) => {
					if (!live) return;
					setParents(settings.projectLocations?.map((p) => p.path) ?? [settings.libraryRoot]);
					setCreateParent(settings.libraryConfirmed ? settings.libraryRoot : "");
				}, (cause) => {
					if (live) setCreateError(cause instanceof Error ? cause.message : "保存位置读取失败，请重试。");
				}).finally(() => {
					if (live) setParentBusy(false);
				});
				return () => {
					live = false;
				};
			}, [createOpen]);
			const chooseParent = async () => {
				if (pickingParent.current) return;
				pickingParent.current = true;
				setParentBusy(true);
				try {
					const path = await pickDirectory();
					if (path) {
						setCreateError(void 0);
						setParents((values) => [.../* @__PURE__ */ new Set([...values, path])]);
						setCreateParent(path);
						createRequest.current = crypto.randomUUID();
					}
				} catch (cause) {
					setCreateError(cause instanceof Error ? cause.message : "目录选择失败。");
				} finally {
					pickingParent.current = false;
					setParentBusy(false);
				}
			};
			const [createError, setCreateError] = (0, react.useState)(void 0);
			const loadList = async (nextQuery = query) => {
				if (!listLifetime.current.mounted || listLifetime.current.suspended) return;
				const lifetime = listLifetime.current.generation;
				const isLive = () => listLifetime.current.mounted && !listLifetime.current.suspended && lifetime === listLifetime.current.generation;
				const ticket = ++requestVersion.current;
				const libraryAtStart = getLibraryEpoch(), profileAtStart = getProfileEpoch();
				if (!ready()) {
					setError(t("empty.remote"));
					return;
				}
				setLoading(true);
				setError(void 0);
				try {
					const result = await listContents(nextQuery, "all");
					if (!isLive() || ticket !== requestVersion.current || libraryAtStart !== getLibraryEpoch() || profileAtStart !== getProfileEpoch()) return;
					setItems(sortByRecency(result.items));
					if (result.cleanupWarnings?.length) setError(result.cleanupWarnings.join("；"));
					const currentId = selectedIdRef.current;
					if (nextQuery === "" && currentId !== null && !result.items.some((item) => item.id === currentId)) {
						const old = result.items.filter((item) => item.folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) === currentId);
						setSelectedId(old.length === 1 ? old[0].id : null);
					}
				} catch (cause) {
					if (isLive() && ticket === requestVersion.current) setError(cause instanceof Error ? cause.message : t("empty.error"));
				} finally {
					if (isLive() && ticket === requestVersion.current) setLoading(false);
				}
			};
			(0, react.useEffect)(() => {
				requestVersion.current += 1;
				if (suspended) setDeleteItem(null);
				if (suspended) return;
				const handle = window.setTimeout(() => {
					loadList(query);
				}, 200);
				return () => {
					requestVersion.current += 1;
					window.clearTimeout(handle);
				};
			}, [
				query,
				libraryEpoch,
				profileEpoch,
				suspended
			]);
			(0, react.useEffect)(() => {
				if (!searchOpen) return;
				searchInput.current?.focus({ preventScroll: true });
			}, [searchOpen]);
			(0, react.useEffect)(() => {
				if (!searchOpen) return;
				const onClick = (event) => {
					if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return;
					searchInput.current?.blur();
					if (query !== "") return;
					setSearchOpen(false);
				};
				document.addEventListener("click", onClick);
				return () => {
					document.removeEventListener("click", onClick);
				};
			}, [searchOpen, query]);
			const closeSearch = () => {
				setQuery("");
				setSearchOpen(false);
			};
			const closeCreate = () => {
				if (creating || parentBusy) return;
				setCreateOpen(false);
				setCreateName("");
				setCreateError(void 0);
			};
			const onCreate = async () => {
				const title = createName.trim();
				if (title === "" || creating || parentBusy || !createParent) return;
				const isCurrent = captureNavigation();
				const originalSelection = selectedIdRef.current;
				setCreating(true);
				setCreateError(void 0);
				try {
					const created = await createContent(title, createParent, createRequest.current);
					if (!isCurrent()) return;
					setCreateOpen(false);
					setCreateName("");
					await loadList(query);
					if (isCurrent() && selectedIdRef.current === originalSelection) setSelectedId(created.id);
				} catch (cause) {
					setCreateError(cause instanceof Error ? cause.message : t("create.failed"));
				} finally {
					setCreating(false);
				}
			};
			const changeVisibility = async (item, hidden) => {
				if (updatingId || suspended) return;
				const selectionCurrent = captureContentSelection();
				setUpdatingId(item.id);
				setError(void 0);
				try {
					if (hidden && removeProject) await removeProject(item.id, item.folderPath, removalTasks.length > 0);
					else await setContentVisibility(item.id, item.folderPath, hidden);
					requestVersion.current += 1;
					if (hidden) setItems((rows) => rows.filter((row) => row.folderPath !== item.folderPath));
					if (hidden && selectionCurrent() && selectedIdRef.current === item.id) setSelectedId(null);
					setDeleteItem(null);
					await loadList(query);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : t("empty.error"));
				} finally {
					setUpdatingId(null);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "contentPanel",
				"data-plugin": "dsh-creator-workbench",
				"data-surface": "library",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "contentHeader",
						children: [
							loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "contentRefreshStatus",
								role: "status",
								"aria-label": "正在读取",
								children: "·"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: searchOpen ? "searchSlot expanded" : "searchSlot",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									ref: searchRoot,
									className: searchOpen ? "contentSearch expanded" : "contentSearch",
									onClick: () => {
										if (searchOpen) return;
										setSearchOpen(true);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("toolbar.search"),
											delayMs: 500,
											disabled: searchOpen,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "searchButton",
												"aria-label": t("toolbar.search.aria"),
												"aria-expanded": searchOpen,
												onClick: () => {
													setSearchOpen(true);
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { size: searchOpen ? 11 : 14 })
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											ref: searchInput,
											className: "searchInput",
											value: query,
											placeholder: t("toolbar.search"),
											tabIndex: searchOpen ? 0 : -1,
											onChange: (event) => {
												setQuery(event.target.value);
											},
											onKeyDown: (event) => {
												if (event.key !== "Escape") return;
												closeSearch();
											}
										}),
										searchOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "clearButton",
											"aria-label": t("toolbar.search.clear"),
											onClick: (event) => {
												event.stopPropagation();
												closeSearch();
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFillRegular, {})
										})
									]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: searchOpen ? "headerActions hidden" : "headerActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("toolbar.refresh"),
									delayMs: 500,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "iconButton",
										"aria-label": t("toolbar.refresh"),
										disabled: loading,
										onClick: () => {
											setLoading(true);
											refreshCatalog().then(() => loadList(query), (cause) => {
												setLoading(false);
												setError(cause instanceof Error ? cause.message : t("empty.error"));
											});
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 16 })
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("toolbar.create"),
									delayMs: 500,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "iconButton",
										"aria-label": t("toolbar.create.aria"),
										onClick: () => {
											setCreateOpen(true);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutlineRegular, { size: 16 })
									})
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: createOpen,
						onClose: closeCreate,
						title: t("create.title"),
						closeLabel: t("create.cancel"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: creating,
							onClick: closeCreate,
							children: t("create.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: creating || parentBusy || !createParent || createName.trim() === "",
							onClick: () => {
								onCreate();
							},
							children: t("create.confirm")
						})] }),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-plugin": "dsh-creator-workbench",
							"data-surface": "create-dialog",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "createField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "createLabel",
										htmlFor: "oil-create-name",
										children: t("create.name")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										id: "oil-create-name",
										className: "createInput",
										value: createName,
										placeholder: t("create.name.placeholder"),
										autoFocus: true,
										disabled: creating,
										onChange: (event) => {
											setCreateName(event.target.value);
											createRequest.current = crypto.randomUUID();
										},
										onKeyDown: (event) => {
											if (event.key !== "Enter") return;
											event.preventDefault();
											onCreate();
										}
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "createField",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											className: "createLabel",
											htmlFor: "creator-create-parent",
											children: "保存到"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
											id: "creator-create-parent",
											value: createParent,
											disabled: creating || parentBusy,
											onValueChange: (value) => {
												setCreateParent(value);
												createRequest.current = crypto.randomUUID();
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												disabled: true,
												children: "选择父目录"
											}), parents.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: path,
												children: path
											}, path))]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "ghost",
											disabled: creating || parentBusy,
											onClick: () => {
												chooseParent();
											},
											children: "选择其他位置"
										}),
										createParent && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "createPath",
											title: createParent,
											children: [
												"预计路径：",
												createParent.replace(/[\\/]+$/, ""),
												createParent.includes("\\") ? "\\" : "/",
												datedProjectName(createName || "项目名称")
											]
										})
									]
								}),
								createError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "createError",
									children: createError
								}),
								joinProject && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									disabled: creating,
									onClick: () => {
										const selectionCurrent = captureContentSelection(), navigationCurrent = captureNavigation();
										setCreating(true);
										joinProject().then(async (item) => {
											if (item) {
												setCreateOpen(false);
												await loadList();
												if (selectionCurrent() && navigationCurrent()) setSelectedId(item.id);
											}
										}, (cause) => setCreateError(cause instanceof Error ? cause.message : String(cause))).finally(() => setCreating(false));
									},
									children: "使用已有目录"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: deleteItem !== null,
						onClose: () => {
							if (!updatingId) setDeleteItem(null);
						},
						title: "删除项目",
						closeLabel: "取消",
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: updatingId !== null,
							onClick: () => setDeleteItem(null),
							children: "取消"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							disabled: updatingId !== null || inspecting,
							onClick: () => {
								if (deleteItem) changeVisibility(deleteItem, true);
							},
							children: updatingId ? "正在删除…" : removalTasks.length ? "取消任务并移除" : "确认删除"
						})] }),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								"删除「",
								deleteItem?.title,
								"」并归档本项目的工作台会话？磁盘文件保留，以后可通过“使用已有目录”重新加入。"
							] }),
							inspecting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								children: "正在检查项目…"
							}),
							removalTasks.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								"将停止：",
								[...new Set(removalTasks)].join("、"),
								"。已生成的文件保留，远端结果不会撤回。"
							] }),
							error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								children: error
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "contentList",
						children: [
							error !== void 0 && !deleteItem && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "contentEmpty",
								role: "alert",
								children: [error, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									onClick: () => {
										loadList();
									},
									children: "重试"
								})]
							}),
							error === void 0 && items.length === 0 && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "contentEmpty",
								children: query ? "没有找到相关内容" : t("empty.library")
							}),
							items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								"data-content-id": item.id,
								className: item.id === selectedId ? "contentRow selected" : "contentRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "contentRowSelect",
									onClick: () => {
										setSelectedId(item.id === selectedId ? null : item.id);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "rowCover",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CoverThumb, {
											id: item.id,
											load: getCoverThumb,
											revision: coverThumbRevision(item.covers),
											fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineRegular, {
												className: "coverFallback",
												size: 20
											})
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "rowBody",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "rowTitle",
												title: `${item.title}\n${item.folderPath}`,
												children: item.title
											}),
											items.some((other) => other.id !== item.id && other.title === item.title) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "rowLocation",
												title: item.folderPath,
												children: item.folderPath
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "rowMeta",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusPill, {
													tone: item.accessError ? "pending" : WORKFLOW_TONE[item.workflow],
													children: item.accessError ? "暂不可访问" : t(`inspector.stage.${item.workflow}`)
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "rowDate",
													children: formatRelativeTime(item.recordedAt, Date.now(), t)
												})]
											})
										]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionMenu, {
									label: "更多",
									ariaLabel: `项目操作：${item.title}`,
									align: "end",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										tone: "ghost",
										"aria-label": `删除项目：${item.title}`,
										title: "删除项目",
										disabled: updatingId !== null,
										onClick: () => {
											setDeleteItem(item);
											setError(void 0);
											setRemovalTasks([]);
											if (inspectProject) {
												setInspecting(true);
												inspectProject(item.id, item.folderPath).then(setRemovalTasks, (cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setInspecting(false));
											}
										},
										children: "删除"
									})
								})]
							}, item.id))
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/ui/SecretInput.tsx
		/** Reveals only the current controlled input; stored credentials never enter this component. */
		function SecretInput(props) {
			const input = (0, react.useRef)(null), selection = (0, react.useRef)();
			const [visible, setVisible] = (0, react.useState)(false);
			(0, react.useLayoutEffect)(() => {
				const saved = selection.current;
				if (saved && input.current) {
					input.current.setSelectionRange(saved.start, saved.end, saved.direction ?? void 0);
					selection.current = void 0;
				}
			}, [visible]);
			(0, react.useLayoutEffect)(() => {
				if (!props.value) setVisible(false);
			}, [props.value]);
			const toggle = () => {
				const field = input.current;
				if (!field) return;
				selection.current = {
					start: field.selectionStart,
					end: field.selectionEnd,
					direction: field.selectionDirection
				};
				setVisible((value) => !value);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "creatorSecretInput",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					...props,
					ref: input,
					type: visible ? "text" : "password",
					autoComplete: "off",
					spellCheck: false
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "creatorSecretToggle",
					"aria-label": visible ? "隐藏密钥" : "显示密钥",
					"aria-pressed": visible,
					disabled: props.disabled || !props.value,
					onPointerDown: (event) => event.preventDefault(),
					onClick: toggle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
						width: "18",
						height: "18",
						viewBox: "0 0 24 24",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.6",
						"aria-hidden": "true",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "12",
								cy: "12",
								r: "2.6"
							}),
							visible && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m4 3 16 18" })
						]
					})
				})]
			});
		}
		PUBLISH_PLATFORMS.map((key) => ({
			key,
			id: PUBLISH_PLATFORM_DEFINITIONS[key].icon,
			label: PUBLISH_PLATFORM_DEFINITIONS[key].inspectorLabel
		}));
		const CREATOR_SETTINGS_PLATFORMS = PUBLISH_PLATFORMS.map((key) => ({
			key,
			label: PUBLISH_PLATFORM_DEFINITIONS[key].settingsLabel
		}));
		//#endregion
		//#region src/client/imageSettingsSave.ts
		async function saveImageForm(face, credentials, current, form, onPending) {
			const key = form.key.trim();
			if (key && !credentials) throw new Error("凭据服务暂不可用，请重试。");
			const pending = await face.beginImageUpdate({
				apiBase: form.apiBase,
				model: form.model,
				revision: current.revision,
				hasNewKey: !!key
			});
			onPending(pending);
			if (key) {
				let ok = false;
				try {
					ok = !!(await credentials.set({
						ref: IMAGE_CREDENTIAL,
						value: key
					})).result.ok;
				} catch {}
				if (!ok) throw new Error("API Key 保存失败，设置更新未完成。请保留输入并重试。");
			}
			return face.completeImageUpdate({
				token: pending.pending.token,
				keyUpdated: !!key
			});
		}
		//#endregion
		//#region src/client/directoryReply.ts
		/** A timed-out write remains uncertain; caller must read the original location result. */
		async function directoryReply(request, timeout = 15e3) {
			let timer;
			try {
				return await Promise.race([request, new Promise((_, reject) => {
					timer = setTimeout(() => reject(/* @__PURE__ */ new Error("保存位置结果暂未确认。")), timeout);
				})]);
			} finally {
				clearTimeout(timer);
			}
		}
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/CreatorSettingsCard.css.mjs
		registerPluginCss("dsh-creator-workbench/CreatorSettingsCard.css", "[data-plugin=\"dsh-creator-workbench\"].creatorSettings {\n  color: var(--dsw-alias-label-primary);\n  max-width: 680px;\n  margin: 0 auto;\n  padding: 8px 12px 24px;\n}\n.creatorSettingsTabs {\n  display: flex;\n  gap: 4px;\n  margin-bottom: 20px;\n  overflow-x: auto;\n  min-width: 0;\n  flex-wrap: nowrap;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n  padding-bottom: 10px;\n}\n.creatorSettingsTabs button {\n  flex: none;\n  border: 0;\n  background: none;\n  color: var(--dsw-alias-label-secondary);\n  padding: 8px 12px;\n  border-radius: var(--creator-control-radius,12px);\n  cursor: pointer;\n  font: inherit;\n  font-weight: 500;\n  white-space: nowrap;\n}\n.creatorSettingsTabs [aria-current] {\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n.creatorSettingsTabs button:hover { background:var(--dsw-alias-interactive-bg-hover); }\n.creatorSettingsForm {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  min-width: 0;\n}\n.creatorSettingsForm .creatorField {\n  gap: 8px;\n}\n.creatorSettingsForm .creatorField > input {\n  min-height: 36px;\n}\n.creatorLabelLine {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.creatorLabelLine small {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary);\n  font-weight: 400;\n}\n.creatorPathRow {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 0;\n}\n.creatorPathRow > span {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.creatorSettingsSave {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  position: sticky;\n  bottom: 0;\n  padding: 12px 0;\n  background: var(--dsw-alias-bg-base);\n  z-index: 2;\n}\n.creatorSettingsCheck {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 12px;\n  padding-top: 16px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n}\n.creatorSettingsCheck > details {\n  width: 100%;\n}\n.creatorPlatformOptions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 16px;\n  margin-top: 12px;\n}\n.creatorLeavePrompt {\n  padding: 16px;\n  margin-bottom: 20px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 8px;\n}\n.creatorLeavePrompt h3 {\n  margin: 0;\n  font-size: 16px;\n}\n\n[data-plugin=\"dsh-creator-workbench\"].creatorSettings .creatorPathRow { flex-wrap:wrap; min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"].creatorSettings .creatorPathRow .creatorSelect { flex:1; }\n");
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/ProductionPanel.css.mjs
		registerPluginCss("dsh-creator-workbench/ProductionPanel.css", "[data-plugin=\"dsh-creator-workbench\"] .productionSettings,\n[data-plugin=\"dsh-creator-workbench\"] .productionPanel { min-width:0; font-size:13px; line-height:1.55; }\n[data-plugin=\"dsh-creator-workbench\"] .productionSettings[hidden] { display:none; }\n[data-plugin=\"dsh-creator-workbench\"] .productionSettings h3,\n[data-plugin=\"dsh-creator-workbench\"] .productionPanel h3 { font-size:14px; margin:0 0 12px; font-weight:600; }\n[data-plugin=\"dsh-creator-workbench\"] .productionSettings .creatorField { margin:16px 0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionHeading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin:0 0 12px; }\n[data-plugin=\"dsh-creator-workbench\"] .productionHeading h3 { margin:0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionAccounts { display:grid; gap:0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionAccount { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:14px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }\n[data-plugin=\"dsh-creator-workbench\"] .productionAccount>div:first-child { display:grid; gap:3px; min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionAccount span,\n[data-plugin=\"dsh-creator-workbench\"] .productionAccount small { color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .productionPanel { margin:0 0 20px; container-type:inline-size; }\n[data-plugin=\"dsh-creator-workbench\"] .productionPanel input:not([type=\"checkbox\"]),\n[data-plugin=\"dsh-creator-workbench\"] .productionPanel textarea,\n[data-plugin=\"dsh-creator-workbench\"] .productionFields { display:grid; gap:12px; margin:12px 0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionFields label { display:grid; gap:6px; min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionTask { border-top:1px solid var(--dsw-alias-border-l1); padding:10px 0; display:grid; gap:6px; min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionTask p { margin:0; overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .productionTask small { color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .productionMetrics { margin:14px 0; display:grid; gap:12px; }\n[data-plugin=\"dsh-creator-workbench\"] .productionPreview { width:100%; min-height:520px; border:1px solid var(--dsw-alias-border-l1); border-radius:6px; background:var(--dsw-alias-bg-base); }\n[data-plugin=\"dsh-creator-workbench\"] .productionInline { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:12px 0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionSettings input:focus-visible,\n[data-plugin=\"dsh-creator-workbench\"] .productionPanel :is(input,textarea):focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }\n\n[data-plugin=\"dsh-creator-workbench\"] .productionData { margin:24px 0; padding-top:20px; border-top:1px solid var(--dsw-alias-border-l1); }\n[data-plugin=\"dsh-creator-workbench\"] .productionPlatformRow { padding:14px 0; border-bottom:1px solid var(--dsw-alias-border-l1); min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .productionPlatformRow p { margin:6px 0; overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] .productionPlatformRow .creatorSelect { width:auto; min-width:100px; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.productionAssociation,.productionTaskDetails) { margin-top:16px; padding:16px; border:1px solid var(--dsw-alias-border-l1); border-radius:6px; min-width:0; }\n");
		//#endregion
		//#region src/client/ProductionSettingsPanel.tsx
		const ProductionSettingsPanel = (0, react.forwardRef)(function ProductionSettingsPanel({ api, credentials, group, onDirty, onBusy }, ref) {
			const [saved, setSaved] = (0, react.useState)(), [error, setError] = (0, react.useState)(), [busy, setBusy] = (0, react.useState)(false), [notice, setNotice] = (0, react.useState)();
			const [asrKey, setAsrKey] = (0, react.useState)(""), [appid, setAppid] = (0, react.useState)(""), [secret, setSecret] = (0, react.useState)(""), [author, setAuthor] = (0, react.useState)(""), [theme, setTheme] = (0, react.useState)("claude-editorial");
			const alive = (0, react.useRef)(true), initialized = (0, react.useRef)(false), fileInput = (0, react.useRef)(null);
			const dirty = Boolean(asrKey || secret || saved && (appid !== saved.wechat.appid || author !== saved.wechat.author || theme !== saved.wechat.theme));
			(0, react.useEffect)(() => {
				onDirty(dirty);
			}, [dirty, onDirty]);
			(0, react.useEffect)(() => {
				onBusy(busy);
			}, [busy, onBusy]);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
					onDirty(false);
					onBusy(false);
				};
			}, [onDirty, onBusy]);
			const load = async () => {
				setError(void 0);
				try {
					const next = await api.settings();
					if (!alive.current) return;
					setSaved(next);
					if (!initialized.current) {
						initialized.current = true;
						setAppid(next.wechat.appid);
						setAuthor(next.wechat.author);
						setTheme(next.wechat.theme);
					}
				} catch (cause) {
					if (alive.current) setError(cause instanceof Error ? cause.message : "设置读取失败，请重试。");
				}
			};
			(0, react.useEffect)(() => {
				load();
			}, [api, group]);
			(0, react.useEffect)(() => {
				if (!notice) return;
				const timer = setTimeout(() => setNotice(void 0), 5e3);
				return () => clearTimeout(timer);
			}, [notice]);
			const action = async (request) => {
				if (busy) return;
				setBusy(true);
				setError(void 0);
				setNotice(void 0);
				try {
					const next = await api.settingsAction(request);
					invalidateProjectSettings(api);
					if (alive.current) {
						setSaved(next);
						if (request.action === "import-wechat") {
							setAppid(next.wechat.appid);
							setAuthor(next.wechat.author);
							setTheme(next.wechat.theme);
							setSecret("");
						}
						setNotice(request.action === "prepare-runtime" ? "运行环境已准备" : request.action === "check-wechat" ? "凭据可用，草稿和数据权限在实际操作时分别验证" : "已更新");
					}
				} catch (cause) {
					if (alive.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
				} finally {
					if (alive.current) setBusy(false);
				}
			};
			const save = async () => {
				if (!saved) throw new Error("发布设置尚未读取成功，请重试加载。");
				if (busy) throw new Error("当前操作尚未完成。");
				if (!dirty) return;
				if (!credentials) throw new Error("宿主凭据服务暂不可用，请稍后重试。");
				setBusy(true);
				setError(void 0);
				let credentialSaved = false;
				try {
					if (asrKey.trim()) {
						if (!(await credentials.set({
							ref: "CREATOR_VOLC_ASR_API_KEY",
							value: asrKey.trim()
						}))?.result.ok) throw new Error("火山语音 Key 保存失败。");
						credentialSaved = true;
						if (alive.current) setAsrKey("");
					}
					const changed = appid !== saved.wechat.appid || author !== saved.wechat.author || theme !== saved.wechat.theme || Boolean(secret.trim());
					let next = saved;
					if (changed) {
						if (!/^wx[a-zA-Z0-9]{8,40}$/.test(appid.trim())) throw new Error("请填写有效的公众号 AppID。");
						if ((appid !== saved.wechat.appid || !saved.wechatConfigured) && !secret.trim()) throw new Error("请填写此公众号对应的 AppSecret。");
						if (secret.trim()) {
							if (!(await credentials.set({
								ref: await wechatCredentialRef(appid.trim()),
								value: secret.trim()
							}))?.result.ok) throw new Error("公众号 AppSecret 保存失败。");
							credentialSaved = true;
						}
						next = await api.settingsAction({
							action: "save-wechat",
							appid: appid.trim(),
							author,
							theme,
							revision: saved.revision
						});
						invalidateProjectSettings(api);
					} else next = await api.settings();
					if (alive.current) {
						setSaved(next);
						setSecret("");
						setAppid(next.wechat.appid);
						setAuthor(next.wechat.author);
						setTheme(next.wechat.theme);
						setNotice("已保存");
					}
				} catch (cause) {
					const message = (credentialSaved ? "凭据已保存，设置更新尚未全部完成；" : "") + (cause instanceof Error ? cause.message : "保存失败，请重试。");
					if (alive.current) setError(message);
					throw new Error(message);
				} finally {
					if (alive.current) setBusy(false);
				}
			};
			(0, react.useImperativeHandle)(ref, () => ({
				save,
				discard: () => {
					setAsrKey("");
					setSecret("");
					if (saved) {
						setAppid(saved.wechat.appid);
						setAuthor(saved.wechat.author);
						setTheme(saved.wechat.theme);
					}
				}
			}));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				hidden: !group,
				className: "productionSettings",
				children: [
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorError",
						role: "alert",
						children: error
					}), saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						disabled: busy,
						onClick: () => void load(),
						children: "重新读取设置"
					})] }),
					!saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						onClick: () => void load(),
						children: "重试加载发布设置"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						group === "platforms" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "productionHeading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "发布账号" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: busy,
									onClick: () => void action({ action: saved.browserPaused ? "resume-browser" : "pause-browser" }),
									children: saved.browserPaused ? "继续浏览器操作" : "暂停浏览器操作"
								})]
							}),
							!saved.runtime.browser && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "creatorMuted",
								children: [
									"安装并打开 ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: "https://www.egolite.ai/download",
										target: "_blank",
										rel: "noreferrer",
										children: "Ego 浏览器 Windows 版"
									}),
									"，完成首次设置后检查账号。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "productionAccounts",
								children: PUBLISH_PLATFORMS.map((platform) => {
									const account = saved.accounts[platform], observed = saved.observations[platform], canConnect = observed?.state === "connected" && observed.id && observed.id !== account?.id;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "productionAccount",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: PUBLISH_PLATFORM_DEFINITIONS[platform].name }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: account ? `${account.name} · ${account.id}` : "尚未连接" }),
											observed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: observed.state === "login-required" ? "需要登录" : observed.state === "connected" ? `当前登录：${observed.name}` : observed.error ?? "账号尚未核验" })
										] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
												disabled: busy,
												onClick: () => void action({
													action: "open-login",
													platform
												}),
												children: "打开登录"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
												disabled: busy,
												onClick: () => void action({
													action: "check-account",
													platform
												}),
												children: "检查账号"
											}),
											canConnect && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
												disabled: busy,
												onClick: () => void action({
													action: "connect-account",
													platform,
													expectedId: observed.id,
													replace: Boolean(account)
												}),
												children: account ? "确认更换账号" : "连接此账号"
											})
										] })]
									}, platform);
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: "creatorDisclosure",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "运行环境" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "creatorMuted",
										children: saved.runtime.details.length ? saved.runtime.details.join(" ") : "Windows 运行依赖已就绪"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										disabled: busy,
										onClick: () => void action({ action: "prepare-runtime" }),
										children: busy ? "正在准备…" : "准备运行环境"
									})
								]
							})
						] }),
						group === "asr" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "豆包录音文件识别极速版" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorMuted",
								children: "确认录音文件识别极速版已开通，再填入同一项目的 API Key。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: "https://console.volcengine.com/speech/service/10012",
								target: "_blank",
								rel: "noreferrer",
								children: "查看服务状态"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: "https://console.volcengine.com/speech/new/setting/apikeys",
								target: "_blank",
								rel: "noreferrer",
								children: "管理 API Key"
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorField",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "creatorLabelLine",
									children: ["API Key ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: saved.asrConfigured ? "已保存" : "尚未配置" })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretInput, {
									"aria-label": "火山语音 API Key",
									value: asrKey,
									disabled: busy || !credentials,
									placeholder: saved.asrConfigured ? "留空保留原 Key" : "填写火山语音 API Key",
									onChange: (e) => setAsrKey(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: "creatorDisclosure",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "服务说明" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "creatorMuted",
										children: "新版列表未显示此服务时，在旧版控制台的“语音识别大模型 → 录音文件识别大模型 → 极速版”查看。已开通的服务无需重复开通。"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: "creatorMuted",
										children: [
											"当前接入模型资源：",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "volc.bigasr.auc_turbo" }),
											"，无需另填。支持两小时以内、提取音频不超过 100 MB 的视频；识别会使用服务额度。"
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: "https://docs.volcengine.com/docs/DoubaoVoice/recording-file-recognition-lite-http?lang=zh",
										target: "_blank",
										rel: "noreferrer",
										children: "官方接口说明"
									})
								]
							})
						] }),
						group === "wechat" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "微信公众号" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorField",
								children: ["AppID", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									autoComplete: "off",
									spellCheck: false,
									value: appid,
									disabled: busy,
									onChange: (e) => setAppid(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorField",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "creatorLabelLine",
									children: ["AppSecret ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: saved.wechatConfigured && appid === saved.wechat.appid ? "已保存" : "尚未配置" })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretInput, {
									"aria-label": "AppSecret",
									value: secret,
									disabled: busy || !credentials,
									placeholder: "留空保留此公众号的原凭据",
									onChange: (e) => setSecret(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorField",
								children: ["作者", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: author,
									disabled: busy,
									onChange: (e) => setAuthor(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "creatorField",
								children: ["文章排版", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
									value: theme,
									disabled: busy,
									onValueChange: (value) => setTheme(value),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "claude-editorial",
										children: "简洁编辑风格"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "professional-clean",
										children: "清爽专业风格"
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy || dirty || !saved.wechatConfigured,
								onClick: () => void action({ action: "check-wechat" }),
								children: "检查账号"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
								disabled: busy || dirty,
								onClick: () => fileInput.current?.click(),
								children: "导入已有配置"
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								hidden: true,
								ref: fileInput,
								"aria-label": "导入公众号配置",
								type: "file",
								accept: ".yaml,.yml",
								onChange: (event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = "";
									if (file) try {
										action({
											action: "import-wechat",
											sourcePath: localFilePath(file)
										});
									} catch (cause) {
										setError(cause instanceof Error ? cause.message : "文件读取失败");
									}
								}
							}),
							saved.wechat.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: "creatorError",
								children: saved.wechat.error
							}),
							saved.wechat.checkedAt && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "creatorMuted",
								children: [
									"最近检查：",
									new Date(saved.wechat.checkedAt).toLocaleString(),
									"。草稿和数据权限分别在实际操作时验证。"
								]
							})
						] })
					] }),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorMuted",
						role: "status",
						children: notice
					}),
					busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "creatorMuted",
						role: "status",
						children: "正在处理，请稍候…"
					})
				]
			});
		});
		//#endregion
		//#region src/client/CreatorSettingsCard.tsx
		const CreatorSettingsCard = (0, react.forwardRef)(function CreatorSettingsCard({ credentials, onClose, initialGroup, ...face }, ref) {
			const uid = (0, react.useId)();
			const [group, setGroup] = (0, react.useState)("image");
			const pendingGroup = (0, react.useRef)();
			const productionRef = (0, react.useRef)(null);
			const [productionDirty, setProductionDirty] = (0, react.useState)(false), [productionBusy, setProductionBusy] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(), [image, setImage] = (0, react.useState)();
			const [apiBase, setApiBase] = (0, react.useState)(""), [model, setModel] = (0, react.useState)(""), [key, setKey] = (0, react.useState)("");
			const [root, setRoot] = (0, react.useState)(""), [rules, setRules] = (0, react.useState)(""), [platforms, setPlatforms] = (0, react.useState)([]), [subtitleKey, setSubtitleKey] = (0, react.useState)("");
			const [credentialViews, setCredentialViews] = (0, react.useState)({});
			const [credentialError, setCredentialError] = (0, react.useState)();
			const [loading, setLoading] = (0, react.useState)(true), [loadError, setLoadError] = (0, react.useState)(), [retry, setRetry] = (0, react.useState)(0);
			const directorySaving = (0, react.useRef)(false);
			const attemptedDirectory = (0, react.useRef)();
			const [directoryBusy, setDirectoryBusy] = (0, react.useState)(false), [directoryError, setDirectoryError] = (0, react.useState)(), [directoryNotice, setDirectoryNotice] = (0, react.useState)();
			const [checking, setChecking] = (0, react.useState)(false);
			const lastField = (0, react.useRef)(null);
			const [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)(), [notice, setNotice] = (0, react.useState)(), [fields, setFields] = (0, react.useState)({});
			const [leaving, setLeaving] = (0, react.useState)(false), [capabilities, setCapabilities] = (0, react.useState)();
			const alive = (0, react.useRef)(true), saving = (0, react.useRef)(false), leaveBox = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (face.production) invalidateProjectSettings(face.production);
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				let live = true;
				setLoading(true);
				setLoadError(void 0);
				setCredentialError(void 0);
				Promise.all([face.getSettings(), face.getImageSettings()]).then(async ([general, service]) => {
					if (!live) return;
					setSaved(general);
					setImage(service);
					setApiBase(service.pending?.apiBase ?? service.apiBase);
					setModel(service.pending?.model ?? service.model);
					setKey("");
					setRoot(general.libraryRoot);
					setRules(general.scriptRules ?? "");
					setPlatforms([...general.profile.enabledPlatforms]);
					setSubtitleKey("");
					if (!credentials) {
						setCredentialError("凭据服务暂不可用，请重试加载。");
						return;
					}
					try {
						const response = await credentials.describe({ refs: [IMAGE_CREDENTIAL, general.secrets.subtitle.ref] });
						if (!response.result.ok || !response.result.value) throw new Error();
						if (live) setCredentialViews(Object.fromEntries([IMAGE_CREDENTIAL, general.secrets.subtitle.ref].map((ref) => [ref, response.result.value.credentials[ref] ?? {
							configured: false,
							writable: true
						}])));
					} catch {
						if (live) setCredentialError("无法读取凭据状态，请重试加载。");
					}
				}).catch(() => {
					if (live) setLoadError("设置读取失败，现有配置未改动。");
				}).finally(() => {
					if (live) setLoading(false);
				});
				return () => {
					live = false;
				};
			}, [retry]);
			(0, react.useEffect)(() => {
				if (!notice) return;
				const timer = setTimeout(() => setNotice(void 0), 6500);
				return () => clearTimeout(timer);
			}, [notice]);
			(0, react.useEffect)(() => {
				if (leaving) leaveBox.current?.focus();
			}, [leaving]);
			const imageDirty = !!image && (apiBase !== (image.pending?.apiBase ?? image.apiBase) || model !== (image.pending?.model ?? image.model) || !!key);
			const generalDirty = !!saved && (rules !== (saved.scriptRules ?? "") || JSON.stringify(platforms) !== JSON.stringify(saved.profile.enabledPlatforms) || !!subtitleKey);
			const dirty = imageDirty || generalDirty || productionDirty;
			const requestGroup = (next) => {
				if (next === group || saving.current || productionBusy || directorySaving.current) return;
				if (dirty) {
					pendingGroup.current = next;
					setLeaving(true);
				} else setGroup(next);
			};
			(0, react.useEffect)(() => {
				if (initialGroup) requestGroup(initialGroup);
			}, [initialGroup]);
			const leave = () => {
				const next = pendingGroup.current;
				pendingGroup.current = void 0;
				if (next) setGroup(next);
				else onClose?.();
			};
			const imageCredential = credentialViews[IMAGE_CREDENTIAL];
			const subtitleRef = saved?.secrets.subtitle.ref;
			const subtitleCredential = subtitleRef ? credentialViews[subtitleRef] : void 0;
			const imageConfigured = imageCredential?.configured ?? saved?.secrets.cover.configured ?? false;
			(0, react.useImperativeHandle)(ref, () => ({ requestClose: () => {
				if (saving.current || productionBusy || directorySaving.current) return;
				pendingGroup.current = void 0;
				if (dirty) setLeaving(true);
				else onClose?.();
			} }));
			const discard = () => {
				productionRef.current?.discard();
				setApiBase(image?.pending?.apiBase ?? image?.apiBase ?? "");
				setModel(image?.pending?.model ?? image?.model ?? "");
				setKey("");
				setRoot(saved?.libraryRoot ?? "");
				setRules(saved?.scriptRules ?? "");
				setPlatforms([...saved?.profile.enabledPlatforms ?? []]);
				setSubtitleKey("");
				setFields({});
				setError(void 0);
				setLeaving(false);
				leave();
			};
			const validate = () => {
				const next = {};
				try {
					const url = new URL(apiBase);
					if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
				} catch {
					next.url = "请输入有效的 HTTP/HTTPS 服务根地址。";
				}
				if (!model.trim()) next.model = "请填写生图模型名称。";
				if (!imageConfigured && !key.trim()) next.key = "请填写 API Key。";
				if (image?.pending?.needsKey && !key.trim()) next.key = "上次密钥更新未完成，请重新填写。";
				if (!next.url && image?.apiBase && new URL(image.apiBase).origin !== new URL(apiBase).origin && !key.trim()) next.key = "服务来源已改变，请填写对应服务的新 Key。";
				setFields(next);
				return Object.keys(next).length === 0;
			};
			const save = async (closeAfter = false) => {
				if (!image || !saved || saving.current || productionBusy) return;
				if ((imageDirty || image.pending) && !validate()) {
					setGroup("image");
					return;
				}
				saving.current = true;
				setBusy(true);
				setError(void 0);
				setNotice(void 0);
				let completed = false;
				try {
					if (productionDirty) {
						await productionRef.current?.save();
						completed = true;
					}
					if (imageDirty || image.pending) {
						if (credentialError) throw new Error("凭据状态读取失败，请先重试加载。");
						const next = await saveImageForm(face, credentials, image, {
							apiBase,
							model,
							key
						}, (pending) => {
							if (alive.current) setImage(pending);
						});
						completed = true;
						if (!alive.current) return;
						setImage(next);
						setApiBase(next.apiBase);
						setModel(next.model);
						setKey("");
						setCredentialViews((v) => ({
							...v,
							[IMAGE_CREDENTIAL]: {
								configured: true,
								writable: imageCredential?.writable ?? true
							}
						}));
					}
					if (JSON.stringify(platforms) !== JSON.stringify(saved.profile.enabledPlatforms)) {
						const nextProfile = { enabledPlatforms: platforms };
						await face.setProfile(nextProfile);
						completed = true;
						if (alive.current) setSaved((current) => current ? {
							...current,
							profile: nextProfile
						} : current);
					}
					if (rules !== (saved.scriptRules ?? "")) {
						await face.setScriptRules(rules);
						completed = true;
						if (alive.current) setSaved((current) => current ? {
							...current,
							scriptRules: rules
						} : current);
					}
					if (subtitleKey.trim() && subtitleRef) {
						let ok = false;
						try {
							ok = !!(await credentials?.set({
								ref: subtitleRef,
								value: subtitleKey.trim()
							}))?.result.ok;
						} catch {}
						if (!ok) throw new Error("字幕凭据保存失败，请重试。");
						if (alive.current) {
							setSubtitleKey("");
							setCredentialViews((v) => ({
								...v,
								[subtitleRef]: {
									configured: true,
									writable: subtitleCredential?.writable ?? true
								}
							}));
						}
					}
					if (alive.current) {
						setNotice("已保存");
						setLeaving(false);
						if (closeAfter) leave();
					}
				} catch (cause) {
					if (alive.current) setError((completed ? "部分设置已保存；" : "") + (cause instanceof Error ? cause.message : "保存失败，请重试。"));
				} finally {
					saving.current = false;
					if (alive.current) setBusy(false);
				}
			};
			const changeDirectory = async (path) => {
				if (directorySaving.current) return;
				directorySaving.current = true;
				setDirectoryBusy(true);
				setDirectoryError(void 0);
				setDirectoryNotice(void 0);
				let selected = path;
				const accept = (value) => {
					if (!alive.current) return;
					setRoot(value.libraryRoot);
					setSaved((current) => current ? {
						...current,
						libraryRoot: value.libraryRoot,
						libraryConfirmed: value.libraryConfirmed,
						projectLocations: value.projectLocations
					} : current);
				};
				try {
					selected ??= await face.pickDirectory() ?? void 0;
					if (!selected || !alive.current) return;
					attemptedDirectory.current = selected;
					accept(await directoryReply(face.setLibraryRoot(selected)) ?? await directoryReply(face.getProjectLocations?.() ?? face.getSettings()));
					if (alive.current) setDirectoryNotice("已生效");
				} catch (cause) {
					let reconciled = false;
					try {
						accept(await directoryReply(face.getProjectLocations?.() ?? face.getSettings()));
						reconciled = true;
					} catch {}
					if (alive.current) setDirectoryError((cause instanceof Error ? cause.message : "保存位置更新未完成。") + (reconciled ? " 已读取当前保存位置，可核对后重试。" : " 结果尚未确认，当前显示上次确认的位置，请重试核对。"));
				} finally {
					directorySaving.current = false;
					if (alive.current) setDirectoryBusy(false);
				}
			};
			const errorId = (field) => uid + "-" + field;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"data-plugin": "dsh-creator-workbench",
				"data-surface": "settings-card",
				className: "creatorSettings",
				onFocusCapture: (event) => {
					if (event.target instanceof HTMLElement && event.target.matches("input,textarea,select,[role=\"combobox\"]")) lastField.current = event.target;
				},
				children: [
					leaving && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "creatorLeavePrompt",
						role: "alertdialog",
						"aria-label": "有未保存的修改",
						tabIndex: -1,
						ref: leaveBox,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "有未保存的修改" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "保存后返回，或继续编辑。" }),
							image?.pending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "creatorMuted",
								children: "已提交的更新仍未完成，放弃表单不会撤回已保存的凭据。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ActionBar, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "primary",
									disabled: busy,
									onClick: () => {
										save(true);
									},
									children: "保存并返回"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: busy,
									onClick: () => {
										setLeaving(false);
										pendingGroup.current = void 0;
										if (lastField.current?.isConnected) lastField.current.focus({ preventScroll: true });
									},
									children: "继续编辑"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									disabled: busy,
									onClick: discard,
									children: "放弃修改"
								})
							] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SelectionRail, {
						selected: group,
						className: "creatorSettingsTabs",
						"aria-label": "设置分组",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-current": group === "image" ? "page" : void 0,
								onClick: () => requestGroup("image"),
								children: "生图服务"
							}),
							face.production && [
								["platforms", "发布平台"],
								["asr", "语音转文字"],
								["wechat", "公众号"]
							].map(([value, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-current": group === value ? "page" : void 0,
								onClick: () => requestGroup(value),
								children: label
							}, value)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-current": group === "general" ? "page" : void 0,
								onClick: () => requestGroup("general"),
								children: "常规"
							})
						]
					}),
					loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "creatorMuted",
						children: "正在读取设置…"
					}) : loadError ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "creatorError",
						children: loadError
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
						onClick: () => setRetry((n) => n + 1),
						children: "重试加载"
					})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: "creatorSettingsForm",
						onSubmit: (e) => {
							e.preventDefault();
							save();
						},
						children: [
							face.production && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProductionSettingsPanel, {
								ref: productionRef,
								api: face.production,
								credentials,
								group: group === "platforms" || group === "asr" || group === "wechat" ? group : void 0,
								onDirty: setProductionDirty,
								onBusy: setProductionBusy
							}),
							group === "image" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								image?.pending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "status",
									className: "creatorError",
									children: "上次设置更新未完成，请继续保存。新的生图任务暂时停用。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "creatorField",
									children: ["服务地址", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "url",
										spellCheck: false,
										value: apiBase,
										placeholder: "https://服务地址/v1",
										disabled: busy,
										"aria-invalid": !!fields.url,
										"aria-describedby": fields.url ? errorId("url") : void 0,
										onChange: (e) => {
											setApiBase(e.target.value);
											setFields({});
										}
									})]
								}),
								fields.url && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									id: errorId("url"),
									className: "creatorError",
									children: fields.url
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "creatorField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "creatorLabelLine",
										children: [
											"API Key",
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: imageConfigured ? "已保存" : "尚未配置" })
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretInput, {
										"aria-label": "API Key",
										autoComplete: "off",
										value: key,
										placeholder: imageConfigured ? "留空保留已保存的 Key" : "粘贴 API Key",
										disabled: busy || !imageCredential?.writable || !!credentialError,
										"aria-invalid": !!fields.key,
										"aria-describedby": fields.key ? errorId("key") : void 0,
										onChange: (e) => {
											setKey(e.target.value);
											setFields({});
										}
									})]
								}),
								fields.key && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									id: errorId("key"),
									className: "creatorError",
									children: fields.key
								}),
								!credentialError && imageCredential && !imageCredential.writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "creatorMuted",
									children: "该凭据由宿主管理，当前不可在这里修改。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "creatorField",
									children: ["生图模型", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: model,
										placeholder: "服务支持的图片模型名称",
										disabled: busy,
										"aria-invalid": !!fields.model,
										"aria-describedby": fields.model ? errorId("model") : void 0,
										onChange: (e) => {
											setModel(e.target.value);
											setFields({});
										}
									})]
								}),
								fields.model && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									id: errorId("model"),
									className: "creatorError",
									children: fields.model
								})
							] }) : group === "general" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "creatorField",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											htmlFor: uid + "-parent",
											children: "项目保存位置"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "creatorPathRow",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(CreatorSelect, {
												id: uid + "-parent",
												"aria-label": "默认父目录",
												value: saved?.libraryConfirmed ? root : "",
												disabled: directoryBusy,
												onValueChange: (value) => {
													changeDirectory(value);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													disabled: true,
													children: "选择默认父目录"
												}), [.../* @__PURE__ */ new Set([root, ...saved?.projectLocations?.map((p) => p.path) ?? []])].filter(Boolean).map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: path,
													children: path
												}, path))]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
												disabled: directoryBusy,
												onClick: () => {
													changeDirectory();
												},
												children: "选择其他位置"
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "creatorMuted",
											title: root,
											children: root || "尚未选择默认父目录"
										}),
										directoryBusy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											role: "status",
											children: "正在更新…"
										}),
										directoryNotice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											role: "status",
											children: directoryNotice
										}),
										directoryError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "creatorError",
											role: "alert",
											children: [directoryError, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
												disabled: directoryBusy,
												onClick: () => {
													changeDirectory(attemptedDirectory.current);
												},
												children: "重试"
											})]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
									className: "creatorDisclosure",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "写稿偏好" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										rows: 6,
										"aria-label": "写稿偏好",
										placeholder: "希望 Agent 遵循的表达习惯…",
										value: rules,
										disabled: busy,
										onChange: (e) => setRules(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
									className: "creatorDisclosure",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "平台显示" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "creatorPlatformOptions",
										children: CREATOR_SETTINGS_PLATFORMS.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: "creatorCheckbox",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: platforms.includes(p.key),
												disabled: busy,
												onChange: (e) => setPlatforms((v) => e.target.checked ? [...v, p.key] : v.filter((k) => k !== p.key))
											}), face.t(p.label)]
										}, p.key))
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
									className: "creatorDisclosure",
									onToggle: (e) => {
										if (e.currentTarget.open && !capabilities) face.getCapabilities().then((v) => {
											if (alive.current) setCapabilities(v);
										}, () => {
											if (alive.current) setError("诊断信息读取失败");
										});
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "能力与诊断" }), capabilities && Object.entries(capabilities).map(([name, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: "creatorPrewrap",
										children: [
											name,
											" · ",
											value.detail
										]
									}, name))]
								})
							] }) : null,
							credentialError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "creatorInlineStatus",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "alert",
									className: "creatorError",
									children: credentialError
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: dirty || busy,
									onClick: () => setRetry((n) => n + 1),
									children: "重试读取凭据"
								})]
							}),
							error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: "creatorError",
								children: error
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "creatorSettingsSave",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "primary",
									disabled: busy || productionBusy || !dirty && !image?.pending,
									onClick: () => {
										save();
									},
									children: busy && !checking ? "正在保存…" : "保存"
								}), notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									role: "status",
									className: "creatorMuted",
									children: notice
								})]
							}),
							group === "image" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "creatorSettingsCheck",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
										disabled: busy || imageDirty || !!image?.pending || !imageConfigured || !image?.apiBase,
										onClick: async () => {
											if (saving.current) return;
											saving.current = true;
											setChecking(true);
											setBusy(true);
											setError(void 0);
											try {
												const next = await face.checkImageService();
												if (alive.current) setImage(next);
											} catch (cause) {
												if (alive.current) setError(cause instanceof Error ? cause.message : "连接失败");
											} finally {
												saving.current = false;
												if (alive.current) {
													setBusy(false);
													setChecking(false);
												}
											}
										},
										children: checking ? "正在检查…" : "检查连接"
									}),
									image?.checked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										role: "status",
										className: "creatorMuted",
										children: image.checked.connection
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
										className: "creatorDisclosure",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "图片能力" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "creatorMuted",
												children: "连接检查不生成图片。实际生图可在封面区域的高级操作中测试。"
											}),
											image?.checked && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												className: "creatorMuted",
												children: [
													"文字生图：",
													image.checked.generation,
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
													"参考图：",
													image.checked.edit
												]
											})
										]
									})
								]
							})
						]
					})
				]
			});
		});
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/CreatorWorkbench.css.mjs
		registerPluginCss("dsh-creator-workbench/CreatorWorkbench.css", "[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] {\r\n  display: flex;\r\n  flex-direction: column;\r\n  flex: 1;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 0;\r\n  min-height: 0;\r\n  overflow: hidden;\r\n  container-type: inline-size;\r\n  background: var(--dsw-alias-bg-base);\r\n  color: var(--dsw-alias-label-primary);\r\n  font: var(--dsw-font-markdown-base);\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchHeader {\r\n  flex: none;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  flex-wrap: wrap;\r\n  gap: 8px;\r\n  min-height: 40px;\r\n  padding: 6px 12px;\r\n  padding-inline-start: max(12px, var(--dsh-frame-leading-clearance, 0px));\r\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\r\n  font-size: 14px;\r\n  line-height: 20px;\r\n  box-sizing: border-box;\r\n}\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchActions { display: flex; flex-wrap: wrap; gap: 8px; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchBody { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchLibrary { display: flex; flex-direction: column; width: clamp(180px, 25cqi, 240px); flex: none; min-width: 0; min-height: 0; border-right: 1px solid var(--dsw-alias-border-l1); padding: 8px; box-sizing: border-box; container-type: inline-size; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchDetail { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchLibrary .contentPanel { padding-right:0; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchLibrary .contentHeader { height:32px;margin:0 0 8px;padding-left:0; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchEmpty { padding: 24px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchSettings { flex: 1; min-height: 0; overflow: auto; padding: 12px; }\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchError { padding: 8px 12px; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; font-size: 13px; line-height: 20px; }\r\n@container (max-width: 200px) {\r\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchLibrary .contentRow { padding: 6px 2px; gap: 2px; }\r\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchLibrary .contentRowSelect { gap: 6px; }\r\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchLibrary .rowCover { width: 30px; height: 40px; }\r\n  [data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] .workbenchLibrary .rowMeta { flex-wrap: wrap; gap: 2px; }\r\n}\r\n\r\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"workbench\"] [hidden] { display: none; }\r\n\r\n[data-plugin=\"dsh-creator-workbench\"] .workbenchRestoreStatus { padding:4px 12px; font-size:12px; color:var(--dsw-alias-label-secondary); }\r\n");
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/InternalUi.css.mjs
		registerPluginCss("dsh-creator-workbench/InternalUi.css", "[data-plugin=\"dsh-creator-workbench\"] .creatorSectionHeading {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 10px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorSectionHeading :is(h3, h4) {\n  margin: 0;\n  font-size: 14px;\n  line-height: 22px;\n  font-weight: 600;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorField {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  min-width: 0;\n  font-size: 13px;\n  line-height: 20px;\n}\n[data-plugin=\"dsh-creator-workbench\"]\n  :is(\n    .creatorField input,\n    .creatorField textarea,\n    .creatorDisclosure textarea\n  ) {\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 0;\n  min-height: 36px;\n  padding: 7px 10px;\n  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));\n  border-radius: 6px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorField input[aria-invalid=\"true\"] {\n  border-color: var(--dsw-alias-state-error-primary);\n}\n[data-plugin=\"dsh-creator-workbench\"]\n  :is(input, textarea, summary, button):focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n}\n[data-plugin=\"dsh-creator-workbench\"] :is(button, summary) {\n  white-space: nowrap;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorFileName {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorMuted {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n  line-height: 20px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorError {\n  margin: 0;\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 13px;\n  line-height: 20px;\n  overflow-wrap: anywhere;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorInlineStatus {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  min-width: 0;\n  font-size: 13px;\n  line-height: 20px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorDisclosure {\n  min-width: 0;\n  margin: 12px 0 0;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorDisclosure > summary {\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n  line-height: 24px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorDisclosure[open] > summary {\n  margin-bottom: 12px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorAssetRow {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 10px;\n  min-width: 0;\n  padding: 10px 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n  font-size: 13px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorRowCopy {\n  flex: 1;\n  min-width: 100px;\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorSectionPanel {\n  min-width: 0;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorPrewrap {\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  font-size: 13px;\n  line-height: 22px;\n}\n[data-plugin=\"dsh-creator-workbench\"] .creatorCheckbox {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .body {\n  font-size: 14px;\n  line-height: 22px;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .lede {\n  margin-bottom: 12px;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .ledeText {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 12px;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .stepper {\n  margin-bottom: 20px;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .scriptStatus {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-height: 36px;\n  margin-bottom: 10px;\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary);\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .scriptEditor {\n  box-sizing: border-box;\n  width: 100%;\n  min-height: 320px;\n  padding: 12px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 6px;\n  font-size: 14px;\n  line-height: 24px;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .article {\n  max-width: 760px;\n  margin: auto;\n  overflow-wrap: anywhere;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .article img {\n  max-width: 100%;\n  height: auto;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .article pre {\n  max-width: 100%;\n  overflow-x: auto;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .cue {\n  min-width: 0;\n}\n[data-plugin=\"dsh-creator-workbench\"][data-surface=\"inspector\"] .cueText {\n  overflow-wrap: anywhere;\n}\n");
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/WorkbenchContrast.css.mjs
		registerPluginCss("dsh-creator-workbench/WorkbenchContrast.css", "/* Desktop exposes the selected scheme on html. Overrides stay inside this plugin. */\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] {\r\n  --creator-light-group: #f1f4f8;\r\n  --creator-light-hover: #e3eaf5;\r\n  --creator-light-active: #d3dfef;\r\n  --creator-light-line: #cad2df;\r\n  --creator-light-field-line: #8792a4;\r\n  --creator-light-selected: #e3edff;\r\n  --dsw-alias-border-l1: var(--creator-light-line);\r\n  --dsw-alias-border-l2: var(--creator-light-field-line);\r\n  --dsw-alias-interactive-bg-hover: var(--creator-light-hover);\r\n  --dsw-alias-interactive-bg-active: var(--creator-light-active);\r\n  --dsw-alias-bg-layer-2: var(--creator-light-group);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] :is(.workbenchHeader,.workbenchLibrary) {\r\n  background:var(--creator-light-group);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] [data-creator-tone=\"secondary\"] {\r\n  border:1px solid var(--creator-light-field-line);\r\n  background:var(--dsw-alias-bg-base);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] [data-creator-tone=\"ghost\"] {\r\n  border:1px solid transparent;\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] :is([data-creator-tone=\"secondary\"],[data-creator-tone=\"ghost\"]):not(:disabled):not([aria-disabled=\"true\"]):hover {\r\n  border-color:var(--creator-light-field-line);\r\n  background:var(--creator-light-hover);\r\n  color:var(--dsw-alias-label-primary);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] :is([data-creator-tone=\"secondary\"],[data-creator-tone=\"ghost\"]):not(:disabled):not([aria-disabled=\"true\"]):active {\r\n  background:var(--creator-light-active);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] .contentRow.selected {\r\n  background:var(--creator-light-selected);\r\n  outline:1px solid var(--creator-light-field-line);\r\n  outline-offset:-1px;\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] .contentRow.selected:hover {\r\n  background:var(--creator-light-active);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] .tab:hover {\r\n  color:var(--dsw-alias-label-primary);\r\n  background:var(--creator-light-hover);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] .tab.active {\r\n  color:var(--dsw-alias-state-business-primary);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] :is(.creatorMediaFrame,.coverPreview) {\r\n  box-sizing:border-box;\r\n  border:1px solid var(--creator-light-line);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] :is(.creatorMediaFrame,.coverPreview):hover {\r\n  border-color:var(--dsw-alias-state-business-primary);\r\n  background:var(--creator-light-hover);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] summary:hover {\r\n  color:var(--dsw-alias-label-primary);\r\n  background:var(--creator-light-hover);\r\n}\r\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] :is(input,select,textarea):hover:not(:disabled):not([aria-invalid=\"true\"]) {\r\n  border-color:var(--dsw-alias-state-business-primary);\r\n}\r\n");
		//#endregion
		//#region \0dsh-creator-workbench-css:src/client/InteractionPolish.css.mjs
		registerPluginCss("dsh-creator-workbench/InteractionPolish.css", "/* Shared presentation stays below the workbench root. Portaled media has its own stylesheet. */\n[data-plugin=\"dsh-creator-workbench\"] {\n  --creator-feedback-duration:120ms;\n  --creator-glide-duration:220ms;\n  --creator-ease:cubic-bezier(.2,.8,.2,1);\n  --creator-control-radius:12px;\n  --creator-compact-radius:8px;\n}\n[data-plugin=\"dsh-creator-workbench\"] :is(button,summary,input,select,textarea) {\n  transition:background-color var(--creator-feedback-duration) ease-out,border-color var(--creator-feedback-duration) ease-out,color var(--creator-feedback-duration) ease-out;\n}\n[data-plugin=\"dsh-creator-workbench\"] :is([data-creator-tone=\"secondary\"],[data-creator-tone=\"ghost\"],.tab,.creatorSettingsTabs button,.publicationPlatforms button,summary):not(:disabled):active { background-color:var(--dsw-alias-interactive-bg-active); }\n[data-plugin=\"dsh-creator-workbench\"] [data-selection-rail] { position:relative;isolation:isolate; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSelectionIndicator { position:absolute;left:0;top:0;pointer-events:none;z-index:-1;border-radius:var(--creator-control-radius);background:var(--dsw-alias-interactive-bg-active);border:1px solid var(--dsw-alias-border-l2);box-sizing:border-box;transition-property:transform,width,height;transition-timing-function:var(--creator-ease); }\n[data-plugin=\"dsh-creator-workbench\"] [data-selection-rail=\"underline\"]>.creatorSelectionIndicator { background:var(--dsw-alias-state-business-primary);border:0;border-radius:0;z-index:1; }\n[data-plugin=\"dsh-creator-workbench\"] [data-selection-rail]>.creatorSelectionIndicator[hidden] { display:none; }\n[data-plugin=\"dsh-creator-workbench\"] [data-selection-rail=\"surface\"]>button:is([aria-current],[aria-pressed=\"true\"]) { background:transparent;border-color:transparent; }\n[data-plugin=\"dsh-creator-workbench\"] :is(input:not([type=\"checkbox\"]):not([type=\"radio\"]),textarea,[data-creator-tone],.creatorSelectTrigger) { border-radius:var(--creator-control-radius); }\n[data-plugin=\"dsh-creator-workbench\"] :is(.creatorSettingsTabs button,.publicationPlatforms button,.articleMode button) { border-radius:var(--creator-control-radius); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSecretToggle { border-radius:var(--creator-compact-radius); }\n[data-plugin=\"dsh-creator-workbench\"] .articleToolbar .creatorSelect { width:0;flex:1; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSecretInput { display:flex;position:relative;width:100%;min-width:0; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSecretInput input { width:100%;padding-right:42px; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSecretToggle { position:absolute;right:4px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:32px;height:30px;padding:0;border:0;border-radius:var(--creator-compact-radius);color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSecretToggle:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSecretToggle:disabled { opacity:.4;cursor:default; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.creatorInlineStatus,.scriptStatus,.articleSaveStatus,.publicationSaveStatus) { min-height:24px;line-height:24px; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.creatorMuted,.creatorError,.overviewCaption,.publicationSaveStatus) { overflow-wrap:anywhere; }\n[data-plugin=\"dsh-creator-workbench\"] :is(.coverPreview,.publicationImage) { cursor:pointer; }\n[data-plugin=\"dsh-creator-workbench\"] .coverVersionRow { flex-wrap:wrap;gap:8px 12px; }\n[data-plugin=\"dsh-creator-workbench\"] .coverVersionRow .creatorRowCopy { flex:1;min-width:100px; }\n[data-plugin=\"dsh-creator-workbench\"] .productionSettings>.creatorMuted { max-width:65ch; }\n[data-plugin=\"dsh-creator-workbench\"] .productionSettings>.creatorMuted+.creatorMuted { margin-top:6px; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSettingsForm { gap:18px; }\n[data-plugin=\"dsh-creator-workbench\"] .creatorSettingsSave { min-height:36px;margin-top:4px;border-top:1px solid var(--dsw-alias-border-l1); }\n[data-plugin=\"dsh-creator-workbench\"] .creatorVideoPanel { padding-top:0; }\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] .creatorSelectionIndicator { background:var(--creator-light-selected); }\nhtml[style*=\"color-scheme: light\"] [data-plugin=\"dsh-creator-workbench\"] [data-selection-rail=\"underline\"]>.creatorSelectionIndicator { background:var(--dsw-alias-state-business-primary); }\n@media (prefers-reduced-motion:reduce) {\n  [data-plugin=\"dsh-creator-workbench\"] { --creator-feedback-duration:0ms;--creator-glide-duration:0ms; }\n}\n");
		//#endregion
		//#region src/client/CreatorWorkbench.tsx
		function CreatorWorkbench({ face, service, credentials, t }) {
			useProfileEpoch();
			const remoteReady = face.ready();
			const [selectedId, setSelectedId] = useSelectedContentId();
			const settingsRef = (0, react.useRef)(null);
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const [settingsGroup, setSettingsGroup] = (0, react.useState)("image");
			const [starting, setStarting] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [restoring, setRestoring] = (0, react.useState)(false);
			const [restoreFailed, setRestoreFailed] = (0, react.useState)(false);
			const previousSession = (0, react.useRef)(void 0);
			const currentSelection = (0, react.useRef)(selectedId);
			currentSelection.current = selectedId;
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				if (!remoteReady) return;
				previousSession.current = void 0;
				let queue = Promise.resolve();
				let revision = 0;
				const restore = () => {
					const session = service.currentSession();
					if (session === previousSession.current) return;
					previousSession.current = session;
					const ticket = ++revision;
					const selectionCurrent = captureContentSelection();
					if (!service.isActive() || contentBindingForSession(service) === null) {
						setRestoring(false);
						setRestoreFailed(false);
						return;
					}
					setRestoring(true);
					setRestoreFailed(false);
					setError(null);
					queue = queue.then(async () => {
						if (!alive.current || ticket !== revision || !service.isActive()) return;
						try {
							if (!selectionCurrent()) return;
							const content = await restoreSessionContent(service, face);
							if (alive.current && ticket === revision && selectionCurrent() && content !== null) setSelectedId(content);
						} catch (cause) {
							if (alive.current && ticket === revision && selectionCurrent()) {
								setRestoreFailed(true);
								setError(`${cause instanceof Error ? cause.message : t("empty.error")} ${t("workbench.relocateHint")}`);
							}
						} finally {
							if (alive.current && ticket === revision) setRestoring(false);
						}
					});
				};
				restore();
				const stop = service.subscribe(restore);
				return () => {
					alive.current = false;
					revision += 1;
					stop();
				};
			}, [
				service,
				face,
				remoteReady
			]);
			const reselect = async () => {
				const isCurrent = face.captureNavigation();
				setRestoring(true);
				try {
					const root = await face.pickDirectory();
					if (root === null || !alive.current || !isCurrent()) return;
					const id = await relocateSessionContent(service, root, face);
					if (!alive.current || !isCurrent() || id === null) return;
					setSelectedId(id);
					setRestoreFailed(false);
					setError(null);
				} catch (cause) {
					if (alive.current && isCurrent()) setError(cause instanceof Error ? cause.message : t("empty.error"));
				} finally {
					if (alive.current && isCurrent()) setRestoring(false);
				}
			};
			(0, react.useEffect)(() => {
				setRestoreFailed(false);
				setError(null);
			}, [selectedId]);
			const begin = async () => {
				if (starting || restoring || selectedId === null) return;
				const id = selectedId;
				const isCurrent = face.captureNavigation();
				setStarting(true);
				setError(null);
				try {
					const detail = await face.getContent(id);
					if (!alive.current || currentSelection.current !== id || !isCurrent()) return;
					await startContentSession(service, detail, async () => detail.folderPath);
				} catch (cause) {
					if (alive.current && isCurrent()) setError(cause instanceof Error ? cause.message : t("empty.error"));
				} finally {
					if (alive.current) setStarting(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsNavigation.Provider, {
				value: (group) => {
					setSettingsGroup(group);
					setSettingsOpen(true);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					"data-plugin": "dsh-creator-workbench",
					"data-surface": "workbench",
					"data-selected": selectedId !== null || void 0,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "workbenchHeader",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("workbench.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "workbenchActions",
								children: [selectedId !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									disabled: starting || restoring,
									onClick: () => {
										begin();
									},
									children: starting ? t("workbench.starting") : t("workbench.session")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
									tone: "ghost",
									onClick: () => {
										if (settingsOpen) settingsRef.current?.requestClose();
										else setSettingsOpen(true);
									},
									children: settingsOpen ? t("workbench.library") : t("workbench.settings")
								})]
							})]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "workbenchError",
							role: "alert",
							children: error
						}),
						restoreFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActionButton, {
							disabled: restoring,
							onClick: () => {
								reselect();
							},
							children: t("workbench.relocate")
						}),
						restoring && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "workbenchRestoreStatus",
							role: "status",
							children: t("workbench.restoring")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "workbenchSettings",
							hidden: !settingsOpen,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreatorSettingsCard, {
								initialGroup: settingsGroup,
								ref: settingsRef,
								...face,
								credentials,
								t,
								onClose: () => setSettingsOpen(false)
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "workbenchBody",
							hidden: settingsOpen,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "workbenchLibrary",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContentSidebarPanel, {
									...face,
									t
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "workbenchDetail",
								children: selectedId === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "workbenchEmpty",
									children: t("workbench.select")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContentInspector, {
									...face,
									t
								})
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/index.tsx
		function unwrap(answer, fallback) {
			if (!answer.ok || answer.value === void 0) throw Object.assign(new Error(answer.error?.message ?? fallback), { remoteResponse: true });
			return answer.value;
		}
		const inject = [
			"locale",
			"remote",
			"uiWorkspace",
			"desktopWorkbenches",
			"sessions",
			"conversation",
			"workspaces"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-creator-workbench: dictionaries");
			ctx.effect(() => {
				remountPluginCss();
				return () => {
					releasePluginCss();
				};
			}, "dsh-creator-workbench: chrome");
			const remoteOf = () => ctx.get("remote.creatorWorkbench");
			const recovery = projectRecovery({
				bindings: () => loadCreatorUiState(browserCreatorStorage()).sessionContents ?? {},
				owns: (session) => desktopWorkbenchesOf(ctx).ownsSession(session),
				recover: async (sessionId, folderPath) => {
					const remote = remoteOf();
					if (!remote) throw new Error("服务尚未就绪。");
					return unwrap(await remote.recoverProject({
						sessionId,
						folderPath
					}), "原项目恢复失败");
				},
				changed: () => bumpLibrary()
			});
			const face = () => ({
				prepareCoverRequest: async (detail, ratios, append) => {
					const r = remoteOf();
					if (!r) throw new Error("服务尚未就绪。");
					await prepareCoverRequest(ctx, detail, ratios, async (request) => unwrap(await r.coverAction(request), "封面请求更新未完成"), append);
					bumpLibrary();
				},
				inspectProject: async (id, folderPath) => {
					const r = remoteOf();
					if (!r) throw new Error("服务尚未就绪。");
					const result = unwrap(await r.projectAction({
						id,
						folderPath,
						action: "inspect"
					}), "项目检查失败");
					planProjectCleanup(ctx, folderPath, result.directoryAliases);
					return result.tasks;
				},
				projectRemoved: async (id, folderPath) => {
					const session = desktopWorkbenchesOf(ctx).currentSession(), binding = session ? loadCreatorUiState(browserCreatorStorage()).sessionContents?.[session] : void 0;
					if (session && binding && sameFolder(binding.folder, folderPath)) await recovery.one(session, folderPath);
					const r = remoteOf();
					if (!r) throw new Error("服务尚未就绪。");
					return unwrap(await r.projectAction({
						id,
						folderPath,
						action: "inspect"
					}), "项目状态读取失败").removed;
				},
				removeProject: async (id, folderPath, cancelTasks) => {
					const r = remoteOf();
					if (!r) throw new Error("服务尚未就绪。");
					const inspected = unwrap(await r.projectAction({
						id,
						folderPath,
						action: "inspect"
					}), "项目检查失败");
					await removeProjectWithHost(ctx, {
						id,
						folderPath,
						...inspected.directoryAliases ? { directoryAliases: inspected.directoryAliases } : {}
					}, async () => {
						unwrap(await r.projectAction({
							id,
							folderPath,
							action: "remove",
							cancelTasks
						}), "项目移除未完成");
					});
				},
				joinProject: async () => {
					const navigationCurrent = captureWorkbenchNavigation(desktopWorkbenchesOf(ctx)), selectionCurrent = captureContentSelection();
					const folderPath = await pickCreatorDirectory(ctx);
					if (!folderPath) return null;
					const r = remoteOf();
					if (!r) throw new Error("服务尚未就绪。");
					const added = unwrap(await r.addProject({ path: folderPath }), "加入项目失败");
					bumpLibrary();
					if (!navigationCurrent() || !selectionCurrent()) return null;
					await restoreProjectSessions(ctx, added.folderPath, async (sessionId, nativeFolder) => {
						unwrap(await r.restoreProjectSession({
							id: added.id,
							folderPath: nativeFolder ?? added.folderPath,
							sessionId
						}), "原会话分组恢复失败");
					}, added.directoryAliases, added.id);
					return added;
				},
				getProjectView: async (id) => {
					const r = remoteOf();
					if (!r) throw new Error("服务尚未就绪。");
					return unwrap(await r.getProjectView({ id }), "项目读取失败");
				},
				production: {
					projectView: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.getProjectView(request), "项目读取失败");
					},
					reconcile: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.reconcileProject(request), "任务核对失败");
					},
					publication: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.getPublicationContent(request), "材料读取失败");
					},
					articleSource: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.readArticleSource(request), "文章读取失败");
					},
					articlePreview: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.previewArticleDraft(request), "预览未完成");
					},
					articleSave: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						const result = unwrap(await r.saveArticleRevision(request), "保存未完成");
						bumpLibrary();
						return result;
					},
					settings: async () => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.getProductionSettings({}), "发布设置读取失败");
					},
					settingsAction: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.productionSettingsAction(request), "发布设置操作失败");
					},
					state: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.getProductionState(request), "任务读取失败");
					},
					action: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						const value = unwrap(await r.productionAction(request), "操作未完成");
						bumpLibrary();
						return value;
					},
					preview: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.getProductionPreview(request), "预览读取失败");
					},
					image: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.getCreationImage(request), "图片读取失败");
					},
					text: async (request) => {
						const r = remoteOf();
						if (!r) throw new Error("服务尚未就绪。");
						return unwrap(await r.getCreationText(request), "正文读取失败");
					},
					prepareRequest: async (detail, text, append) => prepareBusinessRequest(ctx, detail, async () => `${text}\n项目：${detail.id}\n目录：${detail.folderPath}`, async () => detail.folderPath, append, "创作请求"),
					prepareArticleDraft: async (detail, append) => prepareBusinessRequest(ctx, detail, async () => `请使用 WeWrite 为《${detail.title}》写文章，完成检查、按需配图并交付排版 HTML。使用本项目选题和我在会话中的要求，通过工作台文章工具保存到本项目。\n项目：${detail.id}\n目录：${detail.folderPath}`, async () => detail.folderPath, append)
				},
				getCoverState: async (request) => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					return unwrap(await r.getCoverState(request), "封面读取失败");
				},
				coverAction: async (request) => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					const state = unwrap(await r.coverAction(request), "封面操作失败");
					bumpLibrary();
					return state;
				},
				getCoverImage: async (request) => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					return unwrap(await r.getCoverImage(request), "图片读取失败");
				},
				getImageSettings: async () => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					return unwrap(await r.getImageSettings({}), "生图设置读取失败");
				},
				setImageSettings: async (request) => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					return unwrap(await r.setImageSettings(request), "生图设置保存失败");
				},
				beginImageUpdate: async (request) => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					return unwrap(await r.beginImageUpdate(request), "设置更新未开始");
				},
				completeImageUpdate: async (request) => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					return unwrap(await r.completeImageUpdate(request), "设置更新未完成");
				},
				checkImageService: async () => {
					const r = remoteOf();
					if (!r) throw new Error("remote unavailable");
					return unwrap(await r.checkImageService({}), "连接检查失败");
				},
				prepareCoverDraft: async (detail, runId, append) => {
					await prepareCoverDraft(ctx, detail, runId, async () => detail.folderPath, append);
				},
				ready: () => remoteOf() !== void 0,
				captureNavigation: () => captureWorkbenchNavigation(desktopWorkbenchesOf(ctx)),
				listContents: async (query, filter) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					recovery.history();
					const result = unwrap(await remote.listContents({
						query,
						filter
					}), "list failed");
					const previousSession = desktopWorkbenchesOf(ctx).currentSession();
					const cleanupWarnings = await reconcileRemovedProjects(ctx, result.removedItems ?? []);
					if (desktopWorkbenchesOf(ctx).currentSession() !== previousSession) bumpLibrary();
					return {
						...result,
						cleanupWarnings
					};
				},
				setContentVisibility: async (id, folderPath, hidden) => {
					const remote = remoteOf();
					if (!remote) throw new Error("服务尚未就绪。");
					return unwrap(await remote.setContentVisibility({
						id,
						folderPath,
						hidden
					}), "项目列表更新失败");
				},
				getContent: async (id, folderPath) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.getContent({
						id,
						...folderPath ? { folderPath } : {}
					}), "content failed");
				},
				getCoverThumb: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) return {
						found: false,
						mime: "",
						base64: ""
					};
					const answer = await remote.getCoverThumb({ id });
					return answer.ok && answer.value !== void 0 ? answer.value : {
						found: false,
						mime: "",
						base64: ""
					};
				},
				getVideoPlayback: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) return {
						found: false,
						url: "",
						kind: "raw"
					};
					const answer = await remote.getVideoPlayback({ id });
					return answer.ok && answer.value !== void 0 ? answer.value : {
						found: false,
						url: "",
						kind: "raw"
					};
				},
				getArticleMedia: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) return {
						found: false,
						origin: ""
					};
					const answer = await remote.getArticleMedia({ id });
					return answer.ok && answer.value !== void 0 ? answer.value : {
						found: false,
						origin: ""
					};
				},
				getSubtitleText: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) return {
						text: "",
						cues: []
					};
					const answer = await remote.getSubtitleText({ id });
					return answer.ok && answer.value !== void 0 ? answer.value : {
						text: "",
						cues: []
					};
				},
				pickDirectory: () => pickCreatorDirectory(ctx),
				openPath: async (path) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					unwrap(await remote.openContentPath({ path }), "open failed");
				},
				getSettings: async () => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.getSettings({}), "settings failed");
				},
				getCapabilities: async () => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.getCapabilities({}), "capabilities failed").capabilities;
				},
				getRevision: async () => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.getRevision({}), "revision failed").revision;
				},
				getProjectLocations: async () => {
					const remote = remoteOf();
					if (!remote) throw new Error("服务尚未就绪。");
					return unwrap(await remote.getProjectLocations({}), "保存位置读取失败");
				},
				setLibraryRoot: async (path) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					const settings = unwrap(await remote.setProjectLocation({ path }), "保存位置更新失败");
					bumpLibrary();
					return settings;
				},
				setProfile: async (profile) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					unwrap(await remote.setProfile({ profile }), "set profile failed");
					bumpProfile();
				},
				setScriptRules: async (text) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					unwrap(await remote.setScriptRules({ text }), "set script rules failed");
					bumpProfile();
				},
				refreshCatalog: async () => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					const listed = unwrap(await remote.refreshCatalog({}), "refresh failed");
					bumpLibrary();
					return listed;
				},
				createContent: async (title, parent, requestId) => {
					const remote = remoteOf();
					if (!remote) throw new Error("服务尚未就绪。");
					const navigationCurrent = captureWorkbenchNavigation(desktopWorkbenchesOf(ctx));
					if (!parent) {
						const settings = unwrap(await remote.getSettings({}), "保存位置读取失败");
						parent = settings.libraryConfirmed ? settings.libraryRoot : await pickCreatorDirectory(ctx) ?? void 0;
						if (!parent || !navigationCurrent()) throw new Error("已取消选择保存位置。");
					}
					const created = unwrap(await remote.createContent({
						title,
						libraryRoot: parent,
						...requestId ? { requestId } : {}
					}), "创建项目失败");
					bumpLibrary();
					return created;
				},
				startVideoImport: async (id, sourcePath, name, folderPath) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.startVideoImport({
						id,
						folderPath,
						sourcePath,
						...name === void 0 ? {} : { name }
					}), "导入失败");
				},
				getVideoImport: async (token) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.getVideoImport({ token }), "查询导入失败");
				},
				cancelVideoImport: async (token) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.cancelVideoImport({ token }), "取消失败");
				},
				setVideoVisibility: async (id, name, folderPath, hidden) => {
					const remote = remoteOf();
					if (!remote) throw new Error("remote unavailable");
					const next = unwrap(await remote.setVideoVisibility({
						id,
						name,
						folderPath,
						hidden
					}), "移除或恢复失败");
					bumpLibrary();
					return next;
				},
				selectVideo: async (id, name, folderPath) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.selectVideo({
						id,
						name,
						folderPath
					}), "选择失败");
				},
				setPublish: async (id, platform, status, url, folderPath) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					const next = unwrap(await remote.setPublish({
						id,
						platform,
						status,
						...url === void 0 ? {} : { url },
						...folderPath === void 0 ? {} : { folderPath }
					}), "publish failed");
					bumpLibrary();
					return next;
				},
				syncPublish: async (request) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					const result = unwrap(await remote.syncPublish(request ?? {}), "sync failed");
					bumpLibrary();
					return result;
				},
				openSubtitlePreview: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.openSubtitlePreview({ id }), "preview failed");
				},
				startSubtitleBurn: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					const next = unwrap(await remote.startSubtitleBurn({ id }), "burn failed");
					bumpLibrary();
					return next;
				},
				startSubtitleGenerate: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					const next = unwrap(await remote.startSubtitleGenerate({ id }), "transcribe failed");
					bumpLibrary();
					return next;
				},
				startCoverGenerate: async (id) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					const next = unwrap(await remote.startCoverGenerate({ id }), "cover failed");
					bumpLibrary();
					return next;
				},
				setScript: async (id, text, folderPath) => {
					const remote = remoteOf();
					if (remote === void 0) throw new Error("remote unavailable");
					return unwrap(await remote.setScript({
						id,
						text,
						...folderPath === void 0 ? {} : { folderPath }
					}), "script failed");
				}
			});
			const contentFace = face();
			ctx.inject(["inputTriggers"], (triggerCtx) => triggerCtx.effect(() => {
				return registerContentTriggers(triggerCtx.get("inputTriggers"), (id) => contentFace.getContent(id), async () => {
					return (await contentFace.listContents("", "all")).items.map((item) => ({
						id: item.id,
						title: item.title
					}));
				}, (target) => {
					const service = desktopWorkbenchesOf(ctx);
					const session = service.currentSession();
					const targetId = target?.sessionId;
					return service.isActive() && session !== void 0 && service.ownsSession(session) && (target === void 0 || targetId === session);
				});
			}, "dsh-creator-workbench: content triggers"));
			const workbenches = desktopWorkbenchesOf(ctx);
			const credentialClient = credentialsOf(ctx);
			function BusinessPanel() {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreatorWorkbench, {
					face: contentFace,
					service: workbenches,
					credentials: credentialClient,
					t: ctx.locale.bind(NS)
				});
			}
			ctx.effect(() => workbenches.register({
				title: "创作工作台",
				repository: "https://github.com/qinghui316/dsh-creator-workbench",
				description: "管理本地片库、脚本、字幕、封面与发布状态",
				panelTitle: "创作工作台",
				layout: {
					businessSide: "right",
					businessWidth: .7
				}
			}, BusinessPanel), "dsh-creator-workbench: workbench");
			ctx.effect(async () => {
				const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
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
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
