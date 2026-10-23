import { registerCoverTools } from "./covers/tools.ts";
import type { Context } from "@deepseek-ai/cordis";

import { Config } from "./config.ts";
import { registerCreatorJobTools } from "./backgroundJobs.ts";
import { registerCreatorWorkbenchSkill } from "./creatorSkill.ts";
import { registerLibraryPrompt } from "./libraryPrompt.ts";
import { CreatorWorkbenchService } from "./service.ts";
import { registerCreatorSettingsNamespace } from "./settingsHost.ts";
import { registerCreatorTools } from "./tools.ts";
import { registerVisualReviewTools } from "./visualReview.ts";

export const name = "dsh-creator-workbench";
export { Config };
export type { Config as ConfigType } from "./config.ts";

export function apply(ctx: Context, config: Config): void {
  const service = new CreatorWorkbenchService(ctx, config);
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.effect(() => registerCreatorSettingsNamespace(settingsCtx.settings));
  });
  ctx.inject(["tools"], (toolsCtx) => {
    registerCreatorTools(toolsCtx as never, service);
  });
  ctx.inject(["jobs"], (jobsCtx) => {
    // The business panel is the controller for unowned, session-free imports.
    // Use the public host seam; agent-scoped job tools cannot serve these jobs.
    jobsCtx.effect(() => jobsCtx.jobs.attachController("dsh-creator-workbench-video-import"));
    service.importJobs = jobsCtx.jobs;
    jobsCtx.effect(() => () => { service.imports.dispose(); service.importJobs = undefined; });
  });
  ctx.inject(["tools", "jobs"], (jobsCtx) => {
    registerCreatorJobTools(jobsCtx as never, service);
  });
  ctx.inject(["tools", "attachments"], (visualCtx) => {
    registerVisualReviewTools(visualCtx as never, service);
    registerCoverTools(visualCtx, service.covers);
  });
  ctx.inject(["systemPrompt"], (promptCtx) => {
    registerLibraryPrompt(promptCtx as never, service);
  });
  ctx.inject(["skills"], (skillsCtx) => {
    registerCreatorWorkbenchSkill(skillsCtx as never);
  });
}
