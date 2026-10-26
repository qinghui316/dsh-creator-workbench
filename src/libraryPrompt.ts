import { PUBLISH_PLATFORM_DEFINITIONS, type PublishPlatform } from "./platforms.ts";

export interface LibraryPromptSource {
  libraryRoot: string;
  dataDir: string;
  cache?: { libraryRoot: string } | undefined;
  cachedScriptRules?: string | undefined;
  cachedEnabledPlatforms?: readonly string[] | undefined;
}

export function resolvePromptLibraryRoot(source: LibraryPromptSource): string {
  return source.cache?.libraryRoot ?? source.libraryRoot;
}

function enabledPlatformNames(platforms: readonly string[]): string {
  return platforms.map((key) => {
    if (Object.hasOwn(PUBLISH_PLATFORM_DEFINITIONS, key)) {
      return PUBLISH_PLATFORM_DEFINITIONS[key as PublishPlatform].name;
    }
    return key;
  }).join("、");
}

export function libraryConventionText(
  libraryRoot: string,
  dataDir: string,
  scriptRules?: string,
  enabledPlatforms?: readonly string[],
): string {
  const lines = [
    `创作者的项目内容以磁盘文件为准；默认新建保存位置是 ${libraryRoot}，项目还可以来自其他已保存位置。首次使用或能力不明确时先调用 creator_setup 做只读检查；用户问这个插件能做什么、怎么用，或你不确定下一步时，调用 creator_guide 获取带当前能力状态的完整指引。`,
    "先用 creator_list_projects 查看跨位置项目和稳定编号；新建在本次明确选择的父目录中生成 YYYY-MM-DD_可读标题。已有文件夹用 creator_add_project 直接加入，不加日期或额外嵌套。更换默认父目录只影响新建，不改变项目集合或会话。",
    "约定文件：topic.md 选题；script.md 口播脚本；公众号文章/<标题>.md 已转写文章，配图在 公众号文章/images/；publish-package.json 只放标题和 tags，不写平台长文案；*.mp4/*.mov 成片（_subtitled 为烧录版）；*.srt/*.ass 字幕；*_3x4.png *_4x3.png *_16x9.png 封面。",
    "读或改这些内容，用系统自带的列文件、读文件、写文件工具。需要视频候选与当前选择时调用 creator_get_content；被移除的视频只从工作台显示中隐藏，不能调用文件删除代替移除；封面和外部上传都使用同一当前视频，不按修改时间或字幕文件名换源。",
    "写或改 script.md 先用 creator_script_rules 读取已有偏好，遵循本次要求；缺少真正影响结果的信息时只问一个必要问题。长期偏好由用户明确后保存。",
    `插件工具只做文件做不到的事：配置工作台、按约定建文件夹、导入和选择视频、生成或烧录字幕、生成封面、同步已发布数据、整理文件夹名。项目登记和项目级选择在 ${dataDir}/projects.json，全局偏好在 ${dataDir}/overlay.json，不是正文；只经工作台工具操作登记。旧编号存在同名时必须同时提供准确 folderPath。`,
    "项目不分视频/图文模式。左侧自然语言与右侧人工操作共用 creator_production_state / creator_production_action。独立写文章先 prepare-article(source.kind=topic/materials/article)，再 creator_prepare_article、creator_save_article；视频来源用 source.kind=video。正常文件工具写的 Markdown/HTML 可用 register-article 登记。",
    "配图、封面、多图可无视频制作：generate-images 逐张指定 prompt/ratio/purpose/references；用 creator_read_images 查看真实图片，重试只处理失败项。用户已提出制作要求就连续执行，不要求点击右侧按钮。",
    "不同平台各建独立 save-publication 材料，明确 platform/type/title/body/tags/imageIds 及可选 video/articleId/articleFile/coverImageId。修改带 publicationId 和 expectedRevision；不改来源文章或其他平台材料。图片顺序就是 imageIds 的顺序。upload-publication 上传保存版本，最终发表仍由用户手动完成。",
    "自动发布（video-publisher skill）和已发布数据回收（creator_sync_publish）都依赖 Ego Browser；能力检查显示缺失时明确告诉用户，不要假装能同步。",
  ];
  if (enabledPlatforms !== undefined) {
    lines.push(
      enabledPlatforms.length === 0
        ? "当前没有启用发布平台。不要调用 video-publisher 或 creator_sync_publish。"
        : `当前启用平台：${enabledPlatformNames(enabledPlatforms)}。video-publisher 和 creator_sync_publish 只处理这些平台。`,
    );
  }
  if (scriptRules !== undefined && scriptRules.trim() !== "") {
    lines.push("", "当前脚本规则（人设）：", scriptRules.trim());
  }
  return lines.join("\n");
}

export interface LibraryPromptHost {
  get: (name: string) => unknown;
  on: (event: "system-prompt/assemble", listener: (
    assembly: { sections: Array<{ name: string; text: string }> },
    context: { agent?: { session: { id: string } } },
    next: () => Promise<unknown>,
  ) => Promise<unknown>) => () => void;
}

/** Read Desktop's durable ownership for every assembly; native sessions receive no private library context. */
export function registerLibraryPrompt(ctx: LibraryPromptHost, source: LibraryPromptSource): () => void {
  return ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    const id = context.agent?.session.id;
    const ownership = ctx.get("desktopWorkbenchOwnership") as {
      read: () => Promise<{ added: string[]; sessionBindings: Record<string, string> }>;
    } | undefined;
    const state = id === undefined || ownership === undefined ? undefined : await ownership.read().catch(() => undefined);
    if (id !== undefined && state?.added.includes("qinghui316/dsh-creator-workbench")
      && state.sessionBindings[id] === "qinghui316/dsh-creator-workbench") {
      assembly.sections.push({ name: "oil:library", text: libraryConventionText(
        resolvePromptLibraryRoot(source), source.dataDir, source.cachedScriptRules, source.cachedEnabledPlatforms,
      ) });
    }
    return next();
  });
}
