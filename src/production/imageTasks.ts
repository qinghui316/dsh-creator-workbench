import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { assertRatio } from "../covers/files.ts";
import { ImageRequestError, readImageSettings, requestImage, safeImageError } from "../covers/provider.ts";
import type { ImageSettings } from "../covers/types.ts";
import { creationImage, saveCreationImage } from "./creations.ts";
import { owned, readState, updateState } from "./storage.ts";
import type { ImageItem, ProductionTask } from "./types.ts";

export async function reconcileImageItems(folder: string, task: ProductionTask): Promise<void> {
  if (!task.imageItems?.some(item => ["running", "pending"].includes(item.status))) return;
  for (const item of task.imageItems ?? []) {
    if (item.status !== "running") continue;
    const dir = await owned(folder, "images", item.imageId ?? item.id), file = (await readdir(dir)).find((f) => /^image\.(png|jpg|webp)$/.test(f));
    let recovered = false;
    if (file) {
      try {
        const image = await saveCreationImage(folder, await readFile(join(dir, file)), { id: item.imageId ?? item.id, purpose: item.purpose, source: "generated", taskId: task.id });
        assertRatio(image.width, image.height, item.ratio);
        await updateState(folder, (state) => { if (!state.images?.some((i) => i.id === image.id)) (state.images ??= []).push(image); const slot = state.tasks.find((t) => t.id === task.id)?.imageItems?.find((i) => i.id === item.id); if (slot) { slot.imageId = image.id; slot.status = "completed"; delete slot.error; } }); recovered = true;
      } catch { /* Keep the file for inspection, never infer a valid paid result. */ }
    }
    if (!recovered) await updateState(folder, (state) => { const slot = state.tasks.find((t) => t.id === task.id)?.imageItems?.find((i) => i.id === item.id); if (slot) { slot.status = "unconfirmed"; slot.error = "制作中断，服务端结果需核对，未自动重发。"; } });
  }
  await updateState(folder, state => {
    const stored = state.tasks.find(t => t.id === task.id); if (!stored?.imageItems) return;
    for (const item of stored.imageItems) if (item.status === "pending") item.status = "cancelled";
    const complete = stored.imageItems.filter(i => i.status === "completed").length;
    stored.status = complete === stored.imageItems.length ? "completed" : stored.imageItems.some(i => i.status === "unconfirmed") ? "unconfirmed" : "failed";
    stored.step = `${complete}/${stored.imageItems.length} 张图片已保存`; stored.updatedAt = Date.now();
    if (stored.status === "completed") delete stored.error;
    else stored.error = stored.status === "unconfirmed" ? "制作中断，请核对已保存图片及上次请求结果。" : "制作中断，可继续尚未完成的图片。";
  });
}
export async function generateImageItems(input: { folder: string; dataDir: string; task: ProductionTask; key: string; settings?: ImageSettings; itemIds?: string[]; signal: AbortSignal; changed: () => void }): Promise<void> {
  const settings = structuredClone(input.settings ?? await readImageSettings(input.dataDir));
  if (!settings.apiBase || !settings.model || settings.pending) throw new Error("请先完成生图服务设置。");
  const items = input.task.imageItems ?? [];
  const referenceData = new Map(await Promise.all([...new Set(items.flatMap(i => i.references))].map(async id => { const { file } = await creationImage(input.folder, id); return [id, { data: await readFile(file), name: basename(file) }] as const; })));
  for (const original of items) {
    if (input.itemIds && !input.itemIds.includes(original.id) || original.status === "completed") continue;
    if (input.signal.aborted) break;
    const imageId = randomUUID();
    const patch = async (values: Partial<ImageItem>) => { await updateState(input.folder, (state) => { const slot = state.tasks.find((t) => t.id === input.task.id)?.imageItems?.find((i) => i.id === original.id); if (!slot) throw new Error("图片任务已不存在。"); Object.assign(slot, values); }); input.changed(); };
    await patch({ status: "running", imageId });
    try {
      const references = original.references.map(id => referenceData.get(id)!);
      const bytes = await requestImage(settings, input.key, { ratio: original.ratio, prompt: original.prompt, mode: references.length ? "reference" : "text", references }, input.signal);
      const image = await saveCreationImage(input.folder, bytes, { id: imageId, purpose: original.purpose, source: "generated", taskId: input.task.id });
      assertRatio(image.width, image.height, original.ratio);
      await updateState(input.folder, (state) => { (state.images ??= []).push(image); });
      await patch({ status: "completed", imageId });
    } catch (error) {
      await patch({ status: error instanceof ImageRequestError && error.uncertain ? "unconfirmed" : input.signal.aborted ? "cancelled" : "failed", error: safeImageError(error, input.key) });
    }
  }
  await updateState(input.folder, (state) => {
    const task = state.tasks.find((t) => t.id === input.task.id)!;
    if (input.signal.aborted) for (const item of task.imageItems ?? []) if (item.status === "pending") item.status = "cancelled";
    const states = task.imageItems?.map((item) => item.status) ?? [];
    task.status = states.every((s) => s === "completed") ? "completed" : states.includes("unconfirmed") ? "unconfirmed" : input.signal.aborted ? "cancelled" : "failed";
    task.step = `${states.filter((s) => s === "completed").length}/${states.length} 张图片已保存`;
    task.updatedAt = Date.now();
  }); input.changed();
}
