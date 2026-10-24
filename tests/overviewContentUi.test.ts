// @vitest-environment jsdom
import {createElement as h} from "react";
import {act,cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {OverviewPage} from "../src/client/OverviewPage.tsx";
import {ProjectDataProvider} from "../src/client/ProjectData.tsx";
import {bumpLibrary} from "../src/client/contentSelection.ts";
import {projectQuery} from "../src/client/projectQuery.ts";
import type {ContentDetail} from "../src/types.ts";
import type {ProjectView} from "../src/projectView.ts";
import type {ProductionClient} from "../src/client/productionApi.ts";
import {emptyProduction} from "../src/production/types.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
beforeEach(()=>vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function fixture(){
 const detail={id:"one",folderPath:"C:/overview",title:"项目",videoSelection:"selected",selectedVideo:"视频.MP4",videos:[{name:"视频.MP4",size:5,modifiedAt:1}],covers:{},tags:[]} as unknown as ContentDetail;
 const image={id:"img",file:"image.png",mime:"image/png",width:300,height:400,sha256:"image-hash",createdAt:1,source:"generated" as const,purpose:"illustration" as const};
 let view:ProjectView={detail,script:{exists:true,excerpt:"这里是真实脚本的正文摘录。\n包含拍摄安排。"},excerpts:{article:{id:"article",text:"这里是实际文章正文预览。"},subtitle:{file:"captions.srt",source:"火山转写 · 视频.MP4",text:"真实字幕内容。"}},covers:{versions:[],selected:{},runs:[]},production:{...emptyProduction(),images:[image],articles:[{id:"article",file:"a.md",createdAt:1,title:"文章题目",frameFiles:[],imageIds:["img"]}],publications:[{id:"pub",revision:1,platform:"xiaohongshu",type:"images",title:"小红书独立文案",bodyFile:"p.md",imageIds:["img"],tags:[],createdAt:1,updatedAt:1}]}};
 const api={projectView:vi.fn(async()=>view),state:vi.fn(),settings:vi.fn(),image:vi.fn(async()=>({mime:"image/png",base64:"YWJj"}))} as unknown as ProductionClient;
 const media={getVideoPlayback:vi.fn(async()=>({found:true,url:"http://localhost/video",kind:"raw" as const})),getCoverImage:vi.fn(async()=>({mime:"image/png",base64:"YWJj"}))},navigate=vi.fn();
 const child=h(OverviewPage,{detail,api,navigate,...media});
 const rendered=render(h(ProjectDataProvider,{api,scope:detail,children:child}));
 return {api,detail,media,navigate,unmount:rendered.unmount,get view(){return view;},update(next:ProjectView){view=next;}};
}
it("shows real text, images and each platform material; editing is a separate secondary action",async()=>{
 const f=fixture();await screen.findByText("这里是实际文章正文预览。");expect(screen.getByText("真实字幕内容。")).toBeTruthy();expect(screen.getByText(/这里是真实脚本/)).toBeTruthy();
 expect(screen.getByText("小红书独立文案")).toBeTruthy();expect(screen.getByText("小红书 · 图文 · 本地材料")).toBeTruthy();
 const video=await screen.findByLabelText("概览视频预览");expect(video.tagName).toBe("VIDEO");expect(video.getAttribute("controls")).not.toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"编辑文章"}));expect(f.navigate).toHaveBeenLastCalledWith("article","article");
 fireEvent.click(screen.getByRole("button",{name:"编辑发布内容：小红书独立文案"}));expect(f.navigate).toHaveBeenLastCalledWith("publishing","pub");
});
it("pauses the actual video element when the overview is unmounted",async()=>{
 const f=fixture(),video=await screen.findByLabelText("概览视频预览"),pause=vi.spyOn(video as HTMLVideoElement,"pause");
 f.unmount();expect(pause).toHaveBeenCalled();
});
it("does not combine a newly saved article title with an older excerpt",async()=>{
 const f=fixture();await screen.findByText("这里是实际文章正文预览。");
 await act(async()=>{projectQuery(f.api,f.detail).accept({...emptyProduction(),articles:[{id:"new-article",title:"新版本标题",file:"new.md",createdAt:2,frameFiles:[]}]});});
 expect(screen.getByText("新版本标题")).toBeTruthy();expect(screen.queryByText("这里是实际文章正文预览。")).toBeNull();
});
it("clears a removed script instead of falling back to stale detail text",async()=>{
 const f=fixture();f.detail.script="已经移除的旧正文";await screen.findByText(/这里是真实脚本/);
 f.update({...f.view,script:{exists:false,excerpt:""}});await act(async()=>{bumpLibrary();});await screen.findByText("还没有脚本");expect(screen.queryByText("已经移除的旧正文")).toBeNull();
});
it("keeps playing media and the open image preview mounted across metadata refreshes",async()=>{
 const f=fixture(),video=await screen.findByLabelText("概览视频预览");
 fireEvent.click(screen.getByRole("button",{name:"查看图片 1"}));const preview=screen.getByRole("region",{name:"概览图片预览"});const image=await within(preview).findByRole("img");
 expect(f.api.image).toHaveBeenCalledTimes(1);expect(f.navigate).not.toHaveBeenCalled();
 f.update({...f.view,production:{...f.view.production,publications:(f.view.production.publications??[]).map(p=>({...p,title:"后台更新的材料"}))}});
 await act(async()=>{bumpLibrary();});await screen.findByText("后台更新的材料");expect(screen.getByLabelText("概览视频预览")).toBe(video);expect(within(screen.getByRole("region",{name:"概览图片预览"})).getByRole("img")).toBe(image);expect(f.media.getVideoPlayback).toHaveBeenCalledTimes(1);expect(f.api.image).toHaveBeenCalledTimes(1);expect(f.api.settings).not.toHaveBeenCalled();
 fireEvent.keyDown(preview,{key:"Escape"});expect(screen.queryByRole("region",{name:"概览图片预览"})).toBeNull();expect(document.activeElement).toBe(screen.getByRole("button",{name:"查看图片 1"}));
});
