import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extraBinDirs, pathEnvValue } from "../runtimePaths.ts";
import { runProcess } from "./process.ts";
import type { RuntimeStatus } from "./types.ts";

export const PUBLISHER_COMMIT = "0d02cc5387b0bea0a43d5aa4e72a2c9502d05f94";
export const exists = (file: string): Promise<boolean> => access(file).then(() => true, () => false);
export const publisherRoot = (dataDir: string): string => join(dataDir, "runtime", `video-publisher-${PUBLISHER_COMMIT.slice(0, 12)}`);
export const pythonPath = (dataDir: string): string => join(dataDir, "runtime", "wewrite-python", "Scripts", "python.exe");
export async function resource(...parts: string[]): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const root of [join(here, ".."), join(here, "..", "..")]) { const file = join(root, ...parts); if (await exists(file)) return file; }
  throw new Error("工作台运行资源缺失，请重新安装完整包。");
}
export async function egoCompatibilityPrelude(): Promise<string> {
  const module = await import(pathToFileURL(await resource("scripts", "ego-compat.mjs")).href) as { legacyEgoPrelude: () => string };
  return module.legacyEgoPrelude();
}
export async function executable(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const dirs = [...pathEnvValue(env).split(delimiter), ...extraBinDirs("win32", homedir(), env)];
  for (const dir of dirs.filter(Boolean)) for (const suffix of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) { const file = join(dir, `${name}${suffix}`); if (await exists(file)) return file; }
  return undefined;
}
export async function browserExecutable(): Promise<string> {
  const found = await executable("ego-browser"); if (found) return found;
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  for (const file of [join(homedir(), ".local", "share", "ego", "active_version_dir", "ego-browser.exe"), join(homedir(), ".ego", "bin", "ego-browser.exe"), join(homedir(), ".local", "bin", "ego-browser.exe"), join(local, "Programs", "ego lite", "ego-browser.exe"), join(local, "Programs", "ego lite", "resources", "bin", "ego-browser.exe")]) if (await exists(file)) return file;
  throw new Error("请安装并打开 Ego 浏览器 Windows 版，完成首次设置后重试。");
}
export async function runtimeStatus(dataDir: string): Promise<RuntimeStatus> {
  const publisher = await exists(join(publisherRoot(dataDir), "scripts", "v2", "publisher.mjs"));
  const article = await resource("vendor", "wewrite", "SKILL.md").then(() => true, () => false);
  const python = await exists(pythonPath(dataDir));
  const ffmpeg = Boolean(await executable("ffmpeg")) || await exists("C:/ffmpeg/bin/ffmpeg.exe");
  const browser = await browserExecutable().then(() => true, () => false);
  return { publisher, article, python, ffmpeg, browser, details: [!publisher || !article || !python ? "请先准备 Windows 运行环境。" : "", !ffmpeg ? "需要 FFmpeg 才能提取音频和截图。" : "", !browser ? "视频上传和数据回收需要 Ego 浏览器 Windows 版。" : ""].filter(Boolean) };
}
export async function prepareRuntime(dataDir: string, signal: AbortSignal): Promise<void> {
  const script = await resource("scripts", "install-runtime.mjs"), python = await executable("python");
  if (!python) throw new Error("未找到 Python 3.12，请安装后重新准备运行环境。");
  const answer = await runProcess(process.execPath, [script, dataDir, python], { signal, timeout: 600_000, env: { ELECTRON_RUN_AS_NODE: "1" } });
  if (answer.code !== 0) throw new Error("运行环境准备失败，请检查网络和 Python 安装后重试。");
  const status = await runtimeStatus(dataDir); if (!status.publisher || !status.article || !status.python) throw new Error("运行环境准备尚未完成，请重试。");
}
export async function pinnedPublisher(dataDir: string): Promise<string> {
  const root = publisherRoot(dataDir), manifest = JSON.parse(await readFile(join(root, ".source.json"), "utf8")) as { commit?: string };
  if (manifest.commit !== PUBLISHER_COMMIT) throw new Error("上传工具版本与本工作台不匹配，请重新准备运行环境。"); return root;
}
