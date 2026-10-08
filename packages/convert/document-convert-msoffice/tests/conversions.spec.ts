import { describe, expect, it } from 'vitest'
import type { DocumentFamily, DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import {
  OFFICE_CONVERSIONS, OFFICE_PROGRAMS, officeRoutes, PDF_REFLOW_CAVEAT, PDF_REFLOW_TARGETS,
} from '@deepseek-ai/dsh-document-convert-msoffice'

/**
 * The declared route table. Its exclusions are the mechanism that keeps the official-document tool's ODF
 * pages with LibreOffice and HTML with pandoc, so the excluded formats are asserted by name rather than
 * left to the table's own comment.
 */

/** The families the table declares, listed rather than derived so dropping an entry fails a case. */
const FAMILIES: readonly DocumentFamily[] = ['document', 'spreadsheet', 'presentation']

/** Every route every application of both suites declares, at an arbitrary rank. */
function allRoutes(priority = 30): readonly { from: DocumentFormat; to: DocumentFormat }[] {
  return OFFICE_PROGRAMS.flatMap(program => officeRoutes(program.family, priority, program.engine))
}

/** The routes one suite's application declares between its family's own formats. */
function nativeRoutes(family: DocumentFamily, engine: 'msoffice' | 'wps' = 'wps') {
  return officeRoutes(family, 30, engine).filter(route => route.from !== 'pdf')
}

describe('office route table', () => {
  it('declares one conversion set per document family', () => {
    expect(Object.keys(OFFICE_CONVERSIONS).toSorted()).toEqual([...FAMILIES].toSorted())
  })

  it('declares 13 document, 4 spreadsheet, and 4 presentation routes between native formats', () => {
    expect(nativeRoutes('document')).toHaveLength(13)
    expect(nativeRoutes('spreadsheet')).toHaveLength(4)
    expect(nativeRoutes('presentation')).toHaveLength(4)
    expect(nativeRoutes('document', 'msoffice')).toEqual(nativeRoutes('document', 'wps'))
  })

  it('never declares a format as its own conversion', () => {
    expect(allRoutes().filter(route => route.from === route.to)).toEqual([])
  })

  it('declares no OpenDocument edge, so the official-document tool keeps LibreOffice', () => {
    const odf: readonly DocumentFormat[] = ['odt', 'ods', 'odp']
    const touching = allRoutes().filter(route => odf.includes(route.from) || odf.includes(route.to))
    expect(touching).toEqual([])
  })

  it('declares no html edge in either direction', () => {
    const touching = allRoutes().filter(route => route.from === 'html' || route.to === 'html')
    expect(touching).toEqual([])
  })

  it('reads txt but never writes it', () => {
    expect(allRoutes().some(route => route.from === 'txt')).toBe(true)
    expect(allRoutes().filter(route => route.to === 'txt')).toEqual([])
  })

  it('converts every family to pdf', () => {
    for (const family of FAMILIES) {
      expect(nativeRoutes(family).some(route => route.to === 'pdf')).toBe(true)
    }
  })

  it('declares every native edge faithful, since the application owns the format it writes', () => {
    for (const family of FAMILIES) {
      for (const route of nativeRoutes(family, 'msoffice')) expect(route.fidelity).toBe('faithful')
    }
  })

  it('stamps the given rank on every route', () => {
    for (const route of officeRoutes('document', 7, 'msoffice')) expect(route.priority).toBe(7)
  })
})

describe('PDF reflow through Word', () => {
  it('lets Word read pdf into every document-family format it writes, lossy', () => {
    const reflow = officeRoutes('document', 30, 'msoffice').filter(route => route.from === 'pdf')
    expect(PDF_REFLOW_TARGETS).toEqual(['doc', 'docx', 'rtf'])
    expect(reflow.map(route => route.to)).toEqual([...PDF_REFLOW_TARGETS])
    for (const route of reflow) expect(route.fidelity).toBe('lossy')
  })

  it('declares no pdf source for WPS, whose PDF import is unverified', () => {
    expect(officeRoutes('document', 30, 'wps').filter(route => route.from === 'pdf')).toEqual([])
  })

  it('declares no pdf source outside the document family', () => {
    for (const family of ['spreadsheet', 'presentation'] as const) {
      expect(officeRoutes(family, 30, 'msoffice').filter(route => route.from === 'pdf')).toEqual([])
    }
  })

  it('names what a reflowed document can get wrong', () => {
    expect(PDF_REFLOW_CAVEAT.code).toBe('PDF_REFLOWED_BY_WORD')
    expect(PDF_REFLOW_CAVEAT.message).toContain('real Word objects')
  })
})

describe('route table against the COM dialects', () => {
  it('has a format constant for every target it declares', () => {
    for (const program of OFFICE_PROGRAMS) {
      for (const target of OFFICE_CONVERSIONS[program.family].targets) {
        expect(program.dialect.formats[target], `${program.id} writes ${target}`).toBeTypeOf('number')
      }
    }
  })

  it('writes a numeric constant into every save statement it can generate', () => {
    for (const program of OFFICE_PROGRAMS) {
      for (const target of OFFICE_CONVERSIONS[program.family].targets) {
        expect(program.dialect.save(target), `${program.id} saves ${target}`).not.toContain('undefined')
      }
    }
  })

  it('covers all three families with both suites', () => {
    for (const engine of ['msoffice', 'wps'] as const) {
      const families = OFFICE_PROGRAMS.filter(program => program.engine === engine)
        .map(program => program.family)
      expect(new Set(families)).toEqual(new Set<DocumentFamily>(['document', 'spreadsheet', 'presentation']))
    }
  })
})
