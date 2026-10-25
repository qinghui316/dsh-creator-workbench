import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActionButton } from "./ui/ActionButton.tsx";
import "./ImagePreview.css";

export interface PreviewImage { id: string; title: string; content: ReactNode; actions?: ReactNode; reload?: () => void }
interface PreviewRequest { images: PreviewImage[]; index: number; trigger?: HTMLElement | undefined }
type PreviewApi = { open: (images: PreviewImage[], id: string, trigger?: HTMLElement) => void };
const Context = createContext<PreviewApi | undefined>(undefined);
export function useImagePreview(): PreviewApi {
  return useContext(Context) ?? { open: () => { throw new Error("图片预览未接入当前业务区域。"); } };
}
export function ImagePreviewProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PreviewRequest>(), [retry, setRetry] = useState(0);
  const [imageFailed,setImageFailed] = useState(false);
  useEffect(()=>setImageFailed(false),[request?.index,retry,request?.images]);
  const dialog = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null), backdropDown = useRef(false);
  const close = (restore=true) => { const trigger = request?.trigger,root=dialog.current?.closest('[data-surface="inspector"]'); setRequest(undefined); if(restore)queueMicrotask(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); else root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({preventScroll:true}); }); };
  useEffect(() => {
    if (!request) return;
    closeButton.current?.focus({ preventScroll: true });
    const body = dialog.current?.closest('[data-surface="inspector"]')?.querySelector<HTMLElement>(".body");
    const old = body?.style.overflow;
    if (body) body.style.overflow = "hidden";
    const outside=(event:MouseEvent)=>{const target=event.target;if(target instanceof Node&&!dialog.current?.parentElement?.contains(target))close(false);};
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();return;}
      if(event.key!=="Tab")return;
      const items=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')??[])];
      const first=items[0],last=items.at(-1),active=document.activeElement;
      if(!dialog.current?.contains(active)||event.shiftKey&&active===first||!event.shiftKey&&active===last){event.preventDefault();(event.shiftKey?last:first)?.focus();}
    };
    document.addEventListener("click",outside,true);
    // A pointer click on the image can move Chromium's focus to body. Keep
    // modal keys active there without changing shortcuts after the modal closes.
    document.addEventListener("keydown",keyboard,true);
    return () => { document.removeEventListener("click",outside,true);document.removeEventListener("keydown",keyboard,true);if (body && body.style.overflow === "hidden") body.style.overflow = old ?? ""; };
  }, [Boolean(request)]);
  const item = request?.images[request.index];
  return <Context.Provider value={{ open: (images, id, trigger) => { const index = images.findIndex(i => i.id === id); if (index >= 0) { setRetry(0); setRequest({ images, index, trigger: trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined) }); } } }}>
    {children}
    {request && item && <div className="creatorImageOverlay" onPointerDown={e => { backdropDown.current = e.target === e.currentTarget; }} onClick={e => { if (backdropDown.current && e.target === e.currentTarget) close(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={item.title} className="creatorImageDialog">
        <div className="creatorImageDialogHeader"><span>{item.title}</span><button ref={closeButton} type="button" className="creatorImageClose" onClick={()=>close()}>关闭</button></div>
        <div className="creatorImageCanvas" key={`${item.id}:${retry}`} onErrorCapture={e=>{if(e.target instanceof HTMLImageElement)setImageFailed(true);}}>{item.content}</div>
        {imageFailed&&<p role="alert" className="creatorError">图片无法显示，请重新读取图片或关闭预览。</p>}
        <div className="creatorImageDialogActions">{request.images.length > 1 && <><ActionButton disabled={request.index === 0} onClick={() => setRequest({ ...request, index: request.index - 1 })}>上一张</ActionButton><span>{request.index + 1} / {request.images.length}</span><ActionButton disabled={request.index === request.images.length - 1} onClick={() => setRequest({ ...request, index: request.index + 1 })}>下一张</ActionButton></>}{item.actions}<ActionButton tone="ghost" onClick={() => {item.reload?.();setRetry(n => n + 1);}}>重新读取图片</ActionButton></div>
      </div>
    </div>}
  </Context.Provider>;
}
