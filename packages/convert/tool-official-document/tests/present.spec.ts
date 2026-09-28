import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OFFICIAL_DOCUMENT_FORMAT,
  formatOfficialDocumentOutput,
  officialDocumentMetaFromResult,
  officialDocumentMetaFromValue,
  presentOfficialDocumentCall,
  presentOfficialDocumentResult,
  resolveOfficialDocumentFormat,
} from '../src/present.ts'
import type { OfficialDocumentOutputValue, OfficialDocumentToolArgs } from '../src/present.ts'

/** The arguments a minimal call carries, which each case below varies one field of. */
function args(overrides: Partial<OfficialDocumentToolArgs> = {}): OfficialDocumentToolArgs {
  return { output_path: '通知.docx', title: '关于××的通知', body: [{ text: '正文' }], ...overrides }
}

/** A canonical output value, which each case below varies one field of. */
function value(overrides: Partial<OfficialDocumentOutputValue> = {}): OfficialDocumentOutputValue {
  return {
    path: 'out/通知.docx',
    format: 'docx',
    fidelity: 'faithful',
    bytes: 4096,
    elements: ['§ 7.3.1 标题', '§ 7.3.3 正文'],
    notes: [],
    ...overrides,
  }
}

describe('resolveOfficialDocumentFormat', () => {
  it('takes an explicit format over the output path\'s extension', () => {
    expect(resolveOfficialDocumentFormat(args({ format: 'odt', output_path: 'a.pdf' }))).toBe('odt')
  })

  it('takes the output path\'s extension when the call names no format', () => {
    expect(resolveOfficialDocumentFormat(args({ output_path: 'out/通知.pdf' }))).toBe('pdf')
  })

  it('ignores the case of the extension', () => {
    expect(resolveOfficialDocumentFormat(args({ output_path: '通知.ODT' }))).toBe('odt')
  })

  it('falls back to the default for a path with no extension', () => {
    expect(resolveOfficialDocumentFormat(args({ output_path: '通知' })))
      .toBe(DEFAULT_OFFICIAL_DOCUMENT_FORMAT)
  })

  it('falls back to the default for an extension this tool cannot write', () => {
    expect(resolveOfficialDocumentFormat(args({ output_path: '通知.ods' }))).toBe('docx')
  })

  it('treats a leading dot as the whole name rather than as an extension', () => {
    expect(resolveOfficialDocumentFormat(args({ output_path: '.odt' }))).toBe('docx')
  })

  it('reads the extension of the last segment, not of a directory above it', () => {
    expect(resolveOfficialDocumentFormat(args({ output_path: 'a.pdf/通知' }))).toBe('docx')
    expect(resolveOfficialDocumentFormat(args({ output_path: 'a.pdf\\通知.odt' }))).toBe('odt')
  })
})

describe('formatOfficialDocumentOutput', () => {
  it('states the file, its format and size, and the clauses the document answers to', () => {
    expect(formatOfficialDocumentOutput(value())).toBe(
      'Wrote a GB/T 9704—2012 official document to out/通知.docx (docx, 4096 bytes).'
      + '\nElements laid out: § 7.3.1 标题; § 7.3.3 正文.')
  })

  it('lists what the file does not deliver when the result carries notes', () => {
    expect(formatOfficialDocumentOutput(value({
      notes: [{ code: 'A', message: 'Fonts are named, not embedded.' }],
    }))).toMatch(/What this file does not deliver:\n- Fonts are named, not embedded\.$/)
  })
})

describe('presentOfficialDocumentCall', () => {
  it('is an edit card naming the file, so a produced document joins the deliverables row', () => {
    expect(presentOfficialDocumentCall(args({ output_path: 'out/通知.pdf' }))).toEqual({
      card: 'generic',
      title: 'Write 关于××的通知 as pdf',
      kind: 'edit',
      rawInput: '关于××的通知',
      locations: [{ path: 'out/通知.pdf' }],
    })
  })

  it('names the format the execution will actually produce', () => {
    expect(presentOfficialDocumentCall(args()).title).toBe('Write 关于××的通知 as docx')
  })
})

describe('officialDocumentMetaFromValue and officialDocumentMetaFromResult', () => {
  it('round-trips the path and the fidelity a completed card needs', () => {
    const meta = officialDocumentMetaFromValue(value({ fidelity: 'lossy' }))
    expect(officialDocumentMetaFromResult(meta)).toEqual({ path: 'out/通知.docx', fidelity: 'lossy' })
  })

  it('rejects metadata that is not an object', () => {
    expect(officialDocumentMetaFromResult(undefined)).toBeUndefined()
    expect(officialDocumentMetaFromResult(null)).toBeUndefined()
    expect(officialDocumentMetaFromResult('out/通知.docx')).toBeUndefined()
    expect(officialDocumentMetaFromResult([])).toBeUndefined()
  })

  it('rejects metadata missing either field, or carrying a fidelity the seam never names', () => {
    expect(officialDocumentMetaFromResult({ fidelity: 'lossy' })).toBeUndefined()
    expect(officialDocumentMetaFromResult({ path: 'a.docx' })).toBeUndefined()
    expect(officialDocumentMetaFromResult({ path: 'a.docx', fidelity: 'perfect' })).toBeUndefined()
  })
})

describe('presentOfficialDocumentResult', () => {
  it('names the written file', () => {
    expect(presentOfficialDocumentResult({
      isError: false,
      content: [],
      meta: { path: '/ws/out/通知.docx', fidelity: 'faithful' },
    })).toEqual({ card: 'generic', title: '通知.docx' })
  })

  it('marks a lossy route', () => {
    expect(presentOfficialDocumentResult({
      isError: false,
      content: [],
      meta: { path: '/ws/通知.txt', fidelity: 'lossy' },
    })).toEqual({ card: 'generic', title: '通知.txt (lossy)' })
  })

  it('falls back to the generic card on failure or on metadata replay cannot read', () => {
    expect(presentOfficialDocumentResult({ isError: true, content: [] })).toBeUndefined()
    expect(presentOfficialDocumentResult({ isError: false, content: [] })).toBeUndefined()
    expect(presentOfficialDocumentResult({ isError: false, content: [], meta: { path: 1 } })).toBeUndefined()
  })
})
