// @vitest-environment jsdom
import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretInput } from "../src/client/ui/SecretInput.tsx";
import { SelectionRail } from "../src/client/ui/SelectionRail.tsx";
import { ActionMenu } from "../src/client/ui/ActionMenu.tsx";
import { ActionButton } from "../src/client/ui/ActionButton.tsx";
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Button:({children,variant,size,...props}:Record<string,unknown>)=>h("button",props,children as never)}));
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
describe("local navigation visibility",()=>{
  function geometry(root:HTMLElement){Object.defineProperties(root,{clientWidth:{configurable:true,value:60},scrollWidth:{configurable:true,value:200}});for(const [i,button]of [...root.querySelectorAll("button")].entries())Object.defineProperties(button,{offsetLeft:{configurable:true,value:i*80},offsetWidth:{configurable:true,value:40}});}
  it("reveals only accepted selection without moving ancestor scroll positions",()=>{
    let accept=false;function Demo(){const [selected,setSelected]=useState("A");return h(SelectionRail,{selected,"aria-label":"选择"},["A","B"].map(value=>h("button",{key:value,"data-value":value,"aria-current":selected===value?"page":undefined,onClick:()=>{if(accept)setSelected(value);}},value)));}
    const view=render(h(Demo)),root=screen.getByRole("navigation");geometry(root);view.container.scrollTop=123;
    fireEvent.click(screen.getByText("B"));expect(root.scrollLeft).toBe(0);expect(screen.getByText("A").getAttribute("aria-current")).toBe("page");
    accept=true;fireEvent.click(screen.getByText("B"));expect(root.scrollLeft).toBe(60);expect(view.container.scrollTop).toBe(123);expect(screen.getByText("B").getAttribute("aria-current")).toBe("page");expect(root.querySelector(".creatorSelectionIndicator")).toBeNull();
  });
  it("releases resize/focus subscriptions and observer",()=>{
    const disconnect=vi.fn();vi.stubGlobal("ResizeObserver",class{observe(){}disconnect=disconnect;});const remove=vi.spyOn(window,"removeEventListener");
    const view=render(h(SelectionRail,{selected:"A"},h("button",{"aria-current":"page"},"A")));view.unmount();expect(disconnect).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledWith("resize",expect.any(Function));
  });
  it("reveals focused items and the accepted item after resizing",()=>{
    render(h(SelectionRail,{selected:"B"},h("button",{},"A"),h("button",{"aria-current":"page"},"B")));const root=screen.getByRole("navigation");geometry(root);fireEvent.resize(window);expect(root.scrollLeft).toBe(60);fireEvent.focusIn(screen.getByText("A"));expect(root.scrollLeft).toBe(0);
  });
});

describe("one-level action menus",()=>{
  it("opens from Enter and lets Tab leave through the normal document order",async()=>{
    render(h("div",{},h(ActionMenu,{label:"更多",children:h(ActionButton,{children:"导入"})}),h("button",{},"下一项")));
    const trigger=screen.getByRole("button",{name:"更多"});trigger.focus();const user=userEvent.setup();await user.keyboard("{Enter}");await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("menuitem")));await user.tab();expect(screen.queryByRole("menu")).toBeNull();expect(document.activeElement).toBe(screen.getByRole("button",{name:"下一项"}));
  });
  it("closes on Escape and restores trigger focus without invoking an action",()=>{
    const action=vi.fn();render(h(ActionMenu,{label:"更多",children:h(ActionButton,{onClick:action,children:"导入"})}));const trigger=screen.getByRole("button",{name:"更多"});fireEvent.click(trigger);fireEvent.keyDown(trigger,{key:"ArrowDown"});expect(document.activeElement).toBe(screen.getByRole("menuitem"));fireEvent.keyDown(document.activeElement!,{key:"Escape"});expect(screen.queryByRole("menu")).toBeNull();expect(document.activeElement).toBe(trigger);expect(action).not.toHaveBeenCalled();
  });
  it("runs the selected action once and dismisses on outside interaction",()=>{
    const action=vi.fn();render(h(ActionMenu,{label:"新建文章",children:h(ActionButton,{onClick:action,children:"独立文章"})}));const trigger=screen.getByRole("button",{name:"新建文章"});fireEvent.click(trigger);fireEvent.click(screen.getByRole("menuitem"));expect(action).toHaveBeenCalledOnce();expect(screen.queryByRole("menu")).toBeNull();fireEvent.click(trigger);fireEvent.pointerDown(document.body);expect(screen.queryByRole("menu")).toBeNull();expect(action).toHaveBeenCalledOnce();
  });
  it("closes after focus crosses an iframe boundary with no relatedTarget",async()=>{
    render(h("div",{},h(ActionMenu,{label:"更多",children:h(ActionButton,{children:"导入"})}),h("iframe",{title:"文章成品"})));
    const trigger=screen.getByRole("button",{name:"更多"});fireEvent.click(trigger);const item=screen.getByRole("menuitem");item.focus();const focus=vi.spyOn(trigger,"focus");vi.spyOn(document,"activeElement","get").mockReturnValue(screen.getByTitle("文章成品"));fireEvent.blur(item,{relatedTarget:null});await waitFor(()=>expect(screen.queryByRole("menu")).toBeNull());expect(focus).not.toHaveBeenCalled();
  });
});
