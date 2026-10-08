# Agent Note: 公文 level headings keep their face to the heading, and a development run carries the typefaces

Status: implemented

English | [中文](2026-09-28-official-document-level-faces-and-dev-fonts.zh.md)

This note follows [carrying the 公文 typefaces](2026-09-24-official-document-embedded-fonts.md) and [the GB/T 9704—2012 tool](2026-09-21-official-document-gb-t-9704.md). It changes how a 第一层 or 第二层 paragraph is set and where the desktop client finds the typefaces; every decision in both notes stands.

## Problem

A user produced a 公文 from the desktop client and reported that its format was inconsistent and some fonts were plainly wrong. The session log and the file itself showed two independent causes.

**No typeface travelled.** The result carried `OFFICIAL_DOC_FONTS_REQUIRED`, not `OFFICIAL_DOC_FONTS_EMBEDDED`. The client was a development run: `build/fonts` held all three faces, but `build/tools` had never been fetched, and the client derived `DSH_OFFICIAL_DOCUMENT_FONTS` only from `<tools>/libreoffice/share/fonts/truetype`. The variable was left unset, `fontDirectory` stayed empty, and `pdffonts` on the rendered file listed nothing but `NotoSerifCJKsc-Regular` and `NotoSansCJKsc-Regular`: 仿宋 came out as a serif and 黑体 as a sans, with the same body text switching between the two.

**Whole paragraphs took the level face.** The model wrote each 第二层 item as `（一）依赖专家知识，使用门槛较高。传统算法以细节点比对为主，……` — a heading followed by several sentences of body text in the same paragraph. The tool gave the paragraph the `BodyLevel2` style, so every sentence of it was 楷体 while the plain paragraphs around it were 仿宋. Twenty-three of the document's thirty-nine paragraphs were set this way, which is the inconsistency the user saw even where the faces were right.

## Decision

### Fall back to the desktop's own font directory

`officialDocumentFontDirectory(toolsRoot, fontsDirectory)` returns the toolkit's font directory when it exists and otherwise `fontsDirectory`, which the client sets to `desktopResourcePath('fonts')` — `build/fonts` in a development run. The runtime log now names the directory it embeds from, or says it found none, so the next silent degradation shows up in `harness.log` rather than in a user's document. A packaged build does not ship `resources/fonts`; there the toolkit copy is the only source, as before, and packaging still refuses a toolkit without the faces.

### Only the heading takes the level face

§ 7.3.3 sets the 层次序数 in 黑体 or 楷体; the sentences after a heading are 正文, and § 5.2.2 sets 正文 in 仿宋. A 第一层 or 第二层 paragraph is split at its first `。`, `！`, `？`, `；`, `：`, or line break — [the widened split](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md) replaced the 。-only rule this note shipped, which the alternative below had proposed and this note rejected: when body text follows, it is emitted as a `Body` paragraph whose heading alone is a `Level1Heading` (黑体) or `Level2Heading` (楷体) run. A paragraph with nothing after its first mark is a heading standing alone and keeps `BodyLevel1` or `BodyLevel2`. The 第三层 and 第四层 are 仿宋 throughout and are not split.

## Testing

`tests/content.spec.ts` asserts the split for both levels, the unsplit standalone heading, and a 第三层 paragraph left whole; `tests/odf.spec.ts` asserts the two run styles' Asian faces. `dsh-desktop/test/convert-tools.test.ts` covers the fallback, the toolkit copy taking precedence, and the variable staying unset when neither directory exists. The user's original call was replayed through the changed code against the real fonts: `pdffonts` lists `FZXBSJW--GB1-0`, `FangSong_GB2312`, and `KaiTi_GB2312`, and each 第二层 item renders with only its heading in 楷体.

## Alternatives considered

**Tell the model to split headings from body text.** The skill could ask for it, but the tool would still set a mixed paragraph wrongly whenever a model ignored the instruction; the typography belongs to the tool, as every other § 7 rule does.

**Split on the first sentence-ending mark of any kind.** A heading ending in ？ or ！ would then split too, but so would body text that happens to contain one early. 。 is what a 层次 heading ends on in practice, and the README states the limit. This alternative shipped on 2026-09-28, with the boundary set restricted to the marks a heading can close on and the comma excluded; [the widened split](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md) records why the risk named here is acceptable.

**Package `build/fonts` into `resources/fonts` as well.** It would make the fallback reachable in a packaged build too, at the cost of shipping 11 MB twice; [the earlier note](2026-09-24-official-document-embedded-fonts.md) rejected that for the same reason.

## Consequences

A 第一层 or 第二层 heading whose first mark is a comma and which carries body text after it stays wholly in the level face; the README names this. [The widened split](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md) closed the rest of that gap. The `BodyLevel1` and `BodyLevel2` styles are still emitted and still used for standalone headings, so documents that already kept headings separate are byte-for-byte unchanged.

## Related

- [Carrying the 公文 typefaces inside the documents the tool writes](2026-09-24-official-document-embedded-fonts.md)
- [The GB/T 9704—2012 official-document tool](2026-09-21-official-document-gb-t-9704.md)
- [Windows Office conversion](2026-09-24-windows-office-conversion.md)
