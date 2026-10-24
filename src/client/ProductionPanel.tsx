import { useEffect, useRef, useState } from "react";
import type { ContentDetail, PublishMark, PublishPlatform } from "../types.ts";
import { PUBLISH_PLATFORM_DEFINITIONS, PUBLISH_PLATFORMS } from "../platforms.ts";
import { isActiveTask, type ProductionAction, type ProductionSettingsView, type ProductionState, type ProductionTask, type UploadNotice } from "../production/types.ts";
import { localFilePath, type ProductionClient } from "./productionApi.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./ProductionPanel.css";

const STATUS: Record<ProductionTask["status"], string> = { queued: "等待开始", running: "处理中", "waiting-agent": "等待对话处理", ready: "草稿就绪", completed: "已完成", blocked: "需要处理", failed: "未完成", cancelled: "已取消", unconfirmed: "结果需核对" };
const KIND: Record<ProductionTask["kind"], string> = { upload: "视频上传", asr: "视频转文字", article: "文章制作", wechat: "公众号草稿", metrics: "数据刷新" };
async function bounded<T>(work: Promise<T>, ms = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("状态暂不可用，请查询原任务；未重新提交。")), ms); })]); }
  finally { clearTimeout(timer!); }
}
const publishDrafts = new Map<string, { title: string; description: string; tags: string; category?: string }>();
export function ProductionPanel({ detail, api, mode, openPath, enabledPlatforms = [], onPublish, publishPending = null }: { detail: ContentDetail; api: ProductionClient; mode: "publishing" | "subtitle" | "article"; openPath: (path: string) => Promise<void>; enabledPlatforms?: readonly PublishPlatform[]; onPublish?: (platform: PublishPlatform, status: PublishMark) => void; publishPending?: PublishPlatform | null }) {
  const [state, setState] = useState<ProductionState>(), [settings, setSettings] = useState<ProductionSettingsView>(), [error, setError] = useState<string>(), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [queryFailed, setQueryFailed] = useState(false), [queryError, setQueryError] = useState<string>(), [now, setNow] = useState(Date.now()), [detailsOpen, setDetailsOpen] = useState(false), [associationOpen, setAssociationOpen] = useState(false);
  const initial = publishDrafts.get(detail.folderPath);
  const [title, setTitle] = useState(initial?.title ?? detail.title), [description, setDescription] = useState(initial?.description ?? detail.title), [tags, setTags] = useState(initial?.tags ?? detail.tags.join("，"));
  const [platform, setPlatform] = useState<PublishPlatform>(enabledPlatforms[0] ?? "xiaohongshu"), [rights, setRights] = useState(false), [useCovers, setUseCovers] = useState(Boolean(Object.keys(detail.covers).length));
  const [category, setCategory] = useState(initial?.category ?? "");
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>();
  const [articleFile, setArticleFile] = useState(""), [preview, setPreview] = useState<{ html: string; path: string }>(), [previewError, setPreviewError] = useState<string>(), [previewRetry, setPreviewRetry] = useState(0), [requestReady, setRequestReady] = useState(false), [acknowledge, setAcknowledge] = useState(false), [confirmRemote, setConfirmRemote] = useState(false);
  const [metricPlatform, setMetricPlatform] = useState<PublishPlatform | "official-account">(mode === "article" ? "official-account" : enabledPlatforms[0] ?? "xiaohongshu"), [remoteId, setRemoteId] = useState(""), [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null), alive = useRef(true), current = useRef(detail.folderPath); current.current = detail.folderPath;
  const scope = { id: detail.id, folderPath: detail.folderPath };
  const associationPlatforms: readonly (PublishPlatform | "official-account")[] = mode === "article" ? ["official-account" as const] : enabledPlatforms;
  useEffect(() => {
    if (associationPlatforms.length && !associationPlatforms.includes(metricPlatform)) { setMetricPlatform(associationPlatforms[0]!); setRemoteId(""); setUrl(""); }
    if (enabledPlatforms.length && !enabledPlatforms.includes(platform)) setPlatform(enabledPlatforms[0]!);
  }, [enabledPlatforms.join(","), mode, metricPlatform, platform]);
  useEffect(() => { publishDrafts.set(detail.folderPath, { title, description, tags, category }); }, [detail.folderPath, title, description, tags, category]);
  useEffect(() => {
    alive.current = true; let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { const [next, config] = await Promise.all([bounded(api.state(scope)), bounded(api.settings())]); if (!active) return; setQueryFailed(false); setQueryError(undefined); setState(next); setSettings(config); if (next.tasks.some(isActiveTask)) timer = setTimeout(() => void poll(), 2500); }
      catch (cause) { if (active) { setQueryFailed(true); setQueryError(cause instanceof Error ? cause.message : "状态暂不可用，请重试查询原任务。"); } }
    }; void poll();
    return () => { active = false; alive.current = false; clearTimeout(timer); };
  }, [api, detail.folderPath, retry]);
  const previewIdentity = useRef("");
  const currentArticle = articleFile || state?.articles.at(-1)?.file || detail.articlePath;
  useEffect(() => {
    if (mode !== "article" || !currentArticle || !settings) return;
    const identity = `${detail.folderPath}:${currentArticle}:${settings.wechat.theme}`;
    if (previewIdentity.current !== identity) { setPreview(undefined); previewIdentity.current = identity; }
    let active = true; setPreviewError(undefined);
    void api.preview({ ...scope, articleFile: currentArticle }).then((result) => { if (active) setPreview(result); }, (cause) => { if (active) setPreviewError(cause instanceof Error ? cause.message : "文章排版未完成，请重试。"); });
    return () => { active = false; };
  }, [api, mode, detail.folderPath, currentArticle, detail.article, settings?.wechat.theme, previewRetry]);
  const run = async (request: ProductionAction) => {
    if (request.action === "associate-publication" && !associationPlatforms.includes(request.platform)) { setError("此平台尚未启用，请选择当前可用的平台。"); return; }
    if (busy) return; const folder = detail.folderPath; setBusy(true); setError(undefined);
    try { const next = await bounded(api.action(request)); if (!alive.current || current.current !== folder) return; setState(next); setRetry((n) => n + 1);
      if (request.action === "upload") setUploadNotice(next.uploadNotice);
    } catch (cause) { if (alive.current && current.current === folder) { setError(cause instanceof Error ? cause.message : "操作未完成，请重试。"); setRetry((n) => n + 1); } }
    finally { if (alive.current && current.current === folder) setBusy(false); }
  };
  const prepareArticle = async (append = false) => {
    if (busy) return; const folder = detail.folderPath; setBusy(true); setError(undefined);
    try { await api.prepareArticleDraft(detail, append); if (alive.current && current.current === folder) { setRequestReady(true); setRetry((n) => n + 1); } }
    catch (cause) { if (alive.current && current.current === folder) setError(cause instanceof Error ? cause.message : "文章请求未准备好。"); }
    finally { if (alive.current && current.current === folder) setBusy(false); }
  };
  const tasks = state?.tasks.filter((task) => mode === "publishing" ? task.kind === "upload" || task.kind === "metrics" : mode === "subtitle" ? task.kind === "asr" : ["article", "wechat"].includes(task.kind)) ?? [];
  const selected = detail.videos?.find((video) => video.name === detail.selectedVideo);
  const nonMetricTasks = tasks.filter((task) => task.kind !== "metrics");
  const latestBusinessTask = nonMetricTasks.at(-1);
  const currentBusinessTask = [...nonMetricTasks].reverse().find(isActiveTask) ?? (latestBusinessTask && ["failed", "blocked", "unconfirmed", "ready"].includes(latestBusinessTask.status) ? latestBusinessTask : undefined);
  const transcript = [...(state?.transcripts ?? [])].reverse().find((entry) => selected && entry.video.name === selected.name && entry.video.size === selected.size && entry.video.modifiedAt === selected.modifiedAt);
  const hasUnconfirmed = tasks.some((task) => task.status === "unconfirmed"), account = settings?.accounts[platform];
  const startUpload = (newUploadAfter?: string) => run({ ...scope, action: "upload", input: { platform, title, description, tags: tags.split(/[,，\n]/).map((value) => value.trim().replace(/^#/, "")).filter(Boolean), originalRightsConfirmed: rights, useCovers, ...(platform === "bilibili" && category.trim() ? { category: category.trim() } : {}) }, ...(newUploadAfter ? { newUploadAfter } : {}) });
  const canVideo = detail.videoSelection === "selected" && Boolean(detail.selectedVideo);
  const visibleMetrics = state?.metrics.filter((row) => mode === "article" ? row.platform === "official-account" && row.accountId === settings?.wechat.appid : row.platform !== "official-account" && row.accountId === settings?.accounts[row.platform]?.id) ?? [];
  const renderTask = (task: ProductionTask) => <div className="productionTask" key={task.id}>
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
    <div className="productionHeading"><h3>发布状态与数据</h3><ActionBar><ActionButton disabled={busy || syncing || mode === "publishing" && !enabledPlatforms.length} onClick={() => void run({ ...scope, action: "refresh-metrics", ...(mode === "article" ? { platform: "official-account" as const } : {}) })}>同步数据</ActionButton><ActionButton tone="ghost" onClick={() => setAssociationOpen(!associationOpen)}>关联作品</ActionButton></ActionBar></div>
    {syncing && <div className="creatorInlineStatus" role="status"><span>{queryFailed ? "状态暂不可用" : `正在同步${syncTask?.metricsProgress?.find((p) => p.state === "running")?.platform ? " · " + PUBLISH_PLATFORM_DEFINITIONS[syncTask.metricsProgress.find((p) => p.state === "running")!.platform as PublishPlatform]?.name : ""} · ${Math.max(0, Math.floor((now - syncTask!.createdAt) / 1000))} 秒`}</span><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "cancel", taskId: syncTask!.id })}>取消同步</ActionButton></div>}
    {queryFailed && <ActionButton onClick={() => setRetry((n) => n + 1)}>重新查询原任务</ActionButton>}
    {syncTask?.error && !syncing && syncTask.status !== "cancelled" && <p className="creatorError" role="alert">{syncTask.error}</p>}
    <div className="productionMetrics">{(mode === "article" ? ["official-account" as const] : enabledPlatforms).map((p) => {
      const row = visibleMetrics.find((m) => m.platform === p), connected = p === "official-account" ? settings?.wechat.appid : settings?.accounts[p]?.id;
      const mark = p === "official-account" ? undefined : detail.publish[p]?.status;
      return <div className="productionPlatformRow" key={p}><div className="productionHeading"><strong>{p === "official-account" ? "公众号" : PUBLISH_PLATFORM_DEFINITIONS[p].name}</strong>{p !== "official-account" && onPublish && <select aria-label={PUBLISH_PLATFORM_DEFINITIONS[p].name + "发布状态"} disabled={publishPending !== null} value={mark ?? "unpublished"} onChange={(e) => onPublish(p, e.target.value as PublishMark)}><option value="unpublished">未发表</option><option value="draft">草稿就绪</option><option value="published">已发表</option></select>}</div>
        <p>{!connected ? "未连接账号" : !row ? "待关联作品" : row.syncedAt ? [row.views !== undefined ? `播放／阅读 ${row.views}` : "", row.likes !== undefined ? `点赞 ${row.likes}` : "", row.comments !== undefined ? `评论 ${row.comments}` : "", row.shares !== undefined ? `分享 ${row.shares}` : ""].filter(Boolean).join(" · ") || "暂无可用指标" : "尚未取得数据"}</p>
        {row?.error && <p className="creatorError">{row.error}</p>}{row?.syncedAt && <small className="creatorMuted">{new Date(row.syncedAt).toLocaleString()}{row.state !== "ok" ? " · 上次成功数据" : ""}</small>}
      </div>;
    })}</div>
    {associationOpen && <div className="productionAssociation"><div className="productionHeading"><h4>关联已发表作品</h4><ActionButton tone="ghost" onClick={() => setAssociationOpen(false)}>关闭</ActionButton></div>
      <div className="productionFields"><label>平台<select value={metricPlatform} onChange={(e) => setMetricPlatform(e.target.value as typeof metricPlatform)}>{(mode === "article" ? ["official-account" as const] : enabledPlatforms).map((p) => <option key={p} value={p}>{p === "official-account" ? "公众号" : PUBLISH_PLATFORM_DEFINITIONS[p].name}</option>)}</select></label></div>
      {candidates.map((row) => <div className="creatorAssetRow" key={row.remoteId}><span>{row.title}</span><ActionButton disabled={busy || syncing} onClick={() => void run({ ...scope, action: "associate-publication", platform: row.platform, remoteId: row.remoteId, ...(row.url ? { url: row.url } : {}) })}>关联并读取</ActionButton></div>)}
      <div className="productionFields"><label>作品链接<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label><label>平台作品标识<input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} /></label></div><ActionButton disabled={busy || syncing || !remoteId.trim()} onClick={() => void run({ ...scope, action: "associate-publication", platform: metricPlatform, remoteId: remoteId.trim(), ...(url.trim() ? { url: url.trim() } : {}) })}>关联并读取数据</ActionButton>
    </div>}
  </section>;
  return <section className="productionPanel" aria-label={mode === "publishing" ? "视频发布" : mode === "subtitle" ? "视频转文字" : "公众号文章操作"}>
    {mode === "publishing" && <>
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
    </>}
    {mode === "subtitle" && <>
      <div className="productionHeading"><h3>视频转文字</h3><ActionBar><ActionButton tone={transcript ? "secondary" : "primary"} disabled={busy || !canVideo || tasks.some(isActiveTask) || hasUnconfirmed && !acknowledge} onClick={() => void run({ ...scope, action: "transcribe", acknowledgeUnknown: acknowledge })}>{transcript ? "使用已有转写" : "视频转文字"}</ActionButton><ActionButton disabled={busy || !canVideo} onClick={() => fileInput.current?.click()}>导入字幕</ActionButton></ActionBar></div>
      <input hidden ref={fileInput} aria-label="导入字幕" type="file" accept=".srt,.ass" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { try { void run({ ...scope, action: "import-subtitle", sourcePath: localFilePath(file) }); } catch (cause) { setError(cause instanceof Error ? cause.message : "字幕路径读取失败"); } } }} />
      <p className="creatorMuted">{transcript ? `${transcript.source === "volcano" ? "火山转写" : "已导入字幕"} · ${transcript.cues} 段 · ${transcript.video.name}` : "字幕用于视频转文章，上传视频无需先生成字幕。"}</p>
      {transcript && <ActionButton onClick={() => void openPath(`${detail.folderPath}/${transcript.srtFile}`).catch((cause: Error) => setError(cause.message))}>打开字幕文件</ActionButton>}
      {!transcript && Boolean(state?.transcripts.length) && <p className="creatorMuted">已有字幕属于其他视频，当前视频需要重新识别或导入。</p>}
    </>}
    {mode === "article" && <>
      <ActionBar><ActionButton tone={!detail.hasArticle ? "primary" : "secondary"} disabled={busy || !canVideo} onClick={() => void prepareArticle()}>让 Agent 制作文章</ActionButton>{preview && <ActionButton onClick={() => void openPath(preview.path).catch((cause: Error) => setError(cause.message))}>打开 HTML 成品</ActionButton>}</ActionBar>
      {requestReady && <p className="creatorMuted" role="status">请求已放入左侧对话，请点击发送。</p>}
      {error?.includes("已有草稿") && <ActionButton onClick={() => void prepareArticle(true)}>追加文章请求</ActionButton>}
      {Boolean(state?.articles.length) && <label className="creatorField">文章版本<select value={articleFile} onChange={(e) => setArticleFile(e.target.value)}><option value="">当前文章</option>{state!.articles.map((article) => <option key={article.id} value={article.file}>{new Date(article.createdAt).toLocaleString()}</option>)}</select></label>}
      {currentArticle && <section aria-label="文章成品">
        {!preview && !previewError && <p role="status" className="creatorMuted">正在排版…</p>}
        {previewError && <div><p role="alert" className="creatorError">{previewError}</p><ActionButton onClick={() => setPreviewRetry((n) => n + 1)}>重试排版</ActionButton></div>}
        {preview && <iframe className="productionPreview" title="公众号排版预览" sandbox="" srcDoc={preview.html} />}
      </section>}
      {currentArticle && <details className="creatorDisclosure"><summary>编辑源稿</summary><ActionButton onClick={() => void openPath(/^(?:[A-Za-z]:[\\/]|\/)/.test(currentArticle) ? currentArticle : `${detail.folderPath}/${currentArticle}`).catch((cause: Error) => setError(cause.message))}>打开可编辑源稿</ActionButton><ActionButton onClick={() => setPreviewRetry((n) => n + 1)}>更新排版</ActionButton></details>}
      <details className="creatorDisclosure"><summary>公众号草稿</summary>
        <ActionBar><ActionButton disabled={busy || !preview || !settings?.wechatConfigured || hasUnconfirmed && !acknowledge} onClick={() => void run({ ...scope, action: "wechat-draft", ...(currentArticle ? { articleFile: currentArticle } : {}), acknowledgeUnknown: acknowledge, confirmRemoteChange: confirmRemote })}>保存到公众号草稿</ActionButton></ActionBar>
        {error?.includes("后台修改") && <label className="productionInline"><input type="checkbox" checked={confirmRemote} onChange={(e) => setConfirmRemote(e.target.checked)} />我已核对后台修改，确认用本次文章更新</label>}
        {!settings?.wechatConfigured && <p className="creatorMuted">请先在“设置 → 公众号”完成配置。</p>}
      </details>{metrics}
    </>}
    {queryError && <p role="alert" className="creatorError">{queryError}</p>}
    {error && <div><p role="alert" className="creatorError">{error}</p>{!state && <ActionButton onClick={() => setRetry((n) => n + 1)}>重新读取</ActionButton>}</div>}
    {hasUnconfirmed && <label className="productionInline"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />我已核对上次结果，确认重新请求</label>}
    {currentBusinessTask && renderTask(currentBusinessTask)}{tasks.length > 0 && <><ActionButton tone="ghost" onClick={() => setDetailsOpen(!detailsOpen)}>任务详情</ActionButton>{detailsOpen && <div className="productionTaskDetails"><div className="productionHeading"><h4>任务详情</h4><ActionButton tone="ghost" onClick={() => setDetailsOpen(false)}>关闭</ActionButton></div>{[...tasks].reverse().map(renderTask)}</div>}</>}
  </section>;
}
