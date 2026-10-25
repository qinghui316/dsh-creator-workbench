// @vitest-environment jsdom
import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretInput } from "../src/client/ui/SecretInput.tsx";
import { SelectionRail } from "../src/client/ui/SelectionRail.tsx";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function SecretDemo({disabled=false}:{disabled?:boolean}) { const [value,setValue]=useState("fixture-input-only");return h(SecretInput,{"aria-label":"密钥",value,disabled,onChange:(event)=>setValue(event.target.value)}); }
describe("current-input secret visibility",()=>{
  it("keeps the same input, caret, text and input focus when toggled",()=>{
    render(h(SecretDemo));const input=screen.getByLabelText("密钥")as HTMLInputElement;input.focus();input.setSelectionRange(2,8,"backward");
    fireEvent.pointerDown(screen.getByRole("button",{name:"显示密钥"}));fireEvent.click(screen.getByRole("button",{name:"显示密钥"}));
    expect(screen.getByLabelText("密钥")).toBe(input);expect(input.type).toBe("text");expect(input.value).toBe("fixture-input-only");expect(input.selectionStart).toBe(2);expect(input.selectionEnd).toBe(8);expect(input.selectionDirection).toBe("backward");expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole("button",{name:"隐藏密钥"}));expect(input.type).toBe("password");
  });
  it("keeps keyboard focus on the toggle and remasks an empty input",()=>{
    render(h(SecretDemo));const toggle=screen.getByRole("button",{name:"显示密钥"});toggle.focus();fireEvent.click(toggle);expect(document.activeElement).toBe(toggle);
    fireEvent.change(screen.getByLabelText("密钥"),{target:{value:""}});expect((screen.getByLabelText("密钥")as HTMLInputElement).type).toBe("password");expect((screen.getByRole("button",{name:"显示密钥"})as HTMLButtonElement).disabled).toBe(true);
  });
  it("disables both controls and never fetches or persists a stored credential",()=>{
    const get=vi.spyOn(Storage.prototype,"getItem"),set=vi.spyOn(Storage.prototype,"setItem");render(h(SecretDemo,{disabled:true}));expect((screen.getByLabelText("密钥")as HTMLInputElement).disabled).toBe(true);expect((screen.getByRole("button",{name:"显示密钥"})as HTMLButtonElement).disabled).toBe(true);expect(get).not.toHaveBeenCalled();expect(set).not.toHaveBeenCalled();
  });
});
describe("accepted selection indicator",()=>{
  it("paints only the accepted selection, leaving unsaved guards in control",()=>{
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){const x=this.dataset.value==="B"?140:this.dataset.value==="A"?40:20;return {x,left:x,y:0,top:0,right:x+80,bottom:36,width:80,height:36,toJSON:()=>({})};});
    let accept=false;function Demo(){const [selected,setSelected]=useState("A");return h(SelectionRail,{selected,"aria-label":"选择"},["A","B"].map(value=>h("button",{key:value,"data-value":value,"aria-current":selected===value?"page":undefined,onClick:()=>{if(accept)setSelected(value);}},value)));}
    const view=render(h(Demo));const indicator=view.container.querySelector<HTMLElement>(".creatorSelectionIndicator")!;expect(indicator.style.transform).toBe("translate(20px, 34px) scaleX(80)");
    fireEvent.click(screen.getByText("B"));expect(indicator.style.transform).toBe("translate(20px, 34px) scaleX(80)");accept=true;fireEvent.click(screen.getByText("B"));expect(indicator.style.transform).toBe("translate(120px, 34px) scaleX(80)");expect(screen.getByText("B").getAttribute("aria-current")).toBe("page");
  });
  it("releases its resize and visibility subscriptions",()=>{
    const disconnect=vi.fn();vi.stubGlobal("ResizeObserver",class{observe(){}disconnect=disconnect;});const remove=vi.spyOn(document,"removeEventListener");
    const view=render(h(SelectionRail,{selected:"A"},h("button",{"aria-current":"page"},"A")));view.unmount();expect(disconnect).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledWith("visibilitychange",expect.any(Function));
  });
  it("positions the indicator under the selected row when platform buttons wrap",()=>{
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){const row=this.dataset.row==="second"?50:0;return {x:0,left:0,y:row,top:row,right:90,bottom:row+36,width:90,height:36,toJSON:()=>({})};});
    const content=(selected:string)=>h(SelectionRail,{selected},h("button",{"aria-current":selected==="A"?"page":undefined},"A"),h("button",{"data-row":"second","aria-current":selected==="B"?"page":undefined},"B"));
    const view=render(content("A")),line=view.container.querySelector<HTMLElement>(".creatorSelectionIndicator")!;expect(line.style.transform).toContain(", 34px)");view.rerender(content("B"));expect(line.style.transform).toContain(", 84px)");
  });
});
