# Agent Note: An untitled session was unreadable and named twice

Status: implemented

English | [中文](2026-08-21-tianshu-untitled-session-row.zh.md)

## Problem

A contrast sweep of the running desktop client over CDP found the 会话管理 page rendering a blank session's label at **1.26:1** against its white row — below the 4.5:1 AA floor by a wide margin, and effectively invisible in a screenshot.

`.rowUntitled` bound `--dsw-alias-label-dimmed`. That token is the *placeholder* ink: correct beside a real label, wrong as the only label a row has. This row has no other text, so the dimming removed the row's entire content rather than de-emphasizing part of it.

The same sweep surfaced a second defect in the same row. The page called the session `未命名会话`; the workspace tree in the sidebar called the same session `新会话`. `ui-workspace`'s `rows/Rows.tsx` already owns the rule — `node.blank ? t('session.new') : node.title` — and this page had invented a parallel one from `title === ''`.

## Decision

`.rowUntitled` takes `--dsw-alias-label-secondary` (5.8:1) and italics. `label-tertiary` was measured first and rejected at 3.71:1 — still short of AA. Italics carry the "no title yet" signal that the color no longer has to, so the distinction survives without relying on contrast the surface cannot supply.

The label follows the workspace tree: `blank === true` names the session `新会话` / `New Session`, matching what the sidebar shows for the same row. The empty-title fallback stays, because an absent title is a different fact from a blank session and both must avoid rendering an empty row.

## Consequences

One session now reads the same on both surfaces. The `page.sessions.untitled` key keeps its name while its value becomes the shared wording; the key describes the row's condition, not the text.

Reading `blank` widens what this page depends on from the session summary, which already carried the field.

## Alternatives considered

**Raise `--dsw-alias-label-dimmed` globally.** Would fix every dimmed-on-white case at once. Rejected: the token is upstream and shared, its placeholder role is correct where it has a label beside it, and changing it repaints surfaces this work has not inspected.

**Keep `dimmed` and add a background tint to the row.** Reaches AA without touching ink. Rejected as more machinery than the defect needs, and it invents a row treatment no other list uses.

**Leave the two names alone.** They are different surfaces, so the drift is arguable. Rejected because they list the same sessions from the same store, and the tree's rule already existed — the second name was an accident, not a decision.

## Testing

A test asserts a `blank: true` session with a stale title renders `New Session` and not the stale title. It was confirmed to fail with the blank rule removed, so it pins the shared naming rather than the fallback.

Contrast was computed from the WCAG relative-luminance formula rather than eyeballed: 1.26 before, 3.71 for the rejected middle option, 5.8 after.

Verified in the running client after a full `pnpm run build`: the blank row computes `rgb(97, 102, 107)` italic, the titled row `rgb(15, 17, 21)` normal.

Package tests pass (37) at per-file 100%. `typecheck` and `lint` are clean.

## The same token misuse on the preset cards

The sweep found the identical 1.26:1 failure on the Agent 预设 cards: `.cardId` in `ui-agent-preset` — the preset id a user types into config — also bound `label-dimmed`.

A survey of every `label-dimmed` use in `packages/client` settles what that token is for: `::placeholder`, `:disabled`, and `border-color`, in all eleven other sites. `.cardId` was the only one styling ordinary readable text with it.

It takes `label-secondary` for the same reason `.rowUntitled` does. `label-tertiary` was tried first — it is what `.badge` and `.intro` use in that very file — but measured 3.71:1 in light mode. Both modes were measured in the running client rather than derived: light `rgb(97,102,107)` on white is 5.8:1; dark `rgb(207,211,214)` on `rgb(44,44,46)` is 9.25:1.

That package's 157 tests pass. This file was not otherwise touched.
