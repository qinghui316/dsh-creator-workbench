import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/production/runtime.ts", () => ({ pinnedPublisher: vi.fn(async () => "publisher"), browserExecutable: vi.fn(async () => "ego-browser"), resource: vi.fn() }));
vi.mock("../src/production/browser.ts", () => ({ requireAccount: vi.fn(), BrowserControlError: class extends Error {}, browserControlStopped: vi.fn(() => false) }));
vi.mock("../src/production/process.ts", () => ({ runProcess: vi.fn(), safeError: (error: unknown) => String(error) }));
import { runProcess } from "../src/production/process.ts";
import { resource } from "../src/production/runtime.ts";
import {resolve} from "node:path";
import { runUpload } from "../src/production/publishing.ts";
import { mediaIdentity, owned } from "../src/production/storage.ts";
import type { ProductionTask } from "../src/production/types.ts";
beforeEach(() => vi.clearAllMocks());
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-publishing-")), id = randomUUID();
  const video = join(folder, "成片.mp4"); await writeFile(video, "original video bytes");
  const dir = await owned(folder, id), stateRoot = join(dir, "publisher-jobs", id); await mkdir(stateRoot, { recursive: true });
  await writeFile(join(stateRoot, "state.json"), JSON.stringify({ status: "ready", platforms: { bilibili: { status: "ready", taskSpaceId: 6, verdict: { ready: true } } } }));
  await writeFile(join(dir, "assets.json"), "[]"); await writeFile(join(dir, "package.json"), JSON.stringify({videoPath:video,bilibiliTitle:"Creator title"}));
  const account = { platform: "bilibili" as const, id: "account-1", name: "Creator", checkedAt: 1 };
  const task: ProductionTask = { id, contentId: "episode", folderPath: folder, kind: "upload", platform: "bilibili", status: "ready", account, video: await mediaIdentity(video), originalRightsConfirmed: true, packageFile: relative(folder, join(dir, "package.json")), createdAt: 1, updatedAt: 1 };
  return { folder, dir, task, account, dataDir: "data", signal: new AbortController().signal };
}
describe("retained upload recovery", () => {
  it("checks an already-ready original job without creating or uploading another copy", async () => {
    const input = await fixture();vi.mocked(resource).mockResolvedValue(resolve("scripts/publisher-bilibili-details.mjs"));
    vi.mocked(runProcess).mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }).mockResolvedValueOnce({code:0,stdout:'CREATOR_BILI_DETAILS:{"ready":true}',stderr:""});
    expect((await runUpload({ ...input, operation: "resume" })).ready).toBe(true);
    const [, args, options] = vi.mocked(runProcess).mock.calls[0]!;
    expect(args[args.indexOf("--operation") + 1]).toBe("inspect");
    expect(args[args.indexOf("--job-id") + 1]).toBe(input.task.id);
    expect(options?.env?.CREATOR_RESUME_SPACE).toBe("6");
  });
  it("does not report stale ready evidence after an unsuccessful invocation", async () => {
    const input = await fixture(); vi.mocked(runProcess).mockResolvedValue({ code: 2, stdout: "", stderr: "failed" });
    expect(await runUpload({ ...input, operation: "inspect" })).toMatchObject({ ready: false, error: expect.stringContaining("未完成操作") });
  });
});
