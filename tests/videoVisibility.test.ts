import { mkdtemp, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanLibrary } from "../src/catalog.ts";
import { decodeOverlay, emptyOverlay, loadOverlay, saveOverlay } from "../src/overlay.ts";
import { CreatorWorkbenchService } from "../src/service.ts";
import { resolveVideoSelection } from "../src/videoSelection.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "creator-visible-")), library = join(root, "资料 库"), id = "2026-10-23_视频管理";
  const folder = join(library, id), dataDir = join(root, "state"); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "A.MP4"), "original A"); await writeFile(join(folder, "B.MOV"), "original B");
  await saveOverlay(dataDir, { ...emptyOverlay(), libraryRoot: library, videoSelections: { [library]: { [id]: "A.MP4" } } });
  const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
  Object.assign(service, { dataDir, libraryRoot: library, catalogRevision: 0, importJobs: {} });
  service.scanned = async () => { const overlay = await loadOverlay(dataDir); return { libraryRoot: library, overlay, items: await scanLibrary(library, overlay) }; };
  service.getContent = async ({ id: contentId }) => ({ ...(await service.scanned()).items.find((i) => i.id === contentId)!, script: "", topicNote: "", publishCopy: "", article: "", secrets: { subtitle: {} as never, cover: {} as never } });
  return { root, library, id, folder, dataDir, service, scope: { id, folderPath: folder }, signal: new AbortController().signal };
}
describe("display-only video removal", () => {
  it("hides current video, clears selection durably, and preserves both file bytes", async () => {
    const f = await fixture();
    const hidden = await f.service.setVideoVisibility({ ...f.scope, name: "A.MP4", hidden: true }, f.signal);
    expect(hidden.videoSelection).toBe("cleared"); expect(hidden.videos?.map((v) => v.name)).toEqual(["B.MOV"]); expect(hidden.hiddenVideos?.[0]?.name).toBe("A.MP4"); expect(hidden.selectedVideo).toBeUndefined();
    const fresh = (await scanLibrary(f.library, await loadOverlay(f.dataDir)))[0]!;
    expect(fresh.videoSelection).toBe("cleared");
    expect(await readFile(join(f.folder, "A.MP4"), "utf8")).toBe("original A"); expect(await readFile(join(f.folder, "B.MOV"), "utf8")).toBe("original B");
    expect((await readdir(f.folder)).sort()).toEqual(["A.MP4", "B.MOV"]);
  });
  it("restores visibility without selecting; does not confuse null with an absent old selection", async () => {
    const f = await fixture(); await f.service.setVideoVisibility({ ...f.scope, name: "A.MP4", hidden: true }, f.signal);
    const result = await f.service.setVideoVisibility({ ...f.scope, name: "A.MP4", hidden: false }, f.signal);
    expect(result.videos).toHaveLength(2); expect(result.videoSelection).toBe("cleared");
    expect(resolveVideoSelection(result.videos!, "lost.mp4").videoSelection).toBe("missing");
    expect(decodeOverlay({ schemaVersion: 1, items: {}, videoSelections: { root: { item: null, legacy: "old.MP4" } } }).videoSelections?.root).toEqual({ item: null, legacy: "old.MP4" });
  });
  it("keeps the current selection when removing another video, and excludes hidden paths from selection", async () => {
    const f = await fixture(); await f.service.setVideoVisibility({ ...f.scope, name: "B.MOV", hidden: true }, f.signal);
    expect((await f.service.getContent({ id: f.id }, f.signal)).selectedVideo).toBe("A.MP4");
    await expect(f.service.selectVideo({ ...f.scope, name: "B.MOV" }, f.signal)).rejects.toThrow("恢复");
  });
  it("reports a removed file that disappeared without manufacturing a replacement", async () => {
    const f = await fixture(); await f.service.setVideoVisibility({ ...f.scope, name: "B.MOV", hidden: true }, f.signal); await unlink(join(f.folder, "B.MOV"));
    expect((await f.service.getContent({ id: f.id }, f.signal)).hiddenVideos?.[0]?.missing).toBe(true);
    await expect(f.service.setVideoVisibility({ ...f.scope, name: "B.MOV", hidden: false }, f.signal)).rejects.toThrow();
    expect(await readdir(f.folder)).toEqual(["A.MP4"]);
  });
  it("rejects stale folder scope and path traversal before touching state", async () => {
    const f = await fixture(), before = await readFile(join(f.dataDir, "overlay.json"), "utf8");
    await expect(f.service.setVideoVisibility({ ...f.scope, folderPath: "old", name: "A.MP4", hidden: true }, f.signal)).rejects.toThrow("切换");
    await expect(f.service.setVideoVisibility({ ...f.scope, name: "../A.MP4", hidden: true }, f.signal)).rejects.toThrow();
    expect(await readFile(join(f.dataDir, "overlay.json"), "utf8")).toBe(before);
  });
  it("re-importing the identical hidden in-folder file restores it without invoking the copy task", async () => {
    const f = await fixture(); await f.service.setVideoVisibility({ ...f.scope, name: "A.MP4", hidden: true }, f.signal);
    const result = await f.service.startVideoImport({ ...f.scope, sourcePath: join(f.folder, "A.MP4"), name: "A.MP4" }, f.signal);
    expect(result.status).toBe("completed"); expect((await f.service.getContent({ id: f.id }, f.signal)).selectedVideo).toBe("A.MP4"); expect(await readdir(f.folder)).toHaveLength(2);
  });
});
