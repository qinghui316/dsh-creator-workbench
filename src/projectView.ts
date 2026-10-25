import type { ContentDetail } from "./types.ts";
import type { CoverState, CoverRun, CoverSlot, CoverRatio } from "./covers/types.ts";
import type { ArticleVersion, ContentScope, ProductionState, ProductionTask, ImageItem } from "./production/types.ts";

export type ProductionTaskView = Omit<ProductionTask, "imageItems"> & { imageItems?: Array<Omit<ImageItem, "prompt">> };
export type ProductionView = Omit<ProductionState, "tasks" | "publicationSaves"> & { tasks: ProductionTaskView[] };
export type CoverRunView = Omit<CoverRun, "slots"> & {slots: Partial<Record<CoverRatio, Omit<CoverSlot, "prompt"> & {prompt?: string}>>};
export type CoverView = Omit<CoverState, "runs"> & {runs: CoverRunView[]};
export function productionView(state: ProductionState): ProductionView {
  const { publicationSaves: _receipts, ...metadata } = state;
  const source = (value: import("./production/types.ts").CreationSource | undefined) => { if (!value) return {}; const {text:_text,...s}=value; return {source:s}; };
  return {...metadata, articles:state.articles.map(({source:s,...a})=>({...a,...source(s)})),
    publications:state.publications?.map(({body:_body,bodyError:_error,source:s,...p})=>({...p,...source(s)})) ?? [],
    tasks:state.tasks.map(({source:s,imageItems,...t})=>({...t,...source(s),...(imageItems ? {imageItems:imageItems.map(({prompt:_prompt,...i})=>i)} : {})}))};
}
export function coverView(state: CoverState): CoverView {
  return {...state,versions:state.versions.map(({reviewNote:_note,...v})=>v),runs:state.runs.map(({analysis:_analysis,slots,...r})=>({...r,slots:Object.fromEntries(Object.entries(slots).map(([ratio,{prompt:_prompt,...slot}])=>[ratio,slot]))}))};
}

/** Metadata only. Text, HTML and image bytes have separate, versioned reads. */
export interface ProjectView {
  detail: ContentDetail;
  production: ProductionView;
  covers: CoverView;
  settingsRevision?: string;
  accountIds?: Partial<Record<import("./production/types.ts").PublicationPlatform, string>>;
  script: { exists: boolean; excerpt: string };
  excerpts?: { article?: { id: string; text: string }; subtitle?: { file: string; text: string; source: string } };
}
export interface ArticleSource {
  article: ArticleVersion;
  source: string;
  sourceHash: string;
}
export interface ArticleEdit extends ContentScope {
  articleId: string;
  expectedSourceHash: string;
  source: string;
}
export interface ArticleSave extends ArticleEdit { saveId: string }
export interface ArticleSaved extends ArticleSource {
  preview?: { html: string; path: string };
  previewError?: string;
}
export const PROJECT_TABS = ["overview", "video", "script", "subtitle", "article", "images", "publishing"] as const;
export type ProjectTab = typeof PROJECT_TABS[number];
export function publicationLabel(state: Pick<ProductionState, "publications" | "records">, id: string, accounts?: ProjectView["accountIds"]): string {
  const draft = state.publications?.find(p => p.id === id);
  const records = state.records?.filter(r => r.publicationId === id && r.platform === draft?.platform && r.type === draft?.type && (!accounts || r.accountId === accounts[r.platform])) ?? [];
  if (!records.length && state.records?.some(r => r.publicationId === id)) return "历史作品";
  const published = records.some(r => r.state === "published");
  if (published) return records.some(r => r.state === "published" && r.revision === draft?.revision) ? "已发表" : "已发表 · 本地有修改";
  if (records.some(r => r.state === "draft")) return "平台草稿已保存";
  if (records.some(r => r.state === "uploaded")) return "已上传待发表";
  return "本地材料";
}
export function publicationMetric(state: Pick<ProductionState,"records"|"metrics">, draft: NonNullable<ProductionState["publications"]>[number], accountId?:string) {
  if(!accountId)return;
  const records=state.records?.filter(r=>r.publicationId===draft.id&&r.platform===draft.platform&&r.type===draft.type&&r.accountId===accountId&&r.state==="published")??[];
  return [...state.metrics].reverse().find(m=>m.publicationId===draft.id&&m.platform===draft.platform&&m.accountId===accountId&&m.state==="ok"&&records.some(r=>r.remoteId===m.remoteId));
}
