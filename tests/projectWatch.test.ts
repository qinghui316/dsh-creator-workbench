import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { watch } from "node:fs";
import { startProjectWatch } from "../src/projectWatch.ts";
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn((...args: unknown[]) => String(args[0]).includes("never-resolving-location") ? new Promise(() => {}) : (actual.readdir as (...args: unknown[]) => unknown)(...args)) };
});
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), watch: vi.fn(() => { throw Object.assign(new Error("no native watcher"), { code: "ENOSYS" }); }) }));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const work of cleanup.splice(0)) await work(); vi.clearAllMocks(); });
it("closing before async startup finishes never attaches a late watcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "creator-watch-close-")); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const w = startProjectWatch({ parents: [root], projects: [], dataDir: root, onChange: vi.fn(), onDiscover: vi.fn(async () => {}) });
  w.close(); await w.ready; expect(watch).not.toHaveBeenCalled();
});
it("fallback sees both parent discovery and project files without traversing ordinary media trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "creator-watch-bounded-")), child = join(root, "child"), deep = join(root, "ordinary/deep/deeper"), state = join(root, "state");
  await mkdir(child); await mkdir(deep, { recursive: true }); await mkdir(state); await writeFile(join(root, "script.md"), "initial");
  const changed = vi.fn(), discover = vi.fn(async () => {});
  const w = startProjectWatch({ parents: [root], projects: [root, child], dataDir: state, onChange: changed, onDiscover: discover, interval: 30 });
  cleanup.push(async () => { w.close(); await rm(root, { recursive: true, force: true }); }); await w.ready;
  await writeFile(join(root, "script.md"), "outer project changed");
  await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 2500 }); expect(discover).not.toHaveBeenCalled(); changed.mockClear();
  await writeFile(join(deep, "unrelated.mp4"), "media subtree"); await new Promise(r => setTimeout(r, 500)); expect(changed).not.toHaveBeenCalled();
  await writeFile(join(state, "projects.json"), "registry snapshot"); await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 2500 }); expect(discover).not.toHaveBeenCalled();
  const marker = join(child, ".dsh-creator-workbench"); await mkdir(marker); await writeFile(join(marker, "project.json"), '{"schemaVersion":1,"creationId":"request"}');
  await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce(), { timeout: 2500 });
});
it("a stalled first location cannot stop healthy project fallback checks", async () => {
  const root=await mkdtemp(join(tmpdir(),"creator-watch-stall-"));await writeFile(join(root,"script.md"),"initial");
  const changed=vi.fn();const w=startProjectWatch({parents:[join(root,"never-resolving-location")],projects:[root],dataDir:join(root,"state"),onChange:changed,onDiscover:vi.fn(async()=>{}),interval:20,readTimeout:30});
  cleanup.push(async()=>{w.close();await rm(root,{recursive:true,force:true});});await w.ready;
  await writeFile(join(root,"script.md"),"healthy edit");await vi.waitFor(()=>expect(changed).toHaveBeenCalled(),{timeout:2000});
});
