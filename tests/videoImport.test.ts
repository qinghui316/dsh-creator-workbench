import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile, open } from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { copyVideo, VideoImports } from "../src/videoImport.ts";
import { scanLibrary } from "../src/catalog.ts";
import { currentVideoPath, resolveVideoSelection, validVideoName } from "../src/videoSelection.ts";
import { emptyOverlay, loadOverlay, saveOverlay } from "../src/overlay.ts";
import { CreatorWorkbenchService } from "../src/service.ts";
import type { JobHooks, JobRegistry } from "@deepseek-ai/dsh-jobs";

const cleanup: string[] = [];
const signal = () => new AbortController().signal;
async function fixture(name = "中文 成片.MP4") {
  const root = await mkdtemp(join(tmpdir(), "creator-video-")); cleanup.push(root);
  const libraryRoot = join(root, "资料 库");
  const folder = join(libraryRoot, "2026-10-23_一期有真实长度的中文 English 内容标题");
  const sourcePath = join(root, name);
  await mkdir(folder, { recursive: true }); await writeFile(sourcePath, "source video bytes");
  return { root, libraryRoot, folder, sourcePath, id: basename(folder) };
}
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("video copy boundary", () => {
  it("imports a video from a long path containing spaces and Chinese", async () => {
    const f = await fixture();
    const deep = join(f.root, ...Array.from({ length: 5 }, (_, i) => `${i} 中文 folder ${"a".repeat(48)}`));
    await mkdir(deep, { recursive: true });
    const sourcePath = join(deep, "long video.MOV"); await writeFile(sourcePath, "long path video");
    expect(sourcePath.length).toBeGreaterThan(260);
    await copyVideo({ ...f, sourcePath }, signal());
    expect(await readFile(join(f.folder, "long video.MOV"), "utf8")).toBe("long path video");
  });
  it.each(["中文 成片.MP4", "外部导出.mov", "CAPS.MOV"])("copies %s and preserves its source", async (name) => {
    const f = await fixture(name);
    expect(await copyVideo(f, signal())).toBe(name);
    expect(await readFile(f.sourcePath, "utf8")).toBe("source video bytes");
    expect(await readFile(join(f.folder, name), "utf8")).toBe("source video bytes");
    expect(await readdir(f.folder)).toEqual([name]);
  });
  it("rejects an empty, missing, unsupported, or reserved file without changing content", async () => {
    const f = await fixture();
    await writeFile(f.sourcePath, "");
    await expect(copyVideo(f, signal())).rejects.toThrow("为空");
    await unlink(f.sourcePath);
    await expect(copyVideo(f, signal())).rejects.toThrow();
    for (const name of ["file.txt", "../bad.mp4", "CON.MP4", "a.mp4.", "a:stream.mov"]) {
      expect(validVideoName(name)).toBe(false);
      await expect(copyVideo({ ...f, name }, signal())).rejects.toThrow("支持");
    }
    expect(await readdir(f.folder)).toEqual([]);
  });
  it("preserves an existing destination, permits a different import name, and handles a concurrent collision", async () => {
    const f = await fixture();
    await writeFile(join(f.folder, "existing.mp4"), "existing");
    await expect(copyVideo({ ...f, name: "existing.mp4" }, signal())).rejects.toThrow("同名");
    const results = await Promise.allSettled([copyVideo({ ...f, name: "new.mp4" }, signal()), copyVideo({ ...f, name: "new.mp4" }, signal())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await readFile(join(f.folder, "existing.mp4"), "utf8")).toBe("existing");
    expect((await readdir(f.folder)).sort()).toEqual(["existing.mp4", "new.mp4"]);
  });
  it("cancels during a large copy and only removes its own partial", async () => {
    const f = await fixture();
    const handle = await open(f.sourcePath, "r+"); await handle.truncate(128 * 1024 * 1024); await handle.close();
    const ctrl = new AbortController();
    const watcher = watch(f.folder, (_event, name) => { if (String(name).startsWith(".import-")) ctrl.abort(); });
    await writeFile(join(f.folder, ".unrelated.partial"), "keep");
    try { await expect(copyVideo(f, ctrl.signal)).rejects.toThrow(); } finally { watcher.close(); }
    expect(await readdir(f.folder)).toEqual([".unrelated.partial"]);
    const source = await open(f.sourcePath);
    try { expect((await source.stat()).size).toBe(128 * 1024 * 1024); } finally { await source.close(); }
  });
  it("rejects targets outside the library and a missing destination folder", async () => {
    const f = await fixture();
    await expect(copyVideo({ ...f, folder: f.root }, signal())).rejects.toThrow("目录");
    await expect(copyVideo({ ...f, folder: join(f.libraryRoot, "missing") }, signal())).rejects.toThrow();
    expect(await readdir(f.folder)).toEqual([]);
  });
});

describe("catalog and durable current video", () => {
  it("ignores empty and partial files; one candidate selects automatically, several require a choice", async () => {
    const f = await fixture();
    await writeFile(join(f.folder, "zero.MP4"), "");
    await writeFile(join(f.folder, ".import-stopped.partial"), "partial");
    expect((await scanLibrary(f.libraryRoot, emptyOverlay()))[0]?.videoSelection).toBe("empty");
    await copyVideo(f, signal());
    const one = (await scanLibrary(f.libraryRoot, emptyOverlay()))[0]!;
    expect(one.videoSelection).toBe("selected"); expect(currentVideoPath(one)).toBe(join(f.folder, "中文 成片.MP4"));
    await copyVideo({ ...f, name: "second.MOV" }, signal());
    const several = (await scanLibrary(f.libraryRoot, emptyOverlay()))[0]!;
    expect(several.videoSelection).toBe("choose"); expect(currentVideoPath(several)).toBeUndefined();
  });
  it("persists a relative selection, isolates libraries, and reports a missing selected file", async () => {
    const f = await fixture(); await copyVideo(f, signal());
    await copyVideo({ ...f, name: "second.MOV" }, signal());
    const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
    const dataDir = join(f.root, "state"); Object.assign(service, { dataDir, libraryRoot: f.libraryRoot, catalogRevision: 0 });
    service.ensureWatch = () => undefined;
    await service.projectState(); const first = await service.projectRegistry().join(f.folder);
    const other = join(f.root, "other", f.id); await mkdir(other, { recursive: true }); const second = await service.projectRegistry().join(other);
    await service.saveVideoSelection(f.folder, first.id, "second.MOV");
    await service.saveVideoSelection(other, second.id, "other.mp4");
    const chosen = (await service.find(first.id))!;
    expect(chosen.selectedVideo).toBe("second.MOV");
    expect(currentVideoPath(chosen)).toBe(join(f.folder, "second.MOV"));
    await unlink(join(f.folder, "second.MOV"));
    service.invalidateCatalog(); const missing = (await service.find(first.id))!;
    expect(missing.videoSelection).toBe("missing"); expect(missing.videoRaw).toBeUndefined();
    expect(resolveVideoSelection(chosen.videos!, "../escape.mp4").videoSelection).toBe("missing");
  });
  it("rejects an obsolete UI import or selection after changing libraries", async () => {
    const f = await fixture();
    const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
    Object.assign(service, { dataDir: join(f.root, "state"), libraryRoot: f.libraryRoot, catalogRevision: 0 }); service.ensureWatch = () => undefined;
    await service.projectState(); const project = await service.projectRegistry().join(f.folder);
    await expect(service.startVideoImport({ id: project.id, folderPath: "old folder", sourcePath: f.sourcePath }, signal())).rejects.toThrow("项目");
    await expect(service.selectVideo({ id: project.id, folderPath: "old folder", name: "a.mp4" }, signal())).rejects.toThrow("项目");
    expect(await readdir(f.folder)).toEqual([]);
  });
});

describe("Harness import jobs", () => {
  it("runs without a session, commits selection, and exposes terminal state", async () => {
    const f = await fixture(); const tasks = new VideoImports();
    let hooks: JobHooks | undefined; let selected: string | undefined;
    const jobs = { start: (spec: { owner?: unknown; run: () => JobHooks }) => { expect(spec.owner).toBeUndefined(); hooks = spec.run(); return "import-1"; } } as unknown as JobRegistry;
    const state = tasks.start(jobs, f, async (name) => { selected = name; });
    expect(state.jobId).toBe("import-1");
    await expect(hooks!.done).resolves.toMatchObject({ status: "completed" });
    expect(selected).toBe("中文 成片.MP4"); expect(tasks.get(state.token).status).toBe("completed");
    expect(tasks.cancel(state.token).status).toBe("completed");
  });
  it("does not create a file or save a selection for a cancelled job", async () => {
    const f = await fixture(); const tasks = new VideoImports(); let hooks: JobHooks | undefined;
    const jobs = { start: (spec: { run: () => JobHooks }) => { hooks = spec.run(); return "import-2"; } } as unknown as JobRegistry;
    const state = tasks.start(jobs, f, async () => { throw new Error("must not commit"); });
    hooks!.cancel();
    await expect(hooks!.done).resolves.toMatchObject({ status: "killed" });
    expect(tasks.get(state.token).status).toBe("cancelled"); expect(await readdir(f.folder)).toEqual([]);
  });
});
