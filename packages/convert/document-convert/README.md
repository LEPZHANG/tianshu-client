# @deepseek-ai/dsh-document-convert

English | [中文](README.zh.md)

The document conversion capability seam (`ctx.documentConvert`): a registry of converter providers, a route planner over the conversions they declare, and step-by-step execution of the plan it chooses.

This is the **interface** package. It runs no converter and knows no vendor. Providers register what they can do; `@deepseek-ai/dsh-tool-document-convert` is the model-facing consumer.

## What crosses this seam

Paths, not bytes. The shipped providers are file-oriented external programs, and a hundred-megabyte presentation has no reason to pass through the harness process. A `ConvertRequest` names a source path in the provider's execution world and a target format; the outcome names the file that was written.

## Formats

Thirteen, as a closed union — `pdf`, `doc`, `docx`, `odt`, `rtf`, `txt`, `html`, `xls`, `xlsx`, `ods`, `ppt`, `pptx`, `odp`. Each id is also its canonical file extension, which is how `detectFormat` reads a source path and how `defaultOutputPath` writes one. Adding a format breaks compilation at every consumer that switches on it.

`formatFamily` classifies a format as `document`, `spreadsheet`, or `presentation`. `pdf` has none: it is the rendering target all three families export to and belongs to no editor.

## Two phases, not one

`resolve(request)` applies every default and plans the route; `run(spec)` executes it. Keeping them apart lets a caller learn the output path and the fidelity it is about to accept before anything is written, and it puts all defaulting in one explicit step rather than inside execution.

`resolve` reads the source format from the path extension when the request states none, derives the output path beside the source when the request names none, and plans the route. It throws rather than guessing: an unreadable extension is `CONVERT_FORMAT_UNKNOWN`.

## Fidelity, and what a route actually cost

Every declared route says what it preserves: `faithful` carries structure and formatting across, `lossy` carries the content but not the layout. A plan's fidelity is the **worst** of its steps, so one lossy hop makes the whole conversion lossy. This is not decoration — a model handing a converted file to a user needs to know whether the layout survived, and the consumer renders the verdict into the result text.

Fidelity says a route loses something; a **note** says what. Each step returns `ConvertNote` values — `{ code, message }` — and the outcome carries them, deduplicated by `code` in the order they were reported. The distinction matters to the only reader that counts: "lossy" tells a model to hedge, while "the CSV export keeps the first sheet's values and drops the other sheets and every formula" tells it what to warn the user about. Notes describe a conversion that happened; a condition that makes the result unusable is a `ConvertError`, not a note.

## Planning

A plan is one or more steps. Multiple steps are not an optimization; they are the only way most cross-family targets exist at all. No converter turns a PDF into a spreadsheet, but `pdf → txt → xlsx` does, and reporting that as `lossy` says so honestly instead of pretending a direct route exists.

Selection never depends on registration order:

1. Every usable provider's declared routes become edges. An unusable provider (its binary is absent) contributes none, so a machine without a converter plans around it.
2. A configured pin restricts an edge to one provider. A pin naming a provider that is absent, unusable, or does not serve that edge fails with `CONVERT_ROUTE_CONFIGURED_MISSING` — a pin is a decision, not a suggestion.
3. Candidate paths up to `maxSteps` hops are enumerated in this package's own format declaration order, never in provider registration order, and never revisit a format.
4. The winner is chosen by fewest steps, then best worst-case fidelity, then the highest weakest-step priority.
5. Each edge in the winning plan resolves to its best provider: better fidelity first, then higher priority.

An unbreakable provider tie **on an edge the winning plan uses** is `CONVERT_ROUTE_AMBIGUOUS`, and the message names the remedy: pin that edge in `routes`. A tie on an edge this conversion does not touch is not this caller's problem and is ignored. A tie between two whole *paths* is broken by the deterministic enumeration order instead of raised, because the caller has no knob that would settle it.

## Execution

Each step runs through its planned provider. A multi-step plan writes intermediates into a scratch directory removed whether the conversion succeeds or fails; only the final step writes the caller's output path, so a failed conversion leaves no partial file at the destination.

After every step the seam checks the file the provider promised, rather than trusting the provider's report. Two checks, because converters fail in two ways:

- The file must exist — `CONVERT_OUTPUT_MISSING`. `soffice` exits 0 for conversions it did not perform.
- The file must be one of its target format — `CONVERT_OUTPUT_UNUSABLE`. An exit code says the program finished, not that it wrote a document: LibreOffice exits 0 for a PDF export that wrote no pages, for a presentation exported to HTML with no slide text, and for an `.odp` that is a Writer document inside. `verifyConvertedBytes` reads the bytes and looks for what that format is identified by — the PDF trailer, the compound-file header, the OOXML part that names the application, the ODF `mimetype` entry, visible text in an HTML page — and the error says which one was missing.

A result larger than `maxVerifyBytes` skips the content check: a converter that wrote sixty-four megabytes plainly produced a document, so the read would cost memory to learn nothing.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxSteps` | `2` | Maximum converter steps one plan may chain. One hop covers every conversion a single converter performs; the second reaches a target through an intermediate format. Raising it buys increasingly dubious chains. |
| `routes` | `{}` | Edge pins, spelled `{ 'docx->html': 'pandoc' }`. The remedy a `CONVERT_ROUTE_AMBIGUOUS` failure names, and the way a composition overrides the ranking for a pair it has an opinion about. |
| `tempDir` | `os.tmpdir()` | Parent directory for per-conversion scratch directories. |
| `maxVerifyBytes` | `64 MiB` | Largest result read back for the content check. Above it the converter plainly wrote a document, and the read would cost memory to learn nothing. |

A malformed `routes` key fails at load, because key syntax and format names are self-contained. Whether a pinned provider exists is not, and is checked when planning consults that edge.

## Errors

`ConvertError` carries a machine-routable `code`. The seam owns `CONVERT_CONFIG_INVALID`, `CONVERT_ROUTE_KEY_INVALID`, `CONVERT_FORMAT_UNKNOWN`, `CONVERT_SAME_FORMAT`, `CONVERT_ROUTE_UNSUPPORTED`, `CONVERT_ROUTE_AMBIGUOUS`, `CONVERT_ROUTE_CONFIGURED_MISSING`, `CONVERT_DUPLICATE_PROVIDER`, `CONVERT_PROVIDER_UNAVAILABLE`, `CONVERT_OUTPUT_MISSING`, `CONVERT_OUTPUT_UNUSABLE`, and `CONVERT_CANCELLED`. Providers classify their own mechanism failures as `CONVERT_PROVIDER_FAILED`, and name a source the converter cannot use with `CONVERT_SOURCE_DAMAGED` or `CONVERT_SOURCE_SCANNED`; consumers add codes for conditions they own. The code string is open — consumers must tolerate one they do not recognize.

## Model Experience

Indirectly, through [`dsh-tool-document-convert`](../tool-document-convert/README.md), which renders this seam's outcome — the written path, the executed route, and its fidelity verdict — into the `convert_document` result and owns every prompt and schema the model sees.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **This seam is not a confinement boundary.** Its providers hand argv to `ctx.subprocess`, so a converter writes with the harness process's own authority and no filesystem backend stands between it and the destination. The `convert_document` tool resolves both paths through `ctx.fs` and refuses an output the session's sandbox mode disallows, but a direct in-process caller of `ctx.documentConvert` bypasses that entirely. A sandboxed provider — the `dsh-bash-sandbox` arrangement, wrapping argv through `ctx.sandbox` — is deferred.
- **Scratch files use the harness process's own filesystem.** `run` creates a multi-step plan's intermediate directory with `node:fs`, not through `ctx.fs`, so a provider whose execution world is remote can only serve single-step plans in a composition where `tempDir` is not a path that world can read.
- **A provider's usability is sampled once.** The shipped providers resolve their binaries when they apply and cache the answer, because `available()` must be cheap and synchronous. A converter installed after the harness started stays invisible until its plugin is remounted.
- **Plans are not cached.** Every `resolve` rebuilds the route graph from the current providers. The graph is a few dozen edges, so this is measurement-free for now; a composition registering many providers would want a revisioned cache.
