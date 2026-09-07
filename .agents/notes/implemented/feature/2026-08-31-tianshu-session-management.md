# 会话管理 becomes a managing surface: collections, unarchive, recycle bin

Date: 2026-08-31
Status: implemented
Scope: feature

## What changed

The 会话管理 page (`ui-tianshu-brand/TianshuPages.tsx`) was a read-only title list; the sidebar's archive verb was a one-way door (no unarchive RPC existed anywhere), and session deletion did not exist from the client contract down to the SQLite backend. This change gives the sessions surface every lifecycle verb the platform can honestly offer, across three layers:

- **Host registry** (`workspace/workspace`): the domain state gains `collections` (ordered named session groups) and `deletedSessionIds` (soft-delete set), both defaulted so pre-existing media parses unchanged — the domain version stays `2` because storage-domain rejects a version mismatch at open and additive defaulted fields do not warrant that. New verbs: `unarchiveSession`, collection CRUD plus membership, `deleteSession`/`restoreSession`. Soft delete drops the archive set and every collection account but keeps the workspace slot, so restore returns the session to its position.
- **Wire** (`host/apiproxy` + `client/runtime`): nine new `workspace.*` RPCs, two new host frames (`host/collections-changed`, `host/deleted-sessions-changed`), and the `workspace.list` snapshot carrying both sets. `WorkspaceListState` grew two required fields.
- **UI** (`ui-tianshu-brand`): the sessions page is now two axes — folders navigate on a left rail (with an 未归类 pseudo-folder), archive state filters on a chip row; entering a folder retires the global chips in favour of an in-folder scope bar whose sub-filters count within the folder. Rows open, rename, archive/unarchive, file into folders, delete-to-bin, and restore.

## Why these decisions

- **Folders as a second, orthogonal axis** rather than reusing workspaces: workspace membership means "which project directory this session works in", and a filing concept like 季度汇报 must not require inventing a directory. Collections are stored registry-globally like the archive set and never participate in the one-owner accounting invariant.
- **Soft delete only**: session persistence has no row-removal seam (`create/readFrom/appendBatch/list/readRaw`), so a purge would be a four-package change (definition + jsonl + sqlite + coordinator). The recycle bin restores; it deliberately offers no purge or empty button rather than exposing a control that would fail.
- **Six state-construction sites carry the new fields forward**: the registry rebuilds global state field-by-field on create/delete/recovery/bootstrap; a new field left out of any of them silently erases the user's folders on an unrelated workspace write. TypeScript's excess-precision made every site refuse to compile until handled, and a regression test pins the preservation.

## Invariants and tests

- Registry: 59 tests (12 new), including preservation across workspace create/delete and legacy-media upgrade for both new fields.
- Wire/client: `apiproxy`, `runtime`, `connection`, `test-support` suites — 1314+ green; client cases pin the full-set echo installs, both frames, and failure-leaves-projection-untouched.
- UI: 45 tests in `ui-tianshu-brand`, covering the two-axis scopes, bucket semantics (已删除 never mixes into 全部), folder-scope retirement of the global chips, menu flows, dialog confirms, and the open-closes-page behaviour.

## Deferred

- Hard delete (`sessionPersistence.remove` seam + backends) — the recycle bin's purge/empty action waits on it.
- The redundant `listCollections`/`listDeletedSessions` client verbs (the same sets ride the list snapshot); removing them is a follow-up cleanup across the fakes.
- Search, sort, and batch selection on the sessions page; `sessions.search` already exists on the wire.
