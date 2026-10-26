// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImageLibraryPanel } from "../src/client/ImageLibraryPanel.tsx";
import { ImagePreviewProvider } from "../src/client/ImagePreview.tsx";
import { emptyProduction } from "../src/production/types.ts";
import type { ProductionClient } from "../src/client/productionApi.ts";
import type { ContentDetail } from "../src/types.ts";
import { imageName } from "../src/client/mediaPresentation.ts";

vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
let sequence=0;
function fixture(){
 const detail={id:"image-project",folderPath:`E:/clarity-${++sequence}`,title:"项目"} as ContentDetail;
 let state={...emptyProduction(),images:[{id:"image-one",file:"图片/素材归档封面.png",width:800,height:600,mime:"image/png",sha256:"test-sha",createdAt:1,source:"imported"as const,purpose:"illustration"as const}]};
 const action=vi.fn(async(request:{action:string;imageId?:string})=>{if(request.action==="remove-image")state={...state,images:state.images.map(i=>({...i,hidden:true}))};return state;});
 const api={state:async()=>state,action,image:vi.fn(async()=>({mime:"image/png",base64:"YWJj"}))}as unknown as ProductionClient;
 render(h(ImagePreviewProvider,{children:h(ImageLibraryPanel,{api,detail})}));return{api,action};
}
it("identifies the real file and opens details without selecting or removing it",async()=>{
 const f=fixture();await screen.findByText("素材归档封面.png");expect(screen.queryByText("800×600")).toBeNull();
 const trigger=screen.getByRole("button",{name:"图片操作：素材归档封面.png"});fireEvent.click(trigger);
 fireEvent.click(screen.getByRole("menuitem",{name:"查看详情"}));const details=screen.getByRole("region",{name:"图片详情"});
 expect(details.textContent).toContain("800 × 600");expect(details.textContent).toContain("图片/素材归档封面.png");expect(f.action).not.toHaveBeenCalled();
 fireEvent.click(within(details).getByRole("button",{name:"返回"}));await waitFor(()=>expect(document.activeElement).toBe(trigger));
});
it("removes only the explicitly chosen gallery item through its contextual menu",async()=>{
 const f=fixture();await screen.findByText("素材归档封面.png");expect(screen.queryByRole("button",{name:"移除图片"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"图片操作：素材归档封面.png"}));
 await act(async()=>fireEvent.click(screen.getByRole("menuitem",{name:"移除图片"})));
 expect(f.action).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:"image-project",action:"remove-image",imageId:"image-one"}));
 expect(screen.queryByRole("button",{name:"预览图片：素材归档封面.png"})).toBeNull();expect(screen.queryByText(/已移除图片/)).toBeNull();
});
it("previews and closes the real image without business writes",async()=>{
 const f=fixture();const trigger=await screen.findByRole("button",{name:"预览图片：素材归档封面.png"});fireEvent.click(trigger);
 const dialog=screen.getByRole("dialog");await within(dialog).findByRole("img");fireEvent.keyDown(dialog,{key:"Escape"});
 await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());expect(document.activeElement).toBe(trigger);expect(f.action).not.toHaveBeenCalled();
});
it("keeps Windows and slash file labels factual",()=>{expect(imageName({file:"E:\\资料\\长名称 主题.png"})).toBe("长名称 主题.png");expect(imageName({file:".dsh-creator-workbench/images/card.webp"})).toBe("card.webp");});
