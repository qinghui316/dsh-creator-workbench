// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ContentInspector } from "../src/client/ContentInspector.tsx";
import { bumpLibrary } from "../src/client/contentSelection.ts";
import { setSelectedContentId } from "../src/client/contentSelection.ts";
import { zh, type CreatorKey } from "../src/client/locales.ts";
import type { CreatorViewFace } from "../src/client/face.ts";
import type { ContentDetail } from "../src/types.ts";
vi.mock("../src/client/ProductionPanel.tsx", () => ({ ProductionPanel: ({ onPublish }: { onPublish?: (platform: string, status: string) => void }) => h("button", { onClick: () => onPublish?.("bilibili", "draft") }, "标为草稿") }));
vi.mock("../src/client/VideoPanel.tsx", () => ({
  VideoPanel: () => h("div", null, "视频区域"),
}));
vi.mock("../src/client/CoverPanel.tsx", () => ({
  CoverPanel: () => h("div", null, "封面区域"),
}));
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
  Button: ({ children, variant, size, ...props }: Record<string, unknown>) =>
    h("button", props, children as never),
  Pill: ({ children }: { children: import("react").ReactNode }) =>
    h("span", null, children),
  IconCloseOutlineRegular: () => null,
  IconFolderOpenOutlineRegular: () => null,
  StateDot: () => null,
  Menu: () => null,
  MarkdownText: ({ text }: { text: string }) => h("article", null, text),
}));
afterEach(() => {
  cleanup();
  setSelectedContentId(null);
});
function fixture() {
  const detail = {
    id: "one",
    folderPath: "E:/一期",
    title: "测试内容",
    recordedAt: 1,
    createdMs: 1,
    covers: {},
    subtitles: {},
    hasPublishPackage: false,
    hasArticle: false,
    tags: [],
    pipeline: "raw",
    workflow: "idle",
    publish: Object.fromEntries(
      ["douyin", "bilibili", "wechat", "xiaohongshu"].map((key) => [
        key,
        { status: "unpublished", source: "none" },
      ]),
    ) as ContentDetail["publish"],
    burn: { status: "idle" },
    subtitleJob: { status: "idle" },
    coverJob: { status: "idle" },
    publishCopy: "",
    topicNote: "",
    script: "已有脚本",
    article: "",
    secrets: {
      cover: { kind: "cover", ref: "image", configured: false, writable: true },
      subtitle: {
        kind: "subtitle",
        ref: "subtitle",
        configured: false,
        writable: true,
      },
    },
  } as ContentDetail;
  const face = {
    ready: () => true,
    getContent: vi.fn().mockResolvedValue(detail),
    getSubtitleText: vi.fn().mockResolvedValue({ text: "", cues: [] }),
    getSettings: vi
      .fn()
      .mockResolvedValue({ profile: { enabledPlatforms: [] } }),
    getArticleMedia: vi.fn().mockResolvedValue({ found: false }),
    setScript: vi.fn(async (_id, text) => ({ ...detail, script: text })),
  };
  return {
    face: face as unknown as CreatorViewFace,
    detail,
    save: face.setScript,
  };
}
describe("original content navigation", () => {
  it("keeps the five named tabs in their original order with original overview/video locations", async () => {
    const { face } = fixture();
    setSelectedContentId("one");
    render(h(ContentInspector, { ...face, t: (key: CreatorKey) => zh[key] }));
    await screen.findByText("测试内容");
    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual([
      "概览",
      "视频",
      "脚本",
      "字幕",
      "文章",
    ]);
    expect(screen.getByText("视频区域")).toBeTruthy();
    expect(screen.getByText("封面区域")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "视频" }));
    expect(screen.getByText("封面区域")).toBeTruthy();
  });
  it("keeps a failed script draft while changing tabs and can retry the original autosave", async () => {
    const { face, save } = fixture();
    save.mockRejectedValueOnce(new Error("磁盘暂不可写"));
    setSelectedContentId("one");
    render(h(ContentInspector, { ...face, t: (key: CreatorKey) => zh[key] }));
    await screen.findByText("测试内容");
    fireEvent.click(screen.getByRole("tab", { name: "脚本" }));
    fireEvent.change(screen.getByLabelText("脚本正文"), {
      target: { value: "需要保留的正文" },
    });
    expect(screen.getByText("保存中…")).toBeTruthy();
    await screen.findByText("保存失败：磁盘暂不可写", {}, { timeout: 2000 });
    fireEvent.click(screen.getByRole("tab", { name: "字幕" }));
    fireEvent.click(screen.getByRole("tab", { name: "脚本" }));
    expect(
      (screen.getByLabelText("脚本正文") as HTMLTextAreaElement).value,
    ).toBe("需要保留的正文");
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy(), {
      timeout: 2000,
    });
    expect(save).toHaveBeenLastCalledWith("one", "需要保留的正文", "E:/一期");
  });
  it("retains mounted business content and configuration during a background refresh", async () => {
    const { face } = fixture(); setSelectedContentId("one");
    render(h(ContentInspector, { ...face, t: (key: CreatorKey) => zh[key] }));
    await screen.findByText("测试内容");
    const video = screen.getByText("视频区域"), covers = screen.getByText("封面区域");
    const before = vi.mocked(face.getSettings).mock.calls.length;
    await act(async () => { bumpLibrary(); });
    await waitFor(() => expect(face.getContent).toHaveBeenCalledTimes(2));
    expect(screen.getByText("视频区域")).toBe(video); expect(screen.getByText("封面区域")).toBe(covers);
    expect(face.getSettings).toHaveBeenCalledTimes(before);
  });

  it("drops an old publish failure while the newly selected project is still loading", async () => {
    const { face, detail } = fixture(); detail.videoRaw = "E:/一期/video.mp4";
    let reject!: (error: Error) => void, loaded!: (value: ContentDetail) => void;
    const publish = vi.fn(() => new Promise<ContentDetail>((_resolve, fail) => { reject = fail; }));
    Object.assign(face, { setPublish: publish, production: {} });
    vi.mocked(face.getContent).mockImplementation(async (id) => id === "two" ? new Promise((resolve) => { loaded = resolve; }) : detail);
    setSelectedContentId("one"); render(h(ContentInspector, { ...face, t: (key: CreatorKey) => zh[key] }));
    fireEvent.click(await screen.findByRole("button", { name: "标为草稿" }));
    await act(async () => { setSelectedContentId("two"); });
    await waitFor(() => expect(loaded).toBeTypeOf("function"));
    await act(async () => { reject(new Error("第一期状态保存失败")); });
    expect(screen.queryByText("第一期状态保存失败")).toBeNull();
    await act(async () => { loaded({ ...detail, id: "two", folderPath: "E:/二期", title: "第二期" }); });
    await screen.findByText("第二期"); expect(screen.queryByText("第一期状态保存失败")).toBeNull();
  });

});
