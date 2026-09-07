# Agent Note: Tianshu brand layer as an added client plugin

Status: implemented

English | [中文](2026-08-18-tianshu-brand-layer.zh.md)

## Problem

This checkout is a downstream deployment of DeepSeek Harness that ships under a different identity: 「天枢平台」. It must look like that product, not like dsh.

The checkout is also a pristine mirror of upstream with zero local commits, and upstream commits nearly daily — a single sync pulled 111 commits. Rebranding by editing the files that carry dsh's identity (`ui-theme`'s token sheets, `ui-sidebar`'s shell, `ui-primitives`' marks) would put local edits in exactly the files upstream touches most, making every future `git pull` a merge negotiation over presentation.

The requirement is therefore two-sided: the product must be rebranded, and the rebrand must not accumulate conflict surface in upstream files.

## Decision

The brand lives in one added package, `@deepseek-ai/dsh-client-ui-tianshu-brand`, which contributes through documented extension points rather than edits.

**Color is a token override layer, not a stylesheet edit.** The package calls `ctx.theme.overrideTokens` with its own package name as the layer source. Only tokens whose Tianshu value differs from the shipped theme are in the layer: the sidebar column fill (a vertical brand-blue gradient) and the brand text ink. `--dsw-specific-sidebar-fill` is a documented overridable token and accepts any CSS background value, so the gradient rides it directly. The brand blue is 天枢蓝 `#2563EB`, the platform's specified primary. It is close to but not identical to the shipped `--dsw-static-deepseek-500` (`rgb(65,118,230)`), so the value is pinned rather than aliased to that static.

**Column ink is rebound locally, not globally.** A token override layer lands as inline custom properties on `body`, so overriding the neutral ink families there would repaint the entire application, not the blue column. Instead `TianshuSidebar.module.css` rebinds the ink, border, interactive, and nav-item token families on its own `.root`, and everything nested inside inherits the inverted scale without knowing it sits on brand blue. This extends the local-rebind pattern the shipped sidebar already uses for its scrollbar pair.

The scrollbar indirection pair stays bound to the canonical `l2` spelling ui-theme's gate requires; what the column rebinds is the two `--dsw-alias-scrollbar-*-l2` elevation tokens the pair resolves through. A nested list then draws a light thumb on blue without this column special-casing the indirection.

**The sidebar is replaced, not extended.** `sidebar` is a `single` slot, so a registration there displaces the shipped shell rather than adding to it, and takes the child slots that shell declared with it. This package therefore claims `sidebar.workspaces`, `sidebar.settings`, and `sidebar.footer.action` in its own `children` at register, so ui-workspace's browser and ui-settings' foot keep their seats unchanged; the web-app bundle disables the `ui-sidebar` row so exactly one shell is live.

The three *type* declarations are reused from ui-sidebar through a type-only import rather than re-declared. `SlotMap` is a declaration-merged interface spanning the whole compilation, so a second declaration of the same key collides with the shipped one even though only one plugin is ever mounted — `gen-client-catalog` rejects the duplicate because it cannot tell which documentation describes the live slot. Runtime authorization still comes from this package's own `children`, which is what the slot core checks. The resulting dependency doubles as a tripwire: if upstream changes one of the three specs, this package stops compiling instead of drifting silently.

The replacement keeps the shipped column's structural behavior verbatim — the collapse slide-and-crossfade, the frozen expanded width during the fade, the pointer-following scrollbars — and adds the design's navigation block (配置 / 任务管理 / 会话管理) between New Session and the browsing region.

**Product identity strings** live in three upstream files that have no extension point: `apps/web/index.html` (the title, which `DocumentTitle` composes session titles onto), `apps/web/public/manifest.webmanifest`, and the `tsconfig.base.json` path row plus the two bundle registration rows every client package needs. These are one-line additions in append positions.

**The management surfaces ride the same package.** The sidebar's navigation (配置 / 任务管理 / 会话管理) opens pages registered into `shell.overlay`, and the selection they share is a store handle minted once in `apply` and passed to BOTH registrations. Splitting the pages into their own package would have needed a cross-package channel for that selection, which the client rules do not provide — the sanctioned routes are slots and ctx services, and neither carries reactive state between two plugins. One package, one handle, no invented seam.

The overlay layer spans the whole frame, sidebar included, so the page is laid out as a two-track grid whose first track is left empty and click-through. Covering the sidebar would trap the user on the page, because the navigation that closes it lives there. The track width comes from a custom property the sidebar publishes from the width the frame already hands it, so a drag or a collapse moves the page with the column and no geometry is restated.

## Upstream files this touches

| File | Change |
|---|---|
| `apps/web/index.html` | `<title>` |
| `apps/web/public/manifest.webmanifest` | `name` / `short_name` |
| `tsconfig.base.json` | one path-mapping row |
| `tsconfig.client.json` | one project reference |
| `packages/bundle/web-app/package.json` | one dependency |
| `packages/bundle/web-app/cordis.patch.yml` | disable `ui-sidebar`, add `ui-tianshu-brand` |

Everything else is confined to the new package.

## Alternatives considered

**Edit `design-platform.css` and `SidebarRoot.tsx` directly.** The shortest path to the same pixels, and the reason it lost is maintenance rather than correctness: those are among the files upstream revises most, so the brand would collide with incoming work on every sync. The token-override seam exists precisely to keep a deployment's palette out of the theme sheet.

**Override the neutral ink tokens globally instead of rebinding on `.root`.** This would remove the stylesheet's rebind block, but the override layer is document-wide: inverting `--dsw-alias-label-primary` globally makes the conversation column render white-on-white. The column is the only surface that changed background, so the rebind belongs to the column.

**Contribute the navigation into a sidebar child slot and keep the shipped shell.** This would have avoided replacing the column, but no child slot sits between New Session and the browsing region — the shell's own geometry owns that band. Registering into `sidebar.workspaces` would have put navigation inside the region ui-workspace owns and displaced the session browser.

**A `--patch` overlay or a separate profile instead of editing the bundle.** A user patch layer can disable and insert rows without touching `cordis.patch.yml`, which would have left the bundle pristine. It was not taken because the brand is what this checkout *is*, not a per-machine preference: an overlay file would have to ship and be passed on every launch, and `dsh web` would boot unbranded without it.

**Rebranding the shipped marks in `ui-primitives`.** `BrandWordmark` and `FishLogo` ride `currentColor` and would have accepted new path data, but they are upstream files, and editing them would also rebrand the boot gate and every other consumer with no way to opt out. The Tianshu marks live in the new package instead.

## Consequences

Future upstream syncs conflict only where a listed upstream file is also revised upstream, and each of those is a one-line change in an append position. The brand's substance — palette, marks, column, navigation, copy — sits in files upstream does not have.

The cost is that the sidebar is now a fork of the shipped shell rather than a configuration of it: a fix upstream makes to `SidebarRoot.tsx` does not reach `TianshuSidebar.tsx`, and must be ported by hand. This is the price of the design diverging structurally from the shipped column, and it is why the shell's collapse and pointer-scrollbar behavior were kept verbatim rather than reworked — the smaller the drift, the cheaper the port.

Reusing the shipped slot declarations means this package cannot be mounted beside `ui-sidebar`, only instead of it, and it now carries a type-level dependency on a package it replaces. That coupling is deliberate: it is what makes an upstream change to those three specs a compile error here.

The navigation rows open management pages this package owns, registered into `shell.overlay` rather than `conversation` — that slot is a single entry owned by ui-conversation, and taking it would displace the chat surface. Because the overlay spans the whole frame, the page is a two-track grid whose first track is the sidebar's, left empty and click-through so the navigation that closes the page stays reachable; its width comes from a custom property the sidebar publishes, so nothing restates it.

What those pages show is bounded by what the host has, and the boundary is stated on the page rather than faked: the template catalogue is presentation-only because no host template concept exists, 任务管理 lists nothing because the host's scheduling is session-scoped model reminders rather than a cross-session table, 会话管理 lists real sessions but offers no mutations, and 配置 points at Settings instead of duplicating it. All four are recorded in the package's Known Limitations.

Dark theme is supported but not designed: the reference covers the light theme only, so the dark column values are a hue-matched approximation rather than a specified palette.

## Testing

`packages/client/ui-tianshu-brand/tests/` covers the registration (slot occupancy, the re-declared child seats, the injected callbacks, the token layer's source and both-mode values, and teardown removing all of them), the shell's behavior (New Session routing, the collapse settle, the wide flag reaching every seat, navigation selection in both column widths), the navigation store (selection, the toggle-off rule, and that it does not persist across instances), the pages (each destination's content, the honest empty and notice states, real session rows, and closing), and the pointer-scrollbar state machine. The package is at per-file 100%.

ui-theme's repo-wide scrollbar gate covers this package's stylesheet: it rejected the column's first attempt at a bespoke thumb color, which is what produced the elevation-token rebind above.
