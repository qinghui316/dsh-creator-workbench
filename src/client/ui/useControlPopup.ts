import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useControlMotion } from "./useControlMotion.ts";

/** Shared geometry and lifetime; callers retain their own menu/listbox keyboard semantics. */
export function useControlPopup(open: boolean, close: () => void, root: RefObject<HTMLElement>, anchor: RefObject<HTMLElement>, popup: RefObject<HTMLDivElement>, align: "start" | "end" = "start", matchWidth = false, onLayout?: () => void) {
  const motion = useControlMotion(), [exiting, setExiting] = useState(false);
  const lastOpen = useRef(open), current = useRef({ open, close, onLayout });
  current.current = { open, close, onLayout };
  const mounted = open || exiting || motion && lastOpen.current;
  useLayoutEffect(() => {
    const wasOpen = lastOpen.current; lastOpen.current = open;
    if (open) { setExiting(false); return; }
    if (!wasOpen || !motion) { setExiting(false); return; }
    setExiting(true);
    const timer = setTimeout(() => setExiting(false), 120);
    return () => clearTimeout(timer);
  }, [open, motion]);
  useLayoutEffect(() => {
    const layer = popup.current, trigger = anchor.current;
    if (!mounted || !layer || !trigger) return;
    const place = () => {
      const bounds = root.current?.closest('[data-plugin="dsh-creator-workbench"]')?.getBoundingClientRect();
      const a = trigger.getBoundingClientRect();
      const left = Math.max(0, bounds?.left ?? 0) + 4, right = Math.min(window.innerWidth, bounds?.right ?? window.innerWidth) - 4;
      const top = Math.max(0, bounds?.top ?? 0) + 4, bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 4;
      layer.style.maxWidth = `${Math.max(0, right - left)}px`;
      if (matchWidth) layer.style.width = `${Math.min(a.width, Math.max(0, right - left))}px`;
      const below = bottom - a.bottom - 4, above = a.top - top - 4;
      const upward = below < Math.min(layer.scrollHeight, 280) && above > below;
      layer.style.maxHeight = `${Math.max(0, Math.min(360, upward ? above : below))}px`;
      if (layer.showPopover) {
        layer.setAttribute("popover", "manual");
        if (!layer.matches(":popover-open")) layer.showPopover();
      }
      layer.style.position = "fixed";
      layer.style.left = `${Math.max(left, Math.min(align === "end" ? a.right - layer.offsetWidth : a.left, right - layer.offsetWidth))}px`;
      layer.style.top = `${Math.max(top, upward ? a.top - layer.offsetHeight - 4 : a.bottom + 4)}px`;
      layer.dataset.direction = upward ? "up" : "down";
      current.current.onLayout?.();
    };
    place();
    const outside = (event: PointerEvent) => { if (current.current.open && event.target instanceof Node && !root.current?.contains(event.target) && !layer.contains(event.target)) current.current.close(); };
    const scrolled = (event: Event) => { if (current.current.open && event.target instanceof Node && !layer.contains(event.target)) current.current.close(); };
    document.addEventListener("pointerdown", outside); document.addEventListener("scroll", scrolled, true); window.addEventListener("resize", place);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : undefined;
    observer?.observe(trigger); observer?.observe(layer);
    return () => {
      observer?.disconnect(); document.removeEventListener("pointerdown", outside); document.removeEventListener("scroll", scrolled, true); window.removeEventListener("resize", place);
      if (layer.hidePopover && layer.matches(":popover-open")) layer.hidePopover();
    };
  }, [mounted, align, matchWidth]);
  return { mounted, phase: open ? "open" : "closing", motion };
}

/** Move the highlight in scroll-content coordinates, never moving focus or ancestors. */
export function placeOptionHighlight(layer: HTMLElement, item: HTMLElement, marker: HTMLElement, animate: boolean) {
  const top = item.offsetTop, bottom = top + item.offsetHeight;
  if (top < layer.scrollTop) layer.scrollTop = top;
  else if (bottom > layer.scrollTop + layer.clientHeight && layer.clientHeight) layer.scrollTop = bottom - layer.clientHeight;
  marker.style.transitionDuration = animate ? "var(--creator-glide-duration)" : "0ms";
  marker.style.transform = `translate(${item.offsetLeft}px, ${top}px)`;
  marker.style.width = `${item.offsetWidth}px`; marker.style.height = `${item.offsetHeight}px`;
}

/** A portaled menu leaves from its trigger's place in the document, not the end of body. */
export function adjacentTabStop(anchor: HTMLElement, backwards: boolean, popup: HTMLElement | null) {
  const stops = [...document.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex]')].filter(item => {
    if (item.tabIndex < 0 || item.matches(':disabled') || popup?.contains(item) || item.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let parent: HTMLElement | null = item; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
  stops.sort((a,b) => (a.tabIndex || Number.MAX_SAFE_INTEGER) - (b.tabIndex || Number.MAX_SAFE_INTEGER));
  const position = stops.indexOf(anchor);
  return position < 0 ? undefined : stops[position + (backwards ? -1 : 1)];
}
