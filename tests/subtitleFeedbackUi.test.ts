// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { SubtitlePanel } from "../src/client/SubtitlePanel.tsx";
import { emptyProduction,type ProductionTask } from "../src/production/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
import type { ContentDetail } from "../src/types.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
afterEach(cleanup);
const video={name:"clip.mp4",size:100,modifiedAt:1};
function fixture(taskVideo=video,existing=false){
 const detail={id:"one",folderPath:"C:/subtitle-feedback",selectedVideo:video.name,videos:[video],tags:[],covers:{}} as unknown as ContentDetail;
 const task={id:"asr",kind:"asr",status:"failed",video:taskVideo,error:existing?"新字幕文件损坏":"当前视频没有音轨，无法转写",contentId:detail.id,folderPath:detail.folderPath,createdAt:2,updatedAt:2} as ProductionTask;
 const api={state:async()=>({...emptyProduction(),tasks:[task],transcripts:existing?[{id:"old",video,source:"imported",textFile:"old.txt",srtFile:"old.srt",createdAt:1,cues:3}]:[]}),action:vi.fn()} as unknown as ProductionClient;
 render(h(SubtitlePanel,{detail,api,openPath:vi.fn()}));
}
it("offers import for known no-audio input with one explanation instead of conflicting empty guidance",async()=>{
 fixture();await screen.findByText("当前视频没有音轨，可导入字幕");expect(screen.getAllByRole("alert")).toHaveLength(1);expect((screen.getByRole("button",{name:"视频转文字"}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole("button",{name:"导入字幕"}) as HTMLButtonElement).disabled).toBe(false);expect(screen.queryByText(/尚无当前视频的字幕/)).toBeNull();
});
it("does not use another video's failure to disable the current video's transcription",async()=>{
 fixture({...video,name:"old.mp4"});await screen.findByText("尚无当前视频的字幕，可转写或导入");expect(screen.queryByRole("alert")).toBeNull();expect((screen.getByRole("button",{name:"视频转文字"}) as HTMLButtonElement).disabled).toBe(false);
});
it("keeps a newer failed import visible alongside the previously usable transcript",async()=>{
 fixture(video,true);await screen.findByText("新字幕文件损坏");expect(screen.getByText("已保留当前字幕 · 3 段 · clip.mp4")).toBeTruthy();expect(screen.getByRole("button",{name:"打开字幕文件"})).toBeTruthy();
});
