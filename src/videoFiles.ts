import { lstat, realpath } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { validVideoName } from "./videoSelection.ts";

export function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error("文件必须位于当前内容目录中。");
  }
}

export async function contentFolder(root: string, folder: string): Promise<string> {
  const realRoot = await realpath(root);
  const realFolder = await realpath(folder);
  assertInside(realRoot, realFolder);
  if (dirname(realFolder) !== realRoot) throw new Error("内容目录必须直接位于资料库内。");
  return realFolder;
}

export async function videoFile(folder: string, name: string): Promise<string> {
  if (!validVideoName(name)) throw new Error("请选择 MP4 或 MOV 文件，名称不能含路径或 Windows 保留字符。");
  const path = join(folder, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error("视频必须是非空的普通文件。");
  assertInside(await realpath(folder), await realpath(path));
  return path;
}
