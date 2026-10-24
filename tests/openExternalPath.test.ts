import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { openExternalPath } from "../src/openExternalPath.ts";

function launcher() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReturnValueOnce(child as never);
  return child;
}
describe("Windows default application handoff", () => {
  it("normalizes mixed local separators and accepts a shell handoff without waiting for Explorer exit", async () => {
    const child = launcher(), pending = openExternalPath("E:/资料 库/本期/preview.html", "win32");
    expect(spawn).toHaveBeenLastCalledWith("explorer.exe", ["E:\\资料 库\\本期\\preview.html"], expect.objectContaining({ windowsHide: true, detached: true }));
    child.emit("spawn"); child.emit("exit", 1);
    await expect(pending).resolves.toBeUndefined();
    expect(child.unref).toHaveBeenCalledOnce();
  });
  it("reports a launcher that failed to start", async () => {
    const child = launcher(), pending = openExternalPath("E:/本期/article.md", "win32");
    child.emit("error", new Error("spawn EACCES"));
    await expect(pending).rejects.toThrow("EACCES");
    expect(child.unref).not.toHaveBeenCalled();
  });
  it("preserves preview URLs", async () => {
    const child = launcher(), pending = openExternalPath("http://127.0.0.1:1234/preview?a=1", "win32");
    expect(spawn).toHaveBeenLastCalledWith("explorer.exe", ["http://127.0.0.1:1234/preview?a=1"], expect.anything());
    child.emit("spawn"); await pending;
  });
});
