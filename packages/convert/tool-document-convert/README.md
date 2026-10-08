# @deepseek-ai/dsh-tool-document-convert

English | [中文](README.zh.md)

The model-facing `convert_document` tool. It resolves the paths a call names against the session workspace, decides whether the session may write the output, and hands the conversion to the [document conversion seam](../document-convert/README.md) (`ctx.documentConvert`).

This is the **consumer** package. It owns the schema, the guards, and the presentation; the seam owns route selection, and providers own the converters. It is a function/namespace plugin (`inject: ['tools', 'systemPrompt', 'documentConvert', 'fs']`).

## Arguments

| Argument | Required | Meaning |
|---|---|---|
| `path` | yes | The file to convert, resolved by the filesystem backend. |
| `to` | yes | The format to produce, as an enum of the seam's thirteen. The registry rejects anything else before execution, so the model cannot ask for a format that could not exist. |
| `output_path` | no | Where to write. Defaults to the source path with the new extension. |
| `if_exists` | no | What to do when the output path is already taken: `rename` (the default) writes beside it and reports the new name, `overwrite` replaces it, `refuse` fails the call. |

## What the call does, in order

1. Resolve the standing file-effect policy — before any path is touched, because a conversion always produces a file.
2. Resolve the source through `ctx.fs` against the session workspace, and confirm it exists and is a regular file.
3. Resolve the output the same way and check it against the sandbox mode.
4. Apply `if_exists` to an output path that is already taken: write `report-1.pdf` beside `report.pdf` and report `renamed_from`, replace the file, or refuse with `CONVERT_OUTPUT_EXISTS`. Renaming counts up to 100 alternatives and then refuses with the same code, so a directory of collisions ends in a message rather than an unbounded scan.
5. Ask the seam to `resolve` a plan, then `run` it, forwarding the call's cancellation signal.

The seam receives `ctx.fs.processPath(...)` for both ends — the execution world's real paths — while the result reports `displayPath`, the path the model named.

## Where a conversion may write

The seam is not a confinement boundary: its providers hand argv to `ctx.subprocess`, so the converter writes with the harness process's own authority and no filesystem backend stands between it and the destination. This tool is where the decision is actually made.

| Standing mode | Outcome |
|---|---|
| no sandbox policy mounted | No root-based limit; the composition confines nothing. |
| `read-only` | Every call is refused. There is no read-only form of a conversion to fall back to. |
| `workspace-write` | The output must resolve inside the session's workspace root. |
| `danger-full-access` | No root-based limit, the mode having removed it. |

Both refusals are `CONVERT_SANDBOX_DENIED`. The tool advertises no escalation arguments: unlike a file edit, a conversion has no established case for asking the user to widen the sandbox for it.

## The canonical value

```
{ path, from, to, fidelity, steps: [{ from, to, provider }], bytes, notes: [{ code, message }], renamed_from? }
```

Code Mode reads this directly. The rendered text states the same facts in prose: the intermediate formats a multi-step plan passed through, and then what the conversion cost the document.

`renamed_from` is present only when the requested path was taken and the conversion was written beside it, and it carries the path the call asked for. `rename` is the default because the alternative makes a failed tool call the only way to discover a collision: nothing tells a model a path is taken until it tries, so a refusal is not a safety prompt but a probe, and a user watching sees a conversion fail for a file that was never at risk. The existing file is never touched either way, and the rendered text tells the model to give the user the name actually written.

`notes` is where that second part comes from. Each provider reports what its step actually did — the CSV export kept one sheet, the PDF extraction recovered page text without the structure, the HTML result reflows instead of paginating — and the rendered text lists those sentences under **What this conversion did not carry over:**. Only when a lossy route reported nothing does the text fall back to the generic sentence that the text carried over but layout, styling, and structure did not. The specific sentence is the one the model can relay to a user; the generic one only tells it to hedge.

## Presentation

The pending call is a `generic` card with `kind: 'edit'`, which is how a produced file joins the deliverables row a finished turn ends with; `locations` names the requested output so an editor can follow along, which is the most a pure function of the arguments can say — a rename resolves during execution. The completed card is titled by the file actually written and marked `(lossy)` where that applies, from durable result metadata so replay reproduces it.

## Config

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120_000` | The cooperative tool-call budget, enforced by [`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md). The default is large because a cold LibreOffice start costs seconds before the document is read, and a multi-step plan pays that per step. |

## Model Experience

### System prompt

#### What the model sees

One fixed paragraph, registered at order 112 whenever this package is loaded.

##### Conversion guidance

```markdown
Use the convert_document tool to convert a file between document, spreadsheet, and presentation formats. It reports whether the conversion preserved the source or only its text; say so when it did not, and never claim a conversion the tool refused.
```

#### Token effect

One fixed paragraph per request, unchanged by which converters the host has installed and present even when a scoped restriction hides the tool's schema.

#### KV Cache effect

Static for the lifetime of the package mount, so it stays in the reusable prompt prefix; only mounting or unmounting the plugin changes it.

### Tool schema

#### What the model sees

The generated [`convert_document` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-document-convert). The `to` enum lists the seam's thirteen formats verbatim, so the advertised vocabulary does not depend on which converters a host has. The tool-call budget is a deployment setting, not a model argument.

#### Token effect

Fixed schema cost per request; a scoped restriction removes the schema while leaving the prompt section.

#### KV Cache effect

Prefix-stable: the schema is built from this package's own format list and its text does not vary with host state, so an unusable converter does not invalidate reuse.

### Conversion results

#### What the model sees

One line naming the formats, the written path, its size in bytes, and the providers the route ran through. A multi-step plan adds the intermediate formats it passed through. A lossy route then adds what it cost: the notes its providers reported, one per line under "What this conversion did not carry over:", or the generic sentence about layout and structure when none were reported. A refusal carries the seam's or the tool's own message — an unreachable pair names both formats and the step ceiling, a damaged source names the entries that broke it, a scanned PDF says it must be read by OCR first, a sandbox denial says where the output may live.

#### Token effect

A few short lines per successful call, proportional to the number of steps and the notes they reported rather than to the document; the converted bytes never enter the context.

#### KV Cache effect

Append-only: each result is appended after the call that produced it and no earlier request tokens are replaced.

## Known Limitations and Deferred Work

- **A direct seam caller bypasses these guards.** The source check, the workspace containment, and the collision policy all live in this tool, so an in-process caller reaching `ctx.documentConvert` directly gets none of them. Moving enforcement into the providers needs a sandboxed spawn arrangement the seam records as deferred.
- **The collision check is not atomic.** Existence is tested before the conversion starts, so a file created at the destination in between is replaced under `overwrite` and written over under `rename`. Closing that needs an exclusive-create handshake the seam's path-out contract does not currently express.
- **No escalation path.** Under `read-only` the tool refuses rather than offering the wider-mode retry the file tools advertise. If a real deployment wants conversions from a read-only session, the escalation vocabulary already exists in `dsh-sandbox` and this tool would opt into it.
- **The output directory must already exist.** A call naming `out/final.pdf` under a missing `out/` fails with the converter's own diagnostic rather than a clear refusal, because no step creates intermediate directories.
