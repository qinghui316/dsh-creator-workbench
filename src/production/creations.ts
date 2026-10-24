import { randomUUID } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { imageKind, inspectImage, MAX_IMAGE_BYTES } from "../covers/files.ts";
import { hashFile, hashText, inside, owned, readState, updateState } from "./storage.ts";
import { platformArticleBody } from "./publicationArticle.ts";
import type { CreationImage, CreationSource, ProductionState, PublicationDraft, PublicationInput } from "./types.ts";

export async function saveCreationImage(folder: string, bytes: Uint8Array, options: { purpose: CreationImage["purpose"]; source: CreationImage["source"]; taskId?: string; id?: string }, signal?: AbortSignal): Promise<CreationImage> {
  const id = options.id ?? randomUUID(), dir = await owned(folder, "images", id), file = join(dir, `image.${imageKind(bytes).extension}`);
  try { await writeFile(file, bytes, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readFile(file)).equals(Buffer.from(bytes))) throw error; }
  const image = await inspectImage(file, signal);
  return { id, ...image, file: relative(folder, file), sha256: await hashFile(file, signal), createdAt: Date.now(), source: options.source, purpose: options.purpose, ...(options.taskId ? { taskId: options.taskId } : {}) };
}
export async function importCreationImage(folder: string, source: string, purpose: CreationImage["purpose"], signal: AbortSignal, assertAvailable?: () => Promise<unknown>): Promise<void> {
  const info = await lstat(source); if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > MAX_IMAGE_BYTES) throw new Error("请选择小于 24 MB 的普通图片文件。");
  const digest = await hashFile(source, signal);
  if ((await readState(folder)).images?.some(i => !i.hidden && i.sha256 === digest)) return;
  const image = await saveCreationImage(folder, await readFile(source), { purpose, source: "imported" }, signal);
  await updateState(folder, async (state) => { await assertAvailable?.(); if (!state.images?.some(i => !i.hidden && i.sha256 === image.sha256)) (state.images ??= []).push(image); });
}
export async function creationImage(folder: string, id: string, state?: ProductionState): Promise<{ image: CreationImage; file: string }> {
  const image = (state ?? await readState(folder)).images?.find((row) => row.id === id && !row.hidden);
  if (!image) throw new Error("图片不存在或已移除，请重新选择。");
  const file = await inside(folder, image.file);
  if (await hashFile(file) !== image.sha256) throw new Error("图片文件已被修改，请重新导入确认。");
  return { image, file };
}
export async function readCreationSource(folder: string, source: CreationSource, state: ProductionState): Promise<string> {
  const pieces = [source.text ?? ""];
  const files = [...(source.files ?? [])];
  if (source.articleId) { const article = state.articles.find((row) => row.id === source.articleId); if (!article) throw new Error("来源文章不存在。"); files.push(article.file); }
  if (source.kind === "topic" && !files.length) {
    const topic = await inside(folder, "topic.md").then(file => readFile(file, "utf8")).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
    if (topic) pieces.push(topic);
  }
  for (const name of [...new Set(files)]) {
    const file = await inside(folder, name), info = await lstat(file); if (info.size > 2 * 1024 * 1024) throw new Error("文字材料超过 2 MB，请选取本次需要的内容。");
    pieces.push(`材料：${name}\n${await readFile(file, "utf8")}`);
  }
  return pieces.filter(Boolean).join("\n\n");
}
export async function savePublication(folder: string, input: PublicationInput, id?: string, expectedRevision?: number, assertAvailable?: () => Promise<unknown>): Promise<PublicationDraft> {
  if (input.type === "images" && input.coverImageId) input = { ...input, imageIds: [input.coverImageId, ...input.imageIds.filter(imageId => imageId !== input.coverImageId)] };
  if (new Set(input.imageIds).size !== input.imageIds.length) throw new Error("图集内同一张图片请只选择一次。");
  if (input.platform === "wechat" && input.type !== "video") throw new Error("本轮视频号只支持视频。");
  if (input.platform === "official-account" && input.type !== "article") throw new Error("公众号请选择文章。");
  if (input.type === "article" && !["bilibili", "official-account"].includes(input.platform)) throw new Error("此平台请准备图片和独立文案。");
  const snapshot = await readState(folder);
  for (const imageId of [...input.imageIds, ...(input.coverImageId ? [input.coverImageId] : [])]) await creationImage(folder, imageId, snapshot);
  if (input.video) await inside(folder, input.video);
  if (input.articleFile) await inside(folder, input.articleFile);
  if (input.articleId && !snapshot.articles.some((a) => a.id === input.articleId)) throw new Error("文章版本不存在。");
  for (const file of Object.values(input.coverFiles ?? {})) if (file) await inside(folder, file);
  return updateState(folder, async (state) => {
    await assertAvailable?.();
    const old = id ? state.publications?.find((p) => p.id === id && !p.hidden) : undefined;
    if (id && (!old || old.revision !== expectedRevision)) throw new Error("发布内容已被修改或移除，输入已保留，请重新读取后合并。");
    const publicationId = old?.id ?? randomUUID(), revision = (old?.revision ?? 0) + 1;
    const dir = await owned(folder, "publications", publicationId), file = join(dir, `body-${revision}-${randomUUID()}.md`);
    const body = input.type === "article" ? await platformArticleBody(folder, dir, input.body, input.articleFile, input.imageIds.length || old?.imageIds.length ? input.imageIds.map(id => state.images!.find(image => image.id === id)!.file) : undefined) : input.body;
    await writeFile(file, body, { encoding: "utf8", flag: "wx" });
    const { body: _body, ...fields } = structuredClone(input);
    const sourceHash = input.source ? old?.sourceHash && JSON.stringify(old.source) === JSON.stringify(input.source) ? old.sourceHash : hashText(await readCreationSource(folder, input.source, state)) : undefined;
    const draft: PublicationDraft = { ...fields, id: publicationId, revision, bodyFile: relative(folder, file), ...(sourceHash ? { sourceHash } : {}), createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() };
    const rows = state.publications ??= [], index = rows.findIndex((p) => p.id === publicationId);
    if (index < 0) rows.push(draft); else rows[index] = draft;
    return { ...draft, body };
  });
}
export async function hydrateCreations(folder: string, state: ProductionState): Promise<ProductionState> {
  if (!state.publications?.length) return state;
  const body = async (p: PublicationDraft) => { if (p.hidden) return {}; try { return { body: await readFile(await inside(folder, p.bodyFile), "utf8") }; } catch { return { bodyError: "正文文件无法读取，请保留当前材料并检查文件。" }; } };
  return { ...state, publications: await Promise.all(state.publications.map(async (p) => ({ ...p, ...await body(p), ...(p.source && p.sourceHash ? { sourceChanged: await readCreationSource(folder, p.source, state).then(text => hashText(text) !== p.sourceHash, () => true) } : {}) }))) };
}
