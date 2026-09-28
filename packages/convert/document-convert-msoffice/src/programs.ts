/**
 * The six Office applications this package drives, and the COM dialect each one speaks.
 *
 * Word, Excel, and PowerPoint expose no `soffice --convert-to` equivalent: automation is the only
 * conversion interface they have, so every route here is a PowerShell script against the application's
 * COM object model. The three object models are close enough to look interchangeable and different
 * enough that sharing one code path would be wrong in ways that only appear on a user's machine —
 * PowerPoint refuses `Visible = $false`, spells `DisplayAlerts` as `ppAlertsNone = 1` rather than `0`,
 * and cannot write PDF through `SaveAs` in Excel's case. Those differences are the fields below.
 *
 * WPS Office reimplements the same object models under its own ProgIDs. Its export method names and
 * format constants are taken to be the ones it documents as Office-compatible and are NOT verified
 * against a real installation; a wrong name surfaces as a `CONVERT_PROVIDER_FAILED` carrying the COM
 * error text, which names the method that does not exist.
 * @module @deepseek-ai/dsh-document-convert-msoffice/programs
 */

import type { DocumentFamily, DocumentFormat } from '@deepseek-ai/dsh-document-convert'

/** Which suite supplies an application: Microsoft Office, or WPS Office's compatible object model. */
export type OfficeEngine = 'msoffice' | 'wps'

/**
 * How one application is driven over COM. Every member is a PowerShell fragment spliced into the
 * conversion script, which is why they are strings rather than structured values: the script is the
 * unit that runs, and keeping the dialect as its fragments makes the generated script readable in a
 * test failure.
 */
export interface OfficeDialect {
  /**
   * Statements configuring the application, applied only when this conversion started the process.
   * Attaching to an application the user already has open must not hide their window or silence the
   * alerts they rely on.
   */
  readonly instanceSettings: readonly string[]
  /**
   * The expression opening `$source`, assigned to `$doc`.
   * @param sourceFormat - the source's format, which selects Word's plain-text import parameters.
   * @returns the PowerShell expression.
   */
  open(sourceFormat: DocumentFormat): string
  /**
   * The statement writing `$doc` to `$output`.
   * @param targetFormat - the format to write; must be a key of {@link OfficeDialect.formats}.
   * @returns the PowerShell statement.
   */
  save(targetFormat: DocumentFormat): string
  /** The statement closing `$doc` without saving it again. */
  readonly close: string
  /** The formats this dialect can write, mapped to the application's own format constant. */
  readonly formats: Readonly<Partial<Record<DocumentFormat, number>>>
}

/** One application of one suite: what to create, how to recognize it, and how to drive it. */
export interface OfficeProgram {
  /** The provider id this application registers under. */
  readonly id: string
  readonly engine: OfficeEngine
  /** The document family this application owns, which selects its route table. */
  readonly family: DocumentFamily
  /** The COM ProgID instantiated to reach it. */
  readonly progId: string
  /**
   * Lowercase basename of the executable the ProgID's `LocalServer32` must name. A WPS installation
   * routinely takes over `Word.Application`, and the conversion seam checks only the output file's
   * type, so this is the one thing that distinguishes the suite that will actually run.
   */
  readonly server: string
  readonly dialect: OfficeDialect
}

/** Word's `WdSaveFormat` members for the formats this package writes. */
const WORD_FORMATS = { pdf: 17, doc: 0, docx: 16, rtf: 6 } as const

/** Excel's `XlFileFormat` members. PDF is absent because Excel writes it through a different method. */
const EXCEL_FORMATS = { pdf: 0, xls: -4143, xlsx: 51 } as const

/** PowerPoint's `PpSaveAsFileType` members. */
const POWERPOINT_FORMATS = { pdf: 32, ppt: 1, pptx: 24 } as const

/** `wdOpenFormatEncodedText`, paired with an explicit encoding so a UTF-8 source is read as UTF-8. */
const WD_OPEN_FORMAT_ENCODED_TEXT = 5

/** The `Encoding` argument for a plain-text source: UTF-8. */
const UTF8_CODE_PAGE = 65_001

/**
 * Word and WPS Writer.
 *
 * `Documents.Open` is called positionally: `ConfirmConversions = $false` suppresses the format
 * confirmation prompt, `ReadOnly = $true` avoids taking a write lock on the caller's source and keeps
 * Protected View from opening the document for editing, and `AddToRecentFiles = $false` keeps a
 * conversion out of the user's recent-documents list.
 *
 * A plain-text source needs six more positional arguments to reach `Format` and `Encoding`. Without
 * them Word guesses the code page from the bytes and renders UTF-8 Chinese as mojibake — the conversion
 * succeeds and the text is wrong, which is the failure mode worth six arguments to avoid.
 * @param saveMethod - the save method name: Word 2010 and later add `SaveAs2`, WPS Writer exposes `SaveAs`.
 * @returns the dialect.
 */
function writerDialect(saveMethod: string): OfficeDialect {
  return {
    instanceSettings: ['$app.Visible = $false', '$app.DisplayAlerts = 0'],
    open: sourceFormat => sourceFormat === 'txt'
      ? '$app.Documents.Open($source, $false, $true, $false, \'\', \'\', $false, \'\', \'\', '
        + `${WD_OPEN_FORMAT_ENCODED_TEXT}, ${UTF8_CODE_PAGE})`
      : '$app.Documents.Open($source, $false, $true, $false)',
    save: targetFormat => `$doc.${saveMethod}($output, ${formatConstant(WORD_FORMATS, targetFormat)})`,
    // `wdDoNotSaveChanges`: read-only opening should make this moot, and an explicit refusal keeps a
    // failed conversion from blocking on a save prompt that nothing can answer.
    close: '$doc.Close(0)',
    formats: WORD_FORMATS,
  }
}

/**
 * Excel and WPS Spreadsheets.
 *
 * `SaveAs` has no PDF member — `XlFileFormat` does not contain one — so PDF goes through
 * `ExportAsFixedFormat(xlTypePDF, path)` instead. That is the reason this dialect's `save` branches on
 * the target rather than being one call with a varying constant.
 *
 * `Workbooks.Open($source, 0, $true)` passes `UpdateLinks = 0`: a workbook with external references
 * must not reach for them, which on an offline machine is a stall rather than an error.
 * @returns the dialect.
 */
function spreadsheetDialect(): OfficeDialect {
  return {
    instanceSettings: ['$app.Visible = $false', '$app.DisplayAlerts = $false'],
    open: () => '$app.Workbooks.Open($source, 0, $true)',
    save: targetFormat => targetFormat === 'pdf'
      ? `$doc.ExportAsFixedFormat(${EXCEL_FORMATS.pdf}, $output)`
      : `$doc.SaveAs($output, ${formatConstant(EXCEL_FORMATS, targetFormat)})`,
    close: '$doc.Close($false)',
    formats: EXCEL_FORMATS,
  }
}

/**
 * PowerPoint and WPS Presentation.
 *
 * Two departures from the other two dialects, both forced by the application. PowerPoint rejects
 * `Application.Visible = $false` and is driven headless by opening the presentation with
 * `WithWindow = msoFalse` instead. Its `DisplayAlerts` takes `PpAlertLevel`, whose "no alerts" member is
 * `ppAlertsNone = 1`; the `0` that silences Word would be `ppAlertsUndefined`.
 *
 * `Presentations.Open` takes `MsoTriState`, so the arguments are `-1`/`0` rather than `$true`/`$false`:
 * `ReadOnly = msoTrue`, `Untitled = msoFalse` (keep the source path, which `SaveAs` does not depend on
 * but a diagnostic dialog would show), `WithWindow = msoFalse`.
 * @returns the dialect.
 */
function presentationDialect(): OfficeDialect {
  return {
    instanceSettings: ['$app.DisplayAlerts = 1'],
    open: () => '$app.Presentations.Open($source, -1, 0, 0)',
    save: targetFormat => `$doc.SaveAs($output, ${formatConstant(POWERPOINT_FORMATS, targetFormat)})`,
    close: '$doc.Close()',
    formats: POWERPOINT_FORMATS,
  }
}

/**
 * One application's format constant for a target it writes.
 * @param formats - the application's format table.
 * @param targetFormat - the format to write.
 * @returns the application's own constant for it.
 * @throws when the target is absent from the table, which means a route was declared that this dialect
 *   cannot serve — a table error, not a runtime condition. `conversions.spec.ts` asserts every declared
 *   target resolves to a constant for every application, so this cannot fire on a shipped table.
 */
function formatConstant(
  formats: Readonly<Partial<Record<DocumentFormat, number>>>,
  targetFormat: DocumentFormat,
): number {
  const constant = formats[targetFormat]
  /* v8 ignore next 3 -- unreachable while the route table and the format tables agree, which is gated */
  if (constant === undefined) {
    throw new Error(`document-convert-msoffice: no Office format constant for ${targetFormat}`)
  }
  return constant
}

/**
 * Every application this package registers a provider for.
 *
 * Six providers rather than two, because `available()` is a property of a provider and not of a route:
 * Office is installed per application, and a machine with Word but no PowerPoint must keep the Word
 * routes. Microsoft Office outranks WPS and both outrank LibreOffice, so a machine with both suites
 * uses Microsoft Office, a machine with only WPS uses WPS, and a machine with neither falls back to
 * LibreOffice. The three ranks are distinct at every route, so the seam never reports an ambiguous one.
 */
export const OFFICE_PROGRAMS: readonly OfficeProgram[] = [
  {
    id: 'msoffice-word',
    engine: 'msoffice',
    family: 'document',
    progId: 'Word.Application',
    server: 'winword.exe',
    dialect: writerDialect('SaveAs2'),
  },
  {
    id: 'msoffice-excel',
    engine: 'msoffice',
    family: 'spreadsheet',
    progId: 'Excel.Application',
    server: 'excel.exe',
    dialect: spreadsheetDialect(),
  },
  {
    id: 'msoffice-powerpoint',
    engine: 'msoffice',
    family: 'presentation',
    progId: 'PowerPoint.Application',
    server: 'powerpnt.exe',
    dialect: presentationDialect(),
  },
  {
    id: 'wps-writer',
    engine: 'wps',
    family: 'document',
    progId: 'KWPS.Application',
    server: 'wps.exe',
    dialect: writerDialect('SaveAs'),
  },
  {
    id: 'wps-spreadsheets',
    engine: 'wps',
    family: 'spreadsheet',
    progId: 'KET.Application',
    server: 'et.exe',
    dialect: spreadsheetDialect(),
  },
  {
    id: 'wps-presentation',
    engine: 'wps',
    family: 'presentation',
    progId: 'KWPP.Application',
    server: 'wpp.exe',
    dialect: presentationDialect(),
  },
]

/**
 * The process base name `Get-Process` matches for one application, used to find the process a
 * conversion started so it can be killed if the conversion is cancelled.
 * @param program - the application.
 * @returns the executable basename without its `.exe` suffix.
 */
export function processName(program: OfficeProgram): string {
  return program.server.replace(/\.exe$/i, '')
}
