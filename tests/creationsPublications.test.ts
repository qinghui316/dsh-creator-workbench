import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mediaCommand } from "../src/covers/files.ts";
import { creationImage, hydrateCreations, importCreationImage, savePublication } from "../src/production/creations.ts";
import { owned, readState, updateSettings, updateState } from "../src/production/storage.ts";
import { preparePublicationUpload } from "../src/production/publicationUpload.ts";
import { productionStateSchema, productionActionSchema } from "../src/production/schemas.ts";
import { metricsSnapshot } from "../src/production/metricsTask.ts";
import { refreshMetric } from "../src/production/metrics.ts";
import { ProductionWorkflow } from "../src/production/workflow.ts";
import type { ContentDetail } from "../src/types.ts";
import type { PublicationInput } from "../src/production/types.ts";

let picture: Buffer;
beforeAll(async () => { const folder = await mkdtemp(join(tmpdir(), "creator-v050-picture-")), file = join(folder, "image.png"); await mediaCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=240x320", "-frames:v", "1", file]); picture = await readFile(file); }, 15000);
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-图文 空格-")), dataDir = join(folder, "settings");
  const source = join(folder, "图片.png"); await writeFile(source, picture);
  await importCreationImage(folder, source, "card", new AbortController().signal);
  const image = (await readState(folder)).images![0]!;
  const input: PublicationInput = { platform: "xiaohongshu", type: "images", title: "独立图文", body: "平台正文", tags: [], imageIds: [image.id] };
  const scope = { id: "project", folderPath: folder }, signal = new AbortController().signal;
  await updateSettings(dataDir, s => { s.accounts.xiaohongshu = { platform: "xiaohongshu", id: "one", name: "创作者", checkedAt: 1 }; s.accounts.douyin = { platform: "douyin", id: "one", name: "创作者", checkedAt: 1 }; });
  const host = { dataDir, platforms: async () => ["xiaohongshu", "douyin"] as const, key: async () => undefined, resolve: async () => scope, changed: vi.fn(), reserve: vi.fn() };
  return { folder, dataDir, scope, signal, image, input, host };
}
describe("shared creations and independent publications", () => {
  it("saves article reordering and removal into independent body versions, preserving earlier content", async () => {
    const f = await fixture(), other = join(f.folder, "second.png"); await mediaCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:s=240x320", "-frames:v", "1", other]); await importCreationImage(f.folder, other, "card", f.signal);
    const image = (await readState(f.folder)).images!.find(i => i.id !== f.image.id)!;
    const input: PublicationInput = { ...f.input, platform: "bilibili", type: "article", imageIds: [f.image.id, image.id], body: `# Article\n![first](../../images/${f.image.id}/image.png)\nText\n![second](../../images/${image.id}/image.png)` };
    const first = await savePublication(f.folder, input), second = await savePublication(f.folder, { ...input, body: first.body!, imageIds: [image.id, f.image.id] }, first.id, 1);
    expect(second.body!.indexOf(image.id)).toBeLessThan(second.body!.indexOf(f.image.id));
    const third = await savePublication(f.folder, { ...input, body: second.body!, imageIds: [] }, first.id, 2); expect(third.body).not.toContain("![");
    expect(await readFile(join(f.folder, first.bodyFile), "utf8")).toBe(first.body);
  });
  it("uses the selected graphic cover as the first upload image and rejects inconsistent older material", async () => {
    const f = await fixture();
    const other = join(f.folder, "另一个图片.png"); await mediaCommand("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:s=240x320", "-frames:v", "1", other]);
    await importCreationImage(f.folder, other, "card", f.signal);
    const second = (await readState(f.folder)).images!.find(image => image.id !== f.image.id)!;
    const p = await savePublication(f.folder, { ...f.input, imageIds: [f.image.id, second.id], coverImageId: second.id });
    expect(p.imageIds).toEqual([second.id, f.image.id]);
    await updateState(f.folder, state => { state.publications![0]!.imageIds = [f.image.id, second.id]; });
    await expect(preparePublicationUpload(f.scope, p.id, p.revision, true, f.host, f.signal)).rejects.toThrow("第一张图片不一致");
    expect((await readState(f.folder)).tasks).toHaveLength(0);
  });
  it("keeps bodies in versioned files, preserves source images, and atomically rejects stale edits", async () => {
    const f = await fixture(), first = await savePublication(f.folder, f.input);
    const two = await savePublication(f.folder, { ...f.input, platform: "douyin", body: "独立抖音正文" });
    const results = await Promise.allSettled([savePublication(f.folder, { ...f.input, body: "manual" }, first.id, 1), savePublication(f.folder, { ...f.input, body: "agent" }, first.id, 1)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const state = await readState(f.folder), hydrated = await hydrateCreations(f.folder, state);
    expect(state.publications!.every(p => !("body" in p))).toBe(true);
    expect(hydrated.publications!.find(p => p.id === two.id)?.body).toBe("独立抖音正文");
    expect(await readFile(join(f.folder, first.bodyFile), "utf8")).toBe("平台正文");
    expect(await readFile(join(f.folder, "图片.png"))).toEqual(picture);
    expect(productionStateSchema.parse(hydrated).publications).toHaveLength(2);
  });
  it("backs up an actual legacy index once before upgrading writes", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-legacy-")), dir = await owned(folder);
    const old = { schemaVersion: 1, tasks: [], transcripts: [], articles: [], drafts: [], metrics: [] };
    await writeFile(join(dir, "index.json"), JSON.stringify(old));
    await updateState(folder, s => { s.publications = []; });
    expect(JSON.parse(await readFile(join(dir, "index-v1.backup.json"), "utf8"))).toEqual(old);
    expect((await readState(folder)).schemaVersion).toBe(2);
    await updateState(folder, s => { s.images = []; });
    expect(JSON.parse(await readFile(join(dir, "index-v1.backup.json"), "utf8"))).toEqual(old);
  });
  it("hides images without deleting bytes and refuses them for new material", async () => {
    const f = await fixture(); await updateState(f.folder, s => { s.images![0]!.hidden = true; });
    await expect(creationImage(f.folder, f.image.id)).rejects.toThrow("已移除");
    await expect(savePublication(f.folder, f.input)).rejects.toThrow("已移除");
    expect(await readFile(join(f.folder, f.image.file))).toEqual(picture);
  });
  it("rejects cross-project assets and unsupported Channels image posts", async () => {
    const f = await fixture(), other = await fixture();
    await expect(savePublication(other.folder, { ...other.input, imageIds: [f.image.id] })).rejects.toThrow("不存在");
    await expect(savePublication(f.folder, { ...f.input, platform: "wechat" })).rejects.toThrow("只支持视频");
  });
  it("deduplicates concurrent UI/Agent starts and preserves the fixed body after editing", async () => {
    const f = await fixture(), p = await savePublication(f.folder, f.input);
    const results = await Promise.all([preparePublicationUpload(f.scope, p.id, p.revision, true, f.host, f.signal), preparePublicationUpload(f.scope, p.id, p.revision, true, f.host, f.signal)]);
    expect(results.filter(r => r.fresh)).toHaveLength(1); expect(results[0]!.task.id).toBe(results[1]!.task.id);
    await savePublication(f.folder, { ...f.input, body: "later edit" }, p.id, 1);
    const snapshot = JSON.parse(await readFile(join(f.folder, results[0]!.task.packageFile!), "utf8"));
    expect(snapshot.body).toBe("平台正文"); expect((await readState(f.folder)).tasks).toHaveLength(1);
  });
  it("blocks another ordinary upload after interruption, even when text changes", async () => {
    const f = await fixture(), p = await savePublication(f.folder, f.input);
    const first = await preparePublicationUpload(f.scope, p.id, 1, true, f.host, f.signal);
    await updateState(f.folder, s => { s.tasks[0]!.status = "unconfirmed"; });
    const edited = await savePublication(f.folder, { ...f.input, body: "new text" }, p.id, 1);
    const next = await preparePublicationUpload(f.scope, p.id, edited.revision, true, f.host, f.signal);
    expect(next.fresh).toBe(false); expect(next.task.id).toBe(first.task.id); expect(next.notice?.canCreateNew).toBe(true);
    expect((await readState(f.folder)).tasks).toHaveLength(1);
  });
  it("freezes ordered upload images so later source edits cannot change the submission", async () => {
    const f = await fixture(), p = await savePublication(f.folder, f.input);
    const admitted = await preparePublicationUpload(f.scope, p.id, 1, true, f.host, f.signal);
    const snapshot = JSON.parse(await readFile(join(f.folder, admitted.task.packageFile!), "utf8"));
    expect(snapshot.images[0].file).not.toBe(f.image.file);
    await writeFile(join(f.folder, f.image.file), "changed after admission");
    expect(await readFile(join(f.folder, snapshot.images[0].file))).toEqual(picture);
  });
  it("reports a missing publication body without hiding other assets or substituting empty text", async () => {
    const f = await fixture(), p = await savePublication(f.folder, f.input);
    await unlink(join(f.folder, p.bodyFile));
    const view = await hydrateCreations(f.folder, await readState(f.folder));
    expect(view.images).toHaveLength(1); expect(view.publications![0]!.body).toBeUndefined(); expect(view.publications![0]!.bodyError).toContain("无法读取");
  });
  it("separates platforms and accounts instead of merging their requests", async () => {
    const f = await fixture(), one = await savePublication(f.folder, f.input), two = await savePublication(f.folder, { ...f.input, platform: "douyin" });
    const a = await preparePublicationUpload(f.scope, one.id, 1, true, f.host, f.signal), b = await preparePublicationUpload(f.scope, two.id, 1, true, f.host, f.signal);
    await updateSettings(f.dataDir, s => { s.accounts.xiaohongshu!.id = "another"; });
    const c = await preparePublicationUpload(f.scope, one.id, 1, true, f.host, f.signal);
    expect(new Set([a.task.id,b.task.id,c.task.id]).size).toBe(3);
  });
  it("collects all associated works in one platform and retains record identity", async () => {
    const f = await fixture(); await updateState(f.folder, s => { s.metrics.push(...["video", "images"].map((id) => ({ platform: "xiaohongshu" as const, accountId: "one", remoteId: id, publicationId: id, recordId: `record-${id}`, checkedAt: 1, state: "unassociated" as const }))); });
    const result = await metricsSnapshot(f.dataDir, f.folder, ["xiaohongshu"]);
    expect(result.metricsTargets.map(t => t.remoteId).sort()).toEqual(["images", "video"]);
    const before = (await readState(f.folder)).metrics[0]!;
    const next = refreshMetric(before, [{ platform: "xiaohongshu", remoteId: "video", title: "video", views: 0 }]);
    expect(next).toMatchObject({ publicationId: "video", recordId: "record-video", views: 0, state: "ok" });
  });
  it("prepares a topic article through the same public Agent action without a video", async () => {
    const f = await fixture(), detail = { ...f.scope, title: "只写文章", covers: {}, tags: [], subtitles: {} } as unknown as ContentDetail;
    const workflow = new ProductionWorkflow({ ...f.host, resolve: async () => detail, hasKey: async () => false, setKey: async () => undefined, jobs: () => undefined });
    const request = productionActionSchema.parse({ ...f.scope, action: "prepare-article", source: { kind: "topic", text: "用户的完整文章要求" } });
    const state = await workflow.action(request as never, f.signal), task = state.tasks.at(-1)!;
    expect(task.video).toBeUndefined();
    const input = await workflow.articleInputs(f.scope, task.id, "another-session", f.signal);
    expect(input.transcript).toContain("用户的完整文章要求"); expect(input.frames).toEqual([]); expect(input.rules).toContain("独立写作");
    await writeFile(join(f.folder, "topic.md"), "稍后修改的选题");
    expect((await workflow.articleInputs(f.scope, task.id, undefined, f.signal)).transcript).toBe(input.transcript);
  });
  it("returns the exact saved publication identity without persisting response metadata", async () => {
    const f = await fixture(), detail = { ...f.scope, title: "项目", covers: {}, tags: [], subtitles: {} } as unknown as ContentDetail;
    const workflow = new ProductionWorkflow({ ...f.host, resolve: async () => detail, hasKey: async () => false, setKey: async () => undefined, jobs: () => undefined });
    const response = await workflow.action({ ...f.scope, action: "save-publication", input: f.input }, f.signal);
    expect(response.savedPublication).toMatchObject({ id: response.publications![0]!.id, revision: 1 });
    expect(productionStateSchema.parse(response).savedPublication).toEqual(response.savedPublication);
    expect((await readState(f.folder)).savedPublication).toBeUndefined();
  });
});
