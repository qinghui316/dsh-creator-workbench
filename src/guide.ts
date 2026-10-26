import { PUBLISH_PLATFORM_DEFINITIONS } from "./platforms.ts";
import type { CreatorCapability, CreatorSetupStatus, PublishPlatform } from "./types.ts";

function stateMark(capability: CreatorCapability): string {
  if (capability.state === "ready") return "可用";
  if (capability.state === "unsupported") return "当前系统不支持";
  return "缺失";
}

function capabilityLine(label: string, capability: CreatorCapability): string {
  return `- ${label}：${stateMark(capability)}。${capability.detail}`;
}

function subtitleLines(capabilities: CreatorSetupStatus["capabilities"]): string[] {
  const lines: string[] = [];
  if (capabilities.subtitleSkill.state !== "ready") lines.push("- 视频转文字需要 Windows 和 FFmpeg；请按当前能力提示补齐依赖。");
  if (capabilities.subtitleCredential.state !== "ready") lines.push("- 请在工作台设置 → 语音转文字配置火山语音 API Key，不要把 Key 发到对话。");
  return lines.length ? lines : ["- 本地提取与凭据已准备；实际识别结果仍需验证。"];
}

function coverLines(capabilities: CreatorSetupStatus["capabilities"]): string[] {
  const lines: string[] = [];
  if (capabilities.coverSkill.state !== "ready") {
    lines.push("- 缺 oil-cover：征得用户同意后执行 `git clone https://github.com/oil-oil/oil-cover ~/.agents/skills/oil-cover`，装完重新调用 creator_setup 确认。");
  }
  if (capabilities.coverCredential.state !== "ready") {
    lines.push("- 缺生图服务凭据：让用户在工作台的数据与设置填写所选服务的地址、模型和 API Key；不要让用户把 Key 明文发到对话里。");
  }
  return lines.length === 0 ? ["- 当前封面能力可用。"] : lines;
}

function publishPlatformLine(enabledPlatforms: readonly PublishPlatform[]): string {
  if (enabledPlatforms.length === 0) {
    return "- 当前 enabledPlatforms 为空（[]）：不要调用 video-publisher，也不要调用 creator_sync_publish；先用 creator_setup 配置启用平台，用户确认后再继续。";
  }
  const names = enabledPlatforms
    .map((platform) => `${PUBLISH_PLATFORM_DEFINITIONS[platform].name}（${platform}）`)
    .join("、");
  return `- 当前 enabledPlatforms：${names}。video-publisher 与 creator_sync_publish 只处理这些平台，不得上传或同步其他平台。`;
}

/**
 * Build the self-bootstrap guide for the model. The text reflects the live
 * capability status so the model can tell the user exactly which parts of the
 * workflow work on this machine and which need installation or credentials.
 */
export function creatorGuideText(status: CreatorSetupStatus): string {
  const { capabilities, settings } = status;
  const scriptRules = settings.scriptRules;
  const enabledPlatforms = settings.profile.enabledPlatforms;
  const lines: string[] = [
    "# 内容工作台自举指引",
    "",
    "用户在 DeepSeek Harness 里安装了内容工作台插件。你的任务是在同一项目中协助用户制作脚本、视频、文章和配图，并独立准备各平台发布材料，并在能力缺失时明确告诉用户缺什么、怎么补。先把下面的现状转成用户听得懂的话，不要逐字复述。",
    "",
    "## 当前能力状态",
    capabilityLine("默认新建保存位置", capabilities.library),
    capabilityLine("Windows 视频转文字", capabilities.subtitleSkill),
    capabilityLine("火山语音凭据", capabilities.subtitleCredential),
    capabilityLine("封面工作流 oil-cover", capabilities.coverSkill),
    capabilityLine("生图服务凭据", capabilities.coverCredential),
    capabilityLine("Ego Browser（自动发布与数据回收）", capabilities.publishSync),
    capabilityLine("发布 skill video-publisher", capabilities.publishSkill),
    capabilityLine("公众号写作 WeWrite", capabilities.articleSkill),
    "",
    "## 内容管理",
    `- 默认新建保存位置是 ${settings.libraryRoot}；新建项目采用 YYYY-MM-DD_可读标题。creator_list_projects 汇总各位置的项目，更换默认位置不会清空列表。`,
    "- 使用已有目录直接加入所选文件夹，不移动或嵌套；同名项目使用稳定编号和准确目录区分。",
    "- 正文以磁盘文件为准：topic.md 选题、script.md 口播脚本、公众号文章/ 图文稿、*.mp4 成片、*.srt/*.ass 字幕、*_3x4.png 等封面。读和改这些文件用系统自带的文件工具。",
    "- 新建一集用 creator_create_content；文件夹名乱了用 creator_organize_library，指定明确父目录并先预览、用户确认后再 apply=true。它只改名，不删文件。",
    "- 工作台自己的状态（绑定、阶段、发布标记）在 projects.json，全局偏好在 overlay.json，不是正文，不要手改。",
    "",
    "## 脚本与人设",
    "- 每集的口播脚本在 script.md，直接用文件工具读写。",
    scriptRules === undefined
      ? "- 当前没有配置脚本规则（人设）。用户第一次让你写或改脚本时，先主动问清语气、结构、禁忌和目标观众，再用 creator_script_rules 存下来，之后每次写脚本都遵循。"
      : "- 已配置脚本规则（人设），写或改 script.md 前先用 creator_script_rules 读取并严格遵循；用户提出新的长期偏好时，把它合并进规则再保存。",
    "",
    "## 字幕",
    "- 脚本和字幕都是可选资料。视频转文章优先使用匹配字幕，缺少时调用火山录音文件识别；在字幕页查看或导入，原始识别结果保留。",
    "- creator_generate_subtitles 是 Harness 后台任务。保存返回的 job id，用 job_output 的 wait=true 等待并获取完成结果、job_kill 取消；不要把启动说成完成。完成以工作台任务和带时间轴的实际文字/SRT 为准。",
    ...subtitleLines(capabilities),
    "",
    "## 封面",
    "- creator_generate_cover 前先按 oil-cover 从脚本或字幕提炼封面主标题，通过 title 传入；不要把文件夹名直接当封面结论。它返回 Harness job id，用 job_output（需要等待时传 wait=true）/ job_kill 管理。",
    "- 封面任务完成后调用 creator_prepare_visual_review，把三画幅作为图片附件检查构图、可读性、安全区、画幅适配和品牌一致性；随后调用 creator_save_visual_review，把具体结论写入该期目录。",
    ...coverLines(capabilities),
    "",
    "## 视频导入",
    "- 通过工作台导入 MP4 或 MOV，原文件保留。多个视频时先选择当前视频；字幕可选。需要 AI 协助时再打开原生对话。",
    "",
    "## 自动发布与数据回收",
    "- 这两项都依赖 Ego Browser Windows 版和已登录的各平台创作者后台；在发布设置中打开登录、检查并连接实际账号。发现命令不代表已通过上传验收。",
    publishPlatformLine(enabledPlatforms),
    capabilities.publishSync.state === "ready"
      ? enabledPlatforms.length === 0
        ? "- 已发现 Ego Browser，但当前没有启用平台，不执行自动发布和数据回收。"
        : "- 当前已发现 Ego Browser。上传通过工作台 creator_production_action 调用锁定版本 video-publisher，精确绑定视频、封面和账号；停在最终发表按钮前由用户点。只有用户要求时，用 creator_sync_publish 或 refresh-metrics 手动回收数据。"
      : "- 当前未发现 Ego Browser：自动发布和 creator_sync_publish 数据回收都不可用。告诉用户到 https://www.egolite.ai/download 下载 Windows 版，完成首次引导后再登录平台；片库、脚本、字幕、封面不受影响，不要假装能同步。",
    capabilities.publishSkill.state === "ready"
      ? enabledPlatforms.length === 0
        ? "- 已发现 video-publisher，但当前没有启用平台，不使用它。"
        : "- 已发现 video-publisher。"
      : enabledPlatforms.length === 0
        ? "- 当前没有启用平台，先配置 enabledPlatforms，再考虑安装 video-publisher。"
        : "- 缺 video-publisher：请在工作台设置 → 发布平台点击准备运行环境，使用锁定版本及 Windows 兼容入口；不要直接克隆未知版本来绕过检查。",
    "",
    "## 公众号图文",
    "- 在文章页发起制作，由用户发送原生会话草稿。用 creator_prepare_article 读取固定请求的字幕、真实截图和 WeWrite Skill，按其成熟流程写作与检查，再用 creator_save_article 保存并交付排版 HTML。",
    "- 普通成片视频可以转写，配图直接从当前视频截取。",
    "- 脚本可作表达参考，事实以成片、真实转写和截图为准。公众号单独配置 AppID/AppSecret；先预览，再创建或更新草稿并读取确认，不自动发表。",
    capabilities.articleSkill.state === "ready"
      ? "- 已提供 WeWrite 写作规范和排版能力，Markdown 用作可编辑源稿，默认查看 HTML 成品。"
      : "- WeWrite 资源缺失：请重新安装完整工作台包。",
    "",
    "## 推进原则",
    "- 每次只推进当前缺失的下一步：内容与脚本 → 导入视频并选择当前视频 → 封面与发布材料 → 平台草稿 → 人工发表 → 数据回收。独立字幕可选。",
    "- 任何写入（配置、整理、发布标记）先预览或说明，用户确认后再执行。",
    ...(
      status.recommendations.length === 0
        ? ["- 当前没有待办的环境建议。"]
        : ["", "## 环境建议", ...status.recommendations.map((item) => `- ${item}`)]
    ),
  ];
  return lines.join("\n");
}
