import { SelectionRail } from "./ui/SelectionRail.tsx";
import { ImagePreviewProvider } from "./ImagePreview.tsx";
import { PublicationPanel } from "./PublicationPanel.tsx";
import { ImageLibraryPanel } from "./ImageLibraryPanel.tsx";
import { ArticlePanel } from "./ArticlePanel.tsx";
import { SubtitlePanel } from "./SubtitlePanel.tsx";
import { OverviewPage } from "./OverviewPage.tsx";
import { ProjectDataProvider } from "./ProjectData.tsx";
import { PROJECT_TABS, type ProjectTab } from "../projectView.ts";
import { CoverPanel } from "./CoverPanel.tsx";
import { ProductionPanel } from "./ProductionPanel.tsx";
import { VideoPanel } from "./VideoPanel.tsx";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  IconCloseOutlineRegular,
  IconFolderOpenOutlineRegular,
  MarkdownText,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";

import { formatCount } from "../collectPublish.ts";
import { rewriteArticleImages } from "../articleMarkdown.ts";
import type { ArticleMediaResult, ContentDetail, PublishMark, PublishPlatform, SubtitleCue, WorkflowStage } from "../types.ts";
import type { CreatorViewFace } from "./face.ts";
import {
  useLibraryEpoch,
  useProfileEpoch,
  useSelectedContentId,
  captureContentSelection,
} from "./contentSelection.ts";
import type { CreatorKey } from "./locales.ts";
import { formatRelativeTime } from "./relativeTime.ts";
import { WORKFLOW_TONE } from "./workflowTone.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import { StatusPill, type StatusTone } from "./ui/StatusPill.tsx";
import "./ContentInspector.css";

const TABS = PROJECT_TABS;
const INSPECTOR_WIDE_PX = 720;
type InspectorTab = (typeof TABS)[number];

const STAGE_KEY: Record<WorkflowStage, CreatorKey> = {
  idle: "inspector.stage.idle",
  finish: "inspector.stage.finish",
  publish: "inspector.stage.publish",
  live: "inspector.stage.live",
};

const TAB_KEY: Record<InspectorTab, CreatorKey> = {
  overview: "inspector.tab.overview",
  video: "inspector.tab.video",
  script: "inspector.tab.script",
  subtitle: "inspector.tab.subtitle",
  article: "inspector.tab.article",
  images: "inspector.tab.images",
  publishing: "inspector.tab.publishing",
};

function cuesFromSubtitle(nextSubtitle: { text: string; cues: SubtitleCue[] }): SubtitleCue[] {
  if (nextSubtitle.cues.length > 0) return nextSubtitle.cues;
  if (nextSubtitle.text === "") return [];
  return nextSubtitle.text.split("\n").filter((line) => line.trim() !== "").map((text) => ({ text }));
}

function friendlyError(cause: unknown, t: (key: CreatorKey) => string): string {
  if (cause instanceof Error) {
    if (cause.message.startsWith("content not found")) return t("empty.gone" as CreatorKey);
    return cause.message;
  }
  return t("empty.error" as CreatorKey);
}

function metricParts(
  row: { views?: number; likes?: number; comments?: number },
  t: (key: CreatorKey) => string,
): string[] {
  const parts: string[] = [];
  if (row.views !== undefined) {
    parts.push(t("inspector.publish.views").replace("{n}", formatCount(row.views)));
  }
  if (row.likes !== undefined) {
    parts.push(t("inspector.publish.likes").replace("{n}", formatCount(row.likes)));
  }
  if (row.comments !== undefined) {
    parts.push(t("inspector.publish.comments").replace("{n}", formatCount(row.comments)));
  }
  return parts;
}

function JobNote({ tone, children }: { tone?: "running" | "done" | "error"; children: ReactNode }) {
  return (
    <div className={tone === undefined ? "jobNote" : `jobNote ${tone}`}>
      {tone === "running" && <StateDot state="ongoing" size={12} />}
      {tone === "done" && <StateDot state="done" size={12} />}
      {tone === "error" && <StateDot state="error" size={12} />}
      {children}
    </div>
  );
}

function WorkRow({
  name,
  status,
  tone,
  actions,
}: {
  name: string;
  status: string;
  tone?: StatusTone;
  actions?: ReactNode;
}) {
  return (
    <div className="workRow">
      <div className="workMain">
        <span className="workName">{name}</span>
        <StatusPill tone={tone ?? "neutral"}>{status}</StatusPill>
      </div>
      {actions !== undefined && <ActionBar>{actions}</ActionBar>}
    </div>
  );
}

const pendingScriptDrafts = new Map<string, string>();
const projectNavigation = new Map<string, { tab: ProjectTab; scroll: Partial<Record<ProjectTab, number>> }>();

export type ContentInspectorProps = CreatorViewFace & {
  suspended?: boolean;
  t: (key: CreatorKey) => string;
};

export function ContentInspector({
  production,
  t,
  suspended = false,
  ready,
  getContent,
  getProjectView,
  getCoverThumb,
  getCoverState, coverAction, getCoverImage, prepareCoverDraft, prepareCoverRequest,
  getVideoPlayback,
  startVideoImport,
  getVideoImport,
  cancelVideoImport,
  selectVideo,
  setVideoVisibility,
  getArticleMedia,
  getSubtitleText,
  getSettings,
  setPublish,
  startSubtitleGenerate,
  startSubtitleBurn,
  startCoverGenerate,
  setScript,
  openSubtitlePreview,
  openPath,
}: ContentInspectorProps) {
  const tabGroupId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedId, setSelectedId] = useSelectedContentId();
  const libraryEpoch = useLibraryEpoch();
  const profileEpoch = useProfileEpoch();
  const [enabledPlatforms, setEnabledPlatforms] = useState<readonly PublishPlatform[] | undefined>(undefined);
  const scriptSavedRef = useRef(true);
  const loadedFolder = useRef<string | null>(null);
  const loadedId = useRef<string | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const [loadedDetail, setDetail] = useState<ContentDetail | undefined>(undefined);
  const detail = loadedDetail?.id === selectedId ? loadedDetail : undefined;
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [publicationArticle, setPublicationArticle] = useState<string>();
  const [overviewTarget,setOverviewTarget] = useState<{folder:string;tab:ProjectTab;id:string}>();
  const tabMemory = useRef(projectNavigation);
  const navigationKey = useRef<string>();
  const changeTab = (next: ProjectTab) => { setOverviewTarget(undefined); if (detail) tabMemory.current.set(detail.folderPath, { tab: next, scroll: tabMemory.current.get(detail.folderPath)?.scroll ?? {} }); setTab(next); };

  const [wide, setWide] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [scriptRequest, setScriptRequest] = useState<"idle" | "preparing" | "ready" | "failed">("idle");
  const [scriptRequestError, setScriptRequestError] = useState("");

  const [busy, setBusy] = useState<"subtitle" | "burn" | "cover" | "sync" | undefined>(undefined);
  const expectSubtitlePreview = useRef(false);
  const [scriptDraft, setScriptDraft] = useState("");
  const [scriptSaved, setScriptSaved] = useState(true);
  const [scriptError, setScriptError] = useState<string>();
  const [scriptRetry, setScriptRetry] = useState(0);
  scriptSavedRef.current = scriptSaved;
  const [articleOrigin, setArticleOrigin] = useState<string | undefined>(undefined);
  const [publishPending, setPublishPending] = useState<PublishPlatform | null>(null);

  useEffect(() => {
    setTab("overview");
    setPublicationArticle(undefined);
    setActionError(undefined);
    setScriptRequest("idle"); setScriptRequestError("");

    setScriptDraft("");
    setScriptSaved(true);
    setScriptError(undefined);
    setArticleOrigin(undefined);
    setBusy(undefined);
    expectSubtitlePreview.current = false;
    setPublishPending(null);
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    if (!ready()) {
      setEnabledPlatforms([]);
      return () => { cancelled = true; };
    }
    void getSettings().then((settings) => {
      if (!cancelled) setEnabledPlatforms(settings.profile.enabledPlatforms);
    }, () => {
      if (!cancelled) setEnabledPlatforms([]);
    });
    return () => { cancelled = true; };
  }, [getSettings, profileEpoch, ready]);

  useEffect(() => {
    const el = pane.current;
    if (el === null) return;
    const update = (): void => {
      setWide(el.getBoundingClientRect().width >= INSPECTOR_WIDE_PX);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { update(); });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (suspended) return;
    if (selectedId === null) {
      loadedId.current = null;
      setDetail(undefined);
      setCues([]);
      setError(undefined);
      return;
    }
    if (!ready()) {
      setError(t("empty.remote" as CreatorKey));
      return;
    }
    const switched = loadedId.current !== selectedId;
    let cancelled = false;
    setError(undefined);
    void Promise.all([
      getProjectView && tab !== "script" ? getProjectView(selectedId).then(view => view.detail) : getContent(selectedId),
      tab === "subtitle" ? getSubtitleText(selectedId) : Promise.resolve({ text: "", cues: [] as SubtitleCue[] })
    ]).then(
      ([nextDetail, nextSubtitle]) => {
        if (cancelled) return;
        if (navigationKey.current !== nextDetail.folderPath) { navigationKey.current = nextDetail.folderPath; setTab(tabMemory.current.get(nextDetail.folderPath)?.tab ?? "overview"); }
        loadedId.current = selectedId;
        setDetail(nextDetail);
        if ((!getProjectView || tab === "script") && (switched || loadedFolder.current !== nextDetail.folderPath || scriptSavedRef.current)) {
          const draft = pendingScriptDrafts.get(nextDetail.folderPath) ?? nextDetail.script;
          setScriptDraft(draft);
          setScriptSaved(draft === nextDetail.script);
        }
        loadedFolder.current = nextDetail.folderPath;
        setCues(cuesFromSubtitle(nextSubtitle));
      },
      (cause: unknown) => {
        if (cancelled) return;
        if (switched) { setDetail(undefined); setCues([]); }
        setError(friendlyError(cause, t));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId, libraryEpoch, suspended, tab === "script", tab === "subtitle"]);

  useEffect(() => {
    if (production || suspended || tab !== "article" || selectedId === null || !ready()) return;
    let cancelled = false;
    void getArticleMedia(selectedId).then((next: ArticleMediaResult) => {
      if (cancelled) return;
      setArticleOrigin(next.found ? next.origin : undefined);
    }, () => {
      if (!cancelled) setArticleOrigin(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, selectedId, libraryEpoch, suspended]);

  useEffect(() => {
    if (suspended || detail === undefined || scriptSaved) return;
    let cancelled = false;
    const folder = detail.folderPath;
    setScriptError(undefined);
    const timer = window.setTimeout(() => {
      void setScript(detail.id, scriptDraft, folder).then((next) => {
        if (pendingScriptDrafts.get(folder) === scriptDraft && next.script === scriptDraft) pendingScriptDrafts.delete(folder);
        if (cancelled) return;
        setDetail(next);
        setScriptSaved(scriptDraft === next.script);
      }, (cause: unknown) => {
        if (!cancelled) setScriptError(cause instanceof Error ? cause.message : t("empty.error" as CreatorKey));
      });
    }, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [detail?.id, detail?.folderPath, scriptDraft, scriptSaved, suspended, scriptRetry]);

  useEffect(() => {
    const running = detail?.burn.status === "running"
      || detail?.subtitleJob.status === "running"
      || detail?.coverJob.status === "running";
    if (production || suspended || !running || selectedId === null || !ready()) return;
    const timer = window.setInterval(() => {
      void getContent(selectedId).then((next) => { setDetail(next); });
    }, 3000);
    return () => { window.clearInterval(timer); };
  }, [selectedId, detail?.burn.status, detail?.subtitleJob.status, detail?.coverJob.status, suspended]);

  useEffect(() => {
    if (suspended || selectedId === null || detail?.subtitleJob.status !== "done" || !ready()) return;
    void getSubtitleText(selectedId).then((nextSubtitle) => {
      setCues(cuesFromSubtitle(nextSubtitle));
    });
  }, [selectedId, detail?.subtitleJob.status, suspended]);

  useEffect(() => {
    if (suspended || !expectSubtitlePreview.current || selectedId === null || !ready()) return;
    if (detail?.subtitleJob.status === "done") {
      expectSubtitlePreview.current = false;
      void openSubtitlePreview(selectedId).then(() => undefined, (cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : t("empty.error" as CreatorKey));
      });
      return;
    }
    if (detail?.subtitleJob.status === "error") expectSubtitlePreview.current = false;
  }, [selectedId, detail?.subtitleJob.status, suspended]);

  const applyPublish = (platform: PublishPlatform, status: PublishMark): void => {
    if (publishPending !== null || detail === undefined || detail.publish[platform].status === status) return;
    setPublishPending(platform);
    const scope = detail.folderPath, id = selectedId;
    const isCurrentSelection = captureContentSelection();
    void setPublish(detail.id, platform, status, undefined, scope).then((next) => {
      if (!isCurrentSelection() || loadedFolder.current !== scope || loadedId.current !== id) return;
      setDetail(next);
      setPublishPending(null);
    }, (cause: unknown) => {
      if (!isCurrentSelection() || loadedFolder.current !== scope || loadedId.current !== id) return;
      setActionError(cause instanceof Error ? cause.message : t("empty.error" as CreatorKey));
      setPublishPending(null);
    });
  };

  if (selectedId === null) return null;

  const hasVideo = detail?.videoRaw !== undefined || detail?.videoSubtitled !== undefined;
  const hasSubtitleDraft = detail?.subtitles.srt !== undefined || detail?.subtitles.transcript !== undefined;
  const canPreviewSubtitle = hasSubtitleDraft || detail?.subtitleJob.status === "done";
  // The production panel owns ASR feedback; legacy burn feedback remains visible.
  const subtitleFeedback = production ? { status: "idle" as const, error: undefined } : detail?.subtitleJob;
  const hasAnyCover = detail !== undefined
    && (detail.covers["3x4"] !== undefined || detail.covers["4x3"] !== undefined || detail.covers["16x9"] !== undefined);
  const onGenerateSubtitle = (): void => {
    if (detail === undefined) return;
    if (detail.videoRaw === undefined && detail.videoSubtitled === undefined) {
      setActionError(t("inspector.subtitle.needVideo" as CreatorKey));
      return;
    }
    if (!detail.secrets.subtitle.configured) {
      setActionError(t("inspector.subtitle.needKey" as CreatorKey));
      return;
    }
    setActionError(undefined);
    setBusy("subtitle");
    expectSubtitlePreview.current = true;
    void startSubtitleGenerate(detail.id).then((next) => {
      setDetail(next);
      setBusy(undefined);
    }, (cause: unknown) => {
      expectSubtitlePreview.current = false;
      setActionError(cause instanceof Error ? cause.message : t("empty.error" as CreatorKey));
      setBusy(undefined);
    });
  };

  const onBurnSubtitle = (): void => {
    if (detail === undefined) return;
    if (detail.videoRaw === undefined) {
      setActionError(t("inspector.subtitle.needVideo" as CreatorKey));
      return;
    }
    if (!hasSubtitleDraft && detail.subtitleJob.status !== "done") {
      setActionError(t("inspector.subtitle.needDraft" as CreatorKey));
      return;
    }
    setActionError(undefined);
    setBusy("burn");
    void startSubtitleBurn(detail.id).then((next) => {
      setDetail(next);
      setBusy(undefined);
    }, (cause: unknown) => {
      setActionError(cause instanceof Error ? cause.message : t("empty.error" as CreatorKey));
      setBusy(undefined);
    });
  };

  const onPreviewSubtitle = (): void => {
    if (detail === undefined) return;
    void openSubtitlePreview(detail.id).then(() => undefined, (cause: unknown) => {
      setActionError(cause instanceof Error ? cause.message : t("empty.error" as CreatorKey));
    });
  };



  const subtitleStatus = (): { status: string; tone?: StatusTone } => {
    if (detail === undefined) return { status: "" };
    if (detail.subtitleJob.status === "running" || busy === "subtitle") {
      return { status: t("inspector.subtitle.generating" as CreatorKey), tone: "active" };
    }
    if (detail.burn.status === "running" || busy === "burn") {
      return { status: t("inspector.subtitle.burning" as CreatorKey), tone: "active" };
    }
    if (detail.subtitleJob.status === "error" || detail.burn.status === "error") {
      const raw = detail.subtitleJob.error ?? detail.burn.error;
      return {
        status: raw !== undefined && raw.includes("process exited")
          ? t("inspector.subtitle.failed" as CreatorKey)
          : raw ?? t("inspector.subtitle.failed" as CreatorKey),
        tone: "error",
      };
    }
    if (detail.videoSubtitled !== undefined) {
      return { status: t("inspector.subtitle.burned" as CreatorKey), tone: "success" };
    }
    if (hasSubtitleDraft) {
      return { status: t("inspector.subtitle.proofPending" as CreatorKey), tone: "pending" };
    }
    return { status: t("inspector.track.notGenerated" as CreatorKey) };
  };

  const coverStatus = (): { status: string; tone?: StatusTone } => {
    if (detail === undefined) return { status: "" };
    if (detail.coverJob.status === "running" || busy === "cover") {
      return { status: t("inspector.cover.generating" as CreatorKey), tone: "active" };
    }
    if (detail.coverJob.status === "error") {
      return {
        status: detail.coverJob.error ?? t("inspector.cover.failed" as CreatorKey),
        tone: "error",
      };
    }
    if (hasAnyCover) return { status: t("inspector.cover.ready" as CreatorKey), tone: "success" };
    return { status: t("inspector.track.notGenerated" as CreatorKey) };
  };


  useEffect(() => {
    if (!detail) return; const body = pane.current?.querySelector<HTMLElement>(".body"); if (body) body.scrollTop = tabMemory.current.get(detail.folderPath)?.scroll[tab] ?? 0;
  }, [tab, detail?.folderPath]);
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let target = index;
    if (event.key === "ArrowRight") target = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") target = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = TABS.length - 1;
    else return;
    event.preventDefault();
    const next = TABS[target];
    if (next === undefined) return;
    setTab(next);
    tabRefs.current[target]?.focus({ preventScroll: true });
  };

  const prepareScript = async (append = false) => {
    if (!detail || !production?.prepareRequest || scriptRequest === "preparing") return;
    const current = captureContentSelection(), folder = detail.folderPath;
    setScriptRequest("preparing"); setScriptRequestError("");
    try {
      await production.prepareRequest(detail, `请${detail.script ? "修改" : "编写"}本项目的口播脚本或拍摄提纲。先读取已有写稿偏好和选题，按我的要求完成并保存 script.md。`, append);
      if (current() && loadedFolder.current === folder) setScriptRequest("ready");
    } catch (error) { if (current() && loadedFolder.current === folder) { setScriptRequest("failed"); setScriptRequestError(error instanceof Error ? error.message : "脚本请求未准备好，请重试。"); } }
  };
  return (
    <div
      ref={pane}
      data-plugin="dsh-creator-workbench"
      data-surface="inspector"
      className={wide ? "wide" : undefined}
    >
      <ImagePreviewProvider key={detail?.folderPath ?? "empty"}>
      <header className="header">
        <div className="titleRow">
          <div className="title" title={detail?.title}>
            {detail?.title ?? (error === undefined ? t("empty.loading" as CreatorKey) : "")}
          </div>
          <div className="titleActions">
            {detail !== undefined && (
              <button
                type="button"
                className="close"
                aria-label={t("inspector.openFolder" as CreatorKey)}
                onClick={() => { void openPath(detail.folderPath); }}
              >
                <IconFolderOpenOutlineRegular size={14} />
              </button>
            )}
            <button
              data-detail-focus="true"
              type="button"
              className="close"
              aria-label={t("inspector.close" as CreatorKey)}
              onClick={() => {
                setSelectedId(null);
              }}
            >
              <IconCloseOutlineRegular size={14} />
            </button>
          </div>
        </div>
        <SelectionRail as="div" selected={tab} className="tabs" role="tablist">
          {TABS.map((id, index) => (
            <button
              key={id}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={`${tabGroupId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${tabGroupId}-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? "tab active" : "tab"}
              onClick={() => { changeTab(id); }}
              onKeyDown={(event) => { moveTabFocus(event, index); }}
            >
              {t(TAB_KEY[id])}
            </button>
          ))}
        </SelectionRail>
      </header>
      <ProjectBoundary api={production} detail={detail}><div
        id={`${tabGroupId}-panel-${tab}`}
        className="body"
        onScroll={event => { if (detail) { const previous = tabMemory.current.get(detail.folderPath); tabMemory.current.set(detail.folderPath, { tab, scroll: { ...previous?.scroll, [tab]: event.currentTarget.scrollTop } }); } }}
        role="tabpanel"
        aria-labelledby={`${tabGroupId}-tab-${tab}`}
      >
        {error !== undefined && <div className="empty">{error}</div>}
        {error === undefined && detail === undefined && (
          <div className="empty">{t("empty.loading" as CreatorKey)}</div>
        )}
        {detail !== undefined && tab === "overview" && (production ? <OverviewPage detail={detail} api={production} getVideoPlayback={getVideoPlayback} getCoverImage={getCoverImage} navigate={(next,id)=>{changeTab(next);setOverviewTarget(id?{folder:detail.folderPath,tab:next,id}:undefined);if(next==="publishing")setPublicationArticle(undefined);}} /> : <div className="projectOverview">{TABS.filter(t => t !== "overview").map(id => <button className="projectSummaryRow" key={id} onClick={() => changeTab(id)}>{t(TAB_KEY[id])}</button>)}</div>)}
        {detail !== undefined && tab === "video" && <>
          <VideoPanel key={detail.folderPath} detail={detail} t={t} getVideoPlayback={getVideoPlayback} startVideoImport={startVideoImport} getVideoImport={getVideoImport} cancelVideoImport={cancelVideoImport} selectVideo={selectVideo} setVideoVisibility={setVideoVisibility} />
          <ActionBar><ActionButton tone="ghost" onClick={() => changeTab("images")}>查看视频封面</ActionButton></ActionBar>
        </>}
        {detail !== undefined && tab === "images" && <>
          {production && <ImageLibraryPanel detail={detail} api={production} />}
          {(hasVideo || Object.keys(detail.covers).length > 0) && <CoverPanel detail={detail} {...(production ? {api: production} : {})} getCoverState={getCoverState} coverAction={coverAction} getCoverImage={getCoverImage} prepareCoverDraft={prepareCoverDraft} {...(prepareCoverRequest ? { prepareCoverRequest } : {})} />}
        </>}
        {detail !== undefined && tab === "publishing" && production && <PublicationPanel key={`publishing:${detail.folderPath}`} detail={detail} api={production} getCoverImage={getCoverImage} enabledPlatforms={enabledPlatforms ?? []} onPublish={applyPublish} publishPending={publishPending} openPath={openPath} {...(publicationArticle ? { initialArticleId: publicationArticle } : {})} {...(overviewTarget?.folder===detail.folderPath&&overviewTarget.tab==="publishing"?{initialPublicationId:overviewTarget.id}:{})} />}
        {detail !== undefined && tab === "script" && (
          <>
          {production?.prepareRequest && <ActionBar><ActionButton disabled={scriptRequest === "preparing"} onClick={() => void prepareScript()}>{scriptRequest === "preparing" ? "正在准备请求…" : detail.script ? "让 Agent 修改脚本" : "让 Agent 写脚本"}</ActionButton></ActionBar>}
          {scriptRequest === "ready" && <p role="status" className="creatorMuted">请求已放入左侧对话，请发送。</p>}
          {scriptRequestError && <div role="alert"><p className="creatorError">{scriptRequestError}</p>{scriptRequestError.includes("已有草稿") && <ActionButton onClick={() => void prepareScript(true)}>追加脚本请求</ActionButton>}</div>}
          <div className="scriptStatus" role="status">{scriptError ? <><span className="creatorError">保存失败：{scriptError}</span><ActionButton onClick={() => setScriptRetry((n) => n + 1)}>重试保存</ActionButton></> : scriptSaved ? "已保存" : "保存中…"}</div>
          <textarea
            aria-label="脚本正文"
            className="scriptEditor"
            value={scriptDraft}
            placeholder={t("inspector.script.placeholder" as CreatorKey)}
            onChange={(event) => {
              pendingScriptDrafts.set(detail.folderPath, event.target.value);
              setScriptDraft(event.target.value);
              setScriptError(undefined);
              setScriptSaved(event.target.value === detail.script);
            }}
          />
          </>
        )}
        {detail !== undefined && tab === "article" && production && <ArticlePanel key={`article:${detail.folderPath}`} detail={detail} api={production} openPath={openPath} {...(overviewTarget?.folder===detail.folderPath&&overviewTarget.tab==="article"?{initialArticleId:overviewTarget.id}:{})} goPublish={id => { setOverviewTarget(undefined);setPublicationArticle(id); changeTab("publishing"); }} />}
        {detail !== undefined && tab === "article" && !production && (
          detail.article.trim() === ""
            ? <div className="empty">{t("inspector.article.empty" as CreatorKey)}</div>
            : (
              <div className="article">
                <MarkdownText
                  labels={{ code: { copyLabel: t("markdown.copy"), copiedLabel: t("markdown.copied") }, footnotes: t("markdown.footnotes") }}
                  text={articleOrigin === undefined
                    ? detail.article
                    : rewriteArticleImages(detail.article, articleOrigin)}
                />
              </div>
            )
        )}
        {detail !== undefined && tab === "subtitle" && (
          <>
            {production && <SubtitlePanel key={`subtitle:${detail.folderPath}`} detail={detail} api={production} openPath={openPath} />}
            {hasVideo && !production && (
              <ActionBar>
                {canPreviewSubtitle && (
                  <ActionButton tone="ghost" onClick={onPreviewSubtitle}>
                    {t("inspector.subtitle.previewEdit" as CreatorKey)}
                  </ActionButton>
                )}
                <ActionButton
                  tone={!hasSubtitleDraft && detail.videoSubtitled === undefined ? "primary" : "secondary"}
                  onClick={onGenerateSubtitle}
                  disabled={
                    busy !== undefined
                    || detail.subtitleJob.status === "running"
                    || detail.burn.status === "running"
                  }
                >
                  {t((
                    !hasSubtitleDraft
                      ? "inspector.subtitle.generate"
                      : "inspector.subtitle.regenerate"
                  ) as CreatorKey)}
                </ActionButton>
                {hasSubtitleDraft && (
                  <ActionButton
                    tone={detail.videoSubtitled === undefined ? "primary" : "secondary"}
                    onClick={onBurnSubtitle}
                    disabled={
                      busy !== undefined
                      || detail.subtitleJob.status === "running"
                      || detail.burn.status === "running"
                    }
                  >
                    {t((detail.videoSubtitled === undefined
                      ? "inspector.subtitle.burn"
                      : "inspector.subtitle.reburn") as CreatorKey)}
                  </ActionButton>
                )}
              </ActionBar>
            )}
            {actionError !== undefined
              ? <JobNote tone="error">{actionError}</JobNote>
              : subtitleFeedback?.status === "running" || detail.burn.status === "running"
                ? (
                  <JobNote tone="running">
                    {t((subtitleFeedback?.status === "running"
                      ? "inspector.subtitle.generating"
                      : "inspector.subtitle.burning") as CreatorKey)}
                  </JobNote>
                )
                : subtitleFeedback?.status === "error" || detail.burn.status === "error"
                  ? (
                    <JobNote tone="error">
                      {(subtitleFeedback?.error ?? detail.burn.error ?? "").includes("process exited")
                        ? t("inspector.subtitle.burnFailed" as CreatorKey)
                        : subtitleFeedback?.error
                          ?? detail.burn.error
                          ?? t("inspector.subtitle.burnFailed" as CreatorKey)}
                    </JobNote>
                  )
                  : null}
            {cues.length === 0
              ? !production && <div className="empty">{t("inspector.subtitle.empty" as CreatorKey)}</div>
              : (
                <ol className="cues">
                  {cues.map((cue, index) => (
                    <li key={`${cue.at ?? "cue"}-${index}`} className="cue">
                      {cue.at !== undefined && <div className="cueTime">{cue.at}</div>}
                      <p className="cueText">{cue.text}</p>
                    </li>
                  ))}
                </ol>
              )}
          </>
        )}
      </div></ProjectBoundary>
      </ImagePreviewProvider>
    </div>
  );
}

function ProjectBoundary({api, detail, children}: {api: import("./productionApi.ts").ProductionClient | undefined; detail: ContentDetail | undefined; children: ReactNode}) {
  return api && detail ? <ProjectDataProvider key={detail.folderPath} api={api} scope={{id: detail.id, folderPath: detail.folderPath}}>{children}</ProjectDataProvider> : <>{children}</>;
}
