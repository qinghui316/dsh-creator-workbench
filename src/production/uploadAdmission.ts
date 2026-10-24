import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import type { ContentCovers } from "../types.ts";
import { hashFile, hashText, inside, updateState } from "./storage.ts";
import { isActiveTask, sameMedia, type ContentScope, type MediaIdentity, type PlatformAccount, type ProductionTask, type PublishInput, type UploadNotice } from "./types.ts";

export async function uploadKey(folder: string, video: MediaIdentity, account: PlatformAccount, fields: PublishInput, covers: ContentCovers, signal: AbortSignal): Promise<string> {
  const assets: Array<{ ratio: string; file: string; sha256: string }> = [];
  if (fields.useCovers) for (const ratio of ["3x4", "4x3", "16x9"] as const) {
    const source = covers[ratio]; if (!source) continue;
    const file = await inside(folder, source); assets.push({ ratio, file: relative(folder, file), sha256: await hashFile(file, signal) });
  }
  return hashText(JSON.stringify({ video: { name: video.name, size: video.size, sha256: video.sha256 }, account: account.id, platform: account.platform, title: fields.title, description: fields.description, tags: fields.tags, category: fields.category ?? "", useCovers: fields.useCovers, originalRightsConfirmed: fields.originalRightsConfirmed, assets }));
}

/** Admission and reservation share the persisted state lock, for UI and Agent callers alike. */
export async function admitUpload(scope: ContentScope, video: MediaIdentity, account: PlatformAccount, key: string, newUploadAfter?: string, assertAvailable?: () => Promise<unknown>, reserve?: (id: string) => void): Promise<{ task: ProductionTask; fresh: boolean; notice?: UploadNotice }> {
  return updateState(scope.folderPath, async (state) => {
    await assertAvailable?.();
    const candidates = state.tasks.filter((task) => task.kind === "upload" && task.platform === account.platform && task.account?.id === account.id && task.video && sameMedia(task.video, video));
    const previous = newUploadAfter ? candidates.at(-1) : [...candidates].reverse().find((task) => task.uploadKey === key) ?? candidates.at(-1);
    if (newUploadAfter && !candidates.some((task) => task.id === newUploadAfter)) throw new Error("原任务不属于当前视频、平台和账号，请重新核对。");
    // A second concurrent confirmation sees the first reservation, rather than starting a third upload.
    if (previous && (!newUploadAfter || previous.id !== newUploadAfter || isActiveTask(previous))) {
      const same = previous.uploadKey === key;
      return { task: structuredClone(previous), fresh: false, notice: { taskId: previous.id, canCreateNew: !isActiveTask(previous), message: same ? "已有本次上传任务，请检查草稿或继续原任务。" : "此视频已有上传记录，发布材料不同或旧输入尚未核验。请先检查原草稿；需要另一份时再明确另建。" } };
    }
    const task: ProductionTask = { id: randomUUID(), kind: "upload", contentId: scope.id, folderPath: scope.folderPath, status: "queued", platform: account.platform, video, account, uploadKey: key, originalRightsConfirmed: true, createdAt: Date.now(), updatedAt: Date.now() };
    state.tasks.push(task); reserve?.(task.id); return { task: structuredClone(task), fresh: true };
  });
}
