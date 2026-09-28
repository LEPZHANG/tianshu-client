# Agent Note: expert suites land — install writes real skills, the pages go live

Status: implemented

English | [中文](2026-09-01-tianshu-suites-install.zh.md)

## Problem

The 专家套件 and 技能 pages were honest placeholders: a local `BUILTIN_SUITES` table rendered cards the host knew nothing about, install did nothing, and the skills page listed a hardcoded five. Nothing connected either page to the filesystem skill provider that actually decides which skills a session has.

## Decision

Both pages are working surfaces backed by a new host package.

- **`packages/skill/skill-suites`** (new): the built-in suite catalogue is a shipped constant table — a product decision, with no remote source — plus its install lifecycle. Installing writes each bundled SKILL.md under the user skill root (`$DSH_HOME/skills/<name>/SKILL.md`); uninstalling removes them. **Install state is file presence, not a stored record** — deleting a folder by hand is an uninstall, and reinstall is idempotent. Uninstall preserves a skill the user edited, judged by SHA-256 byte-identity against the bundled body. `list()` projects `current` alongside `installed`: false once a skill's installed body no longer hashes to the one this package ships, which is the state the page turns into a reinstall.
- **Three RPCs** (`skill.suiteList` / `skill.suiteInstall` / `skill.suiteUninstall`): each mutation returns the re-projected catalogue as its own echo, the same full-snapshot posture the workspace domain uses. Error code `suite-not-found` is new. Wired through the full 13-point path plus the fakes.
- **专家套件 page**: RPC-driven cards with install state, install/uninstall buttons, a reinstall button whenever an installed suite's shipped body has moved on, and busy and failure states. Each card lists the suite's skills — display title, `/name` command, and a one-line summary per skill — so the card reads as a capability manifest rather than a bare count. The local BUILTIN_SUITES table is retired; the host catalogue is the single source.
- **技能 page**: with a current session, the host's session-addressed `skill.list` is the catalogue (Chinese titles and categories merge from the local table by name); without one — or while loading — the shipped five-skill catalogue stands in. 「发送到对话」 prefills the composer through the scoped insert-text event.

## Alternatives considered

**Install by writing a registry instead of files.** Rejected: the filesystem skill provider is the only discovery path, so an installed skill enters through exactly the same door a hand-written one does — no second ingestion route to keep in sync, and no registry state that can drift from disk.

**Uninstall by removing everything the suite installed.** Rejected: uninstall must never destroy user work, so a SKILL.md that no longer hashes to the bundled body was edited after install and survives.

**Leave the page with install and uninstall alone.** Rejected: the two actions stop covering the states once a shipped body changes. The installed file no longer matches the bundle, so uninstall preserves it as if the user had written it, and install is offered only for a suite that is absent — the suite would sit on an old body with no action that moves it. `current` is what separates that state from a plain install, and the reinstall is the action that resolves it.

**Drop the skills page's local fallback and read only `skill.list`.** Rejected: `skill.list` is session-addressed — its one design constraint — and a management surface must not depend on having a conversation open.

**Fetch the suite catalogue from a remote source.** Rejected as a product decision: the catalogue ships as a constant table, so the pages work on a machine with no network and a suite's contents are pinned to the build the user installed.

## Consequences

Install state being file presence means the pages tell the truth about a hand-edited skill root, and it also means there is no record of *which suite* wrote a given folder: a skill installed by two suites is one file, and uninstalling either leaves it if the other still bundles it byte-identically.

The catalogue is pinned to the release. Adding or revising a suite is a shipped-code change, not a content update, which is the cost of the no-remote-source decision.

A shipped body that changes under an existing install leaves files no uninstall will remove, because they no longer match the bundle. The page reports the suite as outdated and offers 重新装配, which rewrites every skill of the suite; an edit the user made is indistinguishable from a superseded body here, so that action overwrites it too, and the page's install note says so.

## Testing

- `skill-suites`: 7 tests over real temp directories (install writes bodies the provider would discover; idempotence; edit-preserving uninstall).
- `skill-suites` and `ui-tianshu-brand` also cover the outdated projection and the action that resolves it: a suite whose installed body differs (and one whose SKILL.md is gone) reports installed but not current, and a reinstall returns it to current.
- `apiproxy`: 376 green including the suite-lifecycle round trip.
- `ui-tianshu-brand`: 55 green — catalogue rendering with install state, install/uninstall flows adopting the echo, host-row bridging with title merge, sessionless fallback.
- Full touched surface: 896 tests, `pnpm run build` exit 0.

## Deferred

- Live refresh of the composer's `/` menu after install (the provider rescans on its own schedule; the page does not force it).
- Suite install re-populating the skills page's host rows without a reload.
- The redundant `listCollections`/`listDeletedSessions` client verbs (prior deferral).
