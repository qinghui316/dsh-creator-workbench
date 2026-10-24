// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CreatorViewFace } from "../src/client/face.ts";
import type { ContentSummary } from "../src/types.ts";
import { ContentSidebarPanel } from "../src/client/sidebar/ContentSidebarPanel.tsx";
import { getSelectedContentId, setSelectedContentId } from "../src/client/contentSelection.ts";
import { zh, type CreatorKey } from "../src/client/locales.ts";
import { emptyBurn, emptyPublish } from "../src/publishStatus.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => {
  const icon = () => h("span");
  return { StateDot: icon, Pill: ({ children }: { children: unknown }) => h("span", {}, children as never), Button: ({ variant, children, ...props }: Record<string, unknown>) => h("button", props, children as never), Input: (props: Record<string, unknown>) => h("input", props), Tooltip: ({ children }: { children: unknown }) => children,
    Modal: ({ open, title, children, footer }: Record<string, unknown>) => open ? h("div", { role: "dialog", "aria-label": title }, children as never, footer as never) : null,
    IconBrowseOutlineRegular: icon, IconCloseFillRegular: icon, IconProjectAddOutlineRegular: icon, IconRefreshOutlineRegular: icon, IconSearchOutlineRegular: icon };
});
vi.mock("../src/client/CoverThumb.tsx", () => ({ CoverThumb: () => null, coverThumbRevision: () => "" }));
beforeEach(() => { localStorage.clear(); setSelectedContentId("episode"); });
afterEach(cleanup);
function fixture() {
  const item: ContentSummary = { id: "episode", title: "本期中文长标题 English workflow", folderPath: "E:/资料/episode", recordedAt: Date.now(), createdMs: 1, covers: {}, subtitles: {}, tags: [], hasArticle: false, hasPublishPackage: false, pipeline: "raw", workflow: "finish", publish: emptyPublish(), burn: emptyBurn(), subtitleJob: emptyBurn(), coverJob: emptyBurn() };
  let removed = false;
  const list = () => ({ items: removed ? [] : [item], removedItems: removed ? [item] : [], settings: {}, counts: { total: removed ? 0 : 1 }, revision: 1 });
  const setContentVisibility = vi.fn(async (_id: string, _folder: string, hidden: boolean) => { removed = hidden; return list(); });
  const face = { ready: () => true, captureNavigation: () => () => true, listContents: vi.fn(async () => list()), getCoverThumb: vi.fn(), refreshCatalog: vi.fn(), createContent: vi.fn(), setContentVisibility } as unknown as CreatorViewFace;
  const view = () => render(h(ContentSidebarPanel, { ...face, t: (key: CreatorKey) => zh[key] }));
  return { item, face, setContentVisibility, view };
}
describe("project deletion controls in the existing sidebar", () => {
  it("requires confirmation, clears detail and does not expose deleted rows after remount", async () => {
    const f = fixture(); f.view();
    fireEvent.click(await screen.findByRole("button", { name: `删除项目：${f.item.title}` }));
    expect(f.setContentVisibility).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除项目" }).textContent).toContain("磁盘文件保留");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(f.setContentVisibility).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `删除项目：${f.item.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(getSelectedContentId()).toBeNull());
    expect(f.setContentVisibility).toHaveBeenCalledWith("episode", f.item.folderPath, true);
    cleanup(); f.view();
    await waitFor(() => expect(f.face.listContents).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/已删除项目/)).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复", hidden: true })).toBeNull();
    expect(getSelectedContentId()).toBeNull();
  });
  it("retains the item and selection when deletion fails", async () => {
    const f = fixture(); f.setContentVisibility.mockRejectedValue(new Error("资料库已切换，请刷新")); f.view();
    fireEvent.click(await screen.findByRole("button", { name: `删除项目：${f.item.title}` })); fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await screen.findByRole("alert");
    expect(getSelectedContentId()).toBe("episode");
    expect(screen.getByRole("button", { name: `删除项目：${f.item.title}` })).toBeTruthy();
  });
  it("removes the rendered row when archiving the active session changes host navigation", async () => {
    const f = fixture(); let active = true;
    f.face.captureNavigation = () => () => active;
    f.face.removeProject = vi.fn(async () => { active = false; });
    f.view();
    fireEvent.click(await screen.findByRole("button", { name: `删除项目：${f.item.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: `删除项目：${f.item.title}` })).toBeNull());
    expect(getSelectedContentId()).toBeNull();
  });
});
