import { coverScopeSchema, coverActionSchema, coverStateSchema, imageSettingsSchema } from "./covers/schemas.ts";
import type { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { scopeSchema, productionActionSchema, productionSettingsActionSchema, productionSettingsSchema, productionStateSchema } from "./production/schemas.ts";

import {
  selectVideoRequestSchema,
  videoImportRequestSchema,
  videoImportTokenSchema,
  videoImportStateSchema,
  capabilitiesResultSchema,
  contentDetailSchema,
  coverThumbResultSchema,
  idRequestSchema,
  librarySettingsSchema,
  listContentsRequestSchema,
  listContentsResultSchema,
  setLibraryRootRequestSchema,
  createContentRequestSchema,
  createContentResultSchema,
  setProfileRequestSchema,
  setScriptRulesRequestSchema,
  setPublishRequestSchema,
  setScriptRequestSchema,
  subtitlePreviewResultSchema,
  subtitleTextResultSchema,
  revisionResultSchema,
  syncPublishRequestSchema,
  syncPublishResultSchema,
  videoPlaybackResultSchema,
  articleMediaResultSchema,
} from "./schemas.ts";

export const PACKAGE_NAME = "dsh-creator-workbench";
export const REMOTE_NAMESPACE = "creatorWorkbench";

const emptyObjectSchema = z.object({});

function codec(typeSymbol: string, schema: z.ZodType<unknown>) {
  return { mode: "strict" as const, typeSymbol, create: () => schema };
}

function jsonParam(
  name: string,
  typeSymbol: string,
  schema: z.ZodType<unknown>,
): InvocationDescriptor["parameters"][number] {
  return {
    name,
    wire: name,
    source: "json",
    codec: codec(typeSymbol, schema),
  };
}

function invocation(
  method: string,
  request: z.ZodType<unknown>,
  result: z.ZodType<unknown>,
): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${method}`,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters: [jsonParam("request", `${PACKAGE_NAME}#${method}Request`, request)],
    cancellation: { parameter: "signal" },
    result: codec(`${PACKAGE_NAME}#${method}Result`, result),
    sourceLocation: { file: "src/service.ts", line: 1, column: 1 },
  };
}

export const CREATOR_WORKBENCH_INVOCATIONS: readonly InvocationDescriptor[] = [
  invocation("getProductionSettings", emptyObjectSchema, productionSettingsSchema),
  invocation("productionSettingsAction", productionSettingsActionSchema, productionSettingsSchema),
  invocation("getProductionState", scopeSchema, productionStateSchema),
  invocation("getCreationImage", scopeSchema.extend({ imageId: z.string() }), z.object({ mime: z.string(), base64: z.string() })),
  invocation("getCreationText", scopeSchema.extend({ file: z.string() }), z.object({ text: z.string() })),
  invocation("productionAction", productionActionSchema, productionStateSchema),
  invocation("getProductionPreview", scopeSchema.extend({ taskId: z.string().uuid().optional(), articleFile: z.string().optional() }), z.object({ html: z.string(), path: z.string() })),
  invocation("setVideoVisibility", z.object({ id: z.string().min(1), folderPath: z.string().min(1), name: z.string().min(1), hidden: z.boolean() }), contentDetailSchema),
  invocation("setContentVisibility", z.object({ id: z.string().min(1), folderPath: z.string().min(1), hidden: z.boolean() }), listContentsResultSchema),
  invocation("projectAction", z.object({ id: z.string().min(1), folderPath: z.string().min(1), action: z.enum(["inspect", "remove", "join"]), cancelTasks: z.boolean().optional() }), z.object({ tasks: z.array(z.string()), removed: z.boolean() })),
  invocation("restoreProjectSession", z.object({ id: z.string().min(1), folderPath: z.string().min(1), sessionId: z.string().min(1) }), emptyObjectSchema),
  invocation("getCoverState", coverScopeSchema, coverStateSchema),
  invocation("coverAction", coverActionSchema, coverStateSchema),
  invocation("getCoverImage", coverScopeSchema.extend({ versionId: z.string() }), z.object({ mime: z.string(), base64: z.string() })),
  invocation("getImageSettings", emptyObjectSchema, imageSettingsSchema),
  invocation("setImageSettings", z.object({ apiBase: z.string(), model: z.string() }), imageSettingsSchema),
  invocation("beginImageUpdate", z.object({ apiBase: z.string(), model: z.string(), revision: z.string(), hasNewKey: z.boolean() }), imageSettingsSchema),
  invocation("completeImageUpdate", z.object({ token: z.string(), keyUpdated: z.boolean() }), imageSettingsSchema),
  invocation("checkImageService", emptyObjectSchema, imageSettingsSchema),
  invocation("selectVideo", selectVideoRequestSchema, contentDetailSchema),
  invocation("startVideoImport", videoImportRequestSchema, videoImportStateSchema),
  invocation("getVideoImport", videoImportTokenSchema, videoImportStateSchema),
  invocation("cancelVideoImport", videoImportTokenSchema, videoImportStateSchema),
  invocation("listContents", listContentsRequestSchema, listContentsResultSchema),
  invocation("getContent", idRequestSchema, contentDetailSchema),
  invocation("getCoverThumb", idRequestSchema, coverThumbResultSchema),
  invocation("getVideoPlayback", idRequestSchema, videoPlaybackResultSchema),
  invocation("getArticleMedia", idRequestSchema, articleMediaResultSchema),
  invocation("getSubtitleText", idRequestSchema, subtitleTextResultSchema),
  invocation("openContentPath", z.object({ path: z.string().min(1) }), emptyObjectSchema),
  invocation("getSettings", emptyObjectSchema, librarySettingsSchema),
  invocation("getCapabilities", emptyObjectSchema, capabilitiesResultSchema),
  invocation("getRevision", emptyObjectSchema, revisionResultSchema),
  invocation("setLibraryRoot", setLibraryRootRequestSchema, librarySettingsSchema),
  invocation("refreshCatalog", emptyObjectSchema, listContentsResultSchema),
  invocation("createContent", createContentRequestSchema, createContentResultSchema),
  invocation("setProfile", setProfileRequestSchema, librarySettingsSchema),
  invocation("setScriptRules", setScriptRulesRequestSchema, librarySettingsSchema),
  invocation("setPublish", setPublishRequestSchema, contentDetailSchema),
  invocation("syncPublish", syncPublishRequestSchema, syncPublishResultSchema),
  invocation("setScript", setScriptRequestSchema, contentDetailSchema),
  invocation("openSubtitlePreview", idRequestSchema, subtitlePreviewResultSchema),
  invocation("startSubtitleBurn", idRequestSchema, contentDetailSchema),
  invocation("startSubtitleGenerate", idRequestSchema, contentDetailSchema),
  invocation("startCoverGenerate", idRequestSchema, contentDetailSchema),
];
