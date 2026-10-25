import { useEffect, useState } from "react";
import type { ContentDetail } from "../types.ts";
import type { ProductionAction, PublicationPlatform, PublicationRecord } from "../production/types.ts";
import { isActiveTask } from "../production/types.ts";
import type { PublicationEditSnapshot } from "./publicationAutosave.ts";
import { useProjectData } from "./ProjectData.tsx";
import type { ProductionClient } from "./productionApi.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
const uploadLabels: Record<string,string>={unconfirmed:"上传结果待核对",blocked:"需要继续处理",cancelled:"已取消",failed:"上传未完成",ready:"已上传待人工发表"};
const syncLabels: Record<string,string>={completed:"同步完成",cancelled:"同步已取消",failed:"本次同步未完成"};

export function PublicationResults({ detail, api, edit, accountId, run }: { detail: ContentDetail; api: ProductionClient; edit: PublicationEditSnapshot; accountId: string | undefined; run: (request: ProductionAction) => Promise<unknown> }) {
  const data=useProjectData(api,detail), scope={id:detail.id,folderPath:detail.folderPath}, platform=edit.input.platform;
  const [association,setAssociation]=useState<{accountId:string;platform:PublicationPlatform;recordId?:string;remoteId:string;url:string;candidateAccountId?:string}>(),[notice,setNotice]=useState("");
  useEffect(()=>{if(association&&association.accountId!==accountId){setAssociation(undefined);setNotice("账号已变化，请重新选择作品。");}},[accountId,association?.accountId]);
  const tasks=data.state?.tasks.filter(t=>t.publicationId===edit.publicationId&&t.kind==="upload")??[];
  const records=data.state?.records?.filter(r=>r.publicationId===edit.publicationId)??[];
  const syncing=data.state?.tasks.filter(t=>t.kind==="metrics"&&t.metricsTargets?.some(m=>m.platform===platform&&m.accountId===accountId&&m.publicationId===edit.publicationId))??[];
  const associate=(record?:PublicationRecord)=>{if(accountId)setAssociation({accountId,platform,...(record?{recordId:record.id}:{}),remoteId:record?.remoteId??"",url:record?.url??""});};
  const sync=(recordId?:string)=>void run({...scope,action:"refresh-metrics",platform,...(edit.publicationId?{publicationId:edit.publicationId}:{}),...(recordId?{recordId}:{}),...(accountId?{expectedAccountId:accountId}:{})}).catch(()=>undefined);
  return <>
    <section className="publicationGroup" aria-label="上传与平台草稿"><h4>上传与平台草稿</h4>
      {!tasks.length&&<p className="creatorMuted">尚未上传</p>}
      {tasks.map(t=><div className="publicationResultRow" key={t.id}><div><p>{t.step||(uploadLabels[t.status]??"正在上传")}</p><small>{new Date(t.updatedAt).toLocaleString()}{(t.account?.id??t.wechatAppId)!==accountId?" · 历史账号":""}</small>{t.error&&<p className="creatorError">{t.error}</p>}</div><ActionBar>{isActiveTask(t)?<ActionButton onClick={()=>void run({...scope,action:"cancel",taskId:t.id}).catch(()=>undefined)}>取消任务</ActionButton>:<><ActionButton onClick={()=>void run({...scope,action:"inspect-upload",taskId:t.id}).catch(()=>undefined)}>检查原任务</ActionButton><ActionButton onClick={()=>void run({...scope,action:"resume-upload",taskId:t.id}).catch(()=>undefined)}>继续原任务</ActionButton></>}</ActionBar></div>)}
    </section>
    <section className="publicationGroup" aria-label="此材料的作品数据"><div className="productionHeading"><h4>作品数据</h4><ActionButton disabled={!accountId||!edit.publicationId} onClick={()=>associate()}>关联已发表作品</ActionButton></div>
      {!records.length&&<p className="creatorMuted">关联已发表的作品后查看数据</p>}
      {records.map(r=>{const current=r.platform===platform&&r.accountId===accountId;const metric=data.state?.metrics.find(m=>m.recordId===r.id&&m.platform===r.platform&&m.accountId===r.accountId&&m.remoteId===r.remoteId);return <div className="publicationResultRow" key={r.id}><div><strong>{r.state==="published"?"已发表":r.state==="draft"?"平台草稿已保存":r.state==="linked"?"已关联，待核对":"已上传待发表"}</strong><p>{!current&&"历史账号 · "}{r.remoteId||"尚无作品标识"}</p><p>播放／阅读 {metric?.views??"—"} · 赞 {metric?.likes??"—"} · 评论 {metric?.comments??"—"}</p>{metric?.syncedAt&&<small>数据更新于 {new Date(metric.syncedAt).toLocaleString()}</small>}{metric?.error&&<p className="creatorError">{metric.error}{metric.syncedAt?"，保留上次成功数据":""}</p>}{r.url&&<a href={r.url} target="_blank" rel="noreferrer">查看作品</a>}</div><ActionBar><ActionButton disabled={!current||!r.remoteId||syncing.some(isActiveTask)} onClick={()=>sync(r.id)}>同步此作品</ActionButton><ActionButton disabled={!current} onClick={()=>associate(r)}>更改关联</ActionButton></ActionBar></div>;})}
      {syncing.map(t=><div className="creatorInlineStatus" role="status" key={t.id}><span>{isActiveTask(t)?data.error?"状态暂不可用":t.step||"正在同步此作品":t.error||(syncLabels[t.status]??"本次同步已结束")}</span>{isActiveTask(t)&&<ActionButton onClick={()=>void run({...scope,action:"cancel",taskId:t.id}).catch(()=>undefined)}>取消同步</ActionButton>}</div>)}
      {association&&<div className="publicationAssociation"><h4>选择当前账号的作品</h4>
        {data.state?.candidates?.filter(c=>c.platform===association.platform&&c.accountId===association.accountId&&c.accountId===accountId).map(c=><div className="creatorAssetRow" key={`${c.platform}:${c.accountId}:${c.remoteId}`}><span>{c.title}</span><ActionButton onClick={()=>setAssociation({...association,remoteId:c.remoteId,url:c.url??"",candidateAccountId:c.accountId})}>选择此作品</ActionButton></div>)}
        <label>作品标识<input value={association.remoteId} onChange={e=>{const {candidateAccountId:_candidate,...manual}=association;setAssociation({...manual,remoteId:e.target.value});}}/></label>
        <label>作品链接<input value={association.url} onChange={e=>setAssociation({...association,url:e.target.value})}/></label>
        <ActionBar><ActionButton disabled={!association.remoteId.trim()||association.accountId!==accountId} onClick={async()=>{const captured=association;try{await run({...scope,action:"associate-publication",platform:captured.platform,remoteId:captured.remoteId,expectedAccountId:captured.accountId,...(captured.candidateAccountId?{candidateAccountId:captured.candidateAccountId}:{}),...(edit.publicationId?{publicationId:edit.publicationId}:{}),...(captured.recordId?{recordId:captured.recordId}:{}),...(captured.url?{url:captured.url}:{})});setAssociation(previous=>previous===captured?undefined:previous);}catch{/* Error remains beside the owning material. */}}}>保存关联并读取数据</ActionButton><ActionButton tone="ghost" onClick={()=>setAssociation(undefined)}>取消</ActionButton></ActionBar>
      </div>}
      {notice&&<p role="status" className="creatorMuted">{notice}</p>}
    </section>
  </>;
}
