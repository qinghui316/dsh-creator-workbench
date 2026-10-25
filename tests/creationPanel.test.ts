// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreationPanel } from "../src/client/CreationPanel.tsx";
import { PublicationPanel } from "../src/client/PublicationPanel.tsx";
import type { ContentDetail } from "../src/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
import { emptyProduction, type ProductionAction, type ProductionState, type PublicationInput } from "../src/production/types.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
afterEach(cleanup);let sequence=0;
function fixture(){
 const detail={id:"episode",folderPath:`E:/UI-${++sequence}`,title:"独立文章项目",tags:[],covers:{},publish:{},videos:[]} as unknown as ContentDetail;
 const input:PublicationInput={platform:"xiaohongshu",type:"images",title:"小红书标题",body:"保留的正文",tags:[],imageIds:[]};
 const state:ProductionState={...emptyProduction(),publications:[{...input,id:"first",bodyFile:"first.md",revision:1,createdAt:1,updatedAt:1},{...input,id:"second",platform:"douyin",title:"抖音标题",bodyFile:"second.md",revision:1,createdAt:2,updatedAt:2}]};
 const action=vi.fn(async(a:ProductionAction)=>{if(a.action!=="save-publication")return state;const old=state.publications?.find(p=>p.id===a.publicationId),id=old?.id??`new-${a.saveId}`,revision=(old?.revision??0)+1;const row={...a.input,id,bodyFile:`${id}-${revision}.md`,revision,createdAt:1,updatedAt:revision};state.publications=[...(state.publications??[]).filter(p=>p.id!==id),row];return{...state,savedPublication:{id,revision}};}),prepareRequest=vi.fn(async()=>undefined);
 const api={settings:vi.fn(async()=>({revision:"r",accounts:{xiaohongshu:{id:"A",name:"小红书账号"},douyin:{id:"B",name:"抖音账号"}},accountHistory:[],observations:{},wechat:{appid:"",theme:"claude-editorial",author:""},wechatConfigured:false})),state:async()=>state,publication:vi.fn(async(request)=>structuredClone(state.publications!.find(p=>p.id===request.publicationId)!)),action,prepareRequest} as unknown as ProductionClient;
 const mount=()=>render(h(CreationPanel,{detail,api,enabledPlatforms:["xiaohongshu","douyin"]}));
 return{detail,api,action,prepareRequest,state,mount};
}
const platform=(name:string)=>fireEvent.click(within(screen.getByRole("navigation",{name:"发布平台"})).getByText(name).closest("button")!);
describe("continuous platform-owned publication editing",()=>{
 for(const target of ["小红书","抖音"])it(`reuses HTML as readable text for ${target}, keeping its source intact`,async()=>{
  const f=fixture(),html='<html><head><style>.x{color:red}</style><script>bad()</script></head><body><h1>标题</h1><p>A &amp; B</p><p>第二段&#33;</p><img src="one.png"></body></html>';
  f.state.articles.push({id:"html",file:"source.html",title:"HTML文章",format:"html",createdAt:1,frameFiles:[]});f.api.articleSource=vi.fn(async()=>({article:f.state.articles[0]!,source:html,sourceHash:"original"}));f.mount();await screen.findByLabelText("正文");if(target==="抖音"){platform(target);await waitFor(()=>expect((screen.getByLabelText("标题")as HTMLInputElement).value).toBe("抖音标题"));}
  fireEvent.change(screen.getByLabelText("复用文章内容"),{target:{value:"html"}});await waitFor(()=>expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toContain("A & B\n\n第二段!"));expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).not.toMatch(/<\/?(?:html|h1|p|img)|bad\(\)|color:red/);expect((await f.api.articleSource!({...f.detail,articleId:"html"})).source).toBe(html);
 });
 it("copies official-account HTML to a separate plain-text material without changing the original",async()=>{
  const f=fixture(),body='<h1>公众号文章</h1><p>第一段 &amp; 第二段</p><p>可读正文</p>';
  f.state.publications!.push({...f.state.publications![0]!,id:"official",platform:"official-account",type:"article",body,title:"公众号HTML"});f.api.preview=vi.fn(async()=>({html:body,path:"preview.html"}));f.mount();await screen.findByLabelText("正文");platform("公众号");await waitFor(()=>expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe(body));
  fireEvent.click(screen.getByRole("button",{name:"材料操作"}));fireEvent.click(screen.getByRole("menuitem",{name:"复制到其他平台"}));fireEvent.change(screen.getByLabelText("复制到"),{target:{value:"xiaohongshu"}});fireEvent.click(screen.getByRole("button",{name:"创建副本"}));await waitFor(()=>expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toContain("第一段 & 第二段"));expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).not.toContain("<p>");expect(f.state.publications!.find(p=>p.id==="official")!.body).toBe(body);
 });
 it("flushes autosave before explicit upload and does not borrow another material's upload notice",async()=>{
  const f=fixture();f.state.images=[{id:"image",file:"one.png",mime:"image/png",width:300,height:400,sha256:"hash",source:"imported",purpose:"card",createdAt:1}];f.state.publications![0]!.imageIds=["image"];f.api.image=vi.fn(async()=>({mime:"image/png",base64:"YWJj"}));
  const original=f.action.getMockImplementation()!;f.action.mockImplementation(async a=>{if(a.action==="upload-publication"){f.state.tasks.push({id:"task-A",kind:"upload",status:"blocked",publicationId:"first",platform:"xiaohongshu",account:{id:"A",name:"A",platform:"xiaohongshu",checkedAt:1},contentId:f.detail.id,folderPath:f.detail.folderPath,createdAt:1,updatedAt:1});return{...f.state,uploadNotice:{taskId:"task-A",message:"已有上传待核对",canCreateNew:false}};}return original(a);});
  f.mount();fireEvent.change(await screen.findByLabelText("正文"),{target:{value:"上传前的新正文"}});fireEvent.click(screen.getByLabelText("确认本次素材拥有发布授权"));fireEvent.click(screen.getByRole("button",{name:"上传并准备草稿"}));await screen.findByText("已有上传待核对");
  expect(f.action.mock.calls.slice(0,2).map(c=>c[0].action)).toEqual(["save-publication","upload-publication"]);expect(f.action.mock.calls[1]![0]).toMatchObject({publicationId:"first",expectedRevision:2,expectedAccountId:"A"});
  platform("抖音");await waitFor(()=>expect((screen.getByLabelText("标题")as HTMLInputElement).value).toBe("抖音标题"));expect(screen.queryByText("已有上传待核对")).toBeNull();expect(screen.queryByRole("button",{name:"继续原任务"})).toBeNull();
  platform("小红书");await screen.findByRole("button",{name:"检查原任务"});fireEvent.click(screen.getByRole("button",{name:"检查原任务"}));await waitFor(()=>expect(f.action).toHaveBeenLastCalledWith(expect.objectContaining({action:"inspect-upload",taskId:"task-A"})));
 });
 it("switches directly to an overview target while retaining another platform's dirty draft",async()=>{
  const f=fixture();f.mount();fireEvent.change(await screen.findByLabelText("正文"),{target:{value:"必须保留的正文"}});cleanup();
  render(h(PublicationPanel,{detail:f.detail,api:f.api,enabledPlatforms:["xiaohongshu","douyin"],initialPublicationId:"second"}));
  await waitFor(()=>expect((screen.getByLabelText("标题")as HTMLInputElement).value).toBe("抖音标题"));platform("小红书");await waitFor(()=>expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("必须保留的正文"));
  expect(screen.queryByText("当前修改尚未保存")).toBeNull();
 });
 it("retries interrupted recovery without clearing platform navigation",async()=>{
  const f=fixture(),reconcile=vi.fn().mockRejectedValueOnce(new Error("恢复断连")).mockResolvedValue(undefined);f.api.reconcile=reconcile;f.mount();await screen.findAllByText("恢复断连");
  expect(within(screen.getByRole("navigation",{name:"发布平台"})).getByText("公众号")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"重新读取内容"}));await waitFor(()=>expect(reconcile).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.queryAllByText("恢复断连")).toHaveLength(0));
 });
 it("preserves typing in A when a pending selection finishes loading B",async()=>{
  const f=fixture();f.state.publications!.push({...f.state.publications![0]!,id:"third",title:"另一份小红书",body:"B正文"});f.mount();await screen.findByLabelText("正文");
  let finish!:(p:NonNullable<ProductionState["publications"]>[number])=>void;vi.mocked(f.api.publication!).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  fireEvent.change(screen.getByLabelText("选择发布内容"),{target:{value:"third"}});fireEvent.change(screen.getByLabelText("正文"),{target:{value:"切换期间编辑A"}});
  await act(async()=>finish(f.state.publications!.find(p=>p.id==="third")!));await waitFor(()=>expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("B正文"));
  fireEvent.change(screen.getByLabelText("选择发布内容"),{target:{value:"first"}});await waitFor(()=>expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("切换期间编辑A"));
 });
 it("adopts acknowledged rebased text only when no later typing exists",async()=>{
  const f=fixture();f.mount();await screen.findByLabelText("正文");f.action.mockImplementationOnce(async()=>{const p=f.state.publications!.find(p=>p.id==="first")!;p.body="![配图](../../images/one.png)";p.revision=2;return{...f.state,savedPublication:{id:p.id,revision:2}};});
  fireEvent.change(screen.getByLabelText("正文"),{target:{value:"![配图](one.png)"}});await waitFor(()=>expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("![配图](../../images/one.png)"));
 });
 it("automatically saves later typing with the acknowledged next revision",async()=>{
  const f=fixture();f.mount();await screen.findByLabelText("正文");let finish!:(s:ProductionState)=>void;f.action.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  fireEvent.change(screen.getByLabelText("正文"),{target:{value:"保存版本A"}});await waitFor(()=>expect(f.action).toHaveBeenCalledTimes(1));fireEvent.change(screen.getByLabelText("正文"),{target:{value:"继续输入B"}});
  await act(async()=>finish({...f.state,savedPublication:{id:"first",revision:2}}));await waitFor(()=>expect(f.action).toHaveBeenLastCalledWith(expect.objectContaining({publicationId:"first",expectedRevision:2,input:expect.objectContaining({body:"继续输入B"})})));
  expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("继续输入B");
 });
 it("does not navigate back when an earlier autosave completes in another platform",async()=>{
  const f=fixture();f.mount();await screen.findByLabelText("正文");let finish!:(s:ProductionState)=>void;f.action.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));fireEvent.change(screen.getByLabelText("正文"),{target:{value:"旧平台保存"}});await waitFor(()=>expect(f.action).toHaveBeenCalledTimes(1));platform("抖音");await waitFor(()=>expect((screen.getByLabelText("标题")as HTMLInputElement).value).toBe("抖音标题"));
  await act(async()=>finish({...f.state,savedPublication:{id:"first",revision:2}}));expect((screen.getByLabelText("标题")as HTMLInputElement).value).toBe("抖音标题");
 });
 it("ignores older article reads and preserves manual edits during reuse",async()=>{
  const f=fixture();f.state.articles.push(...["a","b"].map(id=>({id,file:`${id}.md`,title:id,createdAt:1,frameFiles:[]})));const reads=new Map<string,(value:unknown)=>void>();f.api.articleSource=vi.fn(request=>new Promise(resolve=>reads.set(request.articleId,resolve))) as NonNullable<ProductionClient["articleSource"]>;f.mount();await screen.findByLabelText("正文");
  fireEvent.change(screen.getByLabelText("复用文章内容"),{target:{value:"a"}});fireEvent.change(screen.getByLabelText("复用文章内容"),{target:{value:"b"}});
  const source=(id:string)=>({article:f.state.articles.find(a=>a.id===id),source:`文章${id}`,sourceHash:id});await act(async()=>reads.get("b")!(source("b")));await act(async()=>reads.get("a")!(source("a")));expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("文章b");
  fireEvent.change(screen.getByLabelText("复用文章内容"),{target:{value:"a"}});fireEvent.change(screen.getByLabelText("正文"),{target:{value:"人工编辑"}});await act(async()=>reads.get("a")!(source("a")));expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("人工编辑");
 });
 it("offers native image creation without a video",async()=>{const f=fixture();f.mount();fireEvent.click(screen.getByRole("button",{name:"让 Agent 制作图片"}));await waitFor(()=>expect(f.prepareRequest).toHaveBeenCalledWith(f.detail,expect.stringContaining("配图或封面"),false));});
 it("explains missing upload inputs and focuses the corresponding editor without starting an upload",async()=>{
  const f=fixture();f.mount();await screen.findByLabelText("标题");fireEvent.change(screen.getByLabelText("标题"),{target:{value:""}});fireEvent.click(screen.getByRole("button",{name:"填写标题"}));expect(document.activeElement).toBe(screen.getByLabelText("标题"));fireEvent.change(screen.getByLabelText("标题"),{target:{value:"补齐标题"}});expect(screen.queryByRole("button",{name:"填写标题"})).toBeNull();expect(screen.getByRole("button",{name:"上传并准备草稿"}).getAttribute("aria-describedby")).toBeTruthy();expect(f.action.mock.calls.some(([a])=>a.action==="upload-publication")).toBe(false);
 });
 it("keeps the official account entry visible during missing settings and failures",async()=>{const f=fixture();vi.mocked(f.api.settings).mockRejectedValue(new Error("设置读取失败"));f.mount();platform("公众号");await screen.findByText("账号信息读取失败");fireEvent.click(screen.getByRole("button",{name:"材料操作"}));expect(screen.getByRole("menuitem",{name:"新建文章材料"})).toBeTruthy();expect(screen.getByRole("button",{name:"账号设置"})).toBeTruthy();platform("抖音");platform("公众号");expect(within(screen.getByRole("navigation",{name:"发布平台"})).getByText("公众号")).toBeTruthy();});
 it("retains edits after a CAS conflict and does not replace them with a read refresh",async()=>{const f=fixture();f.mount();await screen.findByLabelText("正文");f.action.mockRejectedValueOnce(new Error("发布内容已被修改，输入已保留"));fireEvent.change(screen.getByLabelText("正文"),{target:{value:"需要保留的修改"}});await screen.findByText("发布内容已被修改，输入已保留");expect((screen.getByLabelText("正文")as HTMLTextAreaElement).value).toBe("需要保留的修改");expect(f.action).toHaveBeenCalledWith(expect.objectContaining({saveId:expect.any(String),publicationId:"first",expectedRevision:1,input:expect.objectContaining({body:"需要保留的修改"})}));});
 it("requires explicit authorization and a saved snapshot to upload, with no final-post action",async()=>{const f=fixture();f.mount();await screen.findByLabelText("正文");expect((screen.getByRole("button",{name:"上传并准备草稿"})as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole("button",{name:/立即发表|确认发表|直接发表/})).toBeNull();expect(screen.queryByRole("button",{name:"保存材料"})).toBeNull();});
});
