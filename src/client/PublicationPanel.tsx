import type { ProductionView, ProductionTaskView } from "../projectView.ts";
import { LegacyPublishingPanel } from "./LegacyPublishingPanel.tsx";
import { useProjectData } from "./ProjectData.tsx";
import { ImageThumb } from "./ImageThumb.tsx";
import { publicationLabel } from "../projectView.ts";
import { useEffect, useRef, useState } from "react";
import type { ContentDetail, PublishMark, PublishPlatform } from "../types.ts";
import type { CreationImage, ProductionAction, ProductionState, PublicationDraft, PublicationInput, PublicationPlatform } from "../production/types.ts";
import { isActiveTask } from "../production/types.ts";
import { PUBLISH_PLATFORM_DEFINITIONS } from "../platforms.ts";
import { localFilePath, type ProductionClient } from "./productionApi.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./CreationPanel.css";

const platformName = (p: PublicationPlatform) => p === "official-account" ? "公众号" : PUBLISH_PLATFORM_DEFINITIONS[p].name;
const typeName = { video: "视频", images: "图文", article: "文章" };
const cache = new Map<string, { id: string; input: PublicationInput; revision?: number }>();
const draftKey = (folder: string) => `dsh-creator-workbench:publication-draft:${folder}`;
function readDraft(folder: string) { try { return cache.get(folder) ?? JSON.parse(sessionStorage.getItem(draftKey(folder)) ?? "null") as { id: string; input: PublicationInput; revision?: number } | null; } catch { return undefined; } }
async function bounded<T>(promise: Promise<T>): Promise<T> { let timer: ReturnType<typeof setTimeout>; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("状态暂不可用，请重新查询原任务。")), 15000); })]); } finally { clearTimeout(timer!); } }
const asInput = (p: PublicationDraft): PublicationInput => ({ platform: p.platform, type: p.type, title: p.title, body: p.body ?? "", tags: [...p.tags], imageIds: [...p.imageIds], ...(p.video ? { video: p.video } : {}), ...(p.articleId ? { articleId: p.articleId } : {}), ...(p.articleFile ? { articleFile: p.articleFile } : {}), ...(p.coverImageId ? { coverImageId: p.coverImageId } : {}), ...(p.coverFiles ? { coverFiles: p.coverFiles } : {}), ...(p.category ? { category: p.category } : {}), ...(p.source ? { source: p.source } : {}) });

export function PublicationPanel({ initialArticleId, initialPublicationId, detail, api, enabledPlatforms = [], onPublish, publishPending, openPath = async () => undefined }: { initialArticleId?: string; initialPublicationId?: string; detail: ContentDetail; api: ProductionClient; enabledPlatforms?: readonly PublishPlatform[]; onPublish?: (platform: PublishPlatform, status: PublishMark) => void; publishPending?: PublishPlatform | null; openPath?: (path: string) => Promise<void> }) {
  const scope = { id: detail.id, folderPath: detail.folderPath }, initial = readDraft(detail.folderPath);
  const fresh = (): PublicationInput => ({ platform: initialArticleId ? "official-account" : enabledPlatforms[0] ?? "xiaohongshu", type: initialArticleId ? "article" : detail.selectedVideo ? "video" : "images", title: detail.title, body: "", tags: [...detail.tags], imageIds: [], ...(detail.selectedVideo ? { video: detail.selectedVideo, coverFiles: { ...detail.covers } } : {}) });
  const [state, setState] = useState<ProductionView>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [open, setOpen] = useState(Boolean(initial || initialArticleId)), [selected, setSelected] = useState(initial?.id ?? ""), [input, setInput] = useState<PublicationInput>(initial?.input ?? fresh), [revision, setRevision] = useState<number | undefined>(initial?.revision), [baseline, setBaseline] = useState(initial ? "" : JSON.stringify(fresh()));
  const [rights, setRights] = useState(false), [request, setRequest] = useState(""), [switchTo, setSwitchTo] = useState<string>(), [associate, setAssociate] = useState<string>(), [remoteId, setRemoteId] = useState(""), [url, setUrl] = useState("");
  const [sourceChanged, setSourceChanged] = useState(false);
  const [platformFilter, setPlatformFilter] = useState(""), [typeFilter, setTypeFilter] = useState(""), [queryFailed, setQueryFailed] = useState(false), [now, setNow] = useState(Date.now());
  const listScroll = useRef(0), root = useRef<HTMLDivElement>(null), alive = useRef(true), mutating = useRef(false), dirty = JSON.stringify(input) !== baseline;
  const editorEpoch = useRef(0), selectedRef = useRef(selected), reuseSequence = useRef(0); selectedRef.current = selected;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const images = state?.images?.filter((i) => !i.hidden) ?? [], publications = state?.publications?.filter((p) => !p.hidden) ?? [];
  const data = useProjectData(api, scope);
  const load = () => data.query.retry();
  useEffect(() => { if (data.state) setState(data.state); setQueryFailed(Boolean(data.error)); }, [data.state, data.error]);
  useEffect(() => { const value = { id: selected, input, ...(revision ? { revision } : {}) }; if (dirty) cache.set(detail.folderPath, value); else cache.delete(detail.folderPath); try { if (dirty) sessionStorage.setItem(draftKey(detail.folderPath), JSON.stringify(value)); else sessionStorage.removeItem(draftKey(detail.folderPath)); } catch { /* In-memory protection remains available. */ } }, [detail.folderPath, open, dirty, input, selected, revision]);
  const run = async (action: ProductionAction) => { if (mutating.current) return undefined; mutating.current = true; setError(""); setBusy(true); try { const next = await bounded(api.action(action)); data.query.accept(next); if (alive.current) setState(next); return next; } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "操作失败"); return undefined; } finally { mutating.current = false; if (alive.current) setBusy(false); } };
  const ask = async (text: string, append = false) => { setError(""); setRequest(text); try { if (!api.prepareRequest) throw new Error("请在左侧项目对话提出此要求。"); await api.prepareRequest(detail, text, append); if (alive.current) setNotice("请求已放入项目对话，请发送。"); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "请求未准备好"); } };
  const chooseTicket = useRef(0);
  const choose = async (id: string) => { if (!open) listScroll.current=root.current?.closest(".body")?.scrollTop ?? 0; const ticket = ++chooseTicket.current, readEpoch = editorEpoch.current, from = selectedRef.current; let p = publications.find((p) => p.id === id);
    if (p && api.publication) { try { p = await api.publication({ ...scope, publicationId: p.id, revision: p.revision }); } catch (e) { setError(e instanceof Error ? e.message : "读取失败"); return; } }
    if (!alive.current || ticket !== chooseTicket.current) return;
    if (readEpoch !== editorEpoch.current || from !== selectedRef.current) { setError("读取期间内容已修改，当前编辑已保留，请再次切换。"); return; } if (p?.bodyError) { setError(p.bodyError); return; } setSourceChanged(Boolean(p?.sourceChanged)); editorEpoch.current++; reuseSequence.current++; selectedRef.current = id; const next = p ? asInput(p) : fresh(); setSelected(id); setInput(next); setRevision(p?.revision); setBaseline(JSON.stringify(next)); setRights(false); setOpen(true); setError(""); setNotice(""); setSwitchTo(undefined); };
  const navigate = (id: string) => { if (dirty) setSwitchTo(id); else choose(id); };
  const openedFromOverview=useRef(false);
  useEffect(()=>{if(openedFromOverview.current||!initialPublicationId||!publications.some(p=>p.id===initialPublicationId))return;openedFromOverview.current=true;if(dirty)setSwitchTo(initialPublicationId);else void choose(initialPublicationId);},[initialPublicationId,state]);
  const save = async () => {
    const target = selected, epoch = editorEpoch.current, snapshot = structuredClone(input), expected = revision;
    const next = await run({ ...scope, action: "save-publication", ...(target ? { publicationId: target, expectedRevision: expected! } : {}), input: snapshot });
    const result = next?.savedPublication ?? (target ? next?.publications?.find(p => p.id === target) : undefined);
    if (!result || !alive.current || selectedRef.current !== target) return undefined;
    const changed = editorEpoch.current !== epoch, saved = next?.publications?.find(p => p.id === result.id), acknowledged = saved ? asInput(saved) : snapshot;
    selectedRef.current = result.id; setSelected(result.id); setRevision(result.revision); setBaseline(JSON.stringify(acknowledged));
    if (!changed) setInput(acknowledged);
    setNotice(changed ? "已保存上一版，当前修改仍未保存。" : "发布材料已保存");
    return changed ? undefined : next?.publications?.find(p => p.id === result.id);
  };
  const edit = (values: Partial<PublicationInput>) => {
    editorEpoch.current++;
    setInput(old => {
      const next = { ...old, ...values };
      if (next.type === "images") {
        if (values.coverImageId) next.imageIds = [values.coverImageId, ...next.imageIds.filter(id => id !== values.coverImageId)];
        else if (values.imageIds && next.coverImageId) { if (next.imageIds[0]) next.coverImageId = next.imageIds[0]; else delete next.coverImageId; }
      }
      return next;
    });
  };
  const removePublication = async () => {
    const target = selected, expected = revision; if (!target || !expected) return;
    const next = await run({ ...scope, action: "remove-publication", publicationId: target, expectedRevision: expected });
    if (!next || !alive.current || selectedRef.current !== target) return;
    editorEpoch.current++; reuseSequence.current++; selectedRef.current = "";
    const value = fresh(); setInput(value); setBaseline(JSON.stringify(value)); setRevision(undefined); setSelected(""); setOpen(false); setAssociate(undefined);
    cache.delete(detail.folderPath); try { sessionStorage.removeItem(draftKey(detail.folderPath)); } catch { /* In-memory state is already cleared. */ }
  };
  const toggleImage = (id: string) => edit({ imageIds: input.imageIds.includes(id) ? input.imageIds.filter((i) => i !== id) : [...input.imageIds, id] });
  const move = (index: number, offset: number) => { const next = [...input.imageIds], target = index + offset; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; edit({ imageIds: next }); };
  const publishTasks = state?.tasks.filter((t) => t.publicationId === selected) ?? [];
  const uploadNotice = state?.uploadNotice && publishTasks.some(task => task.id === state.uploadNotice!.taskId) ? state.uploadNotice : undefined;
  const records = state?.records?.filter((r) => r.publicationId === selected) ?? [];
  const prepared = selected && !dirty && revision;
  const syncTask = [...(state?.tasks ?? [])].reverse().find(t => t.kind === "metrics" && t.metricsTargets?.some(target => target.publicationId === selected));
  const syncing = Boolean(syncTask && isActiveTask(syncTask));
  useEffect(() => { if (!syncing) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [syncing]);
  useEffect(() => { const p = state?.publications?.find(p => p.id === selected && !p.hidden); if (p && !dirty && p.revision !== revision) void choose(p.id); }, [state, selected, dirty, revision]);
  const reuseArticle = async (id: string) => {
    const ticket = ++reuseSequence.current, target = selectedRef.current, epoch = editorEpoch.current;
    if (!id) { editorEpoch.current++; setInput(old => { const { articleId: _id, articleFile: _file, source: _source, ...rest } = old; return rest; }); return; }
    const article = state?.articles.find(a => a.id === id) ?? (id === "legacy" && detail.articlePath ? {id:"legacy",file:detail.articlePath,format:/\.html?$/i.test(detail.articlePath) ? "html" : "markdown"} : undefined); if (!article || !api.text) return;
    try {
      const text = await api.text({ ...scope, file: article.file });
      if (!alive.current || ticket !== reuseSequence.current || target !== selectedRef.current || epoch !== editorEpoch.current) return;
      const body = article.format === "html" && !["official-account", "bilibili"].includes(input.platform) ? new DOMParser().parseFromString(text.text.replace(/<\/(?:p|div|section|h[1-6]|li)>|<br\s*\/?>/gi, "\n"), "text/html").body.textContent?.trim() ?? "" : text.text;
      setSourceChanged(false); edit({ body, ...(id === "legacy" ? {} : {articleId: id}), articleFile: article.file, source: id === "legacy" ? {kind:"materials",files:[article.file]} : { kind: "article", articleId: id, text: `采用文章版本于 ${Date.now()}` } });
    } catch (e) { if (alive.current && ticket === reuseSequence.current && target === selectedRef.current && epoch === editorEpoch.current) setError(e instanceof Error ? e.message : "文章读取失败"); }
  };
  const seeded = useRef(false);
  useEffect(() => { if (!seeded.current && initialArticleId && state && (initialArticleId === "legacy" && detail.articlePath || state.articles.some(a => a.id === initialArticleId))) { seeded.current = true; if (initial) setNotice("已有发布草稿已保留，请在复用文章中选择需要的版本。"); else void reuseArticle(initialArticleId); } }, [state?.articles, initialArticleId]);
  return <div ref={root} className="creationPanel productionPanel">
    <section aria-label="平台发布内容" className="creationSection"><div className="productionHeading"><h3>发布</h3>{dirty && !open && <ActionButton onClick={() => setOpen(true)}>继续编辑</ActionButton>}<ActionButton tone={publications.length ? "secondary" : "primary"} onClick={() => navigate("")}>新建发布内容</ActionButton></div>
      {!open && publications.length > 1 && <div className="articleToolbar"><select aria-label="筛选平台" value={platformFilter} onChange={e=>setPlatformFilter(e.target.value)}><option value="">全部平台</option>{[...new Set(publications.map(p=>p.platform))].map(p=><option key={p} value={p}>{platformName(p)}</option>)}</select><select aria-label="筛选类型" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="">全部类型</option>{[...new Set(publications.map(p=>p.type))].map(t=><option key={t} value={t}>{typeName[t]}</option>)}</select></div>}
      {!publications.length && !open && <p className="creatorMuted">选择视频、文章或图片，为各平台准备独立材料。</p>}
      {!open && <div className="creationPublicationList">{publications.filter(p=>(!platformFilter || p.platform===platformFilter) && (!typeFilter || p.type===typeFilter)).map(p => <button aria-pressed={selected === p.id && open} key={p.id} onClick={() => navigate(p.id)}><strong>{p.title}</strong><span>{platformName(p.platform)} · {typeName[p.type]} · {state ? publicationLabel(state, p.id, data.view?.accountIds) : ""}</span></button>)}</div>}
      {open && <label className="creatorField">切换发布内容<select aria-label="切换发布内容" value={selected} onChange={e => navigate(e.target.value)}><option value="">新建发布内容</option>{publications.map(p => <option key={p.id} value={p.id}>{platformName(p.platform)} · {p.title}</option>)}</select></label>}
      {switchTo !== undefined && <div className="creatorInlineStatus"><span>当前修改尚未保存</span><ActionButton onClick={() => void save().then(p => { if (p) choose(switchTo); })}>保存并切换</ActionButton><ActionButton onClick={() => choose(switchTo)}>放弃修改</ActionButton><ActionButton onClick={() => setSwitchTo(undefined)}>继续编辑</ActionButton></div>}
      {open && <div className="creationPublicationEditor"><div className="productionHeading"><h4>{selected ? "编辑发布内容" : "准备发布内容"}</h4><ActionButton tone="ghost" onClick={() => { if (dirty) setNotice("未保存内容已暂存，可重新打开继续编辑。"); setOpen(false); requestAnimationFrame(()=>{const body=root.current?.closest(".body"); if(body) body.scrollTop=listScroll.current;}); }}>返回发布列表</ActionButton></div>
        {(sourceChanged || publications.find(p => p.id === selected)?.sourceChanged) && <p className="creatorMuted">来源文章已有变化，当前平台文案保持。需要更新时请重新选用来源或让 Agent 改写。</p>}<div className="productionFields creationPublishingFields"><label>平台<select value={input.platform} onChange={e => { const platform = e.target.value as PublicationPlatform; edit({ platform, type: platform === "official-account" ? "article" : platform === "wechat" ? "video" : input.type === "article" && platform !== "bilibili" ? "images" : input.type }); }}>
          {enabledPlatforms.map(p => <option value={p} key={p}>{platformName(p)}</option>)}<option value="official-account">公众号</option>{!enabledPlatforms.includes(input.platform as PublishPlatform) && input.platform !== "official-account" && <option value={input.platform}>{platformName(input.platform)} · 未启用</option>}</select></label>
          <label>发布内容<select value={input.type} onChange={e => edit({ type: e.target.value as PublicationInput["type"] })}>{input.platform !== "official-account" && <option value="video">视频</option>}{!["official-account", "wechat"].includes(input.platform) && <option value="images">图文多图</option>}{["official-account", "bilibili"].includes(input.platform) && <option value="article">文章</option>}</select></label>
          <label>标题<input value={input.title} onChange={e => edit({ title: e.target.value })} /></label><label>正文<textarea rows={6} value={input.body} onChange={e => edit({ body: e.target.value })} /></label><label>话题／标签<input value={input.tags.join("，")} onChange={e => edit({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })} /></label>
          {input.type === "video" && <label>本次视频<select value={input.video ?? ""} onChange={e => edit({ video: e.target.value })}><option value="">请选择</option>{detail.videos?.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</select></label>}
          {Boolean(state?.articles.length) && <label>复用文章<select value={input.articleId ?? ""} onChange={e => void reuseArticle(e.target.value)}><option value="">选择已写好的文章</option>{state?.articles.map(a => <option key={a.id} value={a.id}>{a.title ?? new Date(a.createdAt).toLocaleString()}</option>)}</select></label>}
          {input.platform === "bilibili" && input.type === "video" && <label>分区<input value={input.category ?? ""} onChange={e => edit({ category: e.target.value })} /></label>}
          {(input.type !== "video" || input.platform === "official-account") && <label>{input.platform === "official-account" ? "文章封面" : "首图／封面"}<select value={input.coverImageId ?? ""} onChange={e => edit({ coverImageId: e.target.value })}><option value="">{input.platform === "official-account" ? "请选择封面" : "使用图集首图"}</option>{images.map((i, n) => <option key={i.id} value={i.id}>图片 {n + 1} · {i.width}×{i.height}</option>)}</select></label>}
        </div>
        {input.type !== "video" && <div><h4>图片顺序</h4>{input.imageIds.map((id, index) => { const image = images.find(i => i.id === id); return <div className="creationOrderedImage" key={id}><span>{index + 1}</span>{image ? <ImageThumb image={image} detail={detail} api={api} /> : <span className="creatorError">图片已移除，请重新选择</span>}<ActionBar><ActionButton disabled={!index} onClick={() => move(index, -1)}>上移</ActionButton><ActionButton disabled={index === input.imageIds.length - 1} onClick={() => move(index, 1)}>下移</ActionButton><ActionButton onClick={() => toggleImage(id)}>移出图集</ActionButton></ActionBar></div>; })}<div className="creationImageChoices">{images.filter(i => !input.imageIds.includes(i.id)).map((i, n) => <ActionButton key={i.id} onClick={() => toggleImage(i.id)}>加入图片 {images.indexOf(i) + 1}</ActionButton>)}</div></div>}
        {input.type === "video" && Object.keys(input.coverFiles ?? {}).length > 0 && <p className="creatorMuted">本次封面：{Object.entries(input.coverFiles ?? {}).map(([r, file]) => `${r.replace("x", ":")} · ${file?.split(/[\\/]/).pop()}`).join("；")}</p>}
        {input.type === "video" && <ActionButton onClick={() => edit({ coverFiles: { ...detail.covers } })}>采用当前选用封面</ActionButton>}
        <ActionBar><ActionButton disabled={busy} tone={dirty || !selected ? "primary" : "secondary"} onClick={() => void save()}>保存材料</ActionButton><ActionButton disabled={!prepared || busy} onClick={() => void ask(`请改写本项目的${platformName(input.platform)}发布文案，保留事实与已有图片。发布内容：${selected}，当前版本：${revision}。通过工作台读取并保存独立发布内容，不修改来源文章。`)}>让 Agent 改写文案</ActionButton><ActionButton disabled={!prepared || busy} onClick={() => void ask(`请根据本项目已有视频或文章，为这份${platformName(input.platform)}发布内容制作一组图文图片。发布内容：${selected}，当前版本：${revision}。先读取已有材料，保存并检查实际图片，再以原版本检查更新图集；不修改其他平台材料，不上传发表。`)}>让 Agent 制作多图</ActionButton></ActionBar>
        <label className="productionInline"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} />我确认本次内容拥有发布授权</label>
        <ActionBar><ActionButton tone={prepared ? "primary" : "secondary"} disabled={busy || !prepared || !rights} onClick={() => void run({ ...scope, action: "upload-publication", publicationId: selected, expectedRevision: revision!, originalRightsConfirmed: rights }).then(next => { if (next?.uploadNotice && selectedRef.current === selected) setNotice(next.uploadNotice.message); })}>上传并准备草稿</ActionButton>{selected && <ActionButton tone="ghost" disabled={busy || !revision} onClick={() => void removePublication()}>移除发布内容</ActionButton>}</ActionBar>
        <p className="creatorMuted">最终发表请到平台核对后手动完成。</p>
        {publishTasks.map(t => <div className="creationProgress" key={t.id}><p>{t.step || (isActiveTask(t) ? "正在上传" : t.status === "unconfirmed" ? "结果需核对" : t.status === "cancelled" ? "已取消" : "上传记录")}</p>{t.error && <p className="creatorError">{t.error}</p>}<ActionBar>{isActiveTask(t) ? <ActionButton onClick={() => void run({ ...scope, action: "cancel", taskId: t.id })}>取消</ActionButton> : <><ActionButton onClick={() => void run({ ...scope, action: "inspect-upload", taskId: t.id })}>检查原任务</ActionButton><ActionButton onClick={() => void run({ ...scope, action: "resume-upload", taskId: t.id })}>继续原任务</ActionButton></>}</ActionBar></div>)}
        {selected && <><div className="productionHeading"><h4>作品与数据</h4><ActionBar><ActionButton disabled={busy || syncing} onClick={() => void run({ ...scope, action: "refresh-metrics", publicationId: selected, platform: input.platform })}>同步数据</ActionButton><ActionButton onClick={() => { setAssociate(""); setRemoteId(""); setUrl(""); }}>关联已发表作品</ActionButton></ActionBar></div>
        {syncTask && <div className="creatorInlineStatus" role="status"><span>{syncing ? queryFailed ? "状态暂不可用" : `正在同步 · ${Math.max(0, Math.floor((now - syncTask.updatedAt) / 1000))} 秒` : syncTask.error || (syncTask.status === "cancelled" ? "同步已取消" : "本次同步已结束")}</span>{syncing && <ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "cancel", taskId: syncTask.id })}>取消同步</ActionButton>}</div>}
        {records.map(r => { const metric = state?.metrics.find(m => m.recordId === r.id); return <div className="creationProgress" key={r.id}><p>{data.view?.accountIds && (r.accountId !== data.view.accountIds[r.platform] || r.platform !== input.platform || r.type !== input.type) ? "历史作品" : r.state === "published" ? "已发表" : r.state === "draft" ? "平台草稿已保存" : r.state === "linked" ? "已关联，待核对数据" : "已上传待人工发表"} · {new Date(r.updatedAt).toLocaleString()}</p>{metric && <p>{metric.views === undefined ? "播放／阅读 —" : `播放／阅读 ${metric.views}`} · {metric.likes === undefined ? "点赞 —" : `点赞 ${metric.likes}`}{metric.error ? ` · ${metric.error}` : ""}</p>}<ActionButton onClick={() => { setAssociate(r.id); setRemoteId(r.remoteId ?? ""); setUrl(r.url ?? ""); }}>关联此作品</ActionButton></div>; })}
        {associate !== undefined && state?.candidates?.filter(c => c.platform === input.platform).map(c => <div className="creatorAssetRow" key={c.remoteId}><span>{c.title}</span><ActionButton disabled={busy} onClick={() => { setRemoteId(c.remoteId); setUrl(c.url ?? ""); }}>选择此作品</ActionButton></div>)}
        {associate !== undefined && <div className="productionFields"><label>作品标识<input value={remoteId} onChange={e => setRemoteId(e.target.value)} /></label><label>作品链接<input value={url} onChange={e => setUrl(e.target.value)} /></label><ActionBar><ActionButton disabled={busy || !remoteId.trim()} onClick={() => void run({ ...scope, action: "associate-publication", publicationId: selected, ...(associate ? { recordId: associate } : {}), platform: input.platform, remoteId, ...(url ? { url } : {}) }).then(r => { if (r) setAssociate(undefined); })}>保存关联并读取数据</ActionButton><ActionButton onClick={() => setAssociate(undefined)}>取消</ActionButton></ActionBar></div>}</>}
      </div>}
    </section>
    {(Object.values(detail.publish ?? {}).some(p => p.source !== "none") || state?.drafts.length || state?.tasks.some(t => ["upload", "wechat"].includes(t.kind) && !t.publicationId)) && <details className="creatorDisclosure"><summary>原有视频发布记录</summary><LegacyPublishingPanel detail={detail} api={api} openPath={openPath} enabledPlatforms={enabledPlatforms} {...(onPublish ? { onPublish } : {})} publishPending={publishPending ?? null} /></details>}
    {uploadNotice && <div className="creatorInlineStatus"><span>{uploadNotice.message}</span><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "inspect-upload", taskId: uploadNotice.taskId })}>检查已有上传</ActionButton><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "resume-upload", taskId: uploadNotice.taskId })}>继续已有上传</ActionButton>{uploadNotice.canCreateNew && <ActionButton disabled={busy || !prepared || !rights} onClick={() => void run({ ...scope, action: "upload-publication", publicationId: selected, expectedRevision: revision!, originalRightsConfirmed: rights, newUploadAfter: uploadNotice.taskId })}>确认另建一份上传</ActionButton>}</div>}
    {notice && <div role="status" className="creatorInlineStatus"><span>{notice}</span><ActionButton tone="ghost" onClick={() => setNotice("")}>关闭</ActionButton></div>}
    {(error || data.error) && <div role="alert"><p className="creatorError">{error || data.error}</p>{error.includes("已有草稿") && request && <ActionButton onClick={() => void ask(request, true)}>追加创作请求</ActionButton>}<ActionButton tone="ghost" onClick={() => void load().catch(() => undefined)}>重新读取</ActionButton></div>}
  </div>;
}
