# @deepseek-ai/dsh-host-llm-tunnel

[English](README.md) | 中文

SSH 端口转发隧道，把远程 GPU 上的 OpenAI 兼容模型端点暴露在 localhost 上。

每配置一个主机，就得到一个由 subprocess seam 拥有的 `ssh -N -L <localPort>:<remoteHost>:<remotePort> user@host` 子进程，外加该隧道经 Typert RPC 对外呈现的实时投影。模型请求本身走普通的 `llm-pi-ai` 提供方路径：隧道的提供方行（写入 `llm-pi-ai` settings 命名空间的 `providers.<route>`，带 `baseURL: http://127.0.0.1:<localPort>/v1`）与其他任何一条路由一样，都是手工声明的，因此 composer 的模型选择器、模型发现与 Models 设置界面无需改动即可工作，也永远不会知道隧道的存在。

## 配置

`llm-tunnel` settings 命名空间承载一张从主机 id 到其连接的映射表：

```yaml
llm-tunnel:
  hosts:
    my-gpu:
      host: gpu.example        # or a ~/.ssh/config alias
      sshPort: 22
      user: ops
      remoteHost: 127.0.0.1    # model endpoint as seen from the SSH server
      remotePort: 8000         # e.g. vLLM's default
      localPort: 18000
```

每次有效变更都会和解（reconcile）当前存活集：新增的主机启动，移除的主机停止，未改动主机的子进程继续运行，因此在途请求不会被一次无关的编辑打断。

## RPC 接口

`snapshot` 报告每条隧道的阶段（`connecting` / `connected` / `failed`，由子进程的存活状态推导）及其本地 base URL；`restart` 重新 spawn 一条隧道；`probe` 经该转发抓取 `/v1/models` 并返回列表，一次往返即可验证整条链路。

浏览器侧的入口是 Models 设置页面上的「添加远程 GPU」卡片（位于 `ui-settings-models`）：它在这里写入一行主机，并在 `llm-pi-ai` 写入一行指向转发端口的提供方行，其测试按钮走 `probe`。

## 模型体验

无：隧道不承载提示词内容，也不改变任何面向模型的输入。它服务的提供方行才是面向模型的接口，而那是一条普通的 `llm-pi-ai` 路由。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅支持基于密钥的 SSH 认证（里程碑一）**：子进程以 `BatchMode=yes` 运行，因此只接受密码的服务器会快速失败，并在状态行中给出 ssh 诊断。一次性密钥下发（即 ssh-copy-id 这一步，密码保存在凭据存储中）是计划中的下一个里程碑；不要求系统自带 ssh 的 ssh2 回退隧道再排在其后。
- **不自动分配端口**：`localPort` 与无关监听端口冲突时表现为隧道失败（详情里是 ssh 退出时的 "bind: Address already in use"）；由用户另选一个端口。
- **没有重连退避**：隧道中断后报告 `failed` 并停在该状态，直到用户重启它，或某次 settings 变更重新同步；存活子进程内部的短暂网络抖动由 ssh 自身的 `ServerAliveInterval` 负责。
