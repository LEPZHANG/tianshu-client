import { describe, expect, it } from 'vitest'
import type { DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import {
  OFFICE_PROGRAMS,
  buildConversionScript,
  parseSpawnedPids,
  powershellLiteral,
} from '@deepseek-ai/dsh-document-convert-msoffice'
import type { OfficeProgram } from '@deepseek-ai/dsh-document-convert-msoffice'

/**
 * The generated COM script. The macro-security assertion and the two `$spawned.Count` guards are the
 * parts a reader cannot verify by eye on Windows either — a document that runs its macros and an
 * application quit out from under its user both look like success.
 */

/** The application with a given provider id. */
function program(id: string): OfficeProgram {
  const found = OFFICE_PROGRAMS.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no such program: ${id}`)
  return found
}

/** One script, with paths that need no escaping. */
function script(
  id: string,
  sourceFormat: DocumentFormat,
  targetFormat: DocumentFormat,
): string {
  return buildConversionScript({
    program: program(id),
    sourcePath: `C:\\in\\doc.${sourceFormat}`,
    sourceFormat,
    outputPath: `C:\\work\\output.${targetFormat}`,
    targetFormat,
    pidFilePath: 'C:\\work\\office.pid',
  })
}

/** A source format each family actually reads, for a test that must cover all six applications. */
const FAMILY_SOURCE: Readonly<Record<string, DocumentFormat>> = {
  document: 'docx',
  spreadsheet: 'xlsx',
  presentation: 'pptx',
}

describe('macro security', () => {
  it('disables macros and refuses to open the document when the setting did not take', () => {
    for (const candidate of OFFICE_PROGRAMS) {
      const text = script(candidate.id, FAMILY_SOURCE[candidate.family] as DocumentFormat, 'pdf')
      expect(text, candidate.id).toContain('$app.AutomationSecurity = 3')
      expect(text, candidate.id).toContain('if ($app.AutomationSecurity -ne 3) {')
      expect(text, candidate.id).toContain('would run its macros')
      // Set before the open and restored after it: an attached instance is the user's own application and
      // must not be left with macros permanently disabled.
      expect(text.indexOf('$app.AutomationSecurity = 3')).toBeLessThan(text.indexOf('$doc ='))
      expect(text, candidate.id).toContain('$app.AutomationSecurity = $security')
    }
  })
})

describe('an application the user already had open', () => {
  it('records the process ids it started before opening anything', () => {
    const text = script('msoffice-word', 'docx', 'pdf')
    expect(text.indexOf('Set-Content -LiteralPath')).toBeLessThan(text.indexOf('$doc ='))
  })

  it('hides the window and quits only when this run started the process', () => {
    const text = script('msoffice-word', 'docx', 'pdf')
    expect(text).toContain('if ($spawned.Count -gt 0) {\n      $app.Visible = $false')
    expect(text).toContain('if ($spawned.Count -gt 0) { $app.Quit() }')
  })

  it('never sets Visible on PowerPoint, which refuses it and is single-instance', () => {
    for (const id of ['msoffice-powerpoint', 'wps-presentation']) {
      const text = script(id, 'pptx', 'pdf')
      expect(text, id).not.toContain('$app.Visible')
      expect(text, id).toContain('$app.DisplayAlerts = 1')
    }
  })
})

describe('per-application COM calls', () => {
  it('opens a document read-only without adding it to the recent list', () => {
    expect(script('msoffice-word', 'docx', 'pdf'))
      .toContain('$doc = $app.Documents.Open($source, $false, $true, $false)')
  })

  it('opens a txt source as UTF-8, so Chinese text is not read as the ANSI code page', () => {
    expect(script('msoffice-word', 'txt', 'pdf')).toContain('5, 65001')
    expect(script('msoffice-word', 'docx', 'pdf')).not.toContain('65001')
  })

  it('exports a workbook to pdf through ExportAsFixedFormat, the only member that writes one', () => {
    expect(script('msoffice-excel', 'xlsx', 'pdf')).toContain('$doc.ExportAsFixedFormat(0, $output)')
    expect(script('msoffice-excel', 'xls', 'xlsx')).toContain('$doc.SaveAs($output, 51)')
  })

  it('writes each legacy format through its own file-format constant', () => {
    expect(script('msoffice-word', 'docx', 'doc')).toContain('$doc.SaveAs2($output, 0)')
    expect(script('msoffice-word', 'doc', 'docx')).toContain('$doc.SaveAs2($output, 16)')
    expect(script('msoffice-word', 'docx', 'rtf')).toContain('$doc.SaveAs2($output, 6)')
    expect(script('msoffice-excel', 'xlsx', 'xls')).toContain('$doc.SaveAs($output, -4143)')
    expect(script('msoffice-powerpoint', 'pptx', 'ppt')).toContain('$doc.SaveAs($output, 1)')
    expect(script('msoffice-powerpoint', 'ppt', 'pptx')).toContain('$doc.SaveAs($output, 24)')
  })

  it('drives WPS through SaveAs, which its object model exposes instead of SaveAs2', () => {
    expect(script('wps-writer', 'docx', 'pdf')).toContain('$doc.SaveAs($output, 17)')
  })

  it('kills the process by name, which is what the provider cleans up after', () => {
    expect(script('msoffice-word', 'docx', 'pdf')).toContain("$processName = 'winword'")
    expect(script('wps-presentation', 'pptx', 'pdf')).toContain("$processName = 'wpp'")
  })

  it('releases the document and the application on every path out', () => {
    const text = script('msoffice-word', 'docx', 'pdf')
    expect(text).toContain('ReleaseComObject($doc)')
    expect(text).toContain('ReleaseComObject($app)')
  })

  it('reports a COM failure as a message on standard error and a non-zero exit', () => {
    const text = script('msoffice-word', 'docx', 'pdf')
    expect(text).toContain('[Console]::Error.WriteLine($_.Exception.Message)')
    expect(text).toContain('exit 1')
  })
})

describe('path escaping', () => {
  it('doubles a single quote, so a path containing one stays one literal', () => {
    expect(powershellLiteral("C:\\it's\\a.txt")).toBe("'C:\\it''s\\a.txt'")
    const text = buildConversionScript({
      program: program('msoffice-word'),
      sourcePath: "C:\\it's\\a.docx",
      sourceFormat: 'docx',
      outputPath: "C:\\Ryan's work\\output.pdf",
      targetFormat: 'pdf',
      pidFilePath: 'C:\\work\\office.pid',
    })
    expect(text).toContain("$source = 'C:\\it''s\\a.docx'")
    expect(text).toContain("$output = 'C:\\Ryan''s work\\output.pdf'")
  })

  it('never leaves a backslash path interpreted as an escape, since single quotes do not expand', () => {
    expect(script('msoffice-word', 'docx', 'pdf')).toContain("$source = 'C:\\in\\doc.docx'")
  })
})

describe('parseSpawnedPids', () => {
  it('reads the space-separated ids the script recorded', () => {
    expect(parseSpawnedPids('4321 8765\n')).toEqual([4321, 8765])
  })

  it('reads nothing from an empty record, which means no process was started', () => {
    expect(parseSpawnedPids('')).toEqual([])
    expect(parseSpawnedPids('\n')).toEqual([])
  })

  it('ignores anything that is not a process id', () => {
    expect(parseSpawnedPids('4321 not-a-pid -1')).toEqual([4321])
  })
})
