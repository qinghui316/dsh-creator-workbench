# 创作工作台

运行在 Windows DSH Desktop 内的本地视频内容工作台。先完成视频资料管理，再逐步接入封面、平台草稿和公众号工作流。

![创作工作台](assets/readme/hero.svg)

选择资料库 → 创建或选择一期内容 → 导入视频 → 选择当前视频 → 预览、刷新与重新打开。

- 支持 MP4、MOV，包括大写扩展名；来源不限，独立字幕可选。
- 导入时复制文件，保留原文件；同名不覆盖，可修改导入名称重试。
- 多个视频时明确选择，选择按资料库保存；选中文件消失时提示重新选择。
- 左侧使用 Harness 原生对话，右侧管理内容。未开始对话也可以管理视频，需要时点击「在资料目录开始对话」。
- 外部 Skill、凭据或模型缺失只影响对应增强能力，基础片库和视频导入独立可用。

## 本地开发

工具链：Node 22.19+，pnpm 10.16.1。Stage A 的隔离验证使用 Node 22.23.4。
目标应用：DSH Desktop 0.12.1，随附 Harness 0.2.1-rc.2。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
node scripts/check-workbench-package.mjs
npm pack --ignore-scripts --pack-destination .artifacts
node scripts/check-workbench-package.mjs .artifacts/dsh-creator-workbench-0.1.0.tgz
```

`pnpm check` 包含类型检查、构建、依赖边界检查与测试。构建仅写当前仓库的 lib，不直接修改 Desktop。
打包后使用当前 Desktop 配套的插件管理入口安装；加载、入口与真实业务验证分别记录在 [本地自测](docs/market-selftest.md)。
本地安装不涉及工作台市场投稿。

## 设计与后续阶段

文件是正文的真实来源；每期一个目录。配置、当前视频选择与状态保存在独立的 `~/.dsh-creator-workbench`，可与原工作台并存。
导入通过 Desktop 的文件路径桥接和宿主后台任务执行，视频字节不经过 JSON Remote。

参见 [使用指南](docs/usage.md)、[文件约定](docs/files.md) 与 [模块边界](docs/implementation.md)。
封面自主服务配置、多平台草稿及公众号增强按后续阶段实施，当前不宣称这些能力已经在 Windows 验收通过。
外部能力可继续使用 oil-cover、video-publisher、oil-video-article；最终发表由人确认。

## 来源与许可

Fork 自 [oil-oil/dsh-oil-creator](https://github.com/oil-oil/dsh-oil-creator)，基线提交 `58bd30d0d05b04e149552e8bdb4ff0becae614f0`。
保留原项目历史与 [MIT 许可](LICENSE)。当前 Fork：[qinghui316/dsh-creator-workbench](https://github.com/qinghui316/dsh-creator-workbench)。
