import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { registerProductionTools } from "../src/production/tools.ts";
import type { ProductionWorkflow } from "../src/production/workflow.ts";

describe("article input through the actual Harness tool output contract", () => {
  it("returns a compact revision receipt instead of HTML/Base64 through the actual Agent renderer", async () => {
    const ctx=new Context();ctx.provide("systemPrompt",{tools:()=>()=>undefined});const runtime=new ToolRuntime(ctx);ctx.provide("attachments",{saveImages:vi.fn()});
    const saved={article:{id:"saved",file:"saved.md",createdAt:1,frameFiles:[]},sourceHash:"hash",source:"source body",preview:{path:"preview.html",html:'<img src="data:image/png;base64,'+'A'.repeat(100000)+'">'}};
    registerProductionTools(ctx,{editArticleVersion:vi.fn(async()=>saved)} as unknown as ProductionWorkflow);
    const result=await runtime.execute({callId:"save" as never,name:"creator_save_article_revision",arguments:{id:"episode",folderPath:"E:/内容",articleId:"base",expectedSourceHash:"base-hash",source:"edited",saveId:"stable-save"},signal:new AbortController().signal});
    expect(result.isError).toBe(false);if(result.isError)throw new Error(JSON.stringify(result));
    expect(result.value).toMatchObject({article:{id:"saved"},previewPath:"preview.html"});expect(result.value).not.toHaveProperty("preview");expect(JSON.stringify(result.content)).not.toContain("base64");expect(JSON.stringify(result.content).length).toBeLessThan(1000);
  });
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
