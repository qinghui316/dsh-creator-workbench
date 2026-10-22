import { useEffect, useRef, useState } from "react";
import type { ContentDetail, VideoImportState } from "../types.ts";
import type { CreatorViewFace } from "./face.ts";
import type { CreatorKey } from "./locales.ts";
import { bumpLibrary } from "./contentSelection.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./VideoPanel.css";

const importsByFolder = new Map<string, VideoImportState>();
type Props = Pick<CreatorViewFace, "startVideoImport" | "getVideoImport" | "cancelVideoImport" | "selectVideo" | "getVideoPlayback"> & {
  detail: ContentDetail; t: (key: CreatorKey) => string;
};

export function VideoPanel({ detail, t, ...face }: Props) {
  const [source, setSource] = useState<string>();
  const [name, setName] = useState("");
  const [task, setTask] = useState<VideoImportState | undefined>(() => importsByFolder.get(detail.folderPath));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [url, setUrl] = useState<string>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const report = (cause: unknown) => { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); };

  useEffect(() => {
    let active = true;
    setUrl(undefined);
    setError(undefined);
    if (detail.videoSelection !== "selected") return;
    void face.getVideoPlayback(detail.id).then((value) => {
      if (active) setUrl(value.found ? value.url : undefined);
    }, (cause) => { if (active) report(cause); });
    return () => { active = false; };
  }, [detail.folderPath, detail.selectedVideo, detail.videos?.find((v) => v.name === detail.selectedVideo)?.modifiedAt]);

  useEffect(() => {
    if (task?.status !== "running") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await face.getVideoImport(task.token);
        importsByFolder.set(detail.folderPath, next);
        if (!active) return;
        setTask(next);
        if (next.status === "running") timer = setTimeout(() => { void poll(); }, 300);
        else { bumpLibrary(); if (next.status === "completed") setSource(undefined); }
      } catch (cause) { if (active) { report(cause); setTask(undefined); bumpLibrary(); } }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [task?.token, task?.status, detail.folderPath]);

  const running = task?.status === "running";
  return <section className="creatorVideoPanel" aria-label={t("video.title")}>
    <div className="videoImportBox">
      <label className="videoFileLabel">{t("video.import")}
        <input type="file" accept=".mp4,.mov,video/mp4,video/quicktime" disabled={busy || running} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file === undefined) return;
          try {
            const bridge = (globalThis as typeof globalThis & { __DSH_HOST_PATHS__?: { pathFor: (file: File) => string } }).__DSH_HOST_PATHS__;
            const path = bridge?.pathFor(file);
            if (!path) throw new Error(t("video.desktopRequired"));
            setSource(path); setName(file.name); setError(undefined);
          } catch (cause) { report(cause); }
        }} />
      </label>
      <p className="videoHint">{t("video.importHint")}</p>
      {source !== undefined && <label className="videoNameLabel">{t("video.importName")}
        <input value={name} disabled={busy || running} onChange={(event) => { setName(event.target.value); }} />
      </label>}
      <ActionBar>
        {source !== undefined && <ActionButton tone="primary" disabled={busy || running || name.trim() === ""} onClick={() => {
          setBusy(true); setError(undefined);
          void face.startVideoImport(detail.id, source, name, detail.folderPath).then((next) => {
            importsByFolder.set(detail.folderPath, next);
            if (alive.current) setTask(next);
          }, report).finally(() => { if (alive.current) setBusy(false); });
        }}>{t("video.start")}</ActionButton>}
        {running && <ActionButton onClick={() => { void face.cancelVideoImport(task.token).then(setTask, report); }}>{t("video.cancel")}</ActionButton>}
      </ActionBar>
      {task !== undefined && <p role="status" className="videoHint">{t(`video.${task.status}`)}{task.status === "failed" ? `：${task.error ?? ""}` : ""}</p>}
    </div>
    <label className="videoNameLabel">{t("video.current")}
      <select value={detail.selectedVideo ?? ""} disabled={busy || running || !detail.videos?.length} onChange={(event) => {
        const value = event.target.value;
        if (!value) return;
        setBusy(true); setError(undefined);
        void face.selectVideo(detail.id, value, detail.folderPath).then(() => { bumpLibrary(); }, report).finally(() => { if (alive.current) setBusy(false); });
      }}>
        <option value="" disabled={true}>{t(`video.${detail.videoSelection ?? "empty"}`)}</option>
        {detail.videos?.map((video) => <option key={video.name} value={video.name}>{video.name} · {(video.size / 1048576).toFixed(1)} MB</option>)}
      </select>
    </label>
    {detail.videoSelection !== "selected" && <p className="videoHint">{t(`video.${detail.videoSelection ?? "empty"}`)}</p>}
    {error !== undefined && <p role="alert" className="videoError">{error}</p>}
    {url !== undefined && <video key={url} controls={true} playsInline={true} preload="metadata" src={url}
      onError={(event) => { const code = event.currentTarget.error?.code; setError(`${t("video.playbackError")} (${code ?? "?"})`); }} />}
  </section>;
}
