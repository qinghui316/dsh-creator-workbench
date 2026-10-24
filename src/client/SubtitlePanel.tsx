import { useRef, useState } from "react";
import type { ContentDetail } from "../types.ts";
import { isActiveTask, type ProductionAction } from "../production/types.ts";
import { useProjectData } from "./ProjectData.tsx";
import { localFilePath, type ProductionClient } from "./productionApi.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
export function SubtitlePanel({ detail, api, openPath }: { detail: ContentDetail; api: ProductionClient; openPath: (path: string) => Promise<void> }) {
  const data = useProjectData(api, detail), file = useRef<HTMLInputElement>(null), mutation = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [ack, setAck] = useState(false);
  const video = detail.videos?.find(v => v.name === detail.selectedVideo);
  const transcript = [...(data.state?.transcripts ?? [])].reverse().find(t => video && t.video.name === video.name && t.video.size === video.size && t.video.modifiedAt === video.modifiedAt);
  const tasks = data.state?.tasks.filter(t => t.kind === "asr") ?? [], active = tasks.find(isActiveTask), uncertain = tasks.some(t => t.status === "unconfirmed");
  const run = async (action: ProductionAction) => { if (mutation.current) return; mutation.current = true; setBusy(true); setError(""); try { data.query.accept(await api.action(action)); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { mutation.current = false; setBusy(false); } };
  return <section className="productionPanel" aria-label="视频转文字"><div className="productionHeading"><h3>字幕</h3><ActionBar><ActionButton disabled={busy || !video || Boolean(active) || uncertain && !ack} onClick={() => void run({ id: detail.id, folderPath: detail.folderPath, action: "transcribe", acknowledgeUnknown: ack })}>{transcript ? "使用已有转写" : "视频转文字"}</ActionButton><ActionButton disabled={busy || !video} onClick={() => file.current?.click()}>导入字幕</ActionButton></ActionBar></div>
    <input ref={file} hidden type="file" accept=".srt,.ass" aria-label="导入字幕" onChange={e => { const selected = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (selected) { try { void run({ id: detail.id, folderPath: detail.folderPath, action: "import-subtitle", sourcePath: localFilePath(selected) }); } catch (e) { setError(e instanceof Error ? e.message : "路径读取失败"); } } }} />
    <p className="creatorMuted">{transcript ? `${transcript.source === "volcano" ? "火山转写" : "已导入字幕"} · ${transcript.cues} 段 · ${transcript.video.name}` : video ? "尚无当前视频的字幕" : "请先选择视频"}</p>
    {transcript && <ActionButton onClick={() => void openPath(`${detail.folderPath}/${transcript.srtFile}`).catch(e => setError(e.message))}>打开字幕文件</ActionButton>}
    {active && <p role="status">{active.step ?? "正在转写"}<ActionButton onClick={() => void run({ id: detail.id, folderPath: detail.folderPath, action: "cancel", taskId: active.id })}>取消</ActionButton></p>}
    {uncertain && <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />已核对上次结果，确认重新请求</label>}
    {(error || data.error || !active && tasks.at(-1)?.error) && <p role="alert" className="creatorError">{error || data.error || tasks.at(-1)?.error}</p>}
  </section>;
}
