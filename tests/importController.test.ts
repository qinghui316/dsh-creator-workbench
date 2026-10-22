import { describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ instances: [] as Array<{ importJobs?: unknown; imports: { dispose: ReturnType<typeof vi.fn> } }> }));
vi.mock("../src/service.ts", () => ({ CreatorWorkbenchService: class {
  imports = { dispose: vi.fn() }; importJobs?: unknown;
  constructor() { harness.instances.push(this); }
} }));
import { apply } from "../src/index.ts";

describe("session-free import controller wiring", () => {
  it("attaches the business controller before accepting imports and disposes both on unload", () => {
    let attached = false;
    const detach = vi.fn(() => { attached = false; });
    const jobs = { attachController: vi.fn(() => { attached = true; return detach; }) };
    const cleanup: Array<() => void> = [];
    const ctx = { inject: (names: string[], callback: (context: unknown) => void) => {
      if (names.length === 1 && names[0] === "jobs") callback({ jobs, effect: (setup: () => () => void) => { cleanup.push(setup()); } });
    } };
    apply(ctx as never, {} as never);
    const service = harness.instances.at(-1)!;
    expect(attached).toBe(true); expect(jobs.attachController).toHaveBeenCalledWith("dsh-creator-workbench-video-import");
    expect(service.importJobs).toBe(jobs);
    for (const dispose of cleanup.reverse()) dispose();
    expect(service.imports.dispose).toHaveBeenCalledOnce(); expect(service.importJobs).toBeUndefined(); expect(detach).toHaveBeenCalledOnce();
  });
});
