// @vitest-environment jsdom
import { createElement as h, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductionSettingsPanel, type ProductionSettingsHandle } from "../src/client/ProductionSettingsPanel.tsx";
import type { ProductionClient } from "../src/client/productionApi.ts";
import type { CredentialsClient } from "../src/client/credentialsApi.ts";
import type { ProductionSettingsView } from "../src/production/types.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({ Button: ({ children, variant, size, ...props }: Record<string, unknown>) => h("button", props, children as never) }));
afterEach(cleanup);
function fixture() {
  const saved: ProductionSettingsView = { revision: "one", accounts: {}, accountHistory: [], observations: {}, browserPaused: false, wechat: { appid: "wxfixture00000001", author: "", theme: "claude-editorial" }, runtime: { publisher: true, article: true, python: true, ffmpeg: true, browser: true, details: [] }, asrConfigured: true, wechatConfigured: true, wechatCredential: "ref" };
  const settings = vi.fn(async () => saved), settingsAction = vi.fn(async () => saved), set = vi.fn(async () => ({ result: { ok: true } }));
  const api = { settings, settingsAction } as unknown as ProductionClient, credentials = { set } as unknown as CredentialsClient;
  const ref = createRef<ProductionSettingsHandle>();
  render(h(ProductionSettingsPanel, { ref, api, credentials, group: "wechat", onDirty: vi.fn(), onBusy: vi.fn() }));
  return { ref, saved, settings, settingsAction, set };
}
describe("production settings interaction", () => {
  it("refreshes browser handoff state when reopening settings without replacing unsaved fields", async () => {
    const saved: ProductionSettingsView = { revision: "one", accounts: {}, accountHistory: [], observations: {}, browserPaused: false, wechat: { appid: "wxfixture00000001", author: "原作者", theme: "claude-editorial" }, runtime: { publisher: true, article: true, python: true, ffmpeg: true, browser: true, details: [] }, asrConfigured: true, wechatConfigured: true, wechatCredential: "ref" };
    const settings = vi.fn(async () => saved), settingsAction = vi.fn(async () => ({ ...saved, browserPaused: false }));
    const props = { api: { settings, settingsAction } as unknown as ProductionClient, credentials: { set: vi.fn() } as unknown as CredentialsClient, onDirty: vi.fn(), onBusy: vi.fn() };
    const view = render(h(ProductionSettingsPanel, { ...props, group: "wechat" }));
    const author = await screen.findByLabelText("作者");
    await waitFor(() => expect((author as HTMLInputElement).value).toBe("原作者"));
    fireEvent.change(author, { target: { value: "尚未保存的作者" } });
    fireEvent.change(screen.getByPlaceholderText("留空保留此公众号的原凭据"), { target: { value: "unsaved-secret" } });
    view.rerender(h(ProductionSettingsPanel, { ...props, group: undefined }));
    await waitFor(() => expect(settings).toHaveBeenCalledTimes(2));
    settings.mockResolvedValue({ ...saved, revision: "two", browserPaused: true });
    view.rerender(h(ProductionSettingsPanel, { ...props, group: "platforms" }));
    fireEvent.click(await screen.findByRole("button", { name: "继续浏览器操作" }));
    await waitFor(() => expect(settingsAction).toHaveBeenCalledWith({ action: "resume-browser" }));
    view.rerender(h(ProductionSettingsPanel, { ...props, group: "wechat" }));
    expect((await screen.findByLabelText("作者") as HTMLInputElement).value).toBe("尚未保存的作者");
    expect((screen.getByPlaceholderText("留空保留此公众号的原凭据") as HTMLInputElement).value).toBe("unsaved-secret");
  });
  it("keeps the key private and preserves the existing key while changing ordinary fields", async () => {
    const { ref, settingsAction, set } = fixture();
    const author = await screen.findByLabelText("作者"); await waitFor(() => expect(screen.getByLabelText("AppID").getAttribute("value")).toBe("wxfixture00000001"));
    fireEvent.change(author, { target: { value: "新作者" } });
    await act(async () => { await ref.current!.save(); });
    expect(set).not.toHaveBeenCalled(); expect(settingsAction).toHaveBeenCalledWith({ action: "save-wechat", appid: "wxfixture00000001", author: "新作者", theme: "claude-editorial", revision: "one" });
  });
  it("requires the new account's secret and recovers a revision error without discarding edits", async () => {
    const { ref, settingsAction, set, settings, saved } = fixture();
    const appid = await screen.findByLabelText("AppID"); await waitFor(() => expect((appid as HTMLInputElement).value).toBe(saved.wechat.appid));
    fireEvent.change(appid, { target: { value: "wxfixture00000002" } });
    await act(async () => { await expect(ref.current!.save()).rejects.toThrow("AppSecret"); }); expect(set).not.toHaveBeenCalled();
    const secret = screen.getByPlaceholderText("留空保留此公众号的原凭据"); fireEvent.change(secret, { target: { value: "fixture-secret" } });
    settingsAction.mockRejectedValueOnce(new Error("设置已被更新，请重新加载后保存。"));
    await act(async () => { await expect(ref.current!.save()).rejects.toThrow("尚未全部完成"); });
    expect(JSON.stringify(settingsAction.mock.calls)).not.toContain("fixture-secret");
    expect((secret as HTMLInputElement).value).toBe("fixture-secret");
    settings.mockResolvedValueOnce({ ...saved, revision: "two" }); fireEvent.click(screen.getByText("重新读取设置"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect((appid as HTMLInputElement).value).toBe("wxfixture00000002"); expect((secret as HTMLInputElement).value).toBe("fixture-secret");
    await act(async () => { await ref.current!.save(); });
    expect(settingsAction).toHaveBeenLastCalledWith(expect.objectContaining({ revision: "two", appid: "wxfixture00000002" }));
  });
});
