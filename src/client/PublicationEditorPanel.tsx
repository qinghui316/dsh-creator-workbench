import { publicationText } from "./publicationText.ts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ContentDetail } from "../types.ts";
import type { ProductionAction, PublicationInput, UploadNotice } from "../production/types.ts";
import { PublicationEditor, type PublicationEditors } from "./publicationAutosave.ts";
import { useProjectData } from "./ProjectData.tsx";
import { localFilePath, type ProductionClient } from "./productionApi.ts";
import type { CreatorViewFace } from "./face.ts";
import { ImageThumb, invalidateImageThumb } from "./ImageThumb.tsx";
import { OverviewCover, invalidateOverviewCover } from "./OverviewMedia.tsx";
import { useImagePreview } from "./ImagePreview.tsx";
import { ArticlePreview } from "./ArticlePreview.tsx";
import { PublicationResults } from "./PublicationResults.tsx";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";

export function PublicationEditorPanel({ editor, manager, detail, api, accountId, onRemoved, getCoverImage }: { editor: PublicationEditor; manager: PublicationEditors; detail: ContentDetail; api: ProductionClient; accountId: string | undefined; onRemoved: () => void; getCoverImage?: CreatorViewFace["getCoverImage"] }) {
  const snap=useSyncExternalStore(editor.subscribe,editor.getSnapshot),input=snap.input, data=useProjectData(api,detail), scope={id:detail.id,folderPath:detail.folderPath};
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[rights,setRights]=useState(false),[tags,setTags]=useState(input.tags.join("，")),[picker,setPicker]=useState(false),[request,setRequest]=useState("");
  const tagValue=JSON.stringify(input.tags),tagBaseline=useRef(tagValue);
  useEffect(()=>{if(tagBaseline.current!==tagValue){tagBaseline.current=tagValue;setTags(input.tags.join("，"));}},[tagValue]);
  const [ownedUploadNotice,setUploadNotice]=useState<UploadNotice & {ownerAccountId:string|undefined}>();
  const uploadNotice=ownedUploadNotice?.ownerAccountId===accountId?ownedUploadNotice:undefined;
  const [preview,setPreview]=useState<{html:string;revision:number}>(),[previewBusy,setPreviewBusy]=useState(false);
  const alive=useRef(true),mutating=useRef(false),readTicket=useRef(0),previewTicket=useRef(0),file=useRef<HTMLInputElement>(null),images=data.state?.images?.filter(i=>!i.hidden)??[],lightbox=useImagePreview();
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;readTicket.current++;previewTicket.current++;};},[]);
  const update=(values:Partial<PublicationInput>)=>{const next={...editor.getSnapshot().input,...values};if(next.type==="images"){if(values.coverImageId)next.imageIds=[values.coverImageId,...next.imageIds.filter(id=>id!==values.coverImageId)];else if(values.imageIds&&next.coverImageId){if(next.imageIds[0])next.coverImageId=next.imageIds[0];else delete next.coverImageId;}}editor.update(next);};
  const run=async(action:ProductionAction)=>{if(mutating.current)throw new Error("当前操作尚未完成。");mutating.current=true;setBusy(true);setError("");try{const next=await api.action(action);data.query.accept(next);return next;}catch(e){if(alive.current)setError(e instanceof Error?e.message:"操作未完成");throw e;}finally{mutating.current=false;if(alive.current)setBusy(false);}};
  const ask=async(kind:"文案"|"多图",append=false)=>{
    try{const saved=await editor.flush(),text=`请${kind==="多图"?"为这份发布内容制作或修改有序多图，保留其余已确认材料":"按我的要求改写这份平台发布文案，保留其余素材"}。发布内容：${saved.id}，版本：${saved.revision}。请先读取当前材料，保存时核对版本并使用稳定saveId；不上传或发表。`;setRequest(text);if(!api.prepareRequest)throw new Error("请在左侧项目对话提出此要求。");await api.prepareRequest(detail,text,append);if(alive.current)setNotice("请求已放入项目对话，请发送。");}catch(e){if(alive.current)setError(e instanceof Error?e.message:"请求未准备好");}
  };
  const reuseArticle=async(id:string)=>{
    if(!id||!api.articleSource)return;const ticket=++readTicket.current,before=JSON.stringify(editor.getSnapshot().input);setError("");
    try{const source=await api.articleSource({...scope,articleId:id});if(!alive.current||ticket!==readTicket.current)return;if(JSON.stringify(editor.getSnapshot().input)!==before)throw new Error("读取期间内容已修改，当前输入已保留，请再次选择文章。");update({title:source.article.title||input.title,body:publicationText(source.source,input.platform,input.type,source.article.format),articleId:id,articleFile:source.article.file,imageIds:[...(source.article.imageIds??[])],source:{kind:"article",articleId:id}});}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:"文章读取失败");}
  };
  const makePreview=async()=>{
    const ticket=++previewTicket.current;setPreviewBusy(true);setError("");
    try{const saved=await editor.flush();const result=await api.preview({...scope,publicationId:saved.id,revision:saved.revision});if(alive.current&&ticket===previewTicket.current)setPreview({html:result.html,revision:saved.revision});}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:"排版预览未完成");}
    finally{if(alive.current&&ticket===previewTicket.current)setPreviewBusy(false);}
  };
  useEffect(()=>{if(input.type==="article"&&snap.phase==="saved"&&input.body.trim()&&!preview&&!previewBusy)void makePreview();},[snap.publicationId,input.articleId,snap.phase]);
  const showImage=(id:string,trigger:HTMLElement,ids?:string[])=>lightbox.open((ids?ids.map(key=>images.find(i=>i.id===key)).filter((i):i is NonNullable<typeof i>=>Boolean(i)):images).map(i=>({id:i.id,title:i.purpose==="cover"?"发布封面":"发布图片",reload:()=>invalidateImageThumb(api,detail.folderPath,i),content:<ImageThumb image={i} detail={detail} api={api} large/>})),id,trigger);
  const move=(index:number,delta:number)=>{const ids=[...editor.getSnapshot().input.imageIds];[ids[index],ids[index+delta]]=[ids[index+delta]!,ids[index]!];update({imageIds:ids});};
  const covers=data.view?.covers.versions.filter(v=>!v.hidden&&Object.values(input.coverFiles??{}).includes(v.file))??[];
  const uploadReady=Boolean(input.title.trim()&&accountId&&(input.type==="video"?input.video:input.type==="images"?input.imageIds.length:input.body.trim())&&(input.platform!=="official-account"||input.coverImageId));
  const upload=async(after?:string)=>{try{const next=await editor.withSaved(saved=>run({...scope,action:"upload-publication",publicationId:saved.id,expectedRevision:saved.revision,originalRightsConfirmed:rights,...(accountId?{expectedAccountId:accountId}:{}),...(after?{newUploadAfter:after}:{})}));if(alive.current)setUploadNotice(next.uploadNotice?{...next.uploadNotice,ownerAccountId:accountId}:undefined);}catch(e){if(alive.current)setError(e instanceof Error?e.message:"上传未开始");}};
  return <div className="publicationEditor" aria-label="当前发布内容">
    <div className="publicationSaveStatus" role="status">{{saved:"已保存",pending:"本地待同步",saving:"保存中…",error:"保存失败，草稿已保留",conflict:"有其他修改，草稿已保留"}[snap.phase]}{snap.phase==="error"&&<ActionButton tone="ghost" onClick={()=>void editor.flush().catch(()=>undefined)}>重试保存</ActionButton>}{snap.phase==="conflict"&&<ActionButton onClick={()=>{manager.create({...input});setNotice("当前草稿已保留为另一份本地材料，可在材料选择区打开。");}}>保留为另一份</ActionButton>}</div>
    {snap.error&&<p className="creatorError" role="alert">{snap.error}</p>}
    <section className="publicationGroup" aria-label="内容与预览"><div className="productionHeading"><h4>内容与预览</h4><ActionBar><ActionButton onClick={()=>void ask("文案")}>让 Agent 改文案</ActionButton>{input.type!=="video"&&<ActionButton onClick={()=>void ask("多图")}>制作多图</ActionButton>}</ActionBar></div>
      <div className="publicationFields"><label>标题<input value={input.title} maxLength={500} onChange={e=>update({title:e.target.value})}/></label>
        <label>正文<textarea rows={7} value={input.body} maxLength={300000} onChange={e=>update({body:e.target.value})}/></label>
        <label>话题／标签<input value={tags} onChange={e=>{setTags(e.target.value);const nextTags=e.target.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean);tagBaseline.current=JSON.stringify(nextTags);update({tags:nextTags});}}/></label>
        {input.type==="video"&&<label>本次视频<select value={input.video??""} onChange={e=>update({video:e.target.value})}><option value="">选择视频</option>{detail.videos?.map(v=><option value={v.name} key={v.name}>{v.name}</option>)}</select></label>}
        {input.type!=="video"&&<label>复用文章内容<select value={input.articleId??""} onChange={e=>void reuseArticle(e.target.value)}><option value="">选择已有文章版本</option>{data.state?.articles.map(a=><option value={a.id} key={a.id}>{a.title||"文章"} · {new Date(a.createdAt).toLocaleString()}</option>)}</select></label>}
        {input.platform==="bilibili"&&input.type==="video"&&<label>分区<input value={input.category??""} onChange={e=>update({category:e.target.value})}/></label>}
      </div>
      {input.type!=="video"&&<><div className="productionHeading"><h4>{input.platform==="official-account"?"正文配图":"图片顺序"}</h4><ActionBar><ActionButton onClick={()=>setPicker(v=>!v)}>选择已有图片</ActionButton><ActionButton disabled={busy} onClick={()=>file.current?.click()}>导入图片</ActionButton></ActionBar></div>
        <div className="publicationImageOrder">{input.imageIds.map((id,index)=>{const image=images.find(i=>i.id===id);return <div className="publicationOrderedItem" key={id}><button className="publicationImage" aria-label={`放大第${index+1}张图片`} disabled={!image} onClick={e=>showImage(id,e.currentTarget,input.imageIds)}>{image?<ImageThumb image={image} detail={detail} api={api}/>:<span>图片已移除</span>}</button><span>第{index+1}张</span><ActionBar><ActionButton tone="ghost" disabled={index===0} aria-label={`第${index+1}张上移`} onClick={()=>move(index,-1)}>上移</ActionButton><ActionButton tone="ghost" disabled={index===input.imageIds.length-1} aria-label={`第${index+1}张下移`} onClick={()=>move(index,1)}>下移</ActionButton><ActionButton tone="ghost" onClick={()=>update({imageIds:input.imageIds.filter(i=>i!==id)})}>移出</ActionButton></ActionBar></div>;})}</div>
        {picker&&<div className="publicationImagePicker">{images.filter(i=>!input.imageIds.includes(i.id)).map((i,n)=><div key={i.id}><button className="publicationImage" aria-label={`放大候选图片${n+1}`} onClick={e=>showImage(i.id,e.currentTarget)}><ImageThumb image={i} detail={detail} api={api}/></button><ActionButton onClick={()=>update({imageIds:[...input.imageIds,i.id]})}>加入图集</ActionButton></div>)}{!images.length&&<p className="creatorMuted">还没有项目图片，可导入或让 Agent 制作。</p>}</div>}
        <label className="publicationCoverField">{input.platform==="official-account"?"文章封面":"首图／封面"}<select value={input.coverImageId??""} onChange={e=>update({coverImageId:e.target.value})}><option value="">{input.platform==="official-account"?"请选择文章封面":"使用图集首图"}</option>{images.map((i,n)=><option value={i.id} key={i.id}>图片{n+1} · {i.width}×{i.height}</option>)}</select></label>
        {input.coverImageId&&images.some(i=>i.id===input.coverImageId)&&<button className="publicationImage publicationCover" aria-label="放大发布封面" onClick={e=>showImage(input.coverImageId!,e.currentTarget,[input.coverImageId!])}><ImageThumb image={images.find(i=>i.id===input.coverImageId)!} detail={detail} api={api}/></button>}
      </>}
      {input.type==="video"&&<><div className="productionHeading"><h4>本次视频封面</h4><ActionButton onClick={()=>update({coverFiles:{...detail.covers}})}>使用项目当前封面</ActionButton></div><div className="publicationImageOrder">{covers.map(v=><button key={v.id} className="publicationImage" onClick={e=>{if(getCoverImage)lightbox.open(covers.map(c=>({id:c.id,title:`${c.ratio.replace("x",":")} 视频封面`,reload:()=>invalidateOverviewCover(detail.folderPath,c,getCoverImage),content:<OverviewCover version={c} detail={detail} getCoverImage={getCoverImage}/>})),v.id,e.currentTarget);}}>{getCoverImage?<OverviewCover version={v} detail={detail} getCoverImage={getCoverImage}/>:<span>{v.ratio.replace("x",":")}</span>}</button>)}</div>{!covers.length&&<p className="creatorMuted">尚未选择本次视频封面</p>}</>}
      {input.type==="article"&&<div className="publicationArticlePreview"><ActionBar><ActionButton disabled={previewBusy||!input.body.trim()} onClick={()=>void makePreview()}>{previewBusy?"正在排版…":"查看排版预览"}</ActionButton>{preview&&(preview.revision!==snap.revision||editor.dirty)&&<span className="creatorMuted">正文有更新，可重新预览</span>}</ActionBar>{preview&&<ArticlePreview html={preview.html} title="发布文章排版预览"/>}</div>}
    </section>
    <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="导入发布图片" onChange={e=>{const picked=e.currentTarget.files?.[0];e.currentTarget.value="";if(!picked)return;try{const before=new Set(images.map(i=>i.id));void run({...scope,action:"import-image",sourcePath:localFilePath(picked),purpose:"card"}).then(next=>{const ids=next.images?.filter(i=>!i.hidden&&!before.has(i.id)).map(i=>i.id)??[];if(ids.length)update({imageIds:[...editor.getSnapshot().input.imageIds,...ids]});}).catch(()=>undefined);}catch(e){setError(e instanceof Error?e.message:"图片选择失败");}}}/>
    <div className="publicationUploadActions"><label><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/>确认本次素材拥有发布授权</label><ActionBar><ActionButton tone="primary" disabled={busy||!uploadReady||!rights||snap.phase==="conflict"} onClick={()=>void upload()}>上传并准备草稿</ActionButton><ActionButton tone="ghost" disabled={busy} onClick={async()=>{try{await editor.withSaved(saved=>run({...scope,action:"remove-publication",publicationId:saved.id,expectedRevision:saved.revision}));manager.remove(snap.key);onRemoved();}catch{/* Keep material and draft on failure. */}}}>移除这份材料</ActionButton></ActionBar><p className="creatorMuted">最终发表请到平台核对后手动完成。</p></div>
    {snap.publicationId&&<PublicationResults detail={detail} api={api} edit={snap} accountId={accountId} run={run}/>}
    {uploadNotice&&<div className="creatorInlineStatus"><span>{uploadNotice.message}</span><ActionButton onClick={()=>void run({...scope,action:"inspect-upload",taskId:uploadNotice.taskId}).catch(()=>undefined)}>检查已有上传</ActionButton><ActionButton onClick={()=>void run({...scope,action:"resume-upload",taskId:uploadNotice.taskId}).catch(()=>undefined)}>继续已有上传</ActionButton>{uploadNotice.canCreateNew&&<ActionButton disabled={busy||!uploadReady||!rights} onClick={()=>void upload(uploadNotice.taskId)}>确认另建一份上传</ActionButton>}</div>}
    {notice&&<p role="status" className="creatorMuted">{notice}</p>}{error&&<div role="alert"><p className="creatorError">{error}</p>{error.includes("已有草稿")&&request&&<ActionButton onClick={()=>void ask("文案",true)}>追加创作请求</ActionButton>}</div>}
  </div>;
}
