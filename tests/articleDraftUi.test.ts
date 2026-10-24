// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ArticlePanel } from "../src/client/ArticlePanel.tsx";
import { emptyProduction } from "../src/production/types.ts";
import type { ContentDetail } from "../src/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
import type { ArticleSaved } from "../src/projectView.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
afterEach(cleanup);let seq=0;
function fixture(){
 const detail={id:"one",folderPath:`C:/draft-${++seq}`,title:"文章项目",videos:[],tags:[],covers:{}} as unknown as ContentDetail;
 const article={id:"base",file:"base.md",title:"原文",createdAt:1,frameFiles:[],format:"markdown" as const};
 const state={...emptyProduction(),articles:[article]};let current={article,source:"# 原文\n\n原始正文",sourceHash:"old"};
 const articleSource=vi.fn(async()=>current),articleSave=vi.fn(async()=>{throw new Error("来源文章已被修改");});
 const api={state:async()=>state,articleSource,articleSave,articlePreview:async()=>({path:"preview.html",html:"<h1>预览</h1>"})} as unknown as ProductionClient;
 const props={detail,api,goPublish:vi.fn()};const view=render(h(ArticlePanel,props));
 return {view,props,api,articleSave,articleSource,article,setCurrent:(source:string,sourceHash:string)=>{current={article,source,sourceHash};}};
}
it("prepares an edit request for the exact saved version and leaves sending to the native conversation",async()=>{
 const f=fixture(),prepareRequest=vi.fn(async(_detail:ContentDetail,_text:string,_append?:boolean)=>undefined);Object.assign(f.api,{prepareRequest});await screen.findByTitle("文章排版预览");
 fireEvent.click(screen.getByRole("button",{name:"让 Agent 修改"}));await screen.findByText("修改请求已放入项目对话，请发送。");
 expect(prepareRequest).toHaveBeenCalledWith(f.props.detail,expect.stringContaining("creator_read_article_source 读取文章 base"),false);expect(prepareRequest.mock.calls[0]?.[1]).toContain("creator_save_article_revision");
 fireEvent.click(screen.getByText("编辑"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 正在编辑\n\n我的未保存内容"}});expect((screen.getByRole("button",{name:"让 Agent 修改"}) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps the original draft hash after remount and permits explicit conflict resolution",async()=>{
 const f=fixture();await screen.findByTitle("文章排版预览");fireEvent.click(screen.getByText("编辑"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 我的文稿\n\n当前修改"}});
 f.view.unmount();f.setCurrent("# 外部文稿\n\n最新来源","new");render(h(ArticlePanel,f.props));await screen.findByLabelText("文章源稿");
 expect((screen.getByLabelText("文章源稿") as HTMLTextAreaElement).value).toContain("我的文稿");fireEvent.click(screen.getByText("保存新版本"));
 await waitFor(()=>expect(f.articleSave).toHaveBeenCalledWith(expect.objectContaining({expectedSourceHash:"old"})));
 fireEvent.click(screen.getByText("核对最新来源"));await screen.findByLabelText("最新来源文稿");fireEvent.click(screen.getByText("保留我的文稿"));fireEvent.click(screen.getByText("保存新版本"));
 await waitFor(()=>expect(f.articleSave).toHaveBeenLastCalledWith(expect.objectContaining({expectedSourceHash:"new",source:expect.stringContaining("我的文稿")})));
});
it("preserves typing during save and does not reread a just-saved version over subsequent edits",async()=>{
 const f=fixture();await screen.findByTitle("文章排版预览");fireEvent.click(screen.getByText("编辑"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 版本A\n\n正文A"}});
 let done!:(s:ArticleSaved)=>void;(f.api.articleSave as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(()=>new Promise<ArticleSaved>(r=>{done=r;}));fireEvent.click(screen.getByText("保存新版本"));
 fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 后续B\n\n继续输入"}});
 await act(async()=>done({article:{...f.article,id:"saved",file:"saved.md"},source:"# 版本A\n\n正文A",sourceHash:"saved",preview:{path:"saved.html",html:"A"}}));
 expect((screen.getByLabelText("文章源稿") as HTMLTextAreaElement).value).toContain("后续B");expect(f.articleSource).toHaveBeenCalledOnce();
});
it("reuses the save identity after a lost receipt and remount instead of creating another version",async()=>{
 const f=fixture();await screen.findByTitle("文章排版预览");fireEvent.click(screen.getByText("编辑"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 保存内容\n\n正文"}});
 const versions=new Map<string,ArticleSaved>();
 (f.api.articleSave as unknown as ReturnType<typeof vi.fn>).mockImplementation(async(request:{saveId:string;source:string})=>{let result=versions.get(request.saveId);if(!result){result={article:{...f.article,id:`saved-${request.saveId}`,file:"saved.md"},source:request.source,sourceHash:"new"};versions.set(request.saveId,result);throw new Error("回执丢失");}return result;});
 fireEvent.click(screen.getByText("保存新版本"));await screen.findByText("回执丢失");f.view.unmount();render(h(ArticlePanel,f.props));await screen.findByLabelText("文章源稿");fireEvent.click(screen.getByText("重试保存"));
 await screen.findByText("已保存新版本");expect(versions.size).toBe(1);const calls=(f.api.articleSave as unknown as ReturnType<typeof vi.fn>).mock.calls;expect(calls[0]![0].saveId).toBe(calls[1]![0].saveId);
});
it("keeps the same operation when leaving during an in-flight save and returning before its receipt",async()=>{
 const f=fixture();await screen.findByTitle("文章排版预览");fireEvent.click(screen.getByText("编辑"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 待确认版本\n\n正文"}});
 let finish!:(v:ArticleSaved)=>void;const calls:unknown[]=[];
 (f.api.articleSave as unknown as ReturnType<typeof vi.fn>).mockImplementation((request:unknown)=>{calls.push(request);return new Promise<ArticleSaved>(r=>{finish=r;});});
 fireEvent.click(screen.getByText("保存新版本"));f.view.unmount();render(h(ArticlePanel,f.props));await screen.findByLabelText("文章源稿");fireEvent.click(screen.getByText("重试保存"));
 expect((calls[0] as {saveId:string}).saveId).toBe((calls[1] as {saveId:string}).saveId);
 await act(async()=>finish({article:{...f.article,id:"saved",file:"saved.md"},source:"# 待确认版本\n\n正文",sourceHash:"saved"}));await screen.findByText("已保存新版本");
});
it("settles a successful receipt even if metadata refresh fails, preserving later typing",async()=>{
 const f=fixture();await screen.findByTitle("文章排版预览");fireEvent.click(screen.getByText("编辑"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 保存A\n\n正文"}});
 let done!:(s:ArticleSaved)=>void;(f.api.articleSave as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(()=>new Promise<ArticleSaved>(r=>{done=r;}));f.api.state=async()=>{throw new Error("摘要断连");};
 fireEvent.click(screen.getByText("保存新版本"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 保留B\n\n继续输入"}});
 await act(async()=>done({article:{...f.article,id:"saved",file:"saved.md"},source:"# 保存A\n\n正文",sourceHash:"new"}));
 expect((screen.getByLabelText("文章源稿") as HTMLTextAreaElement).value).toContain("保留B");expect(screen.queryByText("保存未完成，输入已保留")).toBeNull();expect(screen.getByRole("status").textContent).toContain("已保存");
 cleanup();render(h(ArticlePanel,f.props));await screen.findByLabelText("文章源稿");expect((screen.getByLabelText("文章源稿") as HTMLTextAreaElement).value).toContain("保留B");
});
it.each([false,true])("preserves latest draft and original hash after a remote rejection, remount during pending=%s",async(remount)=>{
 const f=fixture();await screen.findByTitle("文章排版预览");fireEvent.click(screen.getByText("编辑"));fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 提交A\n\n正文A"}});
 let reject!:(e:Error)=>void;(f.api.articleSave as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(()=>new Promise((_r,fail)=>{reject=fail;}));fireEvent.click(screen.getByText("保存新版本"));
 if(remount){f.view.unmount();render(h(ArticlePanel,f.props));await screen.findByLabelText("文章源稿");}
 fireEvent.change(screen.getByLabelText("文章源稿"),{target:{value:"# 新输入B\n\n需要保留"}});
 await act(async()=>reject(Object.assign(new Error("来源文章已被修改"),{remoteResponse:true})));
 cleanup();render(h(ArticlePanel,f.props));await screen.findByLabelText("文章源稿");expect((screen.getByLabelText("文章源稿") as HTMLTextAreaElement).value).toContain("新输入B");
 fireEvent.click(screen.getByText("重试保存"));await waitFor(()=>expect(f.articleSave).toHaveBeenLastCalledWith(expect.objectContaining({source:expect.stringContaining("新输入B"),expectedSourceHash:"old"})));
});
