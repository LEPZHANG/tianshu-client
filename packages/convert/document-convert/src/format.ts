/**
 * The format vocabulary's path side: which extensions name which {@link DocumentFormat}, which family a
 * format belongs to, and how a target path is derived from a source path. Pure string functions with no
 * filesystem or platform coupling — they accept both POSIX and Windows separators — so the conversion
 * tool's presenters can call them on a replay path where no service exists.
 * @module @deepseek-ai/dsh-document-convert/format
 */

import type { DocumentFamily, DocumentFormat } from './types.ts'

/**
 * Every format this seam names, in the order the model-facing tool lists them: the document family,
 * then the spreadsheet family, then the presentation family, with `pdf` leading as the shared target.
 */
export const DOCUMENT_FORMATS: readonly DocumentFormat[] = [
  'pdf',
  'doc', 'docx', 'odt', 'rtf', 'txt', 'html',
  'xls', 'xlsx', 'ods',
  'ppt', 'pptx', 'odp',
]

/**
 * Extensions that name a format, including the spellings that are not the canonical id. Only `html` has
 * an alias (`htm`); every other format's extension equals its id.
 */
const EXTENSION_FORMATS: ReadonlyMap<string, DocumentFormat> = new Map<string, DocumentFormat>([
  ...DOCUMENT_FORMATS.map(format => [format, format] as const),
  ['htm', 'html'],
])

/**
 * The family each format belongs to. `pdf` is deliberately absent: it is the shared rendering target of
 * all three families and belongs to none, so callers that need a family for a PDF end of a route derive
 * it from the other end.
 */
const FORMAT_FAMILIES: ReadonlyMap<DocumentFormat, DocumentFamily> = new Map<DocumentFormat, DocumentFamily>([
  ['doc', 'document'], ['docx', 'document'], ['odt', 'document'],
  ['rtf', 'document'], ['txt', 'document'], ['html', 'document'],
  ['xls', 'spreadsheet'], ['xlsx', 'spreadsheet'], ['ods', 'spreadsheet'],
  ['ppt', 'presentation'], ['pptx', 'presentation'], ['odp', 'presentation'],
])

/**
 * The family a format belongs to, or `undefined` for `pdf`.
 * @param format - the format to classify.
 * @returns its editor family, or undefined when the format has none.
 */
export function formatFamily(format: DocumentFormat): DocumentFamily | undefined {
  return FORMAT_FAMILIES.get(format)
}

/**
 * Index just past the last path separator, handling both separators so a Windows path parses on a POSIX
 * host and the reverse. Returns 0 for a path with no separator.
 */
function lastSegmentStart(path: string): number {
  const posix = path.lastIndexOf('/')
  const windows = path.lastIndexOf('\\')
  return Math.max(posix, windows) + 1
}

/**
 * Index of the extension dot in a path, or -1 when the final segment has no extension. A leading dot
 * makes a dotfile, not an extension (`.gitignore` has none), and a dot in a directory name never counts.
 */
function extensionDot(path: string): number {
  const start = lastSegmentStart(path)
  const dot = path.lastIndexOf('.')
  return dot > start ? dot : -1
}

/**
 * The format a path's extension names.
 * @param path - the file path to read; only its final segment's extension is considered.
 * @returns the named format, or `undefined` when the path has no extension or names something this seam
 *   does not convert.
 */
export function detectFormat(path: string): DocumentFormat | undefined {
  const dot = extensionDot(path)
  if (dot === -1) return undefined
  return EXTENSION_FORMATS.get(path.slice(dot + 1).toLowerCase())
}

/**
 * The output path a conversion writes when the caller names none: the source path with the target
 * format's extension, so the result lands beside its source under the same name. A source with no
 * extension gains one rather than losing its final segment.
 *
 * Exported because `resolve()` and the conversion tool's pure call-time presenter must derive the same
 * path from the same inputs — the presenter runs on session-log replay where no service exists.
 *
 * @param sourcePath - the source document's path.
 * @param targetFormat - the format being produced.
 * @returns the derived output path.
 */
export function defaultOutputPath(sourcePath: string, targetFormat: DocumentFormat): string {
  const dot = extensionDot(sourcePath)
  const stem = dot === -1 ? sourcePath : sourcePath.slice(0, dot)
  return `${stem}.${targetFormat}`
}
