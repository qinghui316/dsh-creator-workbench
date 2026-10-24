import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageKind } from "../covers/files.ts";
import { hashText, inside, locked, owned } from "./storage.ts";
import { renderWechat } from "./wechat.ts";

/** Local WeWrite formatting only: no credentials, platform mutation or task creation. */
export async function formatArticle(dataDir: string, folder: string, articleFile: string, theme: string, signal: AbortSignal): Promise<{ html: string; path: string }> {
  const article = await inside(folder, articleFile);
  return locked(`article-preview:${article}:${theme}`, async () => {
    signal.throwIfAborted();
    const source = await readFile(article, "utf8");
    const result = await renderWechat(dataDir, folder, article, theme, signal);
    if (source !== await readFile(article, "utf8")) throw new Error("文章已修改，请重新预览最新内容。");
    let html = result.preview, total = 0;
    for (const image of result.images) {
      const bytes = await readFile(await inside(folder, image.path)); total += bytes.length;
      if (total > 24 * 1024 * 1024) throw new Error("预览图片总量超过 24 MB，请缩小图片后重试。");
      const kind = imageKind(bytes), escaped = image.source.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
      html = html.split(`src="${escaped}"`).join(`src="data:${kind.mime};base64,${bytes.toString("base64")}"`);
    }
    signal.throwIfAborted();
    const dir = await owned(folder, `preview-${hashText(`${theme}\n${source}\n${html}`)}`), path = join(dir, "preview.html");
    // A complete, self-contained version has a stable path. Never expose a partial write.
    try { await writeFile(path, html, { encoding: "utf8", flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(await inside(folder, path), "utf8") !== html) throw error; }
    return { html, path };
  });
}
