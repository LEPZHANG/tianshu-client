# Agent Note: Composer drop inserts workspace-relative file paths on desktop

Status: implemented

English | [中文](2026-09-08-composer-drop-file-path.zh.md)

## Problem

The chat composer had no useful behavior for dragging OS files onto it. Every drop went to image intake, and on profiles that ship without images the drop did nothing visible — users read that as "drag-and-drop is missing". What a user dragging a project file into a prompt wants is the file's path as text, expressed relative to the session workspace so it is short and portable.

## Decision

Dropping OS files onto the composer inserts their workspace-relative paths as plain text, on desktop only; a plain browser keeps the prior image-drop behavior.

- **`packages/client/runtime` — `workspaceRelativePath(cwd, path)`** (new, beside `resolveWorkspacePath`): the inverse of path resolution. Returns `'.'` when `path` is the root, the relative spelling when beneath it, and `null` when `cwd` is unknown/empty or `path` lies outside. Separators normalize (`\\`→`/`) and matching is boundary-anchored on `cwd/`, so a sibling sharing the prefix (`/root/backend2` under `/root/backend`) is correctly outside. Exported from `runtime/src/client/index.ts`.
- **`dsh-desktop` preload — `dshDesktopFilePath` bridge** (separate repository): a frozen `{ forFile }` exposed via `contextBridge`, backed by `webUtils.getPathForFile`. This is the only way the renderer learns a dropped file's absolute path — new Electron removed `File.path`, and `webUtils` must run in the preload.
- **`ui-conversation` — `input/nativeFilePath.ts`** (new): `nativeFilePathResolver()` localizes the `window.dshDesktopFilePath` read (the `ui-directory-picker-native` `resolvePick` posture), returning `undefined` in a plain browser so the composer keeps Electron specifics out of its render path.
- **`ui-conversation` — composer inject face**: `ComposerBarInjected` gains `resolveDropPaths: ((files) => DropPathResolution) | undefined` (`DropPathResolution = { inside: readonly string[]; outside: number }`). In `apply.ts` it is `undefined` without a session or a native bridge; with both, it reads the session cwd (`sessions.list.getSnapshot().byId[sessionId]?.cwd`) and classifies each dropped file through `workspaceRelativePath`.
- **`InputBar.tsx` drop handling**: when `resolveDropPaths` is present (path mode), a drop inserts the space-joined inside-paths at the caret through the existing paste path (`keyboard.pasteBegin` + `restoreCaret` + `keyboard.track`, one undo step), and any outside files raise one count-summarized auto-dismissing `Toast`. Absent the bridge, the drop falls back to the unchanged image-intake path. The drop overlay shows a path-mode label (`dropOverlayPathLabels`).

Environment is gated by bridge presence, not a config flag: `resolveDropPaths === undefined` is the single signal separating desktop from browser, so no deployment tunable is introduced and the browser image-drop path is untouched. Out-of-workspace files collapse to one count-summarized toast because the composer's `Toast` primitive is a singleton and N stacked toasts would be illegible. Path insertion routes through the paste mechanism because a path is just text, and that path already owns caret handling and a single undo step.

## Alternatives considered

**Hide the drop entry point or leave it on image intake everywhere.** Smallest diff, no new bridge. Rejected: the product decision is that a dropped path is the useful thing in a prompt, and leaving desktop on image intake keeps the "drop does nothing" complaint on image-less profiles.

**A config flag to choose path-vs-image on drop.** Rejected as an unowned tunable: the choice is fully determined by whether a native path bridge exists, so bridge presence is the honest signal and adds no deployment surface.

**One toast per out-of-workspace file.** Truer to per-file feedback. Rejected: the `Toast` primitive is a singleton anchored to the composer card, so per-file toasts would overwrite or stack illegibly; a single count is the readable summary.

**Wrap the inserted path as an `@`-mention chip.** Rejected: the request is for the relative path as plain text, and chips carry reference semantics the user did not ask for. Paste-as-path and folder recursion are likewise out of scope.

## Consequences

Desktop users get path insertion with correct multi-file (space-separated) and out-of-workspace handling, at no cost to the browser image-drop path or to image attachment (still `+` and paste on both surfaces). The change is pure client UI plus one preload bridge: no wire/RPC change, and inserted text is an ordinary draft, so there is no model, token, or KV-cache effect. The `dsh-desktop` preload bridge lives in a separate repository with no Electron test lane here, so it is verified by manual smoke (build + full client restart).

## Testing

- `runtime/tests/workspace-path.client.spec.ts`: both directions — nested hit, root-equals-`.`, sibling-prefix non-match, outside → null, unknown/empty cwd → null, Windows separators.
- `ui-conversation/tests/native-file-path.client.spec.ts`: resolver absent in a browser, rejected when `forFile` is not a function, and wraps a published `forFile`.
- `ui-conversation/tests/apply-inject.client.spec.tsx`: `resolveDropPaths` is `undefined` without bridge/session; with the bridge it classifies inside/root/outside against the session cwd.
- `ui-conversation/tests/input-bar.client.spec.tsx`: path-mode drop inserts the relative path, multiple files join space-separated, an outside file toasts and inserts nothing, and the overlay shows the path-mode title. The full-face benches (`input-bar`, `input-matrix`, `input-scenarios`, `skeleton`) carry the new required key.

Pure client drag-drop never reaches an ACP/headless model transcript, so acceptance rides the real composition component test (`input-bar.client.spec.tsx`), matching the tianshu-suite handling; no keyless transcript snapshot applies.
