---
name: creator-wewrite
description: 使用 WeWrite 为项目选题、已有材料或视频制作文章、检查文字并交付排版 HTML。
---

# WeWrite · 创作工作台

写作复用本目录随包携带的 WeWrite 成熟流程、写作规则和检查脚本。工作台负责本期输入、文件版本、HTML 排版及公众号草稿操作。

## 本期输入

`creator_prepare_article` 返回本次请求的明确来源与本目录路径。选题或资料来源直接通读材料；视频来源读取真实转写并查看实际截图。主题已经确定时，从 WeWrite 框架与写作阶段开始。独立写作无需视频或字幕。

事实以本次提供的材料、视频、转写和已核对的来源为依据。脚本只作表达参考；无法确认的识别、画面或结果写清缺口。短视频按实际信息量成文，不为满足字数或评分编造经历、情绪、引语、数据和外部素材。

## 写作与检查

1. 读取 [WeWrite 写作流程](references/writing-workflow.md)，按其中的框架、内容增强、写作和定向检查执行。
2. 按需读取原流程引用的 [框架](references/frameworks.md)、[内容增强](references/content-enhance.md)、[写作规范](references/writing-guide.md)、[SEO](references/seo-rules.md)。未指定写作人格时使用 [midnight-friend](personas/midnight-friend.yaml)；结构示范见 [种子范文](references/exemplar-seeds.yaml)。`{skill_dir}` 是本目录。
3. 配图使用本次真实截图或本项目已登记图片的相对路径，放在对应内容旁边。需要插图、封面或系列图片时，可调用工作台 generate-images，再用 creator_read_images 检查实际产物，保存文章时传 imageIds。生成图作为插图，不冒充实拍证据。标题、摘要和正文遵守用户要求；只修复未通过的具体段落。
4. 可用同目录 `scripts/humanness_score.py` 作辅助检查，评分不能替代事实核对。短测试素材及明确引用不为降分而改写成虚构内容。

## 成品与后续操作

调用 `creator_save_article` 保存正文新版本，工作台调用 WeWrite 转换器生成带主题、图片齐全的 HTML 成品。使用返回的 HTML 路径交付，说明排版或图片仍有的问题；Markdown 是可编辑源稿，不作为最终成品入口。

保存工具会返回排版结果。排版失败时源稿仍保留，只重试排版，不能重新生成整篇或覆盖历史版本。公众号草稿走工作台的预览和草稿入口；最终发表由用户完成。

本期输出目录、凭据、原生会话和提交回执由工作台管理。原流程中的 `content/items`、个人配置、历史索引及项目 wrapper 路径在此由工作台接入替代，不读取其他项目的配置，也不运行外部安装或发布脚本。
