# Agent Note: 主界面改为个性化问候，侧边栏改为玻璃

Status: implemented

[English](2026-08-26-tianshu-hero-greeting-glass-column.md) | 中文

## Problem

产品所有者于 2026-08-26 结束多轮设计评审，对成品提出四点：侧边栏换更轻的质感（饱和品牌蓝列观感沉重，选定方向是"更浅、半透明"）；用更温暖的问候语替换泛用的"您好"标题并去掉内测版徽章；工作区胶囊移到输入卡下方并做浮起阴影（千问办公的姿态）；输入卡垂直正好居中，而非偏上。

hero 文本是组装后的浏览器输出，因此这里的每处改动都会体现在快照里；而依赖挂钟的问候语天然非确定——测试面必须随之迁移。

## Decision

**侧边栏 S4 质感。** `brand-tokens.ts` 现在为 `--dsw-specific-sidebar-fill` 提供半透明停靠色：浅色主题冰蓝玻璃，暗色半透明藏青。`TianshuSidebar.module.css` 加 `backdrop-filter: blur(18px)`，并翻转局部 ink 重绑：浅色列是浅色表面，子树读作玻璃上的深藏青 ink；`body[data-ds-dark-theme]`（ui-theme 的暗色权威信号，绝不读主题 id）把同一批 token 重绑回白色族，因为暗色列仍是暗表面上的半透明藏青。字标的光晕/延伸线对随之分主题（浅玻璃上 `#E2ECFC` 描边加藏青线；暗色白线加藏青光晕）。

**hero 问候。** `hero.headline`／`hero.preview` 移除；标题改为按时段的问候（5–12 上午好，12–18 下午好，其余晚上好）加第二行弱化的"有什么需要我来帮忙？"。用户名来自新增的 `GET /dsh-webui-auth/whoami`（加在本分支的认证插件里）：有会话时 200 返回用户名，无会话返回 `{ok:false}`，认证关闭返回 `{ok:true, username:null}`——绝不 404，未登录的浏览器因此不产生控制台网络噪音。ConversationRoot 每次挂载经微任务包裹的 fetch 解析一次（jsdom 安全，一切失败吞掉）并以 prop 传给 HeroShell；无认证面的宿主——桌面客户端、e2e 框架——渲染泛用问候。名字拼接走 locale 键（zh `'，{name}'`、en `', {name}'`），由各语言持有自己的标点。

**工作区行移到卡下。** hero 工作区行（胶囊 + agentPreset 座位）在 composer 栈里移到 InputBar 之后，胶囊重绘为浮起样式（`--dsw-specific-input-major` 填充、发丝边、`--dsw-shadow-lv2`），与卡左缘齐平。预设选择器保留在该行的座位——仍是仅 hero 阶段，这是其被记录的契约（会话产生历史后预设不可再换）。

**卡片真居中。** hero 外壳在卡上方渲染 72px、工作区行在下方 32px，flex 居中的栈因此把卡停在几何中心下方 20px；`.composerHero` 的 40px 底部内边距恰好抵消（该算术与卡高无关）。光晕锚点随卡移动（bottom 92 → 136）。以独立页面复刻实现 CSS 并测量验证：卡片中心落在列中心，残差 0.0px。

## Consequences

组装后的 hero 输出改变，无密钥快照随之迁移：`normalizeAria` 把时段问候短语折叠为 `{{greeting}}`（与其时钟规则同一"易变性折叠"家族——问候是挂钟状态，不是回归面）；lifecycle-chrome 的 hero／plan-active 黄金文件重排（工作区行现在跟在卡后），问候行拆成两个文本节点。e2e 存在性检查锚定在稳定的副标行上；HMR 探针编辑挂钟当前显示的问候键；鱼形标记新增 `data-hero-fish` 锚点，因为文本选择器无法寻址一个随时段变化的行。

whoami 端点是认证插件的第一个客户端可见面：只披露调用者自己存活会话的用户名，绝不披露 token，并对每个未认证状态返回成功形状的响应体。

暗色主题是被承接而非重新设计：玻璃停靠色是色相匹配的近似，与既有暗色取值同一姿态。

## Alternatives considered

**钉死 e2e 时钟而非归一化问候。** Playwright 的 clock API 可以为黄金捕获冻结时段。否决：暂停的时钟会冻结应用自身的计时器（tooltip、重连退避），恢复的时钟只是收窄竞态；问候是真正的挂钟状态，`normalizeAria` 本就持有这类折叠。

**把预设选择器移进 InputBar 工具行。** 能匹配获批设计稿的卡内位置。否决：该座位按契约仅限 hero 阶段（会话有历史后预设切换被拒绝），内联进条要么在活跃阶段显示死控件、要么分叉该槽的渲染。

**通过全局 token 层为玻璃列覆盖 `--dsw-alias-*` ink。** 与此前同理否决：该层落在 `body` 上，全局 ink 覆盖会重绘整个应用而非那一列。局部重绑（现在按主题分写）仍是接缝。

## Testing

包套件通过：ui-conversation（29 文件）与 ui-tianshu-brand（6 文件）全绿，改动文件保持逐文件 100%（whoami 加载器的三种结局——有名、无名、无 fetch 面——各有打桩测试）。仓库 `typecheck` 干净。卡片居中补偿在以实现自身 CSS 构建的页面上测量（残差 0.0px）。e2e 黄金文件已手工迁移到新 DOM 顺序，合并前应在 `DSH_SNAPSHOT=refresh` 下复核。
