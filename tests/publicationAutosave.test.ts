import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicationEditors } from "../src/client/publicationAutosave.ts";
import type { PublicationInput } from "../src/production/types.ts";
const input: PublicationInput = { platform: "xiaohongshu", type: "images", title: "", body: "", imageIds: [], tags: [] };
function storage() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } }; }
afterEach(() => vi.useRealTimers());
describe("per-material autosave", () => {
  it("coalesces typing and serializes newer edits without marking them saved from an old response", async () => {
    vi.useFakeTimers(); let resolve!: (v: { id: string; revision: number }) => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ id: "one", revision: 2 });
    const manager = new PublicationEditors("E:/project", send, storage(), 700), editor = manager.create(input);
    editor.update({ ...input, title: "first" }); editor.update({ ...input, title: "second" });
    await vi.advanceTimersByTimeAsync(700); expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]![0].input.title).toBe("second");
    editor.update({ ...input, title: "latest" }); resolve({ id: "one", revision: 1 }); await editor.flush();
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1]![0]).toMatchObject({ publicationId: "one", expectedRevision: 1, input: { title: "latest" } });
    expect(editor.getSnapshot()).toMatchObject({ phase: "saved", input: { title: "latest" }, revision: 2 });
  });
  it("persists the exact creation identity across a lost receipt, page unmount and reopen", async () => {
    vi.useFakeTimers(); const disk = storage(), first = vi.fn().mockRejectedValue(new Error("network timeout"));
    const manager = new PublicationEditors("E:/Project", first, disk), editor = manager.create(input);
    await expect(editor.flush()).rejects.toThrow("timeout"); const uncertain = first.mock.calls[0]![0];
    const send = vi.fn().mockResolvedValue({ id: "one", revision: 1 });
    const restored = new PublicationEditors("e:\\project", send, disk).list()[0]!;
    await restored.flush(); expect(send.mock.calls[0]![0]).toEqual(uncertain); expect(restored.getSnapshot().phase).toBe("saved");
    manager.remove(editor.getSnapshot().key);
  });
  it("holds further autosaves while explicit upload admission fixes its snapshot", async () => {
    vi.useFakeTimers(); const send = vi.fn().mockResolvedValueOnce({ id: "one", revision: 1 }).mockResolvedValue({ id: "one", revision: 2 });
    const editor = new PublicationEditors("folder", send, storage()).create(input);
    let finish!: () => void;
    const upload = editor.withSaved(async saved => { expect(saved.revision).toBe(1); return new Promise<void>(r => { finish = r; }); });
    await vi.advanceTimersByTimeAsync(0); editor.update({ ...input, body: "new typing" }); await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1); finish(); await upload; await editor.flush(); expect(send).toHaveBeenCalledTimes(2);
  });
  it("keeps manual and Agent conflicts rather than silently adopting remote input", async () => {
    vi.useFakeTimers(); const manager = new PublicationEditors("folder", vi.fn().mockRejectedValue(new Error("发布内容已被修改或移除，输入已保留，请重新读取后合并。")), storage());
    const editor = manager.open({ ...input, bodyFile: "body.md", id: "one", revision: 1, createdAt: 1, updatedAt: 1 });
    editor.update({ ...input, body: "manual text" }); await expect(editor.flush()).rejects.toThrow("已被修改");
    editor.acceptRemote({ ...input, body: "Agent text", bodyFile: "new.md", id: "one", revision: 2, createdAt: 1, updatedAt: 2 });
    expect(editor.getSnapshot()).toMatchObject({ phase: "conflict", input: { body: "manual text" }, revision: 1 });
    expect(manager.create({ ...editor.getSnapshot().input }).getSnapshot().publicationId).toBeUndefined();
  });
});
