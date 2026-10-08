# Agent Note: carrying the 公文 typefaces inside the documents the tool writes

Status: implemented

English | [中文](2026-09-24-official-document-embedded-fonts.zh.md)

This note reverses one consequence recorded in [the GB/T 9704—2012 tool](2026-09-21-official-document-gb-t-9704.md) — that no format can supply a machine's missing typefaces — and uses the typefaces staged by [the Windows conversion work](2026-09-24-windows-office-conversion.md) for a second purpose. Every other decision in both notes stands.

## Problem

GB/T 9704—2012 fixes five typefaces, three of which no Windows machine ships: 方正小标宋简体, 仿宋_GB2312, 楷体_GB2312. The tool wrote their names into the file and reported, in every result, that a machine lacking them substitutes other faces. For this product's users that is not a caveat but the ordinary case: they open the file in Word or WPS on a machine that has never seen those fonts, and the substitution is silent — the layout is exact to the millimetre and the glyphs are wrong, with every step of the chain reporting success.

Measured on a machine without the three faces installed, the same document converted with and without embedding: `pdffonts` on the control lists only `NotoSansCJKsc-Regular` and `NotoSerifCJKsc-Regular`, one substituted family standing in for all five the standard names.

The previous note called this unreachable. It is not, and the claim was never tested: OpenDocument carries font files as package parts, OOXML carries them as obfuscated `word/fonts/*.odttf` parts, and LibreOffice translates the first into the second.

## Decision

### The typefaces are read from a directory the deployment names

The fonts are commercially licensed and cannot enter a public repository — `dsh-desktop/.gitignore` excludes `build/fonts/` — so the package reads them from disk at apply. `tool-official-document` takes a `fontDirectory` Config field, empty by default; the base bundle feeds it `DSH_OFFICIAL_DOCUMENT_FONTS` through the repository's existing `!!js` convention, and the desktop client's `buildHarnessSpawnOptions()` sets that variable to `bundledFontDirectory()` — the typefaces already inside its own installer, under the bundled LibreOffice's `share/fonts/truetype`. The same files now serve two purposes: the bundled LibreOffice renders with them, and each document carries a copy.

No second copy is staged in the installer. Empty `fontDirectory` writes exactly the bytes the tool wrote before this change, which is correct for a deployment where every reader has the faces installed.

### Whole fonts, not subsets

A subset holds only the glyphs the document already uses. It would cut the `.docx` from about 8.5 MB — the 14.6 MB measured here less the repeated parts [collections and repeated fonts](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md) now removes — to about 1.0 MB, and the first character the recipient typed in Word that fell outside the subset would render in a substituted face — reintroducing the defect, in the one place the user is most likely to see it. The user chose the size over that edge, and the tool never subsets.

### The installer does not touch the system font library

Embedding, not installation: no administrator prompt, nothing left behind by an uninstall, and — the reason that matters most — a document forwarded to a colleague who never installed this client still renders correctly.

### `fsType` decides, and Restricted is refused

A font's OS/2 table states what embedding its licence permits. `readFontEmbedding()` masks the permission bits with `0x000f`: `0x0002` (Restricted) is refused, named in the result note, and the family falls back to being written by name alone. The three 公文 faces carry `0x0008` (Editable) and `0x0000` (Installable), so all three travel. This is a mechanical invariant with a synthetic counter-example in the tests, not a property assumed of the files that happen to be on the build machine.

### The match is on what the font says it is

`loadEmbeddableFonts()` reads each file's `name` table (nameID 1 and 16) and matches the declared family against the five names `metrics.ts` writes into the styles, ignoring file names entirely — `FZXBSJW.TTF` is found because it declares 方正小标宋简体. The previous round verified that agreement by hand; it is now checked on every launch. Directory entries are read in sorted order and the first file wins a family, so one directory always yields the same bytes. The names written into a document are the Chinese ones, which is the name WPS resolves an embedded face by — see [the naming decision](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md).

`.ttf` and `.ttc` are read. A family a collection holds is rebuilt as a standalone face, because a `ttcf` file written into a document is one no reader resolves — [collections and repeated fonts](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md) added that, and SimSun, one of the standard's five faces, ships as a collection. CFF-outline fonts (`OTTO`) are rejected at the sfnt version, alone or inside a collection, because the OOXML embedding path downstream does not carry them reliably.

### What the package holds

`buildOdtPackage(document, fonts)` adds a `Fonts/<family>.ttf` part per carried face, a `settings.xml` setting `EmbedFonts` true — without which the parts are dead weight — and the matching `application/x-font-ttf` manifest entries. `buildStyles(fonts)` points each carried family's `<style:font-face>` at its part through `<svg:font-face-uri>`. Declaring it in `styles.xml` alone is sufficient; `content.xml` carries no font declarations and needed none.

The two namespaces that markup requires, `xlink` and `loext`, are declared **only when a font is carried**. A package with no fonts is byte-identical to what the tool produced before embedding existed, which is asserted directly and is what keeps the recorded ACP transcript valid.

### Failure semantics

A configured directory that cannot be read fails at apply, naming the directory and what to do about it — misconfiguration fails loud rather than silently writing fontless documents that look successful. A directory that simply lacks a family is the ordinary case (黑体 and 宋体 ship with Windows) and degrades: that family is written by name and the result note says which faces travel and which do not, under `OFFICIAL_DOC_FONTS_EMBEDDED`.

## Alternatives considered

**Install the fonts into the system font library from the installer.** Rejected by the user: it needs administrator rights, leaves residue after an uninstall, modifies a machine the product does not own, and still does nothing for a recipient who does not run this client.

**Subset the embedded fonts.** Rejected by the user, as above. The mechanism is available — LibreOffice's own PDF export subsets — and could be revisited if the file size proves unacceptable in the field, at the stated cost.

**Take a font library such as `fontkit`.** Rejected: this reads two fields from two tables of a stable, published format. `src/fonts.ts` is about 130 lines with no dependency, against a parser that would pull in glyph outlines, shaping, and a third-party notices entry to answer "what is this called" and "may I embed it".

**Emit the OOXML embedding directly instead of routing through LibreOffice.** Rejected for the reason the original note gives for not emitting `.docx` at all: it would be a second implementation of the same layout. LibreOffice already translates ODF font parts into `w:embedRegular` with a `w:fontKey`, and the obfuscated parts it writes de-obfuscate byte-for-byte back to the source files.

**Detect the reader's installed fonts and warn precisely.** Still deferred, as [the original note](2026-09-21-official-document-gb-t-9704.md) recorded — but now largely moot: carrying the font is a better answer than a more accurate warning about not carrying it.

**Declare the bold face explicitly in the ODF markup to stop the duplication below.** Tried and failed: LibreOffice writes `w:embedBold` from the same regular file regardless of what `loext:font-weight` declares. The duplication is not suppressible from the ODF side.

## Consequences

**The files are large, and larger than first estimated.** Whole fonts make the `.odt` about 6.9 MB and the `.docx` about 14.6 MB, because LibreOffice writes both `embedRegular` and `embedBold` per family from the same file; [collections and repeated fonts](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md) removes those repeats, which brings the measured one-page 公文 to about 8.5 MB. A directory that also supplies 黑体 and 宋体 — the two the deployment may add — makes the `.odt` about 21 MB and the `.docx` about 23 MB, since those two are larger than the other three together. Beyond that: with `EmbedFonts` on, LibreOffice also embeds **the faces it substituted for anything it could not resolve**. On the Linux build machine that added eight Noto parts and about 3.2 MB; on a Windows machine the substitutes are the real SimHei and SimSun, roughly 9.75 MB and 15.3 MB, so a `.docx` there may approach 40 MB before the repeats are removed and about half that after. Some OA systems cap attachment size below that, and a deployment that hits the cap turns `fontDirectory` off and accepts substitution.

**No snapshot can cover this.** The real typefaces cannot enter the repository, so every test fixture is a synthetic sfnt built by `tests/font-fixtures.ts`, and the recorded ACP transcript exercises the unconfigured path. The embedding is proven by end-to-end measurement instead: against the real fonts, `pdffonts` lists `FZXBSJW--GB1-0`, `FangSong_GB2312`, and `KaiTi_GB2312` as embedded where the control listed only Noto, the `.docx` carries `<w:embedTrueTypeFonts/>`, and each `.odttf` de-obfuscates to bytes identical to its source file.

**WPS is unverified.** Whether WPS honours `w:embedTrueTypeFonts` and the `.odttf` parts could not be tested here and is the single largest open assumption; it belongs on the Windows acceptance list beside opening the file in Word itself and on a third machine that never installed this client.

**Three documents stated the opposite** — the tool's README, the original note's Consequences, and the tool's own `FONT_NOTE` — and all three are corrected. `FONT_NOTE` is now `fontNote(scan)`, which reports what actually travelled; its wording for the unconfigured case is unchanged, so the recorded transcript still matches.
