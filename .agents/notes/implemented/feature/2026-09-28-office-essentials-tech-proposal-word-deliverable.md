# Agent Note: the 技术方案 skill hands over a Word file, not only the body text

Status: implemented

English | [中文](2026-09-28-office-essentials-tech-proposal-word-deliverable.zh.md)

This note extends [the 格式转换 skill](2026-09-15-office-essentials-format-convert-skill.md) — the tool guidance it added is what this skill now calls — and leaves every other decision in the `office-essentials` notes standing.

## Problem

The 技术方案 skill prescribed the five-section structure, the wording rules, and a self-check list, but said nothing about where the document ends up. A model following it answered entirely in the conversation: a Markdown heading, the five sections as lists, and a Mermaid block for the architecture. That is readable in the transcript and useless to the process the document exists for — a 技术方案 is reviewed, circulated, filed, and annotated, and every one of those steps happens in a `.docx`.

The capability was already shipped. `convert_document` reaches the format, and `html → docx` is a route the composition serves through pandoc at `faithful` fidelity. What was missing was the instruction, not the ability: the skill described the content of a deliverable and never named the deliverable.

## Decision

### Two deliverables, one body of content

The skill requires both: a `.docx` file, and the same content as Markdown in the conversation. The user reads the conversation copy before opening anything; the file is what leaves the session.

### The Word file is authored as HTML, then converted

The skill has the model `write` an `.html` file and then call `convert_document { path, to: 'docx' }`. HTML is the authoring format because the seam's vocabulary has no markdown — its thirteen formats stop at `html` among the text-shaped ones, and pandoc reads `docx`, `odt`, `rtf`, and `html` — while `html → docx` is declared `faithful` and is reachable on the shipped desktop, which bundles pandoc.

The comparison table must be a real `<table>` with `<tr>`/`<th>`/`<td>`. This is the one formatting instruction the conversion makes load-bearing: a table drawn with spaces or with Markdown's `|` syntax arrives as a paragraph of text, and nothing downstream can tell it was meant to be a table.

### The architecture section must not depend on Mermaid in Word

A Mermaid block is a code block to every converter in the seam, so it reaches Word as source text. The skill therefore asks for the architecture to be described in words plus a list or a table in the Word copy, and keeps the Mermaid diagram in the conversation copy — where a renderer exists.

### The conversion's own report is repeated to the user

`lossy` must be transcribed as the specific loss, a refused conversion is never claimed as done, and a `renamed_from` outcome means the name actually written goes to the user. The 格式转换 skill already teaches that obligation; this skill repeats it in one line because it is now the skill making the call.

## Testing

The suite's catalogue is asserted by `packages/skill/skill-suites/tests/skill-suites.spec.ts` for its ids and its install/uninstall behavior, not for body text; the body is guidance the model reads, and no snapshot in this repository records it. What the repository can pin is the route the guidance depends on: `packages/convert/document-convert`'s tests cover the `html` routes, and a direct pandoc run over an HTML file with a `<table>` produces a document with exactly one `<w:tbl>`, which is the property the skill's table instruction rests on.

The end-to-end check is a real call in the client: install the suite, ask for a 技术方案, and confirm a `.docx` lands beside the HTML and opens with the table intact. **No keyless snapshot covers that path**, because the skill changes what the model does rather than what a tool emits; the gap is named here rather than papered over by a mock.

## Alternatives considered

**Add markdown to the conversion seam and convert `md → docx`.** The natural authoring format, and worth having: pandoc reads markdown natively. Rejected for this change because it edits the format vocabulary, the `convert_document` schema, the generated tool catalogue, the verification table, and two SDK expected outputs — a product capability that deserves its own proposal, and one the HTML route does not need.

**Let the model call pandoc, or LibreOffice, through the shell.** Rejected: the 格式转换 skill already forbids hand-rolling a conversion, the seam exists precisely so nothing else has to know which converter is present, and a shell is not mounted in every composition.

**Produce only the Word file.** Rejected by the user: the body in the conversation is what people read before deciding to open the attachment.

**Keep the skill as it was and let the user convert.** Rejected by the user: producing the document is the point of the skill, and a review process that starts with a conversion step is one the tool was built to remove.

## Consequences

Every 技术方案 call now produces a file, so the skill depends on `write`, on a host that can reach `docx`, and on the document converters being present. A host with none of them gets the Markdown body and an honest report that the conversion was unreachable — the same degradation `convert_document` already has, now on a path a skill takes by default. The cost of one document grows by one `write` and one `convert_document` call.

The suite summary and the client's local skill catalogue say the skill emits a Word file, so the install UI describes what the call produces.

A suite already installed keeps the older body: the installer rewrites only on its own install action, and [the 专家套件 page](2026-09-01-tianshu-suites-install.md) reports the suite as outdated until the user reinstalls it. A skill installed from a shipped body that later changed cannot be uninstalled, because it no longer matches the bundle.

## Related

- [Adding the 格式转换 skill to the shipped office suite](2026-09-15-office-essentials-format-convert-skill.md)
- [The Tianshu suite install surface](2026-09-01-tianshu-suites-install.md)
- [The document-conversion capability seam](../architecture/2026-09-15-document-conversion-capability-seam.md)
- [Converted-output verification and the pandoc provider](../architecture/2026-09-17-document-conversion-output-verification-and-pandoc.md)
