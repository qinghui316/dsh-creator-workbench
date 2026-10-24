import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { resource } from "./runtime.ts";
import { inside } from "./storage.ts";
import { recoverArticleFrames } from "./articleFrames.ts";
import { parseSrt } from "./transcription.ts";
import type { ArticleVersion, CreationSource, MediaIdentity, TranscriptVersion } from "./types.ts";

export async function prepareArticleFrames(input: { dataDir: string; folder: string; video: string; dir: string; transcript: TranscriptVersion; signal: AbortSignal }): Promise<{ transcript: string; frames: Array<{ file: string; at: number }>; skill: string }> {
  const file = await inside(input.folder, input.transcript.srtFile), srt = await readFile(file, "utf8"), cues = parseSrt(srt);
  const count = Math.min(8, cues.length);
  const indices = [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * (cues.length - 1) / Math.max(1, count - 1))))];
  // Extract evidence from the selected ordinary video before invoking WeWrite.
  const points = indices.map((index) => { const cue = cues[index]!; return { index, at: (cue.start + Math.min(1000, cue.end - cue.start) / 2) / 1000 }; });
  const frames = await recoverArticleFrames({ folder: input.folder, dir: input.dir, video: input.video, identity: input.transcript.video, transcriptId: input.transcript.id, srt, points, signal: input.signal });
  if (srt !== await readFile(file, "utf8")) throw new Error("字幕在截图期间发生变化，请重新准备。");
  return { transcript: await readFile(await inside(input.folder, input.transcript.textFile), "utf8"), frames, skill: await resource("vendor", "wewrite", "SKILL.md") };
}
interface ArticleInput { folder: string; dir: string; video?: MediaIdentity; transcriptId?: string; frames: string[]; markdown: string; source?: CreationSource; imageIds?: string[] }
export function saveArticle(input: ArticleInput & { video: MediaIdentity }): Promise<ArticleVersion & { video: MediaIdentity }>;
export function saveArticle(input: ArticleInput): Promise<ArticleVersion>;
export async function saveArticle(input: ArticleInput): Promise<ArticleVersion> {
  const markdown = input.markdown.trim();
  if (!/^#\s+\S/m.test(markdown) || markdown.length < 60 || markdown.length > 300_000) throw new Error("请提供包含一级标题和正文的文章。");
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!.split(/\s+["']/)[0]!;
    if (/^(?:https?:|data:|file:|\/\/)/i.test(target)) throw new Error("文章配图必须使用本项目已登记图片的相对路径。");
    const file = await inside(input.folder, join(relative(input.folder, input.dir), target));
    const relativeFile = relative(input.folder, file);
    if (!input.frames.includes(relativeFile)) throw new Error("文章配图不属于本次视频截图或已登记材料，请重新核对。");
  }
  const file = join(input.dir, "article.md"); await writeFile(file, `${markdown}\n`, { encoding: "utf8", flag: "wx" });
  return { id: randomUUID(), ...(input.video ? { video: input.video } : {}), ...(input.transcriptId ? { transcriptId: input.transcriptId } : {}), ...(input.source ? { source: input.source } : {}), ...(input.imageIds ? { imageIds: input.imageIds } : {}), title: markdown.match(/^#\s+(.+)/m)?.[1] ?? "文章", file: relative(input.folder, file), createdAt: Date.now(), frameFiles: input.frames };
}
