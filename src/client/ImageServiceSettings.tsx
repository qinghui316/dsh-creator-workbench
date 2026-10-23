import { useEffect, useState } from "react";
import type { ImageSettings } from "../covers/types.ts";
import type { CreatorViewFace } from "./face.ts";
export function ImageServiceSettings({ face }: { face: Pick<CreatorViewFace, "getImageSettings" | "setImageSettings" | "checkImageService"> }) {
  const [settings, setSettings] = useState<ImageSettings>({ apiBase: "", model: "", revision: "" });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { let live = true; void face.getImageSettings().then((v) => { if (live) setSettings(v); }, (e) => { if (live) setMessage(String(e)); }); return () => { live = false; }; }, []);
  const act = async (check: boolean) => {
    setBusy(true); setMessage("");
    try { const next = check ? await face.checkImageService() : await face.setImageSettings(settings); setSettings(next); setMessage(check ? next.checked?.connection ?? "检查完成" : "生图服务设置已保存；API Key 在下方保存。"); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  return <fieldset className="creatorImageSettings"><legend>生图服务</legend>
    <p>画面分析与质检使用 Harness 当前 Agent。这里只配置图片生成服务，使用 OpenAI 兼容接口。</p>
    <label>服务根地址<input aria-label="生图服务根地址" placeholder="https://服务地址/v1" value={settings.apiBase} disabled={busy} onChange={(e) => setSettings({ apiBase: e.target.value, model: settings.model, revision: "" })} /></label>
    <label>生图模型<input aria-label="生图模型" placeholder="填写服务支持的图片模型名称" value={settings.model} disabled={busy} onChange={(e) => setSettings({ apiBase: settings.apiBase, model: e.target.value, revision: "" })} /></label>
    <div className="creatorImageActions"><button disabled={busy || !settings.apiBase || !settings.model} onClick={() => { void act(false); }}>保存生图设置</button><button disabled={busy || !settings.revision} onClick={() => { void act(true); }}>检查连接（不生图）</button></div>
    <p>连接检查只尝试读取模型列表，不代表图片能力可用。真实生成与参考图能力会在制作封面后分别记录。</p>
    {settings.checked && <p>文字生图：{settings.checked.generation}；参考图：{settings.checked.edit}</p>}
    {message && <p role="status">{message}</p>}
  </fieldset>;
}
