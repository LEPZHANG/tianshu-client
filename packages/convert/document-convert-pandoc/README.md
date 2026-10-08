# @deepseek-ai/dsh-document-convert-pandoc

English | [中文](README.zh.md)

Pandoc as a conversion provider for the harness [document conversion seam](../document-convert/README.md) (`ctx.documentConvert`).

This is an **implementation** package. It registers a provider into `ctx.documentConvert`, owns no key, and registers no model-facing tool. It is a function/namespace plugin (`inject: ['documentConvert', 'subprocess']`).

## Why a second office converter

LibreOffice and pandoc convert by opposite mechanisms, and each one's mechanism is the other's weakness.

LibreOffice opens the file in the application that owns the format and exports it through that application's own filter, so a `.docx` really does round-trip as a `.docx`. Asked for HTML, though, the same machinery writes what Writer's layout engine sees: a flat run of absolutely positioned `<p>` elements with no headings, no lists, and no tables. That output is a faithful picture of a page and a useless document.

Pandoc reads the source into its own document model — headings, lists, tables, footnotes, inline styling — and writes that model back out. HTML from pandoc is the document; a `.docx` from pandoc is a rebuild, which is why the office-to-office edges here declare `lossy` and LibreOffice keeps them wherever both are installed. Neither package knows the other exists: the seam ranks fidelity ahead of priority, so the declarations alone decide.

## Routes

Every format pandoc reads, to every format it writes, minus the identity edges — 16 in all.

| | → `docx` | → `odt` | → `rtf` | → `html` | → `txt` |
|---|---|---|---|---|---|
| `docx` → | — | lossy | lossy | **faithful** | lossy |
| `odt` → | lossy | — | lossy | **faithful** | lossy |
| `rtf` → | lossy | lossy | — | **faithful** | lossy |
| `html` → | **faithful** | **faithful** | **faithful** | — | lossy |

`pdf` is absent as a target because pandoc reaches it only through an external LaTeX engine, which is a separate dependency chain and would be a separate provider. `pptx` is absent because pandoc's presentation writer invents a slide per heading, which produces a new document rather than a conversion of the one it was given. `txt` is absent as a *source* because plain text carries no structure to recover, so LibreOffice keeps every `txt →` edge.

Every route reports one note saying what it cost the document: `HTML_REFLOWS`, `PAGE_SETUP_DEFAULTED`, `PLAIN_TEXT_ONLY`, or `DOCUMENT_MODEL_REBUILD`. These reach the model through the `convert_document` result, which is the point of them.

## Invocation

```
pandoc --from <reader> --to <writer> --standalone --resource-path <source dir> [--embed-resources] --output <out> <source>
```

- `--standalone` because the writers that distinguish a document from a fragment otherwise emit the fragment: an RTF with no `{\rtf1` preamble, an HTML body with no enclosing page.
- `--resource-path` naming the source's own directory, because pandoc resolves a source's relative image references against the working directory rather than against the source.
- `--embed-resources` for an HTML target, so images become data URIs. A provider must write exactly one file, and without it pandoc emits references to image files that will not exist beside the output.

Pandoc writes exactly the output path it is given, so a step is one spawn with no scratch directory and no rename.

## Config

| Key | Default | Meaning |
|---|---|---|
| `binary` | `pandoc` | A bare PATH name or an absolute path. |
| `priority` | `20` | Tie-break rank for every route. The default outranks LibreOffice's `10`, which decides the HTML and plain-text edges; the office-to-office edges stay with LibreOffice regardless, being declared `lossy`. |
| `graceMs` | `3_000` | SIGTERM→SIGKILL grace period when a conversion is cancelled. |

## Availability

The plugin asks the installed pandoc what it can do, once, when it applies:

1. `ctx.subprocess.resolveExecutable(binary)` — an unresolvable binary registers nothing.
2. `pandoc --version` — a major version below `3` registers nothing, because `--embed-resources` arrived in pandoc 3.0 (replacing `--self-contained`) and an HTML target without it produces a result that looks converted and is not.
3. `pandoc --list-input-formats` and `--list-output-formats` — the routes above are filtered to the readers and writers this build reports.

Asking is what settles questions this package should not answer by version arithmetic, such as whether a given build carries the RTF reader. A pandoc that cannot answer is treated as absent rather than assumed capable, so `available()` stays cheap and synchronous as the seam requires. A pandoc installed or upgraded later is invisible until the plugin is remounted.

## Model Experience

Indirectly, through [`dsh-tool-document-convert`](../tool-document-convert/README.md), which names this provider in the executed route it renders into the `convert_document` result and relays the route's note; the flags and process mechanics stay hidden.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No PDF target.** `--to pdf` needs a LaTeX engine (`pdflatex`, `xelatex`, `tectonic`), a dependency an order of magnitude larger than pandoc itself. LibreOffice serves every `→ pdf` edge, so the gap costs nothing today; a composition that wants pandoc's typesetting needs a separate provider declaring that toolchain.
- **No spreadsheet or presentation formats.** Pandoc has no reader for `xlsx`, `ods`, `ppt`, or `pptx`, and its `pptx` writer builds slides out of headings rather than converting a presentation. Those families stay with LibreOffice.
- **The office-to-office edges exist for a pandoc-only machine.** Where LibreOffice is installed they are never selected, being declared `lossy` against its `faithful`. They are declared anyway so that a container carrying pandoc alone can still convert `docx → odt`, at the cost the note states.
- **Only same-world execution.** The provider spawns through `ctx.subprocess` against the paths the seam supplies, so it serves a composition where the process world and the harness filesystem are the same.
