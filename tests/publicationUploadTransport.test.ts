import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,relative} from "node:path";
import {describe,it,expect,vi} from "vitest";
import {atomic,owned,readState,updateState,updateSettings} from "../src/production/storage.ts";
import {executePublicationUpload} from "../src/production/publicationUpload.ts";
import type {PublicationSnapshot} from "../src/production/publicationUpload.ts";
import type {ProductionTask,PublicationDraft} from "../src/production/types.ts";
const worker=vi.hoisted(()=>vi.fn());
vi.mock("../src/production/process.ts",()=>({runProcess:worker}));
vi.mock("../src/production/browser.ts",()=>({BrowserControlError:class extends Error{},requireAccount:vi.fn(),withBrowser:async(_dir:unknown,_signal:AbortSignal,work:(s:AbortSignal)=>Promise<unknown>)=>work(_signal)}));
vi.mock("../src/production/runtime.ts",()=>({browserExecutable:async()=>"ego-browser.exe",resource:async()=>"C:/creator/scripts/graphic-publisher.mjs"}));
describe("native Ego upload transport",()=>{
 it("reads stderr results from piped nodejs and completes the same inspected task",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"creator-ego-output-")),dataDir=join(folder,"settings"),id=crypto.randomUUID(),dir=await owned(folder,id);
  const publication:PublicationDraft={id:"material",platform:"xiaohongshu",type:"images",title:"验收",bodyFile:"body.md",tags:[],imageIds:[],revision:1,createdAt:1,updatedAt:1};
  const snapshot:PublicationSnapshot={publication,body:"正文",accountId:"one",images:[],sourceKey:"fixed"},packageFile=relative(folder,join(dir,"publication-snapshot.json"));await atomic(join(folder,packageFile),snapshot);
  const task:ProductionTask={id,kind:"upload",status:"running",contentId:"episode",folderPath:folder,createdAt:1,updatedAt:1,publicationId:publication.id,publicationRevision:1,publicationType:"images",platform:"xiaohongshu",packageFile};
  await updateState(folder,s=>{s.tasks.push(task);});await updateSettings(dataDir,s=>{s.accounts.xiaohongshu={id:"one",name:"测试账号",platform:"xiaohongshu",checkedAt:1};});
  worker.mockResolvedValue({code:0,stdout:"",stderr:'CREATOR_GRAPH:{"ready":true,"savedDraft":false,"receipt":"graphic-receipt.json","userControl":false}\r\n'});
  await executePublicationUpload(folder,task,"inspect",new AbortController().signal,{dataDir,key:async()=>undefined,changed:vi.fn(),platforms:async()=>["xiaohongshu"],resolve:async()=>undefined,reserve:vi.fn()});
  const state=await readState(folder);expect(state.tasks).toHaveLength(1);expect(state.tasks[0]!.id).toBe(id);expect(state.tasks[0]!.status).toBe("ready");expect(state.records?.[0]?.state).toBe("uploaded");
 });
});
