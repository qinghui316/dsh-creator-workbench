import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentRootKey, removedContentIds, setContentHidden } from "../src/contentVisibility.ts";
import { decodeOverlay, loadOverlay, saveOverlay } from "../src/overlay.ts";
import { scanLibrary } from "../src/catalog.ts";
import { CreatorWorkbenchService } from "../src/service.ts";

describe("reversible project list deletion", () => {
  it("persists removal/restoration, isolates libraries and preserves all project files and other state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creator-content-visibility-")), root = join(dir, "资料 库"), other = join(dir, "other"), data = join(dir, "settings");
    await mkdir(join(root, "episode"), { recursive: true }); await mkdir(join(other, "episode"), { recursive: true });
    const folder = await realpath(join(root, "episode")), video = join(folder, "video.mp4"), article = join(folder, "article.md");
    await writeFile(video, "original video bytes"); await writeFile(article, "# 用户原稿");
    await saveOverlay(data, { schemaVersion: 1, libraryRoot: root, items: { episode: { title: "原标题" } }, videoSelections: { [root]: { episode: "video.mp4" } } });
    await Promise.all([setContentHidden(data, root, "episode", folder, true), setContentHidden(data, root, "episode", folder, true)]);
    const saved = await loadOverlay(data);
    expect(removedContentIds(saved, root)).toEqual(["episode"]);
    expect(removedContentIds(saved, other)).toEqual([]);
    expect(saved.videoSelections?.[root]?.episode).toBe("video.mp4"); expect(saved.items.episode?.title).toBe("原标题");
    const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
    Object.assign(service, { dataDir: data, catalogRevision: 1, scanned: async () => { const overlay = await loadOverlay(data); return { overlay, libraryRoot: root, items: await scanLibrary(root, overlay) }; }, settingsOf: async () => ({}), invalidateCatalog: () => undefined });
    const listed = await service.listContents({ query: "", filter: "all" }, new AbortController().signal);
    await expect(service.getContent({ id: "episode" }, new AbortController().signal)).rejects.toThrow("已从工作台移除");
    expect(listed.items).toHaveLength(0); expect(listed.counts.total).toBe(0); expect(listed.removedItems?.[0]?.id).toBe("episode");
    await service.setContentVisibility({ id: "episode", folderPath: folder, hidden: false }, new AbortController().signal);
    expect((await service.listContents({ query: "", filter: "all" }, new AbortController().signal)).items).toHaveLength(1);
    expect(await readFile(video, "utf8")).toBe("original video bytes"); expect(await readFile(article, "utf8")).toBe("# 用户原稿");
    await expect(setContentHidden(data, root, "episode", join(other, "episode"), true)).rejects.toThrow();
    await expect(setContentHidden(data, root, "wrong-id", folder, true)).rejects.toThrow();
    await saveOverlay(data, { ...await loadOverlay(data), libraryRoot: other });
    await expect(setContentHidden(data, root, "episode", folder, true)).rejects.toThrow("资料库已切换");
  });
  it("decodes only safe project ids and preserves old overlays", () => {
    expect(decodeOverlay({ schemaVersion: 1, items: {} }).hiddenContents).toBeUndefined();
    const overlay = decodeOverlay({ hiddenContents: { [contentRootKey("E:/资料")]: ["one", "one", "../foreign", "..", 3] } });
    expect(removedContentIds(overlay, "E:/资料")).toEqual(["one"]);
  });
});
