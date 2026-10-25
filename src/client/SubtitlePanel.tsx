import { useId, useRef, useState } from "react";
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
  const statusId=useId();
  const latest=[...tasks].reverse().find(task=>video&&task.video?.name===video.name&&task.video.size===video.size&&task.video.modifiedAt===video.modifiedAt);
  const taskFailure=!active&&latest?.error&&(!transcript||latest.updatedAt>=transcript.createdAt)?latest.error:undefined;
  const failure=error||data.error||taskFailure;
  const noAudio=Boolean(failure&&/没有音轨|no audio/i.test(failure));
  const run = async (action: ProductionAction) => { if (mutation.current) return; mutation.current = true; setBusy(true); setError(""); try { data.query.accept(await api.action(action)); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { mutation.current = false; setBusy(false); } };
  return <section className="productionPanel" aria-label="视频转文字"><div className="productionHeading"><h3>字幕</h3><ActionBar><ActionButton aria-describedby={statusId} disabled={busy || !video || noAudio || Boolean(active) || uncertain && !ack} onClick={() => void run({ id: detail.id, folderPath: detail.folderPath, action: "transcribe", acknowledgeUnknown: ack })}>{transcript ? "使用已有转写" : "视频转文字"}</ActionButton><ActionButton tone={noAudio?"primary":"secondary"} disabled={busy || !video} onClick={() => file.current?.click()}>导入字幕</ActionButton></ActionBar></div>
    <input ref={file} hidden type="file" accept=".srt,.ass" aria-label="导入字幕" onChange={e => { const selected = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (selected) { try { void run({ id: detail.id, folderPath: detail.folderPath, action: "import-subtitle", sourcePath: localFilePath(selected) }); } catch (e) { setError(e instanceof Error ? e.message : "路径读取失败"); } } }} />
    <p id={statusId} className={failure?"creatorError":"creatorMuted"} role={failure?"alert":undefined}>{failure?(noAudio?"当前视频没有音轨，可导入字幕":failure):transcript ? `${transcript.source === "volcano" ? "火山转写" : "已导入字幕"} · ${transcript.cues} 段 · ${transcript.video.name}` : video ? "尚无当前视频的字幕，可转写或导入" : "请先选择视频"}</p>
    {failure&&transcript&&<p className="creatorMuted">已保留当前字幕 · {transcript.cues} 段 · {transcript.video.name}</p>}
    {transcript && <ActionButton onClick={() => void openPath(`${detail.folderPath}/${transcript.srtFile}`).catch(e => setError(e.message))}>打开字幕文件</ActionButton>}
    {active && <p role="status">{active.step ?? "正在转写"}<ActionButton onClick={() => void run({ id: detail.id, folderPath: detail.folderPath, action: "cancel", taskId: active.id })}>取消</ActionButton></p>}
    {uncertain && <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />已核对上次结果，确认重新请求</label>}
  </section>;
}
