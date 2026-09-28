# Agent Note: The hero became a personalized greeting and the sidebar became glass

Status: implemented

English | [中文](2026-08-26-tianshu-hero-greeting-glass-column.zh.md)

## Problem

The product owner closed a multi-round design review on 2026-08-26 with four asks for the assembled product: a lighter sidebar finish (the saturated brand-blue column read heavy; the chosen direction was "lighter, translucent"), a warmer hero greeting in place of the generic 您好 headline with the 内测版 badge, the workspace chip moved below the input card with a floating-shadow pill treatment (the QwenWork posture), and the input card sitting at the exact vertical center of the conversation column instead of riding high.

The hero text is assembled browser output, so every change here is snapshot-visible, and a wall-clock-dependent greeting is nondeterministic by construction — the testing surface had to move with it.

## Decision

**Sidebar S4 finish.** `brand-tokens.ts` now feeds `--dsw-specific-sidebar-fill` translucent stops: ice-blue glass in light theme, translucent navy in dark. `TianshuSidebar.module.css` adds `backdrop-filter: blur(18px)` and flips the local ink rebinds: the light-theme column is a light surface, so the subtree reads deep-navy ink on glass; `body[data-ds-dark-theme]` (ui-theme's canonical dark signal, never the theme id) re-rebinds the same token set to the white family, because the dark column stays translucent navy over dark surfaces. The wordmark's halo/rule pair follows the same split (`#E2ECFC` stroke and navy rule on light glass; white rule and navy halo in dark).

**Hero greeting.** `hero.headline`/`hero.preview` are gone; the headline is now the day-part greeting (5–12 morning, 12–18 afternoon, else evening) with the supporting ask 上午好，cxc / 有什么需要我来帮忙？ on a second muted line. The username comes from a new `GET /dsh-webui-auth/whoami` (added to the local auth plugin): 200 with the session username, `{ok:false}` with no session, `{ok:true, username:null}` when auth is off — never a 404, so a logged-out browser produces no console network noise. ConversationRoot resolves it once per mount through a microtask-wrapped fetch (jsdom-safe, all failures swallowed) and hands it to HeroShell as a prop; hosts without the auth surface — the desktop client, the e2e harness — render the generic greeting. The name join rides a locale key (`'，{name}'` zh, `', {name}'` en) so each language owns its punctuation.

**Workspace row below the card.** The hero workspace row (chip + agentPreset seat) moved after the InputBar in the composer stack, and the chip restyled as an elevated pill (`--dsw-specific-input-major` fill, hairline border, `--dsw-shadow-lv2`), left-flush with the card edge. The preset selector keeps its seat in that row — it stays hero-phase-only, which is its documented contract (a preset is only choosable before a session's history exists).

**Card at true center.** The hero shell renders 72px above the card and the workspace row 32px below it, so the flex-centered stack parks the card 20px below the geometric center; 40px of foot padding on `.composerHero` cancels exactly that (the arithmetic is card-height independent). The glow's anchor moved with the card (bottom 92 → 136). Verified by replicating the implementation CSS in a standalone page and measuring: card center lands on the column center at 0.0px.

## Consequences

The assembled hero output changed, so the keyless goldens moved with it: `normalizeAria` collapses the day-part greeting phrase to `{{greeting}}` (same volatility-collapse family as its clock rules — the greeting is wall-clock state, not a regression surface), and the lifecycle-chrome hero/plan-active goldens reorder (workspace row now trails the card) with the greeting line split into its two text nodes. E2e presence checks anchor on the stable ask line instead of the old headline; the HMR probe edits whichever greeting key the wall clock is showing; the fish mark gained a `data-hero-fish` anchor because text selectors cannot address a clock-dependent line.

The whoami endpoint is the first client-visible surface of the auth plugin: it discloses only the username of the caller's own live session, never the token, and returns success-shaped bodies for every unauthenticated state.

Dark theme is carried, not redesigned: the glass stops are a hue-matched approximation, same stance as the pre-existing dark values.

## Alternatives considered

**Pin the e2e clock instead of normalizing the greeting.** Playwright's clock API could freeze the day part for golden captures. Rejected: a paused clock freezes the app's own timers (tooltips, reconnect backoff), and a resumed one merely narrows the race; the greeting is genuinely wall-clock state and `normalizeAria` already owns exactly this kind of collapse.

**Move the preset selector into the InputBar's tool row.** Would match the approved mockup's card-interior placement. Rejected: the seat is hero-only by contract (preset swaps are refused once a session has history), and inlining it into the bar would either show a dead control in the active phase or fork the slot's rendering.

**A `--dsw-alias-*` ink override through the global token layer for the glass column.** Rejected for the same reason as before: the layer lands on `body`, so a global ink override repaints the whole application, not the column. The local rebind (now theme-split) remains the seam.

## Testing

Package suites pass: ui-conversation (29 files) and ui-tianshu-brand (6 files) green, modified files at per-file 100% (the whoami loader's three outcomes — name, no name, no fetch surface — each have a stubbed test). Repository `typecheck` is clean. The card-centering compensation was measured on a page built from the implementation's own CSS (0.0px residual). The e2e goldens were hand-moved to the new DOM order and should be re-confirmed under `DSH_SNAPSHOT=refresh` before merge.
