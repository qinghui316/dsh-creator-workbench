import { readFile } from "node:fs/promises";
import type { PublishPlatform } from "../platforms.ts";
import type { AccountObservation } from "./types.ts";
import { browserExecutable, resource } from "./runtime.ts";
import { runProcess } from "./process.ts";
import { readSettings, updateSettings } from "./storage.ts";

export class BrowserControlError extends Error {}
export const browserControlStopped = (value: unknown): boolean => value instanceof BrowserControlError || /USER_CONTROL|user (?:now controls|took control|has taken control)|not assigned to an agent|task space.*inactive|browser permission prompt/i.test(value instanceof Error ? value.message : String(value));

const leases = new Map<string, AbortController>();
export function pauseBrowser(dataDir: string): void { leases.get(dataDir)?.abort(); }
export async function withBrowser<T>(dataDir: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if ((await readSettings(dataDir)).browserPaused) throw new Error("浏览器自动操作已暂停，请在发布设置中继续。");
  if (leases.has(dataDir)) throw new Error("浏览器正在处理其他上传或数据任务，请稍后重试。");
  const controller = new AbortController(); leases.set(dataDir, controller);
  try { return await work(AbortSignal.any([signal, controller.signal])); }
  catch (error) { if (browserControlStopped(error)) await updateSettings(dataDir, (settings) => { settings.browserPaused = true; }); throw error; }
  finally { if (leases.get(dataDir) === controller) leases.delete(dataDir); }
}
export async function probeAccount(platform: PublishPlatform, signal: AbortSignal, login = false, resumeSpace?: number): Promise<AccountObservation> {
  const sourcePath = await resource("scripts", "ego-account.mjs");
  // This source is public and contains no account state or credentials.
  const source = await readFile(sourcePath, "utf8");
  const input = source.replace(/^export /gm, "") + `\nconst s=accountScript(${JSON.stringify(platform)},{login:${JSON.stringify(login)},resumeSpace:${JSON.stringify(resumeSpace)}});\n`;
  // Build the script in Node, then execute only the resulting public Ego program.
  const build = await runProcess(process.execPath, ["--input-type=module", "-e", `${input}\nprocess.stdout.write(s);`], { signal, env: { ELECTRON_RUN_AS_NODE: "1" } });
  const result = await runProcess(await browserExecutable(), ["nodejs"], { input: build.stdout, signal, timeout: 60_000 });
  if (browserControlStopped(`${result.stdout}\n${result.stderr}`)) throw new BrowserControlError("浏览器已交给你，请处理页面权限或验证提示后再继续。");
  if (result.code !== 0) throw new Error("浏览器账号检查失败，请确认浏览器已打开，并完成首次设置。");
  const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).reverse().find((row) => row.includes("CREATOR_ACCOUNT:"));
  if (!line) throw new Error("未收到可靠的账号检查结果。");
  const value = JSON.parse(line.slice(line.indexOf("CREATOR_ACCOUNT:") + "CREATOR_ACCOUNT:".length)) as AccountObservation;
  if (value.platform !== platform || !["connected", "login-required", "unverified"].includes(value.state)) throw new Error("账号检查结果无效。");
  if (value.state === "connected" && (!value.id || !value.name)) throw new Error("当前账号身份不完整。"); return value;
}
export async function requireAccount(platform: PublishPlatform, id: string, signal: AbortSignal): Promise<void> {
  const observed = await probeAccount(platform, signal);
  if (observed.state !== "connected" || observed.id !== id) throw new Error("当前登录账号与任务账号不一致，请切回原账号后继续。");
}
