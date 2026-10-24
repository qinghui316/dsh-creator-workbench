import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { mediaCommand } from "../covers/files.ts";
import { mediaIdentity, sameMediaIdentityError } from "./videoIdentity.ts";
import type { MediaIdentity, TranscriptVersion } from "./types.ts";
import { atomic } from "./storage.ts";

export const VOLCANO_ASR_ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
export const VOLCANO_ASR_RESOURCE = "volc.bigasr.auc_turbo";
export class AsrError extends Error { constructor(message: string, readonly unknownOutcome = false) { super(message); } }
export interface TimedCue { start: number; end: number; text: string }
export function normalizeCues(value: unknown, durationMs = Number.POSITIVE_INFINITY): TimedCue[] {
  if (!Array.isArray(value) || !value.length) throw new AsrError("识别结果缺少时间轴，请保留原始结果后核对。");
  let previous = -1;
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new AsrError("识别时间轴格式无效。");
    const cue = raw as Record<string, unknown>;
    if (typeof cue.start_time !== "number" || typeof cue.end_time !== "number") throw new AsrError("识别时间轴格式无效。");
    const start = cue.start_time, end = cue.end_time, text = typeof cue.text === "string" ? cue.text.trim() : "";
    if (![start, end].every(Number.isFinite) || start < 0 || end <= start || start < previous || end > durationMs + 2000 || !text) throw new AsrError("识别时间轴无效，未生成字幕。");
    previous = start; return { start, end, text };
  });
}
function timestamp(ms: number): string { const n = Math.round(ms); return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")},${String(n % 1000).padStart(3, "0")}`; }
export function toSrt(cues: TimedCue[]): string { return cues.map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join("\n"); }
export function parseSrt(text: string): TimedCue[] {
  const value = text.replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  const parse = (time: string) => { const parts = time.replace(",", ".").split(":").map(Number); if (parts[1]! >= 60 || parts[2]! >= 60) throw new AsrError("字幕时间格式无效。"); return ((parts[0]! * 60 + parts[1]!) * 60 + parts[2]!) * 1000; };
  const cues = value.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n"), i = lines.findIndex((line) => line.includes("-->"));
    const match = lines[i]?.match(/^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})/);
    if (!match) throw new AsrError("字幕格式无效，请选择带时间轴的 SRT 或 ASS 文件。");
    return { start_time: parse(match[1]!), end_time: parse(match[2]!), text: lines.slice(i + 1).join("\n").trim() };
  }); return normalizeCues(cues);
}
export async function videoDuration(video: string, signal: AbortSignal, requireAudio = true): Promise<number> {
  const value = JSON.parse(await mediaCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", video], signal)) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  const duration = Number(value.format?.duration);
  if (requireAudio && !value.streams?.some((stream) => stream.codec_type === "audio")) throw new AsrError("当前视频没有音轨，无法转写。");
  if (!Number.isFinite(duration) || duration <= 0) throw new AsrError("无法读取视频时长。"); return duration;
}
export async function transcribe(input: { folder: string; video: string; identity: MediaIdentity; dir: string; key: string; signal: AbortSignal; fetcher?: typeof fetch }): Promise<TranscriptVersion> {
  const { signal, dir, key } = input, duration = await videoDuration(input.video, signal);
  if (duration > 7200) throw new AsrError("首版支持两小时以内的视频转写，请先准备较短的视频或导入字幕。");
  const audio = join(dir, "audio.mp3");
  await mediaCommand("ffmpeg", ["-v", "error", "-nostdin", "-i", input.video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", audio], signal);
  const info = await stat(audio); if (!info.size || info.size > 100 * 1024 * 1024) throw new AsrError("提取的音频为空或超过 100 MB，未提交识别。");
  sameMediaIdentityError(input.identity, await mediaIdentity(input.video, signal));
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(VOLCANO_ASR_ENDPOINT, {
      method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]),
      headers: { "Content-Type": "application/json", "X-Api-Key": key, "X-Api-Resource-Id": VOLCANO_ASR_RESOURCE, "X-Api-Request-Id": randomUUID(), "X-Api-Sequence": "-1" },
      body: JSON.stringify({ user: { uid: "dsh-creator-workbench" }, audio: { data: (await readFile(audio)).toString("base64"), format: "mp3", rate: 16000, channel: 1 }, request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, enable_ddc: false, show_utterances: true } }),
    });
  } catch { throw new AsrError(signal.aborted ? "已停止等待识别；服务端结果未确认，未自动重发。" : "识别连接中断或超时，服务端结果未确认，请核对后再重试。", true); }
  const status = response.headers.get("x-api-status-code");
  if (!response.ok || (status && status !== "20000000")) {
    const message = response.status === 401 || response.status === 403 ? "语音 Key 或录音文件识别权限不可用，请检查火山语音配置。" : `火山识别未完成（HTTP ${response.status}${status ? `，状态 ${status}` : ""}），请检查权限、额度或音频内容。`;
    throw new AsrError(message, response.status >= 500);
  }
  let raw: { result?: { text?: string; utterances?: unknown }; audio_info?: { duration?: number } };
  try { const text = await response.text(); if (text.length > 32 * 1024 * 1024) throw new Error(); raw = JSON.parse(text) as typeof raw; }
  catch { throw new AsrError("服务返回的识别结果无法读取，请核对本次请求后再试。", true); }
  // Preserve the received result even when timestamps fail validation.
  raw = JSON.parse(JSON.stringify(raw, (name, value: unknown) => /authorization|api[_-]?key|secret|token/i.test(name) ? "[已隐藏]" : typeof value === "string" && key ? value.split(key).join("[已隐藏]") : value)) as typeof raw;
  const rawFile = join(dir, "asr-result.json"); await atomic(rawFile, raw);
  const cues = normalizeCues(raw.result?.utterances, duration * 1000), srtFile = join(dir, "transcript.srt"), textFile = join(dir, "transcript.txt");
  const text = cues.map((cue) => cue.text).join("\n"); if (!text.trim()) throw new AsrError("未识别到语音文字，请检查音轨。");
  await writeFile(srtFile, toSrt(cues), { encoding: "utf8", flag: "wx" }); await writeFile(textFile, text, { encoding: "utf8", flag: "wx" });
  return { id: randomUUID(), video: input.identity, source: "volcano", rawFile: relative(input.folder, rawFile), srtFile: relative(input.folder, srtFile), textFile: relative(input.folder, textFile), createdAt: Date.now(), cues: cues.length };
}
export async function importSubtitle(input: { folder: string; video: string; identity: MediaIdentity; dir: string; source: string; signal: AbortSignal }): Promise<TranscriptVersion> {
  const ext = extname(input.source).toLowerCase(), output = join(input.dir, "transcript.srt");
  const info = await stat(input.source); if (!info.isFile() || !info.size || info.size > 16 * 1024 * 1024 || ![".srt", ".ass"].includes(ext)) throw new Error("请选择有效的 SRT 或 ASS 字幕文件（不超过 16 MB）。");
  if (ext === ".ass") await mediaCommand("ffmpeg", ["-v", "error", "-nostdin", "-i", input.source, output], input.signal);
  else await writeFile(output, await readFile(input.source), { flag: "wx" });
  let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(output)); } catch { throw new AsrError("字幕编码无法读取，请另存为 UTF-8 后导入。"); }
  const duration = await videoDuration(input.video, input.signal, false), cues = parseSrt(text);
  normalizeCues(cues.map((cue) => ({ start_time: cue.start, end_time: cue.end, text: cue.text })), duration * 1000);
  await writeFile(output, toSrt(cues), "utf8");
  sameMediaIdentityError(input.identity, await mediaIdentity(input.video, input.signal));
  const textFile = join(input.dir, "transcript.txt"); await writeFile(textFile, cues.map((cue) => cue.text).join("\n"), { encoding: "utf8", flag: "wx" });
  return { id: randomUUID(), video: input.identity, source: "imported", textFile: relative(input.folder, textFile), srtFile: relative(input.folder, output), createdAt: Date.now(), cues: cues.length };
}
