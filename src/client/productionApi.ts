import type { ProjectView, ArticleSource, ArticleEdit, ArticleSave, ArticleSaved } from "../projectView.ts";
import type { ContentDetail } from "../types.ts";
import type { ContentScope, ProductionAction, ProductionSettingsAction, ProductionSettingsView, ProductionState } from "../production/types.ts";
export interface ProductionClient {
  projectView?: (scope: ContentScope) => Promise<ProjectView>;
  reconcile?: (scope: ContentScope) => Promise<unknown>;
  publication?: (scope: ContentScope & { publicationId: string; revision: number }) => Promise<import("../production/types.ts").PublicationDraft>;
  articleSource?: (scope: ContentScope & { articleId: string }) => Promise<ArticleSource>;
  articlePreview?: (request: ArticleEdit) => Promise<{ html: string; path: string }>;
  articleSave?: (request: ArticleSave) => Promise<ArticleSaved>;

  settings: () => Promise<ProductionSettingsView>;
  settingsAction: (request: ProductionSettingsAction) => Promise<ProductionSettingsView>;
  state: (scope: ContentScope) => Promise<ProductionState>;
  action: (request: ProductionAction) => Promise<ProductionState>;
  preview: (request: ContentScope & { taskId?: string; articleFile?: string }) => Promise<{ html: string; path: string }>;
  prepareArticleDraft: (detail: ContentDetail, append?: boolean) => Promise<void>;
  prepareRequest?: (detail: ContentDetail, text: string, append?: boolean) => Promise<void>;
  image?: (request: ContentScope & { imageId: string }) => Promise<{ mime: string; base64: string }>;
  text?: (request: ContentScope & { file: string }) => Promise<{ text: string }>;
}
export function localFilePath(file: File): string {
  const value = (globalThis as typeof globalThis & { __DSH_HOST_PATHS__?: { pathFor: (file: File) => string } }).__DSH_HOST_PATHS__?.pathFor(file);
  if (!value) throw new Error("请在 DSH Desktop 中选择本机文件。"); return value;
}
export async function wechatCredentialRef(appid: string): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(appid));
  return `CREATOR_WECHAT_SECRET_${Array.from(new Uint8Array(value)).map((n) => n.toString(16).padStart(2, "0")).join("").slice(0, 16).toUpperCase()}`;
}
