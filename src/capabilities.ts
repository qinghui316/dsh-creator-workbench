import { constants, existsSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { skillDirCandidates } from "./config.ts";
import {
  egoInstallCandidates,
  extraBinDirs,
  pathEnvValue,
} from "./runtimePaths.ts";
import { publisherRoot, resource } from "./production/runtime.ts";
import type {
  CreatorCapabilities,
  CreatorCapability,
  CreatorSecrets,
  CreatorSetupStatus,
  LibrarySettings,
} from "./types.ts";

interface InspectCreatorSetupOptions {
  libraryRoot: string;
  dataDir: string;
  subtitleSkillDir: string;
  coverSkillDir: string;
  settings: LibrarySettings;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  findSkillDir?: (skillName: string) => string | undefined;
}

export function defaultFindSkillDir(skillName: string, home = homedir()): string | undefined {
  return skillDirCandidates(skillName, home).find((candidate) => existsSync(join(candidate, "SKILL.md")));
}

function capability(
  state: CreatorCapability["state"],
  required: boolean,
  detail: string,
  path?: string,
): CreatorCapability {
  return path === undefined
    ? { state, required, detail }
    : { state, required, detail, path };
}

async function libraryCapability(path: string): Promise<CreatorCapability> {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    return capability("missing", true, "内容目录不存在，需要先选择或创建目录。", path);
  }
  const writable = await access(path, constants.R_OK | constants.W_OK).then(() => true, () => false);
  return writable
    ? capability("ready", true, "内容目录可读写。", path)
    : capability("missing", true, "内容目录存在，但当前进程没有读写权限。", path);
}

async function subtitleCapability(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): Promise<CreatorCapability> {
  if (platform !== "win32") return capability("unsupported", false, "当前语音转文字入口面向 Windows。");
  const ffmpeg = await findExecutable("ffmpeg", env, platform, home);
  const local = home === homedir() && existsSync("C:/ffmpeg/bin/ffmpeg.exe");
  return ffmpeg || local ? capability("ready", false, "本地音频提取可用；火山识别能力需使用已配置服务实际验证。") : capability("missing", false, "请安装 FFmpeg，再使用火山录音文件识别。");
}

async function coverCapability(
  path: string,
  platform: NodeJS.Platform,
): Promise<CreatorCapability> {
  const rules = join(path, "references", "cover-rules.md");
  const flow = join(path, "references", "agent-native-flow.md");
  const ready = await Promise.all([rules, flow].map((file) => access(file, constants.R_OK).then(() => true, () => false)));
  return ready.every(Boolean) ? capability("ready", false, "已发现 oil-cover 原生 Agent 流程和视觉规则；看图能力由当前 Harness 模型决定。", path)
    : capability("missing", false, "未发现 oil-cover 原生流程与视觉规则；已有封面管理仍可使用。", path);
}

function credentialCapability(secret: CreatorSecrets[keyof CreatorSecrets], label: string): CreatorCapability {
  return secret.configured
    ? capability("ready", false, `${label}凭据已配置。`)
    : capability("missing", false, `${label}凭据未配置。`);
}

export async function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): Promise<string | undefined> {
  const pathValue = pathEnvValue(env);
  const extensions = platform === "win32"
    ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)]
    : [""];
  const mode = platform === "win32" ? constants.F_OK : constants.X_OK;
  const directories = [
    ...pathValue.split(delimiter).filter(Boolean),
    ...extraBinDirs(platform, home, env),
  ];
  for (const directory of directories) {
    for (const extension of extensions) {
      const fileName = platform === "win32" && extension !== ""
        ? `${command}${extension}`
        : command;
      const path = join(directory, fileName);
      if (await access(path, mode).then(() => true, () => false)) return path;
    }
  }
  return undefined;
}

async function findEgo(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<{ path: string; kind: "cli" | "app" } | undefined> {
  const cli = await findExecutable("ego-browser", env, platform, home);
  if (cli !== undefined) return { path: cli, kind: "cli" };
  for (const path of egoInstallCandidates(platform, home, env)) {
    if (await access(path).then(() => true, () => false)) return { path, kind: "app" };
  }
  return undefined;
}

function egoCapability(found: { path: string; kind: "cli" | "app" } | undefined): CreatorCapability {
  if (found === undefined) {
    return capability("missing", false, "未发现 Ego Browser；自动发布和发布数据回收不可用。");
  }
  if (found.kind === "app") {
    return capability(
      "missing",
      false,
      "已发现 Ego Lite 应用，但 PATH 里没有 ego-browser 命令；把 CLI 加到 PATH 后再试。",
      found.path,
    );
  }
  return capability("ready", false, "已发现 Ego Browser 命令；账号、上传和数据能力需分别实际检查。", found.path);
}

function recommendationsOf(capabilities: CreatorCapabilities): string[] {
  const recommendations: string[] = [];
  if (capabilities.library.state !== "ready") recommendations.push("先选择一个可读写的内容目录。");
  if (capabilities.subtitleSkill.state !== "ready") recommendations.push("视频转文字：安装 FFmpeg，使用 Windows 入口。");
  if (capabilities.subtitleCredential.state !== "ready") recommendations.push("在设置 → 语音转文字中填写火山语音 API Key。");
  if (capabilities.coverSkill.state !== "ready") recommendations.push("封面：git clone https://github.com/oil-oil/oil-cover ~/.agents/skills/oil-cover");
  if (capabilities.coverCredential.state !== "ready") recommendations.push("封面：在数据与设置中填写所选生图服务的地址、模型和 API Key；分析使用 Harness 当前 Agent。");
  if (capabilities.publishSync.state !== "ready") {
    recommendations.push(
      capabilities.publishSync.detail.includes("PATH")
        ? "自动发布和数据回收：已装 Ego Lite，还需要把 ego-browser 加到 PATH。"
        : "自动发布和数据回收：安装 Ego Browser（https://www.egolite.ai/download）并保证 PATH 里有 ego-browser，再登录各平台后台。",
    );
  }
  if (capabilities.publishSkill.state !== "ready") recommendations.push("视频上传：在设置 → 发布平台中准备运行环境。");
  if (capabilities.articleSkill.state !== "ready") recommendations.push("公众号图文：在设置 → 发布平台中准备运行环境。");
  return recommendations;
}

export async function inspectCreatorSetup(
  options: InspectCreatorSetupOptions,
): Promise<CreatorSetupStatus> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const capabilities: CreatorCapabilities = {
    library: await libraryCapability(options.libraryRoot),
    subtitleSkill: await subtitleCapability(platform, env, home),
    subtitleCredential: credentialCapability(options.settings.secrets.subtitle, "字幕"),
    coverSkill: await coverCapability(options.coverSkillDir, platform),
    coverCredential: credentialCapability(options.settings.secrets.cover, "封面"),
    publishSync: egoCapability(await findEgo(platform, env, home)),
    publishSkill: existsSync(join(publisherRoot(options.dataDir), "scripts", "v2", "publisher.mjs")) ? capability("ready", false, "已准备锁定版本的视频上传工具。") : capability("missing", false, "请在发布平台设置中准备运行环境。"),
    articleSkill: await resource("vendor", "wewrite", "SKILL.md").then(() => capability("ready", false, "已提供 WeWrite 写作与排版。"), () => capability("missing", false, "WeWrite 资源缺失，请重新安装完整工作台包。")),
  };
  return {
    platform,
    dataDir: options.dataDir,
    settings: options.settings,
    capabilities,
    recommendations: recommendationsOf(capabilities),
  };
}
