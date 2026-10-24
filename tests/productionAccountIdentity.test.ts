// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
const accounts = await import(pathToFileURL(resolve("scripts/ego-account.mjs")).href);
function home(html: string, path = "/creator-micro/home") {
  vi.stubGlobal("location", new URL(`https://creator.douyin.com${path}`));
  document.body.innerHTML = html;
  Object.defineProperty(document.body, "innerText", { configurable: true, get: () => document.body.textContent });
}
const profile = '<div class="header-abc"><div class="left-abc"><div class="name-abc">测试创作者</div></div><div class="unique_id-abc">抖音号：creator_123</div></div>';
afterEach(() => { document.body.replaceChildren(); delete (window as unknown as { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__; vi.unstubAllGlobals(); });
describe("creator account identity", () => {
  it("reads the real Douyin creator-home profile without touching storage or tokens", async () => {
    home(profile);
    expect(await accounts.readAccountIdentity("douyin")).toEqual({ state: "connected", id: "douyin-account:creator_123", name: "测试创作者" });
  });
  it("waits for the profile instead of binding a temporary global uid during hydration", async () => {
    home("<main>首页正在加载</main>");
    (window as unknown as { __INITIAL_STATE__: unknown }).__INITIAL_STATE__ = { userInfo: { uid: "other-id", nickname: "other-name" } };
    expect((await accounts.readAccountIdentity("douyin")).state).toBe("unverified");
    document.body.innerHTML = profile;
    expect((await accounts.readAccountIdentity("douyin")).id).toBe("douyin-account:creator_123");
  });
  it("does not infer the current account from another page or ambiguous profile blocks", async () => {
    home(profile, "/creator-micro/content/manage");
    expect((await accounts.readAccountIdentity("douyin")).state).toBe("unverified");
    home(profile + profile.replaceAll("creator_123", "creator_456"));
    expect((await accounts.readAccountIdentity("douyin")).state).toBe("unverified");
  });
  it("distinguishes an explicit login page from unavailable account information", async () => {
    home("<main>扫码登录</main>");
    expect((await accounts.readAccountIdentity("douyin")).state).toBe("login-required");
    home("<main>服务暂不可用</main>");
    expect((await accounts.readAccountIdentity("douyin")).state).toBe("unverified");
  });
  it("preserves Xiaohongshu's existing visible account identity", async () => {
    home('<div class="account-name">创作者</div><div>小红书账号:123456</div>');
    expect(await accounts.readAccountIdentity("xiaohongshu")).toEqual({ state: "connected", id: "xhs-account:123456", name: "创作者" });
  });
});
