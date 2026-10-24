import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreProjectSessionMembership } from "../src/projectSessionsHost.ts";

let root: string, folder: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "creator-restore-")); folder = join(root, "中文 项目"); await mkdir(folder); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function fixture(cwd: string | undefined = folder, registered = true) {
  const observation = { header: cwd === undefined ? {} : { cwd }, [Symbol.dispose]: vi.fn() };
  const workspace = { attachSession: vi.fn(async () => {}) };
  const registry = { resolveByPath: vi.fn(async () => registered ? workspace : undefined), create: vi.fn(async () => workspace) };
  const query = { observeSession: vi.fn(async () => observation) };
  const ctx = { get: (name: string) => name === "workspaceRegistry" ? registry : name === "sessionQuery" ? query : undefined };
  return { ctx, observation, workspace, registry, query };
}
describe("original project session membership", () => {
  it.each([true, false])("attaches the exact existing session, reusing the directory registration when present: %s", async (registered) => {
    const f = fixture(folder, registered);
    await restoreProjectSessionMembership(f.ctx, folder, "original", new AbortController().signal);
    expect(f.workspace.attachSession).toHaveBeenCalledExactlyOnceWith("original");
    expect(f.registry.create).toHaveBeenCalledTimes(registered ? 0 : 1);
    expect(f.observation[Symbol.dispose]).toHaveBeenCalledOnce();
  });
  it("rejects another existing directory before registering or attaching anything", async () => {
    const f = fixture(root);
    await expect(restoreProjectSessionMembership(f.ctx, folder, "original", new AbortController().signal)).rejects.toThrow("目录");
    expect(f.registry.create).not.toHaveBeenCalled(); expect(f.workspace.attachSession).not.toHaveBeenCalled(); expect(f.observation[Symbol.dispose]).toHaveBeenCalledOnce();
  });
  it("does not register a workspace for a missing original session", async () => {
    const f = fixture(); f.query.observeSession.mockRejectedValue(new Error("not found"));
    await expect(restoreProjectSessionMembership(f.ctx, folder, "missing", new AbortController().signal)).rejects.toThrow("not found");
    expect(f.registry.create).not.toHaveBeenCalled(); expect(f.workspace.attachSession).not.toHaveBeenCalled();
  });
  it("propagates host attach failure while releasing the observation", async () => {
    const f = fixture(); f.workspace.attachSession.mockRejectedValue(new Error("attach failed"));
    await expect(restoreProjectSessionMembership(f.ctx, folder, "original", new AbortController().signal)).rejects.toThrow("attach failed");
    expect(f.observation[Symbol.dispose]).toHaveBeenCalledOnce();
  });
  it("rejects cancellation before changing host state", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(restoreProjectSessionMembership(f.ctx, folder, "original", controller.signal)).rejects.toThrow();
    expect(f.query.observeSession).not.toHaveBeenCalled(); expect(f.registry.create).not.toHaveBeenCalled();
  });
});
