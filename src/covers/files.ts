import { execFile } from "node:child_process";
import { access, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { CoverState, CoverVersion } from "./types.ts";
import { coverStateSchema } from "./schemas.ts";

export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export const emptyCovers = (): CoverState => ({ versions: [], selected: {}, runs: [] });
const tails = new Map<string, Promise<unknown>>();
export function coverLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  tails.set(key, settled); void settled.then(() => { if (tails.get(key) === settled) tails.delete(key); });
  return result;
}
export function validId(id: string): boolean { return /^[a-f0-9-]{36}$/i.test(id); }
export async function ownedDirectory(folder: string, ...parts: string[]): Promise<string> {
  let path = folder;
  for (const part of [".dsh-creator-workbench", "covers", ...parts]) {
    if (!part || /[\\/]/.test(part) || part === "." || part === "..") throw new Error("无效的封面目录。");
    path = join(path, part); await mkdir(path).catch((e) => { if (e.code !== "EEXIST") throw e; });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("封面目录不能是链接。");
  }
  return path;
}
export async function boundedFile(folder: string, file: string): Promise<string> {
  if (isAbsolute(file)) throw new Error("封面记录必须使用相对路径。");
  const path = join(folder, file), root = await realpath(folder), actual = await realpath(path);
  const rel = relative(root, actual);
  if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error("封面文件超出内容目录。");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("封面必须是普通文件。");
  return path;
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
  // Windows briefly denies replacement while a scanner/reader has the old
  // file open. Retry the atomic operation; never unlink the previous index.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temp, path); break; }
    catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}
export async function readCoverState(folder: string): Promise<CoverState> {
  try {
    // JSON cannot contain explicit undefined; optional schema output therefore
    // also satisfies the project's exact optional property types.
    return coverStateSchema.parse(JSON.parse(await readFile(join(folder, ".dsh-creator-workbench", "covers", "index.json"), "utf8"))) as CoverState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCovers();
    throw new Error("封面记录无法读取，请保留文件并检查 index.json。");
  }
}
export async function writeCoverState(folder: string, state: CoverState): Promise<void> {
  const dir = await ownedDirectory(folder); await atomicJson(join(dir, "index.json"), state);
}
export function imageKind(bytes: Uint8Array): { mime: string; extension: string } {
  const b = Buffer.from(bytes);
  if (b.length < 12 || b.length > MAX_IMAGE_BYTES) throw new Error("图片为空、损坏或超过 24 MB。");
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: "image/png", extension: "png" };
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", extension: "webp" };
  throw new Error("只支持有效的 PNG、JPEG 或 WebP 图片。");
}
export async function mediaCommand(command: "ffmpeg" | "ffprobe", args: string[], signal?: AbortSignal): Promise<string> {
  // Use PATH, with the user's existing Windows ffmpeg install as a bounded fallback.
  let executable = command;
  if (process.platform === "win32") {
    const installed = `C:/ffmpeg/bin/${command}.exe`;
    if (await access(installed).then(() => true, () => false)) executable = installed as typeof command;
  }
  // Desktop wraps execFile to hide Windows consoles. Such wrappers need not
  // preserve Node's custom promisify symbol; use the public callback contract.
  return new Promise<string>((resolve, reject) => {
    execFile(executable, args, { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, ...(signal ? { signal } : {}) },
      (error, stdout) => { if (error) reject(error); else resolve(stdout); });
  });
}
export async function inspectImage(path: string, signal?: AbortSignal): Promise<{ mime: string; width: number; height: number }> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_IMAGE_BYTES) throw new Error("图片必须是小于 24 MB 的普通文件。");
  const { mime } = imageKind(await readFile(path));
  try {
    const data = JSON.parse(await mediaCommand("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path], signal));
    const { width, height } = data.streams?.[0] ?? {};
    if (!(width > 0 && height > 0 && width * height <= 48_000_000)) throw new Error("invalid dimensions");
    await mediaCommand("ffmpeg", ["-v", "error", "-xerror", "-i", path, "-frames:v", "1", "-f", "null", "-"], signal);
    return { mime, width, height };
  } catch { throw new Error("图片无法解码，或本机 ffmpeg/ffprobe 不可用。"); }
}
export function assertRatio(width: number, height: number, ratio: string): void {
  const [w, h] = ratio.split("x").map(Number);
  if (!w || !h || Math.abs(width / height - w / h) > 0.015) throw new Error(`图片为 ${width}×${height}，不符合 ${ratio.replace("x", ":")}；请提供符合画幅的图片。`);
}
export async function saveVersionBytes(folder: string, version: Omit<CoverVersion, "file" | "mime" | "width" | "height">, bytes: Uint8Array, signal?: AbortSignal): Promise<CoverVersion> {
  const { extension } = imageKind(bytes);
  const dir = await ownedDirectory(folder, "versions", version.id);
  const path = join(dir, `cover.${extension}`);
  await writeFile(path, bytes, { flag: "wx" });
  const image = await inspectImage(path, signal); assertRatio(image.width, image.height, version.ratio);
  return { ...version, ...image, file: relative(folder, path) };
}
