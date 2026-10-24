import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { formatArticle } from "../src/production/articlePreview.ts";

// Real bundled WeWrite converter and isolated Python, without any account or network request.
const dataDir = join(homedir(), ".dsh-creator-workbench");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNGQAAAAASUVORK5CYII=", "base64");
describe("WeWrite HTML article delivery", () => {
  it("delivers a standalone themed HTML, reuses its path and invalidates for source/theme/image changes", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-wewrite 中文 "));
    const article = join(folder, "draft.md"), image = join(folder, "画面 空格.png");
    const markdown = "# 真实视频文章\n\n这是正文中的画面 空格.png，应保留正文原样。\n\n![视频画面](画面%20空格.png)\n\n## 实际内容\n\n根据实际视频整理。\n";
    await writeFile(article, markdown); await writeFile(image, png);
    const signal = new AbortController().signal;
    const first = await formatArticle(dataDir, folder, article, "claude-editorial", signal);
    expect(first.path).toMatch(/preview\.html$/); expect(first.html).toContain("data:image/png;base64,");
    expect(first.html).toContain("画面 空格.png"); expect(first.html).toContain("应保留正文原样"); expect(first.html).not.toContain('src="画面%20空格.png"');
    expect(first.html).toContain("<title>真实视频文章</title>"); expect(first.html).toContain("真实视频文章</h1>");
    expect(await readFile(first.path, "utf8")).toBe(first.html);
    expect((await formatArticle(dataDir, folder, article, "claude-editorial", signal)).path).toBe(first.path);
    const otherTheme = await formatArticle(dataDir, folder, article, "professional-clean", signal);
    expect(otherTheme.path).not.toBe(first.path);
    await writeFile(article, markdown.replace("实际内容", "补充内容"));
    const edited = await formatArticle(dataDir, folder, article, "claude-editorial", signal);
    expect(edited.path).not.toBe(first.path); expect(await readFile(first.path, "utf8")).toBe(first.html);
    await writeFile(image, Buffer.concat([png, Buffer.from("changed")]));
    expect((await formatArticle(dataDir, folder, article, "claude-editorial", signal)).path).not.toBe(edited.path);
    await writeFile(image, "not an image");
    await expect(formatArticle(dataDir, folder, article, "claude-editorial", signal)).rejects.toThrow();
    expect(await readFile(first.path, "utf8")).toBe(first.html);
  }, 30_000);
  it("rejects outside source files and honours cancellation without touching the source", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-wewrite-boundary-")), other = await mkdtemp(join(tmpdir(), "creator-wewrite-other-"));
    const source = join(other, "draft.md"); await writeFile(source, "# 外部文章\n\n正文");
    await expect(formatArticle(dataDir, folder, source, "claude-editorial", new AbortController().signal)).rejects.toThrow("超出");
    const local = join(folder, "draft.md"); await writeFile(local, "# 本地文章\n\n正文");
    const controller = new AbortController(); controller.abort();
    await expect(formatArticle(dataDir, folder, local, "claude-editorial", controller.signal)).rejects.toThrow();
    expect(await readFile(local, "utf8")).toBe("# 本地文章\n\n正文");
  });
});
