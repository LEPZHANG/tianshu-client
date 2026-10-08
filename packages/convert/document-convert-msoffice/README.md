# @deepseek-ai/dsh-document-convert-msoffice

English | [中文](README.zh.md)

Microsoft Office and WPS Office as conversion providers for the harness [document conversion seam](../document-convert/README.md) (`ctx.documentConvert`), driven over COM on Windows. It converts the formats those suites define — OOXML, the legacy binary formats, RTF — and every family to PDF, using the application that owns the format instead of a reimplementation of it.

This is an **implementation** package. It registers providers into `ctx.documentConvert`, owns no key, and registers no model-facing tool. It is a function/namespace plugin (`inject: ['documentConvert', 'subprocess']`).

The plugin mounts on every platform. Off Windows, and on a Windows machine with neither suite, all six providers register as unavailable and the seam plans around them — the same outcome as a machine without LibreOffice.

## Six providers, not two

`available()` belongs to a provider rather than to a route, and Office is installed per application: a machine can have Word and no PowerPoint. One provider per application per suite is what lets such a machine keep the Word routes instead of losing all of them.

| Provider | ProgID | `LocalServer32` must name | Priority |
|---|---|---|---|
| `msoffice-word` | `Word.Application` | `winword.exe` | 30 |
| `msoffice-excel` | `Excel.Application` | `excel.exe` | 30 |
| `msoffice-powerpoint` | `PowerPoint.Application` | `powerpnt.exe` | 30 |
| `wps-writer` | `KWPS.Application` | `wps.exe` | 25 |
| `wps-spreadsheets` | `KET.Application` | `et.exe` | 25 |
| `wps-presentation` | `KWPP.Application` | `wpp.exe` | 25 |

Microsoft Office outranks WPS, and both outrank [`dsh-document-convert-libreoffice`](../document-convert-libreoffice/README.md) at 10. A machine with both suites uses Microsoft Office, a machine with only WPS uses WPS, and a machine with neither falls back to LibreOffice. The three ranks are distinct on every route, so the seam never reports an ambiguous one.

## Routes, and what is deliberately excluded

- **Document family** — `doc`, `docx`, `rtf`, `txt` as sources; `pdf`, `doc`, `docx`, `rtf` as targets (13 routes). Microsoft Word adds `pdf` as a source for `doc`, `docx`, and `rtf` (3 more routes; see [PDF reflow](#pdf-reflow-through-word)).
- **Spreadsheet family** — `xls`, `xlsx` as sources; `pdf`, `xls`, `xlsx` as targets (4 routes).
- **Presentation family** — `ppt`, `pptx` as sources; `pdf`, `ppt`, `pptx` as targets (4 routes).

Every edge between an application's own formats is `faithful` and carries no note: each one is a conversion the application performs natively on a format it owns. Three groups of edges are excluded, and each exclusion keeps this higher-ranked provider from taking a route it would serve worse than the provider already there.

- **OpenDocument (`odt`, `ods`, `odp`), as source and as target.** Word's ODF import is a conversion, not a read: it re-flows the document against its own layout engine. The [official-document tool](../tool-official-document/README.md) assembles GB/T 9704—2012 pages as ODF and hands that file to this seam, so an Office `odt` edge would silently re-lay-out exactly the documents whose layout is the point. Every ODF edge stays with LibreOffice, the format's reference implementation.
- **`html`, as source and as target.** Word's HTML export carries Office-specific markup no other consumer wants. As a *source* it is worse: Word resolves `<img src="http://…">` when it opens the document, which on an offline machine is a stall with no diagnostic. [`dsh-document-convert-pandoc`](../document-convert-pandoc/README.md) is installed for this edge and is better at it.
- **`txt` as a target.** Word's `wdFormatUnicodeText` writes UTF-16, and Excel's UTF-8 CSV member requires Office 2016 or later — falling back to `xlCSV` writes the system ANSI code page, which turns Chinese into mojibake. LibreOffice's text export is UTF-8 for every family, so the edge stays there. `txt` is still accepted as a *source*, where Word reads it with an explicit UTF-8 encoding (`wdOpenFormatEncodedText` with code page 65001) rather than guessing the code page from the bytes.

## PDF reflow through Word

Word 2013 and later open a PDF by rebuilding it as a Word document (PDF Reflow): paragraphs, headings, tables, and images come out as Word's own objects. That is the only PDF import that yields a document a user can go on editing. LibreOffice's [`writer_pdf_import`](../document-convert-libreoffice/README.md) places every run of text in its own positioned frame instead, and on a Chromium-printed PDF it also recovers about one hanzi in nine as a Kangxi radical code point (`⽅` U+2F45 for `方`), because it reads the glyph's own mapping rather than the Unicode text poppler resolves. So on a machine with Word, `pdf → doc`/`docx`/`rtf` is Word's, outranking LibreOffice's frame import at the same step count.

The routes are `lossy` and every result carries `PDF_REFLOWED_BY_WORD`: the reconstruction is Word's estimate of the page, and line breaks, table borders, and spacing can differ from the original, with a complex page still coming out partly as text boxes. The document is opened read-only through the same `Documents.Open` call as any other source, so Word's "convert this PDF?" prompt is suppressed by `ConfirmConversions = $false` and never blocks the conversion.

WPS Writer declares no `pdf` source. Whether its object model opens a PDF at all is unverified, and a route that fails on every WPS machine would outrank LibreOffice's working one; a machine with only WPS keeps the LibreOffice import.

## Detection reads the class server, not just the ProgID

One PowerShell run at apply time answers both questions a route decision needs, and the second one is the reason this probe exists.

1. **Is it installed?** `[Type]::GetTypeFromProgID($id)` resolves a ProgID through the registry *without starting the application*, which is what makes the probe affordable: the seam requires `available()` to be cheap and synchronous, so every provider samples once here and returns the cached verdict afterwards.
2. **Which suite would actually answer?** A WPS installation routinely registers itself as `Word.Application`, and the seam verifies only that a conversion produced a file of the target's type — not which application produced it. So the probe reads the class's `LocalServer32`, the command line COM would launch, under `HKCU:\SOFTWARE\Classes\CLSID` and then `HKLM:` (a per-user Click-to-Run installation registers only in `HKCU`, and checking the machine hive alone would refuse it). Without that read the whole priority ordering is a guess, and `msoffice-word` would drive WPS while reporting that Microsoft Word ran.

A ProgID held by the other suite disables that provider and is logged by name, because the machine does have Office and conversions will still fall back to LibreOffice — otherwise indistinguishable from not having Office at all. A ProgID that resolves while its `LocalServer32` cannot be read is also refused: running an unidentified converter is the outcome this probe exists to prevent.

## Macros do not run

`$app.AutomationSecurity = 3` (`msoAutomationSecurityForceDisable`) is set before any document is opened and asserted by the script itself, which exits non-zero if the application did not take it. COM-opening an untrusted `.doc` or `.docm` otherwise **executes its macros**. This is the package's one security invariant, so it is fixed rather than configurable.

## Four properties of COM automation this provider encodes

1. **The Office process is not a child of the shell.** `WINWORD.EXE` is a COM server: killing PowerShell does not end it. The script records the process ids it started into a sidecar file *before* opening the document — a file rather than stdout, because a killed process may not have flushed. The provider reads that file in `finally` and `taskkill /T /F /PID`s those ids only when the run did not exit cleanly, so an application the user already had open is never touched.
2. **An application the user already had open must not be reconfigured.** Every window and alert setting, and `Quit()` itself, is applied only when this conversion started the process.
3. **PowerPoint is not driven like the other two.** It rejects `Application.Visible = $false` and is driven headless by opening the presentation with `WithWindow = msoFalse`; its `DisplayAlerts` takes `PpAlertLevel`, whose "no alerts" member is `ppAlertsNone = 1` rather than the `0` that silences Word. Excel cannot write PDF through `SaveAs` at all — `XlFileFormat` has no PDF member — so PDF goes through `ExportAsFixedFormat`.
4. **One application converts one document at a time.** Each provider holds its own queue; concurrent `convert()` calls against the same application serialize.

The output is written into a private scratch directory and moved to the caller's path afterwards, so a failed run leaves no partial file at the destination. A run that reports success without producing a file is a failure.

## Config

| Key | Default | Meaning |
|---|---|---|
| `shellBinary` | `powershell` | A bare PATH name or an absolute path. Windows PowerShell 5.1 is the default because Office COM interop is most thoroughly exercised there and it is present on every Windows installation, while PowerShell 7 is an optional install. Scripts are passed as one `-Command` argument, which the execution policy does not restrict, so a domain-managed machine that forbids running script files is still served. |
| `workDir` | `os.tmpdir()` | Parent directory for the scratch directory each conversion creates. |
| `msofficePriority` | `30` | Tie-break rank for Microsoft Office's routes; higher wins. |
| `wpsPriority` | `25` | Tie-break rank for WPS Office's routes. Must differ from `msofficePriority`: both suites declare the same edges at the same fidelity, so equal ranks leave a machine carrying both suites with a tie the seam refuses as `CONVERT_ROUTE_AMBIGUOUS`. The plugin rejects that configuration at load rather than letting a user's conversion discover it. |
| `graceMs` | `3_000` | SIGTERM→SIGKILL grace period when a conversion is cancelled. |

## Model Experience

Indirectly, through [`dsh-tool-document-convert`](../tool-document-convert/README.md), which names the selected provider in the executed route it renders into the `convert_document` result; the COM object models, the probe, and the process mechanics stay hidden.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The WPS dialect is unverified against a real installation.** WPS reimplements Microsoft's object models under its own ProgIDs, and its export method names and format constants here are taken to be the ones it documents as Office-compatible — they were not confirmed on hardware. A wrong name surfaces as `CONVERT_PROVIDER_FAILED` carrying the COM error text, which names the method that does not exist. Whether WPS honors `AutomationSecurity` at all is likewise unconfirmed, so a machine with only WPS should not be treated as enforcing the macro invariant above.
- **An interactive Windows desktop session is required.** COM automation of Office fails when the host runs as a Windows service. The harness runs as a child of the desktop application and therefore inherits a usable session; a headless or service deployment gets six unavailable providers and falls back to LibreOffice.
- **No per-engine toggle.** An administrator who wants WPS ignored on a machine that has it must pin the affected routes on the seam; this package has no "disable WPS" key, because a machine where WPS is the only suite is the case the WPS providers exist for.
- **The route table is declared, not measured per document.** A `faithful` edge says the application converts natively between those formats, not that a particular document survived the round trip.
- **PDF reflow is unverified on hardware.** The routes, their ranking over LibreOffice, and the note are covered on Linux against a scripted PowerShell; whether Word's reflow of a given PDF — in particular a Chromium-printed one with Type 3 CJK fonts — comes out with real tables rather than text boxes can only be checked on a Windows machine with Word. `tests/real-office.spec.ts` round-trips a PDF Word wrote itself and runs only there.
- **Only same-world execution.** The provider spawns through `ctx.subprocess` and moves files with `node:fs`, so it serves a composition where the process world and the harness filesystem are the same. A remote execution world needs its own provider.
