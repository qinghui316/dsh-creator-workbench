import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, coverLock, imageKind, MAX_IMAGE_BYTES } from "./files.ts";
import type { ImageSettings, CoverRatio } from "./types.ts";
import type { ImageRatio } from "../production/types.ts";

export { IMAGE_CREDENTIAL } from "./types.ts";
export const emptyImageSettings = (): ImageSettings => ({ apiBase: "", model: "", revision: "" });
export function normalizeImageSettings(input: { apiBase: string; model: string }): Pick<ImageSettings, "apiBase" | "model"> {
  const url = new URL(input.apiBase.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("请输入不含密钥或查询参数的 HTTP/HTTPS 服务根地址。");
  if (!input.model.trim()) throw new Error("请填写生图模型名称。");
  return { apiBase: url.href.replace(/\/+$/, ""), model: input.model.trim() };
}
export async function readImageSettings(dataDir: string): Promise<ImageSettings> {
  try { return JSON.parse(await readFile(join(dataDir, "image-service.json"), "utf8")) as ImageSettings; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyImageSettings(); throw new Error("生图服务设置无法读取。"); }
}
export async function saveImageSettings(dataDir: string, input: { apiBase: string; model: string }): Promise<ImageSettings> {
  return coverLock(`image-settings:${dataDir}`, async () => {
    if ((await readImageSettings(dataDir)).pending) throw new Error("生图设置更新未完成，请继续保存。");
    const settings = { ...normalizeImageSettings(input), revision: randomUUID() };
    await mkdir(dataDir, { recursive: true }); await atomicJson(join(dataDir, "image-service.json"), settings); return settings;
  });
}
/** Non-secret coordination: credentials are still written exclusively by the host. */
export async function beginImageUpdate(dataDir: string, input: { apiBase: string; model: string; revision: string; hasNewKey: boolean }): Promise<ImageSettings> {
  const target = normalizeImageSettings(input);
  return coverLock(`image-settings:${dataDir}`, async () => {
    const current = await readImageSettings(dataDir);
    if (current.revision !== input.revision) throw new Error("设置已在其他位置变化，请重新读取后保存。");
    const originChanged = !current.apiBase || new URL(current.apiBase).origin !== new URL(target.apiBase).origin;
    if ((originChanged || current.pending?.needsKey) && !input.hasNewKey) throw new Error("请填写对应服务的新 API Key。");
    const token = randomUUID();
    const next: ImageSettings = { ...current, revision: token, pending: { ...target, token, needsKey: input.hasNewKey } };
    delete next.checked;
    await mkdir(dataDir, { recursive: true }); await atomicJson(join(dataDir, "image-service.json"), next); return next;
  });
}
export async function completeImageUpdate(dataDir: string, token: string, keyUpdated: boolean): Promise<ImageSettings> {
  return coverLock(`image-settings:${dataDir}`, async () => {
    const current = await readImageSettings(dataDir), pending = current.pending;
    if (!pending || pending.token !== token) throw new Error("设置更新已变化，请重新读取后保存。");
    if (pending.needsKey && !keyUpdated) throw new Error("API Key 尚未保存，设置更新未完成。");
    const next: ImageSettings = { apiBase: pending.apiBase, model: pending.model, revision: randomUUID() };
    await atomicJson(join(dataDir, "image-service.json"), next); return next;
  });
}
export class ImageRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}
export function safeImageError(error: unknown, key?: string): string {
  let value = error instanceof Error ? error.message : String(error);
  if (key) value = value.replaceAll(key, "[redacted]");
  return value.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [redacted]").replace(/\bsk-[\w-]+/g, "[redacted]").slice(0, 500);
}
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > limit) throw new Error("图片响应过大。");
  const reader = response.body?.getReader(); if (!reader) throw new Error("服务没有返回内容。");
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) throw new Error("图片响应过大。"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}
export async function requestImage(settings: ImageSettings, key: string, input: { ratio: ImageRatio; prompt: string; mode: "reference" | "text"; references: Array<{ data: Uint8Array; name: string }> }, signal: AbortSignal): Promise<Uint8Array> {
  if (settings.pending) throw new ImageRequestError("生图设置更新未完成，请继续保存。", false);
  const timeout = AbortSignal.timeout(180_000), combined = AbortSignal.any([signal, timeout]);
  const size = { "3x4": "960x1280", "4x3": "1280x960", "16x9": "1280x720", "1x1": "1024x1024" }[input.ratio];
  let body: string | FormData; const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (input.mode === "reference") {
    if (!input.references.length) throw new ImageRequestError("参考图制作需要先选择图片。", false);
    const form = new FormData(); form.set("model", settings.model); form.set("prompt", input.prompt); form.set("size", size); form.set("n", "1");
    for (const file of input.references) form.append("image[]", new Blob([Buffer.from(file.data)], { type: imageKind(file.data).mime }), file.name);
    body = form;
  } else { headers["Content-Type"] = "application/json"; body = JSON.stringify({ model: settings.model, prompt: input.prompt, size, n: 1 }); }
  let sent = false;
  try {
    sent = true;
    const response = await fetch(`${settings.apiBase}/images/${input.mode === "reference" ? "edits" : "generations"}`, { method: "POST", headers, body, signal: combined, redirect: "error" });
    if (!response.ok) throw new ImageRequestError(`生图服务返回 HTTP ${response.status}。请检查模型、密钥、参考图和尺寸支持。`, response.status >= 500);
    const raw = await readLimited(response, 36 * 1024 * 1024);
    const result = JSON.parse(Buffer.from(raw).toString("utf8")) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = result.data?.[0];
    let bytes: Uint8Array;
    if (typeof first?.b64_json === "string") bytes = Buffer.from(first.b64_json, "base64");
    else if (typeof first?.url === "string") {
      const url = new URL(first.url); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("图片下载地址无效。");
      // No API credential on the download, including cross-origin redirects.
      const download = await fetch(url, { signal: combined, redirect: "follow" });
      if (!download.ok) throw new Error("图片已生成，但下载失败；请核对服务端结果。");
      bytes = await readLimited(download, MAX_IMAGE_BYTES);
    } else throw new Error("服务已接收请求，但响应没有图片，请核对结果。");
    imageKind(bytes); return bytes;
  } catch (error) {
    if (error instanceof ImageRequestError) throw error;
    throw new ImageRequestError(safeImageError(signal.aborted ? "请求已取消，服务端可能仍在生成，请核对后再重试。" : error, key), sent);
  }
}
export async function checkImageConnection(settings: ImageSettings, key: string, signal: AbortSignal): Promise<ImageSettings> {
  if (settings.pending) throw new Error("生图设置更新未完成，请先保存。");
  const response = await fetch(`${settings.apiBase}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), redirect: "error" });
  return { ...settings, checked: { revision: settings.revision, connection: response.ok ? "连接成功；未执行生图" : `HTTP ${response.status}；此服务可能不提供模型列表`, generation: settings.checked?.generation ?? "未验证", edit: settings.checked?.edit ?? "未验证" } };
}

export async function saveImageCheck(dataDir: string, result: ImageSettings): Promise<ImageSettings> {
  return coverLock(`image-settings:${dataDir}`, async () => {
    const current = await readImageSettings(dataDir);
    if (current.revision !== result.revision) return current;
    await atomicJson(join(dataDir, "image-service.json"), result); return result;
  });
}
export async function recordImageSuccess(dataDir: string, settings: ImageSettings, mode: "reference" | "text", ratio: CoverRatio): Promise<void> {
  return coverLock(`image-settings:${dataDir}`, async () => {
    const current = await readImageSettings(dataDir); if (current.revision !== settings.revision) return;
    const checked = current.checked ?? { revision: current.revision, connection: "已完成真实图片请求", generation: "未验证", edit: "未验证" };
    checked[mode === "reference" ? "edit" : "generation"] = `已验证 ${ratio.replace("x", ":")}`;
    await atomicJson(join(dataDir, "image-service.json"), { ...current, checked });
  });
}
