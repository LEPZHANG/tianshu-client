# @deepseek-ai/dsh-document-convert-poppler

English | [中文](README.zh.md)

Poppler's PDF extraction tools as conversion providers for the harness [document conversion seam](../document-convert/README.md) (`ctx.documentConvert`): `pdftotext` and `pdftohtml`.

This is an **implementation** package. It registers providers into `ctx.documentConvert`, owns no key, and registers no model-facing tool. It is a function/namespace plugin (`inject: ['documentConvert', 'subprocess']`).

## Why extraction is the whole point

Without it, PDF is a dead end as a *source*. LibreOffice imports a PDF into Draw, which can only export a canvas of positioned text boxes; asked for `odt` it writes an ODF **graphics** document under an `.odt` name. Poppler recovers the text instead, and the seam chains that with a second step to reach the formats poppler itself does not write — `pdf → txt → docx`, `pdf → txt → xlsx`, and so on.

So this package is what makes the conversion matrix reach PDF in both directions. Its two routes are small; what they unlock is not.

## Two providers, not one

Each tool registers separately, so a machine carrying `pdftotext` but not `pdftohtml` keeps the route it can serve instead of losing both.

| Provider id | Route | Invocation |
|---|---|---|
| `poppler-pdftotext` | `pdf → txt` | `-layout`, keeping reading order and approximate column structure |
| `poppler-pdftohtml` | `pdf → html` | `-s` (one document rather than per-page files), `-i` (skip images, which would otherwise be written as separate files beside the output), `-noframes` (a plain document, not a frameset) |

Both routes are `lossy`: a PDF's layout is the thing being discarded.

Unlike LibreOffice, these tools write exactly the output path they are given, so a step is one spawn with no scratch directory and no rename.

## An empty extraction is a failure, and the reason matters

A PDF holding only scanned images exits 0 and writes an empty file. The provider rejects that rather than handing back a blank file that reads as a successful conversion — but the empty result alone says nothing, because two opposite situations produce it: the pages are images and there was never any text to extract, or the PDF holds text that poppler could not read.

The two need opposite responses from the caller, so the provider separates them with `pdffonts`. A PDF embedding no fonts has no text layer: `CONVERT_SOURCE_SCANNED`, and the message says the pages must be read by OCR first. A PDF that does embed fonts is `CONVERT_PROVIDER_FAILED`, and the message says it is protected against extraction or stores its text in an encoding poppler cannot map back to characters. When `pdffonts` is absent or cannot answer, the message names both causes instead of picking one — an unavailable diagnosis costs the precise wording, never the conversion.

The check runs only once a result is already empty, so a successful extraction never pays for it, and a result larger than `MAX_EMPTINESS_CHECK_BYTES` (4 MiB) skips it: that much output is evidence enough that something was recovered.

## Config

| Key | Default | Meaning |
|---|---|---|
| `pdftotextBinary` | `pdftotext` | A bare PATH name or an absolute path. |
| `pdftohtmlBinary` | `pdftohtml` | A bare PATH name or an absolute path. |
| `pdffontsBinary` | `pdffonts` | A bare PATH name or an absolute path. Consulted only to explain an extraction that recovered nothing; its absence costs the explanation, never the conversion. |
| `priority` | `20` | Tie-break rank for both routes. The default outranks LibreOffice's `10` so that `pdf → html` reaches this text extraction rather than LibreOffice's Draw-mediated export. |
| `graceMs` | `3_000` | SIGTERM→SIGKILL grace period when an extraction is cancelled. |

## Availability

Each binary is resolved once, through `ctx.subprocess.resolveExecutable`, when the plugin applies; `available()` returns the cached answer because the seam requires it to be cheap and synchronous. A machine without poppler gets registered-but-unusable providers and the seam plans around them.

## Model Experience

Indirectly, through [`dsh-tool-document-convert`](../tool-document-convert/README.md), which names these providers in the executed route it renders into the `convert_document` result and states the resulting `lossy` verdict; the flags and process mechanics stay hidden.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No OCR.** A scanned PDF has no text layer, so extraction legitimately produces nothing and the conversion fails. Recognizing such a document instead of refusing it needs an OCR engine, which is a different dependency and a different provider.
- **Extraction recovers text, never structure.** `pdftotext -layout` approximates columns with spacing and `pdftohtml` emits positioned fragments; neither recovers headings, tables, or lists as such. A `pdf → xlsx` plan therefore reaches a spreadsheet of whatever the CSV bridge makes of that spacing, which is why every route through here is `lossy`.
- **Encrypted PDFs are not handled.** A password-protected document fails with poppler's own diagnostic; the providers take no password option, because the model has nowhere to obtain one.
- **Only same-world execution.** The providers spawn through `ctx.subprocess` against the paths the seam supplies, so they serve a composition where the process world and the harness filesystem are the same.
