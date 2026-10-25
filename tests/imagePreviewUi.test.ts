// @vitest-environment jsdom
import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewProvider, useImagePreview } from "../src/client/ImagePreview.tsx";
import { ArticlePreview } from "../src/client/ArticlePreview.tsx";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
afterEach(cleanup);
function Demo({ reload }: { reload: () => void }) {
  const preview=useImagePreview(),[draft,setDraft]=useState("未保存的正文");
  return h("div",{"data-surface":"inspector"},h("div",{className:"body",style:{overflow:"auto"}},h("input",{"aria-label":"草稿",value:draft,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setDraft(e.target.value)}),h("button",{onClick:(e:React.MouseEvent<HTMLButtonElement>)=>preview.open([{id:"one",title:"图片一",content:h("img",{src:"data:image/png;base64,YWJj",alt:"一"}),reload},{id:"two",title:"图片二",content:h("img",{src:"data:image/png;base64,YWJj",alt:"二"})}],"one",e.currentTarget)},"放大")));
}
describe("one business-area image modal",()=>{
 for(const method of ["button","backdrop","escape"] as const) it(`closes by ${method}, restores focus and keeps editor input`,async()=>{
  render(h(ImagePreviewProvider,null,h(Demo,{reload:vi.fn()})));const trigger=screen.getByRole("button",{name:"放大"});fireEvent.change(screen.getByLabelText("草稿"),{target:{value:"用户新输入"}});fireEvent.click(trigger);
  const dialog=screen.getByRole("dialog",{name:"图片一"});expect(dialog.getAttribute("aria-modal")).toBe("true");expect(document.activeElement).toBe(screen.getByRole("button",{name:"关闭"}));
  fireEvent.click(screen.getByAltText("一"));expect(screen.getByRole("dialog")).toBe(dialog);
  if(method==="button")fireEvent.click(screen.getByRole("button",{name:"关闭"}));
  if(method==="escape")fireEvent.keyDown(dialog,{key:"Escape"});
  if(method==="backdrop"){fireEvent.pointerDown(dialog.parentElement!);fireEvent.click(dialog.parentElement!);}
  expect(screen.queryByRole("dialog")).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(trigger));expect((screen.getByLabelText("草稿")as HTMLInputElement).value).toBe("用户新输入");
 });
 it("traps keyboard focus, changes viewed image and retries reading without choosing an asset",()=>{
  const reload=vi.fn();render(h(ImagePreviewProvider,null,h(Demo,{reload})));fireEvent.click(screen.getByText("放大"));const last=screen.getByRole("button",{name:"重新读取图片"});last.focus();fireEvent.keyDown(last,{key:"Tab"});expect(document.activeElement).toBe(screen.getByRole("button",{name:"关闭"}));fireEvent.click(last);expect(reload).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole("button",{name:"下一张"}));expect(screen.getByAltText("二")).toBeTruthy();expect(screen.getByRole("dialog",{name:"图片二"})).toBeTruthy();
 });
 it("reports a decoded-image failure and keeps the draft when closing from outside the business area",()=>{
  const reload=vi.fn();render(h("div",null,h("button",null,"宿主操作"),h(ImagePreviewProvider,null,h(Demo,{reload}))));
  fireEvent.click(screen.getByText("放大"));fireEvent.error(screen.getByAltText("一"));expect(screen.getByRole("alert").textContent).toContain("图片无法显示");
  fireEvent.click(screen.getByText("重新读取图片"));expect(reload).toHaveBeenCalledOnce();expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByText("宿主操作"));expect(screen.queryByRole("dialog")).toBeNull();expect((screen.getByLabelText("草稿")as HTMLInputElement).value).toBe("未保存的正文");
 });
 it("keeps article scripts and network access disabled while allowing existing images to use the same modal",()=>{
  render(h(ImagePreviewProvider,null,h(ArticlePreview,{html:'<h1 onclick="alert(1)">Article</h1><script>throw 1</script><meta http-equiv="refresh" content="0;url=https://example.test"><iframe src="https://example.test"></iframe><form action="https://example.test"><input></form>'})));const frame=screen.getByTitle("文章排版预览")as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");expect(frame.srcdoc).toContain("script-src 'none'");expect(frame.srcdoc).toContain("connect-src 'none'");
  expect(frame.srcdoc).not.toMatch(/<script|onclick|http-equiv="refresh"|<iframe|<form/i);
  frame.contentDocument!.body.innerHTML='<img alt="文章配图" src="data:image/png;base64,YWJj">';fireEvent.load(frame);fireEvent.click(frame.contentDocument!.querySelector("img")!);expect(screen.getByRole("dialog",{name:"文章配图"})).toBeTruthy();
 });
});
