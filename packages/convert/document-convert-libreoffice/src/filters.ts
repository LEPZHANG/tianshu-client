/**
 * The LibreOffice conversion table: which `(source, target)` pairs this provider declares, the export
 * filter each one needs, and where content is lost.
 *
 * Every entry here was verified by conversion, not read from documentation: a unique token was placed in
 * a fixture of each source format, the conversion run, and the output searched for that token. That
 * method is not pedantry — `soffice` exits 0 and writes a structurally valid file for several
 * conversions it cannot actually perform. Converting text to `pptx` yields a 2 KB presentation with no
 * slides; converting text or a Writer document to `odp` yields an ODF *text* document carrying a `.odp`
 * name; converting a PDF to `odt` yields an ODF *graphics* document carrying a `.odt` name. None of
 * those appear below. Extend this table the same way, and reject any candidate whose output does not
 * carry the source's content in a file of the target's actual type.
 *
 * The explicit `<ext>:<filter>` spelling is required, not cosmetic. A bare `--convert-to docx` fails
 * with "no export filter" for an HTML source, while naming the filter succeeds on the same input.
 * @module @deepseek-ai/dsh-document-convert-libreoffice/filters
 */

import type { ConvertFidelity, ConvertNote, DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import { routeKey } from '@deepseek-ai/dsh-document-convert'

/** How LibreOffice performs one conversion, and what it costs. */
export interface LibreOfficeConversion {
  /** The LibreOffice export filter name, passed as the `<ext>:<filter>` suffix. */
  readonly exportFilter: string
  /** An `--infilter` that forces how the source is interpreted; only the spreadsheet bridge needs one. */
  readonly importFilter?: string
  /** What this specific conversion preserves. */
  readonly fidelity: ConvertFidelity
  /**
   * What this edge always costs the document, reported with every conversion that takes it.
   *
   * A caveat belongs to the edge rather than to the file because it follows from the export filter, not
   * from the document: the CSV filter writes one sheet whatever the workbook holds. Edges that preserve
   * the document have none — a `lossy` edge without a caveat would be the seam saying "something was
   * lost" and declining to say what.
   */
  readonly caveat?: ConvertNote
}

/** One target's filter and cost, shared by every source in a family. */
type TargetTable = Readonly<Partial<Record<DocumentFormat, Omit<LibreOfficeConversion, 'importFilter'>>>>

/**
 * Writer targets. These filters serve an HTML source as well as a Writer one: a document loaded as
 * Writer/Web exports through the same names, so the family needs no separate Writer/Web column.
 */
const WRITER_TARGETS: TargetTable = {
  pdf: { exportFilter: 'writer_pdf_Export', fidelity: 'faithful' },
  doc: { exportFilter: 'MS Word 97', fidelity: 'faithful' },
  docx: { exportFilter: 'Office Open XML Text', fidelity: 'faithful' },
  odt: { exportFilter: 'writer8', fidelity: 'faithful' },
  rtf: { exportFilter: 'Rich Text Format', fidelity: 'faithful' },
  html: { exportFilter: 'HTML (StarWriter)', fidelity: 'faithful' },
  // Plain text keeps the characters and nothing else.
  txt: {
    exportFilter: 'Text',
    fidelity: 'lossy',
    caveat: {
      code: 'TEXT_ONLY',
      message: 'Plain text keeps the words only: headings, tables, images, footnotes, and all formatting '
        + 'are gone, and a table becomes undelimited lines of text.',
    },
  },
}

/** Calc targets. The text export is CSV: one sheet, values only, no formulas or formatting. */
const CALC_TARGETS: TargetTable = {
  pdf: { exportFilter: 'calc_pdf_Export', fidelity: 'faithful' },
  xls: { exportFilter: 'MS Excel 97', fidelity: 'faithful' },
  xlsx: { exportFilter: 'Calc Office Open XML', fidelity: 'faithful' },
  ods: { exportFilter: 'calc8', fidelity: 'faithful' },
  html: { exportFilter: 'HTML (StarCalc)', fidelity: 'faithful' },
  txt: {
    exportFilter: 'Text - txt - csv (StarCalc)',
    fidelity: 'lossy',
    caveat: {
      code: 'SPREADSHEET_FIRST_SHEET_ONLY',
      message: 'The text export is CSV: it holds the first sheet only, as the values shown at export time. '
        + 'Any other sheets are absent, and every formula was replaced by its result.',
    },
  },
}

/**
 * Impress targets. HTML is deliberately absent: the XHTML export carries slide text only from a native
 * Impress document, and silently drops it from an imported `ppt`/`pptx`. `odp -> html` is declared
 * separately below, so `ppt`/`pptx` reach HTML through `odp` as a two-step plan instead of through a
 * route that works for one source format and quietly fails for the others.
 */
const IMPRESS_TARGETS: TargetTable = {
  pdf: { exportFilter: 'impress_pdf_Export', fidelity: 'faithful' },
  ppt: { exportFilter: 'MS PowerPoint 97', fidelity: 'faithful' },
  pptx: { exportFilter: 'Impress Office Open XML', fidelity: 'faithful' },
  odp: { exportFilter: 'impress8', fidelity: 'faithful' },
}

const WRITER_SOURCES: readonly DocumentFormat[] = ['doc', 'docx', 'odt', 'rtf', 'txt', 'html']
const CALC_SOURCES: readonly DocumentFormat[] = ['xls', 'xlsx', 'ods']
const IMPRESS_SOURCES: readonly DocumentFormat[] = ['ppt', 'pptx', 'odp']

/**
 * The `--infilter` that makes Calc read a text file as delimited data: comma separator (44), double
 * quote as the text delimiter (34), UTF-8 (76), starting at row 1.
 */
const CSV_IMPORT_FILTER = 'Text - txt - csv (StarCalc):44,34,76,1'

/** What forcing the CSV import filter does to text that was never a table. */
const CSV_IMPORT_CAVEAT: ConvertNote = {
  code: 'TEXT_READ_AS_CSV',
  message: 'The text file was read as comma-separated data: each line became a row, split at commas. '
    + 'Prose lands in a single column, and a line containing commas is split across cells.',
}

/**
 * Conversions that do not follow from a family table.
 *
 * The three `txt` bridges are the only way a document-family file reaches the spreadsheet family at all,
 * and they are lossy by construction: forcing the CSV import filter reinterprets the text as delimited
 * data, so prose becomes a single column. `pdf -> html` is LibreOffice's Draw import followed by its
 * HTML export — it recovers the text and discards the layout, which is the most any Draw-mediated PDF
 * route achieves here.
 */
const EXTRA_CONVERSIONS: readonly (readonly [DocumentFormat, DocumentFormat, LibreOfficeConversion])[] = [
  ['txt', 'ods', { exportFilter: 'calc8', importFilter: CSV_IMPORT_FILTER, fidelity: 'lossy', caveat: CSV_IMPORT_CAVEAT }],
  ['txt', 'xlsx', { exportFilter: 'Calc Office Open XML', importFilter: CSV_IMPORT_FILTER, fidelity: 'lossy', caveat: CSV_IMPORT_CAVEAT }],
  ['txt', 'xls', { exportFilter: 'MS Excel 97', importFilter: CSV_IMPORT_FILTER, fidelity: 'lossy', caveat: CSV_IMPORT_CAVEAT }],
  ['odp', 'html', {
    exportFilter: 'XHTML Impress File',
    fidelity: 'lossy',
    caveat: {
      code: 'SLIDES_FLATTENED',
      message: 'The slides became one flat page: slide boundaries, layouts, transitions, animations, and '
        + 'speaker notes are gone.',
    },
  }],
  ['pdf', 'html', {
    exportFilter: 'draw_html_Export',
    fidelity: 'lossy',
    caveat: {
      code: 'PDF_CANVAS_RECOVERED',
      message: 'The PDF was read as a page canvas, so the result carries the text that was positioned on '
        + 'each page but none of the original headings, tables, lists, or reading order.',
    },
  }],
]

/** Expand one family's sources against its target table, skipping the identity pair. */
function expandFamily(
  sources: readonly DocumentFormat[],
  targets: TargetTable,
  into: Map<string, LibreOfficeConversion>,
): void {
  for (const from of sources) {
    for (const [to, conversion] of Object.entries(targets) as [DocumentFormat, Omit<LibreOfficeConversion, 'importFilter'>][]) {
      if (from === to) continue
      into.set(routeKey(from, to), conversion)
    }
  }
}

/** Every conversion this provider performs, keyed by `<from>-><to>`. */
export const LIBREOFFICE_CONVERSIONS: ReadonlyMap<string, LibreOfficeConversion> = (() => {
  const table = new Map<string, LibreOfficeConversion>()
  expandFamily(WRITER_SOURCES, WRITER_TARGETS, table)
  expandFamily(CALC_SOURCES, CALC_TARGETS, table)
  expandFamily(IMPRESS_SOURCES, IMPRESS_TARGETS, table)
  for (const [from, to, conversion] of EXTRA_CONVERSIONS) table.set(routeKey(from, to), conversion)
  return table
})()

/**
 * The conversion LibreOffice performs for one pair, or `undefined` when it performs none.
 * @param from - the source format.
 * @param to - the target format.
 * @returns the filters and fidelity for that pair.
 */
export function libreOfficeConversion(from: DocumentFormat, to: DocumentFormat): LibreOfficeConversion | undefined {
  return LIBREOFFICE_CONVERSIONS.get(routeKey(from, to))
}
