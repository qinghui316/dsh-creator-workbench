// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
const adapter = await import(pathToFileURL(resolve("scripts/publisher-xhs-details.mjs")).href);
const expected = { taskId: "owned-task", videoName: "成片.mp4", title: "标题", description: "视频介绍，保留真实话题。" };
function fixture(prose = "") {
  document.body.innerHTML = '<div>成片.mp4</div><input placeholder="填写标题会有更多赞哦"><div contenteditable="true"></div>';
  document.querySelector("input")!.value = expected.title;
  const editor = document.querySelector<HTMLDivElement>("[contenteditable]")!;
  editor.append(document.createTextNode(prose));
  const topic = document.createElement("a"); topic.textContent = "#测试[话题]#"; topic.dataset.topic = '{"name":"测试"}'; editor.append(topic);
  vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ width: 500, height: 160 } as DOMRect);
  const page = {
    evaluate: async (fn: (input?: unknown) => unknown, input?: unknown) => fn(input),
    keyboard: { insertText: vi.fn(async (text: string) => { const range = window.getSelection()!.getRangeAt(0); range.insertNode(document.createTextNode(text)); }) },
  };
  const task = { pages: async () => [page] }, log = vi.fn();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = async (mutate: boolean) => {
    await new AsyncFunction("listTaskSpaces", "taskSpace", "takeOverTaskSpace", "console", adapter.xhsDetailsScript(expected, { spaceId: 6, mutate }))(
      async () => [{ id: 6, name: "publisher owned-task", ownership: "agent" }], async () => task, vi.fn(), { log },
    );
    return JSON.parse(log.mock.calls.at(-1)![0].slice(adapter.XHS_DETAILS_MARKER.length));
  };
  return { editor, topic, page, run };
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
describe("Xiaohongshu prose completion", () => {
  it("inserts missing prose once, preserving native topic nodes and exact source identity", async () => {
    const { editor, topic, page, run } = fixture();
    expect((await run(false)).ready).toBe(false);
    expect((await run(true)).ready).toBe(true);
    expect(editor.querySelector("a")).toBe(topic);
    expect((await run(true)).ready).toBe(true);
    expect(page.keyboard.insertText).toHaveBeenCalledOnce();
  });
  it("does not overwrite an edited description or write into a different video draft", async () => {
    const { editor, page, run } = fixture("用户修改的正文");
    expect((await run(true)).ready).toBe(false);
    expect(editor.textContent).toContain("用户修改的正文");
    document.querySelector("input")!.value = "另一草稿";
    expect((await run(true)).sameDraft).toBe(false);
    expect(page.keyboard.insertText).not.toHaveBeenCalled();
  });
});
