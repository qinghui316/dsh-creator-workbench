import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import type { CoverWorkflow } from "./workflow.ts";
import type { CoverPlan } from "./types.ts";

const scopeParameters = { id: { type: "string", required: true, description: "Exact episode id from the request." }, folderPath: { type: "string", required: true, description: "Exact confirmed episode folder." }, runId: { type: "string", required: true, description: "Bound cover run id from the request." } } as const;
const present = (title: string, rawInput: unknown) => ({ card: "generic" as const, title, kind: "execute" as const, rawInput });
const jsonOutput = { schema: { type: "json" } as const, render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: JSON.stringify(value) }] };

export function registerCoverTools(ctx: Context, workflow: CoverWorkflow): void {
  const tools = ctx.get("tools") as { register: (tool: ReturnType<typeof defineTool>) => void };
  const attachments = ctx.get("attachments") as AttachmentStore;
  tools.register(defineTool({
    name: "creator_prepare_cover",
    description: "Prepare the bound video frames and read them as actual image attachments. Follow oil-cover agent-native-flow and cover-rules at the returned paths. Use this session's multimodal model; no external analysis API. If you cannot see images, ask to select a vision-capable Harness model; never pretend to inspect them.",
    parameters: scopeParameters,
    output: { ...jsonOutput, render: (_args, result) => {
      const value = result as unknown as { run: unknown; context: string; rules: string; flow: string; images: Array<{ name: string; attachment: Awaited<ReturnType<AttachmentStore["saveImages"]>>[number] }> };
      return [{ type: "text" as const, text: JSON.stringify({ run: value.run, context: value.context, rules: value.rules, flow: value.flow, frameOrder: value.images.map((i) => i.name) }) }, ...value.images.map((i) => ({ type: "image" as const, attachment: i.attachment }))];
    } },
    presentCall: (args) => present("查看封面候选画面", args),
    execute: async (args, exec) => {
      const result = await workflow.prepare(args, args.runId, exec.signal);
      const refs = await attachments.saveImages(result.images.map((i) => ({ data: i.data, name: i.name, mediaType: "image/jpeg" as const })));
      return { ...result, images: result.images.map((i, index) => ({ name: i.name, attachment: refs[index]! })) } as never;
    },
  }));
  tools.register(defineTool({
    name: "creator_generate_cover",
    description: "Submit the analysis and full per-ratio prompts for the exact prepared run. Default reference mode passes selected real video frames to the configured image service. text mode requires an explicit user request accepting no reference images. Returns one Harness background job; job_output waits and job_kill cancels. Do not retry unconfirmed remote requests automatically. After completion call creator_read_cover_results, inspect actual images, then creator_review_cover for each version.",
    parameters: { ...scopeParameters, headline: { type: "string", required: true }, analysis: { type: "string", required: true }, frameIds: { type: "array", required: true, items: { type: "string" } }, mode: { type: "string", required: true, enum: ["reference", "text"] }, prompts: { type: "object", required: true, additionalProperties: false, properties: { "3x4": { type: "string" }, "4x3": { type: "string" }, "16x9": { type: "string" } } } },
    output: jsonOutput,
    presentCall: (args) => present("制作封面", args),
    execute: async (args, exec) => {
      const run = await workflow.start(args, args.runId, args as unknown as CoverPlan, undefined, false, exec.agent?.session.id);
      return { kind: "background", jobId: run.jobId, runId: run.id, status: run.status } as never;
    },
  }));
  tools.register(defineTool({
    name: "creator_read_cover_results", description: "Load this run's actual generated cover versions into model image context for visual review. Returns per-ratio success/failure, prompts and image attachments; do not assume all three succeeded.", parameters: scopeParameters,
    output: { ...jsonOutput, render: (_args, result) => {
      const r = result as unknown as { run: unknown; versions: unknown; images: Array<{ name: string; attachment: Awaited<ReturnType<AttachmentStore["saveImages"]>>[number] }> };
      return [{ type: "text" as const, text: JSON.stringify({ run: r.run, versions: r.versions, order: r.images.map((i) => i.name) }) }, ...r.images.map((i) => ({ type: "image" as const, attachment: i.attachment }))];
    } }, presentCall: (args) => present("检查封面结果", args),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted(); const state = await workflow.state(args), run = state.runs.find((r) => r.id === args.runId);
      if (!run) throw new Error("制作记录不存在。");
      const versions = state.versions.filter((v) => v.runId === run.id);
      const images = await Promise.all(versions.map(async (v) => { const image = await workflow.image(args, v.id); return { data: Buffer.from(image.base64, "base64"), name: `${v.id} ${v.ratio}`, mediaType: image.mime as "image/png" | "image/jpeg" | "image/webp" }; }));
      const refs = await attachments.saveImages(images);
      return { run, versions, images: images.map((i, index) => ({ name: i.name, attachment: refs[index]! })) } as never;
    },
  }));
  tools.register(defineTool({
    name: "creator_review_cover", description: "Save a concrete visual review only after reading this version's actual image. pass can select it as the current ratio; needs_changes preserves the existing selected cover. Describe text, ratio, composition and factual consistency. Do not claim pass when images cannot be viewed.",
    parameters: { id: scopeParameters.id, folderPath: scopeParameters.folderPath, versionId: { type: "string", required: true }, verdict: { type: "string", required: true, enum: ["pass", "needs_changes"] }, note: { type: "string", required: true }, select: { type: "boolean" } }, output: jsonOutput,
    presentCall: (args) => present("保存封面质检", args),
    execute: async (args, exec) => workflow.action({ ...args, action: "review", verdict: args.verdict as "pass" | "needs_changes" }, exec.signal) as never,
  }));
}
