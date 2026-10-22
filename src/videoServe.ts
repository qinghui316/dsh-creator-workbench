import { currentVideoPath } from "./videoSelection.ts";
import type { ContentSummary } from "./types.ts";
import { createReadStream } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname } from "node:path";

import { findFreePort } from "./subtitle.ts";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

export function playbackOf(item: Pick<ContentSummary, "videos" | "selectedVideo">): { path: string; kind: "raw" | "subtitled" } | undefined {
  const path = currentVideoPath(item);
  return path === undefined ? undefined : { path, kind: "raw" };
}

export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | undefined {
  if (header === undefined || size <= 0) return undefined;
  const matched = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (matched === null) return undefined;
  const rawStart = matched[1] ?? "";
  const rawEnd = matched[2] ?? "";
  if (rawStart === "" && rawEnd === "") return undefined;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function startVideoServer(path: string): Promise<{
  url: string;
  port: number;
  close: () => void;
}> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("video is not a file");
  const mime = MIME[extname(path).toLowerCase()] ?? "video/mp4";
  const port = await findFreePort(8900, 8999);
  const server: Server = createServer((request, response) => {
    void (async () => {
    const current = await lstat(path).catch(() => undefined);
    if (current === undefined || !current.isFile() || current.isSymbolicLink()) {
      response.writeHead(404); response.end(); return;
    }
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Range");
    response.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }
    const range = parseByteRange(request.headers.range, current.size);
    if (range === undefined) {
      response.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": current.size,
        "Accept-Ranges": "bytes",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      pipeFile(path, response);
      return;
    }
    const length = range.end - range.start + 1;
    response.writeHead(206, {
      "Content-Type": mime,
      "Content-Length": length,
      "Content-Range": `bytes ${range.start}-${range.end}/${current.size}`,
      "Accept-Ranges": "bytes",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    pipeFile(path, response, range);
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { resolve(); });
  });
  server.unref();
  return {
    url: `http://127.0.0.1:${port}/video${extname(path).toLowerCase()}`,
    port,
    close: () => {
      server.close();
    },
  };
}

function pipeFile(path: string, response: import("node:http").ServerResponse, range?: { start: number; end: number }): void {
  const stream = createReadStream(path, range);
  stream.on("error", () => { response.destroy(); });
  response.on("close", () => { stream.destroy(); });
  stream.pipe(response);
}
