/**
 * How a `write_official_document` call reads to a model and renders in a UI, plus the argument shape the
 * two share. Everything here is a pure function of the call arguments and the returned value, because the
 * presenters also run on session-log replay, where no service and no filesystem exist.
 * @module @deepseek-ai/dsh-tool-official-document/present
 */

import type { ConvertFidelity, DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import { convertFileMetaFromResult } from '@deepseek-ai/dsh-tool-document-convert'
import type { GenericCallView, GenericResultView, JsonValue, ToolResult } from '@deepseek-ai/dsh-tools'
import type { OfficialDocumentUrgency } from './types.ts'

/**
 * The formats the tool writes. `odt` is the one it produces directly; the rest are reached by converting
 * that `.odt` through `ctx.documentConvert`, so each is limited by what the installed converters can do
 * with an OpenDocument text file.
 */
export const OFFICIAL_DOCUMENT_FORMATS = [
  'docx', 'odt', 'doc', 'rtf', 'pdf', 'html', 'txt',
] as const satisfies readonly DocumentFormat[]

/** One of {@link OFFICIAL_DOCUMENT_FORMATS}. */
export type OfficialDocumentFormat = typeof OFFICIAL_DOCUMENT_FORMATS[number]

/** The format a call gets when it names none and its output path does not imply one. */
export const DEFAULT_OFFICIAL_DOCUMENT_FORMAT: OfficialDocumentFormat = 'docx'

/** One 正文 paragraph as the model passes it (§ 7.3.3). */
export interface OfficialDocumentBodyArg {
  level?: number
  text: string
}

/** 密级和保密期限 as the model passes it (§ 7.2.2). */
export interface OfficialDocumentSecrecyArg {
  level: string
  period?: string
}

/** 印发机关和印发日期 as the model passes it (§ 7.4.3). */
export interface OfficialDocumentPrinterArg {
  agency: string
  date: string
}

/** The `write_official_document` arguments, as validated by the tool registry against the schema. */
export interface OfficialDocumentToolArgs {
  output_path: string
  title: string
  body: OfficialDocumentBodyArg[]
  format?: OfficialDocumentFormat
  issuer?: string
  doc_number?: string
  signer?: string
  main_recipient?: string[]
  copy_number?: number
  secrecy?: OfficialDocumentSecrecyArg
  urgency?: OfficialDocumentUrgency
  attachments?: string[]
  signature?: string
  date?: string
  note?: string
  copy_to?: string[]
  printer?: OfficialDocumentPrinterArg
  overwrite?: boolean
}

/** One statement about the written file that its structured fields do not carry. */
export interface OfficialDocumentOutputNote {
  code: string
  message: string
}

/** The canonical `write_official_document` output value. */
export interface OfficialDocumentOutputValue {
  path: string
  format: OfficialDocumentFormat
  fidelity: ConvertFidelity
  bytes: number
  elements: string[]
  notes: OfficialDocumentOutputNote[]
}

/** The extension of a path, lowercased, or the empty string when it has none. */
function extension(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The format a call will write, from the arguments alone. An explicit `format` wins; otherwise the output
 * path's extension decides, because a model that asked for `通知.pdf` meant a PDF; a path that names no
 * usable extension falls back to {@link DEFAULT_OFFICIAL_DOCUMENT_FORMAT}.
 *
 * The presenters and the execution both read this one function so a card cannot name a different format
 * from the one that gets written.
 * @param args - the call arguments.
 * @returns the format to produce.
 */
export function resolveOfficialDocumentFormat(args: OfficialDocumentToolArgs): OfficialDocumentFormat {
  if (args.format !== undefined) return args.format
  const implied = OFFICIAL_DOCUMENT_FORMATS.find(format => format === extension(args.output_path))
  return implied ?? DEFAULT_OFFICIAL_DOCUMENT_FORMAT
}

/** The final segment of a path, for a title that does not repeat the whole directory. */
function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * The model-facing result text. It states what was written and which GB/T 9704—2012 elements the document
 * carries, then anything the file cannot deliver on this host.
 *
 * The element list is there because the standard makes most elements optional: a model that asked for a
 * 通知 and got one without a 发文字号 should be able to see that from the result rather than reopen the
 * file, and should be able to tell the user which elements are still missing.
 *
 * @param value - the canonical output value.
 * @returns the prose describing the document and its caveats.
 */
export function formatOfficialDocumentOutput(value: OfficialDocumentOutputValue): string {
  const head = `Wrote a GB/T 9704—2012 official document to ${value.path} (${value.format}, ${value.bytes} bytes)`
  const elements = `\nElements laid out: ${value.elements.join('; ')}.`
  if (value.notes.length === 0) return `${head}.${elements}`
  const lines = value.notes.map(note => `- ${note.message}`).join('\n')
  return `${head}.${elements}\nWhat this file does not deliver:\n${lines}`
}

/**
 * Pending-call presentation. The card is an `edit`, which is how a produced file joins the deliverables
 * row a finished turn ends with; `locations` names the file so an editor can follow along.
 *
 * @param args - the call arguments.
 * @returns the generic card shown while the document is written.
 */
export function presentOfficialDocumentCall(args: OfficialDocumentToolArgs): GenericCallView {
  return {
    card: 'generic',
    title: `Write ${args.title} as ${resolveOfficialDocumentFormat(args)}`,
    kind: 'edit',
    rawInput: args.title,
    locations: [{ path: args.output_path }],
  }
}

/**
 * The result's private `tool/result` `meta` payload: what a completed card needs that the arguments do
 * not carry. The path is here rather than read back from the arguments so a card names the file that was
 * actually written, and the fidelity so a UI can mark a converted result without reparsing the prose.
 */
export interface OfficialDocumentMeta {
  /** The path actually written. */
  path: string
  /** Whether the route to the requested format preserved the layout. */
  fidelity: ConvertFidelity
}

/**
 * Project a validated output value into its replayable presentation meta.
 * @param value - the canonical output value.
 * @returns the written path and the route's fidelity, as opaque JSON.
 */
export function officialDocumentMetaFromValue(value: OfficialDocumentOutputValue): JsonValue {
  return { path: value.path, fidelity: value.fidelity }
}

/**
 * Narrow opaque live or replayed result metadata to an {@link OfficialDocumentMeta}. Malformed metadata
 * returns `undefined` so presentation falls back to the generic card instead of throwing during replay.
 * @param meta - result metadata.
 * @returns the validated meta, or undefined for absent or malformed data.
 */
export function officialDocumentMetaFromResult(meta: unknown): OfficialDocumentMeta | undefined {
  return convertFileMetaFromResult(meta)
}

/**
 * Completed-call presentation: the written file's name, marked when the conversion to the requested
 * format was lossy. The card carries no content copy, so a UI renders the model-facing result text
 * beneath it.
 *
 * @param result - the final tool result; `meta` carries the written path and fidelity.
 * @returns the completed card, or `undefined` (generic fallback) on failure or malformed meta.
 */
export function presentOfficialDocumentResult(result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = officialDocumentMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  const suffix = meta.fidelity === 'lossy' ? ' (lossy)' : ''
  return { card: 'generic', title: `${basename(meta.path)}${suffix}` }
}
