import { describe, expect, it } from 'vitest'
import {
  defaultOutputPath,
  detectFormat,
  DOCUMENT_FORMATS,
  formatFamily,
} from '@deepseek-ai/dsh-document-convert'

describe('DOCUMENT_FORMATS', () => {
  it('names the thirteen formats the seam converts, without repeats', () => {
    expect(DOCUMENT_FORMATS).toHaveLength(13)
    expect(new Set(DOCUMENT_FORMATS).size).toBe(13)
  })
})

describe('formatFamily', () => {
  it('classifies each family', () => {
    expect(formatFamily('docx')).toBe('document')
    expect(formatFamily('ods')).toBe('spreadsheet')
    expect(formatFamily('pptx')).toBe('presentation')
  })

  it('gives pdf no family, because it is every family\'s shared render target', () => {
    expect(formatFamily('pdf')).toBeUndefined()
  })

  it('classifies every non-pdf format', () => {
    const unclassified = DOCUMENT_FORMATS.filter(format => format !== 'pdf' && formatFamily(format) === undefined)
    expect(unclassified).toEqual([])
  })
})

describe('detectFormat', () => {
  it('reads the extension of each format id', () => {
    for (const format of DOCUMENT_FORMATS) {
      expect(detectFormat(`/work/report.${format}`)).toBe(format)
    }
  })

  it('accepts htm as a spelling of html', () => {
    expect(detectFormat('/work/page.htm')).toBe('html')
  })

  it('ignores extension case', () => {
    expect(detectFormat('/work/REPORT.DOCX')).toBe('docx')
  })

  it('reads a windows path on any host', () => {
    expect(detectFormat('C:\\work\\report.xlsx')).toBe('xlsx')
  })

  it('returns undefined for a path with no extension', () => {
    expect(detectFormat('/work/report')).toBeUndefined()
  })

  it('returns undefined for an unconvertible extension', () => {
    expect(detectFormat('/work/archive.zip')).toBeUndefined()
  })

  it('does not read a dot in a directory name as the file extension', () => {
    expect(detectFormat('/work/v1.2/report')).toBeUndefined()
  })

  it('treats a leading dot as a dotfile rather than an extension', () => {
    expect(detectFormat('/work/.docx')).toBeUndefined()
  })
})

describe('defaultOutputPath', () => {
  it('replaces the source extension with the target format', () => {
    expect(defaultOutputPath('/work/report.docx', 'pdf')).toBe('/work/report.pdf')
  })

  it('appends an extension when the source has none', () => {
    expect(defaultOutputPath('/work/report', 'pdf')).toBe('/work/report.pdf')
  })

  it('keeps a dotted directory intact', () => {
    expect(defaultOutputPath('/work/v1.2/report.odt', 'docx')).toBe('/work/v1.2/report.docx')
  })

  it('keeps a windows path intact', () => {
    expect(defaultOutputPath('C:\\work\\report.doc', 'odt')).toBe('C:\\work\\report.odt')
  })

  it('keeps a dotfile name and adds the extension after it', () => {
    expect(defaultOutputPath('/work/.hidden', 'txt')).toBe('/work/.hidden.txt')
  })
})
