# Agent Note: The desktop client is dataelement/dsh-desktop pointed at this checkout

Status: implemented

[English](2026-08-18-tianshu-desktop-integration.md) | 中文

## 问题

天枢平台以桌面应用交付。产品本身已经建好——就是本仓库提供的浏览器客户端——缺的是把它当作应用运行起来的那一层。

先前的一次尝试自己写了一个（`apps/desktop`，约 250 行），原因是当时判断需求提到的 `dataelement/dsh-desktop` 不存在：npm 上的 `dsh-desktop` 是一个只有 README 的占位包，而对该仓库的网络探测被拦截，这被错误地当成了「不存在」。该仓库是真实且成熟的：4400 行代码，electron-vite、自动更新、局域网手机配对、插件恢复，以及一条带代码签名的发布流水线。

它现在被克隆在本检出旁边的 `dsh-desktop/`，自写的壳已删除。剩下的是集成问题——因为两者建立在不同的前提之上。

## 冲突所在

`dsh-desktop` 消费的是 npm 上**已发布**的 `@deepseek-ai/dsh@0.1.0-rc.7`，并用 12 个 `patch-package` 补丁去改 `node_modules` 里**编译后的 `lib/client.js`**——其中一个正在改侧边栏品牌。

而本仓库**就是**那份源码，天枢品牌做在源码里。不加改动直接运行，壳里显示的会是 DSH 原牌，不是天枢平台。

## 决策

把壳指向本检出，并退役那些因此变得多余或无法应用的补丁。

**两处 `file:` 引用取代已发布包。** `@deepseek-ai/dsh` → `file:../apps/cli`，`@deepseek-ai/dsh-web-frontend` → `file:../apps/web`。壳把 Harness 定位为 `node_modules/@deepseek-ai/dsh/lib/bin.js`，符号链接正好满足它，无需改动任何代码。前端那处引用还有第二重必要性：已发布的 `dsh-web-frontend` tarball **不含 `dist/`**（它按检出各自构建），因此在此改动前 `install-brand-assets.mjs` 会因找不到 `index.html` 而失败。

**整个 `@deepseek-ai/*` 家族通过 `overrides` 钉死在 rc.7。** 上游在该项目钉死 rc.7 之后发布了 rc.8；否则传递依赖会解析到 rc.8 并要求 rc.8 的 peer，而 npm 无法让它与那些 rc.7 钉子、或与本检出调和。

**12 个补丁全部退役**，其中两个改为移植进本仓库源码——理由记录在 `dsh-desktop/docs/patches-disabled-for-tianshu/README.md`：

- **`ui-directory-picker-native`** → `packages/client/ui-directory-picker-native`。客户端现在会在宿主壳发布了 `window.dshDesktopDirectoryPicker` 时优先使用它，否则回落到宿主服务，因此同一份构建同时服务浏览器与桌面。
- **`host-apiproxy`**（仅「directoryPicker 可选」那一半）→ `packages/host/apiproxy`。`directoryPicker` 移出 `static inject`，三处调用改为经 `ctx.get` 读取，缺失时返回既有的 `directory-picker-unavailable`。**没有这项改动，网关在桌面 profile 下根本无法激活**——该 profile 禁用了那个 picker；改动前实测启动失败于 `waiting for service: directoryPicker`。

**`install-brand-assets.mjs` 从 `postinstall` 中移除。** 它就地重写 `dsh-web-frontend/dist`，而该路径如今是本检出的构建产物，因此它会用 DSH logo 覆盖天枢 favicon——并且下一次 `pnpm run build` 又会无声地把它改回去。品牌属于本仓库源码。

**市场安装器那一行被注释掉**（`build/dsh-desktop.patch.yml`）。它是一个 workspace 本地插件，Harness 无法按裸名解析；而上游的解法是给 CLI 自身的 `package.json` 打补丁——经由符号链接，那会改到本仓库。

## 权衡结果

桌面应用现在跑的是本检出：启动它会从 `apps/cli` 拉起 Harness、提供天枢 UI，并强制执行 `dsh-webui-auth` 门禁。这是**实际运行验证过的**——壳在一个随机端口上拉起了子进程，该端口在 `/` 返回 `302`、`/api` 返回 `401`，并提供天枢登录页。

六个可选补丁未被带过来：错误分类（把 `403` 从 `401` 中拆出，QUOTA/FORBIDDEN 文案）、QueryRail 轮次导航、可搜索的模型提供方网格、可点击的内联路径，以及 preset 压缩包导入导出。它们都是自足的改进，日后值得移植进源码；没有一个是运行所必需的。preset 压缩包未移植，正是 agent-preset UI 补丁一并停用的原因——那个 UI 会调用本构建并不提供的接口。

**更新（2026-08-20）：** 其中六个已移植进源码——见[补丁移植笔记](2026-08-20-desktop-patches-into-source.md)。preset 压缩包那一半与 settings-models 的 onboarding 对话框仍未移植，理由记录在该篇中。

该项目自身有十个测试现在失败，每一个都在断言某个被停用补丁的字面内容。它们如实反映了改动，应当随着对应行为被移植进源码而重写或删除。

还有一个失败属于环境差异、并非本次改动所致：`profile-plugin-command` 期望内置的 pnpm 10.34.5，但 shim 解析到了本仓库的 pnpm 11.7.0——因为该项目现在位于本工作区内部。同样的嵌套还导致 vitest 继承了本仓库的根配置，项目内新增的 `vitest.config.ts` 已将其钉住。

## 备选方案

**保留自写的 `apps/desktop`。** 它小且已集成。在确认真实项目存在后否决：它从未被实际运行过，没有托盘、通知、自动更新、插件恢复与签名流水线，而把这些重新做砸，比采用一个有人维护的实现更糟。

**让 `dsh-desktop` 继续用已发布的 rc.7，把天枢品牌也做成补丁。** 这与该项目现有做法一致。否决原因：那些补丁改写的是带生成式 CSS-module 哈希的编译产物，而这些哈希在上游每次构建后都会变——那是承载品牌最难维护的地方；而且这样会浪费本仓库已经拥有的源码包。

**fork `dsh-desktop`，而不是就地修改克隆。** 对分歧改动而言归属更清晰。暂未采用：目前的改动只是几处依赖引用与停用补丁，保留克隆的 git 远端能让上游修复容易拉取。若壳本身需要实质修改，再重新评估。

## 测试

壳本身没有自动化覆盖——它是独立项目、有自己的测试套件，而本仓库没有 Electron 通道。集成是靠实际运行验证的：`npm run dev` 打开了窗口，壳自己的 `harness.log` 记录了子进程端点，该端点提供了带门禁的天枢 UI。

两处移植进来的源码改动在本仓库内有覆盖：`packages/client/ui-directory-picker-native` 新增了桥接与回落两条路径的测试，两个被改动的包均保持 per-file 100%。

复现时请注意：环境中的 `ELECTRON_RUN_AS_NODE=1` 会让 Electron 以纯 Node 方式运行，并以 `does not provide an export named 'BrowserWindow'` 失败。请取消该变量。Electron 二进制还需要一个可达的下载镜像（`ELECTRON_MIRROR`）。
