/**
 * How a `convert_document` call reads to a model and renders in a UI. Everything here is a pure function
 * of the call arguments and the returned value, because the presenters also run on session-log replay,
 * where no service and no filesystem exist.
 * @module @deepseek-ai/dsh-tool-document-convert/present
 */

import { defaultOutputPath } from '@deepseek-ai/dsh-document-convert'
import type { ConvertFidelity, DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import type { GenericCallView, GenericResultView, JsonValue, ToolResult } from '@deepseek-ai/dsh-tools'
import { convertFileMetaFromResult } from './policy.ts'

/** The `convert_document` arguments, as validated by the tool registry against the declared schema. */
export interface ConvertToolArgs {
  path: string
  to: DocumentFormat
  output_path?: string
  overwrite?: boolean
}

/** One executed step in the canonical output value. */
export interface ConvertOutputStep {
  from: DocumentFormat
  to: DocumentFormat
  provider: string
}

/** One statement of what the executed route cost the document. */
export interface ConvertOutputNote {
  code: string
  message: string
}

/** The canonical `convert_document` output value. */
export interface ConvertOutputValue {
  path: string
  from: DocumentFormat
  to: DocumentFormat
  fidelity: ConvertFidelity
  steps: ConvertOutputStep[]
  bytes: number
  notes: ConvertOutputNote[]
}

/**
 * The output path a call will write, derived from the arguments alone. The tool's execution resolves the
 * same expression through the filesystem; the presenters cannot, so both read this one function.
 * @param args - the call arguments.
 * @returns the path the call names, or the one it derives beside the source.
 */
export function plannedOutputPath(args: ConvertToolArgs): string {
  return args.output_path ?? defaultOutputPath(args.path, args.to)
}

/** The final segment of a path, for a title that does not repeat the whole directory. */
function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * The model-facing result text. It states what was written and by what route, then what the route cost
 * the document — a model that hands the user a converted file needs to know what is no longer in it, and
 * the structured `fidelity` field alone would neither reach a reader nor say what was lost.
 *
 * The notes carry the specifics (one sheet only, slides flattened, text without structure). A lossy route
 * that reported none still gets a general warning rather than silence.
 *
 * @param value - the canonical output value.
 * @returns the prose describing the conversion and its cost.
 */
export function formatConvertOutput(value: ConvertOutputValue): string {
  const route = value.steps.map(step => step.provider).join(' → ')
  const head = `Converted ${value.from} to ${value.to}: ${value.path} (${value.bytes} bytes, via ${route})`
  const through = value.steps.length > 1
    ? `\nThe conversion passed through ${value.steps.map(step => step.to).slice(0, -1).join(', ')}.`
    : ''
  if (value.notes.length > 0) {
    const lines = value.notes.map(note => `- ${note.message}`).join('\n')
    return `${head}${through}\nWhat this conversion did not carry over:\n${lines}`
  }
  if (value.fidelity === 'faithful') return `${head}${through}`
  return `${head}${through}\nThis route is lossy: the text carried over but layout, styling, and structure did not.`
}

/**
 * Pending-call presentation. The card is an `edit`, which is how a produced file joins the deliverables
 * row a finished turn ends with; `locations` names the file so an editor can follow along.
 *
 * @param args - the call arguments.
 * @returns the generic card shown while the conversion runs.
 */
export function presentConvertCall(args: ConvertToolArgs): GenericCallView {
  const output = plannedOutputPath(args)
  return {
    card: 'generic',
    title: `Convert ${basename(args.path)} to ${args.to}`,
    kind: 'edit',
    rawInput: args.path,
    locations: [{ path: output }],
  }
}

/**
 * The `convert_document` result's private `tool/result` `meta` payload: the facts a completed card needs
 * that the arguments do not carry. The output path is here because a call that named none had it derived,
 * and the fidelity because a UI should mark a lossy result without reparsing the prose.
 */
export interface ConvertMeta {
  /** The path actually written. */
  path: string
  /** Whether the executed route preserved the source. */
  fidelity: ConvertFidelity
}

/**
 * Project a validated output value into its replayable presentation meta.
 * @param value - the canonical output value.
 * @returns the written path and the route's fidelity, as opaque JSON.
 */
export function convertMetaFromValue(value: ConvertOutputValue): JsonValue {
  return { path: value.path, fidelity: value.fidelity }
}

/**
 * Narrow opaque live or replayed result metadata to a {@link ConvertMeta}. Malformed metadata returns
 * `undefined` so presentation falls back to the generic card instead of throwing during replay.
 * @param meta - result metadata.
 * @returns the validated meta, or undefined for absent or malformed data.
 */
export function convertMetaFromResult(meta: unknown): ConvertMeta | undefined {
  return convertFileMetaFromResult(meta)
}

/**
 * Completed-call presentation: the written file's name, marked when the route was lossy. The card carries
 * no content copy, so a UI renders the model-facing result text beneath it.
 *
 * @param result - the final tool result; `meta` carries the written path and fidelity.
 * @returns the completed card, or `undefined` (generic fallback) on failure or malformed meta.
 */
export function presentConvertResult(result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = convertMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  const suffix = meta.fidelity === 'lossy' ? ' (lossy)' : ''
  return { card: 'generic', title: `${basename(meta.path)}${suffix}` }
}
