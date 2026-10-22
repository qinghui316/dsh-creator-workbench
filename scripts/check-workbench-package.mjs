import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { checkDependencies } from "./check-dependencies.mjs";

const tarball = process.argv[2] && resolve(process.argv[2]);
const read = (path) => tarball
  ? execFileSync("tar", ["-xOzf", tarball, `package/${path}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  : readFileSync(resolve(path), "utf8");
const fail = (condition, message) => { if (!condition) throw new Error(message); };
const manifest = JSON.parse(read("package.json"));
fail(manifest.name === "dsh-creator-workbench" && manifest.version === "0.1.0", "Unexpected package identity");
fail(manifest.repository?.url === "git+https://github.com/qinghui316/dsh-creator-workbench.git", "Repository must be the real Fork");
fail(manifest.main === "./lib/index.js" && manifest.exports?.["./client"] === "./lib/client.js", "Missing runtime entry");
fail(manifest.dsh?.bundle?.patch === "./cordis.patch.yml", "Missing plugin patch");
fail(manifest.dsh.client.platform === "web" && manifest.dsh.client.inject.includes("dsh-desktop-workbenches"), "Missing Desktop provider dependency");
fail(!manifest.dependencies?.["@deepseek-ai/dsh-tools"], "Do not bundle a second host ToolRuntime");
fail(read("cordis.patch.yml").replaceAll("\r\n", "\n").trim() === "- insert:\n    - id: dsh-creator-workbench\n      name: dsh-creator-workbench", "Patch identity mismatch");
for (const path of ["lib/index.js", "lib/client.js", "lib/typert.host.js", "lib/collect-publish.mjs", "LICENSE", "README.md"]) {
  const text = read(path);
  fail(text.length > 0, `Empty file: ${path}`);
  fail(!/\bsk-[a-zA-Z0-9_-]{24,}\b/.test(text), `Possible secret in ${path}`);
  fail(!text.includes(process.cwd()), `Local workspace path in ${path}`);
}
const errors = checkDependencies(process.cwd());
fail(errors.length === 0, errors.join("\n"));
if (tarball) {
  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split(/\r?\n/);
  fail(entries.every((file) => file.startsWith("package/") && !/(?:^|\/)(?:\.agents|\.claude|\.git|node_modules|\.env|\.npmrc|overlay\.json)(?:\/|$)|\.map$/.test(file)), "Unexpected private or development file in tarball");
  for (const file of ["lib/index.js", "lib/client.js", "lib/typert.host.js", "lib/collect-publish.mjs"]) fail(read(file) === readFileSync(resolve(file), "utf8"), `Tarball differs from current build: ${file}`);
  console.log(JSON.stringify({ package: `${manifest.name}@${manifest.version}`, tarball, files: entries.length, sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"), status: "passed" }, null, 2));
} else console.log("Workbench manifest, entries, identity, credentials scan, and dependency boundaries passed.");
