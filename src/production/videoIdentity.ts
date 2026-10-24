import { sameMedia, type MediaIdentity } from "./types.ts";
export { mediaIdentity } from "./storage.ts";
export function sameMediaIdentityError(expected: MediaIdentity, actual: MediaIdentity): void { if (!sameMedia(expected, actual)) throw new Error("视频已被替换，请重新准备本次操作。"); }
