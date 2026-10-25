import { expect,it } from "vitest";
import { uploadPrerequisites } from "../src/client/publicationReadiness.ts";
import type { PublicationInput } from "../src/production/types.ts";
const input:PublicationInput={platform:"xiaohongshu",type:"images",title:"标题",body:"",tags:[],imageIds:["one"]};
it("does not invent video, transcript or body requirements for graphic publication",()=>{expect(uploadPrerequisites(input,"account",true,false)).toEqual([]);expect(uploadPrerequisites({...input,type:"video",video:"clip.mp4"},"account",true,false)).toEqual([]);});
it("reports the same missing inputs that disable upload, including official-account cover and conflict",()=>{
 expect(uploadPrerequisites({...input,platform:"official-account",type:"article",title:" ",body:""},undefined,false,true).map(item=>item.field)).toEqual(["account","title","body","cover","rights","conflict"]);
 expect(uploadPrerequisites({...input,imageIds:[]},"account",true,false).map(item=>item.field)).toEqual(["images"]);
 expect(uploadPrerequisites({...input,type:"video"},"account",true,false).map(item=>item.field)).toEqual(["video"]);
});
