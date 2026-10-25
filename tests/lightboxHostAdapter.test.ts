// @vitest-environment jsdom
import { createElement as h, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePreviewProvider, useImagePreview } from "../src/client/ImagePreview.tsx";
const observed=vi.hoisted(()=>({headless:false,blur:true}));
// The public primitive contract is isolated here; the actual host layer is checked in Desktop acceptance.
vi.mock("@deepseek-ai/dsh-client-ui-primitives",()=>({Modal:({headless,backdropBlur,title,className,onClose,children}:Record<string,unknown>)=>{
  observed.headless=Boolean(headless);observed.blur=Boolean(backdropBlur);const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{ref.current?.querySelector<HTMLElement>("button")?.focus();},[]);
  return createPortal(h("div",null,h("button",{"aria-label":"宿主遮罩",onClick:onClose as ()=>void}),h("div",{ref,role:"dialog","aria-modal":true,"aria-label":title as string,className:className as string},children as React.ReactNode)),document.body);
}}));
afterEach(cleanup);
function Demo(){const preview=useImagePreview();return h("button",{onClick:(event:React.MouseEvent<HTMLButtonElement>)=>preview.open([{id:"one",title:"宿主图片",src:"data:image/png;base64,YWJj"}],"one",event.currentTarget)},"查看");}
describe("public host Modal adapter",()=>{
  it("requests headless media rendering and routes the public mask callback to close/focus restoration",async()=>{
    const view=render(h(ImagePreviewProvider,null,h(Demo)));const trigger=screen.getByText("查看");trigger.focus();fireEvent.click(trigger);
    expect(observed).toEqual({headless:true,blur:false});const dialog=screen.getByRole("dialog",{name:"宿主图片"});expect(view.container.contains(dialog)).toBe(false);expect(dialog.querySelector("h2")).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button",{name:"宿主遮罩"}));fireEvent.click(screen.getByRole("button",{name:"宿主遮罩"}));await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());await waitFor(()=>expect(document.activeElement).toBe(trigger));
  });
});
