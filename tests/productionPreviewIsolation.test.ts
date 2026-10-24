import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/production/articlePreview.ts", () => ({ formatArticle: vi.fn(async () => ({ path: "preview.html", html: "<h1>排版预览</h1>" })) }));
import { ProductionWorkflow } from "../src/production/workflow.ts";
import { owned, readState, updateState } from "../src/production/storage.ts";
import type { ContentDetail } from "../src/types.ts";
describe("local preview isolation from WeChat submission", () => {
  it("never repurposes or changes an in-flight draft task or its immutable input", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-preview-isolation-")), article = join(folder, "article.md");
    await writeFile(article, "# 文章标题\n\n实际正文");
    const detail = { id: "episode", folderPath: folder, articlePath: article } as ContentDetail;
    const workflow = new ProductionWorkflow({ dataDir: join(folder, "settings"), resolve: async () => detail, key: async () => undefined, hasKey: async () => false, setKey: async () => undefined, platforms: async () => [], jobs: () => undefined, changed: () => undefined });
    const id = crypto.randomUUID();
    await updateState(folder, (state) => { state.tasks.push({ id, kind: "wechat", status: "running", step: "draft", contentId: "episode", folderPath: folder, createdAt: 1, updatedAt: 2, wechatAppId: "wxoriginal", articleFile: "article.md", receipt: "original-receipt.json" }); });
    workflow.active.set(id, { folder, controller: new AbortController() });
    const index = join(await owned(folder), "index.json"), before = await readFile(index, "utf8");
    await workflow.preview(detail, {}, new AbortController().signal);
    await workflow.action({ ...detail, action: "wechat-preview" }, new AbortController().signal);
    expect(await readFile(index, "utf8")).toBe(before);
    expect((await readState(folder)).tasks).toHaveLength(1);
    expect(workflow.active.has(id)).toBe(true);
    expect(await readFile(article, "utf8")).toBe("# 文章标题\n\n实际正文");
  });
});
