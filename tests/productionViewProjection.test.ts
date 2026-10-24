import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectProduction } from "../src/production/projection.ts";
import { updateSettings, updateState } from "../src/production/storage.ts";
import { emptyPublish } from "../src/publishRules.ts";
import type { ContentSummary } from "../src/types.ts";
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-publish-view-")), dataDir = join(folder, "settings");
  const account = { platform: "bilibili" as const, id: "original", name: "作者", checkedAt: 1 };
  await updateSettings(dataDir, (s) => { s.accounts.bilibili = account; });
  const video = { name: "video.mp4", size: 100, modifiedAt: 1, sha256: "snapshot" };
  await updateState(folder, (state) => { state.tasks.push({ id: "upload", kind: "upload", status: "ready", contentId: "one", folderPath: folder, platform: "bilibili", account, video, createdAt: 1, updatedAt: 1 }); });
  const item: ContentSummary = { id: "one", title: "本期", folderPath: folder, selectedVideo: video.name, videoSelection: "selected", videos: [{ ...video, path: join(folder, video.name) }], publish: emptyPublish(), recordedAt: 1, createdMs: 1, covers: {}, subtitles: {}, hasPublishPackage: false, hasArticle: false, tags: [], pipeline: "raw", workflow: "finish", burn: { status: "idle" }, subtitleJob: { status: "idle" }, coverJob: { status: "idle" } };
  return { item, dataDir };
}
describe("one account-bound publication view", () => {
  it("shows a verified uploaded draft as a draft and keeps an explicit manual status until the next real sync", async () => {
    const f = await fixture();
    expect((await projectProduction(f.item, f.dataDir)).publish.bilibili).toMatchObject({ status: "draft", source: "publisher" });
    f.item.publish.bilibili = { status: "unpublished", source: "overlay" };
    expect((await projectProduction(f.item, f.dataDir)).publish.bilibili.status).toBe("unpublished");
  });
  it("isolates a previous account's draft and confirmed publication", async () => {
    const f = await fixture();
    f.item.publish.bilibili = { status: "published", source: "sync", verifiedAccountId: "original", views: 42 };
    await updateSettings(f.dataDir, (s) => { s.accounts.bilibili!.id = "replacement"; });
    expect((await projectProduction(f.item, f.dataDir)).publish.bilibili).toEqual({ status: "unpublished", source: "none" });
  });
});
