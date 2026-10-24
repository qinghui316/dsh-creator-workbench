import { useEffect, useState, useRef } from "react";
import type { ContentDetail } from "../types.ts";
import type { CreationImage } from "../production/types.ts";
import type { ProductionClient } from "./productionApi.ts";
const imageCaches = new WeakMap<ProductionClient,Map<string,Promise<string>>>();
export function ImageThumb({ image, detail, api, large = false }: { image: CreationImage; detail: ContentDetail; api: ProductionClient; large?: boolean }) {
  const node=useRef<HTMLSpanElement>(null), [visible,setVisible]=useState(typeof IntersectionObserver === "undefined");
  useEffect(()=>{ if(visible || !node.current) return; const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"160px"});observer.observe(node.current);return()=>observer.disconnect(); },[visible]);
  const key = `${detail.folderPath}:${image.id}:${image.sha256}`, [src, setSrc] = useState<string>(), [error, setError] = useState("");
  useEffect(() => { setSrc(undefined); setError(""); if (!api.image || !visible) return; let current = true;
    let cache=imageCaches.get(api);if(!cache){cache=new Map();imageCaches.set(api,cache);}const target=cache;
    let request=target.get(key);if(!request){request=api.image({ id: detail.id, folderPath: detail.folderPath, imageId: image.id }).then(r=>`data:${r.mime};base64,${r.base64}`,e=>{target.delete(key);throw e;});target.set(key,request);if(target.size>12)target.delete(target.keys().next().value!);}
    void request.then(url=>{if(current)setSrc(url);},(e:Error)=>{if(current)setError(e.message);});return()=>{current=false;};
  }, [key, api, visible]);
  return <span className="creationThumb" ref={node}>{src ? <img className={large ? "creationImageLarge" : "creationImageThumb"} src={src} loading="lazy" alt={image.purpose === "cover" ? "封面" : image.purpose === "card" ? "图文图片" : "正文配图"} /> : <span className="creatorMuted">{error || "读取图片…"}</span>}</span>;
}
