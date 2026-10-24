import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inside, mediaIdentity, readSettings, readState, updateSettings, updateState, wechatCredential } from "../src/production/storage.ts";

describe("production records and file boundaries", () => {
  it("reading an untouched episode does not create folders or a second content source", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-资料 空格-"));
    expect((await readState(folder)).tasks).toEqual([]); expect(await readdir(folder)).toEqual([]);
  });
  it("serializes updates without losing other account or content state", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-state-"));
    const initial = await readSettings(folder); expect((await readSettings(folder)).revision).toBe(initial.revision);
    await Promise.all([updateSettings(folder, s => { s.browserPaused = true; }), updateSettings(folder, s => { s.wechat.author = "中文 作者"; })]);
    expect(await readSettings(folder)).toMatchObject({ browserPaused: true, wechat: { author: "中文 作者" } });
    await Promise.all(Array.from({ length: 10 }, (_, n) => updateState(folder, s => { s.metrics.push({ platform: "bilibili", accountId: "one", remoteId: String(n), checkedAt: 1, state: "unassociated" }); })));
    expect((await readState(folder)).metrics).toHaveLength(10);
    expect(wechatCredential("appid1")).not.toBe(wechatCredential("appid2"));
  });
  it("refuses a junction-owned state directory and out-of-episode files", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-boundary-")), outside = await mkdtemp(join(tmpdir(), "creator-outside-"));
    await writeFile(join(outside, "video.mp4"), "original");
    await expect(inside(folder, join(outside, "video.mp4"))).rejects.toThrow("超出");
    await symlink(outside, join(folder, ".dsh-creator-workbench"), process.platform === "win32" ? "junction" : "dir");
    await expect(readState(folder)).rejects.toThrow("链接");
    expect(await readFile(join(outside, "video.mp4"), "utf8")).toBe("original");
  });
  it("keeps a stable content hash and rejects empty video sources", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-media-"));
    await mkdir(join(folder, "一期")); const file = join(folder, "一期", "中文 video.MP4");
    await writeFile(file, "video bytes"); const one = await mediaIdentity(file), two = await mediaIdentity(file);
    expect(one).toEqual(two); expect(one.name).toBe("中文 video.MP4");
    await writeFile(file, ""); await expect(mediaIdentity(file)).rejects.toThrow("变化");
  });
});
