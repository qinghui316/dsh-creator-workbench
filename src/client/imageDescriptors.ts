import type { ContentDetail } from "../types.ts";
import type { CreationImage } from "../production/types.ts";
import type { CoverVersion } from "../covers/types.ts";
import type { ProductionClient } from "./productionApi.ts";
import type { CreatorViewFace } from "./face.ts";
import type { PreviewImage } from "./ImagePreview.tsx";
import { invalidateImageThumb, loadImageThumb } from "./ImageThumb.tsx";
import { invalidateOverviewCover, loadOverviewCover } from "./OverviewMedia.tsx";

export function creationPreviewImages(images:CreationImage[],detail:ContentDetail,api:ProductionClient,title="项目图片"):PreviewImage[] {
  return images.filter(image=>!image.hidden).map(image=>({id:image.id,title: `${title}：${image.file.replaceAll("\\", "/").split("/").at(-1)}`,revision:`${detail.folderPath}:${image.sha256}`,load:signal=>{signal.throwIfAborted();return loadImageThumb(api,detail,image);},reload:()=>invalidateImageThumb(api,detail.folderPath,image)}));
}
export function coverPreviewImages(versions:CoverVersion[],detail:ContentDetail,getCoverImage:CreatorViewFace["getCoverImage"]):PreviewImage[] {
  return versions.filter(version=>!version.hidden).map(version=>({id:version.id,title:`${version.ratio.replace("x",":")} 视频封面`,revision:`${detail.folderPath}:${version.file}`,load:signal=>{signal.throwIfAborted();return loadOverviewCover(detail,version,getCoverImage);},reload:()=>invalidateOverviewCover(detail.folderPath,version,getCoverImage)}));
}
