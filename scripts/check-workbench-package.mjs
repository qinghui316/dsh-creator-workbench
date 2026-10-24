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
fail(manifest.name === "dsh-creator-workbench" && manifest.version === JSON.parse(readFileSync(resolve("package.json"), "utf8")).version, "Unexpected package identity");
fail(manifest.repository?.url === "git+https://github.com/qinghui316/dsh-creator-workbench.git", "Repository must be the real Fork");
fail(manifest.main === "./lib/index.js" && manifest.exports?.["./client"] === "./lib/client.js", "Missing runtime entry");
fail(manifest.dsh?.bundle?.patch === "./cordis.patch.yml", "Missing plugin patch");
fail(manifest.dsh.client.platform === "web" && manifest.dsh.client.inject.includes("dsh-desktop-workbenches"), "Missing Desktop provider dependency");
fail(!manifest.dependencies?.["@deepseek-ai/dsh-tools"], "Do not bundle a second host ToolRuntime");
fail(read("cordis.patch.yml").replaceAll("\r\n", "\n").trim() === "- insert:\n    - id: dsh-creator-workbench\n      name: dsh-creator-workbench", "Patch identity mismatch");
const runtimeFiles = [
  "lib/index.js", "lib/client.js", "lib/typert.host.js", "lib/collect-publish.mjs",
  "scripts/collect-publish.mjs", "scripts/ego-account.mjs", "scripts/ego-compat.mjs",
  "scripts/publisher-ego-bridge.mjs", "scripts/publisher-douyin-adapter.mjs", "scripts/publisher-xhs-details.mjs", "scripts/install-runtime.mjs",
  "scripts/publisher-bilibili-details.mjs",
  "scripts/publisher-bilibili-adapter.mjs",
  "vendor/wewrite/worker.py", "vendor/wewrite/converter.py", "vendor/wewrite/theme.py",
  "vendor/wewrite/requirements.txt", "vendor/wewrite/themes/claude-editorial.yaml",
  "vendor/wewrite/themes/professional-clean.yaml", "vendor/wewrite/LICENSE",
  "vendor/wewrite/SKILL.md", "vendor/wewrite/source-files.json", "vendor/wewrite/writing-config.example.yaml",
  "vendor/wewrite/references/writing-workflow.md", "vendor/wewrite/references/frameworks.md",
  "vendor/wewrite/references/writing-guide.md", "vendor/wewrite/references/content-enhance.md",
  "vendor/wewrite/references/seo-rules.md", "vendor/wewrite/references/exemplar-seeds.yaml",
  "vendor/wewrite/personas/midnight-friend.yaml", "vendor/wewrite/scripts/humanness_score.py",
  "THIRD_PARTY_NOTICES.md", "LICENSE", "README.md",
];
for (const path of runtimeFiles) {
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
  for (const file of runtimeFiles) fail(read(file) === readFileSync(resolve(file), "utf8"), `Tarball differs from current build: ${file}`);
  for (const file of entries.filter((entry) => /\.(?:m?js|py|md|json|ya?ml|svg)$/.test(entry))) fail(!/\bsk-[a-zA-Z0-9_-]{24,}\b/.test(read(file.slice("package/".length))), `Possible secret in ${file}`);
  console.log(JSON.stringify({ package: `${manifest.name}@${manifest.version}`, tarball, files: entries.length, sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"), status: "passed" }, null, 2));
} else console.log("Workbench manifest, entries, identity, credentials scan, and dependency boundaries passed.");
