import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { platformArticleBody, publicationArticleForRender, snapshotPublicationArticle } from "../src/production/publicationArticle.ts";
import { owned } from "../src/production/storage.ts";
describe("immutable platform article", () => {
  it("renders a separately titled body and an older source heading without rewriting either snapshot", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-render-title-"));
    for (const [name, body] of [["body.md", "## First section\n\nBody\n![image](photo.png)"], ["older.md", "# Old title\n\n## First section\n\nBody"]]) {
      const source = join(folder, name!); await writeFile(source, body!);
      const rendered = await publicationArticleForRender(folder, source, "Platform title");
      expect(await readFile(rendered, "utf8")).toMatch(/^# Platform title\n\n## First section/);
      expect(await readFile(rendered, "utf8")).not.toContain("# Old title");
      expect(await readFile(source, "utf8")).toBe(body);
      expect(await publicationArticleForRender(folder, source, "Platform title")).toBe(rendered);
      expect(await publicationArticleForRender(folder, source, "Different title")).not.toBe(rendered);
    }
  });
  it("applies explicit article image order, removal and source rebasing without editing the shared source", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-article-order-")), dir = join(folder, "publication"); await mkdir(dir);
    await writeFile(join(folder, "one.png"), "one"); await writeFile(join(folder, "two.png"), "two");
    const source = join(folder, "article.md"), body = "# Article\n![first](one.png)\nText\n![second](two.png)"; await writeFile(source, body);
    const sorted = await platformArticleBody(folder, dir, body, "article.md", ["two.png", "one.png"]);
    expect(sorted).toContain("![second](../two.png)"); expect(sorted.indexOf("two.png")).toBeLessThan(sorted.indexOf("one.png"));
    const removed = await platformArticleBody(folder, dir, sorted, "article.md", []); expect(removed).not.toMatch(/!\[/);
    expect(await readFile(source, "utf8")).toBe(body);
    const html = await platformArticleBody(folder, dir, '<p>Article</p><img src="one.png" alt="first">', "article.md", ["two.png"]);
    expect(html).toContain('src="../two.png"'); expect(html).not.toContain('src="one.png"');
  });
  it("resolves independent platform-body images before the shared source, and supports copied source-relative images", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-body-base-"));
    const own = join(folder, "publications", "material"); await mkdir(own, { recursive: true });
    const origin = join(folder, "article"); await mkdir(origin); await mkdir(join(folder, "images"));
    await writeFile(join(folder, "images", "photo.png"), "actual image");
    await writeFile(join(origin, "article.md"), "# Shared source");
    await writeFile(join(own, "body.md"), "Independent copy");
    const publication = { bodyFile: "publications/material/body.md", articleFile: "article/article.md" };
    for (const [id, ref] of [["own-base", "../../images/photo.png"], ["copied-base", "../images/photo.png"]]) {
      const dir = await owned(folder, id!), file = await snapshotPublicationArticle(folder, dir, publication, `# Platform\n![photo](${ref})`, []);
      const saved = await readFile(file, "utf8"), image = saved.match(/!\[photo\]\(([^)]+)\)/)![1]!;
      expect(await readFile(join(dir, image), "utf8")).toBe("actual image");
    }
  });
  it("copies body images once; preview and source edits cannot change a submitting task", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-snapshot-")), dir = await owned(folder, "submission"), source = join(folder, "article.md"), image = join(folder, "image.png");
    await writeFile(source, "# Title\n![image](image.png)"); await writeFile(image, "original image");
    const file = await snapshotPublicationArticle(folder, dir, { bodyFile: "article.md" }, await readFile(source, "utf8"), []);
    const body = await readFile(file, "utf8"), frozen = body.match(/!\[image\]\(([^)]+)\)/)![1]!;
    await writeFile(image, "edited image"); await writeFile(source, "new preview source");
    expect(await readFile(join(dir, frozen), "utf8")).toBe("original image"); expect(await readFile(file, "utf8")).toBe(body);
    expect(basename(file)).toBe("publication-body.md");
  });
});
