import type { ContentDetail } from "../types.ts";
import type { ProductionView } from "../projectView.ts";
import type { ProductionAction, PublicationPlatform } from "../production/types.ts";
import { isActiveTask } from "../production/types.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";

/** Existing task and remote IDs remain readable in their original platform. */
export function PublicationHistory({ state, platform, accountId, run, openPath, folder, detail, onPublish, publishPending }: { state?: ProductionView; platform: PublicationPlatform; accountId?: string; run: (action: ProductionAction) => Promise<unknown>; openPath: (path: string) => Promise<void>; folder: Pick<ContentDetail, "id" | "folderPath">;detail:ContentDetail;onPublish?:(platform:import("../types.ts").PublishPlatform,status:import("../types.ts").PublishMark)=>void;publishPending?:import("../types.ts").PublishPlatform|null }) {
  const tasks = state?.tasks.filter(t => !t.publicationId && (t.kind === "upload" ? t.platform === platform : t.kind === "wechat" && platform === "official-account")) ?? [];
  const drafts = platform === "official-account" ? state?.drafts ?? [] : [];
  const metrics = state?.metrics.filter(m => !m.publicationId && m.platform === platform) ?? [];
  const manual=Boolean(detail.selectedVideo&&platform!=="official-account"&&onPublish);
  if (!tasks.length && !drafts.length && !metrics.length&&!manual) return null;
  return <section className="publicationGroup" aria-label="以前的作品记录"><h4>以前的作品</h4>
    {tasks.map(t => <div className="publicationResultRow" key={t.id}><div><span>{t.step || t.status}</span>{(t.account?.id ?? t.wechatAppId) !== accountId && <small>历史账号</small>}{t.error && <p className="creatorError">{t.error}</p>}</div><ActionBar>{t.kind === "upload" ? isActiveTask(t) ? <ActionButton onClick={() => void run({ ...folder, action: "cancel", taskId: t.id })}>取消任务</ActionButton> : <><ActionButton onClick={() => void run({ ...folder, action: "inspect-upload", taskId: t.id })}>检查原任务</ActionButton><ActionButton onClick={() => void run({ ...folder, action: "resume-upload", taskId: t.id })}>继续原任务</ActionButton></> : t.receipt && <ActionButton onClick={() => void openPath(`${folder.folderPath}/${t.receipt}`)}>查看记录</ActionButton>}</ActionBar></div>)}
    {drafts.map(d => <div className="publicationResultRow" key={d.id}><div><strong>{d.title}</strong><p>{d.appid === accountId ? "公众号草稿已保存" : "历史账号的公众号草稿"} · {new Date(d.updatedAt).toLocaleString()}</p></div><ActionButton onClick={() => void openPath(`${folder.folderPath}/${d.submittedFile}`)}>查看提交内容</ActionButton></div>)}
    {metrics.map(m => <div className="publicationResultRow" key={`${m.platform}:${m.accountId}:${m.recordId ?? m.remoteId}`}><div><strong>{m.remoteId}</strong><p>{m.accountId === accountId ? "当前账号" : "历史账号"} · 阅读／播放 {m.views ?? "—"} · 赞 {m.likes ?? "—"} · 评论 {m.comments ?? "—"}</p>{m.error && <p className="creatorError">{m.error}</p>}</div><ActionButton disabled={m.accountId !== accountId} onClick={() => void run({ ...folder, action: "refresh-metrics", platform,remoteId:m.remoteId, ...(accountId ? { expectedAccountId: accountId } : {}) })}>同步此作品</ActionButton></div>)}
    {manual&&platform!=="official-account"&&<details className="creatorDisclosure"><summary>本期视频的手动状态</summary><select aria-label="本期视频的手动发布状态" value={detail.publish?.[platform]?.status??"unpublished"} disabled={publishPending===platform} onChange={e=>onPublish?.(platform,e.target.value as import("../types.ts").PublishMark)}><option value="unpublished">未发表</option><option value="draft">草稿</option><option value="published">已发表（手动标记）</option></select></details>}
  </section>;
}
