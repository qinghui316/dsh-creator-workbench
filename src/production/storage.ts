import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { emptyProduction, type MediaIdentity, type ProductionSettings, type ProductionState } from "./types.ts";

const tails = new Map<string, Promise<unknown>>();
export function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const result = previous.then(work, work), settled = result.then(() => undefined, () => undefined);
  tails.set(key, settled); void settled.then(() => { if (tails.get(key) === settled) tails.delete(key); }); return result;
}
export async function atomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
  for (let n = 0; ; n++) {
    try { await rename(temp, path); return; }
    catch (cause) { if (n === 5 || !["EPERM", "EBUSY", "EACCES"].includes((cause as NodeJS.ErrnoException).code ?? "")) throw cause; await new Promise((r) => setTimeout(r, 30 * (n + 1))); }
  }
}
export async function readJson<T>(path: string, fallback: () => T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return fallback(); throw new Error("记录无法读取，请保留文件并检查后重试。"); }
}
export async function owned(folder: string, ...parts: string[]): Promise<string> {
  let path = await realpath(folder);
  for (const name of [".dsh-creator-workbench", "production", ...parts]) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === "." || name === "..") throw new Error("无效的任务目录。");
    path = join(path, name); await mkdir(path).catch((e) => { if (e.code !== "EEXIST") throw e; });
    const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("任务目录不能使用链接。");
  } return path;
}
export async function inside(folder: string, file: string): Promise<string> {
  const root = await realpath(folder), path = isAbsolute(file) ? file : join(root, file), actual = await realpath(path), rel = relative(root, actual);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../")) throw new Error("文件超出本期目录。");
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error("请使用普通文件。"); return actual;
}
export async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256"), stream = createReadStream(path, signal ? { signal } : {});
  for await (const chunk of stream) hash.update(chunk as Buffer); return hash.digest("hex");
}
export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");
export async function mediaIdentity(path: string, signal?: AbortSignal): Promise<MediaIdentity> {
  const before = await stat(path), sha256 = await hashFile(path, signal), after = await stat(path);
  if (!before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("视频在读取时发生变化，请重新准备。");
  return { name: path.split(/[\\/]/).pop()!, size: before.size, modifiedAt: before.mtimeMs, sha256 };
}
export async function readState(folder: string): Promise<ProductionState> {
  let directory = await realpath(folder);
  for (const name of [".dsh-creator-workbench", "production"]) {
    directory = join(directory, name);
    const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (!info) return emptyProduction();
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("任务目录不能使用链接。");
  }
  const file = join(directory, "index.json");
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("任务记录必须为普通文件。");
  const state = await readJson(file, emptyProduction);
  if (state.schemaVersion !== 1 || ![state.tasks, state.transcripts, state.articles, state.drafts, state.metrics].every(Array.isArray)) throw new Error("任务记录格式不受支持。"); return state;
}
export async function updateState<T>(folder: string, work: (state: ProductionState) => T | Promise<T>): Promise<T> {
  return locked(folder, async () => { const state = await readState(folder), result = await work(state); await atomic(join(await owned(folder), "index.json"), state); return result; });
}
export const emptySettings = (): ProductionSettings => ({ revision: randomUUID(), accounts: {}, accountHistory: [], observations: {}, browserPaused: false, wechat: { appid: "", theme: "claude-editorial", author: "" } });
export async function readSettings(dataDir: string): Promise<ProductionSettings> {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, "production-settings.json");
  try { await writeFile(path, JSON.stringify(emptySettings(), null, 2), { encoding: "utf8", flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const value = await readJson(path, emptySettings);
  if (!value.revision || !value.accounts || !Array.isArray(value.accountHistory) || !value.wechat) throw new Error("发布设置无法读取。"); return value;
}
export async function updateSettings<T>(dataDir: string, work: (settings: ProductionSettings) => T | Promise<T>): Promise<T> {
  return locked(`settings:${dataDir}`, async () => { const settings = await readSettings(dataDir), result = await work(settings); settings.revision = randomUUID(); await atomic(join(dataDir, "production-settings.json"), settings); return result; });
}
export const wechatCredential = (appid: string): string => `CREATOR_WECHAT_SECRET_${hashText(appid).slice(0, 16).toUpperCase()}`;
