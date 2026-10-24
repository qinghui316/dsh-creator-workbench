---
name: creator-wewrite
description: 使用 WeWrite 为创作工作台的当前视频制作公众号文章、检查文字并交付排版 HTML。
---

# WeWrite · 创作工作台

写作复用本目录随包携带的 WeWrite 成熟流程、写作规则和检查脚本。工作台负责本期输入、文件版本、HTML 排版及公众号草稿操作。

## 本期输入

`creator_prepare_article` 返回固定视频的实际转写、真实截图附件和本目录路径。先通读转写、查看画面。主题已经确定，直接从 WeWrite 的框架与写作阶段开始。

事实以本次视频、转写和已核对的来源为依据。脚本只作表达参考；无法确认的识别、画面或结果写清缺口。短视频按实际信息量成文，不为满足字数或评分编造经历、情绪、引语、数据和外部素材。

## 写作与检查

1. 读取 [WeWrite 写作流程](references/writing-workflow.md)，按其中的框架、内容增强、写作和定向检查执行。
2. 按需读取原流程引用的 [框架](references/frameworks.md)、[内容增强](references/content-enhance.md)、[写作规范](references/writing-guide.md)、[SEO](references/seo-rules.md)。未指定写作人格时使用 [midnight-friend](personas/midnight-friend.yaml)；结构示范见 [种子范文](references/exemplar-seeds.yaml)。`{skill_dir}` 是本目录。
3. 图片使用本次 `frame-*.jpg` 的相对名称，放在对应内容旁边。真实截图不合适时可以不用，不另造实拍证据。标题、摘要和正文遵守用户要求；只修复未通过的具体段落。
4. 可用同目录 `scripts/humanness_score.py` 作辅助检查，评分不能替代事实核对。短测试素材及明确引用不为降分而改写成虚构内容。

## 成品与后续操作

调用 `creator_save_article` 保存正文新版本，工作台调用 WeWrite 转换器生成带主题、图片齐全的 HTML 成品。使用返回的 HTML 路径交付，说明排版或图片仍有的问题；Markdown 是可编辑源稿，不作为最终成品入口。

保存工具会返回排版结果。排版失败时源稿仍保留，只重试排版，不能重新生成整篇或覆盖历史版本。公众号草稿走工作台的预览和草稿入口；最终发表由用户完成。

本期输出目录、凭据、原生会话和提交回执由工作台管理。原流程中的 `content/items`、个人配置、历史索引及项目 wrapper 路径在此由工作台接入替代，不读取其他项目的配置，也不运行外部安装或发布脚本。
