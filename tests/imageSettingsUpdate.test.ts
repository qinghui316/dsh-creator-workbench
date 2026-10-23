import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi } from "vitest";
import {
  beginImageUpdate,
  completeImageUpdate,
  readImageSettings,
  saveImageSettings,
  checkImageConnection,
  requestImage,
} from "../src/covers/provider.ts";
import { saveImageForm } from "../src/client/imageSettingsSave.ts";
import { IMAGE_CREDENTIAL } from "../src/covers/types.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "creator-settings-update-"));
  const current = await saveImageSettings(dir, {
    apiBase: "https://old.example/v1",
    model: "old",
  });
  return { dir, current };
}
describe("unified image settings", () => {
  it("keeps the active address until credentials complete, without putting the key in settings", async () => {
    const { dir, current } = await fixture();
    const secret = "fixture-private-image-key";
    const credentials = {
      describe: vi.fn(),
      set: vi.fn().mockResolvedValue({ result: { ok: true } }),
    };
    const face = {
      beginImageUpdate: (v: Parameters<typeof beginImageUpdate>[1]) =>
        beginImageUpdate(dir, v),
      completeImageUpdate: (v: { token: string; keyUpdated: boolean }) =>
        completeImageUpdate(dir, v.token, v.keyUpdated),
    };
    const onPending = vi.fn();
    const next = await saveImageForm(
      face,
      credentials,
      current,
      { apiBase: "https://new.example/v1", model: "new", key: secret },
      onPending,
    );
    expect(onPending.mock.calls[0]![0]).toMatchObject({
      apiBase: current.apiBase,
      pending: { apiBase: "https://new.example/v1", needsKey: true },
    });
    expect(credentials.set).toHaveBeenCalledExactlyOnceWith({
      ref: IMAGE_CREDENTIAL,
      value: secret,
    });
    expect(next).toMatchObject({
      apiBase: "https://new.example/v1",
      model: "new",
    });
    expect(next.pending).toBeUndefined();
    expect(
      await readFile(join(dir, "image-service.json"), "utf8"),
    ).not.toContain(secret);
  });
  it("preserves a saved key for a model-only update and rejects a new origin without a new key", async () => {
    const { dir, current } = await fixture();
    await expect(
      beginImageUpdate(dir, {
        ...current,
        apiBase: "https://new.example/v1",
        hasNewKey: false,
      }),
    ).rejects.toThrow("新 API Key");
    const credentials = { describe: vi.fn(), set: vi.fn() };
    const next = await saveImageForm(
      {
        beginImageUpdate: (v) => beginImageUpdate(dir, v),
        completeImageUpdate: (v) =>
          completeImageUpdate(dir, v.token, v.keyUpdated),
      },
      credentials,
      current,
      { apiBase: current.apiBase, model: "new", key: "" },
      () => {},
    );
    expect(next.model).toBe("new");
    expect(credentials.set).not.toHaveBeenCalled();
  });
  it("pauses generation on a partial save and supports retry without claiming rollback", async () => {
    const { dir, current } = await fixture();
    const credentials = {
      describe: vi.fn(),
      set: vi
        .fn()
        .mockRejectedValue(new Error("transport leaked fixture-secret")),
    };
    await expect(
      saveImageForm(
        {
          beginImageUpdate: (v) => beginImageUpdate(dir, v),
          completeImageUpdate: (v) =>
            completeImageUpdate(dir, v.token, v.keyUpdated),
        },
        credentials,
        current,
        {
          apiBase: "https://new.example/v1",
          model: "new",
          key: "fixture-secret",
        },
        () => {},
      ),
    ).rejects.toThrow("API Key 保存失败");
    const partial = await readImageSettings(dir);
    expect(partial.apiBase).toBe(current.apiBase);
    expect(partial.pending).toBeDefined();
    const signal = new AbortController().signal;
    await expect(
      checkImageConnection(partial, "unused", signal),
    ).rejects.toThrow("更新未完成");
    await expect(
      requestImage(
        partial,
        "unused",
        { ratio: "3x4", mode: "text", prompt: "x", references: [] },
        signal,
      ),
    ).rejects.toThrow("更新未完成");
    await expect(
      completeImageUpdate(dir, partial.pending!.token, false),
    ).rejects.toThrow("尚未保存");
    const retry = await beginImageUpdate(dir, {
      apiBase: "https://new.example/v1",
      model: "new",
      revision: partial.revision,
      hasNewKey: true,
    });
    expect(
      (await completeImageUpdate(dir, retry.pending!.token, true)).pending,
    ).toBeUndefined();
  });
  it("rejects concurrent stale saves and stale completion tokens", async () => {
    const { dir, current } = await fixture();
    const input = { ...current, hasNewKey: false, model: "next" };
    const outcomes = await Promise.allSettled([
      beginImageUpdate(dir, input),
      beginImageUpdate(dir, input),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      completeImageUpdate(dir, "stale-token", false),
    ).rejects.toThrow("变化");
  });
});
