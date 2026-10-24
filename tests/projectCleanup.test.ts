import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markProjectRemoved, planProjectCleanup, restoreProjectSessions, reconcileRemovedProjects, removeProjectWithHost } from "../src/client/projectCleanup.ts";
import { getSelectedContentId, setSelectedContentId } from "../src/client/contentSelection.ts";
import { DEFAULT_UI_STATE, loadCreatorUiState, saveCreatorUiState } from "../src/client/persistence.ts";
import { restoreSessionContent } from "../src/client/workbench.ts";

beforeEach(() => { const data = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) }); });
afterEach(() => vi.unstubAllGlobals());
function fixture(shared = false) {
  const snapshot = { phase: "ready", archivedSessionIds: [] as string[], items: [{ workspaceId: "own", path: "E:/资料/本期", sessionIds: shared ? ["own", "foreign"] : ["own"] }, { workspaceId: "other", path: "E:/资料/本期-other", sessionIds: ["other"] }] };
  const workspaces = { list: { getSnapshot: () => snapshot }, delete: vi.fn(async (id: string) => { snapshot.items = snapshot.items.filter((w) => w.workspaceId !== id); }), create: vi.fn(async ({ path }: { path: string }) => { const workspace = { workspaceId: "restored", path, sessionIds: ["own"] }; snapshot.items.push(workspace); return workspace; }) };
  const navigation = { archiveSession: vi.fn(async (id: string) => { snapshot.archivedSessionIds.push(id); }), unarchiveSession: vi.fn(async (id: string) => { snapshot.archivedSessionIds = snapshot.archivedSessionIds.filter((s) => s !== id); }) };
  const service = { ownsSession: (id: string) => id === "own", currentSession: () => "own", isActive: () => true, ensureSession: vi.fn(async () => "own") };
  const sessions = { list: { getSnapshot: () => ({ phase: "ready", byId: { own: { cwd: "E:/资料/本期" }, foreign: { cwd: "E:/资料/本期" }, other: { cwd: "E:/资料/本期-other" } } }) } };
  const ctx = { get: (name: string) => ({ workspaces, sessions, uiWorkspace: navigation, desktopWorkbenches: service })[name as "workspaces"] };
  saveCreatorUiState(localStorage, { ...DEFAULT_UI_STATE, selectedId: "本期", sessionContents: { own: { contentId: "本期", folder: "E:/资料/本期" } } });
  return { ctx, navigation, workspaces, service, snapshot };
}
describe("project cleanup through public host services", () => {
  it.each(["membership", "unarchive", "selection", "return-to-original", "ensure"]) ("does not replace newer navigation during project restoration: %s", async (stage) => {
    const f = fixture(); let current = "own"; const listeners = new Set<() => void>();
    Object.assign(f.service, { currentSession: () => current, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } });
    setSelectedContentId("本期"); f.snapshot.archivedSessionIds.push("own");
    let resolve!: () => void; const pending = new Promise<void>((done) => { resolve = done; });
    if (stage === "ensure") f.service.ensureSession.mockImplementation(async () => { current = "newly-opened-B"; for (const listener of listeners) listener(); return "own"; });
    if (stage === "unarchive") f.navigation.unarchiveSession.mockImplementation(async () => { await pending; });
    else if (stage !== "ensure") f.snapshot.items[0]!.sessionIds = [];
    const restore = restoreProjectSessions(f.ctx, "E:/资料/本期", () => pending);
    if (stage === "selection") setSelectedContentId("B");
    else if (stage !== "ensure") { current = "newly-opened-B"; for (const listener of listeners) listener(); }
    if (stage === "return-to-original") { current = "own"; for (const listener of listeners) listener(); }
    resolve(); await expect(restore).rejects.toThrow("会话已切换");
    expect(f.service.ensureSession).toHaveBeenCalledTimes(stage === "ensure" ? 1 : 0); expect(listeners.size).toBe(0);
  });
  it("restores workbench navigation if the public directory registration refresh clears it", async () => {
    const f = fixture(); let active = true;
    f.snapshot.items = f.snapshot.items.filter((row) => row.workspaceId !== "own"); f.snapshot.archivedSessionIds.push("own");
    const restore = vi.fn(async (id: string) => { f.snapshot.items.push({ workspaceId: "restored", path: "E:/资料/本期", sessionIds: [id] }); active = false; });
    const home = vi.fn(async () => { active = true; });
    Object.assign(f.service, { isActive: () => active, getSnapshot: () => ({ state: { active: active ? "qinghui316/dsh-creator-workbench" : null } }), home });
    f.service.ensureSession.mockImplementation(async () => { expect(active).toBe(true); return "own"; });
    await restoreProjectSessions(f.ctx, "E:/资料/本期", restore);
    expect(home).toHaveBeenCalledExactlyOnceWith("qinghui316/dsh-creator-workbench");
    expect(f.service.ensureSession).toHaveBeenCalledExactlyOnceWith({ folder: "E:/资料/本期", sessionId: "own" });
  });
  it.each(["B", "switch-to-B", "same-id-other-library", "current"]) ("preserves navigation during the real removal orchestration: %s", async (scenario) => {
    const f = fixture(); setSelectedContentId(scenario === "B" ? "B" : "本期");
    let resolve!: () => void; const remote = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const removal = removeProjectWithHost(f.ctx, { id: "本期", folderPath: "E:/资料/本期" }, remote);
    if (scenario === "switch-to-B") setSelectedContentId("B");
    if (scenario === "same-id-other-library") { setSelectedContentId(null); setSelectedContentId("本期"); }
    resolve(); await removal;
    const expected = scenario === "current" ? null : scenario === "B" || scenario === "switch-to-B" ? "B" : "本期";
    expect(getSelectedContentId()).toBe(expected);
    expect(loadCreatorUiState(localStorage).selectedId).toBe(expected);
    expect(loadCreatorUiState(localStorage).removedProjectFolders).toEqual(["E:/资料/本期"]);
  });
  it.each([false, true])("keeps the workbench visible after active-session cleanup, respecting other navigation: %s", async (navigateElsewhere) => {
    const f = fixture(); let current: string | undefined = "own", active: string | null = "qinghui316/dsh-creator-workbench";
    const home = vi.fn(async (id: string) => { active = id; });
    Object.assign(f.service, { currentSession: () => current, getSnapshot: () => ({ state: { active } }), home });
    f.navigation.archiveSession.mockImplementation(async (id) => { f.snapshot.archivedSessionIds.push(id); current = navigateElsewhere ? "other" : undefined; active = navigateElsewhere ? "another/workbench" : null; });
    await planProjectCleanup(f.ctx, "E:/资料/本期")();
    if (navigateElsewhere) expect(home).not.toHaveBeenCalled();
    else expect(home).toHaveBeenCalledExactlyOnceWith("qinghui316/dsh-creator-workbench");
  });
  it("archives exact owned sessions, removes only the empty registration and blocks old automatic restoration", async () => {
    const f = fixture(), cleanup = planProjectCleanup(f.ctx, "e:\\资料\\本期\\");
    markProjectRemoved("E:/资料/本期", true); await cleanup();
    expect(f.navigation.archiveSession).toHaveBeenCalledExactlyOnceWith("own", { stopActivity: true });
    expect(f.workspaces.delete).toHaveBeenCalledExactlyOnceWith("own");
    const face = { getContent: vi.fn(), setLibraryRoot: vi.fn() };
    expect(await restoreSessionContent(f.service as never, face)).toBeNull(); expect(face.setLibraryRoot).not.toHaveBeenCalled();
    const restore = vi.fn(async (id: string) => { f.snapshot.items.push({ workspaceId: "restored", path: "E:/资料/本期", sessionIds: [id] }); });
    await restoreProjectSessions(f.ctx, "E:/资料/本期", restore);
    expect(restore).toHaveBeenCalledExactlyOnceWith("own");
    await restoreProjectSessions(f.ctx, "E:/资料/本期");
    expect(restore).toHaveBeenCalledOnce();
    expect(f.navigation.unarchiveSession).toHaveBeenCalledExactlyOnceWith("own");
    expect(loadCreatorUiState(localStorage).removedProjectFolders).toEqual([]);
  });
  it("preserves shared workspaces and foreign sessions, and resumes a partially failed cleanup without duplication", async () => {
    const f = fixture(true), cleanup = planProjectCleanup(f.ctx, "E:/资料/本期");
    f.navigation.archiveSession.mockRejectedValueOnce(new Error("temporarily unavailable"));
    await expect(cleanup()).rejects.toThrow("unavailable"); await cleanup(); await cleanup();
    expect(f.snapshot.archivedSessionIds).toEqual(["own"]);
    expect(f.workspaces.delete).not.toHaveBeenCalled();
    expect(f.navigation.archiveSession.mock.calls.every(([id]) => id === "own")).toBe(true);
  });
  it("does not mutate the host when the public cleanup contract is missing", () => {
    expect(() => planProjectCleanup({ get: () => undefined }, "E:/资料/本期")).toThrow();
  });
  it("restores old session membership in an existing empty group before unarchiving, without creating a session", async () => {
    const f = fixture(); f.snapshot.items[0]!.sessionIds = []; f.snapshot.archivedSessionIds.push("own");
    const restore = vi.fn(async (id: string) => { expect(f.snapshot.archivedSessionIds).toContain(id); f.snapshot.items[0]!.sessionIds.push(id); });
    await restoreProjectSessions(f.ctx, "E:/资料/本期", restore);
    expect(restore).toHaveBeenCalledExactlyOnceWith("own"); expect(f.workspaces.create).not.toHaveBeenCalled();
    expect(f.service.ensureSession).toHaveBeenCalledExactlyOnceWith({ folder: "E:/资料/本期", sessionId: "own" });
  });
  it("preserves archived history and removal state if membership restoration fails", async () => {
    const f = fixture(); f.snapshot.items[0]!.sessionIds = []; f.snapshot.archivedSessionIds.push("own"); markProjectRemoved("E:/资料/本期", true);
    await expect(restoreProjectSessions(f.ctx, "E:/资料/本期", async () => { throw new Error("unavailable"); })).rejects.toThrow("unavailable");
    expect(f.navigation.unarchiveSession).not.toHaveBeenCalled(); expect(f.service.ensureSession).not.toHaveBeenCalled();
    expect(loadCreatorUiState(localStorage).removedProjectFolders).toContain("E:/资料/本期");
  });
  it("finishes an old deletion once and preserves another current business selection", async () => {
    const f = fixture(); saveCreatorUiState(localStorage, { ...loadCreatorUiState(localStorage), selectedId: "another" });
    const old = [{ id: "本期", folderPath: "E:/资料/本期" }];
    expect(await reconcileRemovedProjects(f.ctx, old)).toEqual([]);
    expect(await reconcileRemovedProjects(f.ctx, old)).toEqual([]);
    expect(loadCreatorUiState(localStorage).selectedId).toBe("another");
    expect(f.navigation.archiveSession).toHaveBeenCalledOnce();
    expect(f.workspaces.delete).toHaveBeenCalledOnce();
  });
});
