<h1 align="center">
  <img src="docs/images/readme-logo-black-v020.png" width="64" alt="DSH Desktop logo" valign="middle" />
  DSH Desktop
</h1>

<p align="center">
  A local-first, cross-platform desktop shell for
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-171513.svg" /></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-171513.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-171513.svg" />
</p>

![DSH Desktop overview with portable presets, model providers, and phone control](docs/images/dsh-desktop-hero-v020.png)

<p align="center"><strong>Beyond official DeepSeek models, DSH Desktop supports mainstream third-party model providers—with more DSH-powered desktop experiences coming soon.</strong></p>

DSH Desktop packages the local DeepSeek Harness web experience as a desktop application. It launches a local Harness instance automatically, manages a random loopback port, persists profiles, plugins, and sessions, and opens the full interface as soon as Harness is ready. Project workspaces are added and managed entirely in the Harness interface.

> [!IMPORTANT]
> DSH Desktop is currently an early preview and depends on the rapidly evolving `@deepseek-ai/dsh@0.1.0-rc.7`. macOS releases are code-signed and notarized by Apple; current installers are distributed through the official website.

## Download

Download DSH Desktop for macOS and Windows from the [official website](https://www.dshdesktop.com/#download).

Installed macOS and Windows builds check for updates automatically after startup and every six hours. Updates download in the background and prompt you to restart when they are ready. You can also choose **Check for Updates…** from the application menu.

## Community

<p align="center">
  Scan the QR code below with WeChat to join the DSH Desktop community group.<br />
  <img src="docs/images/wechat-group-20260815.png" width="220" alt="DSH Desktop WeChat group QR code" /><br />
  Prefer Discord? <a href="https://discord.gg/he2gAKCpj">Join the DSH Desktop Discord community</a>.
</p>

## Why this project exists

DeepSeek Harness already provides a complete agent runtime and Web UI. DSH Desktop does not reimplement Harness; it supplies the host capabilities needed for a desktop product:

- Run without manually starting a CLI or managing local ports
- Create an application-owned Harness launch directory automatically at startup
- Add and manage project workspaces through Harness's built-in directory picker
- Manage the Harness child process, readiness checks, logs, and shutdown in one place
- Store profiles, plugins, and sessions outside the application installation directory so upgrades do not remove user data
- Provide packaging entry points for macOS and Windows

## Features

- Opens directly into Harness without an additional landing page
- Starts without an initial directory prompt by creating and reusing an internal launch directory
- Offers retry, log viewing, and exit actions when Harness fails to start
- Provides Harness menu actions for restarting the child process and viewing its log
- Gracefully terminates the Harness child process when the desktop app exits
- Listens only on a random `127.0.0.1` port for each launch
- Removes Node.js privileges from the renderer and enables `contextIsolation`, sandboxing, and navigation restrictions
- Uses the DSH brand logo consistently in the desktop window and Harness sidebar
- Imports and exports complete custom Agent presets as portable [`.dshpreset` packages](docs/preset-packages.md), with conflict checks and a trust warning before installation
- Includes a production DSH app icon in macOS ICNS and Windows ICO formats

## Friends

[dsh-market](https://github.com/dsh-market/dsh-market) — the DeepSeek Harness plugin market: browse and search 900+ community plugins, preview screenshots, and install, update, enable or disable plugins, or switch themes with one click. Most plugins take effect instantly without a restart.

## Quick start

### Requirements

- Node.js 22 or later
- npm, and pnpm 11 for the Harness build
- macOS on Apple Silicon or Intel, or Windows x64

### Local development

This shell has no Harness of its own. `@deepseek-ai/dsh` and
`@deepseek-ai/dsh-web-frontend` resolve through `file:../apps/cli` and
`file:../apps/web`, so the Harness source must be checked out and built as a
**sibling** of this project:

```bash
# 1. The Harness this shell packages, checked out FIRST
git clone <harness-repository> harness
cd harness
pnpm install
pnpm run build          # produces apps/cli/lib and apps/web/dist

# 2. This project, checked out INSIDE it
git clone https://github.com/dataelement/dsh-desktop.git
cd dsh-desktop
npm install
npm run dev
```

A checkout of this project alone will appear to work: npm links those two
paths without checking them and exits 0, so the install and the packaging both
"succeed" and produce an application whose Harness entry point dangles.
`scripts/verify-harness-checkout.mjs` runs at install and at build to refuse
that outcome; CI enforces the same thing before any job starts.

### Quality checks

```bash
npm test
npm run typecheck
npm run build
```

### Packaging

```bash
# Generate unsigned DMG and ZIP artifacts for the current Mac architecture
npm run package:mac

# Run each command on a Mac or CI runner with the matching architecture
npm run package:mac:arm64
npm run package:mac:x64

# Generate NSIS and Portable artifacts on a Windows x64 machine or runner
npm run package:win
```

Harness includes architecture-specific native modules. Dependencies must be reinstalled and built on the matching platform for macOS ARM64, macOS Intel, and Windows x64. The architecture-specific scripts validate the current `platform/arch` before packaging to prevent artifacts that appear successful but are missing native dependencies.

### Release CI setup

The release workflow builds on macOS and Windows runners, and each build job
checks out the Harness as a sibling before packaging. Two settings on **this**
repository control where that Harness comes from
(*Settings → Secrets and variables → Actions*):

| Name | Kind | Required | Meaning |
|---|---|---|---|
| `HARNESS_REPOSITORY` | Variable | Yes | `owner/name` of the Harness checkout carrying this product's branding. |
| `HARNESS_REF` | Variable | No | Branch or tag to build. Defaults to `master`. |
| `HARNESS_TOKEN` | Secret | Only if that repository is private | A token with read access to it. The workflow's default token is scoped to this repository and cannot read another one. |

The `preflight` job fails the run with these instructions when
`HARNESS_REPOSITORY` is unset, rather than letting an empty value fall back to
this repository and package the wrong Harness.

## Runtime architecture

```text
DSH Desktop (Electron Main)
├── Application-owned launch directory
├── Harness child-process lifecycle
├── Random loopback port and readiness checks
├── Native logging and recovery actions
└── Hardened BrowserWindow
     └── http://127.0.0.1:<random>  DeepSeek Harness Web UI

Electron userData
├── launch-root/
├── logs/harness.log
└── harness/
    ├── profiles/
    ├── sessions/
    └── Plugins and user data
```

Harness runs in a separate Electron Node child process. The `--expose-internals` permission required by Cordis HMR is granted only to that child process and never to the web renderer.

## Project structure

```text
src/main/             Electron main process, windows, and Harness lifecycle
src/shared/           Shared runtime types
docs/patches-disabled-for-tianshu/   Retired patches, kept as the record of what each one did
scripts/              Brand-asset installation and target-platform packaging checks
test/                 Settings, runtime, security, and provider coverage tests
build/                Application icon assets
```

## Current validation status

- macOS Apple Silicon: development workflow, real Harness startup, DMG packaging, code signing, Apple notarization, and mounted artifact verified
- macOS Intel: packaging configuration and platform checks provided; runtime verification still requires an Intel Mac or runner
- Windows x64: NSIS/Portable configuration and platform checks provided; runtime verification still requires a Windows runner
- Windows ARM64: not currently supported
- Automatic updates: not yet integrated

## Upstream version and patches

The project builds against the sibling Harness checkout rather than a published version, so `patch-package` no longer applies: those patches rewrote compiled bundles under `node_modules`, and that code is now source. All twelve are kept under [`docs/patches-disabled-for-tianshu/`](docs/patches-disabled-for-tianshu/), whose README records what each one did and where the behavior lives now.

When upgrading DSH:

1. Verify the upstream Settings, Credentials, and Provider Directory contracts.
2. Reapply or rewrite the customized onboarding interface.
3. Regenerate the patch.
4. Run regression checks against a real Harness startup and provider configuration flow.

## Contributing

Issues and pull requests are welcome. Before submitting a change, run at least:

```bash
npm test
npm run typecheck
npm run build
```

Never include real API keys in issues, logs, screenshots, or test data.

## License

This project is open source under the [MIT License](LICENSE).

DeepSeek Harness and its dependencies remain subject to their respective upstream licenses and trademark policies. DSH Desktop is an independent community desktop wrapper.
