import { ProductionPanel } from "./ProductionPanel.tsx";
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
const imageCache = new Map<string, string>();
const draftKey = (folder: string) => `dsh-creator-workbench:publication-draft:${folder}`;
function readDraft(folder: string) { try { return cache.get(folder) ?? JSON.parse(sessionStorage.getItem(draftKey(folder)) ?? "null") as { id: string; input: PublicationInput; revision?: number } | null; } catch { return undefined; } }
async function bounded<T>(promise: Promise<T>): Promise<T> { let timer: ReturnType<typeof setTimeout>; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("状态暂不可用，请重新查询原任务。")), 15000); })]); } finally { clearTimeout(timer!); } }
const imageStatus = { pending: "等待制作", running: "正在制作", completed: "已保存", failed: "未完成", cancelled: "已取消", unconfirmed: "结果待核对" };
function ImageThumb({ image, detail, api, large = false }: { image: CreationImage; detail: ContentDetail; api: ProductionClient; large?: boolean }) {
  const key = `${detail.folderPath}:${image.id}:${image.sha256}`, [src, setSrc] = useState(imageCache.get(key)), [error, setError] = useState("");
  useEffect(() => { const cached = imageCache.get(key); setSrc(cached); setError(""); if (cached || !api.image) return; let current = true; void api.image({ id: detail.id, folderPath: detail.folderPath, imageId: image.id }).then((r) => { const url = `data:${r.mime};base64,${r.base64}`; imageCache.set(key, url); if (imageCache.size > 12) imageCache.delete(imageCache.keys().next().value!); if (current) setSrc(url); }, (e: Error) => { if (current) setError(e.message); }); return () => { current = false; }; }, [key, api]);
  return src ? <img className={large ? "creationImageLarge" : "creationImageThumb"} src={src} loading="lazy" alt={image.purpose === "cover" ? "封面" : image.purpose === "card" ? "图文图片" : "正文配图"} /> : <span className="creatorMuted">{error || "读取图片…"}</span>;
}
const asInput = (p: PublicationDraft): PublicationInput => ({ platform: p.platform, type: p.type, title: p.title, body: p.body ?? "", tags: [...p.tags], imageIds: [...p.imageIds], ...(p.video ? { video: p.video } : {}), ...(p.articleId ? { articleId: p.articleId } : {}), ...(p.articleFile ? { articleFile: p.articleFile } : {}), ...(p.coverImageId ? { coverImageId: p.coverImageId } : {}), ...(p.coverFiles ? { coverFiles: p.coverFiles } : {}), ...(p.category ? { category: p.category } : {}), ...(p.source ? { source: p.source } : {}) });

export function CreationPanel({ detail, api, enabledPlatforms = [], onPublish, publishPending, openPath = async () => undefined }: { detail: ContentDetail; api: ProductionClient; enabledPlatforms?: readonly PublishPlatform[]; onPublish?: (platform: PublishPlatform, status: PublishMark) => void; publishPending?: PublishPlatform | null; openPath?: (path: string) => Promise<void> }) {
  const scope = { id: detail.id, folderPath: detail.folderPath }, initial = readDraft(detail.folderPath);
  const fresh = (): PublicationInput => ({ platform: enabledPlatforms[0] ?? "xiaohongshu", type: detail.selectedVideo ? "video" : "images", title: detail.title, body: "", tags: [...detail.tags], imageIds: [], ...(detail.selectedVideo ? { video: detail.selectedVideo, coverFiles: { ...detail.covers } } : {}) });
  const [state, setState] = useState<ProductionState>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [open, setOpen] = useState(Boolean(initial)), [selected, setSelected] = useState(initial?.id ?? ""), [input, setInput] = useState<PublicationInput>(initial?.input ?? fresh), [revision, setRevision] = useState<number | undefined>(initial?.revision), [baseline, setBaseline] = useState(initial ? "" : JSON.stringify(fresh()));
  const [preview, setPreview] = useState<string>(), [rights, setRights] = useState(false), [request, setRequest] = useState(""), [switchTo, setSwitchTo] = useState<string>(), [associate, setAssociate] = useState<string>(), [remoteId, setRemoteId] = useState(""), [url, setUrl] = useState("");
  const [showImages, setShowImages] = useState(false), [unknownRetry, setUnknownRetry] = useState(false), [queryFailed, setQueryFailed] = useState(false), [now, setNow] = useState(Date.now());
  const file = useRef<HTMLInputElement>(null), alive = useRef(true), mutating = useRef(false), dirty = JSON.stringify(input) !== baseline;
  const editorEpoch = useRef(0), selectedRef = useRef(selected), reuseSequence = useRef(0); selectedRef.current = selected;
  const images = state?.images?.filter((i) => !i.hidden) ?? [], publications = state?.publications?.filter((p) => !p.hidden) ?? [];
  const load = async () => { const result = await bounded(api.state(scope)); if (alive.current) { setState(result); setQueryFailed(false); } return result; };
  useEffect(() => { alive.current = true; let timer: ReturnType<typeof setTimeout>; const poll = async () => { try { const next = await load(); if (alive.current) timer = setTimeout(() => void poll(), next.tasks.some(isActiveTask) ? 2000 : 5000); } catch (e) { if (alive.current) { setQueryFailed(true); setError(e instanceof Error ? e.message : "内容读取失败"); timer = setTimeout(() => void poll(), 8000); } } }; void poll(); return () => { alive.current = false; clearTimeout(timer); }; }, [api, detail.folderPath]);
  useEffect(() => { const value = { id: selected, input, ...(revision ? { revision } : {}) }; if (dirty) cache.set(detail.folderPath, value); else cache.delete(detail.folderPath); try { if (dirty) sessionStorage.setItem(draftKey(detail.folderPath), JSON.stringify(value)); else sessionStorage.removeItem(draftKey(detail.folderPath)); } catch { /* In-memory protection remains available. */ } }, [detail.folderPath, open, dirty, input, selected, revision]);
  const run = async (action: ProductionAction) => { if (mutating.current) return undefined; mutating.current = true; setError(""); setBusy(true); try { const next = await bounded(api.action(action)); if (alive.current) setState(next); return next; } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "操作失败"); return undefined; } finally { mutating.current = false; if (alive.current) setBusy(false); } };
  const ask = async (text: string, append = false) => { setError(""); setRequest(text); try { if (!api.prepareRequest) throw new Error("请在左侧项目对话提出此要求。"); await api.prepareRequest(detail, text, append); if (alive.current) setNotice("请求已放入项目对话，请发送。"); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "请求未准备好"); } };
  const choose = (id: string) => { const p = publications.find((p) => p.id === id); if (p?.bodyError) { setError(p.bodyError); return; } editorEpoch.current++; reuseSequence.current++; selectedRef.current = id; const next = p ? asInput(p) : fresh(); setSelected(id); setInput(next); setRevision(p?.revision); setBaseline(JSON.stringify(next)); setRights(false); setOpen(true); setError(""); setNotice(""); setSwitchTo(undefined); };
  const navigate = (id: string) => { if (dirty) setSwitchTo(id); else choose(id); };
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
  const imageTasks = state?.tasks.filter((t) => t.kind === "images") ?? [];
  const prepared = selected && !dirty && revision;
  const syncTask = [...(state?.tasks ?? [])].reverse().find(t => t.kind === "metrics" && t.metricsTargets?.some(target => target.publicationId === selected));
  const syncing = Boolean(syncTask && isActiveTask(syncTask));
  useEffect(() => { if (!syncing) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [syncing]);
  useEffect(() => { const current = state?.publications?.find(p => p.id === selected && !p.hidden); if (current && !current.bodyError && !dirty && current.revision !== revision) { const next = asInput(current); setInput(next); setBaseline(JSON.stringify(next)); setRevision(current.revision); } }, [state, selected, dirty, revision]);
  const reuseArticle = async (id: string) => {
    const ticket = ++reuseSequence.current, target = selectedRef.current, epoch = editorEpoch.current;
    if (!id) { editorEpoch.current++; setInput(old => { const { articleId: _id, articleFile: _file, source: _source, ...rest } = old; return rest; }); return; }
    const article = state?.articles.find(a => a.id === id); if (!article || !api.text) return;
    try {
      const text = await api.text({ ...scope, file: article.file });
      if (!alive.current || ticket !== reuseSequence.current || target !== selectedRef.current || epoch !== editorEpoch.current) return;
      const body = article.format === "html" && !["official-account", "bilibili"].includes(input.platform) ? new DOMParser().parseFromString(text.text.replace(/<\/(?:p|div|section|h[1-6]|li)>|<br\s*\/?>/gi, "\n"), "text/html").body.textContent?.trim() ?? "" : text.text;
      edit({ body, articleId: id, articleFile: article.file, source: { kind: "article", articleId: id, text: `采用文章版本于 ${Date.now()}` } });
    } catch (e) { if (alive.current && ticket === reuseSequence.current && target === selectedRef.current && epoch === editorEpoch.current) setError(e instanceof Error ? e.message : "文章读取失败"); }
  };
  return <div className="creationPanel productionPanel">
    {Boolean(state?.articles.length) && <section className="creationSection" aria-label="共用文章"><div className="productionHeading"><h3>文章 · {state!.articles.length}</h3><ActionButton onClick={() => void openPath(`${detail.folderPath}/${state!.articles.at(-1)!.file}`).catch(e => setError(e.message))}>查看源稿</ActionButton></div><p>{state!.articles.at(-1)!.title ?? "已有文章"}</p><span className="creatorMuted">在「文章」页查看 HTML 成品和版本。</span></section>}
    <section aria-label="图片与配图" className="creationSection"><div className="productionHeading"><h3>图片与配图{images.length ? ` · ${images.length}` : ""}</h3><ActionBar><ActionButton onClick={() => void ask("请按本项目选题和我的要求制作配图或封面，使用已配置的生图服务，保存并登记图片；完成后查看实际图片检查结果。")}>让 Agent 制作图片</ActionButton><ActionButton disabled={busy} onClick={() => file.current?.click()}>导入图片</ActionButton></ActionBar></div>
      <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="导入项目图片" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) { try { void run({ ...scope, action: "import-image", sourcePath: localFilePath(f), purpose: "illustration" }); } catch (cause) { setError(cause instanceof Error ? cause.message : "文件选择失败"); } } }} />
      {!images.length && <p className="creatorMuted">可用于文章配图、封面或平台图文。</p>}
      <div className="creationGallery">{(showImages ? images : images.slice(-6)).map((image) => <div className="creationImageItem" key={image.id}><button className="creationImageButton" aria-label="预览项目图片" onClick={() => setPreview(image.id)}><ImageThumb image={image} detail={detail} api={api} /></button><div><span>{image.purpose === "cover" ? "封面" : image.purpose === "card" ? "图文图片" : "配图"} · {image.width}×{image.height}</span><ActionButton tone="ghost" disabled={busy} onClick={() => void run({ ...scope, action: "remove-image", imageId: image.id })}>移除</ActionButton></div></div>)}</div>
      {images.length > 6 && <ActionButton tone="ghost" onClick={() => setShowImages(!showImages)}>{showImages ? "收起图片" : "查看全部图片"}</ActionButton>}
      {preview && images.some(i => i.id === preview) && <div className="creationPreview"><div className="productionHeading"><h4>图片预览</h4><ActionButton onClick={() => setPreview(undefined)}>关闭</ActionButton></div><ImageThumb image={images.find(i => i.id === preview)!} detail={detail} api={api} large /></div>}
      {imageTasks.filter(t => isActiveTask(t) || t.id === imageTasks.at(-1)?.id && ["failed", "unconfirmed", "cancelled"].includes(t.status)).map(t => <div className="creationProgress" key={t.id}><p>{t.step || "图片制作中"}</p>{t.imageItems?.map((item, index) => <div key={item.id}>第 {index + 1} 张 · {item.error || imageStatus[item.status]}{["failed", "cancelled", "unconfirmed"].includes(item.status) && <ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "retry-images", taskId: t.id, itemIds: [item.id], acknowledgeUnknown: unknownRetry })}>重试此图</ActionButton>}</div>)}{isActiveTask(t) && <ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "cancel", taskId: t.id })}>取消制作</ActionButton>}{t.status === "unconfirmed" && <label><input type="checkbox" checked={unknownRetry} onChange={e => setUnknownRetry(e.target.checked)} />已核对上次结果，确认重试</label>}</div>)}
    </section>
    <section aria-label="平台发布内容" className="creationSection"><div className="productionHeading"><h3>发布</h3>{dirty && !open && <ActionButton onClick={() => setOpen(true)}>继续编辑</ActionButton>}<ActionButton tone={publications.length ? "secondary" : "primary"} onClick={() => navigate("")}>新建发布内容</ActionButton></div>
      {!publications.length && !open && <p className="creatorMuted">选择视频、文章或图片，为各平台准备独立材料。</p>}
      <div className="creationPublicationList">{publications.map(p => <button aria-pressed={selected === p.id && open} key={p.id} onClick={() => navigate(p.id)}><strong>{p.title}</strong><span>{platformName(p.platform)} · {typeName[p.type]}</span></button>)}</div>
      {switchTo !== undefined && <div className="creatorInlineStatus"><span>当前修改尚未保存</span><ActionButton onClick={() => void save().then(p => { if (p) choose(switchTo); })}>保存并切换</ActionButton><ActionButton onClick={() => choose(switchTo)}>放弃修改</ActionButton><ActionButton onClick={() => setSwitchTo(undefined)}>继续编辑</ActionButton></div>}
      {open && <div className="creationPublicationEditor"><div className="productionHeading"><h4>{selected ? "编辑发布内容" : "准备发布内容"}</h4><ActionButton tone="ghost" onClick={() => { if (dirty) setNotice("未保存内容已暂存，可重新打开继续编辑。"); setOpen(false); }}>收起</ActionButton></div>
        {publications.find(p => p.id === selected)?.sourceChanged && <p className="creatorMuted">来源文章已有变化，当前平台文案保持。需要更新时请重新选用来源或让 Agent 改写。</p>}<div className="productionFields creationPublishingFields"><label>平台<select value={input.platform} onChange={e => { const platform = e.target.value as PublicationPlatform; edit({ platform, type: platform === "official-account" ? "article" : platform === "wechat" ? "video" : input.type === "article" && platform !== "bilibili" ? "images" : input.type }); }}>
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
        {records.map(r => { const metric = state?.metrics.find(m => m.recordId === r.id); return <div className="creationProgress" key={r.id}><p>{r.state === "published" ? "已发表" : r.state === "draft" ? "平台草稿已保存" : r.state === "linked" ? "已关联，待核对数据" : "已上传待人工发表"} · {new Date(r.updatedAt).toLocaleString()}</p>{metric && <p>{metric.views === undefined ? "播放／阅读 —" : `播放／阅读 ${metric.views}`} · {metric.likes === undefined ? "点赞 —" : `点赞 ${metric.likes}`}{metric.error ? ` · ${metric.error}` : ""}</p>}<ActionButton onClick={() => { setAssociate(r.id); setRemoteId(r.remoteId ?? ""); setUrl(r.url ?? ""); }}>关联此作品</ActionButton></div>; })}
        {associate !== undefined && state?.candidates?.filter(c => c.platform === input.platform).map(c => <div className="creatorAssetRow" key={c.remoteId}><span>{c.title}</span><ActionButton disabled={busy} onClick={() => { setRemoteId(c.remoteId); setUrl(c.url ?? ""); }}>选择此作品</ActionButton></div>)}
        {associate !== undefined && <div className="productionFields"><label>作品标识<input value={remoteId} onChange={e => setRemoteId(e.target.value)} /></label><label>作品链接<input value={url} onChange={e => setUrl(e.target.value)} /></label><ActionBar><ActionButton disabled={busy || !remoteId.trim()} onClick={() => void run({ ...scope, action: "associate-publication", publicationId: selected, ...(associate ? { recordId: associate } : {}), platform: input.platform, remoteId, ...(url ? { url } : {}) }).then(r => { if (r) setAssociate(undefined); })}>保存关联并读取数据</ActionButton><ActionButton onClick={() => setAssociate(undefined)}>取消</ActionButton></ActionBar></div>}</>}
      </div>}
    </section>
    {(Object.values(detail.publish ?? {}).some(p => p.source !== "none") || state?.tasks.some(t => t.kind === "upload" && !t.publicationId)) && <details className="creatorDisclosure"><summary>原有视频发布记录</summary><ProductionPanel detail={detail} api={api} mode="publishing" openPath={openPath} enabledPlatforms={enabledPlatforms} {...(onPublish ? { onPublish } : {})} publishPending={publishPending ?? null} /></details>}
    {uploadNotice && <div className="creatorInlineStatus"><span>{uploadNotice.message}</span><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "inspect-upload", taskId: uploadNotice.taskId })}>检查已有上传</ActionButton><ActionButton disabled={busy} onClick={() => void run({ ...scope, action: "resume-upload", taskId: uploadNotice.taskId })}>继续已有上传</ActionButton>{uploadNotice.canCreateNew && <ActionButton disabled={busy || !prepared || !rights} onClick={() => void run({ ...scope, action: "upload-publication", publicationId: selected, expectedRevision: revision!, originalRightsConfirmed: rights, newUploadAfter: uploadNotice.taskId })}>确认另建一份上传</ActionButton>}</div>}
    {notice && <div role="status" className="creatorInlineStatus"><span>{notice}</span><ActionButton tone="ghost" onClick={() => setNotice("")}>关闭</ActionButton></div>}
    {error && <div role="alert"><p className="creatorError">{error}</p>{error.includes("已有草稿") && request && <ActionButton onClick={() => void ask(request, true)}>追加创作请求</ActionButton>}<ActionButton tone="ghost" onClick={() => void load().catch(() => undefined)}>重新读取</ActionButton></div>}
  </div>;
}
