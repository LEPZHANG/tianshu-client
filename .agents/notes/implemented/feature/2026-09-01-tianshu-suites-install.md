# Expert suites land: install writes real skills, the pages go live

Date: 2026-09-01
Status: implemented
Scope: feature

## What changed

The 专家套件 and 技能 pages move from honest placeholders to working surfaces, backed by a new host package.

- **`packages/skill/skill-suites`** (new): the built-in suite catalogue as a shipped constant table (product decision: no remote source) plus its install lifecycle. Installing writes each bundled SKILL.md under the user skill root (`$DSH_HOME/skills/<name>/SKILL.md`); uninstalling removes them. **Install state is file presence, not a stored record** — deleting a folder by hand is an uninstall, and reinstall is idempotent. Uninstall preserves a skill the user edited (byte-identity by SHA-256 of the bundled body).
- **Three RPCs** (`skill.suiteList` / `skill.suiteInstall` / `skill.suiteUninstall`): each mutation returns the re-projected catalogue as its own echo, the same full-snapshot posture the workspace domain uses. New error code `suite-not-found`. Wired through the full 13-point path plus the fakes.
- **专家套件 page**: RPC-driven cards with install state, install/uninstall buttons, busy and failure states. The local BUILTIN_SUITES table retired — the host catalogue is the single source.
- **技能 page**: with a current session, the host's session-addressed `skill.list` is the catalogue (Chinese titles and categories merge from the local table by name); without one — or while loading — the shipped five-skill catalogue stands in. 「发送到对话」 prefills the composer through the scoped insert-text event.

## Why these decisions

- **Install as files, not registry writes**: the filesystem skill provider is the only discovery path, so an installed skill enters through exactly the same door a hand-written one does — no second ingestion route to keep in sync, and no registry state that can drift from disk.
- **Byte-identity edit detection**: uninstall must never destroy user work; a SKILL.md that no longer hashes to the bundled body was edited after install and survives.
- **The skills page keeps the local fallback**: `skill.list` is session-addressed (its one design constraint), and a management surface must not depend on having a conversation open.

## Invariants and tests

- `skill-suites`: 7 tests over real temp directories (install writes bodies the provider would discover; idempotence; edit-preserving uninstall).
- `apiproxy`: 376 green including the suite-lifecycle round trip.
- `ui-tianshu-brand`: 55 green — catalogue rendering with install state, install/uninstall flows adopting the echo, host-row bridging with title merge, sessionless fallback.
- Full touched surface: 896 tests, `pnpm run build` exit 0.

## Deferred

- Live refresh of the composer's `/` menu after install (the provider rescans on its own schedule; the page does not force it).
- Suite install re-populating the skills page's host rows without a reload.
- The redundant `listCollections`/`listDeletedSessions` client verbs (prior deferral).
