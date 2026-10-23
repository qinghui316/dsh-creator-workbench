import type { VideoCandidate, VideoSelectionState } from "./types.ts";

/** Filenames, never arbitrary paths. Shared by the scanner and import boundary. */
export function validVideoName(name: string): boolean {
  return name !== "." && name !== ".." && !/[\\/:*?"<>|\x00-\x1f]/.test(name)
    && !/[. ]$/.test(name) && !name.startsWith(".")
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    && /\.(?:mp4|mov)$/i.test(name);
}

export function resolveVideoSelection(candidates: readonly VideoCandidate[], saved?: string | null): {
  videoSelection: VideoSelectionState;
  selectedVideo?: string;
} {
  if (saved === null) return { videoSelection: "cleared" };
  if (saved !== undefined) {
    return candidates.some((video) => video.name === saved)
      ? { videoSelection: "selected", selectedVideo: saved }
      : { videoSelection: "missing" };
  }
  if (candidates.length === 1) return { videoSelection: "selected", selectedVideo: candidates[0]!.name };
  return { videoSelection: candidates.length === 0 ? "empty" : "choose" };
}

export function currentVideoPath(item: { videos?: VideoCandidate[]; selectedVideo?: string }): string | undefined {
  return item.videos?.find((video) => video.name === item.selectedVideo)?.path;
}

/** Windows names identify the same on-disk file regardless of case. */
export function sameVideoName(a: string, b: string, windows = true): boolean {
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}
