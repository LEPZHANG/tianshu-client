# Agent Note: a 公文 heading splits on any mark that closes one, a collection supplies one face, and a converted .docx drops the fonts it repeats

Status: implemented

English | [中文](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.zh.md)

This note widens one rule shipped by [the 公文 level faces](2026-09-28-official-document-level-faces-and-dev-fonts.md) and extends [carrying the 公文 typefaces](2026-09-24-official-document-embedded-fonts.md) in two places. Every other decision in both notes stands.

## Problem

A user working through the desktop client reported defects in the documents `write_official_document` had produced, and each one traced to a different assumption that had been recorded as acceptable.

**A colon-terminated heading took the level face over the whole paragraph.** The model wrote `三、压实工作责任：各地区各部门要确保见效。` — a heading closed by ： with the body run in after it. The split recognised only 。, the sole 。 was the paragraph's last character, and the paragraph was emitted as `BodyLevel1`: heading and body both 黑体. The rule that did this was a deliberate limitation, recorded with the alternative it rejected; the model's ordinary phrasing is what that alternative predicted, and the limitation fired on it.

**黑体 and 宋体 could not travel even when the deployment had them.** Of the standard's five faces the desktop carries three, and the two it leaves out are the ones a Linux or macOS reader substitutes. Supplying 宋体 does not close the gap by itself: SimSun ships as `simsun.ttc`, the reader accepted `.ttf` only and rejected a `ttcf` file at its version tag, so the face was skipped in silence.

**A one-page 公文 converted to 15.1 MB.** `EmbedFonts` makes LibreOffice write every face a document uses into an OOXML export, and a CJK family that has no separate bold face is written into both the `w:embedRegular` and the `w:embedBold` slot. The two parts carry one font; they are not byte-identical, because OOXML obfuscates each part's first 32 bytes with the `w:fontKey` of the slot it sits in, and each slot has its own key. Half the document's bytes were the same three fonts a second time.

**A file that every other reader rendered correctly was wrong in WPS.** With all five faces supplied, the `.docx` was structurally sound: five families declared, five valid single-face parts embedded, every paragraph resolving to the face § 7.3.3 and § 5.2.2 call for, and LibreOffice — reading the document's own embedded parts — rendering it with no substituted family at all. WPS, the desktop's default handler for `.docx`, substituted 黑体, 宋体, 仿宋_GB2312, 楷体_GB2312, and 方正小标宋简体 anyway. The document named them `SimHei`, `SimSun`, `FangSong_GB2312`, `KaiTi_GB2312`, and `FZXiaoBiaoSong-B05S` — their English family names — and WPS resolves a family by the name the document writes. Rewriting the family names in place, leaving every font part untouched, made the same document render correctly; that is what isolated the defect to the naming.

## Decision

### Every mark that can close a heading closes the heading face

`splitRunInHeading()` takes the first `。`, `！`, `？`, `；`, `：`, or line break. The mark stays with the heading and a line break separates instead of being part of either. A paragraph with nothing after that mark is a heading standing alone and keeps `BodyLevel1` or `BodyLevel2`; 第三层 and 第四层 are 仿宋 throughout and are still never split. The comma is deliberately not a boundary: `一、加强组织领导，压实工作责任。` is one heading, not a heading and a sentence.

### A requested family is taken out of a collection as a standalone face

`loadEmbeddableFonts()` reads `.ttf` and `.ttc`. It walks every TrueType face a file holds and matches the family each declares against the five names `metrics.ts` writes. A family the file holds alone is embedded as that file; a family inside a collection is rebuilt as a single-face sfnt — the face's own header and table directory, with each record's offset rewritten for the new layout and the table bytes it names copied — because a `ttcf` file written into a document is one no reader resolves. LibreOffice had already demonstrated that by embedding the collection verbatim: the resulting `word/fonts/*.odttf` began `ttcf`. CFF-outline faces (`OTTO`) are still rejected at the sfnt version, whether they stand alone or sit inside a collection, and each face's own `fsType` decides its own embedding permission.

### The document names its typefaces as the standard does

`FONT` in `metrics.ts` — and so every style `styles.xml` writes and every `<w:rFonts>` the export carries — names the five families 方正小标宋简体, 仿宋_GB2312, 黑体, 楷体_GB2312, and 宋体. These are the standard's own names, and the files answer to them: a CJK font declares the same family once for `zh-CN` and once for `en-US`, so `loadEmbeddableFonts()` matches the declared family against the same list either way and the directory scan does not change. `fontNote` reports the names the document actually writes.

The switch is what makes an embedded face reachable in WPS. It is also what keeps a reader's *substitution* from being masked: a document naming `SimHei` on a machine with no 黑体 renders in whatever WPS picks, silently, while the embedded file sits unread inside the package.

### A family that is not ASCII gets an escaped package entry

`fontEntry()` escapes a character outside `[A-Za-z0-9._-]` as `_u<code point>` instead of replacing it with a bare underscore. ZIP entry names are compared byte-for-byte, and the bare underscore is not injective: 仿宋_GB2312 and 楷体_GB2312 would both become `Fonts/___GB2312.ttf`, and 黑体 and 宋体 both `Fonts/__.ttf`, so one font would overwrite the other inside the package and a face would be embedded under another family's name. Every entry stays ASCII and unique, and a family that is already ASCII keeps the entry it had.

### A converted .docx drops the fonts it repeats

`dedupeEmbeddedFonts()` walks the font table one `<w:font>` at a time, and within each of them keeps the first occurrence of a font and removes the later slots, their relationships, and the parts no surviving relationship still names. Two slots naming one part are the same font outright; otherwise the fonts are compared through their own `w:fontKey`s — the heads de-obfuscated, the rest compared directly — so a repeat stored under a second key is recognised and a genuinely different face is not. Two families carrying the same font are both kept: a reader resolves each family separately, and dropping one would lose that family's embedding. Word synthesizes a bold face from the regular one when no distinct bold file is present, so nothing renders differently.

The pass runs on the `.docx` the conversion wrote, and only there: `odt` is assembled with one part per family and has nothing to repeat.

## Testing

`tests/content.spec.ts` covers each closing mark, the line-break split, and the heading that carries no body. `tests/fonts.spec.ts` covers a collection read for several families, a restricted sibling, a face whose table runs past the end of the file, the rebuild's absolute-offset rewrite, and the four Chinese families whose escaped entries must stay distinct, over synthetic collection fixtures in `tests/font-fixtures.ts`. `tests/docx-fonts.spec.ts` covers the two obfuscation keys, the same-length and different-length non-repeats, a part a surviving relationship still names, an unparseable key, and a package with no font table. `tests/metrics.spec.ts` pins the five family names, `tests/odf.spec.ts` the styles that resolve through them, and `tests/tool.spec.ts` drives the whole call over the real conversion seam.

The user's own call was replayed through the changed code against the real typefaces and the machine's LibreOffice: the `.docx` fell from 15.1 MB to 8.5 MB, `一、压实工作责任：` is a `Level1Heading` run with its body in 仿宋, and the level-2 item that follows splits the same way. With all five faces supplied the `.odt` carries five distinct `Fonts/*.ttf` parts and the export declares `仿宋_GB2312`, `楷体_GB2312`, `黑体`, `方正小标宋简体`, and `宋体`, one `w:embedRegular` each; rendering that `.docx` and the `.odt` through LibreOffice lists exactly those five faces and no substituted one. The WPS result itself is the user's check, not this repository's: the same document that WPS substituted began rendering correctly once its family names were rewritten and nothing else was touched.

## Alternatives considered

**Keep splitting on 。 alone, and tell the model to close headings with it.** The rule was knowable and the README named it, so the defect could be assigned to the model. It is not the model's to fix: the tool exports an element whose typography is its own, and a model that writes `标题：正文` is writing a correct 公文. The unclosed heading is the ordinary form in real documents, and the limitation fired on it.

**Split on the first sentence-ending mark of any kind, as the previous note proposed and rejected.** The previous note's stated risk is that body text containing an early mark is cut too. Restricting the set to marks a heading can end on — `。！？；：`, and no comma — keeps that risk to `一、什么是"一网通办"？正文`, whose correct reading is ambiguous anyway, and removes the failure that was actually reported. The previous note's own record of the alternative is what made reversing it a decision rather than an oversight.

**Take `：` off the boundary set.** It is the mark the reported paragraph used, and a heading that introduces its body with a colon is common; dropping it would leave the defect in place.

**Read only `.ttf` and ask deployments to extract `宋体` themselves.** SimSun ships as a collection on every Windows machine and inside the desktop's own font staging. An operator who must convert fonts by hand before the tool can carry them will not do it, and the tool cannot tell an absent family from an unusable one.

**Keep the English family names and say WPS is unsupported.** The file was correct by every other measure, so the defect could be left with WPS. It is not WPS's to fix: the font files answer to both names, the standard names the faces in Chinese, and a document naming `SimHei` also misleads a reader about which face the layout asked for when substitution happens.

**Write both names into the document.** A paragraph has one `w:rFonts` per script, not a list of candidates, and a `<w:font>` with two names would need two embedded parts of the same file to stay consistent. One name that both the files and the readers answer to removes the question.

**Escape every non-ASCII character to a bare underscore, as the entry helper first did.** It is what nearly shipped, and it is silently destructive: two pairs of the standard's five families collide, and the package keeps whichever font was written last. Escaping to the code point is injective, keeps the entry ASCII, and leaves an ASCII family's entry exactly as it was.

**Parse the collection with a font library such as `fontkit`.** Rejected for the same reason the earlier note rejected it for the `name` table: the format is published and stable, the reader needs the header, one directory, one table, and a rebuild, and the library would pull in glyph outlines, shaping, and a third-party notices entry for none of them. The rebuild is about sixty lines and its correctness is asserted against a file LibreOffice itself wrote.

**Compare the stored parts byte for byte.** That is what the first implementation did, and it silently removed nothing: the two slots hold different bytes. The comparison has to go through the key, and the test fixture asserts that the raw bytes differ before it asserts the repeat is found.

**Drop the bold slot unconditionally rather than comparing fonts.** A family that does carry a distinct bold face would lose it. LibreOffice writes four genuinely different parts for Liberation Serif and Liberation Sans in the same file, and those survive the pass exactly because the comparison keeps them.

## Consequences

A heading whose first mark is a comma and which carries text after it stays wholly in the level face; the README states that. Reading a collection costs one rebuild per carried face, paid once at apply. The `.docx` pass reads and rewrites the converted package — one extra pass over a file the conversion had just written — and reports the size the file actually has. 宋体 and 黑体 still have to be supplied by the deployment; this note removes the code obstacles to carrying them, not the licence ones, and the result note continues to name the faces that travel and the faces that do not.

The family names are now the only ones the tool writes, so a reader that resolves fonts by the English name alone would substitute. Word was not available on the reporting machine to check that direction; every file involved answers to both names, and the Windows acceptance list carries the check. The escaped entry names change what an ODT package holds for a non-ASCII family — `Fonts/_u4EFF_u5B8B_GB2312.ttf` rather than a name carrying the characters — which matters only to someone inspecting the package.

## Related

- [公文 level headings keep their face to the heading](2026-09-28-official-document-level-faces-and-dev-fonts.md)
- [Carrying the 公文 typefaces inside the documents the tool writes](2026-09-24-official-document-embedded-fonts.md)
- [The GB/T 9704—2012 official-document tool](2026-09-21-official-document-gb-t-9704.md)
