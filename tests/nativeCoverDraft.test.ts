import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prepareCoverDraft } from "../src/client/workbench.ts";
import { saveCreatorUiState, DEFAULT_UI_STATE } from "../src/client/persistence.ts";
import { registerCoverTools } from "../src/covers/tools.ts";

const content = { id: "episode", folderPath: "C:/资料/episode" };
beforeEach(() => {
  const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
  saveCreatorUiState(globalThis.localStorage, { ...DEFAULT_UI_STATE, selectedId: content.id, sessionContents: { session1: { contentId: content.id, folder: content.folderPath } } });
});
afterEach(() => vi.unstubAllGlobals());
function host(draft = "", phase = "plain") {
  const input = { state: { getSnapshot: () => ({ draft, phase, draftRev: 12, occurrences: [], attachmentIds: [] }) }, setDraft: vi.fn(), focus: vi.fn() };
  const scoped = { get: (name: string) => name === "conversation" ? { input: { for: () => input } } : undefined, bail: vi.fn(() => true) };
  const workbench = { currentSession: () => "session1", isActive: () => true, ownsSession: () => true, ensureSession: vi.fn() };
  const ctx = { get: (name: string) => name === "desktopWorkbenches" ? workbench : name === "sessions" ? { scope: () => scoped } : undefined };
  return { ctx, input, scoped, workbench };
}
describe("native cover draft admission", () => {
  it("seeds the owned native composer with an exact run binding without sending", async () => {
    const f = host(); await prepareCoverDraft(f.ctx, content, "run1", async () => null);
    expect(f.input.setDraft).toHaveBeenCalledOnce(); expect(f.input.setDraft.mock.calls[0]?.[0]).toContain('"runId":"run1"');
    expect(f.workbench.ensureSession).not.toHaveBeenCalled(); expect(f.scoped.bail).not.toHaveBeenCalled(); expect(f.input.focus).toHaveBeenCalledOnce();
  });
  it("preserves an existing draft and requires a separate explicit append operation", async () => {
    const f = host("existing user draft"); await expect(prepareCoverDraft(f.ctx, content, "run1", async () => null)).rejects.toThrow("已有草稿");
    expect(f.input.setDraft).not.toHaveBeenCalled(); expect(f.scoped.bail).not.toHaveBeenCalled();
    await prepareCoverDraft(f.ctx, content, "run1", async () => null, true);
    expect(f.scoped.bail).toHaveBeenCalledWith("slash/input-insert-text", expect.objectContaining({ span: { start: 19, end: 19, draftRev: 12 } })); expect(f.input.setDraft).not.toHaveBeenCalled();
  });
  it("does not write an old cover request after content navigation during session creation", async () => {
    const f = host(); saveCreatorUiState(globalThis.localStorage, { ...DEFAULT_UI_STATE, selectedId: content.id, sessionContents: {} });
    f.workbench.ensureSession.mockImplementation(async () => { saveCreatorUiState(globalThis.localStorage, { ...DEFAULT_UI_STATE, selectedId: "another", sessionContents: {} }); return "session1"; });
    await expect(prepareCoverDraft(f.ctx, content, "run1", async () => content.folderPath)).rejects.toThrow("内容已切换"); expect(f.input.setDraft).not.toHaveBeenCalled();
  });
  it("rejects a changed draft revision or busy input without overwriting text", async () => {
    const changed = host("draft"); changed.scoped.bail.mockReturnValue(false);
    await expect(prepareCoverDraft(changed.ctx, content, "run", async () => null, true)).rejects.toThrow("草稿已变化"); expect(changed.input.setDraft).not.toHaveBeenCalled();
    const busy = host("draft", "submitting"); await expect(prepareCoverDraft(busy.ctx, content, "run", async () => null, true)).rejects.toThrow("正在处理"); expect(busy.scoped.bail).not.toHaveBeenCalled();
  });
});
describe("Agent cover image tool boundary", () => {
  it("returns real image attachments and no raw image buffers in JSON", async () => {
    const tools = new Map<string, { execute: (...args: never[]) => Promise<unknown>; output: { render: (args: unknown, value: unknown) => Array<{ type: string }> } }>();
    const attachments = { saveImages: vi.fn(async () => [{ type: "image", id: "stored-frame" }]) };
    const ctx = { get: (name: string) => name === "tools" ? { register: (tool: { name: string }) => tools.set(tool.name, tool as never) } : attachments };
    const workflow = { prepare: vi.fn(async () => ({ run: { id: "run" }, images: [{ name: "frame 0", data: Buffer.from("jpeg fixture") }], context: "本期文稿", rules: "rules.md", flow: "flow.md" })) };
    registerCoverTools(ctx as never, workflow as never);
    const tool = tools.get("creator_prepare_cover")!;
    const result = await tool.execute({ id: "episode", folderPath: "folder", runId: "run" } as never, { signal: new AbortController().signal } as never);
    expect(attachments.saveImages).toHaveBeenCalledWith([{ data: Buffer.from("jpeg fixture"), name: "frame 0", mediaType: "image/jpeg" }]);
    expect(JSON.stringify(result)).not.toContain('"Buffer"'); expect(tool.output.render({}, result).map((b) => b.type)).toEqual(["text", "image"]);
    expect([...tools.keys()]).toEqual(["creator_prepare_cover", "creator_generate_cover", "creator_read_cover_results", "creator_review_cover"]);
  });
});
