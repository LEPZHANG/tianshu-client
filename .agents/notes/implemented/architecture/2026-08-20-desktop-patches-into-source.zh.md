# Agent Note：六个 dsh-desktop 补丁成为 Harness 源码

Status: implemented

[English](2026-08-20-desktop-patches-into-source.md) | 中文

## 问题

[把桌面壳指向本检出](2026-08-18-tianshu-desktop-integration.md)一并退役了 `dsh-desktop` 的全部十二个 `patch-package` 补丁，因为它们改写的是 `node_modules` 里编译后的 `lib/client.js` 产物，而本检出以源码形式提供同一份代码。其中两个当时已被移植——没有它们壳根本起不来。其余十个则留成了一份清单：桌面构建曾经拥有、而本构建没有的行为。

这十个里有六个是普通的产品改进，与桌面毫无关系。把它们留在停用的补丁文件里，意味着浏览器构建永远得不到它们，而下一次升级 `dsh-desktop` 时还得把它们重新 rebase 到一份 CSS module 哈希已经变过的产物上。

## 决策

把这六个移植进源码。每一个都是针对它所修改的源码重新实现，而不是从补丁逐行转写——因为针对产物的补丁携带着打包器的产物特征：内联 CSS 字符串、`documentElement.lang` 判断、生成的类名，而源码对这些都有真正的设施。

**`403` 不再是 `AUTH`**（`llm-deepseek`、`llm-pi-ai`、`client-runtime`）。两个适配器此前把 `401` 与 `403` 归为一类，于是一个可用但因地域、模型权限或组织策略被拒的密钥，被报告成了无效密钥。`403` 现在给出 `FORBIDDEN`。两个适配器中，配额判定也移到了状态码判定之前：提供方同样常以 `403` 而非 `429` 报告余额耗尽，而状态码优先会把这些归入 `AUTH`——让用户去更换一个正常工作的密钥。GUI 的失败投影对 `QUOTA` 与 `FORBIDDEN` 给出指明真正处置方式的文案，与既有的 `AUTH` 替换并列；三者替换的都是会误导的提供方原文，原始诊断仍保留在会话日志中。

`FORBIDDEN` 与 `AUTH` 一样是裸字符串，而不是新导出的常量。已导出的那些 code（`QUOTA`、`CONTEXT_WINDOW_EXCEEDED`、`EMPTY_RESPONSE`、`INVALID_CREDENTIAL`）之所以存在，是因为各有一个共享的分类器或抛出点支撑；`FORBIDDEN` 则由两处的 HTTP 状态码决定，这正是 `AUTH` 与 `RATE_LIMIT` 已有的形态。它保持在默认可重试集合之外：被拒的权限每次尝试都会以同样方式失败。

**拼写成路径的行内代码会被链接**（`ui-deliverables`）。提及词表此前只匹配本轮产出的路径，因此一个通过引用文件来解释的回合，一个链接也给不出。现在新增第二层，识别路径*拼写*——以 `/`、`~/`、`./`、`../`、盘符或 UNC 根开头；任何包含分隔符的 token；或带有可信扩展名的裸文件名——并去掉结尾的 `:行号`、`:行号:列号` 或 `#L行号`。产出路径层仍先执行，仍拒绝在两条共享 basename 的路径之间作猜测。

这放宽了一条已写入文档的保证，README 及其 Known Limitations 现已改述为新的表述。原保证是：提及「永远不会打开错误的文件，也不会导致 404」。前半句依然成立：产出层未变。后半句被有意放弃，因为打开器本就会吞掉 Host／OS 失败，所以一次错误猜测的代价只是一次打不开任何东西的点击。该启发式无法区分 `Object.prototype.hasOwnProperty` 与 `archive.tar.gz`；收紧规则会漏掉真实的多段文件名，因此宁可接受误报，并将其写入文档。

**query 导航条**（`ui-conversation`）。正文旁的一列固定刻度，每条用户 query 与 steering 消息各占一格，标记当前阅读位置属于哪一轮。它被重建为 CSS module 加字典键：补丁在模块作用域注入了一个 `<style>` 标签，并以 `documentElement.lang.startsWith('zh')` 分支，而这两者在源码中分别对应 `.module.css` 与 `ctx.locale`。它的几何量测自已解析的 scrollport 与 composer 顶边，而非在 CSS 中重述，因此会跟随窗口、侧边栏与不断增高的输入框。

它在 `ChatView` 中渲染在**最后**，这是承重的而非装饰性的：React 会先提交子节点的 layout effect 再提交父节点的，因此放在最前的导航条会在 `listRef` 与 `columnRef` 挂载之前就去测量，并就此永久把自己撤下。它是 `position: fixed`，所以文档顺序并不决定它的位置。

**可搜索提供方网格**（`ui-settings-models`）。添加卡片的原生下拉框会列出数十条休眠路由，既无搜索，在选定名称之前也看不到路由 id。现在它是一个卡片网格加一个搜索框，同时匹配展示名与路由 id，因此 `kimi` 与 `moonshotai-cn` 会找到同一张卡片，常用路由排在按字母序的尾部之前。该卡片以已选路由的摘要形态打开——填写该路由的密钥才是常见路径——并在点击**更换**时展开。

`ProviderChoice` 对其 target 是泛型的，因此页面自己的编辑目标类型——它携带的 settings 寻址信息本组件并不需要——可以不被压平地抵达 `onChoose`。

**侧边栏的宿主布局锚点被找了回来**（`ui-tianshu-brand`）。在梳理已停用的 `…ui-sidebar…` 补丁究竟做了什么时发现，它的 `data-dsh-sidebar-root` / `-wide` 属性并不属于品牌改造：`src/preload/windows-titlebar.ts` 会通过 root 测量侧边栏列，并在展开时为其补足上边距。它按属性定位，找不到时静默返回，因此退役该补丁其实已经让这个布局失效，且任何地方都不会报错。天枢侧边栏现已发布这两个属性，并有测试钉住、README 写明该约定——仅靠一条注释撑不过下一次重构。（该补丁的第三个属性 `-footer` 用于挂载手机配对按钮，[后续改动](2026-08-20-desktop-drop-pairing-and-localize.md)已将该功能移除。）

## 权衡结果

浏览器构建获得了全部六项；桌面构建则经由它本就在运行的同一份源码获得它们。六个补丁文件不再是针对一个移动目标产物的维护债。

两处过时断言随其所描述的行为一同变更：`ui-deliverables` 曾断言「没有产出的回合完全不产生提及词表」，`ui-settings-models` 曾通过 `<select>` 的 option 驱动添加卡片。两者现在都断言新行为。

`dsh-desktop` 的 `patches/` 是被删除而不是清空。全部十二个补丁文件位于 `docs/patches-disabled-for-tianshu/`，其 README 逐条说明；`patch-package` 会扫描 `patches/` 的子目录，因此停放在那里的停用补丁仍然会让 `npm install` 失败。

四个补丁未被移植，理由是决策而非时间：`…ui-sidebar…` 与 `…ui-layout…` 针对的是已被天枢侧边栏取代的外框；apiproxy 补丁的 preset 压缩包那一半需要本构建并不提供的宿主接口，`…ui-agent-preset…` 也因此一并停用；而 settings-models 的 onboarding 对话框那一半会替换本检出的首启步骤，那属于产品决策。

`dsh-desktop` 中断言这六个补丁字面内容的测试，如今又多了一层失败理由——行为是迁移了，而不是消失了。它们应当被改写为通过运行中的应用断言该行为，或被删除。

## 备选方案

**逐行转写每个补丁。**更快，且能与原补丁对 diff 核验。否决：这些补丁携带着在源码中无处安放的打包器产物。照抄注入的 `<style>` 标签与 `lang` 嗅探，会把两种本仓库有明确设施加以避免的反模式引进来，而评审者也无法把意图与打包器残留区分开。

**十个全部移植。**更一致，而且能清空该目录。否决：上文点名的四个卡在决策或缺失的能力上，而不是卡在工作量上。移植它们意味着要么在一次「补丁移植」的改动里凭空发明一个宿主能力，要么不问自取地替换首启流程。

**把这六个继续作为补丁，每次升级 rebase。**不改源码，桌面构建也保有其行为。否决：这会让浏览器构建拿不到这六项，而 rebase 的目标是一份 CSS module 哈希会随上游每次构建而变的编译产物。

## 测试

每项移植都有包内测试承载：两个适配器的状态码表新增了 `403` 与「配额先于状态码」用例；`client-runtime` 新增 `failure-display` 规格，覆盖三个被替换的 code 与透传路径；`ui-deliverables` 新增路径拼写各层、不可点击用例，以及那个已写入文档的误报；`ui-conversation` 新增 `query-rail` 规格覆盖阅读位置阈值，另有六个 ChatView 用例覆盖渲染后的导航条；`ui-settings-models` 新增 `provider-picker` 规格覆盖排序、搜索与两种形态。

`packages/*/*/src` 下每个被改动的包均保持 per-file 100%。`packages/client/runtime/src/**` 属于覆盖率豁免，因此其新增规格是行为覆盖，而非门禁要求。

`verify-models-section-styles` 门禁在本次工作中抓到了一件真事：它标记 `ProviderPicker.tsx` 存在一个未带共享 chevron class 的 `<select>`。命中的其实是一段散文注释中的那个词，而非标记——该门禁按字面字符串切分。注释已改写；门禁读取的是源码文本，把它收紧到跳过注释属于另一次改动。
