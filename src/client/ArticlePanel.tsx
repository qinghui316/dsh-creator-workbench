import { SelectionRail } from "./ui/SelectionRail.tsx";
import { CreatorSelect } from "./ui/CreatorSelect.tsx";
import { ArticlePreview } from "./ArticlePreview.tsx";
import { useEffect, useRef, useState } from "react";
import type { ContentDetail } from "../types.ts";
import type { ArticleSource, ArticleSave } from "../projectView.ts";
import type { ProductionClient } from "./productionApi.ts";
import { localFilePath } from "./productionApi.ts";
import { useProjectData } from "./ProjectData.tsx";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import { ActionMenu } from "./ui/ActionMenu.tsx";
import "./ProjectPages.css";

type PendingSave = { key: string; id: string; request: ArticleSave; rejected?: boolean };
type DraftCache = {text:string; base:ArticleSource; pending?:PendingSave};
const drafts = new Map<string, DraftCache>(), selections = new Map<string, string>();
const draftKey = (folder: string, id: string) => `dsh-creator-workbench:article-draft:${globalThis.location?.origin ?? "local"}:${folder.replace(/\\/g,"/")}:${id}`;
function cachedDraft(folder: string, id: string): DraftCache | undefined { try { const cached=drafts.get(draftKey(folder,id)); if(cached) return cached; const raw=sessionStorage.getItem(draftKey(folder,id)); if(!raw) return; const value=JSON.parse(raw); return value && typeof value.text === "string" && typeof value.base?.sourceHash === "string" ? value : undefined; } catch { return; } }
function persistDraft(folder:string, id:string, value:DraftCache) { const key=draftKey(folder,id); drafts.set(key,value); try { sessionStorage.setItem(key,JSON.stringify(value)); } catch { /* In-memory draft and operation remain available. */ } }
export function ArticlePanel({ initialArticleId, detail, api, goPublish, openPath }: { initialArticleId?:string; detail: ContentDetail; api: ProductionClient; goPublish: (id: string) => void; openPath?: (path: string) => Promise<void> }) {
  const data = useProjectData(api, detail), scope = { id: detail.id, folderPath: detail.folderPath };
  const [selected, setSelected] = useState(initialArticleId ?? selections.get(detail.folderPath) ?? ""), [base, setBase] = useState<ArticleSource>(), [text, setText] = useState(""), [editing, setEditing] = useState(false), [mode, setMode] = useState<"source" | "preview">("source");
  const [incoming, setIncoming] = useState<ArticleSource>(), [readRetry, setReadRetry] = useState(0);
  const [preview, setPreview] = useState<{ html: string; path: string }>(), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [switchTo, setSwitchTo] = useState<string>();
  const file = useRef<HTMLInputElement>(null), alive = useRef(true), readTicket = useRef(0), editEpoch = useRef(0), previewTicket = useRef(0), saving = useRef(false), pendingSave = useRef<PendingSave>();
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const baseRef = useRef(base); baseRef.current = base;
  const textRef = useRef(text); textRef.current = text;
  const versions = data.state?.articles ?? [], dirty = Boolean(base && text !== base.source);
  useEffect(()=>{if(selected)selections.set(detail.folderPath,selected);},[selected,detail.folderPath]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readTicket.current++; previewTicket.current++; }; }, []);
  useEffect(() => { if (!selected && data.state) { const id = versions.at(-1)?.id ?? (detail.articlePath ? "legacy" : ""); if (id) { setSelected(id); selections.set(detail.folderPath, id); } } }, [versions, detail.articlePath, selected, data.state]);
  const makePreview = async (source: ArticleSource, value: string) => {
    const ticket = ++previewTicket.current; setError("");
    try {
      const result = api.articlePreview ? await api.articlePreview({ ...scope, articleId: source.article.id, expectedSourceHash: source.sourceHash, source: value }) : await api.preview({ ...scope, articleFile: source.article.file });
      if (alive.current && ticket === previewTicket.current) setPreview(result);
    } catch (e) { if (alive.current && ticket === previewTicket.current) setError(e instanceof Error ? e.message : "排版未完成"); }
  };
  useEffect(() => {
    if (!selected || !api.articleSource || baseRef.current?.article.id === selected) return;
    const ticket = ++readTicket.current, epoch = editEpoch.current; setError("");
    void api.articleSource({ ...scope, articleId: selected }).then(source => {
      if (!alive.current || ticket !== readTicket.current || epoch !== editEpoch.current) return;
      const draft = cachedDraft(detail.folderPath, selected), restored = draft?.base ?? source, value = draft?.text ?? source.source;
      pendingSave.current=draft?.pending;
      setBase(restored); setText(value); setEditing(Boolean(draft && (value !== restored.source || draft.pending)));
      if (draft && draft.base.sourceHash !== source.sourceHash) setError("来源文章已被修改，当前草稿已保留。请核对后重新读取。"); setMode("source"); setPreview(undefined); setNotice(draft?.pending ? "上次保存结果待核对，可重试原保存" : ""); editEpoch.current++;
      if (!draft || draft.base.sourceHash === source.sourceHash) void makePreview(restored, value);
    }, e => { if (alive.current && ticket === readTicket.current) setError(e.message); });
    return () => { readTicket.current++; };
  }, [selected, detail.folderPath, api, readRetry]);
  useEffect(() => {
    if (!base) return;
    const key = draftKey(detail.folderPath, base.article.id);
    const cache = {text,base,...(pendingSave.current ? {pending:pendingSave.current} : {})};
    if (dirty || pendingSave.current) drafts.set(key, cache); else drafts.delete(key);
    try { if (dirty || pendingSave.current) sessionStorage.setItem(key, JSON.stringify(cache)); else sessionStorage.removeItem(key); }
    catch { if (dirty) setNotice("修改保留在当前应用中，请及时保存。"); }
  }, [text, base, dirty, detail.folderPath]);
  const agentRequest=useRef<"write"|"edit">("write");
  const themeRevision = useRef<string>();
  useEffect(()=>{ const revision=data.view?.settingsRevision; if(themeRevision.current && revision && themeRevision.current!==revision && base && !dirty) void makePreview(base,text); themeRevision.current=revision; },[data.view?.settingsRevision]);
  const select = (id: string) => { if (id === selected) return; if (dirty) { setSwitchTo(id); return; } switchVersion(id); };
  const switchVersion = (id: string) => { readTicket.current++; previewTicket.current++; setBase(undefined); baseRef.current = undefined; setPreview(undefined); selectedRef.current = id; setSelected(id); selections.set(detail.folderPath, id); setSwitchTo(undefined); setIncoming(undefined); };
  const discard = () => { if (base) { const key = draftKey(detail.folderPath, base.article.id); drafts.delete(key); try { sessionStorage.removeItem(key); } catch {} } if (switchTo) switchVersion(switchTo); };
  const save = async () => {
    if (!base || !api.articleSave || saving.current) return false;
    const epoch = editEpoch.current, target = selected, value = text;
    const key = JSON.stringify([base.article.id, base.sourceHash, value]);
    if (pendingSave.current?.rejected && pendingSave.current.key !== key) pendingSave.current=undefined;
    if (!pendingSave.current) { const id=crypto.randomUUID(); pendingSave.current = { key, id, request:{...scope,articleId:base.article.id,expectedSourceHash:base.sourceHash,source:value,saveId:id} }; }
    const operation = pendingSave.current;
    persistDraft(detail.folderPath,base.article.id,{text,base,pending:operation});
    saving.current = true; setBusy(true); setError("");
    try {
      const saved = await api.articleSave(operation.request);
      // The save receipt is authoritative; a later metadata read cannot undo it.
      void data.query.invalidate().catch(() => { if(alive.current) setNotice("正文已保存，列表刷新未完成，可稍后重新读取"); });
      if (!alive.current || selectedRef.current !== target) return false;
      const same = epoch === editEpoch.current && value === operation.request.source;
      if (same) {
        const cacheKey = draftKey(detail.folderPath, base.article.id); drafts.delete(cacheKey); try { sessionStorage.removeItem(cacheKey); } catch {}
        selectedRef.current = saved.article.id; selections.set(detail.folderPath, saved.article.id); setSelected(saved.article.id); baseRef.current = saved; setBase(saved); setText(saved.source); setEditing(false); setPreview(saved.preview); pendingSave.current = undefined;
      }
      if (!same) { pendingSave.current=undefined; persistDraft(detail.folderPath,base.article.id,{text:textRef.current,base:baseRef.current ?? base}); }
      setNotice(same ? saved.previewError ? "正文已保存，预览未完成" : "已保存新版本" : "上一版已保存，当前修改仍未保存");
      if (saved.previewError) setError(saved.previewError);
      return same;
    } catch (e) { if ((e as {remoteResponse?:boolean})?.remoteResponse) {
        operation.rejected=true;
        const latest=cachedDraft(detail.folderPath,base.article.id);
        if(latest?.pending?.id===operation.id) persistDraft(detail.folderPath,base.article.id,{...latest,pending:operation});
      } if (alive.current && selectedRef.current===target) setError(e instanceof Error ? e.message : "保存结果暂未确认，输入和原保存请求已保留"); return false; }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  const ask = async (video = false, append = false) => {
    agentRequest.current="write";
    try { if (video && api.prepareRequest) await api.prepareRequest(detail, `请将当前视频《${detail.selectedVideo}》转成文章。使用真实转写与画面，通过 WeWrite 写作和排版，保存到本项目。`, append); else await api.prepareArticleDraft(detail, append); setNotice("请求已放入项目对话，请发送。"); }
    catch (e) { setError(e instanceof Error ? e.message : "请求未准备好"); }
  };
  const askEdit = async (append = false) => {
    agentRequest.current="edit";
    try {
      if(!base || !api.prepareRequest) throw new Error("请在项目对话提出文章修改要求。");
      await api.prepareRequest(detail,`请精简修改本项目文章《${base.article.title ?? "文章"}》，保留事实、图片和主要内容。先调用 creator_read_article_source 读取文章 ${base.article.id}，使用返回的 sourceHash 调用 creator_save_article_revision 保存新版本。保留原版本，不改平台发布材料，不上传或发表。`,append);
      setNotice("修改请求已放入项目对话，请发送。");
    } catch(e) { setError(e instanceof Error?e.message:"修改请求未准备好"); }
  };
  const inspectLatest = async () => {
    const target=selected;
    try { if (!api.articleSource) return; const latest=await api.articleSource({...scope,articleId:target}); if(alive.current && selectedRef.current===target) setIncoming(latest); }
    catch(e) { if(alive.current) setError(e instanceof Error ? e.message : "来源读取失败"); }
  };
  const acceptLatest = (keepDraft:boolean) => {
    if(!incoming) return; previewTicket.current++; editEpoch.current++; baseRef.current=incoming; setBase(incoming);
    if(!keepDraft) setText(incoming.source); setIncoming(undefined); setError(""); setNotice(keepDraft ? "已核对最新来源，当前文稿保留；请保存新版本" : "已采用最新文稿");
    setEditing(keepDraft); setMode("source"); pendingSave.current=undefined;
  };
  const articleTasks = data.state?.tasks.filter(task => task.kind === "article") ?? [];
  const currentTask = [...articleTasks].reverse().find(task => ["queued", "running", "waiting-agent"].includes(task.status)) ?? articleTasks.filter(task => ["blocked", "failed", "unconfirmed"].includes(task.status)).at(-1);
  return <section className="articleWorkspace" aria-label="文章">
    {!selected && <div className="articleToolbar"><ActionMenu label="新建文章" tone="primary"><ActionButton tone="ghost" onClick={() => void ask()}>让 Agent 写文章</ActionButton>{detail.selectedVideo && <ActionButton tone="ghost" onClick={() => void ask(true)}>视频转文章</ActionButton>}<ActionButton tone="ghost" disabled={busy} onClick={() => file.current?.click()}>导入文章</ActionButton></ActionMenu></div>}
    <input hidden ref={file} type="file" accept=".md,.html,.htm" aria-label="导入文章" onChange={e => { const selectedFile = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (selectedFile) { try { void api.action({ ...scope, action: "import-article", sourcePath: localFilePath(selectedFile) }).then(state => { data.query.accept(state); const id = state.articles.at(-1)?.id; if (id) select(id); }, e => setError(e.message)); } catch (e) { setError(e instanceof Error ? e.message : "文件选择失败"); } } }} />
    {selected && <div className="articleToolbar articleCurrentToolbar"><label>当前文章<CreatorSelect aria-label="文章版本" value={selected} onValueChange={value => select(value)}>{selected === "legacy" && <option value="legacy">已有文章</option>}{base && base.article.id !== "legacy" && !versions.some(v => v.id === base.article.id) && <option value={base.article.id}>{base.article.title ?? "已保存版本"}</option>}{versions.map(version => <option key={version.id} value={version.id}>{version.title ?? "文章"} · {new Date(version.createdAt).toLocaleString()}</option>)}</CreatorSelect></label><div className="articleCurrentActions">{base && <><ActionButton onClick={() => { setEditing(true); setMode("source"); }}>编辑</ActionButton><ActionButton tone="ghost" disabled={busy || dirty} title={dirty ? "保存后可让 Agent 修改" : undefined} onClick={()=>void askEdit()}>让 Agent 修改</ActionButton><ActionButton tone={editing?"secondary":"primary"} disabled={busy} onClick={() => { if (dirty) void save().then(ok => { if(ok) goPublish(selectedRef.current); }); else goPublish(base.article.id); }}>{dirty ? "保存后去发布" : "去发布"}</ActionButton></>}<ActionMenu label="新建文章"><ActionButton tone="ghost" onClick={() => void ask()}>让 Agent 写新文章</ActionButton>{detail.selectedVideo && <ActionButton tone="ghost" onClick={() => void ask(true)}>视频转文章</ActionButton>}<ActionButton tone="ghost" disabled={busy} onClick={() => file.current?.click()}>导入文章</ActionButton></ActionMenu><ActionMenu label="更多" align="end">{preview && openPath && <ActionButton tone="ghost" onClick={() => void openPath(preview.path).catch(e => setError(e.message))}>打开 HTML 成品</ActionButton>}</ActionMenu></div></div>}
    {!selected && <p className="creatorMuted">还没有文章</p>}
    {switchTo && <div className="creatorInlineStatus">当前修改尚未保存<ActionBar><ActionButton disabled={busy} onClick={() => void save().then(ok => { if (ok) switchVersion(switchTo); })}>保存并切换</ActionButton><ActionButton onClick={discard}>放弃修改</ActionButton><ActionButton onClick={() => setSwitchTo(undefined)}>继续编辑</ActionButton></ActionBar></div>}
    {editing && base && <><div className="articleToolbar articleEditToolbar"><SelectionRail as="div" selected={mode} className="articleMode" role="group" aria-label="文章显示方式"><ActionButton tone="ghost" aria-pressed={mode === "source"} onClick={() => setMode("source")}>文稿</ActionButton><ActionButton tone="ghost" aria-pressed={mode === "preview"} onClick={() => { setMode("preview"); void makePreview(base, text); }}>预览</ActionButton></SelectionRail><ActionButton disabled={busy || !dirty && !pendingSave.current} tone={dirty || pendingSave.current ? "primary" : "secondary"} onClick={() => void save()}>{busy ? "保存中…" : pendingSave.current ? "重试保存" : "保存新版本"}</ActionButton><span className="creatorMuted">{base.article.format === "html" ? "HTML" : "Markdown"}</span></div>{mode === "source" && <textarea className="articleSourceEditor" aria-label="文章源稿" value={text} onChange={e => { editEpoch.current++; previewTicket.current++; setText(e.target.value); if(base) persistDraft(detail.folderPath,base.article.id,{text:e.target.value,base,...(pendingSave.current ? {pending:pendingSave.current} : {})}); setError(""); }} />}</>}
    {(!editing || mode === "preview") && base && <section aria-label="文章成品">{preview ? <ArticlePreview html={preview.html} /> : !error && <p role="status" className="creatorMuted">正在排版…</p>}</section>}
    {currentTask && <div className="creatorInlineStatus" role="status"><span>{currentTask.step ?? (currentTask.status === "waiting-agent" ? "请求已交给对话" : "文章制作")}{currentTask.error ? ` · ${currentTask.error}` : ""}</span>{["queued", "running", "waiting-agent"].includes(currentTask.status) && <ActionButton onClick={() => void api.action({...scope,action:"cancel",taskId:currentTask.id}).then(state => data.query.accept(state),e=>setError(e.message))}>取消制作</ActionButton>}</div>}
    {notice && <p role="status" className="articleSaveStatus">{notice}</p>}
    {incoming && <section aria-label="核对最新来源"><h3>最新来源</h3><textarea className="articleSourceEditor" readOnly aria-label="最新来源文稿" value={incoming.source} /><ActionBar><ActionButton onClick={()=>acceptLatest(true)}>保留我的文稿</ActionButton><ActionButton onClick={()=>acceptLatest(false)}>采用最新文稿</ActionButton><ActionButton onClick={()=>setIncoming(undefined)}>继续编辑</ActionButton></ActionBar></section>}
    {(error || data.error) && <div role="alert"><p className="creatorError">{error || data.error}</p>{base && <ActionButton onClick={() => void makePreview(base, text)}>重试预览</ActionButton>}{base && error.includes("来源") && <ActionButton onClick={()=>void inspectLatest()}>核对最新来源</ActionButton>}{!base && <ActionButton onClick={()=>setReadRetry(n=>n+1)}>重新读取</ActionButton>}{error.includes("已有草稿") && <ActionButton onClick={() => void (agentRequest.current==="edit"?askEdit(true):ask(false, true))}>追加文章请求</ActionButton>}</div>}
  </section>;
}
