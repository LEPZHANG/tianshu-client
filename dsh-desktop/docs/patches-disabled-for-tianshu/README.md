# Patches disabled for the 天枢平台 build

`patch-package` rewrites files under `node_modules`. This build resolves
`@deepseek-ai/dsh` and `@deepseek-ai/dsh-web-frontend` to the sibling Harness
checkout (`file:../apps/cli`, `file:../apps/web`), and every other
`@deepseek-ai/*` package now resolves through that checkout's own workspace
tree — so the paths these patches target no longer exist here, and
`npm install` fails while they are active.

They are kept as the record of what each one did, not as anything that runs.
Nothing under `docs/` is scanned by `patch-package`; the `patches/` directory
is gone, because a subdirectory there is still scanned and fails the install.

**Eight of the twelve are now behavior in the Harness source.** Re-applying any
of them would conflict with the source that replaced it.

## Ported into the Harness checkout

| Patch | Where it lives now |
|---|---|
| `…ui-directory-picker-native…` | `packages/client/ui-directory-picker-native/src/client/index.ts` — the client prefers `window.dshDesktopDirectoryPicker` when the embedding shell publishes one, and falls back to the host service otherwise. |
| `…host-apiproxy…` (the `directoryPicker`-optional half only) | `packages/host/apiproxy/src/` — `directoryPicker` left the `static inject` list and the three call sites read it through `ctx.get`, answering `directory-picker-unavailable` when absent. Without this the gateway never activates under this profile, because `dsh-desktop.patch.yml` disables the picker. |
| `…llm-deepseek…`, `…llm-pi-ai…`, `…client-runtime…` | `packages/llm/llm-deepseek/src/adapter.ts`, `packages/llm/llm-pi-ai/src/stream.ts`, `packages/client/runtime/src/client/sessions/failure-display.ts` — `403` classifies as `FORBIDDEN` rather than `AUTH`, quota wording is matched ahead of the status (providers report an exhausted balance as 403 as readily as 429), and the GUI answers `QUOTA` and `FORBIDDEN` with copy naming the real remedy instead of provider text that reads as a broken key. |
| `…ui-deliverables…` | `packages/client/ui-deliverables/src/client/turn-deliverables.ts` — inline code that spells a local path links even when the turn did not produce it; the produced-path tier still takes precedence. |
| `…ui-conversation…` | `packages/client/ui-conversation/src/client/chat/QueryRail.tsx` — the query rail, rebuilt as a CSS-module component with dictionary copy in place of the patch's injected `<style>` tag and `documentElement.lang` checks. |
| `…ui-settings-models…` (the provider-grid half) | `packages/client/ui-settings-models/src/client/ProviderPicker.tsx` — the searchable provider card grid that replaced the add card's native dropdown. |

The **preset import/export half** of the apiproxy patch (`.dshpreset` archives,
`agentPresets.exportArchive`/`importArchive`, the two HTTP routes) was **not**
ported, so `…ui-agent-preset…` stays off with it — that UI calls endpoints this
build does not serve. The **onboarding-dialog half** of the settings-models
patch (a first-run mainstream-provider grid) was not ported either: this
checkout's first-run step is the official-DeepSeek credential dialog, and
replacing it is a product decision rather than a port.

## Superseded by the 天枢 branding

| Patch | Why it is off |
|---|---|
| `…ui-sidebar…` | Rebranded the DSH sidebar lockup. The 天枢 sidebar is its own plugin package (`packages/client/ui-tianshu-brand`), so this targets a component that is no longer mounted. **Its `data-dsh-sidebar-root` / `-wide` / `-footer` attributes were not cosmetic** — `src/preload/index.ts` mounts the phone-pairing button against them, and finds them by attribute, returning silently when absent. The 天枢 sidebar now publishes all three, with a test pinning them. |
| `…ui-layout…` | Widened the collapsed rail to 80px on macOS to clear the traffic lights. Re-apply that padding in the 天枢 sidebar's own stylesheet if the frameless macOS window needs it. |

The update-card surface has no equivalent yet: verify it against the 天枢 sidebar before relying on it.

## Not carried over

`@deepseek-ai+dsh+0.1.0-rc.7.patch` added `dsh-desktop-market-installer` to the
CLI package's own dependencies so the profile could resolve it. Through the
symlink it would edit the Harness checkout's `apps/cli/package.json`, so the
market-installer row is commented out of `build/dsh-desktop.patch.yml` instead;
see the note there.
