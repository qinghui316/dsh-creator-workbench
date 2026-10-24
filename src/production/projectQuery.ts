import { productionView, coverView } from "../projectView.ts";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContentDetail, ContentSummary } from "../types.ts";
import type { ProjectView } from "../projectView.ts";
import { readCoverState } from "../covers/files.ts";
import { emptySecrets } from "../secrets.ts";
import { readState, inside } from "./storage.ts";

const excerptsByFile = new Map<string, { modifiedAt: number; size: number; text: string }>();
async function excerpt(folder: string, path: string, limit = 240): Promise<string> {
  const actual = await inside(folder, path), file = await open(actual, "r");
  try {
    const info = await file.stat(), cached = excerptsByFile.get(actual);
    if (cached?.modifiedAt === info.mtimeMs && cached.size === info.size) return cached.text.slice(0, limit);
    const buffer = Buffer.alloc(8192), result = await file.read(buffer, 0, buffer.length, 0);
    const text = new TextDecoder().decode(buffer.subarray(0, result.bytesRead), {stream:true})
      .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, " ").replace(/<[^>]*>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/^\s*(?:#{1,6}\s+|\d+\s*$|[\d:,]+\s*-->[^\n]*)/gm, "")
      .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_,name:string)=>({nbsp:" ",amp:"&",lt:"<",gt:">",quot:'"',"#39":"'"}[name]??" ")).replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 240);
    excerptsByFile.set(actual, { modifiedAt:info.mtimeMs,size:info.size,text });
    if (excerptsByFile.size > 100) excerptsByFile.delete(excerptsByFile.keys().next().value!);
    return text.slice(0, limit);
  } finally { await file.close(); }
}

export async function queryProject(item: ContentSummary, readCovers = () => readCoverState(item.folderPath)): Promise<ProjectView> {
  const production = await readState(item.folderPath), covers = await readCovers();
  // Never hydrate platform bodies or reconcile tasks on a read path.
  production.publications = production.publications?.map(({ body: _body, bodyError: _error, ...p }) => ({...p, ...(p.source?.articleId && production.articles.some(a=>a.parentArticleId===p.source!.articleId) ? {sourceChanged:true} : {})})) ?? [];
  let script = { exists: false, excerpt: "" };
  try {
    const text = await excerpt(item.folderPath, "script.md"); script = {exists:Boolean(text),excerpt:text};
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const excerpts: NonNullable<ProjectView["excerpts"]> = {};
  const article = production.articles.at(-1), video=item.videos?.find(v=>v.name===item.selectedVideo);
  const transcript=[...production.transcripts].reverse().find(t=>video&&t.video.name===video.name&&t.video.size===video.size&&t.video.modifiedAt===video.modifiedAt);
  // These bounded previews never hydrate full articles/platform bodies or expose image bytes.
  if (article || item.articlePath) { try { excerpts.article = {id:article?.id ?? "legacy",text:await excerpt(item.folderPath,article?.file ?? item.articlePath!)}; } catch { /* The detail page reports the resource error. */ } }
  const legacySubtitle=item.subtitles?.srt??item.subtitles?.transcript;
  const isKnownOldSubtitle=legacySubtitle&&production.transcripts.some(t=>[t.srtFile,t.textFile].some(file=>resolve(item.folderPath,file).toLowerCase()===resolve(item.folderPath,legacySubtitle).toLowerCase()));
  const subtitleFile = transcript?.srtFile ?? (!isKnownOldSubtitle?legacySubtitle:undefined);
  if (subtitleFile) { try { excerpts.subtitle = {file:subtitleFile,source:transcript ? `${transcript.source === "volcano" ? "火山转写" : "导入字幕"} · ${transcript.video.name}` : "已有字幕",text:await excerpt(item.folderPath,subtitleFile)}; } catch { /* Missing summaries do not conceal other assets. */ } }
  const detail: ContentDetail = { ...item, script: "", article: "", topicNote: "", publishCopy: "", secrets: emptySecrets() };
  return { detail, production: productionView(production), covers: coverView(covers), script, excerpts };
}
