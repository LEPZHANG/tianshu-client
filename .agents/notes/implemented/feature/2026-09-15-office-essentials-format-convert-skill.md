# Agent Note: Add the 格式转换 skill to the shipped office suite

Status: implemented

English | [中文](2026-09-15-office-essentials-format-convert-skill.zh.md)

## Problem

The [document-conversion capability seam](../architecture/2026-09-15-document-conversion-capability-seam.md) gave the harness a real `convert_document` tool, but nothing in the product told a model how to use it well. Two judgments the tool cannot make for itself decide whether a conversion is useful:

- **Which pairs exist.** Within-family conversion and export-to-PDF are complete; cross-family pairs such as `xlsx → pptx` are not, and the tool refuses them. A model that treats a refusal as a transient failure will route around it and produce a file the user cannot open.
- **What `fidelity` obliges.** A `lossy` outcome means the content survived and the layout did not. The tool reports it; only the model can tell the user.

The `office-essentials` suite is where the product already teaches this kind of judgment — it bundles skills for the high-frequency office deliverables. Conversion belongs beside them, not in a separate surface.

## Decision

Add `format-convert` (格式转换) as the fifth skill of `office-essentials`, retitled 办公五件套. The `FORMAT_CONVERT` body states the tool's four arguments, the reachable pairs by family, the refusal rule for cross-family targets, and the obligation to transcribe `lossy` as a concrete loss rather than a caveat.

The skill teaches the tool; it does not gate it. `convert_document` is registered by [`dsh-tool-document-convert`](../../../../packages/convert/tool-document-convert/README.md) in the base bundle and is available whether or not the suite is installed — installing the suite adds guidance, never capability.

Both catalogues move together, as the [image-creation removal](../simplification/2026-09-08-remove-image-creation-skill.md) established: the shipped table in [`skill-suites/src/catalogue.ts`](../../../../packages/skill/skill-suites/src/catalogue.ts) and the Tianshu UI's local `BUILTIN_SKILLS` fallback table, which stands in for the host's session-addressed `skill.list` when no session is current. The skill's UI category is `doc`.

## Alternatives considered

**Put the guidance in the tool's system-prompt section instead.** Rejected: that section is unconditional, so every request in every deployment would carry it. Format-family reachability and the lossy-transcription rule are long enough to cost request prefix on sessions that never convert anything. A skill is loaded on demand, which is what this content is worth.

**Ship it as a standalone suite.** Rejected: a one-skill suite is a card the user installs for a single file, and the suite surface is the product's coarse grouping. Conversion is an office deliverable in the same sense the other four are.

**Encode the reachable pairs as a table in the skill body.** Rejected: the route table lives in the providers and changes when a provider is added or a binary is absent. A copy in a SKILL.md would go stale silently, and the tool already refuses what it cannot do. The skill states the rule by family and defers to the refusal.

## Consequences

A fresh `office-essentials` install writes five `SKILL.md` files, `/format-convert` among them. Install state is file presence and uninstall removes only directories still hashing to the bundled body, so an existing four-skill install gains the fifth file on reinstall and needs no migration.

Model-visible text lives in the installed SKILL.md rather than the request prefix, so no default prompt or KV-cache effect follows from this change; the suite list RPC gains one `SuiteSkillView` row. The catalogue assertions in `skill-suites` and the Tianshu skills-page counts (five rows, three `doc`, two `data`) move with the table.
