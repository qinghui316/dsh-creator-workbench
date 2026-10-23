import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  // Match Desktop's callback-preserving wrapper without promisify.custom.
  return { ...actual, execFile: (...args: unknown[]) => (actual.execFile as Function)(...args) };
});
import { inspectImage, mediaCommand } from "../src/covers/files.ts";

test("image inspection works when Desktop wraps execFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "creator-media-"));
  try {
    const file = join(dir, "中文 cover.png");
    await mediaCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=240x320", "-frames:v", "1", file]);
    await expect(inspectImage(file)).resolves.toEqual({ mime: "image/png", width: 240, height: 320 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
