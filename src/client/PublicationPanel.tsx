import { publicationText } from "./publicationText.ts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ContentDetail, PublishMark, PublishPlatform } from "../types.ts";
import type { PublicationInput, PublicationPlatform } from "../production/types.ts";
import { PUBLISH_PLATFORM_DEFINITIONS, PUBLISH_PLATFORMS } from "../platforms.ts";
import { PlatformMark } from "./PlatformMark.tsx";
import { PublicationEditors, publicationInput, type PublicationEditor, type DraftStorage } from "./publicationAutosave.ts";
import { PublicationEditorPanel } from "./PublicationEditorPanel.tsx";
import { PublicationHistory } from "./PublicationHistory.tsx";
import { useProjectData } from "./ProjectData.tsx";
import { useSettingsNavigation } from "./SettingsNavigation.tsx";
import type { ProductionClient } from "./productionApi.ts";
import type { CreatorViewFace } from "./face.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./CreationPanel.css";
import "./PublicationPanel.css";

const platforms: readonly PublicationPlatform[]=[...PUBLISH_PLATFORMS,"official-account"];
const name=(p:PublicationPlatform)=>p==="official-account"?"公众号":PUBLISH_PLATFORM_DEFINITIONS[p].name;
const typeName={video:"视频",images:"图文",article:"文章"};
const managers=new WeakMap<ProductionClient,Map<string,PublicationEditors>>();
function localStore():DraftStorage{try{if(globalThis.localStorage)return globalThis.localStorage;}catch{/* Report through the draft controller. */}return{getItem:()=>null,removeItem:()=>undefined,setItem:()=>{throw new Error("本地草稿缓存不可用");}};}
function navKey(folder:string){return `dsh-creator-workbench:publication-navigation:${folder.replaceAll("\\","/").toLowerCase()}`;}
function readNav(folder:string):{platform?:PublicationPlatform;selected?:Partial<Record<PublicationPlatform,string>>}{try{return JSON.parse(localStore()?.getItem(navKey(folder))??"{}");}catch{return {};}}

export function PublicationPanel({initialArticleId,initialPublicationId,detail,api,enabledPlatforms=[],openPath=async()=>undefined,getCoverImage,onPublish,publishPending}: {initialArticleId?:string;initialPublicationId?:string;detail:ContentDetail;api:ProductionClient;enabledPlatforms?:readonly PublishPlatform[];onPublish?:(platform:PublishPlatform,status:PublishMark)=>void;publishPending?:PublishPlatform|null;openPath?:(path:string)=>Promise<void>;getCoverImage?:CreatorViewFace["getCoverImage"]}) {
  const scope={id:detail.id,folderPath:detail.folderPath},data=useProjectData(api,scope),settings=data.settings,openSettings=useSettingsNavigation();
  const manager=useMemo(()=>{let byFolder=managers.get(api);if(!byFolder){byFolder=new Map();managers.set(api,byFolder);}const key=detail.folderPath.replaceAll("\\","/").toLowerCase();let value=byFolder.get(key);if(!value){value=new PublicationEditors(detail.folderPath,async action=>{const next=await api.action({...action,...scope});if(!next.savedPublication)throw new Error("保存回执暂不可用，请重试原保存请求。");setTimeout(()=>{void data.query.invalidate().catch(()=>undefined);},0);const saved=next.publications?.find(p=>p.id===next.savedPublication!.id&&p.revision===next.savedPublication!.revision);return {...next.savedPublication,...(saved&&saved.body!==undefined?{input:publicationInput(saved)}:{})};},localStore());byFolder.set(key,value);value.resume();}return value;},[api,detail.folderPath]);
  const version=useSyncExternalStore(manager.subscribe,manager.getSnapshot),nav=useRef(readNav(detail.folderPath));
  const [platform,setPlatform]=useState<PublicationPlatform>(initialArticleId?"official-account":nav.current.platform&&platforms.includes(nav.current.platform)?nav.current.platform:enabledPlatforms[0]??"xiaohongshu");
  const [selected,setSelected]=useState(nav.current.selected?.[platform]??""),[reading,setReading]=useState(false),[error,setError]=useState(""),[settingsError,setSettingsError]=useState(""),[copyPlatform,setCopyPlatform]=useState<PublicationPlatform>(platform);
  const selectionTicket=useRef(0),platformRef=useRef(platform),alive=useRef(true),handledTarget=useRef("");platformRef.current=platform;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;selectionTicket.current++;};},[]);
  useEffect(()=>{void data.query.settings().catch(e=>{if(alive.current)setSettingsError(e instanceof Error?e.message:"账号设置读取失败");});},[api]);
  const all=data.state?.publications??[], publications=all.filter(p=>!p.hidden&&p.platform===platform);
  const local=manager.list().filter(e=>e.getSnapshot().input.platform===platform&&!all.some(p=>p.id===e.getSnapshot().publicationId));
  const choices=[...publications.map(p=>({key:manager.forId(p.id)?.getSnapshot().key??p.id,id:p.id,title:manager.forId(p.id)?.getSnapshot().input.title??p.title,type:p.type})),...local.map(e=>({key:e.getSnapshot().key,title:e.getSnapshot().input.title,type:e.getSnapshot().input.type}))];
  const editor=manager.list().find(e=>e.getSnapshot().key===selected&&e.getSnapshot().input.platform===platform&&!all.some(p=>p.id===e.getSnapshot().publicationId&&p.hidden));
  // Name, ownership and actions use one settings snapshot; a lagging project view
  // must not label the previous account's records as current.
  const accountId=platform==="official-account"?settings?.wechat.appid:settings?.accounts[platform]?.id;
  const configured=platform==="official-account"?Boolean(settings?.wechatConfigured):Boolean(settings?.accounts[platform]);
  const choose=async(key:string,targetPlatform=platformRef.current)=>{
    const ticket=++selectionTicket.current;setError("");const existing=manager.list().find(e=>e.getSnapshot().key===key||e.getSnapshot().publicationId===key);
    if(existing){if(existing.getSnapshot().input.platform!==targetPlatform)return;const current=all.find(p=>p.id===existing.getSnapshot().publicationId);if(existing.dirty||!current||current.revision<=(existing.getSnapshot().revision??0)){setSelected(existing.getSnapshot().key);return;}}
    const publication=all.find(p=>(p.id===key||p.id===existing?.getSnapshot().publicationId)&&!p.hidden&&p.platform===targetPlatform);if(!publication)return;
    setReading(true);
    try{if(!api.publication)throw new Error("此版本暂时无法读取发布正文，请重试。");const full=await api.publication({...scope,publicationId:publication.id,revision:publication.revision});if(!alive.current||ticket!==selectionTicket.current||platformRef.current!==targetPlatform)return;if(full.bodyError)throw new Error(full.bodyError);setSelected(manager.open(full).getSnapshot().key);}
    catch(e){if(alive.current&&ticket===selectionTicket.current)setError(e instanceof Error?e.message:"材料读取失败");}
    finally{if(alive.current&&ticket===selectionTicket.current)setReading(false);}
  };
  useEffect(()=>{if(!data.state||editor||reading||error)return;const first=choices.find(c=>c.key===selected)||choices[0];if(first)void choose(first.key);},[data.state,platform,selected,version]);
  useEffect(()=>{const latest=all.find(p=>p.id===editor?.getSnapshot().publicationId);if(editor&&latest&&!editor.dirty&&!reading&&latest.revision>(editor.getSnapshot().revision??0))void choose(latest.id);},[data.state,selected,platform,version]);
  useEffect(()=>{nav.current={platform,selected:{...nav.current.selected,...(selected?{[platform]:selected}:{})}};try{localStore()?.setItem(navKey(detail.folderPath),JSON.stringify(nav.current));}catch{/* Remote material remains available. */}},[platform,selected]);
  const switchPlatform=(next:PublicationPlatform)=>{selectionTicket.current++;platformRef.current=next;setPlatform(next);setCopyPlatform(next);setSelected(nav.current.selected?.[next]??"");setReading(false);setError("");};
  const fresh=(type:PublicationInput["type"],target=platform):PublicationInput=>({platform:target,type,title:detail.title,body:"",tags:[...detail.tags],imageIds:[],...(type==="video"&&detail.selectedVideo?{video:detail.selectedVideo,coverFiles:{...detail.covers}}:{})});
  const create=(type:PublicationInput["type"])=>{selectionTicket.current++;setReading(false);setError("");setSelected(manager.create(fresh(type)).getSnapshot().key);};
  useEffect(()=>{
    if(!data.state)return;const target=initialPublicationId?`publication:${initialPublicationId}`:initialArticleId?`article:${initialArticleId}`:"";if(!target||handledTarget.current===target)return;
    handledTarget.current=target;
    if(initialPublicationId){const p=all.find(p=>p.id===initialPublicationId&&!p.hidden);if(p){switchPlatform(p.platform);void choose(p.id,p.platform);}return;}
    if(initialArticleId){switchPlatform("official-account");const previous=all.find(p=>!p.hidden&&p.platform==="official-account"&&p.articleId===initialArticleId);if(previous){void choose(previous.id,"official-account");return;}const ticket=++selectionTicket.current;
      void api.articleSource?.({...scope,articleId:initialArticleId}).then(source=>{if(!alive.current||ticket!==selectionTicket.current||platformRef.current!=="official-account")return;setSelected(manager.create({...fresh("article","official-account"),title:source.article.title||detail.title,body:source.source,articleId:source.article.id,articleFile:source.article.file,imageIds:[...(source.article.imageIds??[])],source:{kind:"article",articleId:source.article.id}}).getSnapshot().key);},e=>{if(alive.current)setError(e instanceof Error?e.message:"文章读取失败");});}
  },[data.state,initialArticleId,initialPublicationId]);
  const duplicate=()=>{if(!editor)return;const source=editor.getSnapshot().input;let type=source.type;if(copyPlatform==="official-account")type="article";else if(copyPlatform==="wechat")type="video";else if(type==="article"&&copyPlatform!=="bilibili")type="images";const copied={...structuredClone(source),platform:copyPlatform,type,body:publicationText(source.body,copyPlatform,type)};switchPlatform(copyPlatform);setSelected(manager.create(copied).getSnapshot().key);};
  const historyRun=async(action:import("../production/types.ts").ProductionAction)=>{try{const next=await api.action(action);data.query.accept(next);return next;}catch(e){if(alive.current)setError(e instanceof Error?e.message:"操作未完成");return undefined;}};
  return <div className="publicationWorkspace">
    <nav className="publicationPlatforms" aria-label="发布平台">{platforms.map(p=><button key={p} type="button" aria-current={platform===p?"page":undefined} onClick={()=>switchPlatform(p)}><PlatformMark id={p==="official-account"?"article":PUBLISH_PLATFORM_DEFINITIONS[p].icon} size={20}/><span>{name(p)}</span></button>)}</nav>
    <div className="publicationAccount"><div><strong>{name(platform)}</strong><span>{settingsError?"账号信息读取失败":!settings?"正在读取账号…":platform==="official-account"?settings.wechat.appid?`账号 ${settings.wechat.appid}${configured?"":" · 凭据未配置"}`:"尚未配置公众号":settings.accounts[platform]?`${settings.accounts[platform]!.name}${enabledPlatforms.includes(platform)?"":" · 平台未启用"}`:"尚未连接账号"}</span></div><ActionButton tone="ghost" onClick={()=>openSettings(platform==="official-account"?"wechat":"platforms")}>账号设置</ActionButton>{settingsError&&<ActionButton onClick={()=>{setSettingsError("");void data.query.settings().catch(e=>setSettingsError(e.message));}}>重新读取</ActionButton>}</div>
    <div className="publicationMaterialBar"><label>发布内容<select aria-label="选择发布内容" value={editor?.getSnapshot().key??""} onChange={e=>void choose(e.target.value)}><option value="">{reading?"正在读取…":choices.length?"请选择内容":"还没有发布内容"}</option>{choices.map(c=><option value={c.key} key={c.key}>{c.title||"未命名内容"} · {typeName[c.type]}</option>)}</select></label><div className="publicationNew"><span>另建一份</span><ActionBar>{platform!=="official-account"&&<ActionButton onClick={()=>create("video")}>视频</ActionButton>}{!["official-account","wechat"].includes(platform)&&<ActionButton onClick={()=>create("images")}>图文</ActionButton>}{["official-account","bilibili"].includes(platform)&&<ActionButton onClick={()=>create("article")}>文章</ActionButton>}</ActionBar></div></div>
    {editor&&<div className="publicationReuse"><label>复用到<select value={copyPlatform} onChange={e=>setCopyPlatform(e.target.value as PublicationPlatform)}>{platforms.map(p=><option value={p} key={p}>{name(p)}</option>)}</select></label><ActionButton tone="ghost" onClick={duplicate}>复制为另一份材料</ActionButton></div>}
    {editor?<PublicationEditorPanel key={editor.getSnapshot().key} editor={editor} manager={manager} detail={detail} api={api} accountId={configured&&(platform==="official-account"||enabledPlatforms.includes(platform))?accountId:undefined} onRemoved={()=>setSelected("")} {...(getCoverImage?{getCoverImage}:{})}/>:<div className="publicationEmpty">{reading?"正在读取内容…":"选择已有内容，或另建一份发布材料。"}</div>}
    <PublicationHistory {...(data.state?{state:data.state}:{})} platform={platform} {...(accountId?{accountId}:{})} run={historyRun} openPath={openPath} folder={scope} detail={detail} {...(onPublish?{onPublish}:{})} {...(publishPending?{publishPending}:{})}/>
    {(error||data.error)&&<div role="alert"><p className="creatorError">{error||data.error}</p><ActionButton onClick={()=>{setError("");void data.query.retry().catch(()=>undefined);}}>重新读取内容</ActionButton></div>}
  </div>;
}
