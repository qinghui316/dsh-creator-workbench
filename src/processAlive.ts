import { execFileSync } from "node:child_process";

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function pidCommand(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    const executable = process.platform === "win32" ? "powershell.exe" : "ps";
    const args = process.platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); (Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`]
      : ["-p", String(pid), "-o", "command="];
    const command = execFileSync(executable, args, {
      encoding: "utf8",
      timeout: process.platform === "win32" ? 5_000 : 500,
      windowsHide: true,
    }).trim();
    return command === "" ? undefined : command;
  } catch {
    return undefined;
  }
}

export function pidLooksLike(pid: number, fragment: string): boolean {
  const command = pidCommand(pid);
  if (command === undefined) return false;
  return command.includes(fragment);
}

export function jobPidMatches(pid: number | undefined, fragments: readonly string[]): boolean {
  if (pid === undefined) return false;
  if (!pidAlive(pid)) return false;
  const command = pidCommand(pid);
  // A failed command-line lookup is not proof of ownership. Treating it as a
  // match could send SIGTERM/SIGKILL to an unrelated process after PID reuse.
  if (command === undefined) return false;
  return fragments.some((fragment) => command.includes(fragment));
}

export function jobPidStillOurs(pid: number | undefined, fragment: string): boolean {
  return jobPidMatches(pid, [fragment]);
}

export async function waitForPidExit(
  pid: number,
  fragments: readonly string[],
  timeoutMs = 2_000,
  intervalMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!jobPidMatches(pid, fragments)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return !jobPidMatches(pid, fragments);
}

export async function terminateOwnedProcess(
  pid: number | undefined,
  fragments: readonly string[],
  termTimeoutMs = 2_000,
  killTimeoutMs = 1_000,
): Promise<boolean> {
  if (pid === undefined || !jobPidMatches(pid, fragments)) return true;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may have exited after the ownership check.
  }
  await waitForPidExit(pid, fragments, termTimeoutMs);
  if (jobPidMatches(pid, fragments)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited after the second ownership check.
    }
    await waitForPidExit(pid, fragments, killTimeoutMs);
  }
  return !jobPidMatches(pid, fragments);
}
