import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

/** Keep accepted selection/focus visible without scrolling any ancestor or choosing a page. */
export function SelectionRail({selected,children,as="nav",...props}:{selected:string;children?:ReactNode;as?:"nav"|"div"}&HTMLAttributes<HTMLElement>) {
  const root=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const host=root.current;if(!host)return;
    const reveal=(item:HTMLElement|null)=>{
      if(!item||!host.clientWidth||host.scrollWidth<=host.clientWidth)return;
      const left=item.offsetLeft,right=left+item.offsetWidth;
      const next=left<host.scrollLeft?left:right>host.scrollLeft+host.clientWidth?right-host.clientWidth:host.scrollLeft;
      host.scrollLeft=Math.max(0,Math.min(next,host.scrollWidth-host.clientWidth));
    };
    const current=()=>reveal(host.querySelector<HTMLElement>(':scope > button[aria-selected="true"],:scope > button[aria-current]'));
    const focus=(event:FocusEvent)=>{const item=event.target instanceof HTMLElement?event.target.closest("button"):null;if(item?.parentElement===host)reveal(item);};
    current();
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(current):undefined;observer?.observe(host);
    for(const item of host.children)observer?.observe(item);
    host.addEventListener("focusin",focus);window.addEventListener("resize",current);
    return()=>{observer?.disconnect();host.removeEventListener("focusin",focus);window.removeEventListener("resize",current);};
  },[selected,children]);
  const Tag=as;
  return <Tag {...props} ref={root as React.Ref<HTMLElement & HTMLDivElement>} data-selection-rail="true">{children}</Tag>;
}
