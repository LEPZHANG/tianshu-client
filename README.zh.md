# 天枢平台

[English](README.md) | 中文

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面智能体客户端。

本仓库包含三份代码，各自独立且均为 MIT 许可：

| 目录 | 内容 | 上游 |
|---|---|---|
| `apps/`、`packages/`、`vendor/` | Harness 主体（含天枢品牌与界面改动） | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| `dsh-desktop/` | Electron 桌面客户端 | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) |
| `dsh-webui-auth/` | 登录认证插件 | [Yuuz12/dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth) |

三份 `LICENSE` 分别保留在对应目录中。

Harness 项目自身的 README 保留为 [README.harness.md](README.harness.md)。

## 目录布局不能改

`dsh-desktop/package.json` 通过相对路径依赖 Harness：

```json
"@deepseek-ai/dsh":              "file:../apps/cli",
"@deepseek-ai/dsh-web-frontend": "file:../apps/web"
```

因此 `dsh-desktop/` 必须是仓库根目录的直接子目录。移动它会让这两条路径失效。

`npm` 创建 `file:` 符号链接时**不检查目标是否存在**，缺失时安装仍然以 0 退出，直到打包阶段才会暴露。`dsh-desktop/scripts/verify-harness-checkout.mjs` 就是为此存在：它在 `postinstall` 与 `build` 两处检查这两个目录既存在、又已构建，并区分「未检出」和「已检出但未构建」两种情况。

## 环境要求

- **Node** `^22.19.0 || >=24.0.0`
- **pnpm** `11.7.0`（仓库以 `packageManager` 字段固定）

`dsh-desktop` 运行时需要 Node 24 与 Electron 43，两者都作为它自己的 npm 依赖安装，无需单独准备。

## 构建

顺序不能颠倒：`dsh-desktop` 的安装期守卫要求 Harness **已经构建完成**。

```sh
# 1. Build the Harness
pnpm install
pnpm run build          # must run in full — see the note below

# 2. Then install the desktop client
cd dsh-desktop
npm ci
```

> `pnpm run build` 包含 `build:lib`（编译 220 个包到各自的 `lib/`）与 `build:web`（打包 Web 前端）两步。客户端的界面插件是从各包的 `lib/` 加载的，**只跑 `build:web` 不会让 `packages/` 下的改动生效**。

构建产物（`lib/`、`apps/web/dist/`、`dsh-desktop/out/`）不进版本库，需自行构建。

## 运行

```sh
cd dsh-desktop
npm run dev
```

### 首次启动需要配置三样东西

以下内容都不在仓库里，也不应该在——它们是密钥与用户数据。

**1. 登录账号密码**

首次启动时，`dsh-webui-auth` 会生成一个一次性的 setup token 并打印到 Harness 启动日志。用它在登录页设置自己的账号密码。

日志位置（Linux）：`~/.config/dsh-desktop-dev/logs/harness.log`

密码强度要求：至少 8 位，且同时包含小写字母、大写字母、数字与特殊字符。

**2. DeepSeek API Key**

在客户端的 设置 → 模型 中填入，或通过环境变量 `DEEPSEEK_API_KEY` 提供。可选 `DEEPSEEK_BASE_URL` 覆盖接口地址。

**3. 工作区**

在侧边栏的 工作区 区域添加你要让智能体操作的目录。

配置写入 `~/.config/dsh-desktop-dev/harness/`（会话、凭据、设置均在此），不在仓库内。

### 关于登录状态

会话记录在服务端的 `dsh-webui-auth/sessions.jsonl`，默认有效期 12 小时。

**关闭客户端不等于登出**：会话与进程无关，且 Cookie 不区分端口，重启后仍然有效。要登出请使用 设置 → 身份认证 → 退出登录。

若希望每次启动都要求登录，把 `dsh-webui-auth.json` 的 `ttl` 改为 `0`，会切换为浏览器会话模式（30 分钟滑动过期，Cookie 不落盘）。

## 打包安装包

```sh
cd dsh-desktop
npm run package:dir        # directory only, no installer
npm run package:win        # Windows NSIS
npm run package:mac:arm64  # macOS DMG
```

`scripts/verify-target.mjs` 拒绝为非宿主平台打包。正式的签名与公证安装包由 CI 产出，其 workflow 需要一个仓库变量 `HARNESS_REPOSITORY` 指向 Harness 来源。

> 该 CI 假设 Harness 与桌面客户端是**两个独立仓库**。本仓库把三者合并为一个，因此 `.github/workflows/release.yml` 的双检出逻辑需要相应调整后才能使用。

## 常见问题

**界面改了没生效** — 只跑了 `build:web`。界面插件从 `packages/*/lib/` 加载，需要完整的 `pnpm run build`。

**`npm ci` 成功但客户端起不来** — Harness 未构建。`file:` 符号链接指向了空目录，运行 `node dsh-desktop/scripts/verify-harness-checkout.mjs` 可确认。

**Linux 下报 `electron does not provide an export named 'BrowserWindow'`** — 环境里设置了 `ELECTRON_RUN_AS_NODE=1`，它会让 Electron 以纯 Node 身份启动。用 `env -u ELECTRON_RUN_AS_NODE npm run dev` 启动。

## 开发

```sh
pnpm run test           # unit tests
pnpm run typecheck
pnpm run lint
pnpm run doc-sync       # documentation gates
```

约定与架构说明见 [AGENTS.md](AGENTS.md) 与 [docs/architecture.md](docs/architecture.md)。
