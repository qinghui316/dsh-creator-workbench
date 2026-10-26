import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";

import { normalizeEnabledPlatforms } from "./overlay.ts";
import { PUBLISH_PLATFORMS } from "./platforms.ts";
import { isPublishMark, isPublishPlatform } from "./publishStatus.ts";
import type { CreatorWorkbenchService } from "./service.ts";
import type { CreatorProfile, PublishPlatform } from "./types.ts";

interface ToolsContext {
  tools: { register: (tool: ToolDefinition) => void };
}

function signalOf(exec: { signal: AbortSignal }): AbortSignal {
  return exec.signal;
}

function compactText(title: string, detail: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: `${title}: ${detail}` }];
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as never;
}

function present(title: string, rawInput: unknown): { card: "generic"; title: string; kind: "other"; rawInput: unknown } {
  return { card: "generic", title, kind: "other", rawInput };
}

const JSON_VALUE = { type: "json" } as const;

export function registerCreatorTools(ctx: ToolsContext, service: CreatorWorkbenchService): void {
  ctx.tools.register(defineTool({
    name: "creator_get_content",
    description: "Read an episode's exact folderPath, video candidates, current video selection, local materials and task states. Do this before importing, selecting a video or preparing any external Skill input.",
    parameters: { id: { type: "string", required: true, description: "Stable project id; legacy folder name only when unambiguous." }, folderPath: { type: "string", description: "Exact directory for a legacy id or same-name projects." } },
    output: { schema: JSON_VALUE, render: (_args, value) => compactText("内容资料", JSON.stringify(value)) },
    presentCall: (args) => present("查看内容资料", args),
    execute: (args, exec) => service.getContent(args, signalOf(exec)).then(asJson),
  }));
  ctx.tools.register(defineTool({
    name: "creator_import_video",
    description: "Copy a user-selected local MP4/MOV into an episode without overwriting or moving the source. Returns a Harness jobId; use job_output/job_kill. Get the exact folderPath from creator_get_content first. Do not treat job start as completion.",
    parameters: {
      id: { type: "string", required: true },
      folderPath: { type: "string", required: true },
      sourcePath: { type: "string", required: true, description: "Absolute local video path supplied or confirmed by the user." },
      name: { type: "string", description: "Optional destination filename; no directory components." },
    },
    output: { schema: JSON_VALUE, render: (_args, value) => compactText("导入视频", JSON.stringify(value)) },
    presentCall: (args) => present("导入视频", args),
    execute: (args, exec) => service.startVideoImport(args, signalOf(exec)).then(asJson),
  }));
  ctx.tools.register(defineTool({
    name: "creator_select_video",
    description: "Explicitly select the current video from the episode candidates. Preview, cover and subtitle tools use this exact selection. Get folderPath and candidates from creator_get_content first.",
    parameters: {
      id: { type: "string", required: true }, folderPath: { type: "string", required: true }, name: { type: "string", required: true },
    },
    output: { schema: JSON_VALUE, render: (_args, value) => compactText("当前视频", JSON.stringify(value)) },
    presentCall: (args) => present("选择当前视频", args),
    execute: (args, exec) => service.selectVideo(args, signalOf(exec)).then(asJson),
  }));
  ctx.tools.register(defineTool({
    name: "creator_guide",
    description:
      "Self-bootstrap guide for this plugin. Call this when the user asks what this plugin does, "
      + "how to use it, or when you are unsure which step comes next. "
      + "Returns the full workflow (library, script rules, subtitles, covers, publish, data sync) "
      + "with the live capability status, including whether Ego Browser is available for auto-publish and data collection.",
    parameters: {},
    output: {
      schema: JSON_VALUE,
      render: (_args, value) => {
        const result = value as { status?: { capabilities?: Record<string, { state?: string }> } };
        const capabilities = Object.values(result.status?.capabilities ?? {});
        const ready = capabilities.filter((item) => item.state === "ready").length;
        return compactText("Guide", `${ready}/${capabilities.length} capabilities ready`);
      },
    },
    presentCall: (args) => present("Creator guide", args),
    execute: (_args, exec) => service.getCreatorGuide(signalOf(exec)).then(asJson),
  }));

  ctx.tools.register(defineTool({
    name: "creator_script_rules",
    description:
      "Read or update the creator's script rules (persona): tone, structure, audience, and taboos "
      + "that every script.md must follow. Omit text to read. Send text to save. Empty text clears. "
      + "Ask the user about their persona before writing rules for the first time; merge new long-term "
      + "preferences into the existing rules instead of replacing them.",
    parameters: {
      text: { type: "string", description: "Full script rules text. Omit to read. Empty string clears." },
    },
    output: {
      schema: JSON_VALUE,
      render: (_args, value) => {
        const settings = value as { scriptRules?: string };
        return compactText("Script rules", settings.scriptRules === undefined ? "not set" : "saved");
      },
    },
    presentCall: (args) => present("Script rules", args),
    async execute(args, exec) {
      const signal = signalOf(exec);
      if (typeof args.text !== "string") {
        return asJson(await service.getSettings({}, signal));
      }
      return asJson(await service.setScriptRules({ text: args.text }, signal));
    },
  }));

  ctx.tools.register(defineTool({
    name: "creator_setup",
    description:
      "Inspect the creator workspace, optional local capabilities, credential status, and current configuration. "
      + "Omit fields for a read-only diagnosis. Proposed changes are previewed unless apply=true. "
      + "Only use apply=true after the user confirms the exact directory and enabled platform changes.",
    parameters: {
      apply: { type: "boolean", description: "False previews changes. True saves them after user confirmation." },
      libraryRoot: { type: "string", description: "Existing absolute content directory, or a path starting with ~/." },
      enabledPlatforms: {
        type: "array",
        items: { type: "string", enum: PUBLISH_PLATFORMS },
        description: "Complete list of enabled platforms. Empty disables all platforms.",
      },
    },
    output: {
      schema: JSON_VALUE,
      render: (_args, value) => {
        const result = value as {
          applied?: boolean;
          status?: { capabilities?: Record<string, { state?: string }> };
        };
        const capabilities = Object.values(result.status?.capabilities ?? {});
        const ready = capabilities.filter((item) => item.state === "ready").length;
        return compactText(result.applied ? "Setup applied" : "Setup checked", `${ready}/${capabilities.length} capabilities ready`);
      },
    },
    presentCall: (args) => present("Creator setup", args),
    async execute(args, exec) {
      const request = {
        apply: args.apply === true,
        ...(typeof args.libraryRoot === "string" ? { libraryRoot: args.libraryRoot } : {}),
        ...(Array.isArray(args.enabledPlatforms)
          ? { enabledPlatforms: normalizeEnabledPlatforms(args.enabledPlatforms) }
          : {}),
      };
      return asJson(await service.configureCreator(request, signalOf(exec)));
    },
  }));

  ctx.tools.register(defineTool({
    name: "creator_list_projects", description: "List registered projects across all saved parent directories with exact paths and stable identities. Does not create folders, sessions or tasks. Settings include remembered parents and the creation default.",
    parameters: { query: { type: "string", description: "Optional title or directory search." } },
    output: { schema: JSON_VALUE, render: (_args, value) => compactText("项目", JSON.stringify(value)) },
    execute: (args, exec) => service.listContents({ query: args.query ?? "", filter: "all" }, signalOf(exec)).then(asJson),
  }));
  ctx.tools.register(defineTool({
    name: "creator_add_project", description: "Join the exact existing folder selected or explicitly requested by the user. Empty/read-only folders can be registered; files stay in place. Does not create a session or change the default parent. Rejoining restores the same project identity.",
    parameters: { path: { type: "string", required: true, description: "Exact absolute project folder." } },
    output: { schema: JSON_VALUE, render: (_args, value) => compactText("加入项目", JSON.stringify(value)) },
    execute: (args, exec) => service.addProject(args, signalOf(exec)).then(asJson),
  }));
  ctx.tools.register(defineTool({
    name: "creator_set_default_parent", description: "Remember and immediately use the user's explicitly selected existing parent as the creation default. Existing projects, files and tasks stay where they are; does not save other settings.",
    parameters: { path: { type: "string", required: true } },
    output: { schema: JSON_VALUE, render: (_args, value) => compactText("默认保存位置", JSON.stringify(value)) },
    execute: (args, exec) => service.setProjectLocation(args, signalOf(exec)).then(asJson),
  }));

  ctx.tools.register(defineTool({
    name: "creator_create_content",
    description:
      "Create a registered project in the explicitly chosen parent (or saved default), named YYYY-MM-DD_title. Returns a stable project id and exact directory. The parent override does not change the default. Reuse requestId when retrying.",
    parameters: {
      title: { type: "string", required: true, description: "Project title. Hyphens become spaces." },
      libraryRoot: { type: "string", description: "Explicit absolute parent directory for this creation only." },
      requestId: { type: "string", description: "Stable unique creation request identity; reuse for a retry." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          folderPath: { type: "string", required: true },
        },
      },
      render: (_args, value) => compactText("Created", value.id),
    },
    presentCall: (args) => present("Create content", args),
    execute: (args, exec) => {
      if (args.title.trim() === "") throw new Error("title is required");
      return service.createContent({ title: args.title, ...(args.libraryRoot ? { libraryRoot: args.libraryRoot } : {}), ...(args.requestId ? { requestId: args.requestId } : {}) }, signalOf(exec));
    },
  }));

  ctx.tools.register(defineTool({
    name: "creator_update_content",
    description:
      "Write overlay-only publish marks for one episode: "
      + "or set a platform publish status. To change topic.md or script.md, write those files "
      + "in the episode folder with the built-in file tools.",
    parameters: {
      id: { type: "string", required: true, description: "Folder id." },
      publishPlatform: {
        type: "string",
        enum: PUBLISH_PLATFORMS,
        description: "Platform to mark. Pair with publishStatus.",
      },
      publishStatus: {
        type: "string",
        enum: ["unpublished", "draft", "published"],
        description: "Per-platform publish mark stored in the plugin overlay.",
      },
      publishUrl: { type: "string", description: "Optional live URL when status is published." },
    },
    output: {
      schema: JSON_VALUE,
      render: (_args, value) => {
        const record = value as { title?: string; id?: string };
        return compactText("Updated", record.title || record.id || "");
      },
    },
    presentCall: (args) => present("Update content", args),
    async execute(args, exec) {
      const signal = signalOf(exec);
      if (args.id === "") throw new Error("id is required");
      const hasPlatform = args.publishPlatform !== undefined;
      const hasStatus = args.publishStatus !== undefined;
      if (hasPlatform !== hasStatus) {
        throw new Error("publishPlatform and publishStatus must be sent together");
      }
      if (isPublishPlatform(args.publishPlatform) && isPublishMark(args.publishStatus)) {
        await service.setPublish(
          args.publishUrl === undefined
            ? { id: args.id, platform: args.publishPlatform, status: args.publishStatus }
            : { id: args.id, platform: args.publishPlatform, status: args.publishStatus, url: args.publishUrl },
          signal,
        );
      }
      return asJson(await service.getContent({ id: args.id }, signal));
    },
  }));

  ctx.tools.register(defineTool({
    name: "creator_profile",
    description:
      "Read or update the list of enabled publishing platforms. "
      + "Omit the list to read. Send the complete list to replace it.",
    parameters: {
      enabledPlatforms: {
        type: "array",
        items: { type: "string", enum: PUBLISH_PLATFORMS },
        description: "Complete list of enabled platforms. Empty disables all platforms.",
      },
    },
    output: {
      schema: JSON_VALUE,
      render: () => compactText("Profile", "saved"),
    },
    presentCall: (args) => present("Creator profile", args),
    async execute(args, exec) {
      const signal = signalOf(exec);
      const current = (await service.getSettings({}, signal)).profile;
      if (!Array.isArray(args.enabledPlatforms)) return asJson(current);
      const next: CreatorProfile = {
        enabledPlatforms: normalizeEnabledPlatforms(args.enabledPlatforms),
      };
      return asJson((await service.setProfile({ profile: next }, signal)).profile);
    },
  }));

  ctx.tools.register(defineTool({
    name: "creator_organize_library",
    description:
      "Preview or apply library folder cleanup to YYYY-MM-DD_readable title. "
      + "Adds a date from the recording/folder time when missing, and turns hyphens/underscores in titles into spaces. "
      + "Never deletes files. apply=false (default) only previews. Pass ids to limit the batch.",
    parameters: {
      libraryRoot: { type: "string", description: "Exact parent directory. Required for apply; only registered projects in it participate." },
      apply: { type: "boolean", description: "False previews. True renames folders." },
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Optional registered project ids to organize within the explicitly chosen parent.",
      },
    },
    output: {
      schema: JSON_VALUE,
      render: (_args, value) => {
        const record = value as { moves?: unknown[] };
        const moves = Array.isArray(record.moves) ? record.moves : [];
        return compactText("Organize", `${moves.length} moves`);
      },
    },
    presentCall: (args) => present("Organize library", args),
    execute: async (args, exec) => asJson(await service.organizeLibrary({
      apply: args.apply === true,
      ...(args.libraryRoot ? { libraryRoot: args.libraryRoot } : {}),
      ids: args.ids ?? [],
    }, signalOf(exec))),
  }));

  ctx.tools.register(defineTool({
    name: "creator_sync_publish",
    description:
      "Sync published titles, URLs, and counts from logged-in creator dashboards. "
      + "Pass id to update one episode only and stop paging once that title is found. "
      + "Omit id to match the whole library and collect every page. "
      + "Requires Ego Lite and an already-logged-in creator session. "
      + "Repeats within 90 seconds reuse the last snapshot.",
    parameters: {
      id: {
        type: "string",
        description: "Folder id of one episode. Omit to sync the whole library.",
      },
      platform: {
        type: "string",
        enum: PUBLISH_PLATFORMS,
        description: "Collect only this platform. Omit to visit all enabled platforms.",
      },
      force: {
        type: "boolean",
        description: "Skip the 90-second cache and open creator pages again.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          matched: { type: "integer", required: true },
          platforms: { type: "json", required: true },
          cached: { type: "boolean" },
        },
      },
      render: (_args, value) => compactText("Sync publish", `${value.matched} matched`),
    },
    presentCall: (args) => present("Sync publish", args),
    execute: (args, exec) => {
      const request: {
        id?: string;
        platform?: PublishPlatform;
        force?: boolean;
      } = {};
      if (args.id !== undefined && args.id !== "") request.id = args.id;
      if (isPublishPlatform(args.platform)) request.platform = args.platform;
      if (args.force === true) request.force = true;
      return service.syncPublish(request, signalOf(exec));
    },
  }));



  ctx.tools.register(defineTool({
    name: "creator_open_subtitle_preview",
    description:
      "Open the oil-subtitle preview editor in the browser for this episode (video + editable cues).",
    parameters: {
      id: { type: "string", required: true, description: "Folder id." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          port: { type: "integer", required: true },
        },
      },
      render: (_args, value) => compactText("Subtitle preview", value.url),
    },
    presentCall: (args) => present("Subtitle preview", args),
    execute: (args, exec) => {
      if (args.id === "") throw new Error("id is required");
      return service.openSubtitlePreview({ id: args.id }, signalOf(exec));
    },
  }));

}
