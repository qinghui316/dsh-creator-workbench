import { SecretInput } from "./ui/SecretInput.tsx";
import { invalidateProjectSettings } from "./projectQuery.ts";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ASR_CREDENTIAL, type ProductionSettingsAction, type ProductionSettingsView } from "../production/types.ts";
import { PUBLISH_PLATFORM_DEFINITIONS, PUBLISH_PLATFORMS } from "../platforms.ts";
import type { CredentialsClient } from "./credentialsApi.ts";
import { localFilePath, wechatCredentialRef, type ProductionClient } from "./productionApi.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import "./ProductionPanel.css";

export interface ProductionSettingsHandle { save: () => Promise<void>; discard: () => void }
export const ProductionSettingsPanel = forwardRef<ProductionSettingsHandle, { api: ProductionClient; credentials: CredentialsClient | undefined; group: "platforms" | "asr" | "wechat" | undefined; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }>(function ProductionSettingsPanel({ api, credentials, group, onDirty, onBusy }, ref) {
  const [saved, setSaved] = useState<ProductionSettingsView>(), [error, setError] = useState<string>(), [busy, setBusy] = useState(false), [notice, setNotice] = useState<string>();
  const [asrKey, setAsrKey] = useState(""), [appid, setAppid] = useState(""), [secret, setSecret] = useState(""), [author, setAuthor] = useState(""), [theme, setTheme] = useState("claude-editorial");
  const alive = useRef(true), initialized = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  const dirty = Boolean(asrKey || secret || saved && (appid !== saved.wechat.appid || author !== saved.wechat.author || theme !== saved.wechat.theme));
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onDirty(false); onBusy(false); }; }, [onDirty, onBusy]);
  const load = async () => {
    setError(undefined);
    try { const next = await api.settings(); if (!alive.current) return; setSaved(next); if (!initialized.current) { initialized.current = true; setAppid(next.wechat.appid); setAuthor(next.wechat.author); setTheme(next.wechat.theme); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "设置读取失败，请重试。"); }
  };
  useEffect(() => { void load(); }, [api, group]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(undefined), 5000); return () => clearTimeout(timer); }, [notice]);
  const action = async (request: ProductionSettingsAction) => {
    if (busy) return; setBusy(true); setError(undefined); setNotice(undefined);
    try { const next = await api.settingsAction(request); invalidateProjectSettings(api); if (alive.current) { setSaved(next); if (request.action === "import-wechat") { setAppid(next.wechat.appid); setAuthor(next.wechat.author); setTheme(next.wechat.theme); setSecret(""); } setNotice(request.action === "prepare-runtime" ? "运行环境已准备" : request.action === "check-wechat" ? "凭据可用，草稿和数据权限在实际操作时分别验证" : "已更新"); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); }
    finally { if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (!saved) throw new Error("发布设置尚未读取成功，请重试加载。");
    if (busy) throw new Error("当前操作尚未完成。");
    if (!dirty) return;
    if (!credentials) throw new Error("宿主凭据服务暂不可用，请稍后重试。");
    setBusy(true); setError(undefined); let credentialSaved = false;
    try {
      if (asrKey.trim()) { const result = await credentials.set({ ref: ASR_CREDENTIAL, value: asrKey.trim() }); if (!result?.result.ok) throw new Error("火山语音 Key 保存失败。"); credentialSaved = true; if (alive.current) setAsrKey(""); }
      const changed = appid !== saved.wechat.appid || author !== saved.wechat.author || theme !== saved.wechat.theme || Boolean(secret.trim());
      let next = saved;
      if (changed) {
        if (!/^wx[a-zA-Z0-9]{8,40}$/.test(appid.trim())) throw new Error("请填写有效的公众号 AppID。");
        if ((appid !== saved.wechat.appid || !saved.wechatConfigured) && !secret.trim()) throw new Error("请填写此公众号对应的 AppSecret。");
        if (secret.trim()) { const result = await credentials.set({ ref: await wechatCredentialRef(appid.trim()), value: secret.trim() }); if (!result?.result.ok) throw new Error("公众号 AppSecret 保存失败。"); credentialSaved = true; }
        next = await api.settingsAction({ action: "save-wechat", appid: appid.trim(), author, theme, revision: saved.revision }); invalidateProjectSettings(api);
      } else next = await api.settings();
      if (alive.current) { setSaved(next); setSecret(""); setAppid(next.wechat.appid); setAuthor(next.wechat.author); setTheme(next.wechat.theme); setNotice("已保存"); }
    } catch (cause) { const message = (credentialSaved ? "凭据已保存，设置更新尚未全部完成；" : "") + (cause instanceof Error ? cause.message : "保存失败，请重试。"); if (alive.current) setError(message); throw new Error(message); }
    finally { if (alive.current) setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ save, discard: () => { setAsrKey(""); setSecret(""); if (saved) { setAppid(saved.wechat.appid); setAuthor(saved.wechat.author); setTheme(saved.wechat.theme); } } }));
  return <div hidden={!group} className="productionSettings">
    {error && <div><p className="creatorError" role="alert">{error}</p>{saved && <ActionButton disabled={busy} onClick={() => void load()}>重新读取设置</ActionButton>}</div>}
    {!saved ? <ActionButton onClick={() => void load()}>重试加载发布设置</ActionButton> : <>
      {group === "platforms" && <>
        <div className="productionHeading"><h3>发布账号</h3><ActionButton disabled={busy} onClick={() => void action({ action: saved.browserPaused ? "resume-browser" : "pause-browser" })}>{saved.browserPaused ? "继续浏览器操作" : "暂停浏览器操作"}</ActionButton></div>
        {!saved.runtime.browser && <p className="creatorMuted">安装并打开 <a href="https://www.egolite.ai/download" target="_blank" rel="noreferrer">Ego 浏览器 Windows 版</a>，完成首次设置后检查账号。</p>}
        <div className="productionAccounts">{PUBLISH_PLATFORMS.map((platform) => {
          const account = saved.accounts[platform], observed = saved.observations[platform], canConnect = observed?.state === "connected" && observed.id && observed.id !== account?.id;
          return <div className="productionAccount" key={platform}><div><strong>{PUBLISH_PLATFORM_DEFINITIONS[platform].name}</strong><span>{account ? `${account.name} · ${account.id}` : "尚未连接"}</span>{observed && <small>{observed.state === "login-required" ? "需要登录" : observed.state === "connected" ? `当前登录：${observed.name}` : observed.error ?? "账号尚未核验"}</small>}</div>
            <ActionBar><ActionButton disabled={busy} onClick={() => void action({ action: "open-login", platform })}>打开登录</ActionButton><ActionButton disabled={busy} onClick={() => void action({ action: "check-account", platform })}>检查账号</ActionButton>{canConnect && <ActionButton disabled={busy} onClick={() => void action({ action: "connect-account", platform, expectedId: observed.id!, replace: Boolean(account) })}>{account ? "确认更换账号" : "连接此账号"}</ActionButton>}</ActionBar>
          </div>;
        })}</div>
        <details className="creatorDisclosure"><summary>运行环境</summary><p className="creatorMuted">{saved.runtime.details.length ? saved.runtime.details.join(" ") : "Windows 运行依赖已就绪"}</p><ActionButton disabled={busy} onClick={() => void action({ action: "prepare-runtime" })}>{busy ? "正在准备…" : "准备运行环境"}</ActionButton></details>
      </>}
      {group === "asr" && <>
        <h3>豆包录音文件识别极速版</h3>
        <p className="creatorMuted">确认录音文件识别极速版已开通，再填入同一项目的 API Key。</p>
        <ActionBar><a href="https://console.volcengine.com/speech/service/10012" target="_blank" rel="noreferrer">查看服务状态</a><a href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noreferrer">管理 API Key</a></ActionBar>
        <label className="creatorField"><span className="creatorLabelLine">API Key <small>{saved.asrConfigured ? "已保存" : "尚未配置"}</small></span><SecretInput aria-label="火山语音 API Key" value={asrKey} disabled={busy || !credentials} placeholder={saved.asrConfigured ? "留空保留原 Key" : "填写火山语音 API Key"} onChange={(e) => setAsrKey(e.target.value)} /></label>

        <details className="creatorDisclosure"><summary>服务说明</summary><p className="creatorMuted">新版列表未显示此服务时，在旧版控制台的“语音识别大模型 → 录音文件识别大模型 → 极速版”查看。已开通的服务无需重复开通。</p><p className="creatorMuted">当前接入模型资源：<code>volc.bigasr.auc_turbo</code>，无需另填。支持两小时以内、提取音频不超过 100 MB 的视频；识别会使用服务额度。</p><a href="https://docs.volcengine.com/docs/DoubaoVoice/recording-file-recognition-lite-http?lang=zh" target="_blank" rel="noreferrer">官方接口说明</a></details>
      </>}
      {group === "wechat" && <>
        <h3>微信公众号</h3>
        <label className="creatorField">AppID<input autoComplete="off" spellCheck={false} value={appid} disabled={busy} onChange={(e) => setAppid(e.target.value)} /></label>
        <label className="creatorField"><span className="creatorLabelLine">AppSecret <small>{saved.wechatConfigured && appid === saved.wechat.appid ? "已保存" : "尚未配置"}</small></span><SecretInput aria-label="AppSecret" value={secret} disabled={busy || !credentials} placeholder="留空保留此公众号的原凭据" onChange={(e) => setSecret(e.target.value)} /></label>
        <label className="creatorField">作者<input value={author} disabled={busy} onChange={(e) => setAuthor(e.target.value)} /></label>
        <label className="creatorField">文章排版<select value={theme} disabled={busy} onChange={(e) => setTheme(e.target.value)}><option value="claude-editorial">简洁编辑风格</option><option value="professional-clean">清爽专业风格</option></select></label>
        <ActionBar><ActionButton disabled={busy || dirty || !saved.wechatConfigured} onClick={() => void action({ action: "check-wechat" })}>检查账号</ActionButton><ActionButton disabled={busy || dirty} onClick={() => fileInput.current?.click()}>导入已有配置</ActionButton></ActionBar>
        <input hidden ref={fileInput} aria-label="导入公众号配置" type="file" accept=".yaml,.yml" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { try { void action({ action: "import-wechat", sourcePath: localFilePath(file) }); } catch (cause) { setError(cause instanceof Error ? cause.message : "文件读取失败"); } } }} />
        {saved.wechat.error && <p role="alert" className="creatorError">{saved.wechat.error}</p>}
        {saved.wechat.checkedAt && <p className="creatorMuted">最近检查：{new Date(saved.wechat.checkedAt).toLocaleString()}。草稿和数据权限分别在实际操作时验证。</p>}
      </>}
    </>}
    {notice && <p className="creatorMuted" role="status">{notice}</p>}{busy && <p className="creatorMuted" role="status">正在处理，请稍候…</p>}
  </div>;
});
