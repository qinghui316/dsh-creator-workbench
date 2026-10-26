import { expect, it, vi } from "vitest";
import { directoryReply } from "../src/client/directoryReply.ts";
import { projectRecovery } from "../src/client/projectRecovery.ts";
it("an unrelated hanging historical session cannot block current project recovery", async () => {
  const changed = vi.fn(), recover = vi.fn((id: string) => id === "hung" ? new Promise(() => {}) : Promise.resolve());
  const r = projectRecovery({ bindings: () => ({ hung: { folder: "offline" }, current: { folder: "healthy" } }), owns: () => true, recover, changed, timeout: 80 });
  const history = r.history(); await r.one("current", "healthy"); expect(changed).toHaveBeenCalledOnce(); await history;
  expect(recover.mock.calls.filter(([id]) => id === "current")).toHaveLength(1);
});
it("timed-out late recovery does not grab navigation or emit another change", async () => {
  const changed = vi.fn(); let finish!: () => void;
  const r = projectRecovery({ bindings: () => ({}), owns: () => true, recover: () => new Promise<void>(resolve => { finish = resolve; }), changed, timeout: 10 });
  await r.one("old", "folder"); finish(); await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
});

it("directory communication times out without replaying a write",async()=>{
 const write=vi.fn(()=>new Promise(()=>{}));await expect(directoryReply(write(),10)).rejects.toThrow("暂未确认");expect(write).toHaveBeenCalledOnce();
});
