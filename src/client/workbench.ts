import type { ComponentType } from "react";
import { browserCreatorStorage, loadCreatorUiState, saveCreatorUiState } from "./persistence.ts";

export const CREATOR_REPOSITORY = "qinghui316/dsh-creator-workbench";

/** DSH Desktop 0.11.0's installed workbench provider contract. */
export interface CreatorWorkbenchService {
  register: (descriptor: {
    title: string;
    repository: string;
    description: string;
    panelTitle: string;
    layout: { businessSide: "right"; businessWidth: number };
  }, panel: ComponentType) => () => void;
  subscribe: (listener: () => void) => () => void;
  currentSession: () => string | undefined;
  ownsSession: (sessionId: string) => boolean;
  isActive: () => boolean;
  ensureSession: (request: { folder: string; sessionId?: string }) => Promise<string>;
}

interface Services { get: (name: string) => unknown }
export function desktopWorkbenchesOf(ctx: Services): CreatorWorkbenchService {
  const service = ctx.get("desktopWorkbenches") as CreatorWorkbenchService | undefined;
  if (service === undefined) throw new Error("请使用提供工作台服务的 DSH Desktop 打开内容工作台。");
  return service;
}

export function captureWorkbenchNavigation(service: CreatorWorkbenchService): () => boolean {
  const session = service.currentSession();
  return () => service.isActive() && service.currentSession() === session;
}

export function pickCreatorDirectory(ctx: Services): Promise<string | null> {
  // Match Desktop's official native directory-flow provider: its preload
  // bridge shows an Electron dialog, while the Host RPC uses an OS subprocess.
  const desktop = (globalThis as typeof globalThis & {
    __DSH_DIRECTORY_PICKER__?: { pick: () => Promise<string | null> };
  }).__DSH_DIRECTORY_PICKER__;
  if (desktop !== undefined) return desktop.pick();
  const navigation = ctx.get("uiWorkspace") as { pickDirectory: () => Promise<string | null> };
  return navigation.pickDirectory();
}

/** Write only through the host's session-addressed input API; never auto-send. */
export async function prepareCoverDraft(ctx: Services, content: { id: string; folderPath: string }, runId: string, picker: () => Promise<string | null>, append = false): Promise<void> {
  const workbenches = desktopWorkbenchesOf(ctx);
  const expectedSelection = loadCreatorUiState(browserCreatorStorage()).selectedId;
  if (expectedSelection !== content.id) throw new Error("内容已切换，请重新发起。");
  const binding = contentBindingForSession(workbenches);
  const sessionId = binding?.contentId === content.id && binding.folder === content.folderPath
    ? workbenches.currentSession() : await startContentSession(workbenches, content, picker);
  if (!sessionId) throw new Error("已取消会话创建，制作请求尚未发送。");
  if (loadCreatorUiState(browserCreatorStorage()).selectedId !== expectedSelection) throw new Error("内容已切换，未写入旧制作请求。");
  if (!workbenches.isActive() || workbenches.currentSession() !== sessionId || !workbenches.ownsSession(sessionId)) throw new Error("会话已切换，请重新发起。");
  const sessions = ctx.get("sessions") as { scope: (id: string) => { get: (name: string) => unknown; bail: (event: string, request: unknown) => unknown } | undefined } | undefined;
  const scoped = sessions?.scope(sessionId);
  const conversation = scoped?.get("conversation") as { input: { for: (scope: unknown) => { state: { getSnapshot: () => { draft: string; draftRev: number; phase: string; occurrences: unknown[]; attachmentIds: unknown[] } }; setDraft: (text: string) => void; focus: () => void } } } | undefined;
  if (!scoped || !conversation) throw new Error("宿主原生会话输入尚未就绪，请稍后重试。");
  const input = conversation.input.for(scoped), state = input.state.getSnapshot();
  if (state.phase !== "plain") throw new Error("会话输入正在处理请求，请稍后重试。");
  const text = `请使用创作工作台的原生 Agent 封面流程。先调用 creator_prepare_cover 查看真实候选画面，并读取返回的 oil-cover 规则；完成选帧、标题、逐画幅提示词后调用 creator_generate_cover。分析后直接生成，不增加方案审批。等待任务结果后读取图片、逐画幅质检，再保存结论和当前使用版本。\n本次固定输入：${JSON.stringify({ id: content.id, folderPath: content.folderPath, runId })}\n不要改用其他内容、其他视频或外部视觉分析服务；不要读取或输出 API Key。`;
  if (state.draft || state.occurrences.length || state.attachmentIds.length) {
    if (!append) throw new Error("当前会话已有草稿，原内容已保留。请点击‘追加制作请求’。");
    const applied = scoped.bail("slash/input-insert-text", { text: `\n\n${text}`, span: { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev } });
    if (!applied) throw new Error("草稿已变化，未插入，请重试。");
  } else input.setDraft(text);
  input.focus();
}
const recentBindings = new WeakMap<CreatorWorkbenchService, Map<string, { contentId: string; folder: string; requiresNewSession?: boolean }>>();

/** Never adopt a native or another workbench's saved session. No auto-send. */
export async function startContentSession(
  service: CreatorWorkbenchService,
  content: { id: string; folderPath: string },
  pickDirectory: () => Promise<string | null>,
): Promise<string | null> {
  const state = loadCreatorUiState(browserCreatorStorage());
  const saved = Object.entries({ ...state.sessionContents, ...Object.fromEntries(recentBindings.get(service) ?? []) }).find(([id, item]) =>
    item.requiresNewSession !== true && item.contentId === content.id && item.folder === content.folderPath && service.ownsSession(id));
  let folder = content.folderPath;
  if (saved === undefined) {
    const selected = await pickDirectory();
    if (selected === null || !service.isActive()) return null;
    // Business content must stay in its existing folder; do not silently switch
    // to the most recent workspace or a directory inferred from the repository.
    if (selected.replace(/[\\/]+$/, "") !== folder.replace(/[\\/]+$/, "")) {
      throw new Error(`请在目录选择器中选择这一期的资料目录：${folder}`);
    }
    // Keep the catalog path as the stable identity even if the picker returns a trailing slash.
  }
  if (!service.isActive()) return null;
  const sessionId = await service.ensureSession({ folder, ...(saved ? { sessionId: saved[0] } : {}) });
  if (!service.ownsSession(sessionId)) return null;
  const pending = recentBindings.get(service) ?? new Map();
  pending.set(sessionId, { contentId: content.id, folder });
  recentBindings.set(service, pending);
  const latest = loadCreatorUiState(browserCreatorStorage());
  if (!saveCreatorUiState(browserCreatorStorage(), {
    ...latest,
    sessionContents: { ...latest.sessionContents, [sessionId]: { contentId: content.id, folder } },
  })) throw new Error("会话已创建，但内容关联未保存。请保留当前内容并重试。");
  return service.isActive() && service.currentSession() === sessionId ? sessionId : null;
}

export function contentBindingForSession(service: CreatorWorkbenchService): { contentId: string; folder: string } | null {
  const session = service.currentSession();
  if (session === undefined || !service.ownsSession(session)) return null;
  return recentBindings.get(service)?.get(session)
    ?? loadCreatorUiState(browserCreatorStorage()).sessionContents?.[session] ?? null;
}

export function contentForSession(service: CreatorWorkbenchService): string | null {
  return contentBindingForSession(service)?.contentId ?? null;
}

export function libraryRootForFolder(folder: string): string {
  const clean = folder.replace(/[\\/]+$/, "");
  if (!clean.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(clean)) throw new Error("资料目录必须是绝对路径。");
  const cut = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return cut === 0 ? "/" : cut === 2 && clean[1] === ":" ? clean.slice(0, 3) : clean.slice(0, cut);
}

/** Restore the confirmed folder as well as the id; ids can repeat in different libraries. */
export async function restoreSessionContent(service: CreatorWorkbenchService, face: {
  setLibraryRoot: (root: string) => Promise<void>;
  getContent: (id: string) => Promise<{ folderPath: string }>;
}): Promise<string | null> {
  const session = service.currentSession();
  const binding = contentBindingForSession(service);
  if (binding === null || !service.isActive()) return null;
  const current = () => service.isActive() && service.currentSession() === session;
  await face.setLibraryRoot(libraryRootForFolder(binding.folder));
  if (!current()) return null;
  const detail = await face.getContent(binding.contentId);
  if (detail.folderPath !== binding.folder) throw new Error("资料位置已改变，请重新选择资料目录。");
  return current() ? binding.contentId : null;
}

/** Relocate business data explicitly without changing the old session's host-owned workspace. */
export async function relocateSessionContent(service: CreatorWorkbenchService, folder: string, face: {
  setLibraryRoot: (root: string) => Promise<void>;
  getContent: (id: string) => Promise<{ folderPath: string }>;
}): Promise<string | null> {
  const session = service.currentSession();
  if (session === undefined || !service.ownsSession(session) || !service.isActive()) return null;
  const root = libraryRootForFolder(folder);
  const clean = folder.replace(/[\\/]+$/, "");
  const id = clean.slice(Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\")) + 1);
  await face.setLibraryRoot(root);
  if (!service.isActive() || service.currentSession() !== session) return null;
  const detail = await face.getContent(id);
  if (detail.folderPath !== clean) throw new Error("请选择包含这一期资料的内容文件夹。");
  if (!service.isActive() || service.currentSession() !== session) return null;
  const binding = { contentId: id, folder: detail.folderPath, requiresNewSession: true };
  const pending = recentBindings.get(service) ?? new Map();
  pending.set(session, binding); recentBindings.set(service, pending);
  const state = loadCreatorUiState(browserCreatorStorage());
  if (!saveCreatorUiState(browserCreatorStorage(), { ...state, sessionContents: { ...state.sessionContents, [session]: binding } })) {
    throw new Error("新资料关联未保存，请保留当前选择并重试。");
  }
  return id;
}
