# @deepseek-ai/dsh-client-ui-tianshu-brand

[English](README.md) | 中文

天枢平台的品牌层。它贡献两样东西：一个承载平台身份的主题 token 覆盖层，以及取代上游外壳的品牌侧边栏。

本包是本分叉的品牌接缝。它的存在是为了让平台的视觉身份集中在一个新增包里，而不是散落成对上游文件的编辑，从而使今后从上游 `git pull` 不产生冲突。

## Token 层

`brand-tokens.ts` 以本包名作为层标识，通过 [`ctx.theme.overrideTokens`](../ui-theme/README.md) 在当前主题之上叠加一层。层里只放 Tianshu 值与上游主题不同的 token：目前是侧边栏列填充（竖向品牌蓝渐变）与品牌文字色。`--dsw-specific-sidebar-fill` 是被文档化的可覆盖 token，且接受任意 CSS 背景值，渐变可直接骑在它上面。该层是全局的，因此只承载身份；需要在蓝色列**内部**改变的 ink 则在 `TianshuSidebar.module.css` 中局部重绑，因为全局覆盖会重绘整个应用。

品牌蓝取上游已有的 `--dsw-static-deepseek-500`（`rgb(65,118,230)`），按该静态色调校过的控件因此与蓝色列保持一致。暗色取值把列压入暗色表面区间，而非复用浅色渐变——后者会造成浅色叠浅色的失效文字。

## 侧边栏

`sidebar` 是 `single` 插槽，注册进去会**顶替**上游外壳而非叠加；web-app bundle 相应禁用了 `ui-sidebar` 行。本包重新声明了同样的三个座位——`sidebar.workspaces`、`sidebar.settings`、`sidebar.footer.action`——因此 [ui-workspace](../ui-workspace/README.md) 的浏览器与 [ui-settings](../ui-settings/README.md) 的底部座位原样可用。

该列逐字保留了上游外壳的结构性行为：折叠是滑移加交叉淡出进入布局所属的 56px 轨道，内容在淡出期间冻结于展开宽度以避免滑移途中回流，滚动条是指针可见性附属物——指针不在时会把 ui-theme 的滚动条间接绑定移开。在此之上新增了导航块（配置 / 任务管理 / 会话管理），位于「新建会话」与浏览区之间。

导航行会打开本包所拥有的管理界面。选中态是跨注册项的状态——侧边栏与页面是两个注册项——因此它存放在一个声明的 store 中，二者从 `apply` 获得同一个句柄；再次点击已打开的行会将其关闭。它不做持久化：你当时停在哪个页面属于单次访问的事实，在全新加载时恢复它只会遮住产品本应打开的会话。

`TianshuPages` 注册进 `shell.overlay` 而非 `conversation`：后者是 ui-conversation 所拥有的单一插槽，占用它会顶掉整个聊天界面。overlay 覆盖整个框架，因此页面是一个双轨网格，第一轨属于侧边栏——留空且点击穿透，因为关闭页面的导航就在那里。该轨的宽度取自 `--dsh-tianshu-sidebar-width`，由侧边栏依据框架已经交给它的宽度发布，因此拖拽或折叠时页面会随该列移动，且无需在别处重述宽度。页面能够诚实展示的内容受限于宿主实际具备的能力；参见 Known Limitations。

该列带有 `data-dsh-sidebar-root` 与 `data-dsh-sidebar-wide`。它们是供宿主外壳定位的布局锚点，而非样式钩子：桌面客户端的 Windows 标题栏通过 root 测量该列，并在展开时为其补足上边距；它按属性查找，找不到时静默返回。去掉它们会让该布局失效且任何地方都不会报错，因此有测试将其钉住。

`TianshuSidebarComponentProps` 组合了布局 owner 份额、框架会话钩子、三个声明的子插槽，以及注入的 `startSession` 与折叠回调。本包没有插件 store。

`/client` 只导出插件体（`apply`/`inject`）与契约类型；组件与 token 表保持包内私有。

## Model Experience

None, as this package renders browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **任务管理的模板中心仅为呈现** —— 三张模板卡片渲染的是固定文案，并不能创建任何东西，因为宿主没有可供创建的模板概念。页面就地说明了这一点，而不是暗示正在加载。要让它们成真需要宿主侧能力，而非在此处改动。
- **任务管理不列出任何任务** —— 宿主的定时能力是会话内、模型可见的提醒（`after`／`at`／`every`），而不是参考设计所展示的跨会话任务表。没有全局对象可供枚举，因此该区块诚实地留空；真正的任务表属于新的宿主能力。
- **会话管理只列出会话，不对其操作** —— 各行的标题与顺序来自框架的标准会话投递，与侧边栏浏览区读取的是同一份事实，但不带重命名、归档或删除。这些变更在协议上是存在的；是否再开一个界面承载它们，留待其价值足以抵消与侧边栏保持同步的成本时再定。
- **配置指向设置页而非复制它** —— 该行打开一条指引到既有设置界面的提示。第二个配置界面只会与真正的那个产生漂移。
- **品牌图形是手绘近似** —— `TianshuMarks.tsx` 渲染的徽标是照参考设计构建的，不是官方资源导出。待权威矢量文件到位后应予替换。
- **列内 ink 按规则重绑，未经逐项审计** —— 样式表反转了嵌套界面预期会读取的 ink、边框与交互 token 族。若某个贡献者注册进 `sidebar.workspaces` 时使用了这些族之外的 token，仍可能在蓝底上出现深色文字。
