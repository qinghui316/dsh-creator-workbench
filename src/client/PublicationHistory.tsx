import { CreatorSelect } from "./ui/CreatorSelect.tsx";
import type { ContentDetail } from "../types.ts";
import type { ProductionView } from "../projectView.ts";
import type { ProductionAction, PublicationPlatform } from "../production/types.ts";
import { isActiveTask } from "../production/types.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";

/** Existing task and remote IDs remain readable in their original platform. */
export function PublicationHistory({ state, platform, accountId, run, openPath, folder, detail, onPublish, publishPending }: { state?: ProductionView; platform: PublicationPlatform; accountId?: string; run: (action: ProductionAction) => Promise<unknown>; openPath: (path: string) => Promise<void>; folder: Pick<ContentDetail, "id" | "folderPath">;detail:ContentDetail;onPublish?:(platform:import("../types.ts").PublishPlatform,status:import("../types.ts").PublishMark)=>void;publishPending?:import("../types.ts").PublishPlatform|null }) {
  const owns = (id: string | undefined, ownerPlatform: PublicationPlatform, type?: string) => Boolean(id && state?.publications?.some(p => p.id === id && !p.hidden && p.platform === ownerPlatform && (!type || p.type === type)));
  const tasks = state?.tasks.filter(t => {
    if(t.kind === "upload") return (t.platform ?? t.account?.platform ?? "official-account") === platform && !owns(t.publicationId, platform, t.publicationType);
    if(t.kind === "wechat") return platform === "official-account" && !owns(t.publicationId, platform);
    return t.kind === "metrics" && t.metricsTargets?.some(target => target.platform === platform && !owns(target.publicationId, platform));
  }) ?? [];
  const records = state?.records?.filter(r => r.platform === platform && !owns(r.publicationId, platform, r.type)) ?? [];
  const drafts = platform === "official-account" ? state?.drafts ?? [] : [];
  const metrics = state?.metrics.filter(m => m.platform === platform && !records.some(r => r.id === m.recordId) && !owns(m.publicationId, platform)) ?? [];
  const manual=Boolean(detail.selectedVideo&&platform!=="official-account"&&onPublish);
  if (!tasks.length && !drafts.length && !metrics.length&&!records.length&&!manual) return null;
  return <section className="publicationGroup" aria-label="以前的作品记录"><h4>以前的作品</h4>
    {tasks.map(t => <div className="publicationResultRow" key={t.id}><div><span>{t.step || t.status}</span>{(t.account?.id ?? t.wechatAppId) !== accountId && <small>历史账号</small>}{t.error && <p className="creatorError">{t.error}</p>}</div><ActionBar>{isActiveTask(t) ? <ActionButton onClick={() => void run({ ...folder, action: "cancel", taskId: t.id })}>取消任务</ActionButton> : t.kind === "upload" ? <><ActionButton onClick={() => void run({ ...folder, action: "inspect-upload", taskId: t.id })}>检查原任务</ActionButton><ActionButton onClick={() => void run({ ...folder, action: "resume-upload", taskId: t.id })}>继续原任务</ActionButton></> : t.receipt && <ActionButton onClick={() => void openPath(`${folder.folderPath}/${t.receipt}`)}>查看记录</ActionButton>}</ActionBar></div>)}
    {records.map(r => { const metric=state?.metrics.find(m=>m.recordId===r.id&&m.platform===r.platform&&m.accountId===r.accountId&&m.remoteId===r.remoteId);return <div className="publicationResultRow" key={r.id}><div><strong>{r.type === "video" ? "视频" : r.type === "images" ? "图文" : "文章"} · {r.remoteId || "原上传记录"}</strong><p>{r.accountId === accountId ? "当前账号" : "历史账号"} · 播放／阅读 {metric?.views ?? "—"} · 赞 {metric?.likes ?? "—"} · 评论 {metric?.comments ?? "—"}</p>{metric?.error && <p className="creatorError">{metric.error}</p>}</div>{r.remoteId && <ActionButton disabled={r.accountId !== accountId} onClick={()=>void run({...folder,action:"refresh-metrics",platform,recordId:r.id,...(accountId?{expectedAccountId:accountId}:{})})}>同步此作品</ActionButton>}</div>;})}
    {drafts.map(d => <div className="publicationResultRow" key={d.id}><div><strong>{d.title}</strong><p>{d.appid === accountId ? "公众号草稿已保存" : "历史账号的公众号草稿"} · {new Date(d.updatedAt).toLocaleString()}</p></div><ActionButton onClick={() => void openPath(`${folder.folderPath}/${d.submittedFile}`)}>查看提交内容</ActionButton></div>)}
    {metrics.map(m => <div className="publicationResultRow" key={`${m.platform}:${m.accountId}:${m.recordId ?? m.remoteId}`}><div><strong>{m.remoteId}</strong><p>{m.accountId === accountId ? "当前账号" : "历史账号"} · 阅读／播放 {m.views ?? "—"} · 赞 {m.likes ?? "—"} · 评论 {m.comments ?? "—"}</p>{m.error && <p className="creatorError">{m.error}</p>}</div><ActionButton disabled={m.accountId !== accountId} onClick={() => void run({ ...folder, action: "refresh-metrics", platform,remoteId:m.remoteId, ...(accountId ? { expectedAccountId: accountId } : {}) })}>同步此作品</ActionButton></div>)}
    {manual&&platform!=="official-account"&&<details className="creatorDisclosure"><summary>本期视频的手动状态</summary><CreatorSelect aria-label="本期视频的手动发布状态" value={detail.publish?.[platform]?.status??"unpublished"} disabled={publishPending===platform} onValueChange={value =>onPublish?.(platform,value as import("../types.ts").PublishMark)}><option value="unpublished">未发表</option><option value="draft">草稿</option><option value="published">已发表（手动标记）</option></CreatorSelect></details>}
  </section>;
}
