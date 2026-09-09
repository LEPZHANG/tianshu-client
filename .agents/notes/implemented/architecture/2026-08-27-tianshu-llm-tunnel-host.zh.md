# Agent Note: 远程 GPU 模型的 SSH 隧道宿主插件

Status: implemented（三里程碑之二——宿主插件加浏览器卡片）

[English](2026-08-27-tianshu-llm-tunnel-host.md) | 中文

## Problem

产品需要不在公网上的模型：本地 GPU（由同日落地的自定义提供方预设服务）以及只能经 SSH 到达的远程 GPU 服务器——模型端点绑在服务器自己的 localhost 上。模型层本身已通过 `llm-pi-ai` 说 OpenAI 兼容协议；不存在的是让远程端点本地可达的那一层。

所有者的 GPU 服务器用密码登录，本地模型部署也在计划中——两个事实决定了分期。

## Decision

新宿主插件 `@deepseek-ai/dsh-host-llm-tunnel` 只拥有隧道层。一个配置的主机 = subprocess 接缝下的一个 `ssh -N -L` 子进程（树级终止、销毁清理）加一个 Typert RPC 面（`snapshot` / `restart` / `probe`）。

**隧道不承载任何模型流量。** 隧道服务的 provider 行以手工声明路由的形式写进 `llm-pi-ai` settings 命名空间，`baseURL: http://127.0.0.1:<localPort>/v1`——模型设置 UI 已渲染的既定路径。请求、探测、选择器原样工作；模型层不知道隧道存在。

**相位是推导的，不是指令的。** `ssh` 的连通恰好等于其子进程存活，因此状态 = 子进程存活 + 死亡时的最后一行 stderr。没有端口轮询计时器：`probe` 按需以一次 `/v1/models` 请求证明 ssh、转发、服务器三者。

**和解（reconcile）而非生命周期指令。** `llm-tunnel` settings 命名空间是唯一事实源：每次有效变更（用户编辑、组合基、提供方脱挂）重新同步存活集——新主机启动、移除主机停止、未动主机的子进程继续跑，无关编辑绝不丢在途请求。配置形状变化（端口移动）重启该主机的子进程，因为其转发已过期。

**认证留在系统 ssh 二进制。** 子进程带 `BatchMode=yes` 与 `StrictHostKeyChecking=accept-new`，既有密钥、agent、`~/.ssh/config` 别名原样可用。

## Consequences

里程碑一仅服务密钥认证：纯密码服务器快速失败，ssh 诊断进状态行。这是所有者声明的登录方式，因此二、三阶段已排定：一次性密钥初始化（ssh-copy-id 手势，密码存凭据库）与 ssh2 库兜底隧道。设计有意留了空间——manager 的 spawn 是一个方法，RPC 面在三个里程碑间保持稳定。

本地端口冲突表现为隧道失败（ssh 报 bind 错误）；尚无端口分配。

Typert 把它的约束带到了 wire 类型上：RPC 载荷必须 JSON 形状，`detail` 是 `string | null` 而非 `undefined`——生成器在构建时拒绝非 JSON 边界类型，这正是接缝在履职。

## Alternatives considered

**llm-pi-ai 内按请求建隧道的适配器。** 否决：把进程生命周期放进模型适配器——模型请求是发现隧道已死的最坏位置，且所有 provider 被迫继承该复杂度。

**为隧道路由建专门 llm 适配器。** 否决：provider 行已命名普通路由；第二个适配器会分叉 `llm-pi-ai` 已拥有的协议处理。

**apiproxy dispatch 行的 RPC 路径。** 否决，改用 `TypertRemoteService`：宿主侧无需逐方法的 schema/dispatch 接线，同一 `/api` 载体与认证围栏，客户端工件自动生成。

## Testing

`tunnel.spec.ts` 组装 Loader + 内存 settings 提供方 + 假 subprocess 接缝 + 真实服务：钉死的 ssh argv、connecting→failed 相位迁移带 stderr 诊断、无关 settings 变更下未动主机的存活、诚实的探测失败、未知主机的 restart。invariant 伴随套件覆盖注册/销毁。7 项测试全绿；`tsc -b` 干净；宿主与客户端两面均构建通过（typert 工件已生成）。`test:gui` 无新失败——剩余两个红文件早于本工作。

## 里程碑二：浏览器卡片

`RemoteGpuCard`（在 `ui-settings-models`）是「添加提供方」「添加自定义提供方」旁的第三个入口。一次创建写入两行 settings：主机落在 `llm-tunnel`（上面的插件在 settings 变更内和解出一个子进程）、提供方行落在 `llm-pi-ai` 指向转发端口——模型层此后把该 GPU 当普通声明路由服务。提供方写入的 revision 竞争回滚隧道行（`op: 'unset'`），重试绝不半声明。「测试连接」按钮经 api/remotes 挂载的生成 remote 命名空间走 `llmTunnel.probe`，并把隧道诊断拼进本地化失败文案（footer 级的 `t` 没有插值席位）。注入面直接用 `ctx.remote.llmTunnel`——branded `TunnelHostId` 边界在卡片调用处以一次 `as never` 跨过，因为卡片的 id 正是宿主拥有的 settings key。

包测试增至 235（卡片：字段门控、两行写入、revision 竞争回滚、探测诊断、占用 id 拒绝）；既有 `ModelsSection` 挂载全部补了 probe 桩（分区现在要求该面）。两面与客户端 bundle 均已重建。
