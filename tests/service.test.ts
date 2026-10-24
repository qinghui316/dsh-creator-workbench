import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const collect = vi.hoisted(() => ({
  calls: [] as Array<{ platforms?: readonly string[] }>,
  run: vi.fn(async (
    _script: string,
    _signal: AbortSignal,
    options: { platforms?: readonly string[] } = {},
  ) => {
    collect.calls.push(options.platforms === undefined ? {} : { platforms: options.platforms });
    return { collected: [] };
  }),
}));

const chained = vi.hoisted(() => ({
  calls: [] as Array<{ script: string; env?: Record<string, string> }>,
}));

const preview = vi.hoisted(() => ({
  nextPid: 41001,
  terminateCalls: [] as number[],
  waitMode: "failure" as "failure" | "abort",
  abortController: undefined as AbortController | undefined,
}));

vi.mock("../src/collectEgo.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/collectEgo.ts")>();
  return { ...actual, runCollectPublish: collect.run };
});

vi.mock("../src/subtitle.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/subtitle.ts")>();
  return {
    ...actual,
    spawnPython: vi.fn((_python: string, script: string, _args: readonly string[], env?: Record<string, string>) => {
      chained.calls.push({ script, ...(env === undefined ? {} : { env }) });
      return {
        pid: preview.nextPid++,
        stderr: undefined,
        once: (_event: string, listener: (code: number) => void) => {
          queueMicrotask(() => listener(0));
          return undefined;
        },
        unref: vi.fn(),
      } as never;
    }),
    waitHttp: vi.fn(async (_url: string, _timeoutMs: number, _signal: AbortSignal) => {
      if (preview.waitMode === "abort") {
        preview.abortController?.abort(new Error("preview aborted"));
        throw new Error("preview aborted");
      }
      throw new Error("preview did not start");
    }),
  };
});

vi.mock("../src/processAlive.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/processAlive.ts")>();
  return {
    ...actual,
    terminateOwnedProcess: vi.fn(async (pid: number | undefined) => {
      if (pid !== undefined) preview.terminateCalls.push(pid);
      return true;
    }),
  };
});

import { CreatorWorkbenchService } from "../src/service.ts";
import { saveCollectCache } from "../src/collectCache.ts";
import { emptyOverlay, loadOverlay, saveOverlay } from "../src/overlay.ts";
import { emptyBurn, emptyPublish } from "../src/publishStatus.ts";
import { loadPreviewRegistry } from "../src/previewServers.ts";
import type { ContentDetail, ContentSummary, CreatorProfile, OverlayItem } from "../src/types.ts";

function item(folderPath: string, videoRaw: string): ContentSummary {
  return {
    id: "2026-08-13_demo",
    folderPath,
    title: "Demo title",
    recordedAt: 1,
    createdMs: 1,
    videoRaw,
    videos: [{ name: "selected.mp4", path: videoRaw, size: 1, modifiedAt: 1 }],
    selectedVideo: "selected.mp4",
    videoSelection: "selected",
    covers: {},
    subtitles: {},
    hasPublishPackage: false,
    hasArticle: false,
    tags: [],
    pipeline: "raw",
    workflow: "finish",
    publish: emptyPublish(),
    burn: emptyBurn(),
    subtitleJob: emptyBurn(),
    coverJob: emptyBurn(),
  };
}

describe("CreatorWorkbenchService.startSubtitleGenerate", () => {
  it("delegates to Volcano domain without resolving or injecting cover credentials", async () => {
    const folder = await mkdtemp(join(tmpdir(), "creator-service-transcribe-"));
    const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
    const action = vi.fn(async () => undefined);
    const resolve = vi.fn(async () => { throw new Error("credentials must be resolved by the domain only"); });
    Object.assign(service, { ctx: { get: () => ({ resolve }) }, production: { action }, getContent: vi.fn(async () => ({ ...item(folder, join(folder, "demo.mp4")), folderPath: folder })) });
    const signal = new AbortController().signal;
    await service.startSubtitleGenerate({ id: "2026-08-13_demo" }, signal);
    expect(action).toHaveBeenCalledWith({ id: "2026-08-13_demo", folderPath: folder, action: "transcribe" }, signal);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("CreatorWorkbenchService.startChainedJob", () => {
  it("passes each step only its declared credential", async () => {
    chained.calls.length = 0;
    const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
    const probe = service as unknown as {
      patchItem: () => Promise<ContentDetail>;
    };
    probe.patchItem = async () => undefined as never;

    await service.startChainedJob("demo", "subtitleJob", {
      python: "/tmp/python",
      env: { DASHSCOPE_API_KEY: "dash", ZENMUX_API_KEY: "zen" },
      steps: [
        { script: "bailian_transcribe.py", args: [], output: "transcript", env: "subtitle" },
        { script: "review_subtitles.py", args: [], output: "reviewed", env: "subtitle" },
        { script: "prepare_subtitles.py", args: [], output: "prepared", env: "none" },
      ],
    }, new AbortController().signal);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(chained.calls).toEqual([
      { script: "bailian_transcribe.py", env: { DASHSCOPE_API_KEY: "dash" } },
      { script: "review_subtitles.py", env: { DASHSCOPE_API_KEY: "dash" } },
      { script: "prepare_subtitles.py" },
    ]);
  });
});

describe("CreatorWorkbenchService.openSubtitlePreview", () => {
  async function previewService(folder: string, video: string): Promise<CreatorWorkbenchService> {
    const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
    const previewItem = item(folder, video);
    previewItem.subtitles = { srt: join(folder, "demo.srt") };
    const probe = service as unknown as {
      dataDir: string;
      previews: CreatorWorkbenchService["previews"];
      find: () => Promise<ContentSummary>;
      subtitleSkill: () => Promise<{ root: string; python: string }>;
    };
    probe.dataDir = folder;
    probe.previews = new Map();
    probe.find = async () => previewItem;
    probe.subtitleSkill = async () => ({ root: "/tmp/oil-subtitle", python: "/tmp/python" });
    return service;
  }

  it.each(["failure", "abort"] as const)("terminates and cleans up after waitHttp %s", async (mode) => {
    const folder = await mkdtemp(join(tmpdir(), "oil-service-preview-"));
    const video = join(folder, "demo.mp4");
    await writeFile(video, "v");
    await writeFile(join(folder, "demo.srt"), "1\n00:00:00,000 --> 00:00:01,000\n字幕\n");
    preview.waitMode = mode;
    preview.abortController = new AbortController();
    preview.terminateCalls.length = 0;
    const service = await previewService(folder, video);

    await expect(service.openSubtitlePreview({ id: "2026-08-13_demo" }, preview.abortController.signal))
      .rejects.toThrow(mode === "failure" ? "preview did not start" : "preview aborted");

    expect(preview.terminateCalls).toHaveLength(1);
    expect(service.previews.size).toBe(0);
    expect(loadPreviewRegistry(join(folder, "preview-servers.json"))).toEqual([]);
  });
});

async function syncService(profile: CreatorProfile): Promise<CreatorWorkbenchService> {
  const dataDir = await mkdtemp(join(tmpdir(), "oil-service-sync-"));
  const overlay = emptyOverlay();
  overlay.profile = profile;
  await saveOverlay(dataDir, overlay);
  const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
  const probe = service as unknown as {
    dataDir: string;
    scanned: () => Promise<{ items: ContentSummary[] }>;
    invalidateCatalog: () => void;
  };
  probe.dataDir = dataDir;
  probe.scanned = async () => ({ items: [item(dataDir, join(dataDir, "demo.mp4"))] });
  Object.assign(service, { production: { active: new Map(), action: async (request: { platform: string }) => { await collect.run("", new AbortController().signal, { platforms: [request.platform] }); return { tasks: [] }; }, state: async () => ({ tasks: [], metrics: [] }) } });
  probe.invalidateCatalog = () => undefined;
  return service;
}

describe("CreatorWorkbenchService.syncPublish", () => {
  beforeEach(() => {
    collect.calls.length = 0;
    collect.run.mockClear();
  });

  it("dispatches enabled platforms sequentially through account-bound operations", async () => {
    const service = await syncService({ enabledPlatforms: ["douyin", "wechat"] });

    await service.syncPublish({}, new AbortController().signal);

    expect(collect.calls).toEqual([{ platforms: ["douyin"] }, { platforms: ["wechat"] }]);
  });

  it("rejects an explicitly requested disabled platform", async () => {
    const service = await syncService({ enabledPlatforms: ["douyin"] });

    await expect(service.syncPublish({ platform: "wechat" }, new AbortController().signal))
      .rejects.toThrow("publish platform is disabled: wechat");
    expect(collect.calls).toEqual([]);
  });

  it("returns without invoking the collector when all platforms are disabled", async () => {
    const service = await syncService({ enabledPlatforms: [] });

    await expect(service.syncPublish({}, new AbortController().signal)).resolves.toEqual({
      matched: 0,
      platforms: [],
    });
    expect(collect.calls).toEqual([]);
  });

  it("does not reuse the unscoped legacy cache for account-bound collection", async () => {
    const service = await syncService({ enabledPlatforms: ["douyin", "wechat"] });
    const dataDir = (service as unknown as { dataDir: string }).dataDir;
    await saveCollectCache(dataDir, {
      collected: [{ platform: "douyin", items: [] }],
    }, { scope: "library" });

    await service.syncPublish({}, new AbortController().signal);

    expect(collect.calls).toEqual([{ platforms: ["douyin"] }, { platforms: ["wechat"] }]);
  });

  it("checks a requested content id before the empty-platform early return", async () => {
    const service = await syncService({ enabledPlatforms: [] });

    await expect(service.syncPublish({ id: "missing" }, new AbortController().signal))
      .rejects.toThrow("content not found: missing");
    expect(collect.calls).toEqual([]);
  });
});

describe("CreatorWorkbenchService subtitle job reconcile", () => {
  async function overlayService(item: OverlayItem) {
    const dataDir = await mkdtemp(join(tmpdir(), "oil-service-job-"));
    const libraryRoot = await mkdtemp(join(tmpdir(), "oil-service-lib-"));
    const overlay = emptyOverlay();
    overlay.libraryRoot = libraryRoot;
    overlay.items.demo = item;
    await saveOverlay(dataDir, overlay);
    const service = Object.create(CreatorWorkbenchService.prototype) as CreatorWorkbenchService;
    const probe = service as unknown as {
      dataDir: string;
      libraryRoot: string;
      cache: undefined;
      watchedRoot: string;
      watchClose: () => void;
      catalogRevision: number;
      exportWaiters: Map<string, AbortController>;
    };
    probe.dataDir = dataDir;
    probe.libraryRoot = libraryRoot;
    probe.cache = undefined;
    probe.watchedRoot = libraryRoot;
    probe.watchClose = () => undefined;
    probe.catalogRevision = 0;
    probe.exportWaiters = new Map();
    return { dataDir, service };
  }

  function liveScript(script: string) {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return child;
  }

  it("keeps subtitleJob running while prepare_subtitles.py is still the pid", async () => {
    const child = liveScript("prepare_subtitles.py");
    expect(child.pid).toBeTypeOf("number");
    try {
      const { dataDir, service } = await overlayService({
        subtitleJob: {
          status: "running",
          startedAt: 1,
          output: join(tmpdir(), "missing-transcript.json"),
          pid: child.pid as number,
        },
      });
      await service.scanned();
      const overlay = await loadOverlay(dataDir);
      expect(overlay.items.demo?.subtitleJob?.status).toBe("running");
    } finally {
      if (child.pid !== undefined) process.kill(child.pid);
    }
  });

  it("recovers a false process-exited error while burn_subtitles.py is still running", async () => {
    const child = liveScript("burn_subtitles.py");
    expect(child.pid).toBeTypeOf("number");
    try {
      const { dataDir, service } = await overlayService({
        burn: {
          status: "running",
          startedAt: 1,
          output: join(tmpdir(), "missing-subtitled.mp4"),
          pid: child.pid as number,
        },
        subtitleJob: {
          status: "error",
          startedAt: 1,
          output: join(tmpdir(), "missing-subtitled.mp4"),
          error: "subtitleJob process exited",
        },
      });
      await service.scanned();
      const overlay = await loadOverlay(dataDir);
      expect(overlay.items.demo?.subtitleJob).toMatchObject({
        status: "running",
        pid: child.pid,
      });
    } finally {
      if (child.pid !== undefined) process.kill(child.pid);
    }
  });
});
