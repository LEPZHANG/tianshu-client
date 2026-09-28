# Agent Note: Write 公文 to GB/T 9704—2012 as the conversion seam's second consumer

Status: implemented

English | [中文](2026-09-21-official-document-gb-t-9704.zh.md)

## Problem

The product could already teach a model to write 公文 prose — 文种, 标题三要素, 层次序数, 公文语体 — but a 公文 is only a 公文 if the page is right. GB/T 9704—2012《党政机关公文格式》 fixes A4, a 156 × 225 mm 版心 at 37 mm 天头 and 28 mm 订口, 22 lines of 28 characters, 三号仿宋 body text on 二号小标宋 titles, a red rule 4 mm under the 发文字号, and 版记 rules of 0.35 mm and 0.25 mm. No prompt makes a file be any of that. A model asked for a 通知 produces prose in the right register and a document that fails inspection on measurement.

So the office suite needed a tool, not a sixth prompt. The open question was where a tool that *writes* a format belongs, given the harness already has a seam whose whole subject is document formats.

## Decision

Add `packages/convert/tool-official-document`, registering the model-facing `write_official_document` tool, and make it the **second consumer** of `ctx.documentConvert` rather than a new seam. The split matches what each side can actually decide: the model picks the 文种, writes the 标题 as 发文机关+事由+文种, names the 主送机关, and divides the 正文; the tool sets the page and refuses a document the standard forbids, naming every violated clause at once so one retry can fix all of them.

**No fourteenth `DocumentFormat`.** `DocumentFormat` is a closed union of thirteen ids and `odt` is already one of them. The tool assembles an OpenDocument text file itself with `fflate` (`mimetype` first and STORED, fixed 1980-01-01 mtime, so the bytes are identical on every machine), and reaches every other format over edges LibreOffice already declares — `odt → docx`, `odt → pdf`. Adding `fodt` would have widened a closed union to name a file the seam would then have to route from, buying nothing the existing `odt` edge does not already give. This is the arrangement the seam was built for: a new producer of one existing format gets every other format for free.

**The sandbox fence became a public export of `dsh-tool-document-convert`.** The seam is explicitly not a containment boundary — its providers hand argv to `ctx.subprocess` and write with the harness process's own authority — so each consuming tool decides confinement itself, before dispatch. Both tools make the identical decision, so `sessionCwd` / `filePolicy` / `assertWritable` / `assertWithinWorkspace` have one home and the two asserts take an operation name. The same reasoning later covered the other facts the two share as convert-family tools that write one file: the tool-call budget check, the presentation meta narrowing, and the `notes` output schema. The cost is one tool package depending on another; the alternative, moving the fence into the seam package, would contradict that package's own README.

**Default output is `.docx`.** This was the user's call over the recommended `.odt`. It makes the default path hard-depend on LibreOffice: a host without `soffice` fails with `OFFICIAL_DOC_FORMAT_UNREACHABLE`, which names `format: "odt"` as the one that needs no converter. Recorded in the README's Known Limitations rather than hidden behind a silent fallback.

## Alternatives considered

**A sixth prompt-only skill.** Rejected outright: it is the thing that does not work. A prompt can say 三号仿宋 and the file still will not be it.

**Generate the `.docx` directly instead of `.odt` first.** Rejected: OOXML would be a second layout implementation of the same standard, and the seam exists precisely so one producer reaches many formats. ODF also keeps separate font properties per script, which a CJK layout needs — `style:font-size-asian` and `style:font-name-asian` beside the `fo:` pair. (Omitting the `-asian` half was a real bug during implementation; it is regression-guarded now.)

**Collect violations one at a time.** Rejected: a validator that throws on the first problem costs one model round trip per broken field. Validation runs to completion before any file is written and reports every clause together.

**Detect the host's fonts with `fc-match`.** Deferred: unreliable across platforms, and the answer would not change what the file contains. The tool names the typefaces the standard names and reports whether a machine lacking them substitutes others.

**A fixture converter for the ACP snapshot,** as `convert-document` needs. Unnecessary: that scenario pins a real LibreOffice PDF, whose bytes carry timestamps. This scenario writes `odt`, which the tool builds deterministically, so the transcript replays byte-identically with no provider mounted.

## Consequences

Two things the standard asks for are genuinely out of reach and say so in the README rather than being approximated:

- **Seals (§ 7.3.5.1, § 7.3.5.3).** A seal is a red stamp image. The tool implements § 7.3.5.2, the unsealed form, and never claims otherwise.
- **Fonts.** The file names the typefaces the standard names, and a machine lacking them substitutes others — every measurement, indent, and rule is as the standard sets it, and the glyphs are not. The claim recorded here, that no format embeds a machine's missing typefaces, was wrong: [embedded typefaces](2026-09-24-official-document-embedded-fonts.md) carries the font files inside the document where the deployment supplies them, and the result note says which travelled.

Chapter 10's three special formats (信函, 命令（令）, 纪要) are unimplemented; the 版记 flows rather than pinning to the page foot.

The layout was split into `odf.ts` (page geometry and styles) and `content.ts` (the elements), a deviation from the approved plan's single `src/odf.ts` — the two have no shared state and the per-file 100 % coverage gate reads better against the split.

The suite becomes 办公六件套 (`id` stays `office-essentials`, so install state is untouched) and the new skill teaches the tool without gating it: `write_official_document` is registered by the base bundle whether or not the suite is installed. Four dependent fixtures and assertions move with the rename. Model-visible text is the tool's schema, its one prompt section, and the installed SKILL.md; the keyless ACP scenario `official-document` pins a refused call and its corrected retry, because the clause-naming refusal is the behaviour the validation design exists for.
