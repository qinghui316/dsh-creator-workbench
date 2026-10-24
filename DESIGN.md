---
name: 创作工作台
description: 继承 DSH 宿主主题的紧凑原生创作工具
colors:
  business-primary: "var(--dsw-alias-state-business-primary)"
  button-primary-fill: "var(--dsw-alias-button-primary-fill)"
  button-primary-hover: "var(--dsw-alias-button-primary-hover)"
  button-foreground: "var(--dsw-alias-label-primary-foreground)"
  surface-base: "var(--dsw-alias-bg-base)"
  surface-hover: "var(--dsw-alias-interactive-bg-hover)"
  surface-active: "var(--dsw-alias-interactive-bg-active)"
  surface-layer-2: "var(--dsw-alias-bg-layer-2)"
  label-primary: "var(--dsw-alias-label-primary)"
  label-secondary: "var(--dsw-alias-label-secondary)"
  label-tertiary: "var(--dsw-alias-label-tertiary)"
  border-soft: "var(--dsw-alias-border-l1)"
  border-field: "var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))"
  border-action: "var(--dsw-alias-border-l3)"
  state-success: "var(--dsw-alias-state-success-primary)"
  state-error: "var(--dsw-alias-state-error-primary)"
typography:
  title:
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  section:
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontSize: "14px"
    lineHeight: "22px"
  helper:
    fontSize: "13px"
    lineHeight: "20px"
  tab:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "16px"
  action-small:
    fontSize: "12px"
    lineHeight: "18px"
rounded:
  control: "6px"
  media: "8px"
  history: "10px"
  host-small: "var(--dsw-radius-sm)"
spacing:
  tight: "4px"
  control: "8px"
  inline: "10px"
  group: "12px"
  panel: "14px"
  form: "16px"
  section: "20px"
  separation: "24px"
components:
  button-primary:
    backgroundColor: "{colors.button-primary-fill}"
    textColor: "{colors.button-foreground}"
    typography: "{typography.action-small}"
    rounded: "{rounded.host-small}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.button-primary-hover}"
  button-secondary:
    textColor: "{colors.label-primary}"
    typography: "{typography.action-small}"
    rounded: "{rounded.host-small}"
    padding: "0 10px"
    height: "28px"
  button-ghost:
    textColor: "{colors.label-primary}"
    typography: "{typography.action-small}"
    rounded: "{rounded.host-small}"
    padding: "0 10px"
    height: "28px"
  field:
    backgroundColor: "{colors.surface-base}"
    textColor: "{colors.label-primary}"
    typography: "{typography.helper}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  detail-tab:
    textColor: "{colors.label-tertiary}"
    typography: "{typography.tab}"
    padding: "0 0 11px"
  detail-tab-selected:
    textColor: "{colors.business-primary}"
  history-row:
    rounded: "{rounded.history}"
    padding: "8px"
  history-row-selected:
    backgroundColor: "{colors.surface-hover}"
---

# Design System: 创作工作台

## Overview

**Creative North Star: "原生创作工具"**

这是一套在 Windows DSH Desktop 中完成内容整理与编辑的操作界面。视觉延续宿主的文字、主题和按钮语言，以简洁的 Beaver 式表单分组、连续历史列表和真实媒体预览组织任务。密度紧凑，标题克制，主要动作通过原生按钮与清晰文案建立层级。

本文件记录当前工作区源码中可复用的视觉与交互规则，面向 Windows 原生操作场景。宿主提供字体与主题变量，插件不另建固定品牌色或字体栈。原生对话与业务区的分栏、业务区左侧项目历史与右侧详情，是承载这套视觉系统的现有布局。通用文章、图片与各平台发布材料沿用同一项目上下文，通过分组、连续行和就地编辑区呈现。

**Key Characteristics:**

- 继承宿主语义主题，使用文字层级、细分隔线与轻背景表达关系。
- 正文、说明与详情标题形成紧凑的三级文字关系。
- 表单纵向分组，次要与诊断信息通过折叠展开。
- 项目历史和平台材料以连续行组织，图片、视频与封面保留真实比例。
- 预览和版本内容在所属业务区内展开。
- 原生请求、编辑保存与后台任务分别显示各自状态。

## Colors

颜色由 DSH 的语义角色决定；前置 token 中的变量引用是规范值，运行时色值随宿主主题解析。

### Primary

- **宿主业务强调色**用于详情当前页签、流程当前步骤与键盘焦点轮廓。
- **宿主主按钮填充与前景色**用于保存、选用版本等当前主要动作；悬停使用宿主提供的对应状态色。

### Neutral

- **基础表面与主文字**承载工作区、表单和正文。
- **次要与三级文字**区分说明、元数据和未选中的详情页签。
- **交互悬停与按下表面**表达按钮响应、选中历史行和轻量媒体底板。
- **柔和、字段与动作边框**分别分隔内容、界定输入范围和勾勒次要按钮。
- **第二层表面**用于已有缩略图占位与状态容器。

成功与错误使用宿主对应的状态色，并结合文字或状态标识传达含义。

**The Host Theme Rule.** 复用宿主语义变量；扩展界面时继续按角色取色，不从截图采样并写入固定色值。

## Typography

字体继承宿主的 `--dsw-font-markdown-base` 或组件字体。项目没有另设展示字体；前置 token 只记录源码明确覆盖的字号、行高与字重。

- **详情标题**使用 `title`，适合当前内容名称；单行截断并保留完整标题提示。
- **业务分组标题**使用 `section`，适合视频、封面和内嵌面板标题。
- **正文**使用 `body`，承担详情正文和主要内容阅读。
- **说明与字段标签**使用 `helper`，承担操作提示、状态、错误与设置说明。
- **详情页签**使用 `tab`，选中状态通过业务色与底部短线表达。
- **紧凑动作**使用宿主小按钮的 `action-small`。现有日期、画幅元数据等辅助位置也保留较小字号，不将它们提升为正文规范。

脚本编辑区保留较舒展的行高（24px）。长路径与文件名在行内截断；错误、字幕与文章正文允许断行。

**The Quiet Hierarchy Rule.** 用正文、说明、分组与详情标题的既有角色区分层级；同层内容保持一致的字号与字重。

## Layout

工作区填满宿主分配的空间，页头与主业务区上下排列。项目工作视图在支持的宽度下同时保留原生对话与业务区，以及业务区左侧项目栏与右侧详情。项目栏使用受限弹性宽度（`clamp(180px, 25cqi, 240px)`），右侧详情占用剩余空间，两者以细边线分隔。详情标题、页签与可滚动正文形成稳定的垂直结构。正文内边距为上方与两侧的常用留白，底部额外留出操作空间（20px 20px 32px）。

设置使用居中的单列内容区（最大宽度 680px）。字段纵向间隔采用 `form`，字段标签与控件间隔采用 `control`。保存行粘附于可滚动设置区底部；连接检查独立成组。常规设置中的写稿偏好、平台显示、凭据与诊断沿用折叠分组。

自适应变化仅发生在所属区域内部：项目栏始终可见，不以窄宽度切换成项目或详情的单页视图。项目栏容器不宽于200px时，使用紧凑缩略图和可换行元数据，点击项目直接更新右侧。详情页签保持原顺序并可横向滚动。封面区域在不宽于500px时，从三列改为带缩略图的连续行；宽容器使用三等列和列间距（16px）。通用图片使用自适应网格（最小列宽110px、间距12px），所属容器不宽于420px时改为两等列。

正文使用独立滚动区；文章限宽（760px），图片不超出可用宽度。表单、标题和动作行允许换行，文件名等收缩元素设置可缩小宽度。封面预览操作栏粘附在所属区域顶部，放大图片保持原比例且不超过当前容器。

**The Owning Container Rule.** 响应式变化由实际业务容器决定；同时保留原生对话与业务区、项目栏与详情的关系，局部预览在所属业务区中展开。

## Elevation & Depth

界面以平面表面、轻背景和细分隔线区分分组。封面、视频、字段与设置分组不依赖普遍投影。现有动作下拉菜单使用一档轻投影（`0 6px 18px #0002`），配合边框与层级，使菜单脱离列表表面。粘附操作栏沿用基础表面遮挡滚动内容。

**The Flat Surface Rule.** 业务分组保持平面；轻投影服务于浮起的动作菜单。

## Shapes

形状以温和圆角和细边框为主。字段采用 `control`，视频和轻提示容器采用 `media`，历史行沿用 `history`。按钮圆角由宿主的小控件变量管理。封面预览底板保留自身的轻圆角（7px），历史行内缩略图更紧凑；这些媒体形状不用于推导全局圆角阶梯。

输入框和选择框通常具有最小高度（36px），设置文本输入略高（38px）。紧凑动作按钮沿用宿主小尺寸，页头宿主按钮保留自身尺寸。控件尺寸按用途区分，不强制把所有点击目标改成输入框高度。

## Components

### Buttons

动作按钮直接包装 DSH 原生按钮，提供主要、次要与无边框三种语义。主要动作使用宿主实心按钮；次要动作使用细描边（0.5px）；无边框动作用于返回、历史等附属操作。三种内部动作沿用小尺寸，动作行可换行并保留间距（8px）。禁用由宿主降低透明度（0.4）并使用禁用光标。

业务输入、按钮和折叠摘要在键盘焦点可见时使用业务色轮廓（2px，外偏移 2px）。主按钮悬停切换宿主填充色；次要和无边框按钮悬停使用轻背景，无边框按钮按下使用宿主按下表面。

### Inputs / Fields

字段由标签、控件和可选说明组成，默认纵向排列。控件铺满可用宽度，文字和背景使用主文字与基础表面，细边框界定输入范围。已标记无效的输入使用错误边框；错误提示与字段相邻，并允许长内容换行。

设置中的服务地址、API Key 与模型保持直接的单列表单。保存和连接检查各自显示进行中状态；检查时显示“正在检查…”，保存时显示“正在保存…”。未保存离开提示展开在设置区内；继续编辑返回先前编辑字段。

### Navigation

详情顺序为“概览 → 视频 → 脚本 → 字幕 → 文章”。页签采用低调文字与选中下划线；当前项具有选中语义，键盘箭头、Home 与 End 可移动页签焦点。设置分组采用“生图服务 / 常规”两个按钮，当前组使用轻背景和加重文字。

### History / Asset Rows

历史内容行包含缩略图、内容标题与状态元数据；悬停和选中使用同一轻表面。封面历史与视频管理使用连续资产行、底部分隔线和行内动作。标题与文件名优先保持单行可扫读，辅助信息可换行。

### Shared Assets / Platform Materials

概览中的共用文章、图片与配图、平台发布材料纵向排列，以组间留白和上边线区分。文章摘要通往源稿与“文章”页中的成品、版本；图片网格展示用途和尺寸，点击后在同一区域展开包含式预览。图片较多时先展示最近六张，使用“查看全部图片 / 收起图片”控制展开。移除动作与对应图片或材料相邻。

平台材料使用标题与“平台 · 内容类型”两行连续列表，悬停或当前选中使用第二层表面。编辑器直接展开在列表下方，依次组织平台、内容类型、标题、正文、标签与素材选择；复用文章后，平台文案仍可独立编辑。图集使用带序号的连续行和上移、下移、移出动作表达顺序；图文材料的封面与图集首图保持一致，选择封面会将该图移至首位，调整图片顺序会同步已选封面。平台文章的图片排序与移除结果随本份正文保存，复用的来源文章保持原样。窄区域内动作换行，不改变外部结构。

保存材料、准备 Agent 请求、上传与作品数据分别成组。切换材料时，未保存修改在当前区域提供“保存并切换 / 放弃修改 / 继续编辑”；收起保留继续编辑入口。切换后清除上一份材料的提示，上传反馈与恢复动作只展示当前材料的记录。保存完成后确认实际保存的正文；保存期间继续输入的内容保留在编辑器中，并提示当前修改仍未保存。上传动作旁保留发布授权确认与最终手动发表提示，任务进展、检查原任务、继续原任务和作品数据都跟随对应材料。

### Request / Save Feedback

按钮准备的创作请求进入原生项目对话，准备成功后显示由用户发送的就地提示。脚本快捷入口明确区分“正在准备请求…”、请求已就绪和准备失败；准备时禁用入口，失败时显示错误，已有草稿冲突时提供追加请求。脚本编辑器的“保存中… / 已保存 / 保存失败”使用独立状态行，保存失败提供重试，避免把请求就绪当作内容已保存。

通用通知使用状态语义，错误使用警报语义并允许长文本换行；后台制作、上传与数据同步在各自分组显示进展及可用恢复动作。这些规则记录界面表达，不代表远端业务或安装验收结果。

### Inline Section Panels

封面预览、版本历史与相关任务在所属封面区域内展开，面板标题与“返回”并排。进入时焦点落在面板区域，Escape 或返回关闭面板；关闭时通过调用方的稳定目标恢复焦点。放大封面使用包含式缩放，历史缩略图与预览承担不同密度。

### Media / Disclosures

视频保留原生播放控件，以包含式缩放限制高度（300px）。封面宽布局提供三种画幅，窄布局保留画幅、当前选用状态和操作入口。非必要管理、记录与高级操作通过原生折叠摘要展开，不占据初始内容高度。历史搜索使用既有短过渡（120ms / 180ms），系统要求减少动态效果时移除这些过渡。

## Do's and Don'ts

### Do:

- **Do** 使用宿主语义颜色、字体与原生按钮，让新增表单延续当前控件语言。
- **Do** 按正文、说明、分组标题和详情标题角色建立紧凑层级。
- **Do** 用连续行、分隔线和折叠组织历史、管理与诊断内容。
- **Do** 按所属容器宽度重排封面、图片与表单内部内容，并保留真实媒体比例。
- **Do** 同时保留原生分栏、项目栏与详情，以及“概览 → 视频 → 脚本 → 字幕 → 文章”的顺序。
- **Do** 分别显示请求准备、内容保存和后台任务状态，让反馈对应实际动作。

### Don't:

- **Don't** 从单张浅色截图推导固定主题色或自行指定宿主字体。
- **Don't** 让局部预览遮住原生导航或对话区。
- **Don't** 用装饰性大标题或密集卡片边框替换当前紧凑表单与连续行。
- **Don't** 以窄容器为由隐藏项目栏或把项目与详情改成互斥页面。
- **Don't** 为局部界面调整全局字体、字号或缩放。
