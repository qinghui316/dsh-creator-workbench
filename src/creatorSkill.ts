interface SkillsContext {
  skills: {
    register: (skill: {
      name: string;
      description: string;
      source: "runtime";
      content: string;
      invocation: { modelInvocable: boolean; userInvocable: boolean };
    }) => () => void;
  };
}

export const CREATOR_WORKBENCH_SKILL = {
  name: "dsh-creator-workbench",
  description:
    "配置和使用内容工作台。首次使用、调整内容目录、整理目录、检查字幕/封面/发布能力，或推进一条内容时使用。",
  source: "runtime" as const,
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# 创作工作台

## 开始前

1. 用户不知道这个插件能做什么、怎么用，或你不确定下一步时，先调用 \`creator_guide\`；它会返回带当前能力状态的完整指引。
2. 配置或诊断环境调用 \`creator_setup\`，不要先向用户询问系统能够检查出来的信息。
3. 根据返回的 \`capabilities\` 区分核心能力和可选能力。内容目录是核心；字幕、封面和发布同步缺失时只降级对应环节。
4. 如果需要寻找目录，先用系统文件工具只读查看候选目录。不要扫描整个磁盘，不要读取与内容工作无关的私人文件。

## 配置

- 内容目录和 \`enabledPlatforms\` 通过 \`creator_setup\` 配置；这里不配置创作者名称或平台主页。
- 脚本规则（人设）通过 \`creator_script_rules\` 配置：写或改 script.md 前先读；用户第一次让你写脚本而没有规则时，根据本次要求写作，缺少必要信息时只问一个问题；用户明确长期偏好后再保存；之后把新的长期偏好合并进现有规则，不要整体覆盖。
- 候选内容目录不存在时，让用户在内容工作台的系统目录选择器中明确新建或选择目录；用户确认后再重新调用 \`creator_setup\` 预览。不要在默认位置或推测路径创建目录。
- 第一次带配置字段调用时保持 \`apply=false\`，把精确变更展示给用户。
- 只有用户确认后，才使用同一组字段和 \`apply=true\`。
- 不向用户索要 API Key 明文。字幕和封面凭据只能让用户在内容工作台的设置页通过 Harness Credentials 配置。
- 高级依赖路径由插件配置或环境自动发现；能自动发现时不要增加问题。

## 内容目录

- 磁盘文件是正文真源；工作台 overlay 只保存绑定、阶段和发布状态。
- 一集一个子目录，默认命名为 \`YYYY-MM-DD_可读标题\`。
- 先列目录，再读这一集需要的 \`topic.md\`、\`script.md\`、发布包、字幕或文章文件。
- 首次保存文件前先在工作台调用系统目录选择器。已确认资料位置后，创建新内容使用 \`creator_create_content\`；修改普通 Markdown 和 JSON 正文使用系统文件工具。

## 整理与发布安全

- 调用 \`creator_organize_library\` 时先预览，向用户列出改名前后；确认后才传 \`apply=true\`。它不删除文件。
- 发布默认准备草稿。上传和账号登录复用外部能力；最后点击发表始终由用户手动完成。
- 自动发布（\`video-publisher\` skill）和已发布数据回收（\`creator_sync_publish\`）只处理 \`enabledPlatforms\` 中的平台，都依赖 Ego Browser 和已登录的创作者后台；\`enabledPlatforms\` 为空时不执行发布或同步，先配置并确认启用平台。能力检查显示缺失时明确告诉用户这两项不可用，其余功能照常。

## 页面与成果

概览仅汇总已有成果；视频、脚本、字幕、文章、图片和发布各有页签。图片页管理项目配图与视频封面，发布页管理各平台独立文案、图序、上传及具体作品数据。

## 统一创作与平台发布

- 一个项目一个目录，不设置项目模式。脚本、文章、视频、配图和平台材料可独立制作、互相复用。已有上下文足够时连续执行用户的要求。
- 先用 creator_production_state 读取项目状态。独立文章调用 creator_production_action 的 prepare-article，source.kind 选 topic/materials/article 并提供已知 text/files/articleId；视频转文章选 video。随后 creator_prepare_article 读取输入和 WeWrite，再 creator_save_article 保存源稿与 HTML。
- 配图可调用 generate-images，items 每项含 prompt、ratio（3x4/4x3/16x9/1x1）、purpose（cover/illustration/card）、可选 references（已登记图片 ID）。等待实际 job，使用 creator_read_images 检查产物；retry-images 只重试指定未完成项。
- 修改既有文章先调用 creator_read_article_source 取得准确版本、格式和 sourceHash；再用 creator_save_article_revision 保存新版本，expectedSourceHash使用读取结果，saveId使用稳定唯一身份，通信重试沿用同一身份。保留原文格式与资源；预览失败不否定正文已保存，不因排版失败重复建版本。右侧文章页同样支持文稿编辑和未保存预览。
- 正常文件工具写出的本项目 Markdown/HTML 使用 register-article 登记，已有图片使用 import-image 登记。文章内配图须是本项目真实截图或已登记图片，并使用相对路径；save-article 传对应 imageIds。
- 各平台发布材料独立：save-publication 的 input 包含 platform、type（video/images/article）、title、body、tags、imageIds，以及需要的 video/articleId/articleFile/coverImageId/coverFiles/category/source。更新需要原 publicationId 与 expectedRevision，冲突保留用户编辑。
- 保存发布内容时为本次精确输入生成稳定saveId，通信重试沿用相同saveId和原参数；修改后的输入使用新saveId。创建后的平台与形式保持不变，复用到其他平台另建材料。本地草稿允许缺少标题或素材，上传前再检查必需材料。
- 关联作品前读取当前账号，将expectedAccountId随associate-publication提交；选择候选还传candidateAccountId。候选按平台、账号、作品标识区分，账号变化时重新选择。refresh-metrics可指定publicationId、recordId和expectedAccountId；不按标题或首条记录推定作品归属。
- 工作台自动保存只写本地材料。上传前等待本地保存成功并固定版本与expectedAccountId，上传、更新公众号远端草稿和最终发表分别需要明确操作；自动保存不触发这些远端行为。

- 图文支持小红书、抖音、B站；公众号用 article，视频号只用 video。小红书、抖音用有序图片组和独立正文，B站通过图文编辑器处理正文与图片；HTML 是文章阅读和公众号排版成品。
- upload-publication 需要已保存材料版本及用户明确发布授权。上传任务固定账号、类型和材料；中断先 inspect-upload/resume-upload，不能为绕开阻塞而新建。最终点击发表始终由用户操作。
- 自然语言操作直接执行；右侧按钮才需要把请求放入项目原生会话。项目目录与会话只用于定位，不限制其他会话处理明确项目；不要反复创建工作区。

## 当前视频

- 先调用 \`creator_get_content\` 读取视频候选与当前选择。多个候选时让用户明确选择，再调用 \`creator_select_video\`。预览、封面和外部上传均使用这个选择，不以修改时间换源。
- \`creator_import_video\` 仅复制用户选定的视频，原文件保留。同名冲突时修改导入名称重试，不能覆盖已有文件。

## 推进工作

根据用户要求制作脚本、文章、视频或图片，再为所需平台准备独立发布材料、上传草稿及同步作品数据。脚本与文章可独立完成；视频转文章才需要真实转写与画面。

- \`creator_import_video\`、\`creator_generate_subtitles\` 返回 Harness job id。用 \`job_output\` 的 \`wait=true\` 等待并查看完成结果，用 \`job_kill\` 取消，不轮询文件夹冒充任务控制器。字幕使用火山录音文件识别或导入已有 SRT/ASS；不运行 Mac 专属安装、MLX 或烧录入口。
- 上传、公众号和数据使用 \`creator_production_state\` / \`creator_production_action\` 的工作台入口，复用锁定版本外部 Skill。账号、精确视频、封面和任务在启动时绑定，不直接运行绕过账号检查的脚本。用户接管浏览器后停止；中断优先检查并恢复原任务；上传完成、草稿就绪和已发表分别记录。
- 文章由用户发送原生制作请求；用 \`creator_prepare_article\` 读取绑定的真实转写、图片附件和 WeWrite Skill，按返回的成熟写作流程、规则与定向检查制作。缺字幕时等待返回的火山 Job，再继续读取。用当前 Harness 模型看图；文字与画面不足时说明缺口。用 \`creator_save_article\` 保存并排版新版本，以返回任务 receipt 的 HTML 作为成品链接；Markdown 是可编辑源稿。只引用本次真实截图，不用脚本冒充实录。公众号先本地预览，再准备草稿；不自动发表。数据只按用户操作手动刷新，按账号和平台内容标识精确匹配，未知值不能写成零。
- 封面使用原生 Agent 流程：界面提供的制作请求包含固定 id、folderPath、runId；先调用 \`creator_prepare_cover\` 查看真实候选画面，读取返回的 oil-cover 规则与 agent-native-flow，用当前模型选帧和分析。看不到图片时要求用户在 Harness 中换支持看图的模型，不调用外部分析服务。
- 标题遵循用户指定文本；字幕可选。分析完成后直接调用 \`creator_generate_cover\`，默认 reference 模式，提交完整逐画幅提示词和本次 frameIds；只有用户明确接受纯文字制作才用 text。无额外方案审批。该工具返回原生 Job id，使用 job_output/job_kill 管理；不自动重试结果未确认的付费请求。
- 任务结束调用 \`creator_read_cover_results\`，逐幅查看真实图片后用 \`creator_review_cover\` 保存具体检查结论，pass 时可选为当前版；缺失、失败或看不到图片不能标为通过。只重做用户指定或实际失败的画幅，旧成果保留。
- 兼容的旧封面审查：封面任务完成后调用 \`creator_prepare_visual_review\`，检查三画幅构图、文字可读性、安全区、适配和品牌一致性；再用 \`creator_save_visual_review\` 保存具体结论。不把“已经启动”说成“已经完成”。`,
};

export function registerCreatorWorkbenchSkill(ctx: SkillsContext): () => void {
  return ctx.skills.register(CREATOR_WORKBENCH_SKILL);
}
