# Agent Note: The desktop client is dataelement/dsh-desktop pointed at this checkout

Status: implemented

English | [中文](2026-08-18-tianshu-desktop-integration.zh.md)

## Problem

天枢平台 ships as a desktop application. The product is already built — the browser client this repository serves — so what was missing was a shell to run it as an application.

An earlier attempt wrote one (`apps/desktop`, ~250 lines) because the referenced `dataelement/dsh-desktop` appeared not to exist: the npm name `dsh-desktop` is a README-only placeholder, and a network check for the repository was blocked, which was misread as absence. The repository is real and mature: 4,400 lines, electron-vite, auto-update, LAN mobile pairing, plugin recovery, and a code-signed release pipeline.

It is now cloned at `dsh-desktop/` next to this checkout, and the hand-written shell is deleted. What remains is the integration question, because the two were built to different assumptions.

## The conflict

`dsh-desktop` consumes the **published** `@deepseek-ai/dsh@0.1.0-rc.7` and reshapes it with 12 `patch-package` patches against compiled `lib/client.js` bundles in `node_modules` — including one that rebrands the sidebar.

This repository *is* that source, and carries the 天枢 branding in it. Run unmodified, the shell shows stock DSH, not 天枢平台.

## Decision

Point the shell at this checkout and retire the patches this checkout makes redundant or impossible.

**Two `file:` references replace the published packages.** `@deepseek-ai/dsh` → `file:../apps/cli` and `@deepseek-ai/dsh-web-frontend` → `file:../apps/web`. The shell resolves the Harness as `node_modules/@deepseek-ai/dsh/lib/bin.js`, which the symlink satisfies with no code change. The frontend reference is not optional in a second way: the published `dsh-web-frontend` tarball ships **no `dist/`** (it is built per checkout), so `install-brand-assets.mjs` failed on a missing `index.html` before this change.

**The whole `@deepseek-ai/*` family is pinned to rc.7 through `overrides`.** Upstream published rc.8 after this project pinned rc.7; transitive packages otherwise resolve to rc.8 and demand rc.8 peers, which npm cannot reconcile against the rc.7 pins or this checkout.

**All 12 patches are retired**, two of them ported into this repository's source instead — recorded with reasons in `dsh-desktop/docs/patches-disabled-for-tianshu/README.md`:

- **`ui-directory-picker-native`** → `packages/client/ui-directory-picker-native`. The client now prefers `window.dshDesktopDirectoryPicker` when an embedding shell publishes one and falls back to the host service otherwise, so one build serves both the browser and the desktop.
- **`host-apiproxy`** (the `directoryPicker`-optional half) → `packages/host/apiproxy`. `directoryPicker` left `static inject` and the three call sites read it through `ctx.get`, answering the existing `directory-picker-unavailable` code when absent. **Without this the gateway never activates under the desktop profile**, which disables that picker — verified by the boot failing on `waiting for service: directoryPicker` before the change.

**`install-brand-assets.mjs` is dropped from `postinstall`.** It rewrites `dsh-web-frontend/dist` in place; that path is now this checkout's build output, so it would overwrite the 天枢 favicon with the DSH logo — and the next `pnpm run build` would silently undo it. Branding belongs in this repository's source.

**The market-installer row is commented out** of `build/dsh-desktop.patch.yml`. It is a workspace-local plugin the Harness cannot resolve by bare name, and upstream's fix was a patch to the CLI's own `package.json` — which, through the symlink, would edit this repository.

## Consequences

The desktop application runs this checkout: launching it starts a Harness from `apps/cli`, serves the 天枢 UI, and enforces the `dsh-webui-auth` gate. Verified by running it — the shell spawned its child on an ephemeral port, and that port answered `302` at `/`, `401` at `/api`, and served the 天枢 login page.

Six optional patches were not carried over: error classification (`403` split from `401`, QUOTA/FORBIDDEN copy), the QueryRail turn navigator, the searchable provider grid, clickable inline paths, and preset archive import/export. All are self-contained and worth porting into source later; none is required to run. The preset-archive omission is why the agent-preset UI patch stays off — it calls endpoints this build does not serve.

**Update (2026-08-20):** six of those were ported into source — see [the patch-porting note](2026-08-20-desktop-patches-into-source.md). The preset-archive half and the settings-models onboarding dialog remain unported, for the reasons recorded there.

Ten of the project's own tests now fail, each asserting the literal contents of a disabled patch. They are accurate about what changed and should be rewritten or removed as the corresponding behavior is ported into source.

One further failure is environmental rather than caused by this change: `profile-plugin-command` expects the bundled pnpm 10.34.5, but the shim resolves this repository's pnpm 11.7.0 because the project now sits inside this workspace. The same nesting made vitest inherit this repository's root config, which a local `vitest.config.ts` in the project now pins.

## Alternatives considered

**Keep the hand-written `apps/desktop`.** It was small and already integrated. Rejected once the real project proved to exist: it had never been run, had no tray, notifications, auto-update, plugin recovery, or signing pipeline, and reimplementing those badly is worse than adopting a maintained implementation.

**Leave `dsh-desktop` on published rc.7 and re-express the 天枢 branding as patches.** Consistent with what the project already does. Rejected because those patches rewrite compiled bundles with generated CSS-module hashes that change on every upstream build — the least maintainable place to hold a brand — and it would discard the source packages this repository already has.

**Fork `dsh-desktop` rather than modify the clone in place.** Cleaner ownership for divergent changes. Not taken yet: the changes are a handful of dependency references and disabled patches, and keeping the clone's git remote intact makes upstream fixes easy to pull. Revisit if the shell itself needs real modification.

## Testing

No automated coverage of the shell — it is a separate project with its own suite, and this repository has no Electron lane. The integration was verified by running it: `npm run dev` launched the window, the shell's own `harness.log` recorded the child's endpoint, and that endpoint served the gated 天枢 UI.

The two ported source changes are covered here: `packages/client/ui-directory-picker-native` gained tests for both the bridge and the fallback path, and both changed packages hold per-file 100%.

Note for anyone reproducing this: `ELECTRON_RUN_AS_NODE=1` in the environment makes Electron run as plain Node and fail with `does not provide an export named 'BrowserWindow'`. Unset it. The Electron binary also needs a reachable download mirror (`ELECTRON_MIRROR`).
