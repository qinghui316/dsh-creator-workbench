import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyPublish, pickAutoPublishName, publishFromAutoPublish } from "./publishRules.ts";
import type { ContentPublish } from "./types.ts";
export * from "./publishRules.ts";

export async function readFolderPublish(
  folderPath: string,
  names?: readonly string[],
): Promise<ContentPublish> {
  const list = names ?? await readdir(folderPath).catch(() => []);
  const name = pickAutoPublishName(list);
  if (name === undefined) return emptyPublish();
  try {
    const value = JSON.parse(await readFile(join(folderPath, name), "utf8")) as unknown;
    return publishFromAutoPublish(value);
  } catch {
    return emptyPublish();
  }
}
