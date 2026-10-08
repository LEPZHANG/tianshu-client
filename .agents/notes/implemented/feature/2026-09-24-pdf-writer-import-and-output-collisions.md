# Agent Note: a PDF that keeps its pages, and an output name that is already taken

Status: implemented

English | [中文](2026-09-24-pdf-writer-import-and-output-collisions.zh.md)

## Problem

One transcript, one request — convert a 技术方案 PDF to `.doc` through the 格式转换 skill — and three separate failures.

1. **The tool call came back red.** The user had converted the same file before, so `技术方案.doc` existed and `convert_document` refused with `CONVERT_OUTPUT_EXISTS`. Nothing was broken and nothing was at risk; the user saw an error card.
2. **The `.doc` was 38,400 bytes of text.** The planner's only route out of a PDF into a document format was `pdf → txt → doc`: poppler recovered the characters and every diagram, screenshot, and table in a 技术方案 was gone by the time LibreOffice wrote the target.
3. **The retry ran six and a half minutes.** Having been told the result was poor, the model installed a Python PDF library and started writing its own extractor, because nothing in the skill said that was out of bounds.

The three are independent defects — a policy, a missing route, and an unbounded instruction — but they reached the user as one impression: the converter does not work.

## Decision

### A taken output name is renamed, not refused

`convert_document` takes `if_exists: 'rename' | 'overwrite' | 'refuse'`, defaulting to `rename`. It writes `技术方案-1.doc` beside the existing file, never touches the original, and reports the path it was asked for as `renamed_from`; the rendered text tells the model to give the user the name actually written. `refuse` keeps the old behavior for a caller that wants it, and `overwrite` replaces the file on an explicit request.

The refusal read as a safety prompt but was not one. A safety prompt interrupts an action whose consequence the caller may not have intended; this interrupted an action with no consequence at all, because the tool had already decided not to touch the existing file. And nothing tells a model that a path is taken until it tries: a `CONVERT_OUTPUT_EXISTS` is not a decision point, it is the only probe available, and paying for it with a failed tool call puts a red card in front of a user for a question the tool could have answered itself.

Renaming counts up to 100 alternatives and then refuses with the same code, so a directory full of collisions ends in a sentence rather than an unbounded scan.

### A PDF reaches the document formats through Writer's import

`document-convert-libreoffice` declares `pdf → doc`, `docx`, `odt`, and `rtf`, each with `importFilter: 'writer_pdf_import'`. The pages look like the original and the images come across. All four are `lossy` and carry `PDF_IMPORTED_AS_FRAMES`, which states the cost plainly: every run of text sits in its own positioned frame, so the result has no flowing paragraphs, no real tables, and no headings. `pdf → txt` is unchanged and remains the route for text that can be edited.

The planner needed no change. It ranks fewer steps first, so a declared single step displaced the two-step extraction for those four pairs the moment the rows existed.

**The import filter is load-bearing, and the tests treat it that way.** Left to itself LibreOffice opens a PDF in Draw, and a Draw document reaches the document formats either not at all — `pdf → docx` fails with `Error Area:Io Class:Write Code:16` — or as an ODF *graphics* document carrying a `.odt` name. A row added here without `writer_pdf_import` would be one of those two failures wearing a declared route, so `provider.spec.ts` asserts the filter on all four rows rather than trusting the table to stay right.

### The skill says what to do when the result disappoints

Telling a model the conversion is lossy is not the same as telling it what it may do about that. The 格式转换 skill now bounds the response to three moves: change `to` (ask for `txt` when the text is what matters), change the source (ask the user for the original `.docx`, where structure actually exists), or say plainly that this is the ceiling. It also states that `convert_document` is the only converter — no third-party installs, no hand-written parsers, no second command-line tool "to try again manually" — because LibreOffice, pandoc, and poppler are already behind it and an improvised pipeline is slower, worse, and unreproducible.

## Testing

- `tool.spec.ts` covers the five collision outcomes: rename and its prose, counting past a taken alternative, silence when the requested path was free, `refuse`, and `overwrite`.
- `provider.spec.ts` asserts the import filter and the caveat on all four `pdf` rows. The old assertion that `pdf → odt` was absent is gone — it recorded the Draw-only reality and is now obsolete.
- `real-converters.spec.ts` runs against a real `soffice`: the plan for `pdf → docx` is one LibreOffice step reporting `PDF_IMPORTED_AS_FRAMES`, and a marker written into the source survives the round trip. That second test reads the result back through LibreOffice rather than unzipping it, because the marker lands in a text frame and what matters is that the document renders it, not which package member holds it.
- Verified by hand on a real installation for all four targets: `file(1)` reports the target's actual type (the `odt` is an OpenDocument **Text** document, not graphics), the source's unique token is present, and the images survive — checked in the `.doc` by round-tripping it back to `odt` and finding the `Pictures/` entries.

## Alternatives considered

- **Keep refusing, and teach the model to check first.** There is no check to teach. The model would have to stat the path through a different tool before every conversion, which is more calls, more latency, and still racy.
- **Overwrite by default.** It destroys a file the user never offered, and the destruction is silent — the one failure mode worse than a spurious error card.
- **Extract, then re-insert the images.** Nothing owns the placement. `pdftoimages` recovers the bitmaps but not where they belong, and a text-only `.doc` has no anchors to put them back into.
- **Ship an OCR or layout-analysis provider.** A real answer to "editable text with the original structure", and out of scope here: it is a new dependency, a new model, and a new set of failure modes, against a complaint that a single declared route fixes.

## Consequences

- The `.doc` a user now gets from a PDF looks like the PDF and is not editable prose. That is better for the common request ("give me this as Word") and worse for "let me rewrite this", which is why the skill must offer `txt` and why the caveat is on every one of the four routes.
- The Writer import stores each run twice in `word/document.xml`, as an `mc:AlternateContent` pair of a DrawingML `mc:Choice` and a VML `mc:Fallback`. Naive text extraction over the package therefore sees the document's text twice; a reader renders it once. The caveat deliberately does not claim a visible duplication, because there is none.
- [`tool-official-document`](../../../../packages/convert/tool-official-document/README.md) still takes `overwrite: boolean`. The asymmetry is deliberate and scoped to the decision made here; unifying it belongs to the next change that touches that tool.
- The collision check is still not atomic — existence is tested before the conversion starts — exactly as the overwrite guard it replaces was. Closing that needs an exclusive-create handshake the seam's path-out contract does not express.

## Related

- [The 格式转换 skill](2026-09-15-office-essentials-format-convert-skill.md) — the skill body this change bounds, written when `pdf → txt → doc` was the only route out of a PDF.
- [The conversion seam itself](../architecture/2026-09-15-document-conversion-capability-seam.md) — the fewer-steps-first ranking that made the new rows displace the old plan without a planner change.
- [Output verification and pandoc](../architecture/2026-09-17-document-conversion-output-verification-and-pandoc.md) — why a route is proven by the file it produces, which is what rules out the Draw-mediated `pdf → odt`.
- [Windows Office conversion](2026-09-24-windows-office-conversion.md) — the provider ranking these rows sit under; Office declares no PDF *source* edge, so the Writer import is what serves this pair everywhere.
