# Agent Note: what a conversion actually produced, and what it cost

Status: implemented

English | [中文](2026-09-17-document-conversion-output-verification-and-pandoc.zh.md)

## Problem

The conversion seam shipped and worked, and the results were poor in ways the harness could not see.

The complaint was that `convert_document` "works badly". Reproducing it separated four distinct failures, none of which the original design could detect:

1. **A converter reports success for a file that is not a document.** The seam checked that the promised file existed. LibreOffice exits 0 and writes a file for a PDF export that rendered no pages, for a presentation exported to HTML with no slide text, and for an `.odp` that is a Writer document inside. Every one of those passed the existence check and reached the model as a successful conversion.
2. **A damaged source fails with a diagnostic that names nothing.** A `.docx` written by a tool that skipped the ZIP checksums holds entries claiming a CRC of zero over data they do hold. Word opens it; LibreOffice refuses it and says only that the conversion failed. A model given that message retries the conversion, because nothing in it says the input is the problem.
3. **An empty PDF extraction is two opposite problems with one symptom.** `pdftotext` exits 0 and writes an empty file both for a scan, where there was never any text, and for a PDF whose text it could not decode. The first needs OCR and the second needs a different tool; the old failure said neither.
4. **`lossy` says something was lost and never what.** A model that is told a route is lossy can only hedge. It cannot tell the user that the spreadsheet export kept one sheet, or that the tables in the text file are now aligned spaces.

There was also a structural one: LibreOffice's HTML export is what Writer's layout engine sees — a flat run of absolutely positioned `<p>` elements with no headings, no lists, and no tables. It is a faithful picture of a page and a useless document, and it was the only HTML route the harness had.

## Investigation

The user pointed at a third-party converter as a reference for the approach. Its techniques were read and reimplemented; none of its code was copied — it carries a Non-Commercial License and bundles an AGPL-3.0 dependency, so it can inform a design and cannot enter this repository.

What that project does that this one did not: validate the content a converter produced instead of its exit status, detect damaged archives before handing them over, diagnose a scanned PDF rather than reporting an empty result, and tell the caller specifically what a conversion dropped.

What it does that this change deliberately leaves out, on scope rather than merit: pdf.js operator-list image-coverage classification, table-candidate scoring with two-engine cross-validation, and per-format numbering reconstruction. Each is a substantial subsystem whose absence costs accuracy, not correctness.

## Decision

### The seam verifies the bytes, not the exit code

`verifyConvertedBytes(format, bytes)` reads a result and looks for what its format is identified by: the PDF trailer, the compound-file header, the OOXML part that names the application, the ODF `mimetype` entry declaring that format specifically, the RTF signature, visible text in an HTML page, non-whitespace in a text file. A step whose output fails is `CONVERT_OUTPUT_UNUSABLE`, naming what was missing.

This lives in the seam rather than in each provider because it is a property of the target format, not of the mechanism, and because a provider that checks its own work is a provider that can be wrong about it twice. Providers now return notes instead of validating; the seam validates.

The check reads the file, so it is bounded: `maxVerifyBytes`, 64 MiB, a Config field because it trades memory against detection on a deployment's own documents. A larger result plainly is a document.

The seam needed its own ZIP reader for this — `isZipContainer`, `readZipEntries`, `readOdfMediaType` — about ninety lines over the central directory. A container it cannot read is reported as unreadable rather than as an empty archive, so a truncated or ZIP64 file does not pass every check built on top of it by holding no entries.

### A damaged container is named before the converter sees it

The LibreOffice provider reads a ZIP source first and reports entries whose CRC is zero over non-empty data: `CONVERT_SOURCE_DAMAGED`, listing the first three and then a count. It does this while it still knows more than LibreOffice's diagnostic will say. Bounded the same way, by `MAX_PREFLIGHT_BYTES` — a module constant, not Config, because the preflight is an optimization over a converter that will also refuse the file, and there is nothing for a deployment to decide.

### An empty extraction is diagnosed, not just refused

The poppler provider consults `pdffonts` once a result is already empty. No embedded fonts means no text layer: `CONVERT_SOURCE_SCANNED`, and the message says the pages must be read by OCR first. Fonts present means the text is protected or in an unmappable encoding: `CONVERT_PROVIDER_FAILED` saying so. When `pdffonts` cannot answer, the message names both causes rather than picking one — an unavailable diagnosis costs the wording, never the conversion.

### Notes carry what fidelity cannot

A step returns `ConvertNote` values — `{ code, message }` — and the outcome carries them, deduplicated by `code`. `convert_document` lists them under **What this conversion did not carry over:**, falling back to the generic lossy sentence only when a lossy route reported nothing.

The messages are written for the model that will relay them, not for a log. "The CSV export keeps the first sheet's values and drops the other sheets and every formula" is a sentence a model can hand to a user; "lossy" is not.

### pandoc joins as the structure-preserving converter

`packages/convert/document-convert-pandoc` registers sixteen edges: `{docx, odt, rtf, html}` to `{docx, odt, rtf, html, txt}` minus identity.

The two converters divide the formats by declaration alone, with neither package knowing the other exists, because the planner ranks fidelity ahead of priority:

- Edges reaching or leaving HTML are `faithful` at priority 20, so pandoc takes them from LibreOffice's `faithful` at 10.
- Office-to-office edges are `lossy` — pandoc rebuilds a document from its own model rather than round-tripping the file format — so LibreOffice keeps them regardless of priority. They are declared anyway, so a container carrying pandoc alone can still convert `docx → odt` at the stated cost.

The provider asks the installed pandoc what it can do rather than assuming: `--version` for a major of at least 3 (the floor `--embed-resources` needs; below it an HTML target emits references to image files that will not exist), then `--list-input-formats` and `--list-output-formats`, and the declared routes are filtered to what those report. That settles questions this package should not answer by version arithmetic, such as whether a build carries the RTF reader. A pandoc that cannot answer is treated as absent.

No `→ pdf`: that needs a LaTeX engine, an order of magnitude larger than pandoc and a separate provider. No `→ pptx`: pandoc's presentation writer invents a slide per heading, which is a new document rather than a conversion.

The plugin is mounted by default in the base bundle, next to poppler, because it degrades to registering nothing when the binary is absent — the same graceful degradation poppler already relies on.

## Consequences

- A conversion that produces a file which is not a document now fails, where it previously succeeded. That is the point, and it is a behavior change for any composition that was silently accepting such results.
- Four of the five convert packages gained bounded reads of converter inputs or outputs. Each bound is exercised by a test using a sparse file, so the 64 MiB and 4 MiB thresholds are covered without writing either.
- `convert_document` results grew by the notes a route reports — a few short lines, proportional to steps rather than to the document.
- The five packages hold 274 tests at per-file 100% coverage.

## Alternatives considered

**Trust the converter and check nothing.** What shipped, and what the complaint was about. An exit code says the program finished.

**Put verification in each provider.** Rejected: the check is a property of the target format. Duplicating it across providers would drift, and a provider that validates its own work has no independent check at all.

**Reuse the reference project's classification pipeline.** Rejected on licence — its Non-Commercial terms and AGPL-3.0 dependency are incompatible with this repository — and on scope. The techniques were reimplemented from their description; the code was not read into any file here.

**Make pandoc the primary office converter.** Rejected. Pandoc rebuilding a `.docx` from its own document model loses what LibreOffice, which round-trips the format itself, keeps. Each converter takes the edges its mechanism is right for.
