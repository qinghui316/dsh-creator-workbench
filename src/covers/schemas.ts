import { z } from "zod";
export const coverRatioSchema = z.enum(["3x4", "4x3", "16x9"]);
export const coverScopeSchema = z.object({ id: z.string().min(1), folderPath: z.string().min(1) });
const slot = z.object({ status: z.enum(["pending", "running", "completed", "failed", "cancelled", "unconfirmed"]), versionId: z.string(), prompt: z.string(), error: z.string().optional() });
export const imageSettingsSchema = z.object({ apiBase: z.string(), model: z.string(), revision: z.string(), checked: z.object({ revision: z.string(), connection: z.string(), generation: z.string(), edit: z.string() }).optional() });
export const coverVersionSchema = z.object({ id: z.string(), ratio: coverRatioSchema, file: z.string(), mime: z.string(), width: z.number(), height: z.number(), source: z.enum(["import", "generated", "legacy"]), createdAt: z.number(), video: z.string().optional(), runId: z.string().optional(), review: z.enum(["pending", "pass", "needs_changes"]), reviewNote: z.string().optional() });
export const coverRunSchema = z.object({
  purpose: z.enum(["cover", "service_test"]).optional(),
  id: z.string(), contentId: z.string(), folderPath: z.string(), createdAt: z.number(), updatedAt: z.number(),
  video: z.object({ name: z.string(), size: z.number(), modifiedAt: z.number() }), ratios: z.array(coverRatioSchema),
  status: z.enum(["waiting_agent", "preparing", "running", "partial", "completed", "failed", "cancelled", "unconfirmed"]),
  frames: z.array(z.object({ id: z.string(), file: z.string(), at: z.number() })),
  analysis: z.string().optional(), headline: z.string().optional(), frameIds: z.array(z.string()).optional(), mode: z.enum(["reference", "text"]).optional(),
  provider: imageSettingsSchema.omit({ checked: true }).optional(), slots: z.object({ "3x4": slot.optional(), "4x3": slot.optional(), "16x9": slot.optional() }), jobId: z.string().optional(), error: z.string().optional(),
});
export const coverStateSchema = z.object({ versions: z.array(coverVersionSchema), selected: z.object({ "3x4": z.string().optional(), "4x3": z.string().optional(), "16x9": z.string().optional() }), runs: z.array(coverRunSchema) });
export const coverActionSchema = z.discriminatedUnion("action", [
  coverScopeSchema.extend({ action: z.literal("test"), video: z.string().min(1) }),
  coverScopeSchema.extend({ action: z.literal("create"), video: z.string().min(1), ratios: z.array(coverRatioSchema).min(1).max(3) }),
  coverScopeSchema.extend({ action: z.literal("import"), sourcePath: z.string().min(1), ratio: coverRatioSchema }),
  coverScopeSchema.extend({ action: z.literal("select"), versionId: z.string().min(1) }),
  coverScopeSchema.extend({ action: z.literal("cancel"), runId: z.string().uuid() }),
  coverScopeSchema.extend({ action: z.literal("retry"), runId: z.string().uuid(), ratios: z.array(coverRatioSchema).min(1).max(3), acknowledgeUnknown: z.boolean().optional() }),
  coverScopeSchema.extend({ action: z.literal("review"), versionId: z.string(), verdict: z.enum(["pass", "needs_changes"]), note: z.string().min(1), select: z.boolean().optional() }),
]);
