import { spawn } from "node:child_process";

export function decodeOutput(chunks: readonly Uint8Array[]): string {
  const bytes = Buffer.concat(chunks);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("gb18030").decode(bytes); }
}
export function safeError(cause: unknown, secrets: readonly string[] = []): string {
  let text = cause instanceof Error ? cause.message : String(cause);
  for (const key of secrets) if (key) text = text.split(key).join("[已隐藏]");
  return text.replace(/((?:authorization|access_token|api[_-]?key|appsecret|secret)\s*[=:]\s*)[^\s&,"'}]+/gi, "$1[已隐藏]").slice(0, 1000);
}
export interface ProcessResult { code: number; stdout: string; stderr: string }
/** Private worker transport. Callers never log raw input/output; API credentials travel through stdin only. */
export function runProcess(command: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number; maxOutput?: number } = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error("操作已取消。")); return; }
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...options.env } });
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let bytes = 0, failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      // Kill only this owned invocation and its descendants; no process discovery.
      if (process.platform === "win32" && child.pid) { const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); killer.on("error", () => child.kill()); }
      else child.kill();
    };
    const abort = () => stop(new Error("操作已取消。"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop(new Error("操作超时，服务端结果可能尚未确认。")), options.timeout ?? 120_000); timer.unref();
    child.stdin.on("error", () => undefined); child.stdin.end(options.input ?? "");
    for (const [pipe, target] of [[child.stdout, stdout], [child.stderr, stderr]] as const) pipe.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > (options.maxOutput ?? 16 * 1024 * 1024)) stop(new Error("运行结果超过安全大小。")); else target.push(chunk); });
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); if (failure) reject(failure); else resolve({ code: code ?? 1, stdout: decodeOutput(stdout), stderr: decodeOutput(stderr) }); });
  });
}
