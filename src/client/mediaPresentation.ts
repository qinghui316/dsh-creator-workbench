import type { CreationImage } from "../production/types.ts";

/** Factual image identity, shared by the gallery, overview and publication picker. */
export function imageName(image: Pick<CreationImage, "file">): string {
  return image.file.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "项目图片";
}
