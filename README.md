# Tianshu Platform

English | [中文](README.zh.md)

A desktop agent client built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This repository carries three codebases, each independent and each MIT-licensed:

| Directory | Contents | Upstream |
|---|---|---|
| `apps/`, `packages/`, `vendor/` | The Harness itself, with Tianshu branding and UI changes | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| `dsh-desktop/` | Electron desktop client | [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) |
| `dsh-webui-auth/` | Login authentication plugin | [Yuuz12/dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth) |

Each directory keeps its own `LICENSE`.

The Harness project's own README is preserved as [README.harness.md](README.harness.md).

## The directory layout is load-bearing

`dsh-desktop/package.json` depends on the Harness through relative paths:

```json
"@deepseek-ai/dsh":              "file:../apps/cli",
"@deepseek-ai/dsh-web-frontend": "file:../apps/web"
```

`dsh-desktop/` must therefore stay a direct child of the repository root. Moving it breaks both paths.

npm creates `file:` symlinks **without checking that the target exists**, and the install still exits 0 when it does not — the breakage surfaces much later, at packaging time. That is what `dsh-desktop/scripts/verify-harness-checkout.mjs` exists for: it runs from `postinstall` and again from `build`, checking that both directories exist *and* are built, and distinguishing "not checked out" from "checked out but not built".

## Requirements

- **Node** `^22.19.0 || >=24.0.0`
- **pnpm** `11.7.0` (pinned by the repository's `packageManager` field)

`dsh-desktop` needs Node 24 and Electron 43 at runtime; both install as its own npm dependencies, so neither has to be provisioned separately.

## Build

The order matters: the desktop client's install-time guard requires the Harness to be built already.

```sh
# 1. Build the Harness
pnpm install
pnpm run build          # must run in full — see the note below

# 2. Then install the desktop client
cd dsh-desktop
npm ci
```

> `pnpm run build` covers `build:lib` (compiling 220 packages into their own `lib/`) and `build:web` (bundling the web frontend). The client loads its UI plugins from each package's `lib/`, so **running only `build:web` will not pick up changes under `packages/`**.

Build outputs (`lib/`, `apps/web/dist/`, `dsh-desktop/out/`) are not versioned and must be produced locally.

## Run

```sh
cd dsh-desktop
npm run dev
```

### First run needs three things configured

None of the following lives in the repository, and none of it should — these are secrets and user data.

**1. Login credentials**

On first start, `dsh-webui-auth` generates a one-time setup token and prints it to the Harness startup log. Use it on the login page to set your own username and password.

Log location on Linux: `~/.config/dsh-desktop-dev/logs/harness.log`

Password rules: at least 8 characters, containing a lowercase letter, an uppercase letter, a digit, and a special character.

**2. A DeepSeek API key**

Enter it under Settings → Models in the client, or supply `DEEPSEEK_API_KEY` in the environment. `DEEPSEEK_BASE_URL` optionally overrides the endpoint.

**3. A workspace**

Add the directory you want the agent to work in, from the Workspaces section of the sidebar.

Configuration is written to `~/.config/dsh-desktop-dev/harness/` — sessions, credentials, and settings all live there, outside the repository.

### About login state

Sessions are recorded server-side in `dsh-webui-auth/sessions.jsonl` and last 12 hours by default.

**Closing the client is not logging out**: the session outlives the process, and cookies are not scoped by port, so it survives a restart on a different port. To log out, use Settings → Authentication → Sign out.

To require a login on every start, set `ttl` to `0` in `dsh-webui-auth.json`. That switches to browser-session mode: a 30-minute sliding expiry with no cookie written to disk.

## Packaging

```sh
cd dsh-desktop
npm run package:dir        # directory only, no installer
npm run package:win        # Windows NSIS
npm run package:mac:arm64  # macOS DMG
```

`scripts/verify-target.mjs` refuses to package for a platform other than the host. Signed and notarized installers come from CI, whose workflow expects a repository variable `HARNESS_REPOSITORY` naming the Harness source.

> That CI assumes the Harness and the desktop client are **two separate repositories**. This repository merges all three into one, so the two-checkout logic in `.github/workflows/release.yml` needs adjusting before it can be used.

## Troubleshooting

**A UI change did not take effect** — only `build:web` was run. UI plugins load from `packages/*/lib/`, which needs the full `pnpm run build`.

**`npm ci` succeeded but the client will not start** — the Harness is not built, so the `file:` symlinks point at empty directories. Run `node dsh-desktop/scripts/verify-harness-checkout.mjs` to confirm.

**Linux: `electron does not provide an export named 'BrowserWindow'`** — `ELECTRON_RUN_AS_NODE=1` is set in the environment, which makes Electron boot as plain Node. Start with `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## Development

```sh
pnpm run test           # unit tests
pnpm run typecheck
pnpm run lint
pnpm run doc-sync       # documentation gates
```

Conventions and architecture are described in [AGENTS.md](AGENTS.md) and [docs/architecture.md](docs/architecture.md).
