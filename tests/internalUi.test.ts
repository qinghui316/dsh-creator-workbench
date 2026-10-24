// @vitest-environment jsdom
import { createElement as h, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import type { ContentDetail, LibrarySettings } from "../src/types.ts";
import {
  CreatorSettingsCard,
  type CreatorSettingsHandle,
} from "../src/client/CreatorSettingsCard.tsx";
import { VideoPanel } from "../src/client/VideoPanel.tsx";
import { CoverPanel } from "../src/client/CoverPanel.tsx";
import { zh, type CreatorKey } from "../src/client/locales.ts";
import { IMAGE_CREDENTIAL, COVER_RATIOS, type CoverState } from "../src/covers/types.ts";

vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
  Button: ({ children, variant, size, ...props }: Record<string, unknown>) =>
    h("button", props, children as never),
}));
const t = (key: CreatorKey) => zh[key];
const general: LibrarySettings = {
  libraryRoot: "E:/资料 库",
  profile: { enabledPlatforms: [] },
  scriptRules: "",
  secrets: {
    cover: {
      kind: "cover",
      ref: IMAGE_CREDENTIAL,
      configured: true,
      writable: true,
    },
    subtitle: {
      kind: "subtitle",
      ref: "subtitle-key",
      configured: false,
      writable: true,
    },
  },
};
function fixture() {
  let current = {
    apiBase: "https://old.example/v1",
    model: "old-model",
    revision: "r1",
  };
  const face = {
    ready: () => true,
    t,
    getSettings: vi.fn().mockResolvedValue(general),
    getImageSettings: vi.fn().mockResolvedValue(current),
    setImageSettings: vi.fn(),
    beginImageUpdate: vi.fn(async (input) => ({
      ...current,
      revision: "r2",
      pending: {
        token: "t1",
        apiBase: input.apiBase,
        model: input.model,
        needsKey: input.hasNewKey,
      },
    })),
    completeImageUpdate: vi.fn(
      async () =>
        (current = {
          apiBase: "https://old.example/v1",
          model: "new-model",
          revision: "r3",
        }),
    ),
    checkImageService: vi.fn(),
    setLibraryRoot: vi.fn().mockResolvedValue(undefined),
    setProfile: vi.fn().mockResolvedValue(undefined),
    setScriptRules: vi.fn().mockResolvedValue(undefined),
    pickDirectory: vi.fn().mockResolvedValue(null),
    getCapabilities: vi.fn().mockResolvedValue({}),
  };
  const credentials = {
    describe: vi.fn().mockResolvedValue({
      result: {
        ok: true,
        value: {
          credentials: {
            [IMAGE_CREDENTIAL]: { configured: true, writable: true },
            "subtitle-key": { configured: false, writable: true },
          },
        },
      },
    }),
    set: vi.fn().mockResolvedValue({ result: { ok: true } }),
  };
  return { face, credentials };
}
const detail = {
  id: "一期",
  title: "真实中文长标题 English creator workflow",
  folderPath: "E:/资料/一期",
  selectedVideo: "原始.MP4",
  videoSelection: "selected",
  videos: [
    {
      name: "原始.MP4",
      size: 1234,
      modifiedAt: 1,
      path: "E:/资料/一期/原始.MP4",
    },
  ],
  hiddenVideos: [],
  recordedAt: 1,
  createdMs: 1,
  covers: {},
  subtitles: {},
  hasPublishPackage: false,
  hasArticle: false,
  tags: [],
  pipeline: "raw",
  workflow: "finish",
  publish: {} as ContentDetail["publish"],
  burn: { status: "idle" },
  subtitleJob: { status: "idle" },
  coverJob: { status: "idle" },
  publishCopy: "",
  topicNote: "",
  script: "",
  article: "",
  secrets: general.secrets,
} satisfies ContentDetail;
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("settings form", () => {
  it("saves a model edit once while preserving the blank saved key", async () => {
    const f = fixture();
    render(h(CreatorSettingsCard, { ...f.face, credentials: f.credentials }));
    const model = await screen.findByLabelText("生图模型");
    fireEvent.change(model, { target: { value: "new-model" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("status");
    expect(f.credentials.set).not.toHaveBeenCalled();
    expect(f.face.completeImageUpdate).toHaveBeenCalledExactlyOnceWith({
      token: "t1",
      keyUpdated: false,
    });
  });
  it("requires a new key for a changed service origin before changing settings", async () => {
    const f = fixture();
    render(h(CreatorSettingsCard, { ...f.face, credentials: f.credentials }));
    const address = await screen.findByLabelText("服务地址");
    fireEvent.change(address, { target: { value: "https://new.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText("服务来源已改变，请填写对应服务的新 Key。"),
    ).toBeTruthy();
    expect(f.face.beginImageUpdate).not.toHaveBeenCalled();
  });
  it("retains all input on a key failure and redacts credential transport errors", async () => {
    const f = fixture();
    f.credentials.set.mockRejectedValue(new Error("fixture-secret"));
    render(h(CreatorSettingsCard, { ...f.face, credentials: f.credentials }));
    const key = await screen.findByLabelText(/API Key/);
    fireEvent.change(key, { target: { value: "fixture-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "设置更新未完成",
    );
    expect((key as HTMLInputElement).value).toBe("fixture-secret");
    expect(screen.getByRole("alert").textContent).not.toContain(
      "fixture-secret",
    );
    expect(f.face.completeImageUpdate).not.toHaveBeenCalled();
  });
  it("shows load failures instead of editable blank defaults and retries", async () => {
    const f = fixture();
    f.face.getSettings.mockRejectedValueOnce(new Error("offline"));
    render(h(CreatorSettingsCard, { ...f.face, credentials: f.credentials }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText("服务地址")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(await screen.findByLabelText("服务地址")).toBeTruthy();
  });
  it("protects unsaved fields when leaving, and can continue editing or discard", async () => {
    const f = fixture(),
      ref = createRef<CreatorSettingsHandle>(),
      close = vi.fn();
    render(
      h(CreatorSettingsCard, {
        ...f.face,
        credentials: f.credentials,
        ref,
        onClose: close,
      }),
    );
    (await screen.findByLabelText("生图模型")).focus();
    fireEvent.change(screen.getByLabelText("生图模型"), {
      target: { value: "draft" },
    });
    act(() => ref.current!.requestClose());
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(document.activeElement).toBe(screen.getByLabelText("生图模型"));
    expect((screen.getByLabelText("生图模型") as HTMLInputElement).value).toBe(
      "draft",
    );
    act(() => ref.current!.requestClose());
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("shows partial saving accurately while retaining the unsaved general fields", async () => {
    const f = fixture();
    f.face.setScriptRules.mockRejectedValue(new Error("偏好保存失败"));
    render(h(CreatorSettingsCard, { ...f.face, credentials: f.credentials }));
    fireEvent.change(await screen.findByLabelText("生图模型"), {
      target: { value: "new-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "常规" }));
    fireEvent.change(screen.getByLabelText("写稿偏好"), {
      target: { value: "未保存的偏好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "部分设置已保存；偏好保存失败",
    );
    expect(
      (screen.getByLabelText("写稿偏好") as HTMLTextAreaElement).value,
    ).toBe("未保存的偏好");
  });
  it("allows a new credential when the host describes an absent reference", async () => {
    const f = fixture();
    f.credentials.describe.mockResolvedValue({
      result: { ok: true, value: { credentials: {} } },
    } as never);
    render(h(CreatorSettingsCard, { ...f.face, credentials: f.credentials }));
    const key = await screen.findByLabelText(/API Key/);
    expect((key as HTMLInputElement).disabled).toBe(false);
  });
});
describe("connection feedback", () => {
  it("shows checking independently from saving and keeps duplicate requests disabled", async () => {
    const f = fixture();
    let done!: (value: unknown) => void;
    f.face.checkImageService.mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    render(h(CreatorSettingsCard, { ...f.face, credentials: f.credentials }));
    await screen.findByLabelText("生图模型");
    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
    expect(screen.getByRole("button", { name: "正在检查…" })).toBeTruthy();
    expect(screen.queryByText("正在保存…")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () =>
      done({
        apiBase: "https://old.example/v1",
        model: "old-model",
        revision: "r1",
      }),
    );
    expect(screen.getByRole("button", { name: "检查连接" })).toBeTruthy();
  });
});
describe("video confirmation", () => {
  it("keeps file choice separate from confirmation and supports cancel", async () => {
    const start = vi
      .fn()
      .mockResolvedValue({ token: "done", status: "completed" });
    Object.assign(globalThis, {
      __DSH_HOST_PATHS__: { pathFor: () => "E:/导出/video.MP4" },
    });
    render(
      h(VideoPanel, {
        detail,
        t,
        startVideoImport: start,
        getVideoImport: vi.fn(),
        cancelVideoImport: vi.fn(),
        getVideoPlayback: vi.fn().mockResolvedValue({ found: false }),
        selectVideo: vi.fn(),
        setVideoVisibility: vi.fn(),
      }),
    );
    const input = screen.getByLabelText("选择导入视频");
    fireEvent.change(input, {
      target: { files: [new File(["v"], "video.MP4")] },
    });
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText("待导入：video.MP4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("button", { name: "确认导入" })).toBeNull();
    fireEvent.change(input, {
      target: { files: [new File(["v"], "video.MP4")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledExactlyOnceWith(
        detail.id,
        "E:/导出/video.MP4",
        "video.MP4",
        detail.folderPath,
      ),
    );
  });
  it("removes the current video through the visibility contract and keeps removed rows out of the interface", async () => {
    const visibility = vi.fn().mockResolvedValue(detail);
    render(
      h(VideoPanel, {
        detail,
        t,
        startVideoImport: vi.fn(),
        getVideoImport: vi.fn(),
        cancelVideoImport: vi.fn(),
        getVideoPlayback: vi
          .fn()
          .mockResolvedValue({ found: true, url: "http://localhost/video" }),
        selectVideo: vi.fn(),
        setVideoVisibility: visibility,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "从列表移除" }));
    await waitFor(() => expect(visibility).toHaveBeenCalledOnce());
    expect(visibility).toHaveBeenCalledWith(
      detail.id,
      "原始.MP4",
      detail.folderPath,
      true,
    );
    expect(document.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
    expect(screen.queryByText(/已移除视频/)).toBeNull();
  });
});
describe("cover previews", () => {
  it("retains three ratios and uses explicit selection inside the business panel", async () => {
    const version = {
      id: "ui-version-a",
      ratio: "3x4",
      file: "cover.png",
      mime: "image/png",
      createdAt: 1,
      source: "import",
      review: "pass",
      width: 240,
      height: 320,
    } as const;
    const state = {
      versions: [version],
      selected: { "3x4": version.id },
      runs: [],
    } as CoverState;
    const action = vi.fn().mockResolvedValue(state);
    render(
      h(CoverPanel, {
        detail,
        getCoverState: vi.fn().mockResolvedValue(state),
        coverAction: action,
        getCoverImage: vi
          .fn()
          .mockResolvedValue({ mime: "image/png", base64: "AA==" }),
        prepareCoverDraft: vi.fn(),
      }),
    );
    const thumb = await screen.findByRole("button", { name: "预览 3:4 封面" });
    thumb.focus();
    fireEvent.click(thumb);
    expect(
      await screen.findByRole("region", { name: "3:4 封面预览" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "当前选用" })).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("region", { name: "3:4 封面预览" }), {
      key: "Escape",
    });
    expect(await screen.findByText("16:9")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "预览 3:4 封面" }),
    );
  });
  it("shows asset readiness without treating an old unsent record or a service test as current work", async () => {
    const versions = COVER_RATIOS.map((ratio, i) => ({ id: `ready-${i}`, ratio, file: `ready-${i}.png`, mime: "image/png", createdAt: 1, source: "import" as const, review: "pass" as const, width: 240, height: 320 }));
    const state = { versions, selected: Object.fromEntries(versions.map((v) => [v.ratio, v.id])), runs: [{ id: "old", contentId: detail.id, folderPath: detail.folderPath, createdAt: 1, updatedAt: 1, video: { name: detail.selectedVideo, size: 1234, modifiedAt: 1 }, status: "waiting_agent", frames: [], ratios: ["3x4"], slots: {} }, { id: "test", purpose: "service_test", contentId: detail.id, folderPath: detail.folderPath, createdAt: 1, updatedAt: 1, video: { name: detail.selectedVideo, size: 1234, modifiedAt: 1 }, deliveredAt: 1, status: "waiting_agent", frames: [], ratios: ["3x4"], slots: {} }] } as CoverState;
    render(h(CoverPanel, { detail, getCoverState: vi.fn().mockResolvedValue(state), getCoverImage: vi.fn().mockResolvedValue({ mime: "image/png", base64: "AA==" }), coverAction: vi.fn(), prepareCoverDraft: vi.fn() }));
    await screen.findByRole("button", { name: "重新制作封面" });
    expect(screen.getAllByText("已选用")).toHaveLength(3);
    expect(screen.queryByText("等待 Agent 制作")).toBeNull(); expect(screen.queryByText("查看进度")).toBeNull();
    expect(screen.getByText("制作详情")).toBeTruthy();
  });

  it("reports a failed final selection without showing a successful selection message", async () => {
    const version = { id: "pending-choice", ratio: "3x4", file: "pending.png", mime: "image/png", source: "generated", review: "pending", width: 240, height: 320, createdAt: 1 } as const;
    const state: CoverState = { versions: [version], selected: {}, runs: [] };
    const action = vi.fn().mockResolvedValueOnce({ ...state, versions: [{ ...version, review: "pass" }] }).mockRejectedValueOnce(new Error("选择保存失败"));
    render(h(CoverPanel, { detail, getCoverState: vi.fn().mockResolvedValue(state), getCoverImage: vi.fn().mockResolvedValue({ mime: "image/png", base64: "AA==" }), coverAction: action, prepareCoverDraft: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "选择封面" }));
    fireEvent.click(await screen.findByRole("button", { name: "预览 3:4 封面" }));
    const select = await screen.findByRole("button", { name: "我已检查，选用此版" });
    await waitFor(() => expect((select as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(select);
    await screen.findByText("选择保存失败"); expect(screen.queryByText("已选用此版本")).toBeNull();
    expect(action.mock.calls.map(([request]) => request.action)).toEqual(["review", "select"]);
  });

});
