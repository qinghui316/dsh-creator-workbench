import type { ImageSettings } from "../covers/types.ts";
import { IMAGE_CREDENTIAL } from "../covers/types.ts";
import type { CredentialsClient } from "./credentialsApi.ts";
import type { CreatorViewFace } from "./face.ts";

export async function saveImageForm(
  face: Pick<CreatorViewFace, "beginImageUpdate" | "completeImageUpdate">,
  credentials: CredentialsClient | undefined,
  current: ImageSettings,
  form: { apiBase: string; model: string; key: string },
  onPending: (state: ImageSettings) => void,
): Promise<ImageSettings> {
  const key = form.key.trim();
  if (key && !credentials) throw new Error("凭据服务暂不可用，请重试。");
  const pending = await face.beginImageUpdate({
    apiBase: form.apiBase,
    model: form.model,
    revision: current.revision,
    hasNewKey: !!key,
  });
  onPending(pending);
  if (key) {
    let ok = false;
    try {
      ok = !!(await credentials!.set({ ref: IMAGE_CREDENTIAL, value: key }))
        .result.ok;
    } catch {
      /* Never surface secret transport errors. */
    }
    if (!ok)
      throw new Error("API Key 保存失败，设置更新未完成。请保留输入并重试。");
  }
  return face.completeImageUpdate({
    token: pending.pending!.token,
    keyUpdated: !!key,
  });
}
