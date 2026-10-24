import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess, safeError } from "../src/production/process.ts";
import { pythonPath } from "../src/production/runtime.ts";
const python = process.env.CREATOR_TEST_PYTHON ?? pythonPath(join(homedir(), ".dsh-creator-workbench"));
describe("WeChat worker protocol", () => {
  it.skipIf(!existsSync(python))("renders safely, recovers acknowledged drafts without duplicates and requires explicit conflict resolution", async () => {
    const result = await runProcess(python, [resolve("tests/fixtures/wechat_worker_checks.py"), process.cwd()], { timeout: 30_000 });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, checks: expect.arrayContaining(["readback-recovery-no-duplicate", "remote-conflict", "explicit-update"]) });
  });
  it("redacts actual credentials and token-bearing error parameters", () => {
    const message = safeError(new Error("https://example.test/?access_token=test-token&appsecret=test-secret Authorization=Bearer-sensitive"), ["test-secret"]);
    expect(message).not.toContain("test-token"); expect(message).not.toContain("test-secret"); expect(message).not.toContain("Bearer-sensitive");
  });
});
