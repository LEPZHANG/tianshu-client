# Agent Note: The settings panel inherited the sidebar's inverted ink

Status: implemented

English | [中文](2026-08-21-settings-panel-portal.zh.md)

## Problem

Opening 设置 in the desktop client produced an unreadable panel. Text was present and correctly positioned, but invisible against the panel's white surface.

The cause was the [Tianshu sidebar](2026-08-18-tianshu-desktop-integration.md). That column paints a saturated blue, so it rebinds the neutral ink tokens for its own subtree — light text on brand fill, the documented local-rebind pattern. `SettingsRoot` seats its trigger in `sidebar.settings`, at the foot of that column, and rendered the modal panel as a sibling of the trigger. The panel therefore sat inside the recolored subtree and inherited `--dsw-alias-label-primary: rgba(255,255,255,0.95)` onto its own `background: rgb(255,255,255)`.

The sidebar's rebinding is correct. The defect is that a modal rendered in place at all.

## Decision

`SettingsPanel` portals to `document.body`, matching `Modal` and `OnboardingSurface` — the two existing full-viewport overlays in `ui-primitives`, both of which already portal for the stacking-context reason. This panel was the only in-place overlay left.

Portaling is the fix rather than re-binding the tokens back on the overlay, because the inherited value is not knowable from inside the panel. Any embedding column may restyle its subtree; a modal that belongs to the viewport should not resolve its colors against whichever element happens to host its trigger. The token rebind was tried first and rejected: `.root` also sets `color` directly, so restoring the tokens still left the panel inheriting white through the `color` property.

`react-dom` moves into `peerDependencies` alongside `react`, following `ui-trajectory` — the package's React is a peer, so its renderer must be too.

## Alternatives considered

**Re-bind the ink tokens on the overlay.** Tried first, in the live client, and rejected on evidence: `.root` sets `color` directly as well as rebinding the tokens, so restoring `--dsw-alias-*` on the overlay left the panel still inheriting white through `color`. Forcing `color` on the panel too would work, but it makes every overlay carry a defense against an arbitrary ancestor.

**Stop the sidebar from rebinding ink for the settings seat.** Would fix this panel and no other, and it fights the column's own requirement — the trigger genuinely needs light text on brand blue.

**Give the panel an explicit `color` and background pair.** Narrower than a portal and it would render correctly, but it only covers the properties someone thought to pin. Font, border, and scrollbar tokens would keep inheriting from whatever hosts the trigger.

## Consequences

Nothing about the sidebar changes: the 设置 trigger still renders light-on-blue, because the trigger genuinely does sit in that column.

Component tests were unaffected: they query through `screen.*`, which is document-scoped, so portaled content resolves identically. A test asserting through `view.container` would have broken.

`prefers-reduced-motion`, focus management, and the Escape listener are unchanged — the listener was already document-level.

## Testing

A regression test asserts the dialog is not inside the render container. It was confirmed to fail with the portal reverted (`expected true to be false`) and pass with it applied, so it pins the escape rather than the mechanism.

Verified in the running desktop client over CDP rather than by inspection alone: before the fix the nav label computed `rgba(255,255,255,0.95)` on a white panel; after, `rgb(15,17,21)`. All five sections were then swept for light-on-light text. One hit remains in Agent 预设 — a `当前使用` badge whose white text sits on its own dark pill (`rgb(15,17,21)`), which is intended.

Package tests pass (45) at per-file 100%. `typecheck`, `lint`, `knip`, `constraints`, and `verify-package-invariants` are clean. `publint` and `rescope-vendor` fail identically with the change stashed, so both are pre-existing.
