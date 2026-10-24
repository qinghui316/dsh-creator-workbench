import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { registerProductionTools } from "../src/production/tools.ts";
import type { ProductionWorkflow } from "../src/production/workflow.ts";

describe("article input through the actual Harness tool output contract", () => {
  it.each([false, true])("returns lossless JSON and native image references (waiting=%s)", async (waiting) => {
    const ctx = new Context();
    ctx.provide("systemPrompt", { tools: () => () => undefined });
    const runtime = new ToolRuntime(ctx);
    const ref = { attachmentId: "a".repeat(64), mediaType: "image/jpeg", bytes: 40, width: 8, height: 8 };
    const saveImages = vi.fn(async () => waiting ? [] : [ref]);
    ctx.provide("attachments", { saveImages });
    const inputs = { task: { id: "request", status: "waiting-agent" }, rules: "WeWrite", outputDirectory: "E:/内容", ...(waiting ? { waiting: "等待转写", jobId: "job-1" } : { transcript: "真实文字", frames: [{ file: "frame-0.jpg", at: 1, data: Buffer.from("image") }] }) };
    registerProductionTools(ctx, { articleInputs: vi.fn(async () => inputs) } as unknown as ProductionWorkflow);
    const result = await runtime.execute({ callId: "test" as never, name: "creator_prepare_article", arguments: { id: "episode", folderPath: "E:/内容", taskId: "request" }, signal: new AbortController().signal });
    expect(result.isError).toBe(false);
    if (result.isError) throw new Error(JSON.stringify(result));
    expect(result.value).not.toHaveProperty("frames");
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
    expect(result.content.filter((part) => part.type === "image")).toEqual(waiting ? [] : [{ type: "image", attachment: ref }]);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(waiting ? "job-1" : "真实文字") });
  });
});
