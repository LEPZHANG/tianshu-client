# Agent Note: Drop the 图像创作 skill from the shipped office suite

Status: implemented

English | [中文](2026-09-08-remove-image-creation-skill.zh.md)

## Problem

The `office-essentials` suite shipped five skills, one of which — `image-creation` (图像创作) — only expands a vague request into a text-to-image prompt and hands it to an external drawing tool. The harness has no image-generation tool, so the skill has no in-product path to a result: it teaches a `/image-creation` calling convention that ends at a prompt the user must carry elsewhere, which reads as a capability the product does not have.

The earlier [send-to-composer prefill change](../bug-fix/2026-09-08-tianshu-send-to-composer-prefill.md) already dropped `image-creation` from the Tianshu UI's local builtin catalogue, but the server-side installable suite ([`skill-suites/src/catalogue.ts`](../../../../packages/skill/skill-suites/src/catalogue.ts)) still carried it — so an install still wrote its `SKILL.md` to disk and the filesystem provider still surfaced it. The two catalogues disagreed.

## Decision

Remove `image-creation` from `BUILTIN_SUITES` entirely: the `IMAGE_CREATION` body constant and the suite's skill entry are gone. `office-essentials` is now four skills — `data-visualization`, `weekly-report`, `data-analysis`, `tech-proposal` — retitled 办公四件套 with the description list updated to match. Both catalogues (the Tianshu UI local table and the server-side suite) now agree on the same four.

## Alternatives considered

**Keep it, but mark it unsupported or hide it behind a flag.** Rejected: a shipped constant suite has no per-skill visibility toggle, and adding one to suppress a single entry is more surface than the entry is worth. A skill the product cannot fulfill is worse than an absent one.

**Leave the server suite carrying it and only hide it in the UI.** Rejected: install writes each bundled `SKILL.md` to `$DSH_HOME/skills/<name>/` regardless of any UI, and the filesystem provider discovers it on its next scan. The catalogue table is the single source of what a suite contains, so the removal has to happen there, not in a presentation layer.

## Consequences

A fresh `office-essentials` install now writes four `SKILL.md` files. Install state is file presence and uninstall only removes the bundled files the suite still ships, so an `image-creation/SKILL.md` written by an earlier install is now orphaned: uninstall no longer touches it, and the user deletes that folder by hand exactly as they would any hand-added skill. No wire, RPC, or schema surface changes — this is a catalogue-content removal. The suite-name assertion and the edit-preserving uninstall test (which had edited `image-creation`) now use `tech-proposal`; the `skill-suites` README count moves from five skills to four.
