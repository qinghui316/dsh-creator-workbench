import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { useControlMotion } from "./useControlMotion.ts";

/** Only the accepted ARIA selection owns this decorative indicator. */
export function SelectionRail({ selected, children, as = "nav", indicator = "surface", ...props }: {
  selected: string; children?: ReactNode; as?: "nav" | "div"; indicator?: "surface" | "underline";
} & HTMLAttributes<HTMLElement>) {
  const root = useRef<HTMLElement>(null), marker = useRef<HTMLSpanElement>(null);
  const primed = useRef(false), geometry = useRef(""), measure = useRef<(layout?: boolean) => void>(() => {});
  const motion = useControlMotion();
  useLayoutEffect(() => {
    const host = root.current, layer = marker.current;
    if (!host || !layer) return;
    const reveal = (item: HTMLElement) => {
      if (!host.clientWidth || host.scrollWidth <= host.clientWidth) return;
      const left = item.offsetLeft, right = left + item.offsetWidth;
      host.scrollLeft = Math.max(0, Math.min(left < host.scrollLeft ? left : right > host.scrollLeft + host.clientWidth ? right - host.clientWidth : host.scrollLeft, host.scrollWidth - host.clientWidth));
    };
    measure.current = (layout = false) => {
      const item = host.querySelector<HTMLElement>(':scope > button[aria-selected="true"],:scope > button[aria-current]:not([aria-current="false"]),:scope > button[aria-pressed="true"]');
      if (!item) { layer.hidden = true; return; }
      reveal(item);
      const underline = indicator === "underline";
      const style = underline ? getComputedStyle(item) : undefined;
      const insetLeft = style ? parseFloat(style.paddingLeft) || 0 : 0, insetRight = style ? parseFloat(style.paddingRight) || 0 : 0;
      const nextGeometry = `${item.offsetLeft}:${item.offsetTop}:${item.offsetWidth}:${item.offsetHeight}`;
      if (layout && geometry.current === nextGeometry) return;
      geometry.current = nextGeometry;
      layer.hidden = false;
      layer.style.transitionDuration = motion && primed.current && !layout ? "var(--creator-glide-duration)" : "0ms";
      layer.style.width = `${Math.max(0, item.offsetWidth - insetLeft - insetRight)}px`;
      layer.style.height = `${underline ? 2 : item.offsetHeight}px`;
      layer.style.transform = `translate(${item.offsetLeft + insetLeft}px, ${item.offsetTop + (underline ? item.offsetHeight - 3 : 0)}px)`;
      primed.current = true;
    };
    measure.current();
    // The first layout can be clamped again when a scrollable page mounts.
    // Recheck locally after layout settles; unchanged geometry keeps its transition.
    const frame = requestAnimationFrame(() => measure.current(true));
    return () => cancelAnimationFrame(frame);
  }, [selected, children, indicator, motion]);
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    const layout = () => measure.current(true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(layout) : undefined;
    observer?.observe(host);
    for (const item of host.children) if (item.tagName === "BUTTON") observer?.observe(item);
    const focus = (event: FocusEvent) => {
      const item = event.target instanceof HTMLElement ? event.target.closest("button") : null;
      if (item?.parentElement !== host || !item || host.scrollWidth <= host.clientWidth) return;
      host.scrollLeft = Math.max(0, Math.min(item.offsetLeft < host.scrollLeft ? item.offsetLeft : item.offsetLeft + item.offsetWidth > host.scrollLeft + host.clientWidth ? item.offsetLeft + item.offsetWidth - host.clientWidth : host.scrollLeft, host.scrollWidth - host.clientWidth));
    };
    host.addEventListener("focusin", focus); window.addEventListener("resize", layout);
    return () => { observer?.disconnect(); host.removeEventListener("focusin", focus); window.removeEventListener("resize", layout); };
  }, []);
  const Tag = as;
  return <Tag {...props} ref={root as React.Ref<HTMLElement & HTMLDivElement>} data-selection-rail={indicator}>
    <span ref={marker} className="creatorSelectionIndicator" aria-hidden="true" />{children}
  </Tag>;
}
