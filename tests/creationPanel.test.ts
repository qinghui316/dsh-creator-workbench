// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreationPanel } from "../src/client/CreationPanel.tsx";
import type { ContentDetail } from "../src/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
import { emptyProduction, type ProductionAction, type PublicationInput } from "../src/production/types.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
afterEach(cleanup);let sequence=0;
function fixture(){
 const detail={id:"episode",folderPath:`E:/UI-${++sequence}`,title:"独立文章项目",tags:[],covers:{},publish:{},videos:[],selectedVideo:undefined} as unknown as ContentDetail;
 const input:PublicationInput={platform:"xiaohongshu",type:"images",title:"小红书标题",body:"保留的正文",tags:[],imageIds:[]};
 const state={...emptyProduction(),publications:[{...input,id:"first",bodyFile:"first.md",revision:1,createdAt:1,updatedAt:1},{...input,id:"second",platform:"douyin" as const,title:"抖音标题",bodyFile:"second.md",revision:1,createdAt:2,updatedAt:2}]};
 const action=vi.fn(async(_a:ProductionAction)=>state),prepareRequest=vi.fn(async()=>undefined);
 const api={state:async()=>state,action,prepareRequest} as unknown as ProductionClient;
 render(h(CreationPanel,{detail,api,enabledPlatforms:["xiaohongshu","douyin"]}));return{detail,api,action,prepareRequest,state};
}
describe("independent publishing controls",()=>{
 it("shows the server's rebased article body after saving while keeping later typing protected",async()=>{
  const f=fixture();fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));
  f.action.mockResolvedValueOnce({...f.state,publications:f.state.publications.map(p=>p.id==="first"?{...p,body:"![配图](../../images/one.png)",revision:2}:p),savedPublication:{id:"first",revision:2}} as typeof f.state);
  fireEvent.change(screen.getByLabelText("正文"),{target:{value:"![配图](one.png)"}});fireEvent.click(screen.getByRole("button",{name:"保存材料"}));
  await waitFor(()=>expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("![配图](../../images/one.png)"));
 });
 it("does not carry an earlier platform upload notice into another material",async()=>{
  const f=fixture();fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));let finish!:(s:typeof f.state)=>void;
  f.action.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(screen.getByLabelText("我确认本次内容拥有发布授权"));fireEvent.click(screen.getByRole("button",{name:"上传并准备草稿"}));
  fireEvent.click(screen.getByRole("button",{name:/抖音标题/}));
  await act(async()=>finish({...f.state,uploadNotice:{taskId:"first-upload",canCreateNew:true,message:"小红书已有上传记录"}} as typeof f.state));
  expect(screen.queryByText("小红书已有上传记录")).toBeNull();expect(screen.queryByRole("button",{name:"确认另建一份上传"})).toBeNull();
 });
 it("keeps the cover and first graphic image consistent when a person reorders or selects a cover",async()=>{
  const f=fixture();f.state.images=["a","b"].map(id=>({id,file:`${id}.png`,mime:"image/png" as const,width:240,height:320,sha256:id,purpose:"card" as const,source:"imported" as const,createdAt:1}));
  Object.assign(f.state.publications[0]!,{imageIds:["a","b"],coverImageId:"a"});
  fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));
  fireEvent.click(screen.getAllByRole("button",{name:"下移"})[0]!);
  expect((screen.getByLabelText("首图／封面") as HTMLSelectElement).value).toBe("b");
  fireEvent.change(screen.getByLabelText("首图／封面"),{target:{value:"a"}});
  fireEvent.click(screen.getByRole("button",{name:"保存材料"}));
  await waitFor(()=>expect(f.action).toHaveBeenCalledWith(expect.objectContaining({input:expect.objectContaining({imageIds:["a","b"],coverImageId:"a"})})));
 });
 it("keeps text entered after save started and uses the acknowledged server revision next time",async()=>{
  const f=fixture();fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));
  let finish!: (s: typeof f.state & {savedPublication:{id:string;revision:number}})=>void;
  f.action.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve as typeof finish;}));
  fireEvent.change(screen.getByLabelText("正文"),{target:{value:"保存版本A"}});fireEvent.click(screen.getByRole("button",{name:"保存材料"}));
  fireEvent.change(screen.getByLabelText("正文"),{target:{value:"继续输入B"}});
  await act(async()=>finish({...f.state,publications:f.state.publications.map(p=>p.id==="first"?{...p,body:"保存版本A",revision:2}:p),savedPublication:{id:"first",revision:2}}));
  await screen.findByText("已保存上一版，当前修改仍未保存。");expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("继续输入B");
  fireEvent.click(screen.getByRole("button",{name:"保存材料"}));await waitFor(()=>expect(f.action).toHaveBeenLastCalledWith(expect.objectContaining({publicationId:"first",expectedRevision:2,input:expect.objectContaining({body:"继续输入B"})})));
 });
 it("does not navigate back when an earlier save succeeds after switching materials",async()=>{
  const f=fixture();fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));let finish!: (s:typeof f.state)=>void;
  f.action.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.change(screen.getByLabelText("正文"),{target:{value:"保存版本A"}});fireEvent.click(screen.getByRole("button",{name:"保存材料"}));
  fireEvent.click(screen.getByRole("button",{name:/抖音标题/}));fireEvent.click(screen.getByRole("button",{name:"放弃修改"}));
  await act(async()=>finish({...f.state,publications:f.state.publications.map(p=>p.id==="first"?{...p,body:"保存版本A",revision:2}:p)}));
  expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("抖音标题");expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("保留的正文");
 });
 it("ignores an older article read returned after a later choice or manual edit",async()=>{
  const f=fixture();f.state.articles.push(...["a","b"].map(id=>({id,file:`${id}.md`,title:id,createdAt:1,frameFiles:[]})));
  const reads=new Map<string,(s:{text:string})=>void>();f.api.text=vi.fn((request:Parameters<NonNullable<ProductionClient["text"]>>[0])=>new Promise<{text:string}>(resolve=>{reads.set(request.file,resolve);}));
  fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));
  fireEvent.change(screen.getByLabelText("复用文章"),{target:{value:"a"}});fireEvent.change(screen.getByLabelText("复用文章"),{target:{value:"b"}});
  await act(async()=>reads.get("b.md")!({text:"文章B"}));await act(async()=>reads.get("a.md")!({text:"文章A"}));
  expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("文章B");
  fireEvent.change(screen.getByLabelText("复用文章"),{target:{value:"a"}});fireEvent.change(screen.getByLabelText("正文"),{target:{value:"人工编辑"}});
  await act(async()=>reads.get("a.md")!({text:"迟到文章A"}));expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("人工编辑");
 });
 it("offers native image creation without any video or task precondition",async()=>{
  const {prepareRequest,detail}=fixture();fireEvent.click(screen.getByRole("button",{name:"让 Agent 制作图片"}));
  await waitFor(()=>expect(prepareRequest).toHaveBeenCalledWith(detail,expect.stringContaining("配图或封面"),false));
 });
 it("preserves an edited platform draft before switching and keeps the other draft unchanged",async()=>{
  fixture();fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));
  fireEvent.change(screen.getByLabelText("正文"),{target:{value:"人工编辑未保存"}});
  fireEvent.click(screen.getByRole("button",{name:/抖音标题/}));expect(screen.getByText("当前修改尚未保存")).toBeTruthy();
  expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("人工编辑未保存");
  fireEvent.click(screen.getByRole("button",{name:"放弃修改"}));expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("保留的正文");
 });
 it("retains input on revision conflict rather than overwriting with the next poll",async()=>{
  const {action}=fixture();fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));
  action.mockRejectedValueOnce(new Error("发布内容已被修改，输入已保留"));
  fireEvent.change(screen.getByLabelText("正文"),{target:{value:"需要保留的修改"}});fireEvent.click(screen.getByRole("button",{name:"保存材料"}));
  await screen.findByText("发布内容已被修改，输入已保留");expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe("需要保留的修改");
  expect(action).toHaveBeenCalledWith(expect.objectContaining({action:"save-publication",publicationId:"first",expectedRevision:1,input:expect.objectContaining({body:"需要保留的修改"})}));
 });
 it("does not offer final publication and requires an explicit saved version and rights",async()=>{
  fixture();fireEvent.click(await screen.findByRole("button",{name:/小红书标题/}));
  expect((screen.getByRole("button",{name:"上传并准备草稿"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button",{name:/立即发表|确认发表|直接发表/})).toBeNull();
 });
});
