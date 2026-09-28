# Agent Note: 面向远程 GPU 模型的 SSH 隧道宿主插件

Status: implemented

[English](2026-08-27-tianshu-llm-tunnel-host.md) | 中文

## 问题

产品需要不在公网上的模型：本地 GPU（由同日落地的自定义提供方预设提供服务），以及只能经 SSH 到达的远程 GPU 服务器——那里的模型端点绑在服务器自己的 localhost 上。模型层本身已经通过 `llm-pi-ai` 说 OpenAI 兼容协议；缺的是让远程端点在本地可达的那一层。

所有者的 GPU 服务器用密码登录，本地模型部署也在计划中——这两个事实决定了分期方式。

## 决策

新增的宿主插件 `@deepseek-ai/dsh-host-llm-tunnel` 只持有隧道层，不管别的。一台已配置的主机对应 subprocess seam 下的一个 `ssh -N -L` 子进程（树级终止、dispose 时清理），外加一个 Typert RPC 面（`snapshot` / `restart` / `probe`）。

**隧道自身不承载任何模型流量。** 隧道所服务的提供方行，以手工声明路由的形式写进 `llm-pi-ai` 的 settings 命名空间，`baseURL: http://127.0.0.1:<localPort>/v1`——这正是 Models UI 早已渲染的、被认可的路径。请求、发现和选择器都原样工作；模型层里没有任何东西知道隧道存在。

**阶段是推导出来的，不是下指令得到的。** `ssh` 处于连通状态的时间恰好等于其子进程存活的时间，因此状态就是子进程的存活情况，加上它死亡时的最后一行 stderr。这里没有端口轮询定时器：`probe` 按需用一次 `/v1/models` 请求回答「端点到底能不能用」，一个来回同时证明 ssh、转发和服务器三者。

**调谐（reconcile），而不是生命周期指令。** `llm-tunnel` settings 命名空间是唯一真源：每一次生效的变更（用户编辑、组合基线、提供方解绑）都会重新同步存活集合——新主机启动、被移除的主机停止，而未被触及的主机的子进程继续运行，因此无关的编辑绝不会丢掉在途请求。配置结构发生变化（端口挪了）时会重启该主机的子进程，因为它的转发已经陈旧。

**认证仍由系统的 ssh 二进制负责。** 子进程带 `BatchMode=yes` 与 `StrictHostKeyChecking=accept-new` 运行，因此既有密钥、ssh agent 和 `~/.ssh/config` 里的别名都原样可用。

## 后果

已经落地的是宿主插件，以及下文那张浏览器卡片；两者所服务的都只有基于密钥的 SSH 认证，因此只支持密码的服务器会快速失败，并把 ssh 的诊断信息带进状态行。这正是所有者声明的登录方式，所以还有两件事排在其后：一次性的密钥下发（ssh-copy-id 这个动作，密码存放在凭据存储里）与基于 ssh2 库的兜底隧道。设计刻意为它们留出了空间——manager 的 spawn 只是一个方法，两者中任何一件落地都不会改动 RPC 面。

本地端口冲突表现为隧道失败（ssh 会报出绑定错误）；目前还没有端口分配。

Typert 把它的约束带到了协议类型上：RPC 载荷必须是 JSON 结构，因此 `detail` 是 `string | null`，绝不是 `undefined`——生成器在构建期就拒绝非 JSON 的边界类型，这正是该 seam 在履行职责。

## 曾考虑的替代方案

**在 llm-pi-ai 内部做一个按请求建隧道的适配器。** 不采用：这会把进程生命周期放进模型适配器，而那恰恰是唯一观测不到它的地方（模型请求不是发现隧道已死的场合），并且每个提供方都得继承这份复杂度。

**为隧道路由单独做一个 llm 适配器。** 不采用：提供方行命名的本来就是一条普通路由；第二个适配器只会分叉 `llm-pi-ai` 已经持有的协议处理。

**走 apiproxy 的 dispatch 行 RPC 路径。** 不采用，改用 `TypertRemoteService`：宿主侧不需要逐方法的 schema／dispatch 接线，共用同一个 `/api` 载体与认证围栏，并且客户端产物是生成的。

## 测试

`tunnel.spec.ts` 把 Loader、一个内存 settings 提供方、一个假的 subprocess seam 和真实服务组装到一起：钉死的 ssh argv、带 stderr 诊断的 connecting→failed 阶段迁移、无关 settings 变更下未被触及主机的存活、诚实的探测失败，以及对未知主机执行 restart。不变式伴随套件覆盖注册与 dispose。7 项测试全绿；`tsc -b` 干净；宿主与客户端两面都能构建（typert 产物已生成）。`test:gui` 没有新增失败——剩下的两个红文件早于本次工作。

## 浏览器卡片

`RemoteGpuCard`（位于 `ui-settings-models`）是继「添加提供方」和「添加自定义提供方」之后，添加流程里的第三个入口。一次创建写入两行 settings：主机那行落在 `llm-tunnel` 下（上文那个插件会在这次 settings 变更内把一个子进程调谐出来），提供方那行落在 `llm-pi-ai` 下并指向被转发的端口——此后模型层就把这块 GPU 当成一条普通的声明路由来服务。提供方写入遇到 revision 竞争时会回滚隧道那行（`op: 'unset'`），因此重试创建绝不会停在半声明状态。「测试连接」按钮经 api/remotes 挂载的生成 remote 命名空间走 `llmTunnel.probe`，并把隧道的诊断拼进本地化的失败文案（footer 级的 `t` 没有插值席位）。这个面直接以 `ctx.remote.llmTunnel` 注入——branded 的 `TunnelHostId` 边界在卡片的调用处用一次 `as never` 跨过，因为卡片持有的 id 正是宿主所拥有的那个 settings 键。

包内测试增至 235 项（卡片部分：字段门控、两行写入、revision 竞争下的回滚、探测诊断、已占用 id 的拒绝）；既有的每一处 `ModelsSection` 挂载都补了 probe 桩，因为该分区现在要求这个面。两个面和客户端 bundle 都已重建。
