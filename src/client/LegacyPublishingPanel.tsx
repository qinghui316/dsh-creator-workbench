import type { ProductionView, ProductionTaskView } from "../projectView.ts";
import { useProjectData } from "./ProjectData.tsx";
import { useEffect, useRef, useState } from "react";
import type { ContentDetail, PublishMark, PublishPlatform } from "../types.ts";
import { PUBLISH_PLATFORM_DEFINITIONS, PUBLISH_PLATFORMS } from "../platforms.ts";
import { isActiveTask, type ProductionAction, type ProductionSettingsView, type ProductionState, type ProductionTask, type UploadNotice } from "../production/types.ts";
import { localFilePath, type ProductionClient } from "./productionApi.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./ProductionPanel.css";

const STATUS: Record<ProductionTask["status"], string> = { queued: "等待开始", running: "处理中", "waiting-agent": "等待对话处理", ready: "草稿就绪", completed: "已完成", blocked: "需要处理", failed: "未完成", cancelled: "已取消", unconfirmed: "结果需核对" };
const KIND: Record<ProductionTask["kind"], string> = { upload: "视频上传", asr: "视频转文字", article: "文章制作", wechat: "公众号草稿", metrics: "数据刷新", images: "图片制作" };
async function bounded<T>(work: Promise<T>, ms = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("状态暂不可用，请查询原任务；未重新提交。")), ms); })]); }
  finally { clearTimeout(timer!); }
}
const publishDrafts = new Map<string, { title: string; description: string; tags: string; category?: string }>();
export function LegacyPublishingPanel({ detail, api, openPath, enabledPlatforms = [], onPublish, publishPending = null }: { detail: ContentDetail; api: ProductionClient;  openPath: (path: string) => Promise<void>; enabledPlatforms?: readonly PublishPlatform[]; onPublish?: (platform: PublishPlatform, status: PublishMark) => void; publishPending?: PublishPlatform | null }) {
  const data = useProjectData(api, detail);
  const [state, setState] = useState<ProductionView>(), [settings, setSettings] = useState<ProductionSettingsView>(), [error, setError] = useState<string>(), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [queryFailed, setQueryFailed] = useState(false), [queryError, setQueryError] = useState<string>(), [now, setNow] = useState(Date.now()), [detailsOpen, setDetailsOpen] = useState(false), [associationOpen, setAssociationOpen] = useState(false);
  const initial = publishDrafts.get(detail.folderPath);
  const [title, setTitle] = useState(initial?.title ?? detail.title), [description, setDescription] = useState(initial?.description ?? detail.title), [tags, setTags] = useState(initial?.tags ?? detail.tags.join("，"));
  const [platform, setPlatform] = useState<PublishPlatform>(enabledPlatforms[0] ?? "xiaohongshu"), [rights, setRights] = useState(false), [useCovers, setUseCovers] = useState(Boolean(Object.keys(detail.covers).length));
  const [category, setCategory] = useState(initial?.category ?? "");
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>();
  const [acknowledge, setAcknowledge] = useState(false);
  const [metricPlatform, setMetricPlatform] = useState<PublishPlatform | "official-account">(enabledPlatforms[0] ?? "xiaohongshu"), [remoteId, setRemoteId] = useState(""), [url, setUrl] = useState("");
  const associationIdentity=useRef<{platform:PublishPlatform|"official-account";accountId:string}>();
  const alive = useRef(true), current = useRef(detail.folderPath); current.current = detail.folderPath;
  const scope = { id: detail.id, folderPath: detail.folderPath };
  const associationPlatforms: readonly (PublishPlatform | "official-account")[] = settings?.wechat.appid ? [...enabledPlatforms, "official-account" as const] : enabledPlatforms;
  useEffect(() => {
    if (associationPlatforms.length && !associationPlatforms.includes(metricPlatform)) { setMetricPlatform(associationPlatforms[0]!); setRemoteId(""); setUrl(""); }
    if (enabledPlatforms.length && !enabledPlatforms.includes(platform)) setPlatform(enabledPlatforms[0]!);
  }, [enabledPlatforms.join(","), metricPlatform, platform, settings?.wechat.appid]);
  useEffect(()=>{const id=metricPlatform==="official-account"?settings?.wechat.appid:settings?.accounts[metricPlatform]?.id;associationIdentity.current=id?{platform:metricPlatform,accountId:id}:undefined;setRemoteId("");setUrl("");},[metricPlatform,settings?.revision]);
  useEffect(() => { publishDrafts.set(detail.folderPath, { title, description, tags, category }); }, [detail.folderPath, title, description, tags, category]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (data.state) setState(data.state); setQueryFailed(Boolean(data.error)); setQueryError(data.error); }, [data.state, data.error]);
  useEffect(() => { void data.query.settings().then(setSettings, e => setError(e.message)); }, [api]);
  const run = async (request: ProductionAction) => {
    if (request.action === "associate-publication" && !associationPlatforms.includes(request.platform)) { setError("此平台尚未启用，请选择当前可用的平台。"); return; }
    if(request.action==="associate-publication"){const owner=associationIdentity.current;if(!owner||owner.platform!==request.platform){setError("请重新选择当前账号的作品。");return;}request={...request,expectedAccountId:owner.accountId};}
    if (busy) return; const folder = detail.folderPath; setBusy(true); setError(undefined);
    try { const next = await bounded(api.action(request)); if (!alive.current || current.current !== folder) return; setState(next); data.query.accept(next);
      if (request.action === "upload") setUploadNotice(next.uploadNotice);
    } catch (cause) { if (alive.current && current.current === folder) { setError(cause instanceof Error ? cause.message : "操作未完成，请重试。"); setRetry((n) => n + 1); } }
    finally { if (alive.current && current.current === folder) setBusy(false); }
  };
  const tasks = state?.tasks.filter(task => !task.publicationId && ["upload", "metrics", "wechat"].includes(task.kind)) ?? [];
  const selected = detail.videos?.find((video) => video.name === detail.selectedVideo);
  const nonMetricTasks = tasks.filter((task) => task.kind !== "metrics");
  const latestBusinessTask = nonMetricTasks.at(-1);
  const currentBusinessTask = [...nonMetricTasks].reverse().find(isActiveTask) ?? (latestBusinessTask && ["failed", "blocked", "unconfirmed", "ready"].includes(latestBusinessTask.status) ? latestBusinessTask : undefined);
  const transcript = [...(state?.transcripts ?? [])].reverse().find((entry) => selected && entry.video.name === selected.name && entry.video.size === selected.size && entry.video.modifiedAt === selected.modifiedAt);
  const hasUnconfirmed = tasks.some((task) => task.status === "unconfirmed"), account = settings?.accounts[platform];
  const startUpload = (newUploadAfter?: string) => run({ ...scope, action: "upload", input: { platform, title, description, tags: tags.split(/[,，\n]/).map((value) => value.trim().replace(/^#/, "")).filter(Boolean), originalRightsConfirmed: rights, useCovers, ...(platform === "bilibili" && category.trim() ? { category: category.trim() } : {}) }, ...(newUploadAfter ? { newUploadAfter } : {}) });
  const canVideo = detail.videoSelection === "selected" && Boolean(detail.selectedVideo);
  const visibleMetrics = state?.metrics.filter((row) => row.platform === "official-account" ? row.accountId === settings?.wechat.appid : row.accountId === settings?.accounts[row.platform]?.id) ?? [];
  const renderTask = (task: ProductionTaskView) => <div className="productionTask" key={task.id}>
    <p><strong>{KIND[task.kind]}{task.platform ? ` · ${PUBLISH_PLATFORM_DEFINITIONS[task.platform].name}` : ""}</strong> · {STATUS[task.status]}</p>
    <small>{task.video?.name}{task.account ? ` · ${task.account.name}` : ""} · {new Date(task.createdAt).toLocaleString()}</small>
    {task.error && <p className="creatorError">{task.error}</p>}
    <ActionBar>{isActiveTask(task) && <ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "cancel", taskId: task.id })}>取消</ActionButton>}
      {task.kind === "upload" && !isActiveTask(task) && task.packageFile && <><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "inspect-upload", taskId: task.id })}>检查草稿</ActionButton>{task.status !== "ready" && <ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "resume-upload", taskId: task.id })}>继续原任务</ActionButton>}</>}
      {task.receipt && <ActionButton disabled={busy} onClick={() => void openPath(`${detail.folderPath}/${task.receipt}`).catch((cause: Error) => setError(cause.message))}>查看结果文件</ActionButton>}
    </ActionBar>
  </div>;
  const syncTask = [...(state?.tasks ?? [])].reverse().find((t) => t.kind === "metrics" && t.metricsTargets?.some((target) => target.accountId === (target.platform === "official-account" ? settings?.wechat.appid : settings?.accounts[target.platform]?.id)));
  const syncing = Boolean(syncTask && isActiveTask(syncTask));
  useEffect(() => { if (!syncing) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [syncing]);
  const candidates = (state?.candidates ?? []).filter((row) => row.platform === metricPlatform && row.accountId === (row.platform === "official-account" ? settings?.wechat.appid : settings?.accounts[row.platform]?.id));
  const metrics = <section className="productionData" aria-label="发布状态与数据">
    <div className="productionHeading"><h3>发布状态与数据</h3><ActionBar><ActionButton disabled={busy || syncing || !associationPlatforms.length} onClick={() => void run({ ...scope, action: "refresh-metrics",  })}>同步数据</ActionButton><ActionButton tone="ghost" onClick={() => setAssociationOpen(!associationOpen)}>关联作品</ActionButton></ActionBar></div>
    {syncing && <div className="creatorInlineStatus" role="status"><span>{queryFailed ? "状态暂不可用" : `正在同步${syncTask?.metricsProgress?.find((p) => p.state === "running")?.platform ? " · " + PUBLISH_PLATFORM_DEFINITIONS[syncTask.metricsProgress.find((p) => p.state === "running")!.platform as PublishPlatform]?.name : ""} · ${Math.max(0, Math.floor((now - syncTask!.createdAt) / 1000))} 秒`}</span><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "cancel", taskId: syncTask!.id })}>取消同步</ActionButton></div>}
    {queryFailed && <ActionButton onClick={() => void data.query.retry().catch(() => undefined)}>重新查询原任务</ActionButton>}
    {syncTask?.error && !syncing && syncTask.status !== "cancelled" && <p className="creatorError" role="alert">{syncTask.error}</p>}
    <div className="productionMetrics">{associationPlatforms.flatMap((p) => {
      const rows=visibleMetrics.filter(m=>m.platform===p);return (rows.length?rows:[undefined]).map(row=>{const connected = p === "official-account" ? settings?.wechat.appid : settings?.accounts[p]?.id;
      const mark = p === "official-account" ? undefined : detail.publish[p]?.status;
      return <div className="productionPlatformRow" key={`${p}:${row?.accountId??""}:${row?.recordId??row?.publicationId??""}:${row?.remoteId??""}`}><div className="productionHeading"><strong>{p === "official-account" ? "公众号" : PUBLISH_PLATFORM_DEFINITIONS[p].name}</strong>{p !== "official-account" && onPublish && <select aria-label={PUBLISH_PLATFORM_DEFINITIONS[p].name + "发布状态"} disabled={publishPending !== null} value={mark ?? "unpublished"} onChange={(e) => onPublish(p, e.target.value as PublishMark)}><option value="unpublished">未发表</option><option value="draft">草稿就绪</option><option value="published">已发表</option></select>}</div>
        <p>{!connected ? "未连接账号" : !row ? "待关联作品" : row.syncedAt ? [row.views !== undefined ? `播放／阅读 ${row.views}` : "", row.likes !== undefined ? `点赞 ${row.likes}` : "", row.comments !== undefined ? `评论 ${row.comments}` : "", row.shares !== undefined ? `分享 ${row.shares}` : ""].filter(Boolean).join(" · ") || "暂无可用指标" : "尚未取得数据"}</p>
        {row?.error && <p className="creatorError">{row.error}</p>}{row?.syncedAt && <small className="creatorMuted">{new Date(row.syncedAt).toLocaleString()}{row.state !== "ok" ? " · 上次成功数据" : ""}</small>}
      </div>;
    });})}</div>
    {associationOpen && <div className="productionAssociation"><div className="productionHeading"><h4>关联已发表作品</h4><ActionButton tone="ghost" onClick={() => setAssociationOpen(false)}>关闭</ActionButton></div>
      <div className="productionFields"><label>平台<select value={metricPlatform} onChange={(e) => setMetricPlatform(e.target.value as typeof metricPlatform)}>{associationPlatforms.map((p) => <option key={p} value={p}>{p === "official-account" ? "公众号" : PUBLISH_PLATFORM_DEFINITIONS[p].name}</option>)}</select></label></div>
      {candidates.map((row) => <div className="creatorAssetRow" key={`${row.platform}:${row.accountId}:${row.remoteId}`}><span>{row.title}</span><ActionButton disabled={busy || syncing} onClick={() => void run({ ...scope, action: "associate-publication", platform: row.platform, remoteId: row.remoteId, candidateAccountId:row.accountId, ...(row.url ? { url: row.url } : {}) })}>关联并读取</ActionButton></div>)}
      <div className="productionFields"><label>作品链接<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label><label>平台作品标识<input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} /></label></div><ActionButton disabled={busy || syncing || !remoteId.trim() || !(metricPlatform === "official-account" ? settings?.wechat.appid : settings?.accounts[metricPlatform]?.id)} onClick={() => void run({ ...scope, action: "associate-publication", platform: metricPlatform, remoteId: remoteId.trim(), ...(url.trim() ? { url: url.trim() } : {}) })}>关联并读取数据</ActionButton>
    </div>}
  </section>;
  return <section className="productionPanel" aria-label="已有发布记录">
    <>
      <h3>视频发布</h3><details className="creatorDisclosure"><summary>准备上传</summary>
        <p className="creatorMuted" title={detail.selectedVideo}>{detail.selectedVideo ?? "请先选择当前视频"}</p>
        <div className="productionFields"><label>平台<select value={platform} onChange={(e) => setPlatform(e.target.value as PublishPlatform)}>{PUBLISH_PLATFORMS.map((p) => <option value={p} key={p}>{PUBLISH_PLATFORM_DEFINITIONS[p].name}{settings?.accounts[p] ? "" : " · 未连接"}</option>)}</select></label><label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>简介<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label><label>话题／标签<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗号分隔" /></label></div>
        {platform === "bilibili" && <label className="creatorField">B站分区<input value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} placeholder="留空使用平台推荐，例如：科技数码" /></label>}
        <label className="productionInline"><input type="checkbox" checked={useCovers} onChange={(e) => setUseCovers(e.target.checked)} />使用当前选中的封面</label>
        <label className="productionInline"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />我确认本次视频可按原创上传</label>
        <ActionButton tone="primary" disabled={busy || !canVideo || !rights || !account || !enabledPlatforms.includes(platform)} onClick={() => void startUpload()}>上传并准备草稿</ActionButton>
        {uploadNotice && <div role="status"><p>{uploadNotice.message}</p><ActionBar><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "inspect-upload", taskId: uploadNotice.taskId })}>检查原草稿</ActionButton><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "resume-upload", taskId: uploadNotice.taskId })}>继续原任务</ActionButton></ActionBar>{uploadNotice.canCreateNew && <details className="creatorDisclosure"><summary>需要另外一份草稿</summary><p>原任务和平台草稿会保留；以下操作会用当前材料另建一次上传。</p><ActionButton disabled={busy || !canVideo || !rights || !account || !enabledPlatforms.includes(platform)} onClick={() => void startUpload(uploadNotice.taskId)}>确认另建上传</ActionButton></details>}</div>}
        {!enabledPlatforms.includes(platform) && <p className="creatorMuted">请先在常规设置中启用此平台。</p>}
        {!account && <p className="creatorMuted">请先在“设置 → 发布平台”连接账号。</p>}
        <p className="creatorMuted">完成后请到平台核对并发表。</p>
      </details>{metrics}
    </>
    {queryError && <p role="alert" className="creatorError">{queryError}</p>}
    {error && <div><p role="alert" className="creatorError">{error}</p>{!state && <ActionButton onClick={() => void data.query.retry().catch(() => undefined)}>重新读取</ActionButton>}</div>}
    {hasUnconfirmed && <label className="productionInline"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />我已核对上次结果，确认重新请求</label>}
    {currentBusinessTask && renderTask(currentBusinessTask)}{tasks.length > 0 && <><ActionButton tone="ghost" onClick={() => setDetailsOpen(!detailsOpen)}>任务详情</ActionButton>{detailsOpen && <div className="productionTaskDetails"><div className="productionHeading"><h4>任务详情</h4><ActionButton tone="ghost" onClick={() => setDetailsOpen(false)}>关闭</ActionButton></div>{[...tasks].reverse().map(renderTask)}</div>}</>}
  </section>;
}
