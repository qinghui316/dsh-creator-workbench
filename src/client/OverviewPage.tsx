import { creationPreviewImages, coverPreviewImages } from "./imageDescriptors.ts";
import { useImagePreview } from "./ImagePreview.tsx";
import { ActionButton } from "./ui/ActionButton.tsx";
import type { ContentDetail } from "../types.ts";
import { publicationLabel, publicationMetric, type ProjectTab } from "../projectView.ts";
import type { ProductionClient } from "./productionApi.ts";
import type { CreatorViewFace } from "./face.ts";
import { useProjectData } from "./ProjectData.tsx";
import { isActiveTask } from "../production/types.ts";
import { PlatformMark } from "./PlatformMark.tsx";
import { PUBLISH_PLATFORM_DEFINITIONS } from "../platforms.ts";
import { ImageThumb } from "./ImageThumb.tsx";
import { OverviewCover, OverviewVideo } from "./OverviewMedia.tsx";
import "./ProjectPages.css";
import "./CreationPanel.css";

type MediaFace=Pick<CreatorViewFace,"getVideoPlayback"|"getCoverImage">;
export function OverviewPage({ detail, api, navigate, ...media }: MediaFace & { detail: ContentDetail; api: ProductionClient; navigate: (tab: ProjectTab, targetId?:string) => void }) {
  const data=useProjectData(api,detail),state=data.state,current=data.view?.detail??detail;
  const pictures=state?.images?.filter(i=>!i.hidden)??[],article=state?.articles.at(-1);
  const covers=data.view?.covers.versions.filter(v=>!v.hidden&&current.covers[v.ratio]&&data.view?.covers.selected[v.ratio]===v.id)??[];
  const missingCovers=Object.values(data.view?.covers.selected??{}).filter(Boolean).length-covers.length;
  const articleImage=pictures.find(i=>article?.imageIds?.includes(i.id));
  const articleExcerpt=data.view?.excerpts?.article;
  const articleText=article?.title&&articleExcerpt?.text.startsWith(article.title)?articleExcerpt.text.slice(article.title.length).trim():articleExcerpt?.text;
  const publications=state?.publications?.filter(p=>!p.hidden)??[];
  const task=state?.tasks.find(isActiveTask),script=data.view?data.view.script.excerpt:detail.script?.slice(0,240);
  const picturePreviews=creationPreviewImages(pictures,current,api),coverPreviews=coverPreviewImages(covers,current,media.getCoverImage);
  const preview=useImagePreview([...picturePreviews,...coverPreviews]);
  const show=(kind:"image"|"cover",id:string,element:HTMLElement)=>preview.open(kind==="image"?picturePreviews:coverPreviews,id,element);
  const heading=(name:string,tab:ProjectTab,label:string,id?:string)=><div className="overviewHeading"><h3>{name}</h3><ActionButton tone="ghost" aria-label={`${label}${name}`} onClick={()=>navigate(tab,id)}>{label}</ActionButton></div>;
  return <div className="projectOverview">
    <section className="overviewSection" aria-label="视频摘要">{heading("视频","video",current.selectedVideo?"管理":"导入")}{current.videoSelection==="selected"?<><OverviewVideo detail={current} getVideoPlayback={media.getVideoPlayback}/><p className="overviewCaption" title={current.selectedVideo}>{current.selectedVideo}</p></>:<p className="creatorMuted">{current.videoSelection==="missing"?"选中的视频已找不到":current.videos?.length?"尚未选择当前视频":"还没有视频"}</p>}</section>
    <section className="overviewSection" aria-label="脚本摘要">{heading("脚本","script",script?"编辑":"写")}{script?<p className="overviewExcerpt">{script}</p>:<p className="creatorMuted">还没有脚本</p>}</section>
    <section className="overviewSection" aria-label="字幕摘要">{heading("字幕","subtitle",data.view?.excerpts?.subtitle?"查看":"准备")}{data.view?.excerpts?.subtitle?<><p className="overviewCaption">{data.view.excerpts.subtitle.source}</p><p className="overviewExcerpt">{data.view.excerpts.subtitle.text}</p></>:<p className="creatorMuted">{state?.transcripts.length?`${state.transcripts.length} 份字幕` : "还没有字幕"}</p>}</section>
    <section className="overviewSection" aria-label="文章摘要">{heading("文章","article",article||current.hasArticle?"编辑":"写",article?.id)}{article||current.hasArticle?<div className={articleImage?"overviewArticleWithImage":""}>{articleImage&&<button className="overviewImage" aria-label="查看文章配图" onClick={e=>show("image",articleImage.id,e.currentTarget)}><ImageThumb image={articleImage} detail={current} api={api}/></button>}<div><h4>{article?.title??current.title}</h4>{articleExcerpt?.id===(article?.id??"legacy")&&articleText&&<p className="overviewExcerpt">{articleText}</p>}</div></div>:<p className="creatorMuted">还没有文章</p>}</section>
    <section className="overviewSection" aria-label="图片摘要">{heading("图片","images","管理")}<div className="overviewImageStrip">{pictures.slice(0,4).map((item,index)=><button key={item.id} className="overviewImage" aria-label={`查看图片 ${index+1}`} onClick={e=>show("image",item.id,e.currentTarget)}><ImageThumb image={item} detail={current} api={api}/></button>)}</div>{covers.length>0&&<div className="overviewCoverStrip">{covers.map(item=><button key={item.id} className="overviewImage" aria-label={`查看 ${item.ratio.replace("x",":")} 封面`} onClick={e=>show("cover",item.id,e.currentTarget)}><OverviewCover version={item} detail={current} getCoverImage={media.getCoverImage}/><span>{item.ratio.replace("x",":")}</span></button>)}</div>}{missingCovers>0&&<p className="creatorError">{missingCovers} 个已选封面无法读取，请在图片页核对。</p>}{pictures.length||covers.length?<p className="overviewCaption">{pictures.length} 张图片 · {covers.length} 个视频封面</p>:<p className="creatorMuted">还没有图片</p>}</section>
    <section className="overviewSection" aria-label="发布摘要">{heading("发布","publishing","管理")}{publications.map(item=>{const platform=item.platform==="official-account"?{name:"公众号",icon:"article" as const}:PUBLISH_PLATFORM_DEFINITIONS[item.platform];const metric=state?publicationMetric(state,item,data.view?.accountIds?.[item.platform]):undefined;const metricText=metric?[metric.views!==undefined?`浏览 ${metric.views}`:"",metric.likes!==undefined?`赞 ${metric.likes}`:"",metric.comments!==undefined?`评论 ${metric.comments}`:""].filter(Boolean).join(" · "):"";return <div className="overviewPublication" key={item.id}><PlatformMark id={platform.icon} size={22}/><div><h4>{item.title}</h4><p>{platform.name} · {{video:"视频",images:"图文",article:"文章"}[item.type]} · {state?publicationLabel(state,item.id,data.view?.accountIds):"本地材料"}</p>{metricText&&<p>{metricText}</p>}</div><ActionButton tone="ghost" aria-label={`编辑发布内容：${item.title}`} onClick={()=>navigate("publishing",item.id)}>编辑</ActionButton></div>;})}{!publications.length&&<p className="creatorMuted">还没有发布材料</p>}</section>
    {task&&<button className="projectTaskLink" onClick={()=>navigate(task.kind==="asr"?"subtitle":task.kind==="article"?"article":task.kind==="images"?"images":"publishing")}>{task.step??"任务处理中"} · 查看进度</button>}
    {data.error&&<div role="alert"><p className="creatorError">{data.error}</p><ActionButton onClick={()=>void data.query.retry().catch(()=>undefined)}>重新读取</ActionButton></div>}
  </div>;
}
