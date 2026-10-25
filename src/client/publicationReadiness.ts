import type { PublicationInput } from "../production/types.ts";

export type UploadPrerequisite = { field:"title"|"body"|"video"|"images"|"cover"|"account"|"rights"|"conflict"; label:string };
/** The button and explanation share the existing UI guards. */
export function uploadPrerequisites(input:PublicationInput,accountId:string|undefined,rights:boolean,conflict:boolean):UploadPrerequisite[] {
  const missing:UploadPrerequisite[]=[];
  if(!accountId)missing.push({field:"account",label:"连接发布账号"});
  if(!input.title.trim())missing.push({field:"title",label:"填写标题"});
  if(input.type==="video"&&!input.video)missing.push({field:"video",label:"选择视频"});
  if(input.type==="images"&&!input.imageIds.length)missing.push({field:"images",label:"选择图片"});
  if(input.type==="article"&&!input.body.trim())missing.push({field:"body",label:"填写正文"});
  if(input.platform==="official-account"&&!input.coverImageId)missing.push({field:"cover",label:"选择文章封面"});
  if(!rights)missing.push({field:"rights",label:"确认素材发布授权"});
  if(conflict)missing.push({field:"conflict",label:"处理材料版本冲突"});
  return missing;
}
