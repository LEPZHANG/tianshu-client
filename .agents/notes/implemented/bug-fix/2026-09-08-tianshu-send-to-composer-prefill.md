# Agent Note: Tianshu "send to composer" prefills through an out-of-band input event

Status: implemented

English | [中文](2026-09-08-tianshu-send-to-composer-prefill.zh.md)

## Problem

The Tianshu skill directory's "send to composer" action did nothing once the user had typed anything into the composer. `sendSkillToComposer` dispatched `slash/input-insert-text` with the span `{ start: 0, end: 0, draftRev: 0 }`, on the belief that a `draftRev` of `0` meant "apply unconditionally."

`insertText` is a pick-time editor: it compare-and-swaps the caller's `span.draftRev` against the live draft revision and returns `false` on a mismatch, because the span's offsets are only meaningful against the exact draft the candidate was picked over. `draftRev` starts at `0` and increments on every draft mutation, so the sentinel `0` matched only a pristine, never-edited composer. After any keystroke the insert silently no-opped. The `{ start: 0, end: 0 }` span also targeted the draft head, not the caret.

The button had no pick moment at all — it injects a fixed `/name ` token from a different surface — so it never had a legitimate `draftRev` to present, and no span CAS could serve it.

## Decision

Option A: a dedicated out-of-band prefill path that carries no span, chosen over teaching the brand plugin to read the input machine's live revision (Option B below).

`ui-input-trigger` declares a new scoped bail event `slash/input-prefill-text(request: { text }): true | undefined`, a sibling of the existing insert/reference/consume events. `SessionInput` gains `prefillText(text)`: it reads the live snapshot, refuses while an admission transaction is locked (`adjudicating`/`submitting`), and otherwise appends the text at the current draft end. `InputHub` wires the listener on each session scope beside the other input-mutation listeners, so the session's own shell stamps the live revision — no caller ever names one.

`sendSkillToComposer` resolves the current session's binding and bails `slash/input-prefill-text` with `{ text: `/${name} ` }` on that scope's context, returning whether the event applied. The Tianshu skills page keeps itself open when the send is refused rather than stranding the token.

The `image-creation` (图像创作) entry was removed from the builtin skill catalogue in the same change; the `creative` category and its chip remain for host-listed skills that fall back to it.

## Alternatives considered

**Option B — the brand plugin reads the live `draftRev` and stamps an insert-text span.** Rejected: it leaks the input machine's compare-and-swap revision semantics across a plugin boundary into an unrelated brand surface, and the span offsets would be ceremony for an injection that has no pick moment and no caret to edit around.

**Reuse `slash/input-insert-text` with a sentinel `draftRev`.** Rejected: no sentinel can bypass the CAS without weakening the guard that legitimate pick-time inserts depend on. The two operations differ in kind — one edits a picked span, one appends out of band — so they are two events.

**Insert at the caret rather than the draft end.** Rejected: the action fires from a separate management surface with no caret context to read. Appending at the end is the only well-defined target for an out-of-band injection.

## Consequences

The prefill always appends at the draft end, and it refuses while a submit or adjudication transaction holds the composer — the page stays open in that case rather than dropping the token. The path is a pure client-side draft mutation: the inserted `/name ` is an ordinary draft the user still edits and sends, with no model request, token, or KV-cache effect until they submit. The new event completes the input capability seam's existing Provider/Consumer roles; it adds no host or wire surface.

## Verification

`prefillText` has facade unit tests (appends over a non-pristine draft, applies on a pristine one, refuses under a locked admission phase). The `InputHub` listener has scoped-bail tests dispatched through a real session scope. `sendSkillToComposer`'s real injected face has apply-level tests: it bails the event on the resolved binding, reports the applied result, refuses without a current session or resolvable binding, and reports a refused bail as not sent. The Tianshu pages catalogue test now asserts four builtin skills with `Creative0`.
