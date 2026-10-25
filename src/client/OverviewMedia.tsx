import { useEffect, useRef, useState } from "react";
import type { ContentDetail } from "../types.ts";
import type { CoverVersion } from "../covers/types.ts";
import type { CreatorViewFace } from "./face.ts";

export function OverviewVideo({detail,getVideoPlayback}:{detail:ContentDetail;getVideoPlayback:CreatorViewFace["getVideoPlayback"]}) {
  const player=useRef<HTMLVideoElement>(null), [url,setUrl]=useState<string>(),[error,setError]=useState("");
  const video=detail.videos?.find(v=>v.name===detail.selectedVideo);
  useEffect(()=>{
    let live=true; player.current?.pause(); setUrl(undefined); setError("");
    if(detail.videoSelection!=="selected") return;
    void getVideoPlayback(detail.id).then(value=>{if(live){if(value.found)setUrl(value.url);else setError("当前视频无法读取，请在视频页重新选择。");}},e=>{if(live)setError(e instanceof Error?e.message:"视频读取失败");});
    return()=>{live=false;player.current?.pause();};
  },[detail.folderPath,detail.selectedVideo,detail.videoSelection,video?.modifiedAt,video?.size,getVideoPlayback]);
  useEffect(()=>{const element=player.current;return()=>element?.pause();},[url]);
  return <>{url ? <video ref={player} className="overviewVideo" aria-label="概览视频预览" src={url} controls preload="metadata" onError={()=>setError("浏览器无法播放此编码，请在视频页核对文件。")} /> : !error && <p className="creatorMuted" role="status">正在读取视频…</p>}{error && <p className="creatorError" role="alert">{error}</p>}</>;
}

const coverCaches=new WeakMap<CreatorViewFace["getCoverImage"],Map<string,Promise<string>>>();
export function invalidateOverviewCover(folder:string,version:CoverVersion,getCoverImage:CreatorViewFace["getCoverImage"]) {coverCaches.get(getCoverImage)?.delete(`${folder}:${version.id}:${version.file}`);}
export function loadOverviewCover(detail:ContentDetail,version:CoverVersion,getCoverImage:CreatorViewFace["getCoverImage"]):Promise<string> {
  let cache=coverCaches.get(getCoverImage);if(!cache){cache=new Map();coverCaches.set(getCoverImage,cache);}
  const key=`${detail.folderPath}:${version.id}:${version.file}`,target=cache;
  let request=target.get(key);if(!request){request=getCoverImage({id:detail.id,folderPath:detail.folderPath,versionId:version.id}).then(r=>`data:${r.mime};base64,${r.base64}`,error=>{target.delete(key);throw error;});target.set(key,request);if(target.size>12)target.delete(target.keys().next().value!);}
  return request;
}
export function OverviewCover({version,detail,getCoverImage}:{version:CoverVersion;detail:ContentDetail;getCoverImage:CreatorViewFace["getCoverImage"]}) {
  const node=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(typeof IntersectionObserver==="undefined"),[src,setSrc]=useState<string>(),[error,setError]=useState("");
  useEffect(()=>{if(visible||!node.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"160px"});observer.observe(node.current);return()=>observer.disconnect();},[visible]);
  useEffect(()=>{
    let live=true; setSrc(undefined);setError("");if(!visible)return;
    const request=loadOverviewCover(detail,version,getCoverImage);
    void request.then(value=>{if(live)setSrc(value);},e=>{if(live)setError(e instanceof Error?e.message:"封面读取失败");});
    return()=>{live=false;};
  },[visible,detail.folderPath,version.id,version.file,getCoverImage]);
  return <span ref={node} className="overviewCover">{src?<img src={src} alt={`${version.ratio.replace("x",":")} 视频封面`} loading="lazy"/>:<span className="creatorMuted">{error||"读取封面…"}</span>}</span>;
}
