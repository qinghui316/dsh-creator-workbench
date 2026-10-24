import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { saveArticle } from "../src/production/articles.ts";
import { mediaIdentity } from "../src/production/storage.ts";
describe("versioned video articles", () => {
  it("binds images to this request and preserves the first saved article", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-article-")), dir = join(folder, "request"); await mkdir(dir);
    const videoFile = join(folder, "video.mp4"), frame = join(dir, "frame-1.jpg"); await writeFile(videoFile, "video"); await writeFile(frame, "frame");
    const input = { folder, dir, video: await mediaIdentity(videoFile), transcriptId: "transcript-one", frames: [relative(folder, frame)], markdown: "# A real title\n\n" + "This article uses actual transcript evidence and the exact video frame. ".repeat(3) + "\n![step](frame-1.jpg)" };
    const result = await saveArticle(input); expect(result.video.sha256).toBe(input.video.sha256);
    await expect(saveArticle({ ...input, markdown: input.markdown.replace("frame-1.jpg", "../foreign.jpg") })).rejects.toThrow();
    await expect(saveArticle({ ...input, markdown: input.markdown.replace("frame-1.jpg", "https://example.com/fake.jpg") })).rejects.toThrow("相对路径");
    await expect(saveArticle({ ...input, markdown: input.markdown + "modified" })).rejects.toThrow();
    expect(await readFile(join(folder, result.file), "utf8")).toBe(input.markdown + "\n");
  });
});
