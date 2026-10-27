import { Children, Fragment, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type HTMLAttributes } from "react";
import { adjacentTabStop, placeOptionHighlight, useControlPopup } from "./useControlPopup.ts";
import { createPortal } from "react-dom";
import { ActionButton, type ActionTone } from "./ActionButton.tsx";
import "./ActionMenu.css";
import "./ControlPopup.css";

function menuChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child => isValidElement<{children?:ReactNode}>(child) && child.type === Fragment ? menuChildren(child.props.children) : [child]);
}

/** A single-level action menu. Callers retain their existing guarded business handlers. */
export function ActionMenu({label,ariaLabel,children,tone="ghost",align="start"}:{label:string;ariaLabel?:string;children:ReactNode;tone?:ActionTone;align?:"start"|"end"}) {
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement|null>(null),focusLast=useRef(false),id=useId();
  const highlight=useRef<HTMLSpanElement>(null), highlighted=useRef(false),highlightTarget=useRef<HTMLElement>();
  const layer=useControlPopup(open,()=>setOpen(false),root,trigger,popup,align,false,()=>{if(popup.current&&highlight.current&&highlightTarget.current&&popup.current.contains(highlightTarget.current))placeOptionHighlight(popup.current,highlightTarget.current,highlight.current,false);});
  const highlightItem=(item:HTMLElement)=>{highlightTarget.current=item;if(popup.current&&highlight.current){placeOptionHighlight(popup.current,item,highlight.current,highlighted.current&&layer.motion);highlighted.current=true;}};
  const items=()=>Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')??[]);
  useEffect(()=>{
    if(!open)return;
    highlighted.current=false;
    const focusFrame=requestAnimationFrame(()=>{const buttons=items();buttons[focusLast.current?buttons.length-1:0]?.focus({preventScroll:true});});
    return()=>cancelAnimationFrame(focusFrame);
  },[open]);
  const close=(focus=true)=>{setOpen(false);if(focus&&trigger.current?.isConnected)trigger.current.focus({preventScroll:true});};
  return <div className="creatorMenu" data-menu-align={align} ref={root} onBlurCapture={event=>{
    if(event.relatedTarget instanceof Node){if(!event.currentTarget.contains(event.relatedTarget)&&!popup.current?.contains(event.relatedTarget))setOpen(false);}
    else queueMicrotask(()=>{const host=root.current;if(host?.isConnected&&!host.contains(document.activeElement)&&!popup.current?.contains(document.activeElement))setOpen(false);});
  }} onKeyDown={event=>{
    if(event.key==="Tab"&&open){const next=trigger.current?adjacentTabStop(trigger.current,event.shiftKey,popup.current):undefined;close(false);if(next){event.preventDefault();next.focus({preventScroll:true});}return;}
    if(event.key==="Escape"&&open){event.preventDefault();event.stopPropagation();close();}
    if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)&&open){const buttons=items();if(!buttons.length)return;event.preventDefault();const i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==="Home"?0:event.key==="End"?buttons.length-1:i<0?event.key==="ArrowUp"?buttons.length-1:0:(i+(event.key==="ArrowUp"?-1:1)+buttons.length)%buttons.length]?.focus({preventScroll:true});}
  }}>
    <ActionButton tone={tone} aria-label={ariaLabel??label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={event=>{trigger.current=event.currentTarget;focusLast.current=false;setOpen(value=>!value);}} onKeyDown={event=>{if(["ArrowDown","ArrowUp","Enter"," "].includes(event.key)&&!open){event.preventDefault();event.stopPropagation();trigger.current=event.currentTarget;focusLast.current=event.key==="ArrowUp";setOpen(true);}}}>{label}</ActionButton>
    {layer.mounted&&createPortal(<div ref={popup} data-plugin="dsh-creator-workbench" id={id} role={open?"menu":undefined} aria-hidden={!open||undefined} aria-label={open?ariaLabel??label:undefined} data-phase={layer.phase} data-motion={layer.motion} className="creatorMenuItems creatorControlPopup" onFocusCapture={event=>{if(event.target instanceof HTMLElement&&event.target.getAttribute("role")==="menuitem")highlightItem(event.target);}} onPointerMove={event=>{const item=event.target instanceof Element?event.target.closest<HTMLElement>('[role="menuitem"]:not(:disabled)'):null;if(item&&open)highlightItem(item);}} onClick={event=>{if(open&&event.target instanceof Element&&event.target.closest('[role="menuitem"]:not(:disabled)'))close();}}><span ref={highlight} className="creatorOptionHighlight" aria-hidden="true" />{menuChildren(children).map((child,index)=>isValidElement<HTMLAttributes<HTMLElement>>(child)?cloneElement(child,{key:index,role:"menuitem",tabIndex:-1}):child)}</div>,document.body)}
  </div>;
}
