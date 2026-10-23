export const IMAGE_CREDENTIAL = "DSH_CREATOR_IMAGE_API_KEY";
export const COVER_RATIOS = ["3x4", "4x3", "16x9"] as const;
export type CoverRatio = typeof COVER_RATIOS[number];
export type CoverStatus = "waiting_agent" | "preparing" | "running" | "partial" | "completed" | "failed" | "cancelled" | "unconfirmed";
export interface CoverScope { id: string; folderPath: string }
export interface ImageSettings { apiBase: string; model: string; revision: string; pending?: { token: string; apiBase: string; model: string; needsKey: boolean }; checked?: { revision: string; connection: string; generation: string; edit: string } }
export interface CoverVersion {
  id: string; ratio: CoverRatio; file: string; mime: string; width: number; height: number;
  source: "import" | "generated" | "legacy"; createdAt: number; video?: string; runId?: string;
  review: "pending" | "pass" | "needs_changes"; reviewNote?: string;
}
export interface CoverSlot {
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "unconfirmed";
  versionId: string; prompt: string; error?: string;
}
export interface CoverRun {
  purpose?: "cover" | "service_test";
  id: string; contentId: string; folderPath: string; createdAt: number; updatedAt: number;
  video: { name: string; size: number; modifiedAt: number }; ratios: CoverRatio[];
  status: CoverStatus; frames: Array<{ id: string; file: string; at: number }>;
  analysis?: string; headline?: string; frameIds?: string[]; mode?: "reference" | "text";
  provider?: Pick<ImageSettings, "apiBase" | "model" | "revision">;
  slots: Partial<Record<CoverRatio, CoverSlot>>; jobId?: string; error?: string;
}
export interface CoverState { versions: CoverVersion[]; selected: Partial<Record<CoverRatio, string>>; runs: CoverRun[] }
export interface CoverPlan { headline: string; analysis: string; frameIds: string[]; mode: "reference" | "text"; prompts: Partial<Record<CoverRatio, string>> }
export type CoverAction = CoverScope & (
  { action: "test"; video: string } |
  { action: "create"; video: string; ratios: CoverRatio[] } |
  { action: "import"; sourcePath: string; ratio: CoverRatio } |
  { action: "select"; versionId: string } |
  { action: "cancel"; runId: string } |
  { action: "retry"; runId: string; ratios: CoverRatio[]; acknowledgeUnknown?: boolean } |
  { action: "review"; versionId: string; verdict: "pass" | "needs_changes"; note: string; select?: boolean }
);

export function coverRunStatus(slots: CoverRun["slots"]): CoverStatus {
  const states = Object.values(slots).map((s) => s.status);
  if (states.includes("running") || states.includes("pending")) return "running";
  if (states.includes("unconfirmed")) return "unconfirmed";
  if (states.length && states.every((s) => s === "completed")) return "completed";
  if (states.includes("completed")) return "partial";
  return states.includes("failed") ? "failed" : "cancelled";
}

/** Review belongs to this run's exact output versions, not the current cover selection. */
export function coverRunReview(run: Pick<CoverRun, "id" | "ratios" | "slots">, versions: CoverVersion[]): CoverVersion["review"] {
  const reviews = run.ratios.map((ratio) => versions.find((version) => version.id === run.slots[ratio]?.versionId && version.runId === run.id && version.ratio === ratio)?.review);
  if (reviews.includes("needs_changes")) return "needs_changes";
  return reviews.length && reviews.every((review) => review === "pass") ? "pass" : "pending";
}
