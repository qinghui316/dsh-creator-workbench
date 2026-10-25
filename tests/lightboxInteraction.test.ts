// @vitest-environment jsdom
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewProvider, useImagePreview, type PreviewImage } from "../src/client/ImagePreview.tsx";
import { ArticlePreview } from "../src/client/ArticlePreview.tsx";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Modal:undefined}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const images:PreviewImage[]=[{id:"one",title:"图片一",src:"data:image/png;base64,YWJj",revision:"v1"},{id:"two",title:"图片二",src:"data:image/png;base64,ZGVm",revision:"v1"}];
function Demo({items=images}:{items?:PreviewImage[]}) {
  const preview=useImagePreview(items),[draft,setDraft]=useState("未保存的正文");
  return h("div",{"data-surface":"inspector"},h("div",{className:"body",style:{overflow:"auto"}},h("input",{"aria-label":"草稿",value:draft,onChange:(event:React.ChangeEvent<HTMLInputElement>)=>setDraft(event.target.value)}),h("button",{onClick:(event:React.MouseEvent<HTMLButtonElement>)=>preview.open(items,items[0]!.id,event.currentTarget)},"查看图片")));
}
const tree=(items?:PreviewImage[])=>h("div",{"data-surface":"inspector"},h(ImagePreviewProvider,null,h(Demo,{...(items?{items}:{})})));
const mount=(items?:PreviewImage[])=>render(tree(items));
const dismiss=async()=>{fireEvent.click(screen.getByRole("button",{name:"关闭图片"}));await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());};
describe("viewport media lightbox",()=>{
  for(const method of ["button","backdrop","escape"] as const)it(`dismisses by ${method}, preserving draft, scroll and source focus`,async()=>{
    const view=mount(),body=view.container.querySelector<HTMLElement>(".body")!;body.scrollTop=240;
    fireEvent.change(screen.getByLabelText("草稿"),{target:{value:"继续编辑的正文"}});
    const trigger=screen.getByRole("button",{name:"查看图片"});trigger.focus();fireEvent.click(trigger);
    const dialog=screen.getByRole("dialog",{name:"图片一"});expect(view.container.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button",{name:"关闭图片"}));expect(body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByAltText("图片一"));expect(screen.getByRole("dialog")).toBe(dialog);
    if(method==="button")fireEvent.click(screen.getByRole("button",{name:"关闭图片"}));
    if(method==="escape")fireEvent.keyDown(document.body,{key:"Escape"});
    if(method==="backdrop"){fireEvent.pointerDown(dialog.parentElement!);fireEvent.click(dialog.parentElement!);}
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());await waitFor(()=>expect(document.activeElement).toBe(trigger));
    expect((screen.getByLabelText("草稿")as HTMLInputElement).value).toBe("继续编辑的正文");expect(body.scrollTop).toBe(240);expect(body.style.overflow).toBe("auto");
  });
  it("does not dismiss when a pointer starts on the image and ends on the mask",async()=>{
    mount();fireEvent.click(screen.getByText("查看图片"));const dialog=screen.getByRole("dialog");
    fireEvent.pointerDown(screen.getByAltText("图片一"));fireEvent.pointerUp(dialog.parentElement!);fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog")).toBe(dialog);await dismiss();
  });
  it("keeps picture order, traps focus and releases keyboard ownership when closed",async()=>{
    mount();fireEvent.click(screen.getByText("查看图片"));const close=screen.getByRole("button",{name:"关闭图片"});
    screen.getByRole("button",{name:"下一张"}).focus();fireEvent.keyDown(document.body,{key:"Tab"});expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document.body,{key:"ArrowRight"});expect(screen.getByAltText("图片二")).toBeTruthy();expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(document.body,{key:"ArrowLeft"});expect(screen.getByAltText("图片一")).toBeTruthy();
    await dismiss();const event=new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true});document.body.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
  });
  it("lets a foreground dialog or menu own Escape and arrow keys",async()=>{
    mount();fireEvent.click(screen.getByText("查看图片"));const top=document.createElement("div");top.setAttribute("role","menu");document.body.append(top);
    const event=new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true});top.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(top,{key:"ArrowRight"});expect(screen.getByAltText("图片一")).toBeTruthy();top.remove();await dismiss();
  });
  it("only shows retry on failure and retries media reading, without a permanent toolbar",async()=>{
    const reload=vi.fn();mount([{...images[0]!,reload}]);fireEvent.click(screen.getByText("查看图片"));
    expect(screen.queryByText("重新读取图片")).toBeNull();expect(screen.queryByRole("button",{name:"重试"})).toBeNull();
    fireEvent.error(screen.getByAltText("图片一"));expect(screen.getByRole("alert").textContent).toContain("图片无法显示");
    fireEvent.click(screen.getByText("重试"));expect(reload).toHaveBeenCalledOnce();await waitFor(()=>expect(screen.getByAltText("图片一")).toBeTruthy());await dismiss();
  });
  it("rejects late reads after switching images or closing and aborts only the viewer interest",async()=>{
    let resolve!:(value:string)=>void;let signal:AbortSignal|undefined;
    const load=vi.fn((value:AbortSignal)=>{signal=value;return new Promise<string>(done=>{resolve=done;});});
    mount([{id:"slow",title:"慢图",load},images[1]!]);fireEvent.click(screen.getByText("查看图片"));await waitFor(()=>expect(load).toHaveBeenCalledOnce());
    fireEvent.keyDown(document.body,{key:"ArrowRight"});expect(signal?.aborted).toBe(true);expect(screen.getByAltText("图片二")).toBeTruthy();
    await act(async()=>resolve("data:image/png;base64,bGF0ZQ=="));expect(screen.queryByAltText("慢图")).toBeNull();await dismiss();expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("closes on source removal or revision change without restoring an obsolete trigger",async()=>{
    const view=mount();fireEvent.click(screen.getByText("查看图片"));const elsewhere=document.createElement("button");document.body.append(elsewhere);elsewhere.focus();
    view.rerender(tree([images[1]!]));expect(screen.queryByRole("dialog")).toBeNull();expect(document.activeElement).toBe(elsewhere);elsewhere.remove();
    fireEvent.click(screen.getByText("查看图片"));view.rerender(tree([{...images[1]!,revision:"replacement"}]));expect(screen.queryByRole("dialog")).toBeNull();
  });
  for(const change of ["removed","revised"] as const)it(`drops a non-current ${change} image even when its old media is cached`,async()=>{
    const cached=vi.fn(()=>"data:image/png;base64,Y2FjaGVk"),b={id:"cached-b",title:"缓存B",revision:"old",load:cached},c={id:"c",title:"图片C",src:"data:image/png;base64,Yw=="};
    const view=mount([images[0]!,b,c]);fireEvent.click(screen.getByText("查看图片"));fireEvent.keyDown(document.body,{key:"ArrowRight"});await screen.findByAltText("缓存B");fireEvent.keyDown(document.body,{key:"ArrowLeft"});
    view.rerender(tree(change==="removed"?[images[0]!,c]:[images[0]!,{...b,revision:"new"},c]));
    fireEvent.keyDown(document.body,{key:"ArrowRight"});expect(screen.getByAltText("图片C")).toBeTruthy();expect(screen.queryByAltText("缓存B")).toBeNull();expect(cached).toHaveBeenCalledOnce();expect(screen.getByText("2 / 2")).toBeTruthy();await dismiss();
  });
  it("does not append newly discovered media or accept a late removed-image response",async()=>{
    let resolve!:(value:string)=>void;let signal:AbortSignal|undefined;
    const b:PreviewImage={id:"slow-b",title:"慢B",load:value=>{signal=value;return new Promise<string>(done=>{resolve=done;});}},c={id:"c",title:"图片C",src:"data:image/png;base64,Yw=="},d={id:"d",title:"新图片D",src:"data:image/png;base64,ZA=="};
    const view=mount([images[0]!,b,c]);fireEvent.click(screen.getByText("查看图片"));fireEvent.keyDown(document.body,{key:"ArrowRight"});await waitFor(()=>expect(signal).toBeDefined());fireEvent.keyDown(document.body,{key:"ArrowLeft"});
    view.rerender(tree([images[0]!,c,d]));await act(async()=>resolve("data:image/png;base64,bGF0ZQ=="));expect(signal!.aborted).toBe(true);
    fireEvent.keyDown(document.body,{key:"ArrowRight"});expect(screen.getByAltText("图片C")).toBeTruthy();fireEvent.keyDown(document.body,{key:"ArrowRight"});expect(screen.getByAltText("图片C")).toBeTruthy();expect(screen.queryByAltText("慢B")).toBeNull();expect(screen.queryByAltText("新图片D")).toBeNull();await dismiss();
  });
  it("preserves the entrance's material order instead of the available library order",async()=>{
    function Ordered(){const preview=useImagePreview(images);return h("button",{onClick:(event:React.MouseEvent<HTMLButtonElement>)=>preview.open([images[1]!,images[0]!],"two",event.currentTarget)},"图集");}
    render(h(ImagePreviewProvider,null,h(Ordered)));fireEvent.click(screen.getByText("图集"));expect(screen.getByAltText("图片二")).toBeTruthy();fireEvent.keyDown(document.body,{key:"ArrowRight"});expect(screen.getByAltText("图片一")).toBeTruthy();await dismiss();
  });
  it("uses one provider when compatibility wrappers nest and removes its portal on unmount",()=>{
    const view=render(h(ImagePreviewProvider,null,h(ImagePreviewProvider,null,h(Demo))));fireEvent.click(screen.getByText("查看图片"));expect(screen.getAllByRole("dialog")).toHaveLength(1);view.unmount();expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("closes immediately under reduced motion",()=>{
    vi.stubGlobal("matchMedia",()=>({matches:true}));mount();fireEvent.click(screen.getByText("查看图片"));fireEvent.click(screen.getByRole("button",{name:"关闭图片"}));expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps article scripts and network disabled, restoring the exact iframe image and scroll",async()=>{
    render(h(ImagePreviewProvider,null,h(ArticlePreview,{html:'<h1 onclick="alert(1)">Article</h1><script>throw 1</script><iframe src="https://example.test"></iframe><form><input></form>'})));
    const frame=screen.getByTitle("文章排版预览")as HTMLIFrameElement;expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");expect(frame.srcdoc).toContain("script-src 'none'");expect(frame.srcdoc).toContain("connect-src 'none'");expect(frame.srcdoc).not.toMatch(/<script|onclick|<iframe|<form/i);
    frame.contentDocument!.body.innerHTML='<img alt="文章配图" src="data:image/png;base64,YWJj"><img alt="第二张配图" src="data:image/png;base64,ZGVm">';fireEvent.load(frame);
    const image=frame.contentDocument!.querySelector("img")!;image.focus();frame.contentDocument!.documentElement.scrollTop=180;fireEvent.click(image);
    expect(screen.getByRole("dialog",{name:"文章配图"})).toBeTruthy();fireEvent.keyDown(document.body,{key:"ArrowRight"});expect(screen.getByAltText("第二张配图")).toBeTruthy();
    await dismiss();await waitFor(()=>expect(frame.contentDocument!.activeElement).toBe(image));expect(frame.contentDocument!.documentElement.scrollTop).toBe(180);
  });
});
