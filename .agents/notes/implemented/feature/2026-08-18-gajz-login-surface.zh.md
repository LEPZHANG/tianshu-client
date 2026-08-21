# Agent Note: A login surface with no authentication behind it

Status: implemented

[English](2026-08-18-gajz-login-surface.md) | 中文

> **已被取代。** 本文所述的占位实现已被移除：产品现在通过 `dsh-webui-auth` 认证。见[真实的 WebUI 认证](../architecture/2026-08-18-webui-auth-adoption.md)。

## 问题

GAJZ 部署的设计稿要求一个登录页，产品也需要它作为前门。

而 dsh 没有任何认证可以放在它后面。整棵树里没有用户、没有账号、没有 token、没有 cookie、没有认证中间件——这是刻意的。上游在四处记录了这项推迟，包括 [`packages/host/webserver/README.md`](../../../../packages/host/webserver/README.md) 的「No TLS, auth, or origin policy」，以及[浏览器信任边界笔记](../architecture/2026-07-28-api-browser-trust-boundary.md)——后者明确否决了当时引入 auth token，理由是「token 的签发、存储与轮换是实打实的产品面」。真正存在的是可达性防护：回环绑定，加上 [`api-request-trust.ts`](../../../../packages/client/connection/src/api-request-trust.ts) 里的防混淆代理围栏，而那份文件自己的注释写着它「不是认证层」。

`session.prompt` 不在 `PRIVILEGED_METHODS` 里，因为默认预设自带 `bash`——任何能开启会话的人已经拥有等价于 RCE 的能力。因此在它前面摆一个浏览器侧登录框并不能让它变得有意义：`curl` 会完全绕过。

于是要求变成：做一个对自身定位诚实的前门，并且要让真实实现日后能够直接插入，而不必重写。

## 决策

交付界面与客户端状态机；不把两者中的任何一个伪装成安全边界。

**接缝是按真实后端而非占位实现设计的。** `AuthClient.signIn` 是异步的，并返回可判别的 `SignInResult` 而非抛异常，因为网络实现的失败方式是表单必须区分的——密码错误与服务器不可达需要不同的提示。`SignInFailure` 已经带上 `unreachable` 与 `serverError`；占位实现永不返回它们，而界面已经能渲染这两种。把 `createLocalAuthClient` 换成宿主后端实现只需改 `apply` 中的一行；组件、store 与契约都不动。

凭据格式校验在两种世界里都留在客户端。它决定提交按钮何时点亮，从不决定是否授予访问权。

**门禁挂在 `shell.overlay`。** 那是布局所属的、可叠加且点击穿透的全框层，目前没有其他注册者。门禁在整个会话期间保持挂载，并在每次渲染时自行决定是否绘制；已登录用户渲染 `null`，该层保持点击穿透。注册走 `ctx.slots.inject`，因为它与 ui-layout 的 apply 顺序不受约束。

真正绘制时，它复用 ui-primitives 的 `OnboardingSurface`——portal 到 `document.body`，并在其自身生命周期内把 `#root` 置为 inert——而不是重新实现这套外壳。

**登录态会持久化，且「记住密码」在恢复时被尊重。** store 把已登录用户存在 `dsh.gajz.auth` 下；不写入任何密钥。持久化是整值写入，因此用户明确不愿记住的会话也会像其他状态一样落盘；于是界面在每次页面加载的首次挂载时，会登出 `remember` 为 false 的恢复会话。该标志必须先被写入才能在恢复时读到，这就是它存在于 state 中、而不是用来阻止写入的原因。

## 它不做什么

在此明确写出，因为最危险的失效模式是有人把登录页读成防护：

- 它不授予也不拒绝任何东西。所有宿主 RPC 在它存在时依旧可达。
- 不得以它为由开启 `dsh web --host 0.0.0.0`。CLI 对该参数的拒绝是承重的，必须保留。
- 通过设计稿的关闭控件关掉它，只是在本次页面加载内隐藏。这没有绕过任何东西，因为本来就没有东西被把守。

## 备选方案

**把门禁挂在 shell 的启动门 `AppRoot` 上。** 它的吸引力在于运行早于插件，即使插件链失败也仍会绘制。否决原因：`AppRoot` 是纯内核组件，受一条明文的 shell 自足规则约束，不得依赖任何插件——在那里的登录页将没有主题 token、没有 locale、没有 primitives，只能硬编码自己的文案与颜色。只有当认证必须早于插件加载时，这份代价才值得，而那需要目前并不存在的宿主侧层。

**现在就构建真实的宿主侧认证层。** 这是正确的终局，而且接缝异常容易找——一条 `/api` 路由、一处 `registerDownlink`、一处 `postJson`，且 `host.describe` 的注释已经邀请扩展。本次否决的理由是范围：它需要 token 的签发、存储与轮换，一个新的 `unauthorized` RPC 错误码，`ConnectionController` 里一条「停止重试」的路径，以及对静态 SPA、`/plugins`、boot manifest 与 HMR 端点的覆盖——这些全都在 `/api` 围栏之外。把它做砸比不做更糟，因为那看起来像防护。

**让占位实现只接受一组硬编码凭据。** 曾被考虑，因为那更像一个真实登录。否决原因是它严格更差：授予的访问权完全相同，却暗示存在一次并未发生的校验，还会诱使人们把一个共享口令当成防护。

**不做持久化，每次加载都重新弹出。** 更简单，也回避了整值持久化的那道褶皱。否决原因：恢复路径恰恰是日后最容易做错的部分，而现在就把它建立在 store 之上，正是让 token 将来能落进同一个位置的前提。

## 权衡结果

认证的客户端一半已经存在并被覆盖，因此补上宿主侧的后续工作是一次后端改动加一行替换，而不是一个 UI 项目。那项工作将撞上的三个障碍已记入该包的 Known Limitations：`ConnectionController` 中无法区分 401 与断线的裸 `catch`、未被挂载的 `ConnectionBanner`，以及未经认证的非 `/api` 路由。

本部署现在会显示一个拦不住任何人的登录页。若它被误认为安全措施，这就是真实的隐患——因此 README 以此开篇、本笔记点名它，并在两处都写明 `0.0.0.0` 拒绝是承重的。

有两个控件在没有后端的情况下渲染：「获取验证码」与「忘记密码」。验证码路径的其余部分是完整的：字段接受六位数字并以 `verificationCode` 提交。

## 测试

`packages/client/ui-gajz-login/tests/` 覆盖校验器与占位实现的裁决、注册（overlay 占位、store 座位、注入回调、ui-layout 尚未声明插槽时的延迟注册、卸载），以及界面本身：何时绘制、提交门槛、数字剥离、记住选择进入 store、每种失败裁决的提示、后端以 reject 而非 resolve 返回失败、提交进行中的重复提交、字段引导，以及切换 tab 清空密文。本包达到 per-file 100%。

store 的 `localStorage` 持久化会跨越同一 jsdom 环境中的单个测试，因此界面 spec 在每个测试之间清空它；否则一个完成登录的测试会把它的会话恢复进下一个测试。
