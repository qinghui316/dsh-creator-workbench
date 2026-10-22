// Read-only diagnostic. Run with the Desktop executable in ELECTRON_RUN_AS_NODE mode.
// No installation, profile changes, or application restart is performed.
import { createRequire } from "node:module";
import { access, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [resourcesArgument, homeArgument, generationArgument] = process.argv.slice(2);
if (!resourcesArgument || !homeArgument || !generationArgument) {
  throw new Error("Usage: diagnose-desktop-migration.mjs <Desktop resources> <DSH home> <generation directory>");
}
if (!process.versions.electron) throw new Error("Use Desktop's bundled Electron Node runtime for ASAR resolution.");
const resources = resolve(resourcesArgument);
const home = resolve(homeArgument);
const directory = resolve(generationArgument);
const archive = join(resources, "app.asar");
const dshEntryPath = join(archive, "node_modules/@deepseek-ai/dsh/lib/bin.js");
const installerPath = join(archive, "node_modules/dsh-desktop-market-installer/generations/installer.mjs");
const { verifyGenerationPeers } = await import(pathToFileURL(installerPath).href);
const generation = { ...JSON.parse(await readFile(join(directory, "generation.json"), "utf8")), directory };
const packageManifestPath = join(directory, "node_modules", generation.pluginName, "package.json");
const manifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
const hostRequire = createRequire(dshEntryPath);
const pluginRequire = createRequire(packageManifestPath);
const resolveFrom = (require, specifier) => {
  try { return { entry: require.resolve(specifier) }; }
  catch (error) { return { error: error.code }; }
};
const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies };
const entries = await Promise.all(Object.keys(dependencies).map(async (name) => {
  const host = resolveFrom(hostRequire, name);
  let version;
  try { version = JSON.parse(await readFile(join(archive, "node_modules", name, "package.json"), "utf8")).version; }
  catch { /* The root may intentionally export subpaths only. */ }
  return { name, required: dependencies[name], version, host, generation: resolveFrom(pluginRequire, name) };
}));
let closureExists = true;
try { await access(join(home, "profiles/node_modules")); } catch { closureExists = false; }
const report = {
  runtime: { node: process.version, electron: process.versions.electron },
  generation: { name: generation.pluginName, version: generation.version, sourceSpec: generation.sourceSpec },
  closureExists,
  entries,
  // This matches Desktop 0.12.1's migration call exactly.
  desktopMigration: await verifyGenerationPeers(home, generation),
  // A host anchor alone cannot repair a missing package-resolution fallback.
  hostAnchorOnly: await verifyGenerationPeers(home, generation, { dshEntryPath }),
};
// Isolated counterfactual: change the resolver in an in-memory copy of the
// shipped validator, while retaining its closure checks and dependency walk.
// Nothing is written back to Desktop, its profile, or the installed package.
let source = await readFile(installerPath, "utf8");
const original = "resolved = requireFromPackage.resolve(dependency)";
if (source.split(original).length !== 2) throw new Error("Unknown validator implementation; inspect before adapting this diagnostic.");
source = source.replace(original,
  "resolved = isHostSingleton(dependency) ? hostRequire.resolve(dependency) : requireFromPackage.resolve(dependency)");
for (const relative of ["../windows-hide-console.mjs", "./registry.mjs"]) {
  const absolute = pathToFileURL(resolve(installerPath, "..", relative)).href;
  source = source.replaceAll(`'${relative}'`, JSON.stringify(absolute));
}
const anchored = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
report.controlledHostResolution = await anchored.verifyGenerationPeers(home, generation, { dshEntryPath });
report.serverEntry = await realpath(pluginRequire.resolve(generation.pluginName));
console.log(JSON.stringify(report, null, 2));
