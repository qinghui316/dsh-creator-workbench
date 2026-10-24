// Private compatibility boundary for the pinned publisher's pre-2.1 helper names.
// All actual browser calls use the installed Ego TaskSpace/Page public API.
export function installLegacyEgo(api) {
  let task, page, controlStop, foregroundPage;
  const current = () => { if (!task || !page) throw new Error("No owned browser page selected"); return page; };
  const owned = () => { if (!task) throw new Error("No owned task space selected"); return task; };
  const methods = {
    async useOrCreateTaskSpace(ref) {
      // A missing recorded space is a recovery blocker, never a reason to upload again.
      // taskSpace() may return a delegated handle whose pages() then hard-stops.
      // An explicitly resumed task must be taken over before accessing any page.
      const resumable = typeof ref === "number" && ref === api.resumeSpace && api.listTaskSpaces && (await api.listTaskSpaces()).find((entry) => entry.id === ref && entry.ownership === "agentDelegatedToUser");
      try { task = resumable ? await api.takeOverTaskSpace(ref) : await api.taskSpace(ref); }
      catch (error) {
        throw new Error(`Browser task unavailable; resume requires user confirmation: ${String(error?.message || error)}`);
      }
      const pages = await task.pages();
      if (!pages.length) throw new Error("Browser task has no managed page; user confirmation required");
      page = pages[0];
      foregroundPage = undefined;
      return { id: task.spaceId, name: task.name, ownership: task.ownership };
    },
    listTabs: async () => (await owned().tabs()).map(({ targetId, label, url, title }) => ({ targetId, label, url, title })),
    async switchTab(targetId) {
      const tab = (await owned().tabs()).find((entry) => entry.targetId === targetId);
      if (!tab?.label) throw new Error("Cannot operate an unmanaged browser tab");
      page = task.page(tab.label);
      foregroundPage = undefined;
    },
    async openOrReuseTab(url, options = {}) {
      const match = (await owned().tabs()).find((entry) => entry.label && entry.url === url);
      if (match) page = task.page(match.label);
      else { await current().goto(url, { timeout: (options.timeout ?? 35) * 1000, waitUntil: options.wait === false ? "commit" : "domcontentloaded" }); foregroundPage = undefined; }
      return { targetId: page.targetId, label: page.label, url: await page.url() };
    },
    async gotoAndWait(url, options = {}) { await current().goto(url, { timeout: (options.timeout ?? 35) * 1000, waitUntil: "domcontentloaded" }); foregroundPage = undefined; },
    async pageInfo() {
      const info = await current().info();
      return { ...info, w: info.viewport?.width ?? info.width ?? info.w, h: info.viewport?.height ?? info.height ?? info.h };
    },
    js: (expression) => current().evaluate(expression),
    async cdp(method, params = {}) {
      if (/^(Target|Browser)\./.test(method)) return owned().cdp(method, params);
      const selected = current();
      if (method === "Page.bringToFront" && foregroundPage === selected) return {};
      const result = await selected.cdp(method, params);
      if (method === "Page.bringToFront") foregroundPage = selected;
      return result;
    },
    click: (selector, options = {}) => Array.isArray(selector) ? current().mouse.click(selector[0], selector[1], options) : current().click(selector, options),
    hover: (selector, options = {}) => current().hover(selector, options),
    pressKey: (key) => current().keyboard.press(key),
    wait: (seconds) => current().waitForTimeout(seconds * 1000),
    async scroll({ dx = 0, dy = 0 }) {
      const info = await current().info();
      await current().mouse.move(Math.max(1, (info.viewport?.width ?? 400) / 2), Math.max(1, (info.viewport?.height ?? 400) / 2));
      await current().mouse.wheel(dx, dy, { label: "scroll creator content list" });
    },
    cliLog: (...args) => api.log(...args),
    async completeTaskSpace(id, { keep = false } = {}) {
      if (owned().spaceId !== id) throw new Error("Cannot finish another browser task");
      const receipt = await task.finish({ keep: keep ? "all" : [] });
      task = page = undefined;
      return receipt;
    },
  };
  return Object.fromEntries(Object.entries(methods).map(([name, action]) => [name, async (...args) => {
    if (controlStop) throw controlStop;
    try { return await action(...args); }
    catch (error) {
      if (/USER_CONTROL|user (?:now controls|took control|has taken control)|not assigned to an agent|task space.*inactive|browser permission prompt/i.test(String(error?.message || error))) controlStop = error;
      throw error;
    }
  }]));
}

export function legacyEgoPrelude({ resumeSpace } = {}) {
  if (resumeSpace !== undefined && (!Number.isSafeInteger(resumeSpace) || resumeSpace < 1)) throw new Error("Invalid resume space");
  return `const {useOrCreateTaskSpace,listTabs,switchTab,openOrReuseTab,gotoAndWait,pageInfo,js,cdp,click,hover,pressKey,wait,scroll,cliLog,completeTaskSpace}=(${installLegacyEgo.toString()})({taskSpace,listTaskSpaces,takeOverTaskSpace,resumeSpace:${JSON.stringify(resumeSpace)},log:(...args)=>console.log(...args)});\n`;
}

/** Preserve any pre-existing Douyin editor instead of the upstream discard path. */
export function protectPublisherDrafts(platform, script) {
  if (platform !== "douyin" || !script.includes("const douyinTitle =")) return script;
  const entry = "async function discardDouyinResumeDialog(before) {";
  if (script.split(entry).length !== 2) throw new Error("Pinned Douyin draft guard no longer matches");
  return `async function discardDouyinResumeDialog(before){if(!before?.gates?.video?.evidence?.resumeDialog)return {ok:true,skipped:true};return {ok:false,reason:'检测到未确认来源的旧草稿，已保留现场；请先核对后继续。'};}\n${script.replace(entry, "async function unusedUpstreamDiscardDouyinResumeDialog(before) {")}`;
}
