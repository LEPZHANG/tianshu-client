# Agent Note: a PDF becomes an editable Word document through Word itself

Status: implemented

English | [中文](2026-09-28-pdf-reflow-through-word.zh.md)

This note follows [a PDF that keeps its pages](2026-09-24-pdf-writer-import-and-output-collisions.md) and [Windows Office conversion](2026-09-24-windows-office-conversion.md). It adds Microsoft Word as a `pdf` source on machines that have it; LibreOffice's Writer import stays the route everywhere else.

## Problem

A user converted a nine-page Chromium-printed PDF to Word twice and judged both results poor.

**The first attempt used the Writer import and came out as frames.** `convert_document` chose `writer_pdf_import`, as the earlier note decided. The `.docx` had no `<w:tbl>`, no heading styles, and 1,124 text-box contents; re-rendered on this machine, its tables came out as empty grid lines. Worse, 1,256 of its 11,222 hanzi were Kangxi radical code points — `⽅` U+2F45 for `方`, `⼀` U+2F00 for `一` — so searching for 方案选型 found nothing. poppler's `pdftotext` on the same PDF returns zero such code points, so the defect is in LibreOffice's import reading each Type 3 glyph's own mapping, not in the PDF's text.

**The second attempt rebuilt the document from the model's memory.** Asked to "convert it again", the model regenerated the Markdown source from what it remembered of an earlier turn, rendered the diagram with headless Chrome, and ran pandoc. The file was structured, but it was the model's text, not the user's document, and nothing in the result said so.

## Decision

### Word reflows the PDF on a machine that has Word

Word 2013 and later rebuild an opened PDF as a Word document: paragraphs, headings, tables, and images become Word's own objects. `officeRoutes()` now takes the engine, and for `msoffice` in the document family adds `pdf → doc`, `pdf → docx`, and `pdf → rtf` at the provider's rank. They are single steps like LibreOffice's, so Word's higher rank decides. The routes are `lossy` and every result carries `PDF_REFLOWED_BY_WORD`, which says the tables and diagrams need checking. The source opens through the same read-only `Documents.Open` as any other, where `ConfirmConversions = $false` suppresses Word's reflow prompt.

WPS declares no `pdf` source: its PDF import is unverified, and a route failing on every WPS machine would outrank LibreOffice's working one. `pdf → odt` stays with LibreOffice because the Office table excludes ODF altogether.

### The frame caveat names the code-point defect

`PDF_IMPORTED_AS_FRAMES` now says some Chinese characters may come across as look-alike radicals and searching can miss words, so a model relaying it tells the user about the defect they would otherwise find by searching.

### The skill forbids rewriting content from memory

The `format-convert` skill describes both PDF outcomes by their note codes, and adds a rule: never regenerate a file's content from memory or conversation context; when the source is gone, say so and ask for it.

## Testing

`tests/conversions.spec.ts` asserts the three reflow targets, their `lossy` fidelity, and that neither WPS nor any other family gains a `pdf` source. `tests/provider.spec.ts` asserts a `pdf` step returns `PDF_REFLOW_CAVEAT` and that only Word's provider declares the routes. `tests/plugin.spec.ts` asserts the seam picks `msoffice-word` over a LibreOffice `pdf → docx` at LibreOffice's rank, and keeps LibreOffice where only WPS is installed. `tests/real-office.spec.ts` round-trips a PDF Word itself wrote back to `rtf` and checks the marker text and note; it runs only on Windows with Word.

## Alternatives considered

**Build a PDF reflow engine from poppler's text boxes.** It would serve every platform, but reconstructing tables from drawn rules and paragraphs from line positions is a layout-analysis project whose quality on complex pages is uncertain. Word already does it, and this product's users are on Windows with Office.

**Map the radical code points back to hanzi after the LibreOffice import.** It would fix search in the frame import, but the result would still be frames; it can follow separately if machines without Word matter.

## Consequences

The reflow is unverified on hardware. Whether Word turns this particular PDF — Chromium output with Type 3 CJK fonts — into real tables is the largest open question, and belongs on the Windows acceptance list. Word's reflow of a large PDF can take tens of seconds, inside the default tool budget. A machine with only WPS, or none, still gets the frame import with its code-point defect.

## Related

- [A PDF that keeps its pages, and an output name that is already taken](2026-09-24-pdf-writer-import-and-output-collisions.md)
- [Windows Office conversion](2026-09-24-windows-office-conversion.md)
- [The document conversion capability seam](../architecture/2026-09-15-document-conversion-capability-seam.md)
