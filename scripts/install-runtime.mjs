import { createHash, randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCES = [
  { name: "video-publisher", repo: "oil-oil/video-publisher-skill", commit: "0d02cc5387b0bea0a43d5aa4e72a2c9502d05f94", sha256: "bfaad369267cc8dec11503488f5bfc980867c838e5f7524f1fe8bde66e13926c", subdir: "video-publisher" },
];
const exists = (file) => access(file).then(() => true, () => false);
async function copyRuntime(source, destination) {
  await cp(source, destination, { recursive: true, filter: (file) => !/(?:^|[/\\])(?:tests?|\.git|node_modules)(?:[/\\]|$)|\.(?:sh|command|dmg)$/i.test(file) });
}
export async function installRuntime(dataDir, root, python = "python") {
  const runtime = join(resolve(dataDir), "runtime"); await mkdir(runtime, { recursive: true });
  for (const source of SOURCES) {
    const target = join(runtime, `${source.name}-${source.commit.slice(0, 12)}`);
    const manifest = join(target, ".source.json");
    if (await exists(manifest) && JSON.parse(await readFile(manifest, "utf8")).commit === source.commit) continue;
    const staging = join(runtime, `staging-${randomUUID()}`); await mkdir(staging);
    try {
      const response = await fetch(`https://codeload.github.com/${source.repo}/tar.gz/${source.commit}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`依赖下载失败：${source.name} (${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error(`依赖校验失败：${source.name}`);
      const archive = join(staging, "source.tar.gz"); await writeFile(archive, bytes);
      const list = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", windowsHide: true });
      if (list.split(/\r?\n/).some((p) => p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes(".."))) throw new Error("依赖包路径无效。");
      execFileSync("tar", ["-xzf", archive, "-C", staging], { windowsHide: true });
      const top = (await readdir(staging, { withFileTypes: true })).find((e) => e.isDirectory()); if (!top) throw new Error("依赖包为空。");
      const extracted = join(staging, top.name), prepared = join(staging, "prepared");
      await copyRuntime(join(extracted, source.subdir), prepared);
      if (source.subdir) await cp(join(extracted, "LICENSE"), join(prepared, "LICENSE"));
      await writeFile(join(prepared, ".source.json"), JSON.stringify(source, null, 2));
      // Existing installations are never overwritten. A partial old install needs explicit repair.
      if (await exists(target)) throw new Error(`依赖目录不完整，请保留并移走后重试：${source.name}`);
      await rename(prepared, target);
    } finally {
      // staging is created below the verified runtime root and owned by this attempt.
      if (resolve(staging).startsWith(`${resolve(runtime)}${process.platform === "win32" ? "\\" : "/"}`)) await rm(staging, { recursive: true, force: true });
    }
  }
  const venv = join(runtime, "wewrite-python"), executable = join(venv, "Scripts", "python.exe");
  if (!await exists(executable)) execFileSync(python, ["-m", "venv", venv], { windowsHide: true, timeout: 180_000, stdio: "pipe" });
  const requirements = join(root, "vendor", "wewrite", "requirements.txt"), stamp = join(venv, "requirements.sha256");
  const digest = createHash("sha256").update(await readFile(requirements)).digest("hex");
  if (!await exists(stamp) || (await readFile(stamp, "utf8")).trim() !== digest) {
    execFileSync(executable, ["-m", "pip", "install", "--disable-pip-version-check", "-r", requirements], { windowsHide: true, timeout: 240_000, stdio: "pipe" });
    execFileSync(executable, ["-c", "import markdown,bs4,cssutils,requests,yaml,pygments"], { windowsHide: true, stdio: "pipe" });
    await writeFile(stamp, digest);
  }
  return { ok: true, runtime, sources: SOURCES.map(({ name, commit }) => ({ name, commit })) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await installRuntime(process.argv[2], resolve(fileURLToPath(new URL("..", import.meta.url))), process.argv[3] || "python"))); }
  catch { console.error("Windows 运行环境准备失败；请检查网络、Python 3.12 和目录权限后重试。"); process.exitCode = 1; }
}
