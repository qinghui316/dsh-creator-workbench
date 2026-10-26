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
import { imageName } from "./mediaPresentation.ts";
import "./MediaLayout.css";

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
  const heading=(name:string,tab:ProjectTab,label:string,id?:string)=><div className="overviewHeading"><h3>{name}</h3><ActionButton tone="ghost" aria-label={label} onClick={()=>navigate(tab,id)}>{label}</ActionButton></div>;
  return <div className="projectOverview">
    <section className={`overviewSection${current.videoSelection==="selected"?"":" overviewEmpty"}`} aria-label="视频摘要">{heading("视频","video",current.videos?.length?"管理视频":"导入视频")}{current.videoSelection==="selected"?<><OverviewVideo detail={current} getVideoPlayback={media.getVideoPlayback}/><p className="overviewCaption" title={current.selectedVideo}>{current.selectedVideo}</p></>:current.videoSelection==="missing"?<p className="creatorError">选中的视频已找不到</p>:current.videos?.length?<p className="creatorMuted">尚未选择当前视频</p>:null}</section>
    <section className={`overviewSection${script?"":" overviewEmpty"}`} aria-label="脚本摘要">{heading("脚本","script",script?"编辑脚本":"写脚本")}{script&&<p className="overviewExcerpt">{script}</p>}</section>
    <section className={`overviewSection${data.view?.excerpts?.subtitle?"":" overviewEmpty"}`} aria-label="字幕摘要">{heading("字幕","subtitle",data.view?.excerpts?.subtitle||state?.transcripts.length?"查看字幕":"转写或导入")}{data.view?.excerpts?.subtitle&&<><p className="overviewCaption">{data.view.excerpts.subtitle.source}</p><p className="overviewExcerpt">{data.view.excerpts.subtitle.text}</p></>}</section>
    <section className={`overviewSection${article||current.hasArticle?"":" overviewEmpty"}`} aria-label="文章摘要">{heading("文章","article",article||current.hasArticle?"阅读文章":"写文章",article?.id)}{(article||current.hasArticle)&&<div className={articleImage?"overviewArticleWithImage":""}>{articleImage&&<button className="creatorMediaFrame" aria-label="查看文章配图" onClick={e=>show("image",articleImage.id,e.currentTarget)}><ImageThumb image={articleImage} detail={current} api={api}/></button>}<div><h4>{article?.title??current.title}</h4>{articleExcerpt?.id===(article?.id??"legacy")&&articleText&&<p className="overviewExcerpt">{articleText}</p>}</div></div>}</section>
    <section className={`overviewSection${pictures.length||covers.length||missingCovers?"":" overviewEmpty"}`} aria-label="图片摘要">{heading("图片","images",pictures.length||covers.length?"查看图库":"制作或导入")}{pictures.length>0&&<div className="creatorMediaGrid" aria-label="项目图片">{pictures.slice(0,4).map(item=><div key={item.id}><button className="creatorMediaFrame" aria-label={`查看图片：${imageName(item)}`} onClick={e=>show("image",item.id,e.currentTarget)}><ImageThumb image={item} detail={current} api={api}/></button><div className="creatorMediaCaption"><span className="creatorMediaName" title={imageName(item)}>{imageName(item)}</span></div></div>)}</div>}{covers.length>0&&<div className="overviewCoverGroup"><h4>视频封面</h4><div className="creatorMediaGrid">{covers.map(item=><div key={item.id}><button className="creatorMediaFrame" aria-label={`查看 ${item.ratio.replace("x",":")} 封面`} onClick={e=>show("cover",item.id,e.currentTarget)}><OverviewCover version={item} detail={current} getCoverImage={media.getCoverImage}/></button><div className="creatorMediaCaption"><span>{item.ratio.replace("x",":")}</span></div></div>)}</div></div>}{missingCovers>0&&<p className="creatorError">{missingCovers} 个已选封面无法读取，请在图片页核对。</p>}</section>
    <section className={`overviewSection${publications.length?"":" overviewEmpty"}`} aria-label="发布摘要">{heading("发布","publishing",publications.length?"查看发布内容":"准备发布内容")}{publications.map(item=>{const platform=item.platform==="official-account"?{name:"公众号",icon:"article" as const}:PUBLISH_PLATFORM_DEFINITIONS[item.platform];const metric=state?publicationMetric(state,item,data.view?.accountIds?.[item.platform]):undefined;const metricText=metric?[metric.views!==undefined?`浏览 ${metric.views}`:"",metric.likes!==undefined?`赞 ${metric.likes}`:"",metric.comments!==undefined?`评论 ${metric.comments}`:""].filter(Boolean).join(" · "):"";return <div className="overviewPublication" key={item.id}><PlatformMark id={platform.icon} size={22}/><div><h4>{item.title}</h4><p>{platform.name} · {{video:"视频",images:"图文",article:"文章"}[item.type]} · {state?publicationLabel(state,item.id,data.view?.accountIds):"本地材料"}</p>{metricText&&<p>{metricText}</p>}</div><ActionButton tone="ghost" aria-label={`编辑发布内容：${item.title}`} onClick={()=>navigate("publishing",item.id)}>编辑内容</ActionButton></div>;})}</section>
    {task&&<button className="projectTaskLink" onClick={()=>navigate(task.kind==="asr"?"subtitle":task.kind==="article"?"article":task.kind==="images"?"images":"publishing")}>{task.step??"任务处理中"} · 查看进度</button>}
    {data.error&&<div role="alert"><p className="creatorError">{data.error}</p><ActionButton onClick={()=>void data.query.retry().catch(()=>undefined)}>重新读取</ActionButton></div>}
  </div>;
}
