import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ContentCovers } from "../types.ts";
import { inside, atomic, hashFile, mediaIdentity } from "./storage.ts";
import { sameMediaIdentityError } from "./videoIdentity.ts";
import { browserExecutable, pinnedPublisher, resource } from "./runtime.ts";
import { runProcess, safeError } from "./process.ts";
import { publisherPlatform, type PlatformAccount, type ProductionTask, type PublishInput } from "./types.ts";
import { requireAccount, BrowserControlError, browserControlStopped } from "./browser.ts";
import { pathToFileURL } from "node:url";

export interface UploadPackage { file: string; config: string; assets: Array<{ file: string; sha256: string }> }
export async function releaseUploadBrowser(folder: string, task: ProductionTask): Promise<void> {
  if (!task.platform || !/^[a-f0-9-]{36}$/i.test(task.id)) return;
  const file = await inside(folder, join(".dsh-creator-workbench", "production", task.id, "publisher-jobs", task.id, "state.json")).catch(() => undefined);
  if (!file) return;
  const state = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as { platforms?: Record<string, { taskSpaceId?: number }> };
  const spaceId = state.platforms?.[publisherPlatform(task.platform)]?.taskSpaceId;
  if (!Number.isSafeInteger(spaceId) || !spaceId) return;
  const script = `const space=(await listTaskSpaces()).find(s=>s.id===${spaceId} && s.name.includes(${JSON.stringify(task.id)}));if(space?.ownership==='agent'){const task=await taskSpace(space.id);await task.handOff();}`;
  await runProcess(await browserExecutable(), ["nodejs"], { input: script, timeout: 10_000 });
}
export async function makeUploadPackage(input: { dataDir: string; folder: string; dir: string; video: string; covers: ContentCovers; fields: PublishInput; signal: AbortSignal }): Promise<UploadPackage> {
  const { fields, signal, dir } = input, platform = publisherPlatform(fields.platform), root = await pinnedPublisher(input.dataDir);
  const video = await inside(input.folder, input.video), covers: Record<string, unknown> = { uploadCustomCover: fields.useCovers };
  const assets: UploadPackage["assets"] = [];
  if (fields.useCovers) {
    for (const [ratio, name] of [["3x4", "vertical3x4Path"], ["4x3", "horizontal4x3Path"], ["16x9", "horizontal16x9Path"]] as const) {
      const source = input.covers[ratio]; if (source) { const file = await inside(input.folder, source); covers[name] = file; assets.push({ file, sha256: await hashFile(file, signal) }); }
    }
  }
  const config = join(dir, "publisher-config.json"), file = join(dir, "publish-package.json");
  const nodeEnv = { ELECTRON_RUN_AS_NODE: "1", VIDEO_PUBLISHER_CONFIG: config };
  const configured = await runProcess(process.execPath, [join(root, "scripts", "config.mjs"), "onboard", "--source-dir", input.folder, "--available-platform", platform, "--platform", platform, "--locale", "zh-CN", "--originality-policy", "ask_each_run", "--check-concurrency", "1", "--upload-concurrency", "1"], { signal, env: nodeEnv });
  if (configured.code !== 0) throw new Error("上传工具配置未完成，请重新准备运行环境。");
  const metadata: Record<string, unknown> = {
    videoPath: video, title: fields.title, cover: covers,
    ...(platform === "xiaohongshu" ? { xhsTitle: fields.title, xhsTopics: fields.tags, description: fields.description } : {}),
    ...(platform === "douyin" ? { douyinTitle: fields.title, douyinDescription: fields.description, douyinTopics: fields.tags } : {}),
    ...(platform === "bilibili" ? { bilibiliTitle: fields.title, bilibiliDescription: fields.description, bilibiliTags: fields.tags, bilibiliAllowedAutoTags: [], ...(fields.category ? { bilibiliCategory: fields.category } : {}) } : {}),
    ...(platform === "wechat_channels" ? { wechatTitle: fields.title, wechatDescription: `${fields.description}\n\n${fields.tags.map((t) => `#${t}`).join(" ")}`, wechatTags: fields.tags } : {}),
  };
  const serialized = JSON.stringify(metadata, null, 2);
  try { await writeFile(file, serialized, { encoding: "utf8", flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(file, "utf8") !== serialized) throw new Error("原上传包与本次材料不一致，请检查原任务。"); }
  const checked = await runProcess(process.execPath, [join(root, "scripts", "check-package.mjs"), platform, file], { signal, env: nodeEnv });
  let verdict: { errors?: string[] }; try { verdict = JSON.parse(checked.stdout) as typeof verdict; } catch { throw new Error("上传材料检查没有返回有效结果。"); }
  if (checked.code !== 0 || verdict.errors?.length) throw new Error(`请补齐上传材料：${(verdict.errors ?? []).map((e) => safeError(e)).join("；")}`);
  await atomic(join(dir, "assets.json"), assets); return { file: relative(input.folder, file), config: relative(input.folder, config), assets };
}
export async function runUpload(input: { dataDir: string; folder: string; dir: string; task: ProductionTask; account: PlatformAccount; operation: "create" | "resume" | "inspect"; signal: AbortSignal }): Promise<{ ready: boolean; error?: string; userControl: boolean; receipt: string }> {
  const { task, signal, account, dir } = input;
  if (!task.packageFile || !task.platform || !task.originalRightsConfirmed) throw new Error("上传任务缺少材料、平台或本次原创确认。");
  await requireAccount(task.platform, account.id, signal);
  if (!task.video) throw new Error("上传任务没有固定视频身份。");
  sameMediaIdentityError(task.video, await mediaIdentity(await inside(input.folder, task.video.name), signal));
  const root = await pinnedPublisher(input.dataDir), packageFile = await inside(input.folder, task.packageFile);
  const assets = JSON.parse(await readFile(join(dir, "assets.json"), "utf8")) as UploadPackage["assets"];
  for (const asset of assets) if (await hashFile(await inside(input.folder, asset.file), signal) !== asset.sha256) throw new Error("封面已修改，请重新准备上传任务。");
  const stateRoot = join(dir, "publisher-jobs"), config = join(dir, "publisher-config.json"), platform = publisherPlatform(task.platform);
  const oldState = JSON.parse(await readFile(join(stateRoot, task.id, "state.json"), "utf8").catch(() => "{}")) as { status?: string; platforms?: Record<string, { taskSpaceId?: number }> };
  // Both resume and inspect are explicit actions on the retained original draft.
  const resumeSpace = input.operation !== "create" ? oldState.platforms?.[platform]?.taskSpaceId : undefined;
  // A ready upstream job rejects resume; inspect its existing draft instead.
  const operation = input.operation === "resume" && oldState.status === "ready" ? "inspect" : input.operation;
  const args = [join(root, "scripts", "v2", "publisher.mjs"), "--package", packageFile, "--job-id", task.id, "--state-root", stateRoot, "--platform", platform, "--operation", operation, "--reuse-space", "--keep-space", "--no-cleanup-stale-spaces", "--space-prefix", `creator-${task.id}`, "--check-concurrency", "1", "--upload-concurrency", "1", "--confirm-original-rights"];
  const result = await runProcess(process.execPath, args, { signal, timeout: 90 * 60_000, env: { ELECTRON_RUN_AS_NODE: "1", VIDEO_PUBLISHER_CONFIG: config, VIDEO_PUBLISHER_V2_EGO_COMMAND: await resource("scripts", "publisher-ego-bridge.mjs"), CREATOR_EGO_EXECUTABLE: await browserExecutable(), CREATOR_PUBLISH_PLATFORM: task.platform, CREATOR_PUBLISH_ACCOUNT: account.id, CREATOR_RESUME_SPACE: Number.isSafeInteger(resumeSpace) ? String(resumeSpace) : "" } });
  const file = join(stateRoot, task.id, "state.json");
  const state = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as { platforms?: Record<string, { taskSpaceId?: number; status?: string; verdict?: { ready?: boolean; blocker?: { code?: string; message?: string } }; lastEvidencePath?: string }> };
  const slot = state.platforms?.[platform], blocker = slot?.verdict?.blocker;
  const userControl = /USER_CONTROL|INPUT_CHANNEL_BROKEN|INPUT_UNAVAILABLE/.test(blocker?.code ?? "");
  if (!slot) throw new Error("上传未取得平台回执；请检查浏览器和账号，再继续原任务。");
  let ready = result.code === 0 && slot.status === "ready" && slot.verdict?.ready === true;
  let detailsError: string | undefined;
  if (ready && task.platform === "xiaohongshu") {
    const pkg = JSON.parse(await readFile(packageFile, "utf8")) as { videoPath: string; xhsTitle: string; description: string };
    const module = await import(pathToFileURL(await resource("scripts", "publisher-xhs-details.mjs")).href) as { xhsDetailsScript: (expected: unknown, options: unknown) => string };
    const script = module.xhsDetailsScript({ taskId: task.id, videoName: pkg.videoPath.split(/[\\/]/).pop(), title: pkg.xhsTitle, description: pkg.description }, { spaceId: slot.taskSpaceId, mutate: input.operation !== "inspect", resume: input.operation !== "create" });
    const checked = await runProcess(await browserExecutable(), ["nodejs"], { input: script, signal, timeout: 30_000 });
    const output = `${checked.stdout}\n${checked.stderr}`;
    if (browserControlStopped(output)) throw new BrowserControlError("浏览器已交给你，原草稿保留；继续原任务后再核对正文。");
    const line = output.split(/\r?\n/).find((row) => row.includes("CREATOR_XHS_DETAILS:"));
    if (checked.code !== 0 || !line) throw new Error("小红书正文尚未核对，原草稿保留，请继续原任务。");
    const details = JSON.parse(line.slice(line.indexOf("CREATOR_XHS_DETAILS:") + "CREATOR_XHS_DETAILS:".length)) as { ready: boolean; error?: string };
    await atomic(join(dir, "xiaohongshu-details.json"), details);
    ready = details.ready === true; detailsError = details.error;
  }
  if (ready && task.platform === "bilibili") {
    const pkg = JSON.parse(await readFile(packageFile, "utf8")) as { videoPath: string; bilibiliTitle: string; bilibiliCategory?: string };
    const detailsFile = join(dir, "bilibili-details.json");
    const previous = JSON.parse(await readFile(detailsFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return "{}"; throw error; })) as { ready?: boolean; verifiedOnce?: boolean };
    const module = await import(pathToFileURL(await resource("scripts", "publisher-bilibili-details.mjs")).href) as { bilibiliDetailsScript: (expected: unknown, options: unknown) => string };
    const script = module.bilibiliDetailsScript({ taskId: task.id, videoName: pkg.videoPath.split(/[\\/]/).pop(), title: pkg.bilibiliTitle, category: pkg.bilibiliCategory }, { spaceId: slot.taskSpaceId, mutate: input.operation !== "inspect", resume: input.operation !== "create", previouslyVerified: previous.verifiedOnce === true || previous.ready === true });
    const checked = await runProcess(await browserExecutable(), ["nodejs"], { input: script, signal, timeout: 30_000 });
    const output = `${checked.stdout}\n${checked.stderr}`;
    if (browserControlStopped(output)) throw new BrowserControlError("浏览器已交给你，原草稿保留；继续原任务后再核对 B 站分区。");
    const line = output.split(/\r?\n/).find((row) => row.includes("CREATOR_BILI_DETAILS:"));
    if (checked.code !== 0 || !line) throw new Error("B 站分区尚未核对，原草稿保留，请继续原任务。");
    const details = JSON.parse(line.slice(line.indexOf("CREATOR_BILI_DETAILS:") + "CREATOR_BILI_DETAILS:".length)) as { ready: boolean; error?: string };
    await atomic(detailsFile, { ...details, verifiedOnce: previous.verifiedOnce === true || previous.ready === true || details.ready === true });
    ready = details.ready === true; detailsError = details.error;
  }
  if (!userControl) await requireAccount(task.platform, account.id, signal);
  return { ready, ...(userControl ? { error: "浏览器已交给你，请处理权限或验证提示后继续原任务。" } : detailsError ? { error: detailsError } : blocker?.message ? { error: safeError(blocker.message) } : result.code !== 0 ? { error: "上传工具未完成操作，原任务与草稿保留，请继续原任务。" } : {}), userControl, receipt: relative(input.folder, file) };
}
