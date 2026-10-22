import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The actual guard is exercised on adversarial miniature source trees.
// @ts-expect-error JS build tooling deliberately has no declaration file.
import { checkDependencies } from "../scripts/check-dependencies.mjs";

async function check(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "creator-deps-"));
  try {
    await mkdir(join(root, "src/client"), { recursive: true });
    for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
    return checkDependencies(root, { built: false }) as string[];
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("dependency architecture guard", () => {
  it("allows type-only cycles and browser-safe shared code", async () => {
    expect(await check({ "src/a.ts": 'import type { B } from "./b.ts"; export const a = 1;', "src/b.ts": 'import type { a } from "./a.ts"; export type B = typeof a;', "src/client/main.ts": 'import { a } from "../a.ts";' })).toEqual([]);
  });
  it("detects runtime cycles including dynamic imports", async () => {
    expect((await check({ "src/a.ts": 'export * from "./b.ts";', "src/b.ts": 'import("./a.ts");' })).some((e) => e.includes("Runtime cycle"))).toBe(true);
  });
  it("follows the client dependency chain into Node", async () => {
    expect((await check({ "src/a.ts": 'import { readFile } from "node:fs";', "src/client/main.ts": 'import "../a.ts";' })).some((e) => e.includes("Client reaches Node"))).toBe(true);
  });
  it("rejects shared logic importing UI or host services", async () => {
    expect((await check({ "src/videoSelection.ts": 'import "./client/main.ts";', "src/client/main.ts": 'export const a=1;' })).some((e) => e.includes("Shared logic crosses boundary"))).toBe(true);
  });
});
