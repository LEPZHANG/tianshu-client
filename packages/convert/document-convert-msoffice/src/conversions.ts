/**
 * The conversions Microsoft Office and WPS declare, by document family.
 *
 * The table is deliberately narrower than what the applications can technically do. Three groups of
 * edges are excluded, and each exclusion is what keeps a higher-priority provider from taking a route it
 * would serve worse than the provider already there:
 *
 * - **OpenDocument (`odt`, `ods`, `odp`), as source and as target.** Word's ODF import is a conversion,
 *   not a read: it re-flows the document against its own layout engine. The official-document tool
 *   assembles GB/T 9704—2012 pages as ODF and hands that file to this seam, so an Office `odt` edge
 *   would silently re-lay-out exactly the documents whose layout is the point. Every ODF edge stays with
 *   LibreOffice, which is the format's reference implementation.
 * - **`html`, as source and as target.** Word's HTML export carries Office-specific markup that no other
 *   consumer wants. As a *source* it is worse: Word resolves `<img src="http://…">` when it opens the
 *   document, which on an offline machine is a stall with no diagnostic. pandoc is installed for this
 *   edge and is better at it.
 * - **`txt` as a target.** Word's `wdFormatUnicodeText` writes UTF-16, and Excel's UTF-8 CSV member
 *   requires Office 2016 or later — falling back to `xlCSV` writes the system ANSI code page, which
 *   turns Chinese into mojibake. LibreOffice's text export is UTF-8 for every family, so the edge stays
 *   there. `txt` is still accepted as a *source*, where Office reads it with an explicit UTF-8 encoding.
 *
 * Everything that remains is a conversion the application performs natively, on the format it owns, so
 * every edge is `faithful` and none carries a caveat — with one addition. Microsoft Word 2013 and later
 * open a PDF by reconstructing it as a Word document (PDF Reflow): paragraphs, headings, tables, and
 * images become Word's own objects rather than positioned frames. That is the only PDF import that yields
 * an editable document, so Word declares `pdf` as a document-family source, `lossy` with
 * {@link PDF_REFLOW_CAVEAT}. WPS Writer does not: whether its object model opens a PDF at all is
 * unverified, and a route that fails on every WPS machine would outrank LibreOffice's working one.
 * @module @deepseek-ai/dsh-document-convert-msoffice/conversions
 */

import type {
  ConvertNote, ConvertRoute, DocumentFamily, DocumentFormat,
} from '@deepseek-ai/dsh-document-convert'
import type { OfficeEngine } from './programs.ts'

/** The formats one family's application reads and writes. */
export interface OfficeConversions {
  /** Formats the application opens. */
  readonly sources: readonly DocumentFormat[]
  /** Formats the application writes. */
  readonly targets: readonly DocumentFormat[]
}

/**
 * Each family's readable and writable formats.
 *
 * `txt` appears only among the document family's sources, which is what makes `txt -> pdf` an Office
 * route while `docx -> txt` is not.
 */
export const OFFICE_CONVERSIONS: Readonly<Record<DocumentFamily, OfficeConversions>> = {
  document: { sources: ['doc', 'docx', 'rtf', 'txt'], targets: ['pdf', 'doc', 'docx', 'rtf'] },
  spreadsheet: { sources: ['xls', 'xlsx'], targets: ['pdf', 'xls', 'xlsx'] },
  presentation: { sources: ['ppt', 'pptx'], targets: ['pdf', 'ppt', 'pptx'] },
}

/**
 * The formats Microsoft Word writes from a PDF it has reflowed: the document family's own formats, since
 * the PDF-to-PDF identity is not a conversion.
 */
export const PDF_REFLOW_TARGETS: readonly DocumentFormat[] = ['doc', 'docx', 'rtf']

/** The note every reflowed PDF carries, because the reconstruction is Word's estimate of the layout. */
export const PDF_REFLOW_CAVEAT: ConvertNote = {
  code: 'PDF_REFLOWED_BY_WORD',
  message: 'Word rebuilt the PDF as an editable document: paragraphs, headings, tables, and images are '
    + 'real Word objects, but it reconstructs them from the page, so line breaks, table borders, and '
    + 'spacing can differ from the original and a complex page may come out with text boxes. Check the '
    + 'tables and any diagrams before relying on the file.',
}

/**
 * Every route one application declares: its family's sources crossed with its targets, less the
 * identity pairs, plus the reflow routes when the application is Microsoft Word.
 * @param family - the document family.
 * @param priority - the tie-break rank to stamp on each route.
 * @param engine - the suite supplying the application; only Microsoft Office reflows PDF.
 * @returns the routes; `faithful` except the `pdf` sources.
 */
export function officeRoutes(
  family: DocumentFamily,
  priority: number,
  engine: OfficeEngine,
): readonly ConvertRoute[] {
  const conversions = OFFICE_CONVERSIONS[family]
  const routes: ConvertRoute[] = []
  for (const from of conversions.sources) {
    for (const to of conversions.targets) {
      if (from === to) continue
      routes.push({ from, to, fidelity: 'faithful', priority })
    }
  }
  if (family === 'document' && engine === 'msoffice') {
    for (const to of PDF_REFLOW_TARGETS) routes.push({ from: 'pdf', to, fidelity: 'lossy', priority })
  }
  return routes
}
