import { useEffect, useRef, useState } from "react";
import type { ContentDetail, VideoImportState } from "../types.ts";
import type { CreatorViewFace } from "./face.ts";
import type { CreatorKey } from "./locales.ts";
import { bumpLibrary } from "./contentSelection.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./VideoPanel.css";

const importsByFolder = new Map<string, VideoImportState>();
type Props = Pick<
  CreatorViewFace,
  | "startVideoImport"
  | "getVideoImport"
  | "cancelVideoImport"
  | "selectVideo"
  | "getVideoPlayback"
  | "setVideoVisibility"
> & {
  detail: ContentDetail;
  t: (key: CreatorKey) => string;
};
export function VideoPanel({ detail, t, ...face }: Props) {
  const [source, setSource] = useState<string>();
  const [name, setName] = useState("");
  const [task, setTask] = useState<VideoImportState | undefined>(() =>
    importsByFolder.get(detail.folderPath),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [url, setUrl] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null),
    player = useRef<HTMLVideoElement>(null);
  const alive = useRef(true);
  const playbackRequest = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      player.current?.pause();
    };
  }, []);
  const report = (cause: unknown) => {
    if (alive.current)
      setError(cause instanceof Error ? cause.message : String(cause));
  };
  useEffect(() => {
    let active = true;
    const ticket = ++playbackRequest.current;
    player.current?.pause();
    setUrl(undefined);
    if (detail.videoSelection !== "selected") return;
    void face.getVideoPlayback(detail.id).then(
      (value) => {
        if (active && ticket === playbackRequest.current)
          setUrl(value.found ? value.url : undefined);
      },
      (cause) => {
        if (active) report(cause);
      },
    );
    return () => {
      active = false;
      player.current?.pause();
    };
  }, [
    detail.folderPath,
    detail.selectedVideo,
    detail.videos?.find((v) => v.name === detail.selectedVideo)?.modifiedAt,
  ]);
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
        if (next.status === "running")
          timer = setTimeout(() => {
            void poll();
          }, 300);
        else {
          bumpLibrary();
          if (next.status === "completed") setSource(undefined);
        }
      } catch (cause) {
        if (active) {
          report(cause);
          setTask(undefined);
          bumpLibrary();
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [task?.token, task?.status, detail.folderPath]);
  const visibility = async (file: string, hidden: boolean) => {
    setBusy(true);
    setError(undefined);
    if (hidden && file === detail.selectedVideo) {
      playbackRequest.current++;
      player.current?.pause();
      setUrl(undefined);
    }
    try {
      await face.setVideoVisibility(detail.id, file, detail.folderPath, hidden);
      if (alive.current) bumpLibrary();
    } catch (cause) {
      report(cause);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const running = task?.status === "running";
  return (
    <section className="creatorVideoPanel" aria-label={t("video.title")}>
      <div className="creatorSectionHeading">
        <h3>视频</h3>
        <ActionButton
          tone={detail.videoSelection === "selected" ? "secondary" : "primary"}
          disabled={busy || running}
          onClick={() => fileInput.current?.click()}
        >
          导入视频
        </ActionButton>
      </div>
      <input
        ref={fileInput}
        hidden
        type="file"
        aria-label="选择导入视频"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        disabled={busy || running}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          try {
            const path = (
              globalThis as typeof globalThis & {
                __DSH_HOST_PATHS__?: { pathFor: (f: File) => string };
              }
            ).__DSH_HOST_PATHS__?.pathFor(file);
            if (!path) throw new Error(t("video.desktopRequired"));
            setSource(path);
            setName(file.name);
            setError(undefined);
          } catch (cause) {
            report(cause);
          }
        }}
      />
      {source && (
        <div className="videoImportConfirmation">
          <p className="creatorFileName" title={name}>
            待导入：{name}
          </p>
          <details>
            <summary>修改文件名</summary>
            <label className="creatorField">
              保存文件名
              <input
                value={name}
                disabled={busy || running}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </details>
          <ActionBar>
            <ActionButton
              tone="primary"
              disabled={busy || running || !name.trim()}
              onClick={() => {
                setBusy(true);
                setError(undefined);
                void face
                  .startVideoImport(detail.id, source, name, detail.folderPath)
                  .then((next) => {
                    importsByFolder.set(detail.folderPath, next);
                    if (alive.current) {
                      setTask(next);
                      if (next.status === "completed") {
                        setSource(undefined);
                        bumpLibrary();
                      }
                    }
                  }, report)
                  .finally(() => {
                    if (alive.current) setBusy(false);
                  });
              }}
            >
              确认导入
            </ActionButton>
            {!running && (
              <ActionButton
                tone="ghost"
                disabled={busy}
                onClick={() => {
                  setSource(undefined);
                  setError(undefined);
                }}
              >
                取消
              </ActionButton>
            )}
          </ActionBar>
        </div>
      )}
      {task && (
        <div className="creatorInlineStatus" role="status">
          <span>
            {t(`video.${task.status}`)}
            {task.status === "failed" ? "：" + (task.error ?? "") : ""}
          </span>
          {running && (
            <ActionButton
              onClick={() => {
                void face.cancelVideoImport(task.token).then((next) => {
                  if (alive.current) setTask(next);
                  bumpLibrary();
                }, report);
              }}
            >
              取消导入
            </ActionButton>
          )}
        </div>
      )}
      <label className="creatorField">
        当前视频
        <select
          value={detail.selectedVideo ?? ""}
          disabled={busy || running || !detail.videos?.length}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            setBusy(true);
            setError(undefined);
            void face
              .selectVideo(detail.id, value, detail.folderPath)
              .then(() => bumpLibrary(), report)
              .finally(() => {
                if (alive.current) setBusy(false);
              });
          }}
        >
          <option value="" disabled>
            {t(`video.${detail.videoSelection ?? "empty"}`)}
          </option>
          {detail.videos?.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      {detail.videoSelection !== "selected" && (
        <p className="creatorMuted">
          {t(`video.${detail.videoSelection ?? "empty"}`)}
        </p>
      )}
      {url && (
        <video
          ref={player}
          key={url}
          controls
          playsInline
          preload="metadata"
          src={url}
          onError={() =>
            setError("视频编码暂时无法播放。文件已保留，可选择其他兼容视频。")
          }
        />
      )}
      {error && (
        <p className="creatorError" role="alert">
          {error}
        </p>
      )}
      <details className="creatorDisclosure">
        <summary>管理视频 · {detail.videos?.length ?? 0}</summary>
        {(detail.videos ?? []).map((v) => (
          <div className="creatorAssetRow" key={v.name}>
            <div className="creatorRowCopy">
              <strong title={v.name}>{v.name}</strong>
              <small>
                {(v.size / 1048576).toFixed(1)} MB
                {v.name === detail.selectedVideo ? " · 当前视频" : ""}
              </small>
            </div>
            <ActionButton
              tone="ghost"
              disabled={busy || running}
              onClick={() => {
                void visibility(v.name, true);
              }}
            >
              从列表移除
            </ActionButton>
          </div>
        ))}

      </details>
    </section>
  );
}
