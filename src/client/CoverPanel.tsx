import { coverPreviewImages } from "./imageDescriptors.ts";
import { loadOverviewCover } from "./OverviewMedia.tsx";
import { useImagePreview } from "./ImagePreview.tsx";
import type { CoverView, CoverRunView } from "../projectView.ts";
import type { ProductionClient } from "./productionApi.ts";
import { useProjectData } from "./ProjectData.tsx";
import { useEffect, useRef, useState } from "react";
import type { ProjectQuery } from "./projectQuery.ts";
import type { ContentDetail } from "../types.ts";
import {
  COVER_RATIOS,
  coverRunReview,
  type CoverAction,
  type CoverRatio,
  type CoverRun,
  type CoverState,
  type CoverVersion,
} from "../covers/types.ts";
import type { CreatorViewFace } from "./face.ts";
import { useLibraryEpoch } from "./contentSelection.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import { SectionPanel } from "./ui/SectionPanel.tsx";
import "./CoverPanel.css";

type CoverFace = Pick<
  CreatorViewFace,
  "getCoverState" | "coverAction" | "getCoverImage" | "prepareCoverDraft" | "prepareCoverRequest"
>;
const labels: Record<string, string> = {
  waiting_agent: "等待 Agent 制作",
  preparing: "准备画面",
  running: "生成中",
  pending: "待生成",
  partial: "部分完成",
  completed: "已生成，待检查",
  failed: "失败",
  cancelled: "已取消",
  unconfirmed: "结果未确认",
  pass: "检查通过",
  needs_changes: "需要修改",
};
const sourceLabel = (v: CoverVersion) =>
  v.source === "import"
    ? "已导入"
    : v.source === "legacy"
      ? "已有封面"
      : v.review === "pending"
        ? "待检查"
        : labels[v.review];
function imageUrl(detail:ContentDetail,version:CoverVersion,face:CoverFace):Promise<string> {
  return loadOverviewCover(detail,version,face.getCoverImage);
}
function Thumbnail({
  version,
  detail,
  face,
  onOpen,
}: {
  version: CoverVersion;
  detail: ContentDetail;
  face: CoverFace;
  onOpen: () => void;
}) {
  const [url, setUrl] = useState<string>(),
    [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void imageUrl(detail, version, face).then(
      (v) => {
        if (live) setUrl(v);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [version.id, version.file, detail.folderPath]);
  return (
    <button
      data-cover-trigger={version.ratio}
      className="coverPreview"
      type="button"
      onClick={onOpen}
      aria-label={`预览 ${version.ratio.replace("x", ":")} 封面`}
    >
      {url ? (
        <img src={url} alt={version.ratio.replace("x", ":") + " 封面"} />
      ) : (
        <span>{error ? "图片无法读取" : "读取图片…"}</span>
      )}
    </button>
  );
}
export function CoverPanel({
  detail,
  api,
  ...face
}: CoverFace & { detail: ContentDetail; api?: ProductionClient }) {
  return api ? <SharedCoverPanel detail={detail} api={api} {...face} /> : <CoverPanelBody detail={detail} {...face} />;
}
function SharedCoverPanel({detail, api, ...face}: CoverFace & {detail: ContentDetail; api: ProductionClient}) {
  const data = useProjectData(api, detail);
  return <CoverPanelBody detail={detail} {...face} shared={{ state: data.view?.covers, query: data.query, refresh: () => data.query.invalidate() }} />;
}
function CoverPanelBody({detail, shared, ...face}: CoverFace & {detail: ContentDetail; shared?: {state: CoverView | undefined; query: ProjectQuery; refresh: () => Promise<unknown>}}) {
  const [state, setState] = useState<CoverView>({
    versions: [],
    selected: {},
    runs: [],
  });
  const [error, setError] = useState<string>(),
    [loadError, setLoadError] = useState(false),
    [loaded, setLoaded] = useState(false),
    [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string>(),
    [draftRun, setDraftRun] = useState<string>(),
    [selectedRunId, setSelectedRunId] = useState<string>();
  const [panel, setPanel] = useState<"versions" | "run">(),
    [ratio, setRatio] = useState<CoverRatio>("3x4");
  const [ack, setAck] = useState(false);
  const imagePreview = useImagePreview(coverPreviewImages(state.versions,detail,face.getCoverImage));
  const coverRoot = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    importRatio = useRef<CoverRatio>("3x4");
  const alive = useRef(true),
    epoch = useLibraryEpoch();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const scope = { id: detail.id, folderPath: detail.folderPath };
  useEffect(() => {
    if (shared) { if (shared.state) { setState(shared.state); setLoaded(true); setLoadError(false); } return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await face.getCoverState(scope);
        if (!live) return;
        setState(next);
        setLoaded(true);
        setLoadError(false);
        if (next.runs.some((r) => ["running", "preparing"].includes(r.status)))
          timer = setTimeout(() => {
            void refresh();
          }, 1500);
      } catch (cause) {
        if (live) {
          setLoadError(true);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [detail.folderPath, epoch, retry, shared?.state]);
  const apply = async (action: CoverAction, rethrow = false) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await face.coverAction(action);
      if (alive.current) setState(next);
      if (shared) void shared.refresh().catch(() => undefined);
      return next;
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : String(cause));
      if (rethrow) throw cause;
      return undefined;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const draft = async (run: CoverRunView, append = false) => {
    setBusy(true);
    setError(undefined);
    try {
      await face.prepareCoverDraft(detail, run.id, append);
      if (alive.current) {
        setNotice("制作请求已放入原生对话，请发送。");
        setDraftRun(undefined);
      }
    } catch (cause) {
      if (alive.current) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        if (message.includes("已有草稿")) setDraftRun(run.id);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const [pendingRatios, setPendingRatios] = useState<CoverRatio[]>();
  const begin = async (ratios: CoverRatio[], append = false) => {
    if (face.prepareCoverRequest) {
      setBusy(true); setError(undefined);
      try { await face.prepareCoverRequest(detail, ratios, append); setPendingRatios(undefined); setNotice("制作请求已放入原生对话，请发送。"); (shared ? void shared.refresh() : setRetry((n) => n + 1)); }
      catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); if (message.includes("已有草稿")) setPendingRatios(ratios); }
      finally { setBusy(false); }
      return;
    }
    if (!detail.selectedVideo) {
      setError("请先选择当前视频。");
      return;
    }
    const next = await apply({
      ...scope,
      action: "create",
      video: detail.selectedVideo,
      ratios,
    });
    const run = [...(next?.runs ?? [])]
      .reverse()
      .find(
        (r) =>
          (r.purpose ?? "cover") === "cover" &&
          r.video.name === detail.selectedVideo &&
          r.ratios.length === ratios.length &&
          ratios.every((ratio) => r.ratios.includes(ratio)) &&
          ["waiting_agent", "preparing", "running"].includes(r.status),
      );
    if (run) {
      setSelectedRunId(run.id);
      await draft(run);
    }
  };
  const metadataRun = state.runs.find(r=>r.id===selectedRunId) ?? state.runs.at(-1);
  const [runDetails,setRunDetails] = useState<CoverRun>();
  const latest: CoverRunView | undefined = runDetails && metadataRun && runDetails.id===metadataRun.id ? {
    ...metadataRun!, ...(runDetails.analysis ? {analysis:runDetails.analysis} : {}),
    slots:Object.fromEntries(Object.entries(metadataRun!.slots).map(([ratio,slot])=>{const full=runDetails.slots[ratio as CoverRatio];return [ratio,{...slot,...(full?.versionId===slot.versionId ? {prompt:full.prompt} : {})}];}))
  } : metadataRun;
  useEffect(()=>{
    if(!shared || !panel) return; let current=true;
    void face.getCoverState(scope).then(full=>{if(current) {setRunDetails(full.runs.find(r=>r.id===metadataRun?.id)); setState(previous=>({...previous,versions:full.versions}));}}, e=>{if(current)setError(e instanceof Error?e.message:"详情读取失败");});
    return()=>{current=false;};
  },[panel,metadataRun?.id,metadataRun?.updatedAt]);
  const active = [...state.runs]
    .reverse()
    .find((r) => (r.purpose ?? "cover") === "cover" && r.video.name === detail.selectedVideo && r.video.size === detail.videos?.find((v) => v.name === detail.selectedVideo)?.size && r.video.modifiedAt === detail.videos?.find((v) => v.name === detail.selectedVideo)?.modifiedAt && (r.status !== "waiting_agent" || r.deliveredAt || r.frames.length) && ["waiting_agent", "preparing", "running"].includes(r.status));
  const incoming = state.versions.find((version) => !version.hidden && version.review === "pending" && state.runs.some((run) => run.id === version.runId && (run.purpose ?? "cover") === "cover" && run.video.name === detail.selectedVideo));
  const hasSelectedCover = Object.values(state.selected).some(id => state.versions.some(v => v.id === id && !v.hidden));
  const runLabel = (run: CoverRunView) =>
    run.status === "waiting_agent" ? run.frames.length ? "画面已准备" : hasSelectedCover ? "重做请求待发送" : "请到对话发送制作请求" :
    run.status === "completed"
      ? coverRunReview(run, state.versions) === "pass"
        ? "制作完成"
        : coverRunReview(run, state.versions) === "needs_changes"
          ? "需要修改"
          : "待检查"
      : labels[run.status];
  const view = (version: CoverVersion) => {
    imagePreview.open(coverPreviewImages(state.versions.filter(v=>v.ratio===version.ratio).reverse(),detail,face.getCoverImage),version.id);
  };
  const selectVersion = async (version:CoverVersion) => {
    const checked=await apply(version.review==="pass"?{...scope,action:"select",versionId:version.id}:{...scope,action:"review",versionId:version.id,verdict:"pass",note:"用户明确检查并选用此版本。",select:false});
    const next=checked&&(version.review==="pass"?checked:await apply({...scope,action:"select",versionId:version.id}));
    if(next?.selected[version.ratio]===version.id)setNotice("已选用此版本");
    else if(next)setError("选用未完成，请核对后重试。");
  };
  const focusReturn = () =>
    coverRoot.current?.querySelector<HTMLElement>(
      `[data-cover-trigger="${ratio}"]`,
    ) ??
    coverRoot.current?.querySelector<HTMLElement>("[data-cover-start]") ??
    null;
  const close = () => {
    setPanel(undefined);
  };
  const importFile = (r: CoverRatio) => {
    importRatio.current = r;
    fileInput.current?.click();
  };
  return (
    <section
      ref={coverRoot}
      className="creatorCoverPanel"
      aria-label="封面制作与版本"
    >
      <div className="creatorSectionHeading">
        <h3>封面</h3>
        <ActionButton
          data-cover-start
          tone={Object.keys(state.selected).length ? "secondary" : "primary"}
          disabled={busy || !loaded || loadError || !detail.selectedVideo}
          onClick={() => {
            void begin(COVER_RATIOS.every((r) => state.selected[r]) ? [...COVER_RATIOS] : COVER_RATIOS.filter((r) => !state.selected[r]));
          }}
        >
          {COVER_RATIOS.every((r) => state.selected[r]) ? "重新制作封面" : COVER_RATIOS.some((r) => state.selected[r]) ? "补齐封面" : "让 Agent 制作封面"}
        </ActionButton>
      </div>
      {error && (
        <p role="alert" className="creatorError">
          {error}
        </p>
      )}
      {loadError && (
        <ActionButton onClick={() => (shared ? void shared.refresh() : setRetry((n) => n + 1))}>
          重新读取封面
        </ActionButton>
      )}
      {draftRun && (
        <ActionButton
          disabled={busy}
          onClick={() => {
            const run = state.runs.find((r) => r.id === draftRun);
            if (run) void draft(run, true);
          }}
        >
          追加制作请求
        </ActionButton>
      )}
      {notice && (
        <p role="status" className="creatorMuted">
          {notice}
        </p>
      )}
      {!loaded && !loadError && (
        <p role="status" className="creatorMuted">
          正在读取封面…
        </p>
      )}
      {loaded && !loadError && !panel && (
        <div className="coverRatioGrid">
          {COVER_RATIOS.map((r) => {
            const versions = state.versions.filter((v) => v.ratio === r && !v.hidden),
              current = versions.find((v) => v.id === state.selected[r]);
            return (
              <article className="coverRatio" key={r}>
                <div className="coverRatioHeading">
                  <h4>{r.replace("x", ":")}</h4>
                  <details className="creatorActionMenu">
                    <summary aria-label={r.replace("x", ":") + " 封面操作"}>
                      操作
                    </summary>
                    <div>
                      <ActionButton
                        tone="ghost"
                        disabled={busy}
                        onClick={() => importFile(r)}
                      >
                        导入图片
                      </ActionButton>
                      <ActionButton
                        tone="ghost"
                        disabled={!versions.length}
                        onClick={() => {
                          setRatio(r);
                          setPanel("versions");
                        }}
                      >
                        历史版本 · {versions.length}
                      </ActionButton>
                      {current && <ActionButton tone="ghost" disabled={busy} onClick={() => { void apply({ ...scope, action: "remove", versionId: current.id }); }}>移除当前封面</ActionButton>}
                      <ActionButton
                        tone="ghost"
                        disabled={busy || !detail.selectedVideo}
                        onClick={() => {
                          void begin([r]);
                        }}
                      >
                        重做此画幅
                      </ActionButton>
                    </div>
                  </details>
                </div>
                {current ? (
                  <Thumbnail
                    detail={detail}
                    version={current}
                    face={face}
                    onOpen={() => {
                      void view(current);
                    }}
                  />
                ) : (
                  <button className="coverEmpty" onClick={() => { if (versions.length) { setRatio(r); setPanel("versions"); } else importFile(r); }}>
                    {versions.length ? "选择封面" : "导入图片"}
                  </button>
                )}
                <p className="creatorMuted">
                  {current ? "已选用" : "尚未选用"}
                </p>
                {current?.video &&
                  detail.selectedVideo &&
                  current.video !== detail.selectedVideo && (
                    <p className="creatorMuted">来自其他视频，请核对</p>
                  )}
              </article>
            );
          })}
        </div>
      )}
      {pendingRatios && <ActionButton onClick={() => { void begin(pendingRatios, true); }}>追加制作请求</ActionButton>}
      {panel === "versions" && (
        <SectionPanel
          title={ratio.replace("x", ":") + " 历史版本"}
          onClose={close}
          returnFocus={focusReturn}
        >
          {state.versions
            .filter((v) => v.ratio === ratio && !v.hidden)
            .reverse()
            .map((v) => (
              <div className="coverVersionRow" key={v.id}>
                <Thumbnail
                  detail={detail}
                  version={v}
                  face={face}
                  onOpen={() => {
                    void view(v);
                  }}
                />
                <div className="creatorRowCopy">
                  <strong>
                    {state.selected[ratio] === v.id
                      ? "当前选用"
                      : sourceLabel(v)}
                  </strong>
                  <small>{new Date(v.createdAt).toLocaleString()}</small>
                  <small>
                    {v.width} × {v.height}
                  </small>
                </div>
                <ActionButton disabled={busy||state.selected[v.ratio]===v.id} onClick={()=>void selectVersion(v)}>{state.selected[v.ratio]===v.id?"已选用":v.review==="pass"?"选用":"检查并选用"}</ActionButton>
                <ActionButton disabled={busy} tone="ghost" onClick={() => { void apply({ ...scope, action: "remove", versionId: v.id }); }}>移除</ActionButton>
                <ActionButton
                  onClick={() => {
                    void view(v);
                  }}
                >
                  预览
                </ActionButton>
              </div>
            ))}
        </SectionPanel>
      )}
      {active && !panel && (
        <div className="creatorInlineStatus" role="status">
          <span>{runLabel(active)}</span>
          <ActionButton
            tone="ghost"
            onClick={() => {
              setSelectedRunId(active.id);
              setPanel("run");
            }}
          >
            查看进度
          </ActionButton>
        </div>
      )}
      {!panel && incoming && <ActionButton onClick={() => { void view(incoming); }}>检查新封面</ActionButton>}
      {!panel && !active && state.runs.length > 0 && <ActionButton tone="ghost" onClick={() => setPanel("run")}>制作详情</ActionButton>}
      {panel === "run" && latest && (
        <SectionPanel
          title="制作详情"
          onClose={close}
          returnFocus={focusReturn}
        >
          <label className="creatorField">
            制作记录
            <select
              value={latest.id}
              onChange={(e) => {
                setSelectedRunId(e.target.value);
                setAck(false);
              }}
            >
              {[...state.runs].reverse().map((run) => (
                <option value={run.id} key={run.id}>
                  {new Date(run.createdAt).toLocaleString()} ·{" "}
                  {run.purpose === "service_test" ? "服务测试" : runLabel(run)}
                </option>
              ))}
            </select>
          </label>
          <p className="creatorFileName" title={latest.video.name}>
            {latest.video.name}
          </p>
          <p role="status">{runLabel(latest)}</p>
          {latest.error && (
            <p role="alert" className="creatorError">
              {latest.error}
            </p>
          )}
          {latest.ratios.map((r) => {
            const slot = latest.slots[r],
              version = state.versions.find((v) => v.id === slot?.versionId && !v.hidden);
            return (
              <div key={r} className="coverTaskRatio">
                <div className="creatorInlineStatus">
                  <strong>{r.replace("x", ":")}</strong>
                  <span>
                    {version
                      ? sourceLabel(version)
                      : labels[slot?.status ?? latest.status]}
                  </span>
                  {version && (
                    <ActionButton
                      onClick={() => {
                        void view(version);
                      }}
                    >
                      查看图片
                    </ActionButton>
                  )}
                  {slot &&
                    ["failed", "cancelled", "unconfirmed"].includes(
                      slot.status,
                    ) && (
                      <ActionButton
                        disabled={
                          busy || (slot.status === "unconfirmed" && !ack)
                        }
                        onClick={() => {
                          void apply({
                            ...scope,
                            action: "retry",
                            runId: latest.id,
                            ratios: [r],
                            acknowledgeUnknown: ack,
                          });
                        }}
                      >
                        仅重试此画幅
                      </ActionButton>
                    )}
                </div>
                {slot?.error && <p className="creatorError">{slot.error}</p>}
                {slot?.prompt && (
                  <details>
                    <summary>提示词</summary>
                    <p className="creatorPrewrap">{slot.prompt}</p>
                  </details>
                )}
              </div>
            );
          })}
          {latest.status === "unconfirmed" && (
            <label className="creatorCheckbox">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              已核对服务端结果，重新请求可能再次计费
            </label>
          )}
          {latest.analysis && (
            <details className="creatorDisclosure">
              <summary>选帧与分析</summary>
              <p className="creatorPrewrap">{latest.analysis}</p>
            </details>
          )}
          <ActionBar>
            {["running", "preparing", "waiting_agent"].includes(
              latest.status,
            ) && (
              <ActionButton
                disabled={busy}
                onClick={() => {
                  void apply({ ...scope, action: "cancel", runId: latest.id });
                }}
              >
                取消本次制作
              </ActionButton>
            )}
            {latest.status === "waiting_agent" && (
              <ActionButton
                disabled={busy}
                onClick={() => {
                  void draft(latest);
                }}
              >
                准备会话制作请求
              </ActionButton>
            )}
          </ActionBar>
        </SectionPanel>
      )}
      <details className="creatorDisclosure">
        <summary>高级操作</summary>
        <p className="creatorMuted">
          画面分析与检查使用 Harness 当前支持看图的 Agent。
        </p>
        <ActionButton
          disabled={busy || !detail.selectedVideo}
          onClick={async () => {
            if (!detail.selectedVideo) return;
            const next = await apply({
              ...scope,
              action: "test",
              video: detail.selectedVideo,
            });
            if (next) {
              setSelectedRunId(next.runs.at(-1)?.id);
              setPanel("run");
            }
          }}
        >
          测试生图 · 1 张，可能计费
        </ActionButton>
      </details>
      <input
        ref={fileInput}
        hidden
        type="file"
        aria-label="导入已有封面"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          const path = (
            globalThis as typeof globalThis & {
              __DSH_HOST_PATHS__?: { pathFor: (f: File) => string };
            }
          ).__DSH_HOST_PATHS__?.pathFor(file);
          if (!path) {
            setError("请在 DSH Desktop 中选择本机图片。");
            return;
          }
          void apply({
            ...scope,
            action: "import",
            sourcePath: path,
            ratio: importRatio.current,
          });
        }}
      />
    </section>
  );
}
