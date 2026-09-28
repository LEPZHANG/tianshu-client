# Agent Note：桌面客户端移除手机配对并改说天枢

Status: implemented

[English](2026-08-20-desktop-drop-pairing-and-localize.md) | 中文

## 问题

针对[已采用的桌面外壳](2026-08-18-tianshu-desktop-integration.md)提出的两点：不需要局域网手机配对功能，产品应当以中文呈现。

两者都不只是表面工夫。配对不是一个按钮——它是一个绑定在局域网接口上的 HTTP 服务器。而「改成中文」背后其实有三个各不相同的成因：完全没有译文的字符串、有译文但读错了 locale 来源的字符串，以及仍在使用上游产品名的字符串。

## 决策

**手机配对是移除，不是隐藏。** 删除 `src/main/mobile/`（524 行：`LanMobileBridge` HTTP 服务器与它渲染的配对页面），同时删除 `mobile:open-pairing` 与 `mobile:status` 两个 IPC handler、配对 `BrowserWindow`、preload 注入的侧边栏按钮及其 1 秒轮询、原生菜单与 Windows 标题栏菜单中的 `connect-phone` 命令，以及该命令在共享白名单中的条目。`qrcode` 依赖随之移除——没有别处引用它。

只隐藏入口会让 bridge 仍被构造、监听端口仍可达。移除它关闭了 43127（开发版 43128）端口上那个把工作区提供给同一 Wi-Fi 下任意设备的监听器，这是安全姿态的变化，而不只是少了一个功能。

**侧边栏的 `data-dsh-sidebar-footer` 锚点随之撤下。**[上一次改动](2026-08-20-desktop-patches-into-source.md)加上它，正是因为配对按钮挂在那里；没有消费方之后，它就成了为谁都不服务的属性。`-root` 与 `-wide` 保留：`src/preload/windows-titlebar.ts` 仍通过它们测量该列，因此对应的测试是收窄而非删除。

**原生菜单现在跟随 Harness 语言偏好。** 它此前读的是 `app.getLocale()`——操作系统语言——而这里其他所有界面读的都是用户经 `harnessLocale()` 存下的偏好。一个操作系统是英文、Harness 设为中文的用户，会得到一条英文菜单栏压在中文窗口上。这才是「中文化」诉求真正指向的缺陷，而它只需改一行。

**其余没有译文的字符串是顶级菜单标签**（`Edit`、`View`、`Window`）与启动闪屏——后者是在任何 locale 可知之前渲染的静态 HTML。菜单标签现已双语；闪屏直接用中文，因为它无从查询 locale，而天枢平台本就是中文产品。

**凡是用户会读到的地方，产品名一律为天枢平台**：`app.setName`、`productName`（安装包与 Windows 快捷方式）、关于对话框、错误弹窗、更新卡片及其文案、Windows 标题栏，以及插件恢复界面的品牌与退出标签。

有三个名字被刻意保留。`appId`（`io.dsh.desktop`）是身份键而非展示字符串——改动它会让一次升级看起来像换了一个应用。`userData` 目录出于同样理由本就被钉成字面量，并附有说明注释。而开发版的 `productName` 为 release workflow 中的四处 `.exe` 路径所依赖。

## 权衡结果

桌面应用可以启动、在随机端口拉起 Harness，并提供带门禁的天枢 UI——已实际运行验证：`/` 返回 `302`，且 43127 上不再有监听。

它自己的测试套件少了两个文件（`lan-mobile-bridge`、`lan-mobile-pages`）与一个用例（侧边栏手机入口）。两处断言随行为一同变更：标题栏白名单改为断言一个仍然存在的命令，闪屏断言改为断言中文文案。

**有一个测试因锁文件而开始失败。** `declares required DSH peer packages as production dependencies` 发现有 18 个 `@deepseek-ai` 包被记为 peer-only 而非 production，这是更早那次 `file:` 引用改动的后果。它现在钉住了已知数量与其中一员，因此**新出现**的 peer-only 包仍会让它失败。

当时在此处记录的解释——说 `apps/cli` 把这一族声明为 `peerDependencies`——是错的；它一个都没有声明。真实机制是已发布的 rc.7 包彼此声明为 peer，而没有任何东西把它们声明为直接依赖。[后来对打包产物的检查](2026-08-21-desktop-installer-two-repo-build.md)表明这根本不是打包缺陷：那些包被正确打包了。真正的缺陷在别处。

它仍有十二个测试因针对已退役补丁而失败，与本次工作之前一致。

## 备选方案

**隐藏配对入口、保留 bridge。** diff 更小，且恢复一个菜单项即可回滚。否决：诉求是不要这个功能，而一个已构造、且带着活跃局域网监听的 bridge 才是要害。会开端口的死代码比普通死代码更糟。

**通过强制全中文来完成本地化。** 对「改成中文」最直白的理解，并且能删掉所有英文分支。否决：该外壳本就按设计双语，并跟随用户在 Harness 中设定的偏好。写死中文会破坏任何设为英文的用户的体验，也会丢弃那些本就正确的译文。修正 locale **来源**才是真正的缺陷所在。

**把 `appId`、`userData` 与开发版产品名一并改掉。** 更一致，且不会在任何地方留下 `dsh-desktop` 字样。逐条否决：改 `appId` 会让已安装用户的数据变成孤儿，`userData` 路径有文档说明是刻意冻结的，而开发版名称被 release workflow 的产物路径所依赖。

## 测试

桌面项目是独立仓库、有自己的测试套件，而本仓库没有 Electron 通道。移除是靠运行构建后的应用验证的：它成功启动、其 Harness 子进程在 `/` 返回 `302`，且 43127 与 43128 上都没有进程监听。

在本仓库内，`packages/client/ui-tianshu-brand` 保持 per-file 100%；其锚点测试收窄为仍有消费方的那两个属性，这正是重构若丢掉它们就会失败的那道检查。
