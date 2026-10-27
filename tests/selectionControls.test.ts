// @vitest-environment jsdom
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatorSelect } from "../src/client/ui/CreatorSelect.tsx";
import { SelectionRail } from "../src/client/ui/SelectionRail.tsx";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const options = [h("option", { value:"a",key:"a" }, "Alpha"),h("option",{value:"x",key:"x",disabled:true},"不可选"),h("option",{value:"b",key:"b"},"Beta"),h("option",{value:"c",key:"c"},"中文项目")];
function Demo({commit = vi.fn(),accept = true}:{commit?:(v:string)=>void;accept?:boolean}) {
  const [value,setValue]=useState("a");
  return h("div",{},h("label",{},"材料",h(CreatorSelect,{value,onValueChange:v=>{commit(v);if(accept)setValue(v);}},options)),h("button",{},"后一个"));
}
describe("controlled listbox selection",()=>{
  it("omits redundant disabled placeholders after selection but keeps enabled clearing options",()=>{
    const commit=vi.fn();const children=[h('option',{key:'empty',value:'',disabled:true},'已选择'),h('option',{key:'a',value:'a'},'当前视频')];const view=render(h(CreatorSelect,{value:'a',onValueChange:commit},children));fireEvent.click(screen.getByRole('combobox'));expect(screen.queryByRole('option',{name:'已选择'})).toBeNull();expect(screen.getAllByRole('option')).toHaveLength(1);fireEvent.keyDown(screen.getByRole('combobox'),{key:'Escape'});
    view.rerender(h(CreatorSelect,{value:'a',onValueChange:commit},h('option',{value:''},'清空选择'),h('option',{value:'a'},'当前视频')));fireEvent.click(screen.getByRole('combobox'));fireEvent.click(screen.getByRole('option',{name:'清空选择'}));expect(commit).toHaveBeenCalledExactlyOnceWith('');
  });
  it("browses enabled options without committing and commits Enter only once",()=>{
    const commit=vi.fn();render(h(Demo,{commit}));const combo=screen.getByRole("combobox",{name:"材料"});combo.focus();fireEvent.keyDown(combo,{key:"ArrowDown"});fireEvent.keyDown(combo,{key:"ArrowDown"});
    expect(combo.getAttribute("value")).toBe("a");expect(commit).not.toHaveBeenCalled();expect(screen.getByRole("option",{name:"Beta"}).id).toBe(combo.getAttribute("aria-activedescendant"));
    fireEvent.keyDown(combo,{key:"Enter"});expect(commit).toHaveBeenCalledExactlyOnceWith("b");expect(combo.getAttribute("value")).toBe("b");expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("keeps the accepted value when the caller rejects a candidate",()=>{
    const commit=vi.fn();render(h(Demo,{commit,accept:false}));const combo=screen.getByRole("combobox");fireEvent.click(combo);fireEvent.click(screen.getByRole("option",{name:"Beta"}));expect(commit).toHaveBeenCalledWith("b");expect(combo.getAttribute("value")).toBe("a");
  });
  it("cancels Escape, Tab and outside clicks without choosing the browsed option",async()=>{
    const commit=vi.fn();render(h(Demo,{commit}));const combo=screen.getByRole("combobox");combo.focus();const user=userEvent.setup();
    await user.keyboard("{ArrowDown}{End}{Escape}");expect(combo.getAttribute("value")).toBe("a");expect(document.activeElement).toBe(combo);
    await user.keyboard("{ArrowDown}{End}{Tab}");expect(document.activeElement).toBe(screen.getByRole("button",{name:"后一个"}));expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(combo);fireEvent.pointerDown(document.body);expect(screen.queryByRole("listbox")).toBeNull();expect(commit).not.toHaveBeenCalled();
  });
  it("supports typeahead and leaves IME composition alone",()=>{
    const commit=vi.fn();render(h(Demo,{commit}));const combo=screen.getByRole("combobox");fireEvent.keyDown(combo,{key:"b"});expect(screen.getByRole("option",{name:"Beta"}).id).toBe(combo.getAttribute("aria-activedescendant"));
    fireEvent.compositionStart(combo);fireEvent.keyDown(combo,{key:"Enter",isComposing:true});expect(commit).not.toHaveBeenCalled();expect(screen.getByRole("listbox")).toBeTruthy();fireEvent.compositionEnd(combo);fireEvent.keyDown(combo,{key:"Escape"});
    fireEvent.keyDown(combo,{key:"中"});expect(screen.getByRole("option",{name:"中文项目"}).id).toBe(combo.getAttribute("aria-activedescendant"));fireEvent.keyDown(combo,{key:"Enter"});expect(commit).toHaveBeenCalledExactlyOnceWith("c");
  });
  it("keeps pointer highlighting distinct from the selected checkmark and ignores disabled rows",()=>{
    const commit=vi.fn();render(h(Demo,{commit}));const combo=screen.getByRole("combobox");fireEvent.click(combo);fireEvent.pointerMove(screen.getByRole("option",{name:"Beta"}));expect(screen.getByRole("option",{selected:true}).textContent).toContain("Alpha");expect(commit).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("option",{name:"不可选"}));expect(commit).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("option",{name:"Beta"}));expect(document.activeElement).toBe(combo);expect(commit).toHaveBeenCalledOnce();
  });
  it("isolates its popup from a field label and does not toggle open after confirming inside a label",async()=>{
    render(h(Demo));const user=userEvent.setup(),combo=screen.getByLabelText("材料");await user.click(combo);await user.click(screen.getByRole("option",{name:"Beta"}));expect(screen.getByLabelText("材料")).toBe(combo);expect(combo.getAttribute("aria-expanded")).toBe("false");
  });
  it("presents empty, loading, error and disabled states without committing",()=>{
    const change=vi.fn();const view=render(h(CreatorSelect,{"aria-label":"空",value:"",onValueChange:change}));fireEvent.click(screen.getByRole("combobox"));expect(screen.getByText("暂无选项")).toBeTruthy();view.rerender(h(CreatorSelect,{value:"",onValueChange:change,loading:true}));expect(screen.queryByRole("listbox")).toBeNull();expect((screen.getByRole("combobox")as HTMLButtonElement).disabled).toBe(true);
    view.rerender(h(CreatorSelect,{value:"",onValueChange:change,error:"选项读取失败"}));fireEvent.click(screen.getByRole("combobox"));expect(screen.getByRole("alert").textContent).toBe("选项读取失败");view.rerender(h(CreatorSelect,{value:"",onValueChange:change,disabled:true}));expect(screen.queryByRole("listbox")).toBeNull();expect(change).not.toHaveBeenCalled();
  });
  it("closes on owning scroll, keeps internal scroll and releases observers/listeners",()=>{
    const disconnect=vi.fn();vi.stubGlobal("ResizeObserver",class{observe(){}disconnect=disconnect;});const remove=vi.spyOn(document,"removeEventListener");const view=render(h(Demo));fireEvent.click(screen.getByRole("combobox"));fireEvent.scroll(screen.getByRole("listbox"));expect(screen.getByRole("listbox")).toBeTruthy();fireEvent.scroll(document);expect(screen.queryByRole("listbox")).toBeNull();view.unmount();expect(disconnect).toHaveBeenCalled();expect(remove).toHaveBeenCalledWith("scroll",expect.any(Function),true);
  });
  it("never confirms stale options behind a load error",()=>{
    const change=vi.fn();render(h(CreatorSelect,{value:"a",onValueChange:change,error:"读取失败"},options));const combo=screen.getByRole("combobox");fireEvent.click(combo);fireEvent.keyDown(combo,{key:"ArrowDown"});fireEvent.keyDown(combo,{key:"Enter"});expect(change).not.toHaveBeenCalled();expect(screen.queryByRole("option")).toBeNull();expect(combo.getAttribute("aria-activedescendant")).toBeNull();fireEvent.keyDown(combo,{key:"Escape"});expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("removes the popup immediately when reduced motion is enabled",()=>{
    vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));render(h(Demo));const combo=screen.getByRole("combobox");fireEvent.click(combo);fireEvent.keyDown(combo,{key:"Escape"});expect(document.querySelector('.creatorSelectPopup')).toBeNull();
  });
  it("remeasures the current highlight when a wrapped row changes size without a new selection",()=>{
    let resize=()=>{};vi.stubGlobal("ResizeObserver",class{constructor(callback:()=>void){resize=callback;}observe(){}disconnect(){}});
    render(h(Demo));fireEvent.click(screen.getByRole("combobox"));const option=screen.getByRole("option",{name:"Beta"}),popup=screen.getByRole("listbox"),marker=popup.querySelector<HTMLElement>(".creatorOptionHighlight")!;
    let top=80,height=34,width=240;Object.defineProperties(option,{offsetTop:{get:()=>top},offsetHeight:{get:()=>height},offsetWidth:{get:()=>width},offsetLeft:{value:4}});
    fireEvent.pointerMove(option);expect(marker.style.transform).toBe("translate(4px, 80px)");
    top=120;height=68;width=140;act(()=>resize());expect(marker.style.transform).toBe("translate(4px, 120px)");expect(marker.style.width).toBe("140px");expect(marker.style.height).toBe("68px");expect(marker.style.transitionDuration).toBe("0ms");
  });
});
describe("selection motion geometry",()=>{
  it("reveals the accepted item again after first-paint scroll clamping without moving ancestors",()=>{
    let frame:FrameRequestCallback=()=>{};vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{frame=callback;return 7;});vi.stubGlobal("cancelAnimationFrame",vi.fn());
    const view=render(h(SelectionRail,{selected:"b"},h("button",{},"A"),h("button",{"aria-current":"page"},"B"))),root=screen.getByRole("navigation"),button=screen.getByText("B");
    Object.defineProperties(root,{clientWidth:{value:60},scrollWidth:{value:200}});Object.defineProperties(button,{offsetLeft:{value:80},offsetWidth:{value:40}});view.container.scrollTop=120;
    fireEvent.resize(window);expect(root.scrollLeft).toBe(60);root.scrollLeft=0;act(()=>frame(16));expect(root.scrollLeft).toBe(60);expect(view.container.scrollTop).toBe(120);view.unmount();expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
  it("places directly on first mount, moves only accepted state, handles wrapped rows and reduced motion",()=>{
    let reduce=false,listener:(()=>void)|undefined;vi.stubGlobal("matchMedia",()=>({get matches(){return reduce;},addEventListener:(_n:string,f:()=>void)=>listener=f,removeEventListener:vi.fn()}));
    const rail=(selected:string)=>h(SelectionRail,{selected},h("button",{"aria-current":selected==="a"?"page":undefined},"A"),h("button",{"aria-current":selected==="b"?"page":undefined},"B"));
    const view=render(rail("a")),root=screen.getByRole("navigation"),marker=root.querySelector<HTMLElement>(".creatorSelectionIndicator")!;
    expect(marker.style.transitionDuration).toBe("0ms");for(const [n,item]of [...root.querySelectorAll("button")].entries())Object.defineProperties(item,{offsetLeft:{configurable:true,value:n*80},offsetTop:{configurable:true,value:n*40},offsetWidth:{configurable:true,value:60},offsetHeight:{configurable:true,value:36}});
    view.rerender(rail("b"));expect(marker.style.transform).toBe("translate(80px, 40px)");expect(marker.style.transitionDuration).toBe("var(--creator-glide-duration)");
    fireEvent.resize(window);expect(marker.style.transitionDuration).toBe("var(--creator-glide-duration)");reduce=true;act(()=>listener?.());expect(marker.style.transitionDuration).toBe("0ms");
  });
});
