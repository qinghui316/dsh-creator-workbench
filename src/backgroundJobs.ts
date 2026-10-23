import type { JobHooks, JobId, JobOutcome, JobRegistry, JobSpec } from "@deepseek-ai/dsh-jobs";
import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";

import type { CreatorWorkbenchService } from "./service.ts";

declare module "@deepseek-ai/dsh-jobs" {
  interface JobKindMap {
    "creator-media": "creator-media";
  }
}

interface JobToolsContext {
  jobs: JobRegistry;
  tools: { register: (tool: ToolDefinition) => void };
}

type MediaField = "burn" | "subtitleJob" | "coverJob";

const BACKGROUND_OUTPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", required: true, const: "background" },
    jobId: { type: "string", required: true },
  },
} as const;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function present(title: string, rawInput: unknown) {
  return { card: "generic" as const, title, kind: "execute" as const, rawInput };
}

function backgroundOutput() {
  return {
    schema: BACKGROUND_OUTPUT,
    render: (_args: unknown, value: { kind: "background"; jobId: string }) => [{
      type: "text" as const,
      text: `started background job ${value.jobId}`,
    }],
  };
}

async function assertMediaIdle(
  service: CreatorWorkbenchService,
  id: string,
  fields: readonly MediaField[],
  signal: AbortSignal,
): Promise<void> {
  const detail = await service.getContent({ id }, signal);
  const running = fields.find((field) => detail[field].status === "running");
  if (running !== undefined) throw new Error(`${id}: ${running} is already running`);
}

function startExclusiveJob(
  jobs: JobRegistry,
  active: Set<string>,
  key: string,
  spec: Omit<JobSpec, "run">,
  run: () => JobHooks,
): JobId {
  if (active.has(key)) throw new Error(`${key}: background job is already running`);
  try {
    return jobs.start({
      ...spec,
      run: () => {
        if (active.has(key)) throw new Error(`${key}: background job is already running`);
        const hooks = run();
        active.add(key);
        void hooks.done.then(
          () => { active.delete(key); },
          () => { active.delete(key); },
        );
        return hooks;
      },
    });
  } catch (cause) {
    if (message(cause).includes("no job controller")) {
      throw new Error("background jobs unavailable: use the Harness standard or code preset with @deepseek-ai/dsh-tool-jobs");
    }
    throw cause;
  }
}

function mediaHooks(
  service: CreatorWorkbenchService,
  id: string,
  field: MediaField,
  start: (signal: AbortSignal) => Promise<unknown>,
): JobHooks {
  const controller = new AbortController();
  const done = (async (): Promise<JobOutcome> => {
    try {
      await start(controller.signal);
      const job = await service.waitForMediaJob(id, field, controller.signal);
      if (job.status === "done") {
        return { status: "completed", detail: field, result: job.output ?? `${id}: completed` };
      }
      return { status: "failed", detail: field, result: job.error ?? `${id}: failed` };
    } catch (cause) {
      if (controller.signal.aborted) {
        try {
          await service.cancelMediaJob(id, field);
        } catch (cleanupCause) {
          return { status: "failed", detail: "cancel cleanup failed", result: message(cleanupCause) };
        }
        return { status: "killed", detail: field, result: `${id}: cancelled` };
      }
      return { status: "failed", detail: field, result: message(cause) };
    }
  })();
  return {
    cancel: (reason) => {
      if (!controller.signal.aborted) controller.abort(new Error(reason ?? "cancelled"));
    },
    done,
  };
}

export function registerCreatorJobTools(ctx: JobToolsContext, service: CreatorWorkbenchService): void {
  const active = new Set<string>();

  ctx.tools.register(defineTool({
    name: "creator_burn_subtitles",
    description:
      "Burn the confirmed subtitle draft as a Harness background job. "
      + "Open and confirm the subtitle preview first; use job_output with wait=true or job_kill for control.",
    parameters: { id: { type: "string", required: true, description: "Folder id." } },
    output: backgroundOutput(),
    presentCall: (args) => present("Burn subtitles", args),
    execute: async (args, exec) => {
      if (args.id.trim() === "") throw new Error("id is required");
      exec.signal.throwIfAborted();
      await assertMediaIdle(service, args.id, ["burn"], exec.signal);
      const jobId = startExclusiveJob(ctx.jobs, active, `${args.id}:burn`, {
        kind: "creator-media",
        label: `Burn subtitles: ${args.id}`,
        ...(exec.agent === undefined ? {} : { owner: exec.agent.session.id }),
      }, () => mediaHooks(service, args.id, "burn", (signal) =>
        service.startSubtitleBurn({ id: args.id }, signal)));
      return { kind: "background" as const, jobId };
    },
  }));

  ctx.tools.register(defineTool({
    name: "creator_generate_subtitles",
    description:
      "Transcribe, review, and lay out subtitle drafts as a Harness background job. "
      + "Completion opens the preview editor; use job_output with wait=true or job_kill for control.",
    parameters: { id: { type: "string", required: true, description: "Folder id." } },
    output: backgroundOutput(),
    presentCall: (args) => present("Generate subtitles", args),
    execute: async (args, exec) => {
      if (args.id.trim() === "") throw new Error("id is required");
      exec.signal.throwIfAborted();
      await assertMediaIdle(service, args.id, ["subtitleJob", "burn"], exec.signal);
      const jobId = startExclusiveJob(ctx.jobs, active, `${args.id}:subtitleJob`, {
        kind: "creator-media",
        label: `Generate subtitles: ${args.id}`,
        ...(exec.agent === undefined ? {} : { owner: exec.agent.session.id }),
      }, () => mediaHooks(service, args.id, "subtitleJob", (signal) =>
        service.startSubtitleGenerate({ id: args.id }, signal)));
      return { kind: "background" as const, jobId };
    },
  }));

}
