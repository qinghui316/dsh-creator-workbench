# Desktop 包与运行规则

开发规范：[DSH 工作台开发规范](https://dshdesktop.com/workbench/docs/development.md)。

本工作台采用已确认的原生分栏：左侧 Harness 对话，右侧业务内容。首次没有会话时仍可选择资料库、新建内容、导入和预览视频，需要 AI 时再主动创建或恢复所属会话。
工作台通过 Desktop 服务注册真实 Fork 来源并保留宿主公共入口，不替换宿主全局侧栏、会话列表或模型配置。

包提供服务端 lib/index.js、单个客户端 lib/client.js 和 Remote 描述入口 lib/typert.host.js，随包携带 cordis.patch.yml。
独立包名、服务、工具、Jobs、界面存储键和状态目录允许与原工作台并存。运行入口依赖宿主服务；不随包安装第二份工具运行时。

pnpm check 验证代码、构建与依赖边界；check-workbench-package.mjs 核对实际 tgz、清单、入口、敏感文件和当前构建一致性。
安装成功、插件加载、已安装列表、切换菜单与业务验收分开记录，见本地自测文档。市场投稿不在此阶段内。
