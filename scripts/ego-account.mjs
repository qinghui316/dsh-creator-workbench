// Only whitelisted account identity leaves the Page. No storage, cookies or tokens.
export const ACCOUNT_MARKER = "CREATOR_ACCOUNT:";
export const ACCOUNT_URLS = {
  xiaohongshu: "https://creator.xiaohongshu.com/new/home",
  douyin: "https://creator.douyin.com/creator-micro/home",
  bilibili: "https://member.bilibili.com/platform/home",
  wechat: "https://channels.weixin.qq.com/platform",
};
export async function readAccountIdentity(platform) {
  const body = document.body?.innerText || "", href = location.href;
  // The visible creator-home account number is distinct from an arbitrary post author.
  if (platform === "xiaohongshu") {
    const id = body.match(/小红书账号\s*[:：]\s*([^\s]+)/)?.[1];
    const name = document.querySelector(".account-name")?.textContent?.trim();
    if (id && name) return { state: "connected", id: `xhs-account:${id}`, name };
  }
  if (platform === "douyin") {
    // Only the authenticated creator-home profile identifies this account.
    // Do not alternate between a transient global uid and the visible handle.
    if (location.hostname === "creator.douyin.com" && /^\/creator-micro\/home\/?$/.test(location.pathname)) {
      const profiles = [...document.querySelectorAll('[class^="unique_id-"]')]
        .map(el => ({ id: el.textContent?.trim().match(/^抖音号\s*[:：]\s*([^\s]{1,80})$/)?.[1], name: el.parentElement?.querySelector('[class^="name-"]')?.textContent?.trim() }))
        .filter(profile => profile.id && profile.name);
      if (profiles.length === 1) return { state: "connected", id: `douyin-account:${profiles[0].id}`, name: profiles[0].name };
    }
    if (/passport|\/login(?:[/?]|$)|accounts\./i.test(href) || /扫码登录|请先登录|手机号登录|短信登录/.test(body)) return { state: "login-required" };
    return { state: "unverified", error: "页面已打开，尚未读取到可核验的账号信息，请稍后检查。" };
  }
  if (platform === "bilibili") {
    const answer = await fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" }).then(r => r.json()).catch(() => null);
    if (answer?.code === -101 || answer?.data?.isLogin === false) return { state: "login-required" };
    if (answer?.data?.isLogin && answer.data.mid) return { state: "connected", id: String(answer.data.mid), name: String(answer.data.uname || answer.data.mid) };
  }
  const roots = [window.__INITIAL_STATE__?.user?.userInfo, window.__INITIAL_STATE__?.userInfo, window.__INITIAL_SSR_STATE__?.userInfo, window.__INITIAL_SSR_STATE__?.user?.userInfo, window.__INITIAL_STATE__?.account?.userInfo, window.__USER_INFO__, window.userInfo];
  for (const candidate of roots) {
    const user = candidate?.value || candidate;
    const id = user?.userId ?? user?.user_id ?? user?.uid ?? user?.finderUsername;
    const name = user?.nickname ?? user?.nick_name ?? user?.name ?? user?.userName;
    if ((typeof id === "string" || typeof id === "number") && String(id).length > 1 && typeof name === "string" && name.trim()) return { state: "connected", id: String(id), name: name.trim() };
  }
  if (/passport|\/login(?:[/?]|$)|accounts\./i.test(href) || /扫码登录|请先登录|手机号登录|短信登录/.test(body)) return { state: "login-required" };
  return { state: "unverified", error: "页面已打开，尚未读取到可核验的账号信息，请稍后检查。" };
}
export function accountScript(platform, { login = false, expectedId = "", resumeSpace } = {}) {
  if (!ACCOUNT_URLS[platform]) throw new Error("Unsupported platform");
  if (resumeSpace !== undefined && (!Number.isSafeInteger(resumeSpace) || resumeSpace < 1)) throw new Error("Invalid browser space");
  return `const task = await ${resumeSpace ? `takeOverTaskSpace(${resumeSpace})` : `taskSpace(${JSON.stringify(`creator-${login ? "login" : "check"}-${platform}`)})`};
    const pages = await task.pages();
    if(!pages.length) throw new Error('Browser task has no managed page');
    const page = pages[0];
    await page.goto(${JSON.stringify(ACCOUNT_URLS[platform])},{waitUntil:'load',timeout:35000});
    const identify = ${readAccountIdentity.toString()};
    await page.waitForFunction(${platform === "bilibili" ? "() => Boolean(document.body?.innerText?.trim())" : `async () => (await (${readAccountIdentity.toString()})(${JSON.stringify(platform)})).state !== 'unverified'`},undefined,{timeout:12000}).catch(error=>{if(!/timeout/i.test(String(error?.message)))throw error;});
    const value = await page.evaluate(identify,${JSON.stringify(platform)});
    const result={platform:${JSON.stringify(platform)},checkedAt:Date.now(),...value${login ? ",spaceId:task.spaceId" : ""}};
    ${expectedId ? `if(result.state !== 'connected' || result.id !== ${JSON.stringify(expectedId)}) throw new Error('当前登录账号与任务账号不一致，请切回原账号');` : ""}
    console.log(${JSON.stringify(ACCOUNT_MARKER)}+JSON.stringify(result));
    ${login ? "await task.handOff();" : "await task.finish({keep:[]});"}`;
}
