import { constants } from "node:fs";
import { copyFile, lstat, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { inspectImage, mediaCommand } from "../covers/files.ts";
import { atomic, hashFile, hashText, locked, mediaIdentity, readJson } from "./storage.ts";
import { sameMediaIdentityError } from "./videoIdentity.ts";
import type { MediaIdentity } from "./types.ts";

type Frame = { file: string; at: number; sha256?: string; pending?: string };
interface FrameCache { schemaVersion: 1; signature: string; frames: Record<string, Frame> }
const parameters = { algorithm: "cue-midpoint-v1", quality: 3, maxFrames: 8, format: "jpg" } as const;

export async function recoverArticleFrames(input: { folder: string; dir: string; video: string; identity: MediaIdentity; transcriptId: string; srt: string; points: Array<{ index: number; at: number }>; signal: AbortSignal }): Promise<Array<{ file: string; at: number }>> {
  const root = await realpath(input.folder), dir = await realpath(input.dir), rel = relative(root, dir);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../")) throw new Error("截图目录不属于本期内容。");
  const source = await mediaIdentity(input.video, input.signal); sameMediaIdentityError(input.identity, source);
  const signature = hashText(JSON.stringify({ source, transcriptId: input.transcriptId, srt: input.srt, parameters, points: input.points })), token = signature.slice(0, 16);
  return locked(`article-frames:${dir}`, async () => {
    const manifest = join(dir, `frames-${token}.json`);
    const cache = await readJson<FrameCache>(manifest, () => ({ schemaVersion: 1, signature, frames: {} }));
    if (cache.schemaVersion !== 1 || cache.signature !== signature || !cache.frames) throw new Error("截图参数记录不一致，请保留原记录后重新准备。");
    const regular = async (file: string) => {
      const info = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
      if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("截图不能使用链接或其他类型的文件。");
      return Boolean(info);
    };
    const complete = async (file: string, hash?: string) => {
      input.signal.throwIfAborted(); if (!await regular(file)) return false;
      try { const image = await inspectImage(file, input.signal); return image.mime === "image/jpeg" && (!hash || await hashFile(file, input.signal) === hash); }
      catch (error) { input.signal.throwIfAborted(); return false; }
    };
    const frames: Array<{ file: string; at: number }> = [];
    for (const point of input.points) {
      input.signal.throwIfAborted();
      const name = `frame-${point.index}-${token}.jpg`, final = join(dir, name);
      let entry = cache.frames[String(point.index)];
      if (entry && (entry.file !== name || entry.at !== point.at)) throw new Error("截图时间点记录不一致。");
      if (!entry) { if (await regular(final)) throw new Error("发现未关联的截图文件，请保留并核对后重试。"); entry = { file: name, at: point.at }; cache.frames[String(point.index)] = entry; await atomic(manifest, cache); }
      if (entry.pending && (basename(entry.pending) !== entry.pending || !entry.pending.startsWith(`.${name}.part-`) || !entry.pending.endsWith(".jpg"))) throw new Error("截图临时文件记录无效。");
      if (!await complete(final, entry.sha256)) {
        // Preserve unexpectedly changed/invalid final output for inspection; never overwrite it.
        if (await regular(final)) await rename(final, join(dir, `${name}.invalid-${randomUUID()}`));
        if (entry.pending) {
          const partial = join(dir, entry.pending);
          if (!await complete(partial)) { if (await regular(partial)) await unlink(partial); delete entry.pending; await atomic(manifest, cache); }
        }
        if (!entry.pending) {
          entry.pending = `.${name}.part-${randomUUID()}.jpg`; await atomic(manifest, cache);
          await mediaCommand("ffmpeg", ["-v", "error", "-nostdin", "-ss", String(point.at), "-i", input.video, "-frames:v", "1", "-q:v", String(parameters.quality), "-n", join(dir, entry.pending)], input.signal);
        }
        const partial = join(dir, entry.pending);
        if (!await complete(partial)) throw new Error("截图没有完整生成，请重试以继续本次任务。");
        input.signal.throwIfAborted();
        await copyFile(partial, final, constants.COPYFILE_EXCL);
        entry.sha256 = await hashFile(final, input.signal); delete entry.pending;
        await atomic(manifest, cache); await unlink(partial);
      } else {
        if (entry.pending) { const partial = join(dir, entry.pending); if (await regular(partial)) await unlink(partial); delete entry.pending; }
        entry.sha256 ??= await hashFile(final, input.signal); await atomic(manifest, cache);
      }
      frames.push({ file: relative(root, final), at: point.at });
    }
    sameMediaIdentityError(source, await mediaIdentity(input.video, input.signal));
    return frames;
  });
}
