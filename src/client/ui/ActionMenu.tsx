import { Children, Fragment, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type HTMLAttributes } from "react";
import { ActionButton, type ActionTone } from "./ActionButton.tsx";
import "./ActionMenu.css";

function menuChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child => isValidElement<{children?:ReactNode}>(child) && child.type === Fragment ? menuChildren(child.props.children) : [child]);
}

/** A single-level action menu. Callers retain their existing guarded business handlers. */
export function ActionMenu({label,ariaLabel,children,tone="ghost",align="start"}:{label:string;ariaLabel?:string;children:ReactNode;tone?:ActionTone;align?:"start"|"end"}) {
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement|null>(null),focusLast=useRef(false),id=useId();
  const items=()=>Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')??[]);
  useEffect(()=>{
    if(!open)return;
    const layer=popup.current;
    const place=()=>{
      if(!layer?.showPopover||!trigger.current)return;
      layer.setAttribute("popover","manual");
      if(!layer.matches(":popover-open"))layer.showPopover();
      const anchor=trigger.current.getBoundingClientRect(),bounds=root.current?.closest('[data-plugin="dsh-creator-workbench"]')?.getBoundingClientRect();
      const left=bounds?.left??0,right=bounds?.right??window.innerWidth,bottom=Math.min(bounds?.bottom??window.innerHeight,window.innerHeight);
      layer.style.maxWidth=`${Math.max(0,right-left-8)}px`;
      layer.style.left=`${Math.max(left+4,Math.min(align==="end"?anchor.right-layer.offsetWidth:anchor.left,right-layer.offsetWidth-4))}px`;
      layer.style.top=`${Math.max(bounds?.top??0,anchor.bottom+4+layer.offsetHeight>bottom?anchor.top-layer.offsetHeight-4:anchor.bottom+4)}px`;
    };
    const focusFrame=requestAnimationFrame(()=>{place();const buttons=items();buttons[focusLast.current?buttons.length-1:0]?.focus({preventScroll:true});});
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};
    const scrolled=(event:Event)=>{if(event.target instanceof Node&&!layer?.contains(event.target))setOpen(false);};
    document.addEventListener("pointerdown",outside);
    document.addEventListener("scroll",scrolled,true);
    window.addEventListener("resize",place);
    return()=>{cancelAnimationFrame(focusFrame);window.removeEventListener("resize",place);document.removeEventListener("scroll",scrolled,true);document.removeEventListener("pointerdown",outside);if(layer?.hidePopover&&layer.matches(":popover-open"))layer.hidePopover();};
  },[open]);
  const close=(focus=true)=>{setOpen(false);if(focus&&trigger.current?.isConnected)trigger.current.focus({preventScroll:true});};
  return <div className="creatorMenu" data-menu-align={align} ref={root} onBlurCapture={event=>{
    if(event.relatedTarget instanceof Node){if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}
    else queueMicrotask(()=>{const host=root.current;if(host?.isConnected&&!host.contains(document.activeElement))setOpen(false);});
  }} onKeyDown={event=>{
    if(event.key==="Escape"&&open){event.preventDefault();event.stopPropagation();close();}
    if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)&&open){const buttons=items();if(!buttons.length)return;event.preventDefault();const i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==="Home"?0:event.key==="End"?buttons.length-1:i<0?event.key==="ArrowUp"?buttons.length-1:0:(i+(event.key==="ArrowUp"?-1:1)+buttons.length)%buttons.length]?.focus();}
  }}>
    <ActionButton tone={tone} aria-label={ariaLabel??label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={event=>{trigger.current=event.currentTarget;focusLast.current=false;setOpen(value=>!value);}} onKeyDown={event=>{if(["ArrowDown","ArrowUp","Enter"," "].includes(event.key)&&!open){event.preventDefault();event.stopPropagation();trigger.current=event.currentTarget;focusLast.current=event.key==="ArrowUp";setOpen(true);}}}>{label}</ActionButton>
    {open&&<div ref={popup} data-plugin="dsh-creator-workbench" id={id} role="menu" aria-label={ariaLabel??label} className="creatorMenuItems" onClick={event=>{if(event.target instanceof Element&&event.target.closest('[role="menuitem"]:not(:disabled)'))close();}}>{menuChildren(children).map((child,index)=>isValidElement<HTMLAttributes<HTMLElement>>(child)?cloneElement(child,{key:index,role:"menuitem",tabIndex:-1}):child)}</div>}
  </div>;
}
