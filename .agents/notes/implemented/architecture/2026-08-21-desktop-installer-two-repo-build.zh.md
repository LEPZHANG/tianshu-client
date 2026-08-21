# Agent Note：桌面安装包需要两个仓库，而 CI 从来不知道

Status: implemented

[English](2026-08-21-desktop-installer-two-repo-build.md) | 中文

## 问题

目标是产出正式安装包；而打包这条路径此前从未被真正跑过。

[更早的一次改动](2026-08-18-tianshu-desktop-integration.md)让 `dsh-desktop` 经由 `file:../apps/cli` 与 `file:../apps/web` 指向本检出。这让 `npm run dev` 能跑通，当时验证的也正是这一点。没有人追问过：`electron-builder` 遇到一个指向项目之外的符号链接依赖会怎么处理，以及 CI 单独检出 `dsh-desktop` 时会发生什么。

[上一篇笔记](2026-08-20-desktop-drop-pairing-and-localize.md)记录了一个相关的担忧——锁文件中有 18 个包被记为 peer-only——并用测试把它钉住，而不是真正解决。事实证明那个担忧找错了对象。

## 实测结果

**本地打包是可用的。** `electron-builder --dir` 能够完成，且产物是健全的：198 个 `@deepseek-ai` 包被实体化为真实目录（electron-builder 在其 manual traversal 阶段解析了符号链接）、产物中没有任何断链、构建出的 Web 客户端带有天枢标题、认证插件也在。启动打包后的可执行文件，它拉起的 Harness 入口位于包内——`resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js`——`/` 返回 `302`，`/api` 与 `/plugins` 返回 `401`，并提供带品牌的登录页。从打包目录内部解析依赖，结果也留在内部。

因此 peer-only 这个锁文件标记并不是打包缺陷。那些包确实被打进去了。

**CI 打包则是静默损坏的。** 未指定 `repository` 的 `actions/checkout@v4` 只会检出 `dsh-desktop`。在隔离目录中模拟后，`npm ci` **以 0 退出**，却把 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-web-frontend` 留成指向并不存在的 `../apps` 的断链。没有任何地方报错。构建会继续进行，产出一个 Harness 入口指向空处的安装包。

这才是真正的阻塞点，而它最糟糕的性质是「无声」。

**而且安装包本来也无法在此机器上产出。** `scripts/verify-target.mjs` 拒绝为非宿主平台打包，且本机没有 wine。真正的 DMG 或 NSIS 安装包必须来自 macOS 或 Windows runner——这意味着 CI 是必经之路，而非可选项。

## 决策

**在三个位置响亮失败。** `scripts/verify-harness-checkout.mjs` 检查两个引用目标是否存在且已构建，并区分两种失败形态：缺失的检出在安装阶段就会失败，而存在但未构建的检出只会在更晚——打包复制了一个空 `dist/` 时——才出问题。它在 `postinstall` 与 `build` 两处运行。CI 的 `preflight` 任务会在 `vars.HARNESS_REPOSITORY` 未设置时拒绝启动构建，因为空的 `repository:` 会静默回落到当前仓库，从而打包错误的 Harness。

**每个构建任务检出两个仓库。** Harness 检出到 `harness/`，本项目检出到 `harness/dsh-desktop/`，这样 `../apps/cli` 就能解析。`pnpm install && pnpm run build` 在 `npm ci` 之前运行，因为安装期守卫检查的正是构建产物。任务级的 `defaults.run.working-directory` 会作用于 `run` 步骤；`uses:` 步骤不遵循它，因此四处产物上传的路径列表显式携带了嵌套前缀。

该检出携带 `secrets.HARNESS_TOKEN || github.token`：默认 token 的作用域仅限运行该 workflow 的仓库，因此私有 Harness 在没有它时会 404，而公开 Harness 则无需额外配置。Harness 来源本身是一个仓库变量而非字面量。天枢品牌所在的检出，其 remote 仍是上游 `deepseek-ai/deepseek-harness`，而后者并不携带这些改动——在此写死任何名字都是把猜测固化进去。

**macOS 校验步骤现在推导 bundle 名称。** 它们写死了 `DSH Desktop.app`，而改名为天枢平台使其失效。由于 `codesign --verify` 是针对路径执行的，过时的名称会让签名校验掠过一个并不存在的 bundle。它们现在读取 `build.productName`，因此下一次改名不会悄悄跳过校验。

## 权衡结果

发布现在需要预先设置一个仓库变量，且耗时更长：每个构建任务都要先构建一次 Harness。这份代价正是该依赖关系的真实形状——这个外壳打包的是一个它自身并不包含的 Harness。

有三个名字保持原样，理由各不相同。`appId` 是身份键，改动它会让已安装用户的数据变成孤儿。`userData` 路径被钉成字面量并附有说明注释。开发版的 `productName` 为 release workflow 中四处 `.exe` 路径所依赖。

桌面项目自己的 README 写的是 `git clone dsh-desktop && npm install`，而这如今会静默产出一棵坏树；两个语言版本现已描述双仓库布局，并明确指出单独检出会「看起来正常」。它们对 `patches/` 的引用还有第二重过时——那个目录已经不存在了。

它的两个测试随行为一同变更：macOS 任务形态断言钉住的相邻关系被 `needs` 与 `defaults` 破坏，另有一个新测试钉住双检出结构、先构建后安装的顺序，以及不存在未加前缀的产物路径。仍有十三个失败，均为此前已记录的：十二个断言已退役补丁的内容，一个期望内置 pnpm 而实际解析到本工作区的版本。

**这一条没有端到端验证。** 本地 `--dir` 构建与打包后的应用都实际跑过并检查过。CI workflow 只做了 YAML 校验与逐步推演，尚无 runner 执行过；首次运行还需要把 `HARNESS_REPOSITORY` 指向一个真正携带该品牌的检出。

## 备选方案

**发布天枢包并按版本号依赖。** 恢复该外壳的原始设计，且 CI 完全不用改。未采用：这需要把带品牌的包发布到 registry，而诉求是一个可用的安装包，不是一条发布流水线。

**把预构建 tarball 内置进桌面项目。** 自足，且 CI 保持单检出。经查证后否决：`apps/cli` 依赖约 58 个 workspace 包，因此只打包它自己会让其余依赖从 registry 解析——那是已发布的 rc.7，而非本次构建。要内置整棵树意味着内置约 200 个包。

**不动 CI，在 Windows 与 macOS 机器上手工出包。** 无需改动 workflow，且本地构建已证明该流程可用。作为主方案被否决：正式安装包由流水线签名与公证，手工路径会丢掉这一环。README 仍然记录了手工布局，因为前提条件是同一个。

**把那 18 个 peer-only 包补成直接依赖。** 这会让先前那个测试诚实地通过。在真正检查过打包结果后否决：那些包本就被正确打包，而声明它们等于断言 npm 安装的那些副本是重要的——可运行的应用其实有 41 个中的 39 个是经 workspace 解析的。

## 测试

`electron-builder --dir` 针对本地 Electron dist 完整跑通，并对产物做了审计：包数量、符号链接完整性、构建产物中的品牌，以及从打包目录内部的依赖解析。打包后的可执行文件被实际启动；其 Harness 子进程提供了带门禁、带品牌的界面。

CI 的失败是被复现的而非假设的：把 `package.json` 与 `package-lock.json` 复制到一个没有同级目录的隔离目录中，`npm ci` 以 0 退出并留下两条断链。

`verify-harness-checkout.mjs` 针对全部三种输入做了验证——存在且已构建、完全缺失、存在但未构建——并直接检查其退出码，而非经由管道。
