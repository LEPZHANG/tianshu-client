# @deepseek-ai/dsh-document-convert-libreoffice

English | [中文](README.zh.md)

The LibreOffice headless conversion provider for the harness [document conversion seam](../document-convert/README.md) (`ctx.documentConvert`). It covers the office families: the document formats, the spreadsheet formats, the presentation formats, and every one of them to PDF.

This is an **implementation** package. It registers a provider into `ctx.documentConvert`, owns no key, and registers no model-facing tool. It is a function/namespace plugin (`inject: ['documentConvert', 'subprocess']`).

## The route table is empirical

Every entry in `LIBREOFFICE_CONVERSIONS` was verified by conversion, not read from documentation. A unique token was placed in a fixture of each source format, the conversion run, and the output searched for that token in each encoding the target format uses.

That method is not pedantry. `soffice` exits 0 and writes a structurally valid file for several conversions it cannot perform:

| Asked for | What it actually writes |
|---|---|
| text → `pptx` | A 2 KB presentation containing no slides at all |
| text or a Writer document → `odp` | An ODF **text** document carrying an `.odp` name |
| PDF → `odt` | An ODF **graphics** document carrying an `.odt` name |
| `ppt`/`pptx` → `html` | An XHTML file with the slide text dropped |

None of those appear in the table. Extend it the same way, and reject any candidate whose output does not carry the source's content in a file of the target's actual type.

## Filters are explicit, and depend on the source family

Each conversion passes `<ext>:<filter>` rather than a bare extension. This is required, not cosmetic: a bare `--convert-to docx` fails with `Error: no export filter` for an HTML source, while naming `docx:Office Open XML Text` succeeds on the same input.

The filter depends on which application loaded the document, so `html` is `HTML (StarWriter)` from a Writer source and `HTML (StarCalc)` from a Calc one. Writer's filters also serve an HTML source, which loads as Writer/Web, so the family needs no separate Writer/Web column.

## Routes

- **Document family** — `doc`, `docx`, `odt`, `rtf`, `txt`, `html` convert to each other and to `pdf`. Conversions *into* `txt` are `lossy` (characters survive, nothing else); conversions *out of* it are `faithful`, since plain text has nothing further to lose.
- **Spreadsheet family** — `xls`, `xlsx`, `ods` convert to each other, to `html`, and to `pdf`. The text export is CSV: one sheet, values only, so it is `lossy`.
- **Presentation family** — `ppt`, `pptx`, `odp` convert to each other and to `pdf`. Only `odp → html` is declared, because the XHTML export carries slide text from a native Impress document and silently drops it from an imported `ppt`/`pptx`; those reach HTML through `odp` as a two-step plan instead of through a route that works for one source format and quietly fails for the others.
- **The spreadsheet bridge** — `txt → ods`/`xlsx`/`xls` by forcing Calc's CSV import filter. These are the only way a document-family file reaches the spreadsheet family at all, and they are `lossy` by construction: the text is reinterpreted as delimited data, so prose becomes a single column.
- **PDF as a source** — `pdf → doc`/`docx`/`odt`/`rtf` load the PDF through `writer_pdf_import`, LibreOffice's Writer import, which keeps the page layout and the images. They are `lossy` and carry `PDF_IMPORTED_AS_FRAMES`: every run of text lands in its own positioned frame, so the result has no flowing paragraphs, no real tables, and no headings, and on a Chromium-printed PDF about one hanzi in nine comes across as a Kangxi radical code point. On a machine with Microsoft Word, [`dsh-document-convert-msoffice`](../document-convert-msoffice/README.md#pdf-reflow-through-word) outranks these routes with Word's own reflow for `doc`, `docx`, and `rtf`; `odt` stays here. `pdf → html` is the Draw import followed by the HTML export; it recovers the text and discards the layout, and [`dsh-document-convert-poppler`](../document-convert-poppler/README.md) does that better and outranks it. Which route a caller wants depends on what it asked for — the Writer import for a document that looks like the original, poppler's extraction for text that can be edited.

  The import filter is what makes those four routes work at all. Left to itself LibreOffice opens a PDF in Draw, and a Draw document reaches the document formats either not at all (`docx` fails with an I/O write error) or as a graphics file carrying a text file's name.

## Three properties of `soffice` this provider encodes

1. **A headless run needs its own user profile.** A second instance sharing the default profile refuses to start, so every conversion passes `-env:UserInstallation` pointing at a private directory. Without it, concurrent conversions fail non-deterministically.
2. **The output filename cannot be chosen.** `--convert-to` writes `<source stem>.<ext>` into `--outdir` and offers no name argument, so each run converts into a private scratch directory and the result is copied to the caller's path afterwards. That also keeps a failed run from leaving a partial file at the destination.
3. **The exit code cannot be trusted.** The run is judged by whether the expected output file exists, not by the status alone.

## A damaged container is refused before the converter sees it

A `.docx`, `.xlsx`, `.pptx`, or OpenDocument file is a ZIP, and one written by a tool that skipped the checksums holds entries claiming a CRC of zero over data they do hold. Word opens such a file without complaint; LibreOffice refuses it and reports a generic failure that names neither the entry nor the cause, which leaves a caller retrying a conversion that cannot succeed.

So the provider reads the container first and names the damage — `CONVERT_SOURCE_DAMAGED`, listing the offending entries (the first three, then a count) — while it still knows more than the converter's diagnostic will say. The preflight reads a source only up to `MAX_PREFLIGHT_BYTES` (64 MiB); a larger file goes straight to the converter, whose own failure names it.

## Config

| Key | Default | Meaning |
|---|---|---|
| `binary` | `soffice` | A bare PATH name or an absolute path. A macOS installation that keeps `soffice` inside the application bundle needs `/Applications/LibreOffice.app/Contents/MacOS/soffice`. |
| `workDir` | `os.tmpdir()` | Parent directory for the private user profile and output directory each conversion creates. |
| `priority` | `10` | Tie-break rank against other providers offering the same route at the same fidelity; higher wins. |
| `graceMs` | `3_000` | SIGTERM→SIGKILL grace period when a conversion is cancelled. |

## Availability

The binary is resolved once, through `ctx.subprocess.resolveExecutable`, when the plugin applies; `available()` returns the cached answer because the seam requires it to be cheap and synchronous. A machine without LibreOffice therefore gets a registered-but-unusable provider and the seam plans around it, rather than a boot failure.

## Model Experience

Indirectly, through [`dsh-tool-document-convert`](../tool-document-convert/README.md), which names this provider in the executed route it renders into the `convert_document` result; the filters, profile directory, and process mechanics stay hidden.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The route table is a snapshot of one LibreOffice generation.** It was verified against LibreOffice 25.8 on Linux. A filter name or a family's export set can change between releases, and nothing in the build detects that — a declared route that stops working surfaces as a `CONVERT_PROVIDER_FAILED` at conversion time. Re-verify with the method above when raising the supported LibreOffice floor.
- **Fidelity is declared per route, not measured per document.** A `faithful` edge says the filter preserves structure in general, not that a particular document survived it. A document using features the target format cannot express loses them without the result saying so.
- **A cold start dominates the cost.** The first conversion in a process pays LibreOffice's startup, seconds rather than milliseconds, and a multi-step plan pays it again per step because each step is its own `soffice` run. A persistent listener (`--accept`) would amortize it and is deferred; it would also reintroduce the shared-profile contention the private profiles exist to avoid.
- **Only same-world execution.** The provider spawns through `ctx.subprocess` and moves files with `node:fs`, so it serves a composition where the process world and the harness filesystem are the same. A remote execution world needs its own provider.
