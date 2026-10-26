import { readState, inside, readSettings } from "./storage.ts";
import type { ProductionSettings } from "./types.ts";
import type { ContentSummary } from "../types.ts";

/** Project only artifacts whose recorded source still matches the explicit current video. */
export async function projectProduction<T extends ContentSummary>(item: T, dataDir?: string, configured?: ProductionSettings): Promise<T> {
  const state = await readState(item.folderPath).catch(() => undefined); if (!state) return item;
  const current = item.videos?.find((video) => video.name === item.selectedVideo);
  const transcript = [...state.transcripts].reverse().find((entry) => current && entry.video.name === current.name && entry.video.size === current.size && entry.video.modifiedAt === current.modifiedAt);
  const article = state.articles.at(-1), result = { ...item };
  if (dataDir) {
    const settings = configured ?? await readSettings(dataDir); result.publish = { ...item.publish };
    for (const key of Object.keys(result.publish) as Array<keyof typeof result.publish>) {
      const row = result.publish[key], accountId = settings.accounts[key]?.id;
      if (row.verifiedAccountId && row.verifiedAccountId !== accountId) result.publish[key] = { status: "unpublished", source: "none" };
      const ready = [...state.tasks].reverse().find((task) => task.kind === "upload" && task.platform === key && task.status === "ready" && task.account?.id === accountId && current && task.video?.name === current.name && task.video.size === current.size && task.video.modifiedAt === current.modifiedAt);
      if (ready && result.publish[key].source === "none") result.publish[key] = { status: "draft", source: "publisher", verifiedAccountId: accountId! };
    }
  }
  if (transcript) {
    const file = await inside(item.folderPath, transcript.srtFile).catch(() => undefined), text = await inside(item.folderPath, transcript.textFile).catch(() => undefined);
    if (file && text) result.subtitles = { srt: file, transcript: text };
  }
  if (article) { const file = await inside(item.folderPath, article.file).catch(() => undefined); if (file) { result.hasArticle = true; result.articlePath = file; if (!current && result.workflow !== "live") result.workflow = "publish"; } }
  const job = [...state.tasks].reverse().find((task) => task.kind === "asr");
  if (job) result.subtitleJob = { status: ["running", "queued"].includes(job.status) ? "running" : job.status === "completed" ? "done" : ["failed", "unconfirmed", "blocked"].includes(job.status) ? "error" : "idle", startedAt: job.createdAt, ...(job.error ? { error: job.error } : {}) };
  return result;
}
