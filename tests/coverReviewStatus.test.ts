import { describe, expect, it } from "vitest";
import { coverRunReview, type CoverRun, type CoverVersion } from "../src/covers/types.ts";

const run = {
  id: "run-a", ratios: ["3x4", "4x3", "16x9"],
  slots: {
    "3x4": { status: "completed", versionId: "portrait", prompt: "portrait" },
    "4x3": { status: "completed", versionId: "landscape", prompt: "landscape" },
    "16x9": { status: "completed", versionId: "wide", prompt: "wide" },
  },
} satisfies Pick<CoverRun, "id" | "ratios" | "slots">;
const versions = run.ratios.map((ratio) => ({
  id: run.slots[ratio].versionId, ratio, runId: run.id, review: "pass", source: "generated",
  file: "cover.png", mime: "image/png", width: 100, height: 100, createdAt: 1,
} satisfies CoverVersion));

describe("review progress for a generated cover run", () => {
  it("finishes after every exact output passes, and retains that verdict when the current cover changes", () => {
    expect(coverRunReview(run, versions)).toBe("pass");
    expect(coverRunReview(run, [...versions, { ...versions[0]!, id: "other", runId: "older-run", review: "needs_changes" }])).toBe("pass");
  });
  it("keeps a completed generation pending until all actual output versions are reviewed", () => {
    expect(coverRunReview(run, versions.slice(0, 2))).toBe("pending");
    expect(coverRunReview(run, versions.map((v) => v.ratio === "16x9" ? { ...v, review: "pending" } : v))).toBe("pending");
    expect(coverRunReview(run, versions.map((v) => ({ ...v, runId: "other-run" })))).toBe("pending");
  });
  it("reports a requested revision without marking the successful sibling outputs as failed", () => {
    expect(coverRunReview(run, versions.map((v) => v.ratio === "4x3" ? { ...v, review: "needs_changes" } : v))).toBe("needs_changes");
    expect(coverRunReview({ ...run, ratios: ["3x4"] }, versions)).toBe("pass");
  });
});
