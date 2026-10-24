// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionPanel } from "../src/client/ProductionPanel.tsx";
import type { ProductionClient } from "../src/client/productionApi.ts";
import type { ContentDetail } from "../src/types.ts";
import { emptyProduction } from "../src/production/types.ts";
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({ Button: ({ children, variant, size, ...props }: Record<string, unknown>) => h("button", props, children as never) }));
afterEach(cleanup);
function fixture() {
  const detail = { id: "episode", folderPath: "C:/资料 库/episode", title: "本期", tags: [], covers: {}, videos: [], hasArticle: true, articlePath: "source.md", article: "# 源稿" } as unknown as ContentDetail;
  const state = { ...emptyProduction(), articles: [{ id: "one", file: "one.md", createdAt: 1 }, { id: "two", file: "two.md", createdAt: 2 }] };
  const preview = vi.fn(async ({ articleFile }: { articleFile?: string }) => ({ path: `C:/资料 库/${articleFile}.html`, html: `<h1>${articleFile} 排版成品</h1>` }));
  const api = { state: async () => state, settings: async () => ({ accounts: {}, wechat: { theme: "claude-editorial" }, wechatConfigured: false }), preview } as unknown as ProductionClient;
  const openPath = vi.fn(async () => undefined);
  render(h(ProductionPanel, { detail, api, mode: "article", openPath }));
  return { preview, openPath };
}
describe("article finished output", () => {
  it("shows formatted HTML by default and opens that file, without a draft disclosure", async () => {
    const { openPath, preview } = fixture();
    const frame = await screen.findByTitle("公众号排版预览");
    expect(frame.getAttribute("srcdoc")).toContain("two.md 排版成品");
    fireEvent.click(screen.getByText("打开 HTML 成品"));
    expect(openPath).toHaveBeenCalledWith("C:/资料 库/two.md.html");
    expect(preview).toHaveBeenCalledOnce(); expect(screen.queryByText("打开文章文件")).toBeNull();
  });
  it("does not let an older preview overwrite a later version selection", async () => {
    const { preview } = fixture(); await screen.findByTitle("公众号排版预览");
    let finish: (value: { path: string; html: string }) => void = () => undefined;
    preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.change(screen.getByLabelText("文章版本"), { target: { value: "one.md" } });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("文章版本"), { target: { value: "two.md" } });
    await screen.findByTitle("公众号排版预览");
    finish({ path: "old.html", html: "STALE" });
    await waitFor(() => expect(screen.getByTitle("公众号排版预览").getAttribute("srcdoc")).toContain("two.md"));
    expect(screen.getByTitle("公众号排版预览").getAttribute("srcdoc")).not.toContain("STALE");
  });
  it("keeps source access and offers formatting retry after a local render error", async () => {
    const { preview } = fixture(); await screen.findByTitle("公众号排版预览");
    preview.mockRejectedValueOnce(new Error("配图缺失"));
    fireEvent.change(screen.getByLabelText("文章版本"), { target: { value: "one.md" } });
    expect((await screen.findByRole("alert")).textContent).toBe("配图缺失");
    expect(screen.getByText("配图缺失")).toBeTruthy();
    fireEvent.click(screen.getByText("重试排版"));
    await screen.findByTitle("公众号排版预览");
    expect(screen.getByText("打开可编辑源稿")).toBeTruthy();
  });
});
