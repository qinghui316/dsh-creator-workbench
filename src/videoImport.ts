import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { JobRegistry } from "@deepseek-ai/dsh-jobs";
import type { VideoImportState } from "./types.ts";
import { contentFolder } from "./videoFiles.ts";
import { validVideoName } from "./videoSelection.ts";

interface ImportInput { id: string; sourcePath: string; name?: string; folder: string; libraryRoot: string }

/** Copy to an exclusively owned partial, then publish with an atomic no-overwrite link. */
export async function copyVideo(input: ImportInput, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const name = input.name ?? basename(input.sourcePath);
  if (!validVideoName(name) || !validVideoName(basename(input.sourcePath))) throw new Error("只支持 MP4 和 MOV 视频，文件名不能含路径或保留字符。");
  const info = await lstat(input.sourcePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error("视频不存在、不是普通文件或内容为空。");
  const folder = await contentFolder(input.libraryRoot, input.folder);
  const target = join(folder, name);
  if (await lstat(target).then(() => true, () => false)) throw new Error("同名文件已存在，请修改导入名称后重试。");
  const temp = join(folder, `.import-${randomUUID()}.partial`);
  let owned = false;
  let committed = false;
  try {
    // Reserve before starting either stream so cleanup can only remove our own file.
    const handle = await open(temp, "wx");
    owned = true;
    await handle.close();
    await pipeline(createReadStream(input.sourcePath), createWriteStream(temp, { flags: "r+" }), { signal });
    signal.throwIfAborted();
    const after = await lstat(input.sourcePath);
    const copied = await lstat(temp);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || copied.size !== info.size) throw new Error("复制期间源视频发生变化，请导出完成后重新导入。");
    if (await contentFolder(input.libraryRoot, input.folder) !== folder) throw new Error("内容目录发生变化，请重新打开。");
    const synced = await open(temp, "r+");
    try { await synced.sync(); } finally { await synced.close(); }
    signal.throwIfAborted();
    try { await link(temp, target); } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") throw new Error("同名文件已存在，请修改导入名称后重试。");
      throw cause;
    }
    committed = true;
    // Committed: cancellation after this point must not delete a complete user file.
    return name;
  } finally {
    if (owned) await unlink(temp).catch((cause) => { if (!committed) throw cause; });
  }
}

export class VideoImports {
  readonly tasks = new Map<string, { state: VideoImportState; controller: AbortController }>();

  start(jobs: JobRegistry, input: ImportInput, committed: (name: string) => Promise<void>): VideoImportState {
    const token = randomUUID();
    const controller = new AbortController();
    const state: VideoImportState = { token, id: input.id, status: "running", name: input.name ?? basename(input.sourcePath) };
    const entry = { state, controller };
    this.tasks.set(token, entry);
    try {
      state.jobId = jobs.start({ kind: "creator-media", label: `导入视频：${state.name}`, run: () => ({
        cancel: () => controller.abort(),
        done: (async () => {
          let fileCommitted = false;
          try {
            const name = await copyVideo(input, controller.signal);
            fileCommitted = true;
            await committed(name);
            state.status = "completed";
            return { status: "completed" as const, result: join(input.folder, name) };
          } catch (cause) {
            const cancelled = controller.signal.aborted && !fileCommitted;
            state.status = cancelled ? "cancelled" : "failed";
            state.error = cause instanceof Error ? cause.message : String(cause);
            return { status: cancelled ? "killed" as const : "failed" as const, result: state.error };
          }
        })(),
      }) });
    } catch (cause) { this.tasks.delete(token); throw cause; }
    for (const [key, task] of this.tasks) {
      if (this.tasks.size <= 100) break;
      if (task.state.status !== "running") this.tasks.delete(key);
    }
    return { ...state };
  }

  get(token: string): VideoImportState {
    const task = this.tasks.get(token);
    if (task === undefined) throw new Error("导入任务已结束或应用已重新打开，请刷新片库查看文件。");
    return { ...task.state };
  }

  cancel(token: string): VideoImportState {
    const task = this.tasks.get(token);
    if (task === undefined) return this.get(token);
    if (task.state.status === "running") task.controller.abort();
    return this.get(token);
  }

  dispose(): void { for (const task of this.tasks.values()) task.controller.abort(); }
}
