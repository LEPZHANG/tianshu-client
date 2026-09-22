# Document conversion

English | [中文](document-convert.zh.md)

The vocabulary and wiring of `ctx.documentConvert`: what a format is, what a provider declares, how a route is planned across providers, and what a completed conversion reports. The owning packages are [`packages/convert`](../../packages/convert/README.md).

## Formats

`DocumentFormat` is a closed union of thirteen ids, each also its canonical file extension:

| Family | Formats |
|---|---|
| document | `doc`, `docx`, `odt`, `rtf`, `txt`, `html` |
| spreadsheet | `xls`, `xlsx`, `ods` |
| presentation | `ppt`, `pptx`, `odp` |
| none | `pdf` |

`formatFamily` returns the family, and `undefined` for `pdf`: it is the rendering target all three families export to and belongs to no editor. A provider whose mechanism is family-dependent reads this — LibreOffice selects its export filter by the family that loaded the document, so `html` is `HTML (StarWriter)` from a Writer source and `HTML (StarCalc)` from a Calc one.

`detectFormat(path)` reads a format from a path's extension (accepting `htm` for `html`, ignoring case, handling either path separator). `defaultOutputPath(path, format)` writes one. Both are pure string functions with no filesystem or platform coupling, because the conversion tool's replay presenters call them where no service exists.

## What a provider declares

```ts
import type {
  ConvertFidelity,
  ConvertNote,
  ConvertStepSpec,
  DocumentFormat,
} from '@deepseek-ai/dsh-document-convert'

interface DocumentConvertProvider {
  readonly id: string
  readonly routes: readonly ConvertRoute[]
  available(): boolean
  convert(step: ConvertStepSpec, signal?: AbortSignal): Promise<readonly ConvertNote[]>
}

interface ConvertRoute {
  readonly from: DocumentFormat
  readonly to: DocumentFormat
  readonly fidelity: ConvertFidelity   // 'faithful' | 'lossy'
  readonly priority: number
}
```

`routes` is static: it describes the mechanism's capability, not the current machine. Whether the binary exists is `available()`, which must be cheap and synchronous — the shipped providers sample their binary once at plugin apply and return the cached answer.

One provider corresponds to one mechanism, in practice one binary. A vendor shipping two executables registers two providers, so a missing second binary costs only its own routes.

`convert` writes exactly `step.outputPath` and nothing else, and returns what that step cost the document. Both paths are in the provider's execution world. The provider does not re-check its own result: the seam verifies every written file, so a provider reports rather than validates.

## Fidelity and notes

`faithful` means the conversion carries structure and formatting across; `lossy` means the content survives but the layout, styling, or structure does not. It is a property of a single edge, not of a provider: LibreOffice is faithful converting `docx → odt` and lossy converting `docx → txt`.

A plan's fidelity is the worst of its steps. One lossy hop makes the whole conversion lossy, and the model-facing result says so — a model handing a converted file to a user needs to know whether the layout survived.

Fidelity says a route loses something; a `ConvertNote` — `{ code, message }` — says what. Each step returns its notes and the outcome carries them, deduplicated by `code` in the order they were reported. The distinction is about the reader: "lossy" tells a model to hedge, while "the CSV export keeps the first sheet's values and drops the other sheets and every formula" tells it what to warn the user about. Notes describe a conversion that happened; a condition that makes the result unusable is a `ConvertError`, not a note.

Fidelity also decides which provider serves an edge two of them declare, ahead of `priority`. That is how pandoc and LibreOffice divide the office formats between them without either package knowing about the other: pandoc declares its office-to-office edges `lossy`, because it rebuilds a document from its own model rather than round-tripping the file format, and LibreOffice keeps those edges at a lower priority. The edges that reach or leave HTML go the other way — pandoc declares them `faithful`, LibreOffice's HTML export being a flat run of positioned `<p>` elements.

## Request, spec, outcome

Conversion is two explicit phases.

```ts
import type {
  ConvertOutcome,
  ConvertRequest,
  ConvertSpec,
} from '@deepseek-ai/dsh-document-convert'

interface DocumentConvertRuntime {
  resolve(request: ConvertRequest): ConvertSpec
  run(spec: ConvertSpec, signal?: AbortSignal): Promise<ConvertOutcome>
}
```

`resolve` is the seam's only defaulting step: it reads the source format from the path extension when the request states none, derives the output path beside the source when the request names none, and plans the route. Keeping it apart from `run` lets a caller learn the output path and the fidelity it is about to accept before anything is written.

`ConvertOutcome` reports the written path, both formats, the plan's fidelity, the steps actually executed, the byte size, and the notes those steps reported.

What crosses this seam is paths, not bytes: the shipped providers are file-oriented external programs, and a large presentation has no reason to pass through the harness process.

## Planning

A plan is one or more steps. More than one is not an optimization — it is the only way most cross-family targets exist at all. No converter turns a PDF into a spreadsheet, but `pdf → txt → xlsx` does, and reporting it as `lossy` says so instead of pretending a direct route exists.

Selection never depends on registration order:

1. Every usable provider's routes become edges; an unusable provider contributes none.
2. A configured pin restricts an edge to one provider. A pin that cannot be honored fails with `CONVERT_ROUTE_CONFIGURED_MISSING` — a pin is a decision, not a suggestion.
3. Candidate paths up to `maxSteps` hops are enumerated in the format declaration order of `dsh-document-convert`, never in provider registration order, and never revisit a format.
4. The winner is chosen by fewest steps, then best worst-case fidelity, then highest weakest-step priority.
5. Each edge of the winner resolves to its best provider: better fidelity first, then higher priority.

An unbreakable provider tie on an edge the winning plan uses is `CONVERT_ROUTE_AMBIGUOUS`, naming the `routes` pin that settles it. A tie on an untouched edge is ignored. A tie between two whole paths is broken by the deterministic enumeration order rather than raised, because the caller has no knob that would settle it.

## Execution

Each step runs through its planned provider. A multi-step plan writes intermediates into a scratch directory removed whether the conversion succeeds or fails; only the final step writes the caller's output path, so a failure leaves no partial file at the destination.

After every step the seam checks the file rather than trusting the provider's report, because an exit code says the program finished, not that it wrote a document. The file must exist (`CONVERT_OUTPUT_MISSING`) and must be one of its target format (`CONVERT_OUTPUT_UNUSABLE`): `verifyConvertedBytes` looks for what the format is identified by — the PDF trailer, the compound-file header, the OOXML part that names the application, the ODF `mimetype` entry, visible text in an HTML page. LibreOffice exits 0 for a PDF export that wrote no pages, for a presentation exported to HTML with no slide text, and for an `.odp` that is a Writer document inside. A result larger than `maxVerifyBytes` (64 MiB) skips the content check, having plainly produced a document.

## Errors

`ConvertError` carries a machine-routable, open-string `code` and a chained `cause`.

| Code | Raised when |
|---|---|
| `CONVERT_CONFIG_INVALID` | The step ceiling is not a positive integer. |
| `CONVERT_ROUTE_KEY_INVALID` | A `routes` key is malformed or names an unknown format. |
| `CONVERT_FORMAT_UNKNOWN` | The source format is neither stated nor readable from the path. |
| `CONVERT_SAME_FORMAT` | Source and target are the same format. |
| `CONVERT_ROUTE_UNSUPPORTED` | No usable provider chain reaches the target within the ceiling. |
| `CONVERT_ROUTE_AMBIGUOUS` | The selected plan rests on an unbreakable provider tie. |
| `CONVERT_ROUTE_CONFIGURED_MISSING` | A pin names a provider that is absent, unusable, or does not serve the edge. |
| `CONVERT_DUPLICATE_PROVIDER` | A provider id is already registered. |
| `CONVERT_PROVIDER_UNAVAILABLE` | A planned provider is no longer usable at execution. |
| `CONVERT_PROVIDER_FAILED` | A converter failed, or produced nothing usable. Owned by providers. |
| `CONVERT_OUTPUT_MISSING` | A step reported success without producing its file. |
| `CONVERT_OUTPUT_UNUSABLE` | A step produced a file that is not one of its target format. |
| `CONVERT_SOURCE_DAMAGED` | The source is a container the converter will refuse — entries claiming no checksum over data they hold. Owned by providers. |
| `CONVERT_SOURCE_SCANNED` | A PDF embeds no fonts, so its pages are images and there is no text to extract. Owned by providers. |
| `CONVERT_CANCELLED` | The caller's signal fired. |

The `convert_document` consumer adds `CONVERT_SOURCE_MISSING`, `CONVERT_SOURCE_NOT_FILE`, `CONVERT_OUTPUT_EXISTS`, and `CONVERT_SANDBOX_DENIED` for the conditions it owns.

## 公文格式: the seam's second consumer

`write_official_document` ([`packages/convert/tool-official-document`](../../packages/convert/tool-official-document/README.md)) lays structured content out to GB/T 9704—2012《党政机关公文格式》 — A4, a 156 × 225 mm 版心 of 22 lines by 28 characters, 三号仿宋 body text, the red separator rule, the 一、/（一）/1./（1） levels, the 版记 — and writes the file.

It is a consumer, not a provider, and it does not add a format. The layout is produced as OpenDocument text, which the package assembles itself as a ZIP of `content.xml`, `styles.xml`, and a manifest; `odt` is already one of the thirteen, so the closed union is unchanged. Every other format the tool offers is reached by staging that `.odt` in a directory the tool owns and asking the seam to convert it into place — `odt → docx` and `odt → pdf` are edges LibreOffice already declares, so producing a 公文 as `.docx` runs the ordinary planner over the ordinary providers. The default is `docx`, which is what recipients open; a host without LibreOffice therefore reaches only `odt`, and the tool says so with `OFFICIAL_DOC_FORMAT_UNREACHABLE` naming `format: "odt"` rather than failing opaquely.

This is the arrangement the seam was built for: a second consumer that needs one new output format gets it by writing a file the existing providers already read, not by extending the format union or registering a converter.

The tool owns its own error codes — `OFFICIAL_DOC_FIELD_MISSING` and `OFFICIAL_DOC_FIELD_INVALID` for a document that breaks the standard, `OFFICIAL_DOC_OUTPUT_EXISTS`, `OFFICIAL_DOC_FORMAT_UNREACHABLE` — and its own note code `OFFICIAL_DOC_FONTS_REQUIRED`, which every result carries because a file can name the standard's typefaces but cannot supply them to a machine that lacks them.

## Confinement

The seam is not a confinement boundary. Its providers hand argv to `ctx.subprocess`, so a converter writes with the harness process's own authority and no filesystem backend stands between it and the destination. Both consumers resolve their output through `ctx.fs` and refuse one the session's sandbox mode disallows — `write_official_document` also writes its `.odt` with the harness process's own authority, so it makes that decision before touching any path — and the two share one implementation of it, exported from `dsh-tool-document-convert`. A direct in-process caller of `ctx.documentConvert` bypasses it. A sandboxed provider — the `dsh-bash-sandbox` arrangement, wrapping argv through `ctx.sandbox` — is deferred.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocumentconvert--documentconvertruntime"></a>

### `ctx.documentConvert` — `DocumentConvertRuntime`

The document conversion service. Registered as `ctx.documentConvert` (one instance per context).

Usage is two explicit phases: resolve applies every default and plans the route, failing loud when the request cannot be served; run executes the resolved plan. Keeping them apart lets a caller learn the output path and the fidelity it is about to accept before anything is written.

```ts cordis-catalog
/**
 * Register a conversion provider. Throws {@link ConvertError} `CONVERT_DUPLICATE_PROVIDER` if its id is
 * already registered. Returns a disposer; disposed with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: DocumentConvertProvider): () => void

/**
 * Apply every default to a request and plan its route. This is the seam's only defaulting step: the
 * source format comes from the source path's extension when unstated, the output path is derived
 * beside the source when unstated, and the route is chosen from the currently usable providers.
 *
 * @param request - the source path, target format, and any explicit overrides.
 * @returns the fully-resolved conversion, including the plan and its fidelity.
 * @throws {@link ConvertError} `CONVERT_FORMAT_UNKNOWN` when the source format is neither stated nor
 *   readable from the path, plus any planning failure from `planRoute`.
 */
resolve(request: ConvertRequest): ConvertSpec

/**
 * Execute a resolved conversion. Each step runs through its planned provider; a multi-step plan writes
 * its intermediates into a scratch directory that is removed whether the conversion succeeds or fails,
 * and only the final step writes `spec.outputPath`.
 *
 * Every step's result is checked against its target format before the next step reads it, so a
 * converter that reported success without producing a usable document fails here rather than handing
 * back a file that opens empty. A rejected file is deleted, including at the destination.
 *
 * @param spec - the resolved conversion from {@link resolve}.
 * @param signal - optional cancellation signal, checked between steps and forwarded to providers.
 * @returns what was written: the path, the executed steps, the fidelity, the byte size, and the notes
 *   the steps reported about what the document lost.
 * @throws {@link ConvertError} `CONVERT_CANCELLED` when the signal fires, `CONVERT_PROVIDER_UNAVAILABLE`
 *   when a planned provider is no longer registered, `CONVERT_OUTPUT_MISSING` when a step reports
 *   success without producing its file, or `CONVERT_OUTPUT_UNUSABLE` when it produces one that is not a
 *   document of the format it promised.
 */
async run(spec: ConvertSpec, signal?: AbortSignal): Promise<ConvertOutcome>
```

Source: [`packages/convert/document-convert/src/index.ts:103`](../../packages/convert/document-convert/src/index.ts)
<!-- END GENERATED cordis-surface -->
