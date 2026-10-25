import { randomUUID } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { IMAGE_CREDENTIAL } from "../covers/types.ts";
import { readImageSettings } from "../covers/provider.ts";
import { creationImage, importCreationImage, savePublication } from "./creations.ts";
import { generateImageItems } from "./imageTasks.ts";
import { snapshotPublicationArticle } from "./publicationArticle.ts";
import { hashText, inside, owned, readState, updateState } from "./storage.ts";
import type { ContentDetail } from "../types.ts";
import type { ProductionAction, ProductionTask } from "./types.ts";

export interface CreationActionsHost {
  dataDir: string; key: (ref: string) => Promise<string | undefined>; changed: () => void;
  assertAvailable: () => Promise<unknown>;
  newTask: (kind: ProductionTask["kind"], extra: Partial<ProductionTask>) => Promise<{ task: ProductionTask; fresh: boolean }>;
  launch: (task: ProductionTask, work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
}
export async function creationAction(detail: ContentDetail, request: ProductionAction, signal: AbortSignal, host: CreationActionsHost): Promise<boolean | { savedPublication: { id: string; revision: number } }> {
  const folder = detail.folderPath;
  if (request.action === "import-image") await importCreationImage(folder, request.sourcePath, request.purpose, signal, host.assertAvailable);
  else if (request.action === "register-article" || request.action === "import-article") {
    let file = request.action === "register-article" ? await inside(folder, request.file) : request.sourcePath;
    const extension = extname(file).toLowerCase(); if (![".md", ".html", ".htm"].includes(extension)) throw new Error("请选择 Markdown 或 HTML 文章。");
    const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > 2 * 1024 * 1024) throw new Error("请选择小于 2 MB 的普通文章文件。");
    const text = await readFile(file, "utf8"), id = randomUUID();
    if (request.action === "register-article") for (const imageId of request.imageIds ?? []) await creationImage(folder, imageId);
    if (request.action === "import-article") {
      const dir = await owned(folder, "articles", id);
      file = await snapshotPublicationArticle(dirname(file), dir, { articleFile: basename(file), bodyFile: basename(file) }, text, []);
    }
    const title = extension === ".md" ? text.match(/^#\s+(.+)/m)?.[1] : text.match(/<h1[^>]*>([\s\S]*?)<\/h1>|<title[^>]*>([\s\S]*?)<\/title>/i)?.slice(1).find(Boolean)?.replace(/<[^>]*>/g, "");
    await updateState(folder, async (state) => { await host.assertAvailable(); state.articles.push({ id, file: relative(folder, file), title: title?.trim() || detail.title, createdAt: Date.now(), frameFiles: [], format: extension === ".md" ? "markdown" : "html", ...(request.action === "register-article" && request.source ? { source: request.source } : {}), ...(request.action === "register-article" && request.imageIds ? { imageIds: request.imageIds } : {}) }); });
  }
  else if (request.action === "remove-image") await updateState(folder, async (state) => { await host.assertAvailable(); const image = state.images?.find((row) => row.id === request.imageId); if (!image) throw new Error("图片不存在。"); image.hidden = true; });
  else if (request.action === "save-publication") { const saved = await savePublication(folder, request.input, request.publicationId, request.expectedRevision, host.assertAvailable, request.saveId); host.changed(); return { savedPublication: { id: saved.id, revision: saved.revision } }; }
  else if (request.action === "remove-publication") await updateState(folder, async (state) => {
    await host.assertAvailable(); const publication = state.publications?.find((p) => p.id === request.publicationId && !p.hidden);
    if (!publication || publication.revision !== request.expectedRevision) throw new Error("发布内容已变化，请重新读取。");
    publication.hidden = true; publication.revision++;
  });
  else if (request.action === "generate-images" || request.action === "retry-images") {
    const settings = await readImageSettings(host.dataDir), key = await host.key(IMAGE_CREDENTIAL), latestSettings = await readImageSettings(host.dataDir);
    if (settings.pending || latestSettings.pending || settings.revision !== latestSettings.revision) throw new Error("生图设置正在变化，请保存完成后再制作。");
    if (!key) throw new Error("请先在设置中配置生图服务。");
    if (request.action === "generate-images") {
      for (const item of request.items) for (const id of item.references ?? []) await creationImage(folder, id);
      const identity = hashText(JSON.stringify({ items: request.items, source: request.source })), state = await readState(folder);
      const unknown = state.tasks.find((t) => t.kind === "images" && t.uploadKey === identity && t.status === "unconfirmed");
      if (unknown) throw new Error(`图片请求 ${unknown.id} 的结果尚未确认，请核对后重试原任务。`);
      const { task, fresh } = await host.newTask("images", { uploadKey: identity, ...(request.source ? { source: request.source } : {}), ...(request.sessionId ? { sessionId: request.sessionId } : {}), imageItems: request.items.map((item) => ({ ...item, id: randomUUID(), references: item.references ?? [], status: "pending" })) });
      if (task.uploadKey !== identity) throw new Error("已有另一组图片正在制作，请先等待或取消。");
      if (fresh) await host.launch(task, (current) => generateImageItems({ dataDir: host.dataDir, folder, task, key, settings, signal: current, changed: host.changed }));
    } else {
      const state = await readState(folder), task = state.tasks.find((t) => t.id === request.taskId && t.kind === "images");
      if (!task?.imageItems || ["running", "queued"].includes(task.status)) throw new Error("图片任务不存在或仍在运行。");
      const slots = request.itemIds.map((id) => task.imageItems!.find((i) => i.id === id));
      if (slots.some((i) => !i || i.status === "completed")) throw new Error("请选择未完成的图片重试。");
      if (slots.some((i) => i?.status === "unconfirmed") && !request.acknowledgeUnknown) throw new Error("请先核对上次图片结果，再明确重试，可能产生新的费用。");
      await updateState(folder, async (latest) => { await host.assertAvailable(); const stored = latest.tasks.find(t => t.id === task.id); if (!stored || ["queued", "running"].includes(stored.status) || (stored.executionRevision ?? 0) !== (task.executionRevision ?? 0)) throw new Error("图片任务已变化，请重新读取。"); if (stored.status === "cancelled") stored.status = "failed"; });
      await host.launch(task, (current) => generateImageItems({ dataDir: host.dataDir, folder, task, key, settings, itemIds: request.itemIds, signal: current, changed: host.changed }));
    }
  } else return false;
  host.changed(); return true;
}
