import { invalidateProjectSettings } from "./projectQuery.ts";
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { CreatorCapabilities, LibrarySettings } from "../types.ts";
import type { ImageSettings } from "../covers/types.ts";
import { IMAGE_CREDENTIAL } from "../covers/types.ts";
import type { CredentialsClient, CredentialView } from "./credentialsApi.ts";
import type { CreatorViewFace } from "./face.ts";
import type { CreatorKey } from "./locales.ts";
import { CREATOR_SETTINGS_PLATFORMS } from "./publishPlatforms.ts";
import { ActionBar, ActionButton } from "./ui/ActionButton.tsx";
import { saveImageForm } from "./imageSettingsSave.ts";
import "./CreatorSettingsCard.css";
import { ProductionSettingsPanel, type ProductionSettingsHandle } from "./ProductionSettingsPanel.tsx";

export interface CreatorSettingsHandle {
  requestClose: () => void;
}
export type CreatorSettingsCardProps = Pick<
  CreatorViewFace,
  | "ready"
  | "getSettings"
  | "getCapabilities"
  | "getImageSettings"
  | "setImageSettings"
  | "beginImageUpdate"
  | "completeImageUpdate"
  | "checkImageService"
  | "setLibraryRoot"
  | "setProfile"
  | "setScriptRules"
  | "pickDirectory"
  | "production"
> & {
  credentials: CredentialsClient | undefined;
  t: (key: CreatorKey) => string;
  onClose?: () => void;
};
type FieldErrors = Partial<Record<"url" | "key" | "model", string>>;
export const CreatorSettingsCard = forwardRef<
  CreatorSettingsHandle,
  CreatorSettingsCardProps
>(function CreatorSettingsCard({ credentials, onClose, ...face }, ref) {
  const uid = useId();
  const [group, setGroup] = useState<"image" | "general" | "platforms" | "asr" | "wechat">("image");
  const productionRef = useRef<ProductionSettingsHandle>(null);
  const [productionDirty, setProductionDirty] = useState(false), [productionBusy, setProductionBusy] = useState(false);
  const [saved, setSaved] = useState<LibrarySettings>(),
    [image, setImage] = useState<ImageSettings>();
  const [apiBase, setApiBase] = useState(""),
    [model, setModel] = useState(""),
    [key, setKey] = useState("");
  const [root, setRoot] = useState(""),
    [rules, setRules] = useState(""),
    [platforms, setPlatforms] = useState<string[]>([]),
    [subtitleKey, setSubtitleKey] = useState("");
  const [credentialViews, setCredentialViews] = useState<
    Record<string, CredentialView>
  >({});
  const [credentialError, setCredentialError] = useState<string>();
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState<string>(),
    [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(false);
  const lastField = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [fields, setFields] = useState<FieldErrors>({});
  const [leaving, setLeaving] = useState(false),
    [capabilities, setCapabilities] = useState<CreatorCapabilities>();
  const alive = useRef(true),
    saving = useRef(false),
    leaveBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (face.production) invalidateProjectSettings(face.production);
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(undefined);
    setCredentialError(undefined);
    void Promise.all([face.getSettings(), face.getImageSettings()])
      .then(async ([general, service]) => {
        if (!live) return;
        setSaved(general);
        setImage(service);
        setApiBase(service.pending?.apiBase ?? service.apiBase);
        setModel(service.pending?.model ?? service.model);
        setKey("");
        setRoot(general.libraryRoot);
        setRules(general.scriptRules ?? "");
        setPlatforms([...general.profile.enabledPlatforms]);
        setSubtitleKey("");
        if (!credentials) {
          setCredentialError("凭据服务暂不可用，请重试加载。");
          return;
        }
        try {
          const response = await credentials.describe({
            refs: [IMAGE_CREDENTIAL, general.secrets.subtitle.ref],
          });
          if (!response.result.ok || !response.result.value) throw new Error();
          if (live)
            setCredentialViews(
              Object.fromEntries(
                [IMAGE_CREDENTIAL, general.secrets.subtitle.ref].map((ref) => [
                  ref,
                  response.result.value!.credentials[ref] ?? {
                    configured: false,
                    writable: true,
                  },
                ]),
              ),
            );
        } catch {
          if (live) setCredentialError("无法读取凭据状态，请重试加载。");
        }
      })
      .catch(() => {
        if (live) setLoadError("设置读取失败，现有配置未改动。");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [retry]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (leaving) leaveBox.current?.focus();
  }, [leaving]);
  const imageDirty =
    !!image &&
    (apiBase !== (image.pending?.apiBase ?? image.apiBase) ||
      model !== (image.pending?.model ?? image.model) ||
      !!key);
  const generalDirty =
    !!saved &&
    (root !== saved.libraryRoot ||
      rules !== (saved.scriptRules ?? "") ||
      JSON.stringify(platforms) !==
        JSON.stringify(saved.profile.enabledPlatforms) ||
      !!subtitleKey);
  const dirty = imageDirty || generalDirty || productionDirty;
  const imageCredential = credentialViews[IMAGE_CREDENTIAL];
  const subtitleRef = saved?.secrets.subtitle.ref;
  const subtitleCredential = subtitleRef
    ? credentialViews[subtitleRef]
    : undefined;
  const imageConfigured =
    imageCredential?.configured ?? saved?.secrets.cover.configured ?? false;
  useImperativeHandle(ref, () => ({
    requestClose: () => {
      if (saving.current || productionBusy) return;
      if (dirty) setLeaving(true);
      else onClose?.();
    },
  }));
  const discard = () => {
    productionRef.current?.discard();
    setApiBase(image?.pending?.apiBase ?? image?.apiBase ?? "");
    setModel(image?.pending?.model ?? image?.model ?? "");
    setKey("");
    setRoot(saved?.libraryRoot ?? "");
    setRules(saved?.scriptRules ?? "");
    setPlatforms([...(saved?.profile.enabledPlatforms ?? [])]);
    setSubtitleKey("");
    setFields({});
    setError(undefined);
    setLeaving(false);
    onClose?.();
  };
  const validate = () => {
    const next: FieldErrors = {};
    try {
      const url = new URL(apiBase);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    } catch {
      next.url = "请输入有效的 HTTP/HTTPS 服务根地址。";
    }
    if (!model.trim()) next.model = "请填写生图模型名称。";
    if (!imageConfigured && !key.trim()) next.key = "请填写 API Key。";
    if (image?.pending?.needsKey && !key.trim())
      next.key = "上次密钥更新未完成，请重新填写。";
    if (
      !next.url &&
      image?.apiBase &&
      new URL(image.apiBase).origin !== new URL(apiBase).origin &&
      !key.trim()
    )
      next.key = "服务来源已改变，请填写对应服务的新 Key。";
    setFields(next);
    return Object.keys(next).length === 0;
  };
  const save = async (closeAfter = false) => {
    if (!image || !saved || saving.current || productionBusy) return;
    if ((imageDirty || image.pending) && !validate()) {
      setGroup("image");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    let completed = false;
    try {
      if (productionDirty) { await productionRef.current?.save(); completed = true; }
      if (imageDirty || image.pending) {
        if (credentialError)
          throw new Error("凭据状态读取失败，请先重试加载。");
        const next = await saveImageForm(
          face,
          credentials,
          image,
          { apiBase, model, key },
          (pending) => {
            if (alive.current) setImage(pending);
          },
        );
        completed = true;
        if (!alive.current) return;
        setImage(next);
        setApiBase(next.apiBase);
        setModel(next.model);
        setKey("");
        setCredentialViews((v) => ({
          ...v,
          [IMAGE_CREDENTIAL]: {
            configured: true,
            writable: imageCredential?.writable ?? true,
          },
        }));
      }
      let general = saved;
      if (root !== saved.libraryRoot) {
        await face.setLibraryRoot(root);
        completed = true;
        general = { ...general, libraryRoot: root };
        if (alive.current) setSaved(general);
      }
      if (
        JSON.stringify(platforms) !==
        JSON.stringify(saved.profile.enabledPlatforms)
      ) {
        const nextProfile = {
          enabledPlatforms:
            platforms as LibrarySettings["profile"]["enabledPlatforms"],
        };
        await face.setProfile(nextProfile);
        completed = true;
        general = { ...general, profile: nextProfile };
        if (alive.current) setSaved(general);
      }
      if (rules !== (saved.scriptRules ?? "")) {
        await face.setScriptRules(rules);
        completed = true;
        general = { ...general, scriptRules: rules };
        if (alive.current) setSaved(general);
      }
      if (subtitleKey.trim() && subtitleRef) {
        let ok = false;
        try {
          ok = !!(
            await credentials?.set({
              ref: subtitleRef,
              value: subtitleKey.trim(),
            })
          )?.result.ok;
        } catch {}
        if (!ok) throw new Error("字幕凭据保存失败，请重试。");
        if (alive.current) {
          setSubtitleKey("");
          setCredentialViews((v) => ({
            ...v,
            [subtitleRef]: {
              configured: true,
              writable: subtitleCredential?.writable ?? true,
            },
          }));
        }
      }
      if (alive.current) {
        setNotice("已保存");
        setLeaving(false);
        if (closeAfter) onClose?.();
      }
    } catch (cause) {
      if (alive.current)
        setError(
          (completed ? "部分设置已保存；" : "") +
            (cause instanceof Error ? cause.message : "保存失败，请重试。"),
        );
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const errorId = (field: string) => uid + "-" + field;
  return (
    <section
      data-plugin="dsh-creator-workbench"
      data-surface="settings-card"
      className="creatorSettings"
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.matches("input,textarea,select")
        )
          lastField.current = event.target;
      }}
    >
      {leaving && (
        <div
          className="creatorLeavePrompt"
          role="alertdialog"
          aria-label="有未保存的修改"
          tabIndex={-1}
          ref={leaveBox}
        >
          <h3>有未保存的修改</h3>
          <p>保存后返回，或继续编辑。</p>
          {image?.pending && (
            <p className="creatorMuted">
              已提交的更新仍未完成，放弃表单不会撤回已保存的凭据。
            </p>
          )}
          <ActionBar>
            <ActionButton
              tone="primary"
              disabled={busy}
              onClick={() => {
                void save(true);
              }}
            >
              保存并返回
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => {
                setLeaving(false);
                if (lastField.current?.isConnected)
                  lastField.current.focus({ preventScroll: true });
              }}
            >
              继续编辑
            </ActionButton>
            <ActionButton tone="ghost" disabled={busy} onClick={discard}>
              放弃修改
            </ActionButton>
          </ActionBar>
        </div>
      )}
      <nav className="creatorSettingsTabs" aria-label="设置分组">
        <button
          type="button"
          aria-current={group === "image" ? "page" : undefined}
          onClick={() => setGroup("image")}
        >
          生图服务
        </button>
        {face.production && ([['platforms', '发布平台'], ['asr', '语音转文字'], ['wechat', '公众号']] as const).map(([value, label]) => <button key={value} type="button" aria-current={group === value ? "page" : undefined} onClick={() => setGroup(value)}>{label}</button>)}
        <button
          type="button"
          aria-current={group === "general" ? "page" : undefined}
          onClick={() => setGroup("general")}
        >
          常规
        </button>
      </nav>
      {loading ? (
        <p role="status" className="creatorMuted">
          正在读取设置…
        </p>
      ) : loadError ? (
        <div>
          <p role="alert" className="creatorError">
            {loadError}
          </p>
          <ActionButton onClick={() => setRetry((n) => n + 1)}>
            重试加载
          </ActionButton>
        </div>
      ) : (
        <form
          className="creatorSettingsForm"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {face.production && <ProductionSettingsPanel ref={productionRef} api={face.production} credentials={credentials} group={group === "platforms" || group === "asr" || group === "wechat" ? group : undefined} onDirty={setProductionDirty} onBusy={setProductionBusy} />}
          {group === "image" ? (
            <>
              {image?.pending && (
                <p role="status" className="creatorError">
                  上次设置更新未完成，请继续保存。新的生图任务暂时停用。
                </p>
              )}
              <label className="creatorField">
                服务地址
                <input
                  type="url"
                  spellCheck={false}
                  value={apiBase}
                  placeholder="https://服务地址/v1"
                  disabled={busy}
                  aria-invalid={!!fields.url}
                  aria-describedby={fields.url ? errorId("url") : undefined}
                  onChange={(e) => {
                    setApiBase(e.target.value);
                    setFields({});
                  }}
                />
              </label>
              {fields.url && (
                <p id={errorId("url")} className="creatorError">
                  {fields.url}
                </p>
              )}
              <label className="creatorField">
                <span className="creatorLabelLine">
                  API Key{" "}
                  <small>{imageConfigured ? "已保存" : "尚未配置"}</small>
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  placeholder={
                    imageConfigured ? "留空保留已保存的 Key" : "粘贴 API Key"
                  }
                  disabled={
                    busy || !imageCredential?.writable || !!credentialError
                  }
                  aria-invalid={!!fields.key}
                  aria-describedby={fields.key ? errorId("key") : undefined}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setFields({});
                  }}
                />
              </label>
              {fields.key && (
                <p id={errorId("key")} className="creatorError">
                  {fields.key}
                </p>
              )}
              {!credentialError &&
                imageCredential &&
                !imageCredential.writable && (
                  <p className="creatorMuted">
                    该凭据由宿主管理，当前不可在这里修改。
                  </p>
                )}
              <label className="creatorField">
                生图模型
                <input
                  value={model}
                  placeholder="服务支持的图片模型名称"
                  disabled={busy}
                  aria-invalid={!!fields.model}
                  aria-describedby={fields.model ? errorId("model") : undefined}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setFields({});
                  }}
                />
              </label>
              {fields.model && (
                <p id={errorId("model")} className="creatorError">
                  {fields.model}
                </p>
              )}
            </>
          ) : group === "general" ? (
            <>
              <label className="creatorField">
                资料库位置
                <span className="creatorPathRow">
                  <span title={root}>{root || "尚未选择资料库"}</span>
                  <ActionButton
                    disabled={busy}
                    onClick={async () => {
                      try {
                        const path = await face.pickDirectory();
                        if (path && alive.current) setRoot(path);
                      } catch {
                        if (alive.current)
                          setError("目录选择器暂不可用，请重试。");
                      }
                    }}
                  >
                    更换
                  </ActionButton>
                </span>
              </label>
              <details className="creatorDisclosure">
                <summary>写稿偏好</summary>
                <textarea
                  rows={6}
                  aria-label="写稿偏好"
                  placeholder="希望 Agent 遵循的表达习惯…"
                  value={rules}
                  disabled={busy}
                  onChange={(e) => setRules(e.target.value)}
                />
              </details>
              <details className="creatorDisclosure">
                <summary>平台显示</summary>
                <div className="creatorPlatformOptions">
                  {CREATOR_SETTINGS_PLATFORMS.map((p) => (
                    <label key={p.key} className="creatorCheckbox">
                      <input
                        type="checkbox"
                        checked={platforms.includes(p.key)}
                        disabled={busy}
                        onChange={(e) =>
                          setPlatforms((v) =>
                            e.target.checked
                              ? [...v, p.key]
                              : v.filter((k) => k !== p.key),
                          )
                        }
                      />
                      {face.t(p.label)}
                    </label>
                  ))}
                </div>
              </details>
              <details
                className="creatorDisclosure"
                onToggle={(e) => {
                  if (e.currentTarget.open && !capabilities)
                    void face.getCapabilities().then(
                      (v) => {
                        if (alive.current) setCapabilities(v);
                      },
                      () => {
                        if (alive.current) setError("诊断信息读取失败");
                      },
                    );
                }}
              >
                <summary>能力与诊断</summary>
                {capabilities &&
                  Object.entries(capabilities).map(([name, value]) => (
                    <p key={name} className="creatorPrewrap">
                      {name} · {value.detail}
                    </p>
                  ))}
              </details>
            </>
          ) : null}
          {credentialError && (
            <div className="creatorInlineStatus">
              <p role="alert" className="creatorError">
                {credentialError}
              </p>
              <ActionButton
                disabled={dirty || busy}
                onClick={() => setRetry((n) => n + 1)}
              >
                重试读取凭据
              </ActionButton>
            </div>
          )}
          {error && (
            <p role="alert" className="creatorError">
              {error}
            </p>
          )}
          <div className="creatorSettingsSave">
            <ActionButton
              tone="primary"
              disabled={busy || productionBusy || (!dirty && !image?.pending)}
              onClick={() => {
                void save();
              }}
            >
              {busy && !checking ? "正在保存…" : "保存"}
            </ActionButton>
            {notice && (
              <span role="status" className="creatorMuted">
                {notice}
              </span>
            )}
          </div>
          {group === "image" && (
            <div className="creatorSettingsCheck">
              <ActionButton
                disabled={
                  busy ||
                  imageDirty ||
                  !!image?.pending ||
                  !imageConfigured ||
                  !image?.apiBase
                }
                onClick={async () => {
                  if (saving.current) return;
                  saving.current = true;
                  setChecking(true);
                  setBusy(true);
                  setError(undefined);
                  try {
                    const next = await face.checkImageService();
                    if (alive.current) setImage(next);
                  } catch (cause) {
                    if (alive.current)
                      setError(
                        cause instanceof Error ? cause.message : "连接失败",
                      );
                  } finally {
                    saving.current = false;
                    if (alive.current) {
                      setBusy(false);
                      setChecking(false);
                    }
                  }
                }}
              >
                {checking ? "正在检查…" : "检查连接"}
              </ActionButton>
              {image?.checked && (
                <p role="status" className="creatorMuted">
                  {image.checked.connection}
                </p>
              )}
              <details className="creatorDisclosure">
                <summary>图片能力</summary>
                <p className="creatorMuted">
                  连接检查不生成图片。实际生图可在封面区域的高级操作中测试。
                </p>
                {image?.checked && (
                  <p className="creatorMuted">
                    文字生图：{image.checked.generation}
                    <br />
                    参考图：{image.checked.edit}
                  </p>
                )}
              </details>
            </div>
          )}
        </form>
      )}
    </section>
  );
});
