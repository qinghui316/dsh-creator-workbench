import { readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { inside, hashFile, hashText } from "./storage.ts";
import { pythonPath, resource } from "./runtime.ts";
import { runProcess } from "./process.ts";
import type { ProductionSettings, WechatDraft } from "./types.ts";

export class WechatError extends Error { constructor(message: string, readonly unknownOutcome = false, readonly code?: string | number) { super(message); } }
export async function wechatWorker<T>(dataDir: string, input: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const answer = await runProcess(pythonPath(dataDir), [await resource("vendor", "wewrite", "worker.py")], { input: JSON.stringify(input), signal, timeout: 10 * 60_000, maxOutput: 8 * 1024 * 1024 });
  let result: { ok?: boolean; value?: T; error?: string; code?: string | number; unknown?: boolean };
  try { result = JSON.parse(answer.stdout) as typeof result; } catch { throw new WechatError("公众号运行结果未确认，请检查依赖及本次草稿。", true); }
  if (!result.ok || answer.code !== 0 || !result.value) throw new WechatError(result.error ?? "公众号操作未完成。", result.unknown === true, result.code);
  return result.value;
}
export async function renderWechat(dataDir: string, folder: string, articleFile: string, theme: string, signal: AbortSignal): Promise<{ title: string; html: string; preview: string; images: Array<{ path: string; source: string }> }> {
  const article = await inside(folder, articleFile);
  if ((await readFile(article)).byteLength > 1024 * 1024) throw new Error("文章超过 1 MB，请精简后重试。");
  return wechatWorker(dataDir, { operation: "render", folder, article, theme }, signal);
}
export async function submitWechat(input: { dataDir: string; folder: string; dir: string; articleFile: string; cover: string; config: ProductionSettings["wechat"]; secret: string; previous?: WechatDraft; confirmRemoteChange?: boolean; signal: AbortSignal }): Promise<WechatDraft> {
  const article = await inside(input.folder, input.articleFile), sourceCover = await inside(input.folder, input.cover);
  const snapshot = join(input.dir, "submission-input.md"), cover = join(input.dir, `submission-cover${extname(sourceCover).toLowerCase()}`);
  try { await writeFile(snapshot, await readFile(article), { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  try { await writeFile(cover, await readFile(sourceCover), { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const markdown = await readFile(snapshot, "utf8"), before = hashText(markdown);
  const result = await wechatWorker<{ mediaId: string; remoteHash: string; title: string }>(input.dataDir, {
    operation: "publish", folder: input.folder, article, markdown, cover, appid: input.config.appid, secret: input.secret, author: input.config.author, theme: input.config.theme,
    receiptPath: join(input.dir, "wechat-receipt.json"), ...(input.previous ? { mediaId: input.previous.mediaId, remoteHash: input.previous.remoteHash } : {}), confirmRemoteChange: input.confirmRemoteChange === true,
  }, input.signal);
  if (!result.mediaId || !result.remoteHash) throw new WechatError("公众号草稿回执不完整，请核对后台。", true);
  // A successful snapshot always describes bytes actually submitted, even if the editor changed later.
  const submittedFile = join(input.dir, "submitted.md");
  try { await writeFile(submittedFile, markdown, { encoding: "utf8", flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(submittedFile, "utf8") !== markdown) throw error; }
  return { id: input.previous?.id ?? crypto.randomUUID(), appid: input.config.appid, articleFile: relative(input.folder, article), mediaId: result.mediaId, title: result.title, submittedHash: before, remoteHash: result.remoteHash, submittedFile: relative(input.folder, submittedFile), updatedAt: Date.now(), ...(input.previous?.publishedId ? { publishedId: input.previous.publishedId } : {}), ...(input.previous?.publishedUrl ? { publishedUrl: input.previous.publishedUrl } : {}) };
}
export const articleInputHash = (markdown: string, theme: string): string => hashText(`${theme}\n${markdown}`);
