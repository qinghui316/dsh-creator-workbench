import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

/** An accepted selection paints the indicator; this component never chooses or delays it. */
export function SelectionRail({selected,children,as="nav",...props}:{selected:string;children?:ReactNode;as?:"nav"|"div"}&HTMLAttributes<HTMLElement>) {
  const root=useRef<HTMLElement>(null),indicator=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    const host=root.current,line=indicator.current;if(!host||!line)return;
    const paint=()=>{
      const item=host.querySelector<HTMLElement>(':scope > button[aria-selected="true"],:scope > button[aria-current]');
      if(!item){line.hidden=true;return;}
      const box=host.getBoundingClientRect(),target=item.getBoundingClientRect();
      line.hidden=target.width===0;
      line.style.transform=`translate(${target.left-box.left+host.scrollLeft}px, ${target.bottom-box.top+host.scrollTop-2}px) scaleX(${Math.max(0,target.width)})`;
    };
    paint();
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(paint):undefined;observer?.observe(host);
    const visibility=()=>{line.style.transition=document.hidden?"none":"";paint();};
    window.addEventListener("resize",paint);document.addEventListener("visibilitychange",visibility);return()=>{observer?.disconnect();window.removeEventListener("resize",paint);document.removeEventListener("visibilitychange",visibility);};
  },[selected,children]);
  const Tag=as;
  return <Tag {...props} ref={root as React.Ref<HTMLElement & HTMLDivElement>} data-selection-rail="true">{children}<span ref={indicator} className="creatorSelectionIndicator" aria-hidden="true"/></Tag>;
}
