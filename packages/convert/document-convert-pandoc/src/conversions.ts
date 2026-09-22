/**
 * Which conversions pandoc performs, how it names each end, and what each one costs the document.
 *
 * pandoc converts through its own document model rather than by translating one file format directly
 * into another, and that is the whole reason this package exists: LibreOffice's HTML export writes a
 * flat run of absolutely positioned `<p>` elements, while pandoc's writes back the headings, lists, and
 * tables it read. The same mechanism is also what it costs — anything outside that model is gone, so
 * the office-to-office edges declare `lossy` and LibreOffice keeps them wherever both are installed.
 * @module @deepseek-ai/dsh-document-convert-pandoc/conversions
 */

import type { ConvertFidelity, ConvertNote, DocumentFormat } from '@deepseek-ai/dsh-document-convert'

/**
 * The formats pandoc reads, and the reader name it knows each one by. Deliberately smaller than the
 * seam's vocabulary: pandoc has no reader for the binary office formats beyond these, and none at all
 * for `txt` — plain text carries no structure to recover, so LibreOffice keeps every `txt →` edge.
 */
export const PANDOC_READERS = {
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  html: 'html',
} as const satisfies Partial<Record<DocumentFormat, string>>

/**
 * The formats pandoc writes, and the writer name it knows each one by. `pdf` is absent because pandoc
 * reaches it only through an external LaTeX engine, which is a separate dependency chain and a
 * different provider; `pptx` is absent because pandoc's presentation writer invents a slide per heading,
 * which produces a new document rather than a conversion of the one it was given.
 */
export const PANDOC_WRITERS = {
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  html: 'html',
  txt: 'plain',
} as const satisfies Partial<Record<DocumentFormat, string>>

/** A format pandoc can convert from. */
export type PandocSourceFormat = keyof typeof PANDOC_READERS

/** A format pandoc can convert to. */
export type PandocTargetFormat = keyof typeof PANDOC_WRITERS

/**
 * One edge pandoc implements, with everything the provider needs to run it and everything the model
 * needs to be told about the result.
 */
export interface PandocConversion {
  readonly from: PandocSourceFormat
  readonly to: PandocTargetFormat
  /** The `--from` value. */
  readonly reader: string
  /** The `--to` value. */
  readonly writer: string
  /** What this edge preserves, which decides whether LibreOffice outranks it. */
  readonly fidelity: ConvertFidelity
  /** The concrete consequence this edge always has, reported with every conversion that uses it. */
  readonly caveat: ConvertNote
  /** Arguments this edge adds, after the reader, writer, and `--standalone` every invocation carries. */
  readonly flags: readonly string[]
}

/** What each kind of edge costs, written for the model that will relay it to a person. */
const CAVEATS = {
  PLAIN_TEXT_ONLY: {
    code: 'PLAIN_TEXT_ONLY',
    message: 'Plain text keeps the words, the paragraph breaks, and tables as aligned columns of '
      + 'characters. Headings survive only as their own lines, and images, links, and every kind of '
      + 'styling are gone.',
  },
  HTML_REFLOWS: {
    code: 'HTML_REFLOWS',
    message: 'An HTML page reflows to its reader\'s window instead of paginating, so page size, margins, '
      + 'page breaks, headers, and footers have no equivalent and were dropped. Headings, lists, tables, '
      + 'links, and inline styling were carried over, and images are embedded in the file itself.',
  },
  PAGE_SETUP_DEFAULTED: {
    code: 'PAGE_SETUP_DEFAULTED',
    message: 'An HTML page declares no page geometry, so the result was laid out with the converter\'s '
      + 'default page size, margins, and fonts rather than any taken from the source.',
  },
  DOCUMENT_MODEL_REBUILD: {
    code: 'DOCUMENT_MODEL_REBUILD',
    message: 'The document was rebuilt from its structure rather than re-encoded, so headings, lists, '
      + 'tables, footnotes, and inline styling survive while page setup, fonts, section layout, '
      + 'comments, tracked changes, and embedded charts do not.',
  },
} as const satisfies Record<string, ConvertNote>

/**
 * Whether an edge preserves enough to call itself faithful. Reaching or leaving HTML is what pandoc is
 * here for, so those edges are `faithful`; plain text discards everything but the words; and an
 * office-to-office edge is `lossy` because rebuilding a `.docx` from a document model loses what
 * LibreOffice, which round-trips the file formats themselves, keeps. That declaration is what makes
 * LibreOffice win those edges on a machine carrying both, without either package knowing about the
 * other.
 */
function fidelityOf(from: PandocSourceFormat, to: PandocTargetFormat): ConvertFidelity {
  if (to === 'txt') return 'lossy'
  return from === 'html' || to === 'html' ? 'faithful' : 'lossy'
}

/** The one consequence worth stating for an edge; every edge has exactly one. */
function caveatOf(from: PandocSourceFormat, to: PandocTargetFormat): ConvertNote {
  if (to === 'txt') return CAVEATS.PLAIN_TEXT_ONLY
  if (to === 'html') return CAVEATS.HTML_REFLOWS
  if (from === 'html') return CAVEATS.PAGE_SETUP_DEFAULTED
  return CAVEATS.DOCUMENT_MODEL_REBUILD
}

/**
 * Arguments one edge adds. An HTML target takes `--embed-resources` so that images become data URIs
 * inside the page: every provider must write exactly one file, and without it pandoc leaves the images
 * as references to paths that will not exist beside the output.
 */
function flagsOf(to: PandocTargetFormat): readonly string[] {
  return to === 'html' ? ['--embed-resources'] : []
}

/**
 * Every edge pandoc implements: each readable format to every writable one except itself. A provider
 * filters this to what the installed pandoc actually reports, so the table describes the tool rather
 * than the machine.
 */
export const PANDOC_CONVERSIONS: readonly PandocConversion[] = Object.entries(PANDOC_READERS)
  .flatMap(([from, reader]) => Object.entries(PANDOC_WRITERS)
    .filter(([to]) => to !== from)
    .map(([to, writer]) => ({
      from: from as PandocSourceFormat,
      to: to as PandocTargetFormat,
      reader,
      writer,
      fidelity: fidelityOf(from as PandocSourceFormat, to as PandocTargetFormat),
      caveat: caveatOf(from as PandocSourceFormat, to as PandocTargetFormat),
      flags: flagsOf(to as PandocTargetFormat),
    })))
