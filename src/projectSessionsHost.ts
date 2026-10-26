import { boundedRead } from "./fsReadDeadline.ts";
import { directoryKey } from "./projects.ts";
import { isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";

interface Services { get: (name: string) => unknown }
interface Workspace { attachSession: (id: string) => Promise<void> }
interface WorkspaceRegistry {
  resolveByPath: (path: string) => Promise<Workspace | undefined>;
  create: (path: string) => Promise<Workspace>;
}
interface SessionObservation { header: { cwd?: string }; [Symbol.dispose]: () => void }
interface SessionQuery { observeSession: (id: string) => Promise<SessionObservation> }

/** Re-account an existing session using the host's exported, cwd-validating registry API. */
export async function restoreProjectSessionMembership(ctx: Services, folder: string, sessionId: string, signal: AbortSignal): Promise<void> {
  const registry = ctx.get("workspaceRegistry") as WorkspaceRegistry | undefined;
  const query = ctx.get("sessionQuery") as SessionQuery | undefined;
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
  } finally { observation[Symbol.dispose](); }
}

/** Observe an existing session only. Recovery never creates/attaches a workspace. */
export async function verifyProjectSessionDirectory(ctx: Services, folder: string, sessionId: string, signal: AbortSignal): Promise<void> {
  const query = ctx.get("sessionQuery") as SessionQuery | undefined;
  if (!query?.observeSession) throw new Error("当前 Desktop 尚未提供原会话目录查询接口。");
  signal.throwIfAborted(); const observation = await query.observeSession(sessionId);
  try {
    const cwd = observation.header.cwd;
    if (!cwd || !isAbsolute(cwd) || !isAbsolute(folder)) throw new Error("原会话目录与项目不一致。");
    let same = false;
    try { same = directoryKey(await boundedRead(realpath(cwd))) === directoryKey(await boundedRead(realpath(folder))); }
    catch (error) { if (!["ENOENT", "EACCES", "EPERM", "ENOTDIR", "ETIMEDOUT"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; same = directoryKey(cwd) === directoryKey(folder); }
    if (!same) throw new Error("原会话目录与项目不一致。"); signal.throwIfAborted();
  }
  finally { observation[Symbol.dispose](); }
}
