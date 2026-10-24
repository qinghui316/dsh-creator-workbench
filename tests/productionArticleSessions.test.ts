import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/production/articles.ts", async (original) => ({
  ...await original<typeof import("../src/production/articles.ts")>(),
  prepareArticleFrames: vi.fn(async ({ dir, folder }) => {
    const frame = join(dir, "frame-evidence.jpg"); await writeFile(frame, "actual extracted fixture");
    return { transcript: "本次视频的真实文字", frames: [{ file: relative(folder, frame), at: 1 }], skill: "WeWrite" };
  }),
}));
vi.mock("../src/production/articlePreview.ts", () => ({ formatArticle: vi.fn(async () => ({ path: "preview.html", html: "<h1>文章</h1>" })) }));
import { ProductionWorkflow } from "../src/production/workflow.ts";
import { mediaIdentity, readState, updateState } from "../src/production/storage.ts";
import { registerProductionTools } from "../src/production/tools.ts";
import type { ContentDetail } from "../src/types.ts";

describe("article tools across native conversations", () => {
  it("reads and saves an exact request from other conversations without changing its navigation hint", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-article-session-")), videoFile = join(folder, "video.mp4");
    await writeFile(videoFile, "video evidence"); const video = await mediaIdentity(videoFile), id = crypto.randomUUID();
    const detail = { id: "episode", folderPath: folder, selectedVideo: video.name, videoSelection: "selected" } as ContentDetail;
    const workflow = new ProductionWorkflow({ dataDir: join(folder, "settings"), resolve: async (scope) => {
      if (scope.id !== detail.id || scope.folderPath !== folder) throw new Error("项目不匹配"); return detail;
    }, key: async () => undefined, hasKey: async () => false, setKey: async () => undefined, platforms: async () => [], jobs: () => undefined, changed: () => undefined });
    await updateState(folder, (s) => {
      s.tasks.push({ id, kind: "article", status: "waiting-agent", contentId: detail.id, folderPath: folder, video, sessionId: "origin", createdAt: 1, updatedAt: 1 });
      s.transcripts.push({ id: crypto.randomUUID(), video, source: "imported", createdAt: 1, srtFile: "text.srt", textFile: "text.txt" } as never);
    });
    const tools = new Map<string, { execute: (args: unknown, exec: unknown) => Promise<unknown> }>();
    registerProductionTools({ get: (name: string) => name === "tools" ? { register: (tool: { name: string }) => tools.set(tool.name, tool as never) } : { saveImages: async () => [{ id: "actual-frame" }] } } as never, workflow);
    await tools.get("creator_production_action")!.execute({ action: { id: detail.id, folderPath: folder, action: "prepare-article" } }, { signal: new AbortController().signal, agent: { session: { id: "another-conversation" } } });
    await tools.get("creator_prepare_article")!.execute({ ...detail, taskId: id }, { signal: new AbortController().signal, agent: { session: { id: "another-conversation" } } });
    const markdown = "# 本期真实文章\n\n" + "本文依据本期视频转写整理，所述事实均可在视频中核对。".repeat(4) + "\n![真实截图](frame-evidence.jpg)";
    await tools.get("creator_save_article")!.execute({ ...detail, taskId: id, markdown }, { signal: new AbortController().signal, agent: { session: { id: "third-conversation" } } });
    const state = await readState(folder);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id, status: "completed", sessionId: "origin" });
    expect(state.articles).toHaveLength(1);
    expect(await readFile(join(folder, state.articles[0]!.file), "utf8")).toBe(markdown + "\n");
    await expect(workflow.articleInputs({ id: "foreign", folderPath: folder }, id, "other", new AbortController().signal)).rejects.toThrow("项目不匹配");
  });
});
