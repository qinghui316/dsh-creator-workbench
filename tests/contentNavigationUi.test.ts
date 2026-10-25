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
import type { ProductionClient } from "../src/client/productionApi.ts";
vi.mock("../src/client/ProductionPanel.tsx", () => ({ ProductionPanel: ({ onPublish }: { onPublish?: (platform: string, status: string) => void }) => h("button", { onClick: () => onPublish?.("bilibili", "draft") }, "标为草稿") }));
vi.mock("../src/client/PublicationPanel.tsx", () => ({ PublicationPanel: ({ onPublish }: { onPublish?: (platform: string, status: string) => void }) => h("button", { onClick: () => onPublish?.("bilibili", "draft") }, "标为草稿") }));
vi.mock("../src/client/VideoPanel.tsx", () => ({
  VideoPanel: () => h("div", null, "视频区域"),
}));
vi.mock("../src/client/CoverPanel.tsx", () => ({
  CoverPanel: () => h("div", null, "封面区域"),
}));
vi.mock("../src/client/SubtitlePanel.tsx", () => ({
  SubtitlePanel: () => h("p", {role:"alert"}, "当前视频没有音轨，无法转写。"),
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
    videoRaw: "E:/一期/video.mp4",
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
  it("shows the production ASR error once while preserving independent burn feedback", async () => {
    const {face,detail}=fixture();detail.subtitleJob={status:"error",error:"当前视频没有音轨，无法转写。"};
    detail.burn={status:"error",error:"字幕烧录失败，请检查输出目录"};
    setSelectedContentId("one");render(h(ContentInspector,{...face,production:{} as ProductionClient,t:(key:CreatorKey)=>zh[key]}));
    await screen.findByText("测试内容");fireEvent.click(screen.getByRole("tab",{name:"字幕"}));
    expect(screen.getAllByText("当前视频没有音轨，无法转写。")).toHaveLength(1);
    expect(screen.getByText("字幕烧录失败，请检查输出目录")).toBeTruthy();
  });
  it("retains legacy ASR feedback when the production adapter is absent", async () => {
    const {face,detail}=fixture();detail.subtitleJob={status:"error",error:"旧转写服务未配置"};
    setSelectedContentId("one");render(h(ContentInspector,{...face,t:(key:CreatorKey)=>zh[key]}));
    await screen.findByText("测试内容");fireEvent.click(screen.getByRole("tab",{name:"字幕"}));
    expect(screen.getByText("旧转写服务未配置")).toBeTruthy();
  });
  it("distinguishes preparing an Agent script request from saving the script", async () => {
    const { face } = fixture(); let complete!: () => void;
    const prepareRequest = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    setSelectedContentId("one");
    render(h(ContentInspector, { ...face, production: { prepareRequest } as unknown as ProductionClient, t: (key: CreatorKey) => zh[key] }));
    await screen.findByText("测试内容"); fireEvent.click(screen.getByRole("tab", { name: "脚本" }));
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 修改脚本" }));
    expect((screen.getByRole("button", { name: "正在准备请求…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => complete()); await screen.findByText("请求已放入左侧对话，请发送。");
    expect(screen.getByText("已保存")).toBeTruthy(); expect((screen.getByLabelText("脚本正文") as HTMLTextAreaElement).value).toBe("已有脚本");
  });
  it("keeps original tab order and appends images/publishing with summary-only overview", async () => {
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
      "图片",
      "发布",
    ]);
    expect(screen.queryByText("视频区域")).toBeNull();
    expect(screen.queryByText("封面区域")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "视频" }));
    expect(screen.getByText("视频区域")).toBeTruthy();
    expect(screen.queryByText("封面区域")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "图片" }));
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
    fireEvent.click(screen.getByRole("tab", {name:"视频"}));
    const video = screen.getByText("视频区域");
    const before = vi.mocked(face.getSettings).mock.calls.length;
    await act(async () => { bumpLibrary(); });
    await waitFor(() => expect(vi.mocked(face.getContent).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("视频区域")).toBe(video);
    expect(face.getSettings).toHaveBeenCalledTimes(before);
  });

  it("drops an old publish failure while the newly selected project is still loading", async () => {
    const { face, detail } = fixture(); detail.videoRaw = "E:/一期/video.mp4";
    let reject!: (error: Error) => void, loaded!: (value: ContentDetail) => void;
    const publish = vi.fn(() => new Promise<ContentDetail>((_resolve, fail) => { reject = fail; }));
    Object.assign(face, { setPublish: publish, production: {} });
    vi.mocked(face.getContent).mockImplementation(async (id) => id === "two" ? new Promise((resolve) => { loaded = resolve; }) : detail);
    setSelectedContentId("one"); render(h(ContentInspector, { ...face, t: (key: CreatorKey) => zh[key] }));
    await screen.findByText("测试内容"); fireEvent.click(screen.getByRole("tab", {name:"发布"}));
    fireEvent.click(await screen.findByRole("button", { name: "标为草稿" }));
    await act(async () => { setSelectedContentId("two"); });
    await waitFor(() => expect(loaded).toBeTypeOf("function"));
    await act(async () => { reject(new Error("第一期状态保存失败")); });
    expect(screen.queryByText("第一期状态保存失败")).toBeNull();
    await act(async () => { loaded({ ...detail, id: "two", folderPath: "E:/二期", title: "第二期" }); });
    await screen.findByText("第二期"); expect(screen.queryByText("第一期状态保存失败")).toBeNull();
  });

});
