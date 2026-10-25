import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import "./ImagePreview.css";

/** A viewer consumes immutable media, never an editor or a business action. */
export interface PreviewImage {
  id: string;
  title: string;
  revision?: string;
  src?: string;
  load?: (signal: AbortSignal) => string | Promise<string>;
  reload?: () => void;
}
type ImageIdentity = Pick<PreviewImage, "id" | "revision">;
interface PreviewRequest { images: PreviewImage[]; index: number; owner: string; trigger?: HTMLElement | undefined }
interface PreviewApi {
  open: (images: PreviewImage[], id: string, owner: string, trigger?: HTMLElement) => void;
  reconcile: (owner: string, images: readonly ImageIdentity[]) => void;
  dismiss: (owner: string, restore?: boolean) => void;
}
const Context = createContext<PreviewApi | undefined>(undefined);

/** Each entrance owns its lifetime; removing a source or unmounting closes its viewer. */
export function useImagePreview(available?: readonly ImageIdentity[]) {
  const api = useContext(Context), owner = useId();
  useLayoutEffect(() => { if (available) api?.reconcile(owner, available); }, [api, owner, available]);
  useEffect(() => () => api?.dismiss(owner, false), [api, owner]);
  return {
    open: (images: PreviewImage[], id: string, trigger?: HTMLElement) => {
      if (!api) throw new Error("图片预览未接入当前业务区域。");
      api.open(images, id, owner, trigger);
    },
    dismiss: () => api?.dismiss(owner, false),
  };
}

export function ImagePreviewProvider({ children }: { children: ReactNode }) {
  const parent = useContext(Context);
  return parent ? <>{children}</> : <ImagePreviewScope>{children}</ImagePreviewScope>;
}
function topLayer(dialog: HTMLElement | null) {
  const top = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="menu"]')].at(-1);
  return Boolean(dialog && top === dialog);
}
function ImagePreviewScope({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PreviewRequest>(), [closing, setClosing] = useState(false);
  const current = useRef(request); current.current = request;
  const availableOwners=useRef(new Map<string,readonly ImageIdentity[]>());
  const anchor = useRef<HTMLSpanElement>(null), frame = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(), restoreTimer = useRef<ReturnType<typeof setTimeout>>();
  const alive = useRef(true), pointerInside = useRef(false);
  const clear = useCallback((restore: boolean) => {
    const previous = current.current;
    clearTimeout(timer.current); timer.current = undefined; current.current = undefined; setRequest(undefined); setClosing(false);
    clearTimeout(restoreTimer.current);
    if (restore && previous) restoreTimer.current = setTimeout(() => {
      if (!alive.current || current.current) return;
      const trigger = previous.trigger;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else anchor.current?.closest('[data-surface="inspector"]')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    }, 0);
  }, []);
  const close = useCallback((restore = true) => {
    if (!current.current) return;
    if (!restore || document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { clear(restore); return; }
    setClosing(true); clearTimeout(timer.current); timer.current = setTimeout(() => clear(true), 120);
  }, [clear]);
  const availableRequest=useCallback(()=>{
    const value=current.current;if(!value)return;
    const allowed=availableOwners.current.get(value.owner);if(!allowed)return value;
    const item=value.images[value.index],images=value.images.filter(image=>allowed.some(valid=>valid.id===image.id&&valid.revision===image.revision));
    const index=images.findIndex(image=>image===item);
    if(index<0){close(false);return;}
    if(images.length!==value.images.length){const next={...value,images,index};current.current=next;setRequest(next);return next;}
    return value;
  },[close]);
  const api = useRef<PreviewApi>();
  if (!api.current) api.current = {
    open: (images, id, owner, trigger) => {
      const allowed=availableOwners.current.get(owner);
      const valid=allowed?images.filter(image=>allowed.some(value=>value.id===image.id&&value.revision===image.revision)):images;
      const index = valid.findIndex(image => image.id === id); if (index < 0) return;
      clearTimeout(timer.current); clearTimeout(restoreTimer.current); setClosing(false);
      const next = { images: [...valid], index, owner, trigger: trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined) };
      current.current = next; setRequest(next);
    },
    reconcile: (owner, images) => {
      availableOwners.current.set(owner,images);
      if(current.current?.owner===owner)availableRequest();
    },
    dismiss: (owner, restore = false) => { availableOwners.current.delete(owner);if (current.current?.owner === owner) close(restore); },
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); clearTimeout(restoreTimer.current); }; }, []);
  const move = useCallback((delta: number) => {
    const value = availableRequest(); if (!value) return;
    const index = value.index + delta;
    if (index >= 0 && index < value.images.length) { const next = { ...value, index }; current.current = next; setRequest(next); }
  }, [availableRequest]);
  const open = Boolean(request);
  let hostModal=false;try{hostModal=typeof Modal === "function";}catch{/* Older hosts use the plugin Portal adapter. */}
  useEffect(() => {
    if (!open) return;
    const dialog = frame.current?.closest<HTMLElement>('[role="dialog"]') ?? frame.current;
    if (!hostModal) dialog?.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus({ preventScroll: true });
    const body = anchor.current?.closest('[data-surface="inspector"]')?.querySelector<HTMLElement>(".body");
    const overflow = body?.style.overflow;
    if (body) body.style.overflow = "hidden";
    const pointer = (event: PointerEvent) => { pointerInside.current = Boolean(dialog?.contains(event.target as Node)); };
    const keyboard = (event: KeyboardEvent) => {
      if (!topLayer(dialog ?? null) || event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") pointerInside.current = false;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); move(event.key === "ArrowLeft" ? -1 : 1); }
      if (hostModal) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const items = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]') ?? [])], first = items[0], last = items.at(-1), active = document.activeElement;
        if (!dialog?.contains(active) || event.shiftKey && active === first || !event.shiftKey && active === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      }
    };
    const visibility = () => { if (document.hidden && timer.current) clear(true); };
    document.addEventListener("pointerdown", pointer, true); document.addEventListener("keydown", keyboard, true); document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("pointerdown", pointer, true); document.removeEventListener("keydown", keyboard, true); document.removeEventListener("visibilitychange", visibility);
      if (body?.style.overflow === "hidden") body.style.overflow = overflow ?? "";
    };
  }, [open, hostModal, close, move, clear]);
  const item = request?.images[request.index];
  const dismissMask = () => { if(topLayer(frame.current?.closest<HTMLElement>('[role="dialog"]')??null)&&!pointerInside.current)close();pointerInside.current=false; };
  const content = request && item && <div ref={frame} data-plugin="dsh-creator-workbench" data-lightbox-phase={closing ? "closing" : "open"} className="creatorLightboxContent">
    <button data-modal-autofocus type="button" className="creatorLightboxClose creatorLightboxControl" aria-label="关闭图片" onClick={() => close()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    {request.images.length > 1 && <>
      <button type="button" className="creatorLightboxPrevious creatorLightboxControl" aria-label="上一张" disabled={request.index === 0} onClick={() => move(-1)}><Arrow direction="left" /></button>
      <button type="button" className="creatorLightboxNext creatorLightboxControl" aria-label="下一张" disabled={request.index === request.images.length - 1} onClick={() => move(1)}><Arrow direction="right" /></button>
      <span className="creatorLightboxCount" aria-live="polite">{request.index + 1} / {request.images.length}</span>
    </>}
    <PreviewMedia key={`${item.id}:${item.revision ?? ""}`} image={item} active={!closing} />
  </div>;
  return <Context.Provider value={api.current}>{children}<span ref={anchor} hidden />{request && item && (hostModal ?
    <Modal open headless backdropBlur={false} title={item.title} className={`creatorLightbox ${closing ? "creatorLightboxClosing" : ""}`} onClose={dismissMask}>{content}</Modal> :
    createPortal(<div className={`creatorLightboxFallback ${closing ? "creatorLightboxClosing" : ""}`} onClick={event => { if (event.target === event.currentTarget) dismissMask(); }}><div role="dialog" aria-modal="true" aria-label={item.title} className="creatorLightbox">{content}</div></div>, document.body))}</Context.Provider>;
}
function PreviewMedia({ image, active }: { image: PreviewImage; active: boolean }) {
  const [src, setSrc] = useState(image.src), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); if (!active) return () => controller.abort();
    setError(""); setSrc(image.src);
    if (!image.src) void Promise.resolve().then(() => image.load?.(controller.signal)).then(value => {
      if (!controller.signal.aborted) { if (value) setSrc(value); else setError("图片无法读取"); }
    }, cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "图片无法读取"); });
    return () => controller.abort();
  }, [image, retry, active]);
  return src && !error ? <img className="creatorLightboxImage" src={src} alt={image.title} draggable={false} onError={() => setError("图片无法显示")} /> :
    <div className="creatorLightboxMessage" role={error ? "alert" : "status"}>{error || "正在读取图片…"}{error && <button type="button" onClick={() => { image.reload?.(); setRetry(value => value + 1); }}>重试</button>}</div>;
}
function Arrow({ direction }: { direction: "left" | "right" }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} /></svg>;
}
