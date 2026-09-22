# Agent Note: document conversion as a route-planning capability seam

Status: implemented

English | [中文](2026-09-15-document-conversion-capability-seam.zh.md)

## Problem

The harness could not convert a document from one format to another. An agent asked to turn a `.docx` into a PDF had only `bash`, so it depended on whatever converter happened to be installed, invoked with whatever flags the model guessed, with no structured result and no way to tell the user whether the output was faithful.

The naive shape — one tool that shells out to LibreOffice — fails on contact with the actual tool. Three facts make it fail, and all three were established by conversion rather than read from documentation:

1. **`soffice` exits 0 for conversions it cannot perform.** Asked to turn text into `pptx` it writes a 2 KB presentation with no slides. Asked to turn a Writer document into `odp` it writes an ODF *text* document under an `.odp` name. Asked to turn a PDF into `odt` it writes an ODF *graphics* document under an `.odt` name. A wrapper that trusts the exit code reports success and hands back a corrupt file.
2. **A bare `--convert-to <ext>` picks the wrong filter or none at all.** `--convert-to docx` fails with "no export filter" for an HTML source; naming `docx:Office Open XML Text` succeeds on the same input. The correct filter depends on which application loaded the document, so `html` is `HTML (StarWriter)` from Writer and `HTML (StarCalc)` from Calc.
3. **No single converter spans the requested matrix.** LibreOffice cannot make a PDF usable as a source: its Draw import can only export a canvas of positioned text boxes. Thirteen formats interconverting is a larger claim than any one program satisfies.

## Decision

Conversion is a capability seam, `ctx.documentConvert`, with the route knowledge in one place and the mechanisms behind providers.

- `packages/convert/document-convert` — the Service Definition: the closed thirteen-format vocabulary, the provider registry, the route planner, and step execution.
- `packages/convert/document-convert-libreoffice` — LibreOffice headless, covering the three office families and every family to PDF.
- `packages/convert/document-convert-poppler` — `pdftotext` and `pdftohtml`, registered as two providers so a missing second binary costs only its own route.
- `packages/convert/tool-document-convert` — the model-facing `convert_document` tool.

### Providers declare routes; the seam plans across them

A provider declares static `ConvertRoute` edges — `from`, `to`, `fidelity`, `priority` — and a cheap synchronous `available()`. The seam builds a graph from the usable providers' edges and searches it. Selection is deterministic and independent of registration order: fewest steps, then best worst-case fidelity, then the highest weakest-step priority, with candidate paths enumerated in the seam's own format declaration order.

**Multi-step plans are the point, not an optimization.** They are the only way most cross-family conversions exist at all: `pdf → txt → xlsx` reaches a spreadsheet from a PDF, and reporting it as `lossy` says exactly what happened. The ceiling is two steps by default — one hop covers what a single converter does, the second reaches a target through an intermediate format, and a third buys chains nobody can vouch for.

This is also why poppler shipped alongside LibreOffice rather than later. Without extraction, PDF is a dead end as a source and the matrix has a hole no amount of planning closes.

### Fidelity is declared per edge and reported as the worst of a plan

`faithful` carries structure and formatting; `lossy` carries content but not layout. It belongs to an edge, not a provider: LibreOffice is faithful for `docx → odt` and lossy for `docx → txt`. A plan reports the worst verdict among its steps, and the tool states it in prose, because a model handing a converted file to a user needs to know the layout did not survive.

### The route table is empirical, and omissions are deliberate

Every entry was verified by placing a unique token in a fixture of each source format, running the conversion, and searching the output for that token in each encoding the target uses. The four conversions listed in the problem statement are absent for that reason, and `ppt`/`pptx → html` is absent because the XHTML export drops slide text imported from those formats while keeping it from a native `odp` — so those reach HTML through `odp` in two steps rather than through an edge that works for one source format and quietly fails for the others.

The unit tests assert those *absences*, so restoring a route someone assumes should work requires re-verifying it.

### Ambiguity is raised only where the caller can act

An unbreakable provider tie on an edge the winning plan uses is `CONVERT_ROUTE_AMBIGUOUS`, and the message names the `routes` config pin that settles it. A tie on an untouched edge is ignored — it is not that caller's problem. A tie between two whole *paths* is broken by the deterministic enumeration order instead of raised, because no config knob would let a caller settle it and a loud failure would only block work.

### The seam is not a confinement boundary

Providers hand argv to `ctx.subprocess`, so a converter writes with the harness process's own authority. The `convert_document` tool makes the containment decision before dispatch: it resolves both paths through `ctx.fs`, refuses every call under `read-only`, and requires the output inside the workspace root under `workspace-write`. A direct in-process caller of `ctx.documentConvert` bypasses that, which both READMEs state plainly. A sandboxed provider following the `dsh-bash-sandbox` arrangement is deferred rather than pretended.

## Alternatives considered

**One tool shelling out to LibreOffice.** Rejected by the three facts above. It would report corrupt output as success, and it could not express PDF-as-source at all.

**Pure JavaScript libraries (mammoth, xlsx, pdf-lib).** No external dependency, but they cannot span the matrix and their fidelity on real documents is poor. They also would not have surfaced the wrong-typed-output problem, because each library only writes one format.

**A remote HTTP conversion service (Gotenberg or similar).** A legitimate provider to add later — the seam exists so it can be — but as the only backend it makes conversion require network and deployment, and it moves documents out of the process for work the host can do locally.

**Generic shortest-path search with no step ceiling.** Rejected: an unbounded chain produces routes whose fidelity claims nobody can defend. Two steps is the smallest ceiling that closes the cross-family hole.

**Declaring fidelity per provider rather than per route.** Simpler, and wrong. It would force LibreOffice to claim one verdict for `docx → odt` and `docx → txt`, and the honest choice would be `lossy` for everything, which tells a model nothing.

**Raising `CONVERT_ROUTE_AMBIGUOUS` for path ties as well as provider ties.** Rejected: the config pins providers per edge, not paths, so the error would name no remedy.

**Sampling provider availability per call.** Rejected because the seam requires `available()` to be cheap and synchronous, which a process spawn is not. Availability is sampled once at plugin apply; the cost is that a converter installed afterwards stays invisible until remount, which both provider READMEs record.

## Consequences

The matrix is honest about itself. A conversion the registered converters cannot perform fails with `CONVERT_ROUTE_UNSUPPORTED` naming both formats and the step ceiling, instead of producing a file that opens to nothing. A lossy route says so in the model-facing result. A composition on a host with no LibreOffice degrades to whatever converters exist rather than failing to boot.

The cost is a five-role package family for what a user might describe as one feature, and a route table that is a snapshot of one LibreOffice generation — a filter rename in a future release surfaces as a conversion failure, and nothing in the build detects it. Re-verification is a documented manual procedure, not a gate.

Cold starts dominate the cost of a conversion: the first `soffice` run pays seconds of startup, and a two-step plan pays it per step because each step is its own process. A persistent LibreOffice listener would amortize that and is deferred; it would reintroduce the shared-profile contention the private per-conversion profiles exist to avoid.

## Testing

The route planner, the format vocabulary, and the tool's guards are unit-tested, and the coverage gate holds every file in the family at 100%. The providers' argv, filter selection, output discovery, and failure classification run against a scripted `ctx.subprocess` backend, so a machine without the converters still exercises the real provider code. A skip-guarded suite runs the real `soffice` and real poppler, asserting that the source's content reaches the output rather than that a file appeared. The `convert-document` ACP snapshot pins the tool schema, the prompt section, and the transcript with the seam and planner real and only the external converter replaced — a real LibreOffice PDF embeds timestamps and varies by version, so its byte size could not be pinned.

## Related

The [capability seams Agent Note](2026-06-13-capability-seams.md) owns the role split this family follows; the [web capability seam Agent Note](2026-06-24-web-capability-seam.md) is the provider-selection precedent this planner extends from one usable provider to a ranked graph.
