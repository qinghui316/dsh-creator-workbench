import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const compat = await import(pathToFileURL(resolve("scripts/ego-compat.mjs")).href);
const accounts = await import(pathToFileURL(resolve("scripts/ego-account.mjs")).href);
function fixture() {
  const page = { label: "p1", targetId: "owned", goto: vi.fn(), url: vi.fn(async () => "https://example.com/"), evaluate: vi.fn(), cdp: vi.fn(), click: vi.fn(), hover: vi.fn(), waitForTimeout: vi.fn(), keyboard: { press: vi.fn() }, mouse: { click: vi.fn(), move: vi.fn(), wheel: vi.fn() }, info: vi.fn(async () => ({ w: 520, h: 800 })) };
  const task = { spaceId: 7, name: "owned-task", ownership: "agent", pages: vi.fn(async () => [page]), tabs: vi.fn(async () => [{ label: "p1", targetId: "owned", url: "https://example.com/" }, { targetId: "user", url: "https://private.example/" }]), page: vi.fn(() => page), cdp: vi.fn(), finish: vi.fn() };
  const api = { taskSpace: vi.fn(async () => task), log: vi.fn() };
  return { page, task, api, legacy: compat.installLegacyEgo(api) };
}
describe("Ego 2.1 compatibility boundary", () => {
  it("translates legacy seconds to milliseconds and routes CDP to the selected owned page", async () => {
    const { page, task, legacy } = fixture();
    expect(await legacy.useOrCreateTaskSpace(7)).toMatchObject({ id: 7, name: "owned-task" });
    await legacy.gotoAndWait("https://example.com/next", { timeout: 40 });
    expect(page.goto).toHaveBeenCalledWith("https://example.com/next", { timeout: 40000, waitUntil: "domcontentloaded" });
    await legacy.cdp("Runtime.evaluate", { expression: "1" });
    await legacy.cdp("Target.getTargets", {});
    expect(page.cdp).toHaveBeenCalledWith("Runtime.evaluate", { expression: "1" });
    expect(task.cdp).toHaveBeenCalledWith("Target.getTargets", {});
    expect(await legacy.pageInfo()).toMatchObject({ w: 520, h: 800 });
    await legacy.hover("#cover", { label: "reveal cover options" });
    expect(page.hover).toHaveBeenCalledWith("#cover", { label: "reveal cover options" });
  });
  it("does not recreate missing spaces or operate unmanaged tabs", async () => {
    const { api, task, legacy } = fixture();
    api.taskSpace.mockRejectedValueOnce(new Error("task space not found"));
    await expect(legacy.useOrCreateTaskSpace(7)).rejects.toThrow("user confirmation");
    expect(api.taskSpace).toHaveBeenCalledTimes(1);
    await legacy.useOrCreateTaskSpace(7);
    await expect(legacy.switchTab("user")).rejects.toThrow("unmanaged");
    expect(task.page).not.toHaveBeenCalled();
    await expect(legacy.completeTaskSpace(8)).rejects.toThrow("another");
    expect(task.finish).not.toHaveBeenCalled();
  });
  it("coalesces repeated foreground calls but keeps real input and navigation actions", async () => {
    const {page,legacy}=fixture();await legacy.useOrCreateTaskSpace(7);
    await legacy.cdp("Page.bringToFront",{});await legacy.cdp("Page.bringToFront",{});
    expect(page.cdp).toHaveBeenCalledTimes(1);
    await legacy.cdp("Input.insertText",{text:"a"});await legacy.cdp("Input.insertText",{text:"b"});
    expect(page.cdp).toHaveBeenCalledTimes(3);
    await legacy.gotoAndWait("https://example.com/next");await legacy.cdp("Page.bringToFront",{});
    expect(page.cdp).toHaveBeenCalledTimes(4);
  });
  it("propagates user control without retry or a fresh task", async () => {
    const { page, api, legacy } = fixture();
    await legacy.useOrCreateTaskSpace(7);
    page.click.mockRejectedValue(new Error("user took control"));
    await expect(legacy.click("button")).rejects.toThrow("user took control");
    expect(page.click).toHaveBeenCalledTimes(1);
    expect(api.taskSpace).toHaveBeenCalledTimes(1);
  });
  it("makes no further browser calls after a caught control stop within a publisher round", async () => {
    const {page,legacy}=fixture();await legacy.useOrCreateTaskSpace(7);
    page.click.mockRejectedValue(new Error("A browser permission prompt has appeared; user now controls this task space"));
    await legacy.click("#cover").catch(()=>{});
    await expect(legacy.js("document.body.innerText")).rejects.toThrow("user now controls");
    await expect(legacy.hover("#cover")).rejects.toThrow("user now controls");
    expect(page.evaluate).not.toHaveBeenCalled();expect(page.hover).not.toHaveBeenCalled();
    expect(page.click).toHaveBeenCalledOnce();
  });
  it("resumes only the explicitly authorized handed-off upload space", async () => {
    const { task, api } = fixture();
    api.taskSpace.mockRejectedValue(new Error("user controls the space"));
    const listTaskSpaces = vi.fn(async () => [{ id: 7, ownership: "agentDelegatedToUser" }]);
    const takeOverTaskSpace = vi.fn(async () => task);
    const legacy = compat.installLegacyEgo({ ...api, listTaskSpaces, takeOverTaskSpace, resumeSpace: 7 });
    expect((await legacy.useOrCreateTaskSpace(7)).id).toBe(7);
    expect(takeOverTaskSpace).toHaveBeenCalledWith(7);
    expect(api.taskSpace).not.toHaveBeenCalled();
    await expect(legacy.useOrCreateTaskSpace(8)).rejects.toThrow("user confirmation");
    expect(takeOverTaskSpace).toHaveBeenCalledTimes(1);
  });
  it("generated account programs execute on current API and only explicitly resume a handed-off space", async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const page = { goto: vi.fn(), waitForFunction: vi.fn(async (..._args: unknown[]) => true), evaluate: vi.fn(async () => ({ state: "connected", id: "account-1", name: "Tester" })) };
    const task = { spaceId: 7, pages: vi.fn(async () => [page]), handOff: vi.fn(), finish: vi.fn() };
    const taskSpace = vi.fn(async () => task), takeOver = vi.fn(async () => task), log = vi.fn();
    await new AsyncFunction("taskSpace", "takeOverTaskSpace", "console", accounts.accountScript("xiaohongshu", { login: true }))(taskSpace, takeOver, { log });
    expect(typeof page.waitForFunction.mock.calls[0]?.[0]).toBe("function");
    expect(task.handOff).toHaveBeenCalledOnce(); expect(task.finish).not.toHaveBeenCalled(); expect(takeOver).not.toHaveBeenCalled();
    await new AsyncFunction("taskSpace", "takeOverTaskSpace", "console", accounts.accountScript("xiaohongshu", { resumeSpace: 7 }))(taskSpace, takeOver, { log });
    expect(takeOver).toHaveBeenCalledWith(7); expect(task.finish).toHaveBeenCalledWith({ keep: [] });
    expect(log.mock.calls[0]?.[0]).toContain('"spaceId":7');
  });
  it("blocks the upstream Douyin discard path while preserving an existing editor", async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor, discard = vi.fn();
    const source = "const douyinTitle = 'test'; async function discardDouyinResumeDialog(before) {discard();return {ok:true};} return await discardDouyinResumeDialog(before);";
    const run = new AsyncFunction("discard", "before", compat.protectPublisherDrafts("douyin", source));
    const result = await run(discard, { gates: { video: { evidence: { resumeDialog: true } } } });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("保留现场") });
    expect(await run(discard, { gates: { video: { evidence: { resumeDialog: false } } } })).toEqual({ ok: true, skipped: true });
    expect(discard).not.toHaveBeenCalled();
    expect(() => compat.protectPublisherDrafts("douyin", "const douyinTitle = 'changed';")).toThrow("no longer matches");
  });
});
