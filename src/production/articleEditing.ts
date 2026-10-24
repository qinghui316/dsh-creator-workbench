import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ArticleSource, ArticleEdit, ArticleSave, ArticleSaved } from "../projectView.ts";
import type { ArticleVersion } from "./types.ts";
import { formatArticle } from "./articlePreview.ts";
import { snapshotPublicationArticle } from "./publicationArticle.ts";
import { hashText, inside, locked, owned, readState, updateState } from "./storage.ts";

export async function articleSource(folder: string, articleId: string, legacyFile?: string): Promise<ArticleSource> {
  const state = await readState(folder);
  const article = state.articles.find(a => a.id === articleId) ?? (articleId === "legacy" && legacyFile ? { id: "legacy", file: legacyFile, frameFiles: [], createdAt: 0 } : undefined);
  if (!article) throw new Error("文章版本不存在，请重新选择。");
  const file = await inside(folder, article.file), source = await readFile(file, "utf8");
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) throw new Error("文章超过 2 MB，请在外部编辑后导入。");
  return { article: { ...article, format: article.format ?? (/\.html?$/i.test(file) ? "html" : "markdown") }, source, sourceHash: hashText(source) };
}
function validate(request: ArticleEdit) {
  if (!request.source.trim() || Buffer.byteLength(request.source) > 2 * 1024 * 1024) throw new Error("请填写正文，文章不能超过 2 MB。");
}
async function checkBase(folder: string, request: ArticleEdit, legacyFile?: string) {
  validate(request); const base = await articleSource(folder, request.articleId, legacyFile);
  if (base.sourceHash !== request.expectedSourceHash) throw new Error("来源文章已被修改。当前输入已保留，请重新读取并核对。");
  return base;
}
export async function previewArticleEdit(dataDir: string, folder: string, request: ArticleEdit, theme: string, signal: AbortSignal, legacyFile?: string) {
  const base = await checkBase(folder, request, legacyFile);
  const dir = await owned(folder, `edit-preview-${randomUUID()}`);
  try {
    const file = await snapshotPublicationArticle(folder, dir, { articleFile: base.article.file, bodyFile: base.article.file }, request.source, [], base.article.format);
    return await formatArticle(dataDir, folder, file, theme, signal);
  } finally {
    const actual = await realpath(dir), rel = relative(await realpath(folder), actual).replace(/\\/g,"/");
    if (!rel.startsWith(".dsh-creator-workbench/production/edit-preview-") || actual !== dir) throw new Error("预览临时目录已变化，已保留供核对。");
    await rm(actual, {recursive:true,force:true});
  }
}
export async function saveArticleRevision(dataDir: string, folder: string, request: ArticleSave, theme: string, signal: AbortSignal, assertAvailable: () => Promise<unknown>, legacyFile?: string): Promise<ArticleSaved> {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(request.saveId)) throw new Error("保存请求无效，请重试。");
  validate(request);
  const inputHash = hashText(JSON.stringify([request.articleId, request.expectedSourceHash, request.source]));
  return locked(`article-save:${folder}:${request.saveId}`, async () => {
    signal.throwIfAborted(); await assertAvailable();
    const id = `edit-${request.saveId}`;
    let article = (await readState(folder)).articles.find(a => a.id === id);
    if (article && article.saveInputHash !== inputHash) throw new Error("保存请求已用于其他内容，请核对后重新保存。");
    if (!article) {
      const base = await checkBase(folder, request, legacyFile), dir = await owned(folder, "articles", id);
      const manifest = join(dir, "save-input.json");
      try { await writeFile(manifest, JSON.stringify({ inputHash }), { encoding: "utf8", flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || JSON.parse(await readFile(manifest, "utf8")).inputHash !== inputHash) throw error; }
      const file = await snapshotPublicationArticle(folder, dir, { articleFile: base.article.file, bodyFile: base.article.file }, request.source, [], base.article.format, true);
      article = { ...base.article, id, parentArticleId: base.article.id, saveInputHash: inputHash, file: relative(folder, file), createdAt: Date.now(), title: request.source.match(/^#\s+(.+)/m)?.[1] ?? request.source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, "") ?? base.article.title ?? "文章" };
      const version = article;
      await updateState(folder, async state => { await assertAvailable(); if (hashText(await readFile(await inside(folder, base.article.file), "utf8")) !== request.expectedSourceHash) throw new Error("来源文章已被修改，输入已保留。"); if (!state.articles.some(a => a.id === id)) state.articles.push(version); });
    }
    const result = await articleSource(folder, article.id);
    try { return { ...result, preview: await formatArticle(dataDir, folder, article.file, theme, signal) }; }
    catch (error) { return { ...result, previewError: error instanceof Error ? error.message : "排版未完成，请重试预览。" }; }
  });
}
