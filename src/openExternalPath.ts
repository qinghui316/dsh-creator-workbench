import { spawn } from "node:child_process";
import { win32 } from "node:path";

/** Hand a validated local path or URL to the OS default application. */
export function openExternalPath(path: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  return new Promise((resolve, reject) => {
    const windows = platform === "win32";
    const command = windows ? "explorer.exe" : platform === "darwin" ? "open" : "xdg-open";
    const target = windows && !/^https?:\/\//i.test(path) ? win32.normalize(path) : path;
    const child = spawn(command, [target], { stdio: "ignore", windowsHide: true, ...(windows ? { detached: true } : {}) });
    child.once("error", reject);
    if (windows) {
      // Explorer delegates to the shell and may return 1 after a successful handoff.
      // Its exit code and lifetime do not describe the opened file/viewer.
      child.once("spawn", () => { child.unref(); resolve(); });
    } else {
      child.once("exit", (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`${command} failed: ${code}`));
      });
    }
  });
}
