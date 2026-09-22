# Agent Note: The desktop installer needs both repositories, and CI never knew

Status: implemented

English | [中文](2026-08-21-desktop-installer-two-repo-build.zh.md)

## Problem

Producing a release installer was the goal; the packaging path had never been run.

An [earlier change](2026-08-18-tianshu-desktop-integration.md) pointed `dsh-desktop` at this checkout through `file:../apps/cli` and `file:../apps/web`. That made `npm run dev` work, which is what was verified at the time. Nobody had asked what `electron-builder` does with a dependency that is a symlink pointing outside the project, or what happens when CI checks out `dsh-desktop` on its own.

A [previous note](2026-08-20-desktop-drop-pairing-and-localize.md) recorded a related worry — 18 packages recorded peer-only in the lockfile — and pinned it in a test rather than resolving it. That worry turned out to be the wrong one.

## What the empirical checks showed

**Local packaging works.** `electron-builder --dir` completes, and the result is sound: 198 `@deepseek-ai` packages materialized as real directories (electron-builder resolves the symlinks during its manual traversal), no dangling links anywhere in the output, the built web client carrying the 天枢 title, and the auth plugin present. Launching the packaged binary boots a Harness whose entry point is inside the package — `resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js` — which answers `302` at `/` and `401` at `/api` and `/plugins`, and serves the branded login page. Dependency resolution from inside the packaged tree stays inside it.

So the peer-only lockfile marking is not a packaging defect. Those packages ship.

**CI packaging is silently broken.** `actions/checkout@v4` with no `repository` takes `dsh-desktop` alone. Simulated in an isolated directory, `npm ci` then **exits 0** while leaving `@deepseek-ai/dsh` and `@deepseek-ai/dsh-web-frontend` as dangling symlinks into a `../apps` that does not exist. Nothing reports an error. The build would proceed and produce an installer whose Harness entry point points at nothing.

That is the actual blocker, and its worst property is the silence.

**Installers cannot be produced here regardless.** `scripts/verify-target.mjs` refuses to package for a platform other than the host, and this machine has no wine. A real DMG or NSIS installer must come from a macOS or Windows runner — which means CI is the path, not an optional convenience.

## Decision

**Fail loud at three points.** `scripts/verify-harness-checkout.mjs` checks that both referents exist and are built, distinguishing the two failure modes: a missing checkout breaks at install, while a present-but-unbuilt checkout breaks only later, when packaging copies an empty `dist/`. It runs from `postinstall` and again from `build`. A `preflight` CI job refuses to start a build when `vars.HARNESS_REPOSITORY` is unset, because an empty `repository:` silently defaults to the current repository and would package the wrong Harness.

**Each build job checks out both repositories.** The Harness goes to `harness/`, this project to `harness/dsh-desktop/`, which makes `../apps/cli` resolve. `pnpm install && pnpm run build` runs before `npm ci`, because the install-time guard checks for the built artifacts. Job-level `defaults.run.working-directory` moves the `run` steps; `uses:` steps do not honor it, so the four artifact-upload path lists carry the nested prefix explicitly.

The checkout carries `secrets.HARNESS_TOKEN || github.token`: the default token is scoped to the repository running the workflow, so a private Harness would 404 without one, while a public Harness needs nothing. The Harness source itself is a repository variable rather than a literal. The 天枢 branding lives in a checkout whose remote is still upstream `deepseek-ai/deepseek-harness`, which does not carry it — hard-coding any name here would encode a guess.

**The macOS verification steps now derive the bundle name.** They hard-coded `DSH Desktop.app`, which the rebrand to 天枢平台 invalidated. Because `codesign --verify` runs against a path, a stale name would have made the signing check pass over a bundle that does not exist. They read `build.productName` instead, so the next rename cannot quietly skip verification.

## Consequences

A release now requires a repository variable to be set, and takes longer: every build job builds the Harness first. That cost is the honest shape of the dependency — this shell packages a Harness it does not contain.

Three names stay as they are, and the reasons differ. `appId` is an identity key; changing it orphans installed users. The `userData` path is pinned to a literal with a comment saying so. The development build's `productName` feeds four `.exe` paths in the release workflow.

The desktop project's own README described `git clone dsh-desktop && npm install`, which now silently produces a broken tree; both language versions describe the two-repository layout and say plainly that a lone checkout appears to work. Their `patches/` references were stale in a second way — that directory no longer exists.

Two of its tests changed with the behavior: the macOS job-shape assertion pinned an adjacency that `needs` and `defaults` broke, and a new test pins the two-checkout structure, the build-before-install ordering, and the absence of unprefixed artifact paths. Thirteen failures remain, all previously recorded: twelve assert the contents of retired patches, and one expects a bundled pnpm that resolves to this workspace's.

**This is not verified end to end.** The local `--dir` build and the packaged application were run and checked. The CI workflow was validated as YAML and reasoned through, but no runner has executed it, and a first run will need `HARNESS_REPOSITORY` pointed at a checkout that actually carries the branding.

## Alternatives considered

**Publish the 天枢 packages and depend on versions.** Restores the shell's original design, and CI needs no changes at all. Not chosen: it requires publishing branded packages to a registry, and the request was a working installer, not a publishing pipeline.

**Vendor prebuilt tarballs into the desktop project.** Self-contained, and CI stays a single checkout. Rejected on inspection: `apps/cli` depends on ~58 workspace packages, so a tarball of it alone would resolve the rest from the registry — the published rc.7, not this build. Vendoring the whole tree means vendoring ~200 packages.

**Leave CI alone and build installers by hand on Windows and macOS machines.** No workflow changes, and the local build proves the procedure works. Rejected as the primary answer because release installers are signed and notarized by the pipeline, and a manual path would lose that. The README now documents the manual layout anyway, since it is the same prerequisite.

**Add the 18 peer-only packages as direct dependencies.** Would have made the earlier test pass honestly. Rejected once packaging was actually inspected: those packages ship correctly, and declaring them would assert that the npm-installed copies matter when the running app resolves 39 of 41 through the workspace instead.

## Testing

`electron-builder --dir` was run to completion against a local Electron dist, and the output audited: package count, symlink integrity, branding in the built client, and dependency resolution from inside the packaged tree. The packaged binary was launched; its Harness child served a gated, branded UI.

The CI failure was reproduced rather than assumed: `package.json` and `package-lock.json` were copied into an isolated directory with no sibling, and `npm ci` exited 0 with two dangling symlinks.

`verify-harness-checkout.mjs` was exercised against all three inputs — present and built, missing entirely, present but unbuilt — and its exit code checked directly rather than through a pipe.
