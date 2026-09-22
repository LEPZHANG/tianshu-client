/**
 * Vocabulary for the document conversion capability seam (`ctx.documentConvert`). Formats, families,
 * provider-declared routes, the resolved conversion spec, and the error taxonomy. Conversion is
 * path-in / path-out: the values crossing this seam are paths in the provider's execution world, not
 * bytes, because the shipped providers are file-oriented external converters and a megabyte document
 * has no reason to pass through the harness process.
 * @module @deepseek-ai/dsh-document-convert/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * A document format this seam can name. A CLOSED union: consumers `switch` on it ending in
 * `assertNever`, so adding a format breaks compilation at every consumer until handled. The id is
 * the canonical lowercase file extension, which is also how {@link detectFormat} reads a path and how
 * {@link defaultOutputPath} writes one.
 */
export type DocumentFormat =
  | 'pdf'
  | 'doc'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'txt'
  | 'html'
  | 'xls'
  | 'xlsx'
  | 'ods'
  | 'ppt'
  | 'pptx'
  | 'odp'

/**
 * The editor family a format belongs to. `pdf` has no family of its own — it is a rendering target
 * every family exports to and a source every family imports poorly — so {@link formatFamily} returns
 * `undefined` for it and a provider that needs a family for PDF derives one from the other end of the
 * route. Providers whose mechanism is family-dependent (LibreOffice picks its export filter by family)
 * read this; the seam itself only plans routes.
 */
export type DocumentFamily = 'document' | 'spreadsheet' | 'presentation'

/**
 * How much of the source survives one conversion. `faithful` means the converter carries structure and
 * formatting across; `lossy` means content survives but layout, styling, or structure does not — the
 * honest verdict for every path that leaves PDF, and for any conversion that crosses families. A plan's
 * fidelity is the worst of its steps, so a single lossy hop makes the whole conversion lossy.
 */
export type ConvertFidelity = 'faithful' | 'lossy'

/**
 * One directed conversion a provider declares it can perform. Routes are static per provider: they
 * describe the mechanism's capability, not the current machine (whether the binary exists is
 * {@link DocumentConvertProvider.available}). `priority` breaks ties when several providers declare the
 * same edge — higher wins — and exists so a composition can prefer a structure-preserving converter
 * over a general one without the seam hardcoding vendor knowledge.
 */
export interface ConvertRoute {
  readonly from: DocumentFormat
  readonly to: DocumentFormat
  /** What this specific edge preserves; not a property of the provider as a whole. */
  readonly fidelity: ConvertFidelity
  /** Tie-break rank among providers declaring this same edge; higher wins. */
  readonly priority: number
}

/**
 * One thing that happened to the document which the file itself cannot show.
 *
 * `fidelity` says a route loses something; a note says what. The distinction matters to the only reader
 * that counts: "lossy" tells a model to hedge, while "the CSV export keeps the first sheet's values and
 * drops the other sheets and every formula" tells it what to warn the user about. Notes are facts about
 * the conversion that was performed, not warnings about one that might fail — a condition that makes the
 * result unusable is a {@link ConvertError}, not a note.
 */
export interface ConvertNote {
  /** Stable machine-routable identifier, e.g. `SPREADSHEET_FIRST_SHEET_ONLY`. */
  readonly code: string
  /** One sentence naming the concrete consequence, written for the model that will relay it. */
  readonly message: string
}

/**
 * One backend that converts documents by calling an external mechanism. Registered with
 * `ctx.documentConvert.registerProvider`; `id` is a stable string, unique within the registry.
 *
 * One provider corresponds to one mechanism (in practice one binary), so a vendor shipping two
 * executables registers two providers and a missing second binary costs only its own routes.
 */
export interface DocumentConvertProvider {
  readonly id: string
  /** Every edge this mechanism implements, independent of the current machine. */
  readonly routes: readonly ConvertRoute[]
  /**
   * Whether this provider can run right now. Must be cheap and local — no process spawn, no network.
   * Implementations sample their binary once at plugin apply and return the cached answer.
   */
  available(): boolean
  /**
   * Perform one conversion step, writing exactly `step.outputPath`. Throws {@link ConvertError} when
   * the mechanism fails; honors `signal` for cancellation.
   *
   * The seam verifies the written file afterwards, so a provider reports what it did rather than
   * re-checking it: return the notes describing what this step cost the document, empty when nothing
   * needs saying.
   *
   * @param step - the exact source path, output path, and the formats at both ends.
   * @param signal - optional cancellation signal.
   * @returns notes about what this step did to the document.
   */
  convert(step: ConvertStepSpec, signal?: AbortSignal): Promise<readonly ConvertNote[]>
}

/** One resolved conversion step handed to a provider: both paths and both formats, nothing implicit. */
export interface ConvertStepSpec {
  readonly sourcePath: string
  readonly sourceFormat: DocumentFormat
  readonly outputPath: string
  readonly targetFormat: DocumentFormat
}

/** One planned step: the edge plus the provider that will run it. */
export interface ConvertPlanStep {
  readonly providerId: string
  readonly from: DocumentFormat
  readonly to: DocumentFormat
  readonly fidelity: ConvertFidelity
}

/**
 * A resolved route from source format to target format. One step is a direct conversion; more steps
 * pass through intermediate formats, which is how cross-family targets become reachable at all (a PDF
 * reaches a spreadsheet only as `pdf → txt → xlsx`). `fidelity` is the worst of `steps`.
 */
export interface ConvertPlan {
  readonly steps: readonly ConvertPlanStep[]
  readonly fidelity: ConvertFidelity
}

/**
 * What a caller asks for. Everything except the source path and the target format is optional; the
 * defaults are applied by the explicit {@link DocumentConvertRuntime.resolve} step, never inside
 * execution.
 */
export interface ConvertRequest {
  /** The source document's path in the provider's execution world. */
  readonly sourcePath: string
  /** The format to produce. */
  readonly targetFormat: DocumentFormat
  /** The source's format. Omitted = read it from the source path's extension. */
  readonly sourceFormat?: DocumentFormat
  /** Where to write. Omitted = the source path with the target format's extension. */
  readonly outputPath?: string
}

/** A fully-resolved conversion: every default applied and the route already planned. */
export interface ConvertSpec {
  readonly sourcePath: string
  readonly sourceFormat: DocumentFormat
  readonly outputPath: string
  readonly targetFormat: DocumentFormat
  readonly plan: ConvertPlan
}

/** What one completed conversion produced. */
export interface ConvertOutcome {
  /** The path written, equal to the spec's `outputPath`. */
  readonly outputPath: string
  readonly sourceFormat: DocumentFormat
  readonly targetFormat: DocumentFormat
  /** The executed plan's fidelity — `lossy` when any step was. */
  readonly fidelity: ConvertFidelity
  /** The steps actually executed, in order. */
  readonly steps: readonly ConvertPlanStep[]
  /** Size of the written file in bytes. */
  readonly bytes: number
  /** What the executed steps cost the document, in step order; empty when nothing was lost worth naming. */
  readonly notes: readonly ConvertNote[]
}

/**
 * Typed conversion error with a machine-routable, open-string `code` and chained `cause`. Consumers
 * must tolerate provider-specific codes.
 *
 * The seam owns codes for invalid configuration (`CONVERT_CONFIG_INVALID`, `CONVERT_ROUTE_KEY_INVALID`),
 * unreadable requests (`CONVERT_FORMAT_UNKNOWN`, `CONVERT_SAME_FORMAT`), route resolution
 * (`CONVERT_ROUTE_UNSUPPORTED`, `CONVERT_ROUTE_AMBIGUOUS`, `CONVERT_ROUTE_CONFIGURED_MISSING`), provider
 * state (`CONVERT_DUPLICATE_PROVIDER`, `CONVERT_PROVIDER_UNAVAILABLE`), and execution
 * (`CONVERT_OUTPUT_MISSING`, `CONVERT_OUTPUT_UNUSABLE`, `CONVERT_CANCELLED`). Providers classify their own
 * mechanism failures as `CONVERT_PROVIDER_FAILED` and a source they can see is unconvertible as
 * `CONVERT_SOURCE_DAMAGED` or `CONVERT_SOURCE_SCANNED`; consumers add codes for conditions they own, such
 * as a missing source file. Tool execution exposes the code in structured error metadata.
 */
export class ConvertError extends HarnessError {}
