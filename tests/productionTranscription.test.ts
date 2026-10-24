import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/covers/files.ts", () => ({ mediaCommand: vi.fn() }));
import { mediaCommand } from "../src/covers/files.ts";
import { ASR_CREDENTIAL } from "../src/production/types.ts";
import { mediaIdentity } from "../src/production/storage.ts";
import { AsrError, importSubtitle, normalizeCues, parseSrt, toSrt, transcribe, VOLCANO_ASR_ENDPOINT } from "../src/production/transcription.ts";

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "creator-ASR-中文 空格-")), video = join(folder, "视频.MP4"), dir = join(folder, "task");
  await mkdir(dir); await writeFile(video, "stable source video");
  return { folder, video, dir, identity: await mediaIdentity(video), key: "fixture-key-not-real", signal: new AbortController().signal };
}
beforeEach(() => {
  vi.mocked(mediaCommand).mockReset().mockImplementation(async (command, args) => {
    if (command === "ffprobe") return JSON.stringify({ format: { duration: "12" }, streams: [{ codec_type: "audio" }] });
    await writeFile(args.at(-1)!, "encoded audio"); return "";
  });
});
describe("Volcano recorded file transcription", () => {
  it("uses local audio and new key auth, persists exact timing, and redacts echoed credentials", async () => {
    const input = await fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ api_key: input.key, result: { text: "你好", utterances: [{ start_time: 120, end_time: 900, text: "你好" }] } }), { headers: { "x-api-status-code": "20000000" } }));
    const result = await transcribe({ ...input, fetcher });
    const [url, options] = fetcher.mock.calls[0]!; expect(url).toBe(VOLCANO_ASR_ENDPOINT);
    expect(options?.headers).toMatchObject({ "X-Api-Key": input.key, "X-Api-Resource-Id": "volc.bigasr.auc_turbo" });
    const body = JSON.parse(String(options?.body)); expect(body.audio.data).toBe(Buffer.from("encoded audio").toString("base64")); expect(body.audio.url).toBeUndefined(); expect(body.user.uid).not.toBe(input.key);
    expect(await readFile(join(input.folder, result.srtFile), "utf8")).toContain("00:00:00,120 --> 00:00:00,900");
    expect(await readFile(join(input.folder, result.rawFile!), "utf8")).not.toContain(input.key);
    expect(await readFile(input.video, "utf8")).toBe("stable source video"); expect(ASR_CREDENTIAL).toBe("CREATOR_VOLC_ASR_API_KEY");
  });
  it("does not submit without audio or beyond the supported duration", async () => {
    const input = await fixture(), fetcher = vi.fn<typeof fetch>();
    vi.mocked(mediaCommand).mockResolvedValueOnce(JSON.stringify({ format: { duration: "12" }, streams: [] }));
    await expect(transcribe({ ...input, fetcher })).rejects.toThrow("没有音轨");
    vi.mocked(mediaCommand).mockResolvedValueOnce(JSON.stringify({ format: { duration: "7201" }, streams: [{ codec_type: "audio" }] }));
    await expect(transcribe({ ...input, fetcher })).rejects.toThrow("两小时"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not resubmit an unknown result and keeps malformed timestamps for diagnosis", async () => {
    const input = await fixture(), fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network timeout"));
    await expect(transcribe({ ...input, fetcher })).rejects.toMatchObject({ unknownOutcome: true }); expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(new Response(JSON.stringify({ result: { utterances: [{ start_time: null, end_time: 800, text: "invalid" }] } })));
    await expect(transcribe({ ...input, fetcher })).rejects.toBeInstanceOf(AsrError);
    expect(await readFile(join(input.dir, "asr-result.json"), "utf8")).toContain("invalid");
  });
  it("refuses source replacement before uploading and imports UTF-8 subtitles without touching originals", async () => {
    const input = await fixture(), fetcher = vi.fn<typeof fetch>();
    vi.mocked(mediaCommand).mockImplementationOnce(async () => { await writeFile(input.video, "replaced"); return JSON.stringify({ format: { duration: "12" }, streams: [{ codec_type: "audio" }] }); });
    await expect(transcribe({ ...input, fetcher })).rejects.toThrow("替换"); expect(fetcher).not.toHaveBeenCalled();
    const source = join(input.folder, "字幕.srt"), text = "1\r\n00:00:00,100 --> 00:00:01,200\r\n中文 English\r\n";
    await writeFile(source, text, "utf8");
    const dir = join(input.folder, "import"); await mkdir(dir);
    const imported = await importSubtitle({ ...input, dir, source, identity: await mediaIdentity(input.video) });
    expect(imported.cues).toBe(1); expect(await readFile(source, "utf8")).toBe(text);
  });
  it("rejects invalid and out-of-order timing without fabricating positions", () => {
    expect(() => normalizeCues([{ start_time: 10, end_time: 20, text: "a" }, { start_time: 5, end_time: 10, text: "b" }])).toThrow("时间轴");
    expect(() => parseSrt("1\n00:99:00,000 --> 01:40:00,000\ntext")).toThrow("时间格式");
    const cues = [{ start: 120, end: 1120, text: "中文\nEnglish" }]; expect(parseSrt(toSrt(cues))).toEqual(cues);
  });
});
