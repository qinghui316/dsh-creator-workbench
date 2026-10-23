# 0.2.0 视频管理与原生 Agent 封面

本轮只有一个 Change：`video-management-agent-covers`，基线 `88640d8`。实现与自动检查、本机安装、真实 AI 验收分别记录。用户已表示稍后配置服务，因此真实 AI 链路尚未通过，Change 保持开放。

## 模块和公开边界

| 模块 | 职责 |
| --- | --- |
| videoSelection / overlay / catalog | 空选择、隐藏状态、磁盘候选与资料库隔离 |
| service | 校验当前内容范围、锁定更新、装配 Remote 与宿主服务 |
| covers/types、schemas | 无 UI、Node 依赖的共享类型与严格接口 |
| covers/files | 相对路径范围、图片解码与比例、不可变资产、原子索引 |
| covers/provider | 配置版本、OpenAI 图片传输、脱敏、能力检查 |
| covers/workflow | 精确视频快照、画面、逐画幅 Jobs、取消、重试与重开对账 |
| covers/tools | 实际图片附件进入 Agent，方案提交、结果读取及质检 |
| client/CoverPanel、ImageServiceSettings | 资产和制作记录、原生请求草稿、生图设置 |

`setVideoVisibility` 携带内容 id、精确目录与相对文件名。只更新工作台状态。现有 `selectVideo`、导入操作共用可见性规则；主动清空不自动换源。

新增 Remote：`getCoverState`、`coverAction`、`getCoverImage`、`getImageSettings`、`setImageSettings`、`checkImageService`。`coverAction` 包含 create/test/import/select/cancel/retry/review。所有内容操作携带 id 和目录，制作操作另带 runId，版本操作带 versionId。数据通过现有 schema/typert 验证；导入只传本地源路径。

原生工具：`creator_prepare_cover` 返回最多八张真实 JPEG 附件、输入上下文及规则路径；`creator_generate_cover` 接受分析、标题、精确画面 id 与逐画幅提示词；`creator_read_cover_results` 返回真实图片附件；`creator_review_cover` 保存逐版本结论及选择。旧的封面生成入口明确引导到此流程，不再调用外部视觉脚本。

会话通过宿主 sessions/conversation 公共接口作用于本工作台所属会话。空草稿才直接设置，有内容时需明确追加，并以 draftRev 检查插入位置。不会自动发送，不会覆盖用户草稿。

## 图片协议、凭据与恢复

参考图模式调用 `POST <根地址>/images/edits`，multipart `image[]`；明确选择文字制作时调用 `/images/generations`。尺寸分别为 960×1280、1280×960、1280×720；第三方不支持时报告限制。支持 Base64 或 URL 结果，下载不携带服务 Authorization。魔数、ffprobe/ffmpeg 解码和实际比例都通过后才建立可用版本。

使用独立凭据引用 `DSH_CREATOR_IMAGE_API_KEY`。旧凭据保留，不自动迁移或复用。Agent、任务记录和提示词不接触 Key；运行请求才从宿主读取。地址/模型/Key 修改使原能力结果失效；读取模型列表不等于图片能力通过。

按画幅串行生成，成功产物保留。服务结果未知时不自动重试；明确重试只处理选择的未完成画幅。生成与导入均不覆盖已有图片；生成版本经检查后才选用。原视频大小/修改时间变化后必须重新准备。移除视频条目不会取消已运行任务。

Desktop 0.12.1 包装 child_process.execFile 后没有保留 Node 的自定义 promisify 入口。初次本机导入据此暴露了解码失败；现使用公开回调契约并有真实 ffmpeg 回归，修复包中已实测成功。无需修改宿主。

## 本机验收状态

| 项目 | 当前证据 |
| --- | --- |
| 移除当前视频、刷新、恢复不自动选中 | 已在 Desktop 实测，磁盘视频保留；`.artifacts/acceptance-v020/01` 至 `09` 截图与树 |
| 原生制作请求 | 已进入所属会话草稿，未自动发送；`15-native-draft` |
| 正常重开 | 视频选择、制作记录、原生草稿恢复；`16-fixed-reopened` |
| 封面导入、两个版本、明确切换 | 3:4 已实测；4:3 已导入并显示；`18` 至 `25` |
| 16:9 本机文件选择 | 自动化对系统文件窗口的确认操作失败，尚未取得导入成功证据；服务层真实图片回归已覆盖 |
| 窄窗口、侧栏状态、放大预览 | 待完成本轮最终实际界面检查，不能继承阶段 A 的验收 |
| Agent 实际看图和逐画幅质检 | 待用户在 Harness 选择支持图片的模型 |
| 配置服务真实生成、取消、重试 | 待用户在产品设置中完成配置；HTTP 夹具测试不代表外部服务已通过 |

原来的 Desktop 依赖迁移告警独立保留定位结论，见 [实现说明](implementation.md)。本轮不修改 Desktop 或规避必需 peer。

外部依赖 `oil-oil/oil-cover`，MIT，固定 `6ebdad44dcfbf852843ae03217b04c60c8c4cab5`，使用 `references/agent-native-flow.md` 与 `cover-rules.md`。已在本机独立 Skill 目录安装并检查规则存在；未继承上游 Windows 或生图验收结果。封面原生流程不执行其旧分析脚本。

自动检查使用项目隔离 Node 22.23.4 / pnpm 10.16.1。执行 `pnpm check`，随后 `node scripts/check-workbench-package.mjs <tgz>`。最终测试数量、包 SHA256、实际安装字节及未验证项保存在当前 Change 的验证记录；产物位于 `.artifacts`。本机安装使用 Desktop 随附的公开 `plugin --profile web add <tgz> --ignore-scripts`，文件名含内容哈希以绕开旧包缓存。
