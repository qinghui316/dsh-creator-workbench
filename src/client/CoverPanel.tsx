import { useEffect, useRef, useState } from "react";
import type { ContentDetail } from "../types.ts";
import { COVER_RATIOS, coverRunReview, type CoverAction, type CoverRatio, type CoverRun, type CoverState, type CoverVersion } from "../covers/types.ts";
import type { CreatorViewFace } from "./face.ts";
import { useLibraryEpoch } from "./contentSelection.ts";
import "./CoverPanel.css";

type CoverFace = Pick<CreatorViewFace, "getCoverState" | "coverAction" | "getCoverImage" | "prepareCoverDraft">;
const labels: Record<string, string> = { waiting_agent: "等待 Agent 制作", preparing: "准备画面", running: "生成中", pending: "待生成", partial: "部分完成", completed: "图片已生成，待检查", failed: "失败", cancelled: "已取消", unconfirmed: "结果未确认", pass: "质检通过", needs_changes: "需要修改" };
function Thumbnail({ version, detail, face, onOpen }: { version: CoverVersion; detail: ContentDetail; face: CoverFace; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string>(); const [error, setError] = useState<string>();
  useEffect(() => { let live = true; void face.getCoverImage({ id: detail.id, folderPath: detail.folderPath, versionId: version.id }).then((image) => { if (live) setUrl(`data:${image.mime};base64,${image.base64}`); }, () => { if (live) setError("图片无法读取，请检查文件。"); }); return () => { live = false; }; }, [version.id, version.file, detail.folderPath]);
  return url ? <button className="coverPreview" onClick={() => onOpen(url)} aria-label={`放大预览 ${version.ratio}`}><img src={url} alt={`${version.ratio} 封面`} /></button> : <p>{error ?? "读取图片…"}</p>;
}
export function CoverPanel({ detail, ...face }: CoverFace & { detail: ContentDetail }) {
  const [state, setState] = useState<CoverState>({ versions: [], selected: {}, runs: [] });
  const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>(); const [draftRun, setDraftRun] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [zoom, setZoom] = useState<string>(); const [ack, setAck] = useState(false);
  const alive = useRef(true), epoch = useLibraryEpoch();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scope = { id: detail.id, folderPath: detail.folderPath };
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const next = await face.getCoverState(scope); if (!live) return; setState(next); if (next.runs.some((r) => ["running", "preparing"].includes(r.status))) timer = setTimeout(() => { void refresh(); }, 1500); }
      catch (cause) { if (live) setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    void refresh(); return () => { live = false; clearTimeout(timer); };
  }, [detail.folderPath, epoch]);
  const apply = async (action: CoverAction) => {
    setBusy(true); setError(undefined);
    try { const next = await face.coverAction(action); if (alive.current) setState(next); return next; }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); return undefined; }
    finally { if (alive.current) setBusy(false); }
  };
  const draft = async (run: CoverRun, append = false) => {
    setBusy(true); setError(undefined);
    try { await face.prepareCoverDraft(detail, run.id, append); if (alive.current) { setNotice("制作请求已放入原生会话，请点击发送。Agent 将分析画面并直接制作封面。"); setDraftRun(undefined); } }
    catch (cause) { if (alive.current) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); if (message.includes("已有草稿")) setDraftRun(run.id); } }
    finally { if (alive.current) setBusy(false); }
  };
  const begin = async (ratios: CoverRatio[]) => {
    if (!detail.selectedVideo) { setError("请先选择当前视频。"); return; }
    const next = await apply({ ...scope, action: "create", video: detail.selectedVideo, ratios });
    const run = [...(next?.runs ?? [])].reverse().find((r) => (r.purpose ?? "cover") === "cover" && r.video.name === detail.selectedVideo && r.ratios.length === ratios.length && ratios.every((ratio) => r.ratios.includes(ratio)) && ["waiting_agent", "preparing", "running"].includes(r.status));
    if (run) { setSelectedRunId(run.id); await draft(run); }
  };
  const latest = state.runs.find((r) => r.id === selectedRunId) ?? state.runs[state.runs.length - 1];
  const runLabel = (run: CoverRun) => {
    if (run.status !== "completed") return labels[run.status];
    const review = coverRunReview(run, state.versions);
    return review === "pass" ? "制作完成，质检通过" : review === "needs_changes" ? "图片需要修改" : labels.completed;
  };
  const slotLabel = (run: CoverRun, ratio: CoverRatio) => {
    const slot = run.slots[ratio];
    if (slot?.status !== "completed") return labels[slot?.status ?? run.status];
    const version = state.versions.find((v) => v.id === slot.versionId && v.runId === run.id && v.ratio === ratio);
    return version && version.review !== "pending" ? labels[version.review] : labels.completed;
  };
  return <section className="creatorCoverPanel" aria-label="封面制作与版本">
    <header><h3>封面</h3><button disabled={busy || !detail.selectedVideo} onClick={() => { void begin([...COVER_RATIOS]); }}>让 Agent 制作封面</button></header>
    <button disabled={busy || !detail.selectedVideo} onClick={async () => { if (!detail.selectedVideo) return; const result = await apply({ ...scope, action: "test", video: detail.selectedVideo }); if (result) setSelectedRunId(result.runs[result.runs.length - 1]?.id); }}>测试生图：1 张，可能计费</button>
    <p className="coverHint">分析、选帧和质检使用 Harness 当前 Agent，需要支持看图的模型。只需另行配置生图服务。</p>
    {error && <p role="alert" className="coverError">{error}</p>}
    {draftRun && <button disabled={busy} onClick={() => { const run = state.runs.find((r) => r.id === draftRun); if (run) void draft(run, true); }}>追加制作请求，保留已有草稿</button>}
    {notice && <p role="status">{notice}</p>}
    <div className="coverRatioGrid">{COVER_RATIOS.map((ratio) => {
      const versions = state.versions.filter((v) => v.ratio === ratio), current = versions.find((v) => v.id === state.selected[ratio]);
      return <article className="coverRatio" key={ratio}>
        <h4>{ratio.replace("x", ":")}</h4>
        {current ? <Thumbnail key={current.id} version={current} detail={detail} face={face} onOpen={setZoom} /> : <p>尚未选择封面</p>}
        {current && <p className="coverHint">{current.source === "generated" ? "AI 生成" : current.source === "legacy" ? "已有封面" : "导入封面"} · {current.width ? `${current.width} × ${current.height}` : "旧版本"}{current.video && current.video !== detail.selectedVideo ? " · 来自其他视频，请核对" : ""}</p>}
        <label>当前使用版本<select aria-label={`${ratio} 当前封面版本`} value={state.selected[ratio] ?? ""} disabled={busy || !versions.length} onChange={(e) => { void apply({ ...scope, action: "select", versionId: e.target.value }); }}>
          <option value="" disabled>请选择版本</option>{versions.map((v, i) => <option key={v.id} value={v.id} disabled={v.review !== "pass"}>版本 {i + 1} · {new Date(v.createdAt).toLocaleString()} · {labels[v.review]}</option>)}
        </select></label>
        <label className="coverImport">导入已有封面<input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => {
          const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (!file) return;
          const path = (globalThis as typeof globalThis & { __DSH_HOST_PATHS__?: { pathFor: (f: File) => string } }).__DSH_HOST_PATHS__?.pathFor(file);
          if (!path) { setError("请在 DSH Desktop 中选择本机图片。"); return; }
          void apply({ ...scope, action: "import", sourcePath: path, ratio });
        }} /></label>
        <button disabled={busy || !detail.selectedVideo} onClick={() => { void begin([ratio]); }}>重做此画幅</button>
        <details><summary>版本与检查（{versions.length}）</summary>{versions.map((v, i) => <div className="coverVersion" key={v.id}>
          <span>版本 {i + 1} · {labels[v.review]}</span><button disabled={busy} onClick={async () => { try { const image = await face.getCoverImage({ ...scope, versionId: v.id }); if (alive.current) setZoom(`data:${image.mime};base64,${image.base64}`); } catch (cause) { if (alive.current) setError(String(cause)); } }}>查看</button>
          {v.review !== "pass" && <button disabled={busy} onClick={() => { void apply({ ...scope, action: "review", versionId: v.id, verdict: "pass", note: "用户在界面检查图片后明确选用此版本。", select: true }); }}>我已检查，选用此版</button>}
          {v.reviewNote && <p>{v.reviewNote}</p>}
        </div>)}</details>
      </article>;
    })}</div>
    {!!state.runs.length && <label>制作记录<select value={latest?.id ?? ""} onChange={(e) => { setSelectedRunId(e.target.value); setAck(false); }}>{[...state.runs].reverse().map((run) => <option value={run.id} key={run.id}>{new Date(run.createdAt).toLocaleString()} · {run.purpose === "service_test" ? "服务测试" : run.video.name} · {runLabel(run)}</option>)}</select></label>}
    {latest && <details open className="coverRun"><summary>最近制作 · {runLabel(latest)}</summary>
      <p>视频：{latest.video.name}</p>{latest.error && <p role="alert">{latest.error}</p>}
      {latest.analysis && <details><summary>选帧与方案</summary><p>{latest.analysis}</p></details>}
      {latest.ratios.map((ratio) => <div key={ratio} className="coverVersion"><span>{ratio.replace("x", ":")}：{slotLabel(latest, ratio)}</span>{latest.slots[ratio]?.error && <p>{latest.slots[ratio]?.error}</p>}
        {latest.slots[ratio] && ["failed", "cancelled", "unconfirmed"].includes(latest.slots[ratio]!.status) && <button disabled={busy || (latest.slots[ratio]?.status === "unconfirmed" && !ack)} onClick={() => { void apply({ ...scope, action: "retry", runId: latest.id, ratios: [ratio], acknowledgeUnknown: ack }); }}>仅重试此画幅</button>}
      </div>)}
      {latest.status === "unconfirmed" && <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />我已核对服务端结果；重新请求可能再次计费</label>}
      {["running", "preparing", "waiting_agent"].includes(latest.status) && <button disabled={busy} onClick={() => { void apply({ ...scope, action: "cancel", runId: latest.id }); }}>取消本次制作</button>}
      {latest.status === "waiting_agent" && <button disabled={busy} onClick={() => { void draft(latest); }}>准备会话制作请求</button>}
    </details>}
    {zoom && <div className="coverZoom" role="dialog" aria-modal="true" aria-label="封面放大预览" onKeyDown={(e) => { if (e.key === "Escape") setZoom(undefined); }}><button autoFocus onClick={() => setZoom(undefined)}>关闭预览</button><img src={zoom} alt="封面放大预览" /></div>}
  </section>;
}
