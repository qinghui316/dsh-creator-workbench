import { describe, expect, it } from "vitest";

import { parseByteRange, playbackOf, startVideoServer } from "../src/videoServe.ts";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("local playback HTTP", () => {
  it("serves ranges, refreshes replaced files, and handles a disappeared source", async () => {
    const root = await mkdtemp(join(tmpdir(), "creator-player-")); const path = join(root, "普通视频.MP4");
    await writeFile(path, "0123456789"); const server = await startVideoServer(path);
    try {
      const range = await fetch(server.url, { headers: { Range: "bytes=2-5" } });
      expect(range.status).toBe(206); expect(range.headers.get("Content-Range")).toBe("bytes 2-5/10"); expect(await range.text()).toBe("2345");
      await writeFile(path, "new"); const updated = await fetch(server.url);
      expect(updated.headers.get("Content-Length")).toBe("3"); expect(await updated.text()).toBe("new");
      await unlink(path); expect((await fetch(server.url)).status).toBe(404);
    } finally { server.close(); await rm(root, { recursive: true, force: true }); }
  });
});

describe("playbackOf", () => {
  const videos = [{ name: "a.mp4", path: "/a.mp4", size: 1, modifiedAt: 1 }, { name: "a_subtitled.mp4", path: "/a_subtitled.mp4", size: 1, modifiedAt: 2 }];
  it("uses exactly the selected video", () => {
    expect(playbackOf({ videos, selectedVideo: "a.mp4" })).toEqual({ path: "/a.mp4", kind: "raw" });
    expect(playbackOf({ videos, selectedVideo: "a_subtitled.mp4" })?.path).toBe("/a_subtitled.mp4");
  });
  it("never substitutes a missing or unselected video", () => {
    expect(playbackOf({ videos })).toBeUndefined();
    expect(playbackOf({ videos, selectedVideo: "gone.mp4" })).toBeUndefined();
    expect(playbackOf({})).toBeUndefined();
  });
});

describe("parseByteRange", () => {
  it("reads a closed range", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
  });

  it("reads an open end", () => {
    expect(parseByteRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
  });

  it("reads a suffix", () => {
    expect(parseByteRange("bytes=-50", 1000)).toEqual({ start: 950, end: 999 });
  });

  it("rejects a start past the file", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBeUndefined();
  });
});
