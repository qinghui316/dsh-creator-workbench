import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { normalizeEnabledPlatforms, PUBLISH_PLATFORMS } from "./platforms.ts";
import { decodeBurnJob, decodeOverlayPublish } from "./publishStatus.ts";
import type { CreatorProfile, OverlayItem, OverlayStore, PublishPlatform } from "./types.ts";

export { normalizeEnabledPlatforms } from "./platforms.ts";
export const DEFAULT_ENABLED_PLATFORMS: readonly PublishPlatform[] = PUBLISH_PLATFORMS;

export function emptyProfile(): CreatorProfile {
  return { enabledPlatforms: [...DEFAULT_ENABLED_PLATFORMS] };
}

export function decodeProfile(value: unknown): CreatorProfile {
  if (typeof value !== "object" || value === null) return emptyProfile();
  const raw = value as Record<string, unknown>;
  if (Array.isArray(raw.enabledPlatforms)) {
    return { enabledPlatforms: normalizeEnabledPlatforms(raw.enabledPlatforms) };
  }
  return emptyProfile();
}

export function profileIsEmpty(profile: CreatorProfile): boolean {
  return profile.enabledPlatforms.length === 0;
}

export function overlayPath(dataDir: string): string {
  return join(dataDir, "overlay.json");
}

export function emptyOverlay(): OverlayStore {
  return { schemaVersion: 1, items: {} };
}

export function decodeOverlay(value: unknown): OverlayStore {
  if (typeof value !== "object" || value === null) return emptyOverlay();
  const raw = value as Record<string, unknown>;
  const items: Record<string, OverlayItem> = {};
  if (raw.items !== null && typeof raw.items === "object") {
    for (const [id, item] of Object.entries(raw.items as Record<string, unknown>)) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const next: OverlayItem = {};
      if (typeof record.title === "string" && record.title.length > 0) {
        next.title = record.title;
      }
      const publish = decodeOverlayPublish(record.publish);
      if (publish !== undefined) next.publish = publish;
      const burn = decodeBurnJob(record.burn);
      if (burn !== undefined) next.burn = burn;
      const subtitleJob = decodeBurnJob(record.subtitleJob);
      if (subtitleJob !== undefined) next.subtitleJob = subtitleJob;
      const coverJob = decodeBurnJob(record.coverJob);
      if (coverJob !== undefined) next.coverJob = coverJob;
      items[id] = next;
    }
  }
  const store = emptyOverlay();
  store.items = items;
  if (typeof raw.videoSelections === "object" && raw.videoSelections !== null) {
    store.videoSelections = Object.fromEntries(Object.entries(raw.videoSelections).filter(([, v]) => typeof v === "object" && v !== null).map(([root, v]) => [root, Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, name]) => typeof name === "string"))])) as Record<string, Record<string, string>>;
  }
  if (typeof raw.libraryRoot === "string" && raw.libraryRoot.length > 0) {
    store.libraryRoot = raw.libraryRoot;
  }
  if (typeof raw.scriptRules === "string" && raw.scriptRules.trim() !== "") {
    store.scriptRules = raw.scriptRules.trim();
  }
  if (typeof raw.profile === "object" && raw.profile !== null) {
    store.profile = decodeProfile(raw.profile);
  }
  return store;
}

export async function loadOverlay(dataDir: string): Promise<OverlayStore> {
  try {
    const raw = await readFile(overlayPath(dataDir), "utf8");
    return decodeOverlay(JSON.parse(raw) as unknown);
  } catch {
    return emptyOverlay();
  }
}

const overlayTails = new Map<string, Promise<void>>();

export function withOverlayLock<T>(dataDir: string, work: () => Promise<T>): Promise<T> {
  const previous = overlayTails.get(dataDir) ?? Promise.resolve();
  const run = previous.then(work, work);
  overlayTails.set(dataDir, run.then(() => undefined, () => undefined));
  return run;
}

export async function saveOverlay(dataDir: string, store: OverlayStore): Promise<void> {
  const path = overlayPath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, path);
}
