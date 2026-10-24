import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { loadOverlay, saveOverlay, withOverlayLock } from "./overlay.ts";
import { contentFolder } from "./videoFiles.ts";
import type { OverlayStore } from "./types.ts";

export function contentRootKey(root: string): string {
  const key = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? key.toLowerCase() : key;
}

export function removedContentIds(overlay: OverlayStore, root: string): string[] {
  return overlay.hiddenContents?.[contentRootKey(root)] ?? [];
}

/** Only update list visibility. Files, tasks and conversations remain intact. */
export async function setContentHidden(dataDir: string, libraryRoot: string, id: string, folderPath: string, hidden: boolean): Promise<void> {
  const root = await realpath(libraryRoot), folder = await contentFolder(root, folderPath);
  if (basename(folder) !== id) throw new Error("项目目录已变化，请刷新后重试。");
  await withOverlayLock(dataDir, async () => {
    const overlay = await loadOverlay(dataDir);
    if (overlay.libraryRoot && contentRootKey(await realpath(overlay.libraryRoot)) !== contentRootKey(root)) throw new Error("资料库已切换，请刷新后重试。");
    const ids = removedContentIds(overlay, root).filter((value) => value !== id);
    overlay.hiddenContents ??= {};
    overlay.hiddenContents[contentRootKey(root)] = hidden ? [...ids, id] : ids;
    await saveOverlay(dataDir, overlay);
  });
}
