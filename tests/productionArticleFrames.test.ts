import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/covers/files.ts", () => ({ inspectImage: vi.fn(async (path: string) => { if (!(await readFile(path, "utf8")).startsWith("complete JPEG")) throw new Error("incomplete image"); return { mime: "image/jpeg", width: 640, height: 360 }; }), mediaCommand: vi.fn() }));
import { mediaCommand } from "../src/covers/files.ts";
import { recoverArticleFrames } from "../src/production/articleFrames.ts";
import { hashFile, mediaIdentity } from "../src/production/storage.ts";
beforeEach(() => { vi.mocked(mediaCommand).mockReset(); });
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-frame-recovery-")), dir = join(folder, "request"), video = join(folder, "视频.mp4");
  await mkdir(dir); await writeFile(video, "exact video bytes");
  const input = { folder, dir, video, identity: await mediaIdentity(video), transcriptId: "transcript-one", srt: "exact timestamps", points: [0, 1, 2].map((index) => ({ index, at: index + 0.5 })), signal: new AbortController().signal };
  const success = async (_command: unknown, args: string[]) => { await writeFile(args.at(-1)!, `complete JPEG ${args[args.indexOf("-ss") + 1]}`); return ""; };
  vi.mocked(mediaCommand).mockImplementation(success);
  return { input, success };
}
describe("article screenshot recovery", () => {
  it("keeps completed frames after a partial failure, and resumes from disk on retry", async () => {
    const f = await fixture(); vi.mocked(mediaCommand).mockImplementationOnce(f.success).mockImplementationOnce(async (_cmd, args) => { await writeFile(args.at(-1)!, "partial"); throw new Error("interrupted"); });
    await expect(recoverArticleFrames(f.input)).rejects.toThrow("interrupted");
    const first = (await readdir(f.input.dir)).find((name) => name.startsWith("frame-0-"))!, hash = await hashFile(join(f.input.dir, first));
    vi.mocked(mediaCommand).mockClear(); const frames = await recoverArticleFrames({ ...f.input });
    expect(frames).toHaveLength(3); expect(mediaCommand).toHaveBeenCalledTimes(2);
    expect(await hashFile(join(f.input.dir, first))).toBe(hash);
    vi.mocked(mediaCommand).mockClear(); await recoverArticleFrames({ ...f.input }); expect(mediaCommand).not.toHaveBeenCalled();
  });
  it("preserves a complete pending image across cancellation/reopen and only extracts the remaining frame", async () => {
    const f = await fixture(), controller = new AbortController();
    vi.mocked(mediaCommand).mockImplementationOnce(f.success).mockImplementationOnce(async (cmd, args) => { await f.success(cmd, args); controller.abort(); throw new Error("cancelled"); });
    await expect(recoverArticleFrames({ ...f.input, signal: controller.signal })).rejects.toThrow("cancelled");
    vi.mocked(mediaCommand).mockClear(); const frames = await recoverArticleFrames(f.input);
    expect(frames).toHaveLength(3); expect(mediaCommand).toHaveBeenCalledOnce();
    expect((await readdir(f.input.dir)).filter((name) => name.includes(".part-"))).toEqual([]);
  });
  it("separates timestamp/video inputs and preserves old frames when regenerating invalid output", async () => {
    const f = await fixture(), first = await recoverArticleFrames(f.input), firstPath = join(f.input.folder, first[0]!.file), original = await readFile(firstPath);
    const changed = await recoverArticleFrames({ ...f.input, srt: "changed timestamps" }); expect(changed[0]!.file).not.toBe(first[0]!.file); expect(await readFile(firstPath)).toEqual(original);
    await writeFile(f.input.video, "replacement video bytes"); await expect(recoverArticleFrames(f.input)).rejects.toThrow("替换");
    const replaced = await recoverArticleFrames({ ...f.input, identity: await mediaIdentity(f.input.video) }); expect(replaced[0]!.file).not.toBe(first[0]!.file);
    await writeFile(join(f.input.folder, replaced[1]!.file), "corrupt"); vi.mocked(mediaCommand).mockClear();
    await recoverArticleFrames({ ...f.input, identity: await mediaIdentity(f.input.video) }); expect(mediaCommand).toHaveBeenCalledOnce();
    expect((await readdir(f.input.dir)).some((name) => name.includes(".invalid-"))).toBe(true);
  });
});
