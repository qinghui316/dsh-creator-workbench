import { creationPreviewImages } from "./imageDescriptors.ts";
import { useImagePreview } from "./ImagePreview.tsx";
import { useEffect, useRef, useState } from "react";
import type { ContentDetail } from "../types.ts";
import { isActiveTask, type ProductionAction } from "../production/types.ts";
import { localFilePath, type ProductionClient } from "./productionApi.ts";
import { useProjectData } from "./ProjectData.tsx";
import { ImageThumb } from "./ImageThumb.tsx";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./CreationPanel.css";
import "./MediaLayout.css";
import { imageName } from "./mediaPresentation.ts";
import { ActionMenu } from "./ui/ActionMenu.tsx";
import { SectionPanel } from "./ui/SectionPanel.tsx";

const imageStatus = { pending: "等待制作", running: "正在制作", completed: "已保存", failed: "未完成", cancelled: "已取消", unconfirmed: "结果待核对" };
export function ImageLibraryPanel({ detail, api }: { detail: ContentDetail; api: ProductionClient }) {
  const data = useProjectData(api, detail), scope = { id: detail.id, folderPath: detail.folderPath };
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [acknowledge, setAcknowledge] = useState(false), [request, setRequest] = useState("");
  const file = useRef<HTMLInputElement>(null), alive = useRef(true), mutation = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [inspecting, setInspecting] = useState<string>();
  const root = useRef<HTMLElement>(null), detailOrigin = useRef<{ host: HTMLElement; scrollTop: number }>();
  const inspect = (id: string) => {
    const host = root.current?.closest<HTMLElement>('[role="tabpanel"]');
    if (host) detailOrigin.current = { host, scrollTop: host.scrollTop };
    setInspecting(id);
  };
  const closeDetails = () => {
    setInspecting(undefined);
    const origin = detailOrigin.current;
    if (origin?.host.isConnected) origin.host.scrollTop = origin.scrollTop;
    detailOrigin.current = undefined;
  };
  useEffect(() => {
    if (!inspecting) return;
    const panel = root.current?.querySelector<HTMLElement>('.creatorSectionPanel'), host = detailOrigin.current?.host;
    if (!panel || !host) return;
    const bounds = panel.getBoundingClientRect(), viewport = host.getBoundingClientRect();
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) host.scrollTop += bounds.top - viewport.top - 12;
  }, [inspecting]);
  const images = data.state?.images?.filter(i => !i.hidden) ?? [];
  const previews=creationPreviewImages(images,detail,api),preview=useImagePreview(previews);
  const run = async (action: ProductionAction) => {
    if (mutation.current) return; mutation.current = true; setBusy(true); setError("");
    try { const state = await api.action(action); data.query.accept(state); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "操作未完成"); }
    finally { mutation.current = false; if (alive.current) setBusy(false); }
  };
  const ask = async (append = false) => {
    const text = "请按本项目选题和我的要求制作配图或封面，使用已配置的生图服务，保存并登记图片；完成后查看实际图片检查结果。";
    setRequest(text); setError("");
    try { if (!api.prepareRequest) throw new Error("请在项目对话提出图片制作要求。"); await api.prepareRequest(detail, text, append); setNotice("请求已放入项目对话，请发送。"); }
    catch (e) { setError(e instanceof Error ? e.message : "请求未准备好"); }
  };
  const tasks = data.state?.tasks.filter(t => t.kind === "images" && (isActiveTask(t) || ["failed", "unconfirmed"].includes(t.status))) ?? [];
  return <section ref={root} className="creationPanel" aria-label="项目图片">
    <div className="productionHeading"><h3>项目图片</h3><ActionBar><ActionButton onClick={() => void ask()}>让 Agent 制作图片</ActionButton><ActionButton disabled={busy} onClick={() => file.current?.click()}>导入图片</ActionButton></ActionBar></div>
    <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="导入项目图片" onChange={e => { const selected = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (selected) { try { void run({ ...scope, action: "import-image", sourcePath: localFilePath(selected), purpose: "illustration" }); } catch (e) { setError(e instanceof Error ? e.message : "文件选择失败"); } } }} />
    {!images.length && <p className="creatorMuted">还没有图片</p>}
    <div className="creatorMediaGrid">{images.map(image => <div key={image.id}>
      <button className="creatorMediaFrame" aria-label={`预览图片：${imageName(image)}`} onClick={e => preview.open(previews, image.id, e.currentTarget)}><ImageThumb image={image} detail={detail} api={api}/></button>
      <div className="creatorMediaCaption"><span className="creatorMediaName" title={imageName(image)}>{imageName(image)}</span><ActionMenu label="更多" ariaLabel={`图片操作：${imageName(image)}`} align="end"><ActionButton tone="ghost" onClick={()=>inspect(image.id)}>查看详情</ActionButton><ActionButton tone="ghost" disabled={busy} onClick={()=>void run({...scope,action:"remove-image",imageId:image.id})}>移除图片</ActionButton></ActionMenu></div>
    </div>)}</div>
    {inspecting&&images.find(i=>i.id===inspecting)&&<SectionPanel title="图片详情" onClose={closeDetails}>{images.filter(i=>i.id===inspecting).map(i=><dl key={i.id} className="creatorMediaDetails"><dt>名称</dt><dd>{imageName(i)}</dd><dt>尺寸</dt><dd>{i.width} × {i.height}</dd><dt>来源</dt><dd>{i.source==="imported"?"导入图片":"AI 制作"}</dd><dt>文件</dt><dd>{i.file}</dd></dl>)}</SectionPanel>}
    {tasks.map(task => <div className="creationProgress" key={task.id}><p>{task.step ?? "图片制作"}</p>{task.imageItems?.map((item, index) => <div key={item.id}>第 {index + 1} 张 · {item.error ?? imageStatus[item.status]}{["failed", "cancelled", "unconfirmed"].includes(item.status) && <ActionButton disabled={busy || item.status === "unconfirmed" && !acknowledge} onClick={() => void run({ ...scope, action: "retry-images", taskId: task.id, itemIds: [item.id], acknowledgeUnknown: acknowledge })}>重试此图</ActionButton>}</div>)}{isActiveTask(task) && <ActionButton onClick={() => void run({ ...scope, action: "cancel", taskId: task.id })}>取消制作</ActionButton>}{task.status === "unconfirmed" && <label><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)} />已核对上次结果，确认重试</label>}</div>)}
    {notice && <p role="status" className="creatorMuted">{notice}</p>}
    {(error || data.error) && <div role="alert"><p className="creatorError">{error || data.error}</p>{error.includes("已有草稿") && request && <ActionButton onClick={() => void ask(true)}>追加创作请求</ActionButton>}<ActionButton onClick={() => void data.query.retry().catch(() => undefined)}>重新读取</ActionButton></div>}
  </section>;
}
