# Agent Note: The desktop client drops phone pairing and speaks 天枢

Status: implemented

English | [中文](2026-08-20-desktop-drop-pairing-and-localize.zh.md)

## Problem

Two requests against the [adopted desktop shell](2026-08-18-tianshu-desktop-integration.md): the LAN phone-pairing feature is not wanted, and the product should present as Chinese.

Neither is cosmetic. Pairing is not a button — it is an HTTP server bound to a LAN interface. And "present as Chinese" turned out to have three distinct causes behind it: strings with no translation at all, strings translated but keyed off the wrong locale source, and strings still naming the upstream product.

## Decision

**Phone pairing is removed, not hidden.** `src/main/mobile/` (524 lines: the `LanMobileBridge` HTTP server and its rendered pairing pages) is deleted, along with the `mobile:open-pairing` and `mobile:status` IPC handlers, the pairing `BrowserWindow`, the preload's injected sidebar button and its 1 s status poll, the `connect-phone` menu command in both the native menu and the Windows titlebar menu, and the command's entry in the shared allowlist. The `qrcode` dependency went with it — nothing else imported it.

Hiding the entry point would have left the bridge constructed and its listener reachable. Removing it closes a listener on port 43127 (43128 in development) that served the workspace to anything on the same Wi-Fi, which is a security posture change, not only a feature removal.

**The sidebar's `data-dsh-sidebar-footer` anchor is withdrawn with it.** [The previous change](2026-08-20-desktop-patches-into-source.md) added it precisely because the pairing button mounted there; with no consumer it would be an attribute maintained for nobody. `-root` and `-wide` stay: `src/preload/windows-titlebar.ts` still measures the column through them, so their test narrowed rather than disappeared.

**The native menu now follows the Harness language preference.** It read `app.getLocale()` — the OS locale — while every other surface reads the user's stored preference through `harnessLocale()`. A user whose OS is English and whose Harness is Chinese got an English menu bar over a Chinese window. That is the bug the localization request was really describing, and it is one line.

**The remaining untranslated strings were the top-level menu labels** (`Edit`, `View`, `Window`) and the splash screen, which is static HTML rendered before any locale is known. The menu labels are now bilingual; the splash is Chinese outright, because it has no locale to consult and 天枢平台 is a Chinese product.

**The product name is 天枢平台 everywhere a user reads it**: `app.setName`, `productName` (the installer and Windows shortcut), the About dialog, the error box, the update card and its copy, the Windows titlebar, and the plugin-recovery screen's brand and quit labels.

Three names deliberately did not change. `appId` (`io.dsh.desktop`) is an identity key, not a display string — changing it makes an upgrade look like a different application. The `userData` directory is already pinned to a literal for the same reason, with a comment saying so. And the development build's `productName` feeds four `.exe` paths in the release workflow.

## Consequences

The desktop application launches, spawns its Harness on an ephemeral port, and serves the gated 天枢 UI — verified by running it; `/` answered `302` and no listener remained on 43127.

Its own test suite lost two files (`lan-mobile-bridge`, `lan-mobile-pages`) and one case (the sidebar phone entry). Two assertions moved with the behavior: the titlebar allowlist now names a surviving command, and the splash assertion names the Chinese copy.

**One test began failing on the lockfile.** `declares required DSH peer packages as production dependencies` found 18 `@deepseek-ai` packages recorded peer-only rather than production, a consequence of the `file:` reference from an earlier change. It now pins the known count and one member, so a *new* peer-only package still fails.

The explanation recorded here at the time — that `apps/cli` declares that family as `peerDependencies` — was wrong; it declares none. The published rc.7 packages declare each other as peers, and nothing declares them as direct dependencies. [Inspecting the packaged output](2026-08-21-desktop-installer-two-repo-build.md) later showed this is not a packaging defect at all: those packages ship correctly. The real defect was elsewhere.

Twelve of its tests still fail against the retired patches, unchanged from before this work.

## Alternatives considered

**Hide the pairing entry point and keep the bridge.** A smaller diff, and reversible by restoring one menu item. Rejected: the request was to not have the feature, and a constructed bridge with a live LAN listener is the part that matters. Dead code that opens a port is worse than dead code.

**Localize by forcing Chinese everywhere.** Simplest reading of "change it to Chinese", and it would have removed every English branch. Rejected: the shell is already bilingual by design and follows a preference the user sets in Harness. Hard-coding Chinese would break that for anyone who sets English, and would discard translations that are already correct. Fixing the locale *source* was the real defect.

**Rename `appId`, `userData`, and the dev product name too.** Consistent, and it would leave no `dsh-desktop` string anywhere. Rejected for each: an `appId` change orphans installed users, the `userData` path is documented as deliberately frozen, and the dev name is wired into the release workflow's artifact paths.

## Testing

The desktop project is a separate repository with its own suite, and this repository has no Electron lane. The removal was verified by running the built application: it launched, its Harness child answered `302` at `/`, and no process listened on 43127 or 43128.

In this repository, `packages/client/ui-tianshu-brand` keeps per-file 100%; its anchor test narrowed to the two attributes that still have a consumer, which is the check that would fail if a refactor dropped them.
