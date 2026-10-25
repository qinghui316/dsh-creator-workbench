import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type HTMLAttributes } from "react";
import { ActionButton, type ActionTone } from "./ActionButton.tsx";
import "./ActionMenu.css";

/** A single-level action menu. Callers retain their existing guarded business handlers. */
export function ActionMenu({label,children,tone="ghost",align="start"}:{label:string;children:ReactNode;tone?:ActionTone;align?:"start"|"end"}) {
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement|null>(null),focusLast=useRef(false),id=useId();
  const items=()=>Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')??[]);
  useEffect(()=>{
    if(!open)return;
    const focusFrame=requestAnimationFrame(()=>{const buttons=items();buttons[focusLast.current?buttons.length-1:0]?.focus({preventScroll:true});});
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};
    document.addEventListener("pointerdown",outside);
    return()=>{cancelAnimationFrame(focusFrame);document.removeEventListener("pointerdown",outside);};
  },[open]);
  const close=(focus=true)=>{setOpen(false);if(focus&&trigger.current?.isConnected)trigger.current.focus({preventScroll:true});};
  return <div className="creatorMenu" data-menu-align={align} ref={root} onBlurCapture={event=>{
    if(event.relatedTarget instanceof Node){if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}
    else queueMicrotask(()=>{const host=root.current;if(host?.isConnected&&!host.contains(document.activeElement))setOpen(false);});
  }} onKeyDown={event=>{
    if(event.key==="Escape"&&open){event.preventDefault();event.stopPropagation();close();}
    if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)&&open){const buttons=items();if(!buttons.length)return;event.preventDefault();const i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==="Home"?0:event.key==="End"?buttons.length-1:i<0?event.key==="ArrowUp"?buttons.length-1:0:(i+(event.key==="ArrowUp"?-1:1)+buttons.length)%buttons.length]?.focus();}
  }}>
    <ActionButton tone={tone} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={event=>{trigger.current=event.currentTarget;focusLast.current=false;setOpen(value=>!value);}} onKeyDown={event=>{if(["ArrowDown","ArrowUp","Enter"," "].includes(event.key)&&!open){event.preventDefault();event.stopPropagation();trigger.current=event.currentTarget;focusLast.current=event.key==="ArrowUp";setOpen(true);}}}>{label}</ActionButton>
    {open&&<div id={id} role="menu" aria-label={label} className="creatorMenuItems" onClick={event=>{if(event.target instanceof Element&&event.target.closest('[role="menuitem"]:not(:disabled)'))close();}}>{Children.map(children,child=>isValidElement<HTMLAttributes<HTMLElement>>(child)?cloneElement(child,{role:"menuitem",tabIndex:-1}):child)}</div>}
  </div>;
}
