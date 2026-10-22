import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
const failure = vi.hoisted(() => ({ mode: "none" as "none" | "permission" | "disk" }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: (...args: Parameters<typeof actual.open>) => {
    if (failure.mode === "permission" && String(args[0]).includes(".import-")) throw Object.assign(new Error("Access denied"), { code: "EACCES" });
    return actual.open(...args);
  } };
});
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
    if (failure.mode === "disk") return new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error("Disk full"), { code: "ENOSPC" })); } });
    return actual.createWriteStream(...args);
  } };
});
import { copyVideo } from "../src/videoImport.ts";

afterEach(() => { failure.mode = "none"; });
describe("import filesystem failures", () => {
  it.each(["permission", "disk"] as const)("preserves source and existing files on %s failure", async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "creator-failure-"));
    try {
      const libraryRoot = join(root, "library"); const folder = join(libraryRoot, "episode"); const sourcePath = join(root, "input.mp4");
      await mkdir(folder, { recursive: true }); await writeFile(sourcePath, "source"); await writeFile(join(folder, "keep.mov"), "existing");
      failure.mode = mode;
      await expect(copyVideo({ id: "episode", libraryRoot, folder, sourcePath }, new AbortController().signal)).rejects.toThrow(mode === "permission" ? "Access denied" : "Disk full");
      expect(await readdir(folder)).toEqual(["keep.mov"]);
      expect(await readFile(sourcePath, "utf8")).toBe("source"); expect(await readFile(join(folder, "keep.mov"), "utf8")).toBe("existing");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
