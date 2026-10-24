import { describe, expect, it, vi } from "vitest";
import { resolve, join } from "node:path";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const { GRAPHIC_PLATFORMS, verifyGraphicPage, runGraphicPublisher, graphicBodyWithoutTags } = await import(pathToFileURL(resolve("scripts/graphic-publisher.mjs")).href);
describe("graphic page evidence",()=>{
 it("reconciles a saved Bili draft by exact reopened content and remote identity without another save",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"creator-bili-saved-")),taskId=crypto.randomUUID(),dir=join(folder,".dsh-creator-workbench","production",taskId);await mkdir(dir,{recursive:true});
  const file=join(dir,"publication-snapshot.json");await writeFile(file,JSON.stringify({publication:{id:"material",revision:1,platform:"bilibili",title:"Title",tags:[]},body:"Body",images:[],accountId:"one"}));
  await writeFile(join(dir,"graphic-receipt.json"),JSON.stringify({taskId,spaceId:43,opened:true,uploadAttempted:true,documentImported:true,error:"save acknowledgement timed out"}));
  const page={label:"p1",evaluate:vi.fn(async(_fn:unknown,arg:{kind?:string})=>arg.kind?{selector:"textarea"}:{title:"Title",body:"Body",imageCount:0,canPublish:true,errors:[]}),url:async()=>GRAPHIC_PLATFORMS.bilibili.url+"/new-edit?aid=371499",waitForFunction:vi.fn(),snapshot:async()=>"",click:vi.fn()},task={spaceId:43,pages:async()=>[page],handOff:async()=>undefined};
  vi.stubGlobal("listTaskSpaces",async()=>[{id:43,name:`creator-graphic-${taskId}`,ownership:"agent"}]);vi.stubGlobal("taskSpace",async()=>task);const log=vi.spyOn(console,"log").mockImplementation(()=>undefined);
  try{await runGraphicPublisher({folder,taskId,operation:"inspect",snapshotFile:file});const receipt=JSON.parse(await readFile(join(dir,"graphic-receipt.json"),"utf8"));expect(receipt.ready).toBe(true);expect(receipt.savedDraft).toBe(true);expect(receipt.remoteId).toBe("371499");expect(page.click).not.toHaveBeenCalled();}
  finally{log.mockRestore();vi.unstubAllGlobals();}
 });
 it.each([false,true])("resumes a pre-browser failure but preserves missing-page protection after an attempted upload (%s)",async attempted=>{
  const folder=await mkdtemp(join(tmpdir(),"creator-graphic-early-")),taskId=crypto.randomUUID(),dir=join(folder,".dsh-creator-workbench","production",taskId);await mkdir(dir,{recursive:true});
  const file=join(dir,"publication-snapshot.json");await writeFile(file,JSON.stringify({publication:{id:"material",revision:1,platform:"bilibili",title:"Title",tags:[]},body:"Body",images:[],accountId:"one"}));
  await writeFile(join(dir,"graphic-receipt.json"),JSON.stringify({taskId,ready:false,...(attempted?{spaceId:42,opened:true,uploadAttempted:true}:{error:"local preparation failed"})}));
  const create=vi.fn(async()=>({spaceId:43,pages:async()=>[{label:"p1",goto:async()=>{throw new Error("fixture stops before remote input");}}],handOff:async()=>undefined}));
  vi.stubGlobal("listTaskSpaces",async()=>[]);vi.stubGlobal("taskSpace",create);const log=vi.spyOn(console,"log").mockImplementation(()=>undefined);
  try {await runGraphicPublisher({folder,taskId,operation:"resume",snapshotFile:file});
   expect(create).toHaveBeenCalledTimes(attempted?0:1);
   const receipt=JSON.parse(await readFile(join(dir,"graphic-receipt.json"),"utf8"));expect(receipt.taskId).toBe(taskId);expect(receipt.ready).toBe(false);
   expect(receipt.error).toContain(attempted?"原图文页面已不在":"fixture stops before remote input");
  }finally{log.mockRestore();vi.unstubAllGlobals();}
 });
 it("turns trailing topic text into one native topic without dropping inline text or accepting unrelated edits",()=>{
  expect(graphicBodyWithoutTags("保留正文 #人工智能#人工智能",["人工智能"])).toBe("保留正文");
  expect(graphicBodyWithoutTags("#人工智能 帮助整理，正文保留",["人工智能"])).toBe("#人工智能 帮助整理，正文保留");
  const expected={title:"标题",body:"保留正文\n#人工智能",tags:["人工智能"],imageCount:2};
  const actual={title:"标题",body:"保留正文 #人工智能",topics:["人工智能"],imageCount:2,canPublish:true,errors:[]};
  expect(verifyGraphicPage(actual,expected).ready).toBe(true);expect(verifyGraphicPage({...actual,body:"不同正文 #人工智能"},expected).ready).toBe(false);
 });
 it("emits the persisted inspection result before Ego ends its round at handoff",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"creator-graphic-receipt-")),taskId=crypto.randomUUID(),dir=join(folder,".dsh-creator-workbench","production",taskId);await mkdir(dir,{recursive:true});
  const file=join(dir,"publication-snapshot.json");await writeFile(file,JSON.stringify({publication:{id:"material",revision:1,platform:"xiaohongshu",title:"标题",tags:[]},body:"正文",images:[],accountId:"account"}));
  const page={label:"p1",goto:vi.fn(),waitForFunction:vi.fn(),evaluate:vi.fn(async()=>({title:"标题",body:"正文",topics:[],imageUrls:[],imageCount:0,canPublish:true,errors:[]})),url:async()=>GRAPHIC_PLATFORMS.xiaohongshu.url};
  const end=vi.fn(async()=>{throw new Error("fixture handoff ends round");}),task={spaceId:12,pages:async()=>[page],handOff:end};
  vi.stubGlobal("listTaskSpaces",async()=>[{id:12,name:`creator-graphic-${taskId}`,ownership:"agent"}]);vi.stubGlobal("taskSpace",async()=>task);
  const log=vi.spyOn(console,"log").mockImplementation(()=>undefined);
  try{await expect(runGraphicPublisher({folder,taskId,operation:"inspect",snapshotFile:file})).rejects.toThrow("ends round");
   const emitted=String(log.mock.calls[0]?.[0]);expect(emitted).toContain('CREATOR_GRAPH:');expect(JSON.parse(emitted.slice('CREATOR_GRAPH:'.length)).ready).toBe(true);
   expect(JSON.parse(await readFile(join(dir,"graphic-receipt.json"),"utf8")).ready).toBe(true);expect(log.mock.invocationCallOrder[0]).toBeLessThan(end.mock.invocationCallOrder[0]!);
  }finally{log.mockRestore();vi.unstubAllGlobals();}
 });
 const expected={title:"本期标题",body:"平台独立正文",tags:["创作"],imageCount:3};
 const actual={title:"本期标题",body:"平台独立正文\n#创作",topics:["创作"],imageCount:3,canPublish:true,errors:[]};
 it("requires title/body/image evidence rather than process exit",()=>{expect(verifyGraphicPage(actual,expected).ready).toBe(true);expect(verifyGraphicPage({...actual,imageCount:2},expected).ready).toBe(false);expect(verifyGraphicPage({...actual,errors:["上传失败"]},expected).ready).toBe(false);});
 it("preserves user-edited or wrong draft content as a blocker",()=>{expect(verifyGraphicPage({...actual,body:"用户改过正文"},expected).ready).toBe(false);expect(verifyGraphicPage({...actual,title:"其他内容"},expected).ready).toBe(false);});
 it("requires real topic entities and exact image order when evidence is available",()=>{expect(verifyGraphicPage({...actual,topics:[]},expected).ready).toBe(false);expect(verifyGraphicPage({...actual,imageHashes:["second","first"]},{...expected,imageHashes:["first","second"]}).ready).toBe(false);});
 it("keeps the three graph targets distinct and excludes Channels",()=>{expect(Object.keys(GRAPHIC_PLATFORMS)).toEqual(["xiaohongshu","douyin","bilibili"]);expect(GRAPHIC_PLATFORMS.bilibili.url).toContain("upload/text");});
});
