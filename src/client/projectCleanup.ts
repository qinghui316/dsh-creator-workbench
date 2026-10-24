import { browserCreatorStorage, loadCreatorUiState, saveCreatorUiState } from "./persistence.ts";
import { CREATOR_REPOSITORY, desktopWorkbenchesOf, sameFolder } from "./workbench.ts";
import { bumpLibrary, captureContentSelection, getSelectedContentId, setSelectedContentId } from "./contentSelection.ts";

interface Services { get: (name: string) => unknown }
interface Workspace { workspaceId: string; path: string; sessionIds: string[] }
interface WorkspaceController {
  list: { getSnapshot: () => { phase: string; items: Workspace[]; archivedSessionIds: string[] } };
  delete: (id: string) => Promise<void>;
}
interface Navigation { archiveSession: (id: string, options: { stopActivity: boolean }) => Promise<void>; unarchiveSession: (id: string) => Promise<void> }
async function hostOperation<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("宿主操作结果暂未确认，请重试核对原记录。")), 15_000); })]); }
  finally { clearTimeout(timer!); }
}

export function markProjectRemoved(folder: string, removed: boolean, _contentId?: string): void {
  const storage = browserCreatorStorage(), state = loadCreatorUiState(storage);
  const folders = (state.removedProjectFolders ?? []).filter((f) => !sameFolder(f, folder));
  if (!saveCreatorUiState(storage, { ...state, removedProjectFolders: removed ? [...folders, folder] : folders })) throw new Error("项目操作已完成，但导航记录未保存，请重试。");
}

/** The Remote and native cleanup share one selection guard across their asynchronous work. */
export async function removeProjectWithHost(ctx: Services, content: { id: string; folderPath: string }, remove: () => Promise<void>): Promise<void> {
  const cleanup = planProjectCleanup(ctx, content.folderPath), selectionCurrent = captureContentSelection();
  await remove();
  markProjectRemoved(content.folderPath, true, content.id);
  if (selectionCurrent() && getSelectedContentId() === content.id) setSelectedContentId(null);
  try { await cleanup(); } catch (error) { throw new Error(`项目已从列表移除，部分会话或工作区尚未清理，请重试。${error instanceof Error ? error.message : String(error)}`); }
  bumpLibrary();
}

const reconciled = new WeakMap<Services, Map<string, Promise<string | undefined>>>();
/** Finish host cleanup for removal records written by older versions. No files or unrelated sessions are touched. */
export async function reconcileRemovedProjects(ctx: Services, items: Array<{ id: string; folderPath: string }>): Promise<string[]> {
  const entries = reconciled.get(ctx) ?? new Map<string, Promise<string | undefined>>(); reconciled.set(ctx, entries);
  const warnings: string[] = [];
  for (const item of items) {
    let pending = entries.get(item.folderPath);
    if (!pending) {
      pending = (async () => {
        try { markProjectRemoved(item.folderPath, true, item.id); await planProjectCleanup(ctx, item.folderPath)(); }
        catch (error) { return `已移除项目的会话清理未完成：${error instanceof Error ? error.message : String(error)}`; }
        return undefined;
      })(); entries.set(item.folderPath, pending);
    }
    const warning = await pending;
    if (warning) { warnings.push(warning); entries.delete(item.folderPath); }
  }
  return warnings;
}

/** Freeze public host identities before archiving; never edit host storage or infer ownership by title. */
export function planProjectCleanup(ctx: Services, folder: string): () => Promise<void> {
  const workbenches = desktopWorkbenchesOf(ctx), workspaces = ctx.get("workspaces") as WorkspaceController | undefined;
  const sessions = ctx.get("sessions") as { list: { getSnapshot: () => { phase: string; byId: Record<string, { cwd?: string }> } } } | undefined;
  const navigation = ctx.get("uiWorkspace") as Navigation | undefined;
  if (!workspaces?.delete || !navigation?.archiveSession || !sessions) throw new Error("当前 Desktop 尚未提供完整的会话归档和工作区清理接口。项目未删除，请升级后重试。");
  const snapshot = workspaces.list.getSnapshot(), all = sessions.list.getSnapshot();
  if (snapshot.phase !== "ready" || all.phase !== "ready") throw new Error("工作区仍在读取，请稍后重试。");
  const exact = snapshot.items.filter((item) => sameFolder(item.path, folder));
  const owned = Object.entries(all.byId).filter(([id, item]) => sameFolder(item.cwd, folder) && workbenches.ownsSession(id)).map(([id]) => id);
  const preserveView = workbenches.isActive() && owned.includes(workbenches.currentSession() ?? "");
  return async () => {
    for (const id of owned) {
      if (!workbenches.ownsSession(id) || !sameFolder(sessions.list.getSnapshot().byId[id]?.cwd, folder)) throw new Error("会话归属已变化，已停止清理，请重试。");
      if (!workspaces.list.getSnapshot().archivedSessionIds.includes(id)) await hostOperation(navigation.archiveSession(id, { stopActivity: true }));
    }
    for (const item of exact) {
      const current = workspaces.list.getSnapshot().items.find((w) => w.workspaceId === item.workspaceId);
      // Shared workspaces remain registered, including when their foreign sessions are archived.
      if (!current || !sameFolder(current.path, folder) || current.sessionIds.some((id) => !owned.includes(id))) continue;
      const archived = workspaces.list.getSnapshot().archivedSessionIds;
      if (current.sessionIds.every((id) => archived.includes(id))) await hostOperation(workspaces.delete(current.workspaceId));
    }
    const view = workbenches.getSnapshot?.();
    if (preserveView && !workbenches.currentSession() && view && (view.state.active === null || view.state.active === CREATOR_REPOSITORY) && !view.marketOpen && workbenches.home) {
      await hostOperation(workbenches.home(CREATOR_REPOSITORY));
    }
  };
}

export async function restoreProjectSessions(ctx: Services, folder: string, restoreMembership?: (sessionId: string) => Promise<void>): Promise<void> {
  const service = desktopWorkbenchesOf(ctx), state = loadCreatorUiState(browserCreatorStorage());
  const startedActive = service.isActive();
  const workspaces = ctx.get("workspaces") as WorkspaceController | undefined, navigation = ctx.get("uiWorkspace") as Navigation | undefined;
  const archived = workspaces?.list.getSnapshot().archivedSessionIds ?? [];
  const candidates = Object.entries(state.sessionContents ?? {}).filter(([id, binding]) => sameFolder(binding.folder, folder) && service.ownsSession(id));
  const saved = candidates.find(([id]) => id === service.currentSession()) ?? candidates.at(-1);
  // Restore one existing conversation through Desktop's directory-aware provider.
  // Other history stays archived instead of appearing as orphaned visible conversations.
  if (saved) {
    const originalSession = service.currentSession(), selectionCurrent = captureContentSelection();
    let interrupted = false, restoringSession = false;
    const navigationChanged = () => {
      const current = service.currentSession(), view = service.getSnapshot?.();
      const changedSelection = !selectionCurrent() && (!restoringSession || getSelectedContentId() !== saved[1].contentId);
      if (changedSelection || current && current !== originalSession && current !== saved[0] || view?.marketOpen || view && view.state.active !== null && view.state.active !== CREATOR_REPOSITORY) interrupted = true;
    };
    const checkNavigation = () => { navigationChanged(); if (interrupted) throw new Error("会话已切换，项目资料已保留。请回到工作台后重新打开项目对话。"); };
    const unsubscribe = service.subscribe?.(navigationChanged);
    try {
      checkNavigation();
      if (!workspaces?.list.getSnapshot().items.some((item) => sameFolder(item.path, folder) && item.sessionIds.includes(saved[0]))) {
        if (!restoreMembership) throw new Error("项目已加入，当前 Desktop 尚未提供恢复目录分组的接口。原会话保持完整。");
        await hostOperation(restoreMembership(saved[0]));
        checkNavigation();
      }
      if (archived.includes(saved[0]) && navigation) await hostOperation(navigation.unarchiveSession(saved[0]));
      checkNavigation();
      if (!service.isActive()) {
        const view = service.getSnapshot?.(), current = service.currentSession();
        if (!startedActive || !view || view.marketOpen || view.state.active !== null && view.state.active !== CREATOR_REPOSITORY || current && current !== saved[0] || !service.home) throw new Error("会话已切换，项目资料已保留。请回到工作台后重新打开项目对话。");
        await hostOperation(service.home(CREATOR_REPOSITORY));
        checkNavigation();
      }
      restoringSession = true;
      const actual = await hostOperation(service.ensureSession({ folder, sessionId: saved[0] }));
      checkNavigation();
      if (actual !== saved[0]) throw new Error("项目已加入，但宿主未恢复原会话。请核对现有工作区，未继续创建会话。");
    } finally { unsubscribe?.(); }
  }
  markProjectRemoved(folder, false);
  reconciled.get(ctx)?.delete(folder);
}
