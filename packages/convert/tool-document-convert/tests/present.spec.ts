import { describe, expect, it } from 'vitest'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import {
  convertMetaFromResult,
  convertMetaFromValue,
  formatConvertOutput,
  plannedOutputPath,
  presentConvertCall,
  presentConvertResult,
} from '@deepseek-ai/dsh-tool-document-convert'
import type { ConvertOutputValue, ConvertToolArgs } from '@deepseek-ai/dsh-tool-document-convert'

/**
 * The presenters and the result text. All of it runs on session-log replay as well as live, so these
 * tests pin that a malformed or absent payload degrades to the generic card instead of throwing.
 */

function value(overrides: Partial<ConvertOutputValue> = {}): ConvertOutputValue {
  return {
    path: '/ws/report.pdf',
    from: 'docx',
    to: 'pdf',
    fidelity: 'faithful',
    steps: [{ from: 'docx', to: 'pdf', provider: 'libreoffice' }],
    bytes: 2048,
    notes: [],
    ...overrides,
  }
}

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return { isError: false, content: [], meta: convertMetaFromValue(value()), ...overrides }
}

const args: ConvertToolArgs = { path: 'docs/report.docx', to: 'pdf' }

describe('plannedOutputPath', () => {
  it('derives the output beside the source when the call names none', () => {
    expect(plannedOutputPath(args)).toBe('docs/report.pdf')
  })

  it('uses an explicit output_path verbatim', () => {
    expect(plannedOutputPath({ ...args, output_path: 'out/final.pdf' })).toBe('out/final.pdf')
  })
})

describe('formatConvertOutput', () => {
  it('states the formats, the path, the size, and the route', () => {
    expect(formatConvertOutput(value()))
      .toBe('Converted docx to pdf: /ws/report.pdf (2048 bytes, via libreoffice)')
  })

  it('says nothing about loss for a faithful conversion', () => {
    expect(formatConvertOutput(value())).not.toMatch(/lossy/)
  })

  it('warns that a lossy single-step route kept only the text', () => {
    const text = formatConvertOutput(value({
      to: 'txt',
      fidelity: 'lossy',
      steps: [{ from: 'docx', to: 'txt', provider: 'libreoffice' }],
    }))
    expect(text).toMatch(/This route is lossy/)
    expect(text).not.toMatch(/passed through/)
  })

  it('names the intermediate formats a lossy multi-step route passed through', () => {
    const text = formatConvertOutput(value({
      from: 'pdf',
      to: 'xlsx',
      fidelity: 'lossy',
      steps: [
        { from: 'pdf', to: 'txt', provider: 'poppler-pdftotext' },
        { from: 'txt', to: 'xlsx', provider: 'libreoffice' },
      ],
    }))
    expect(text).toMatch(/via poppler-pdftotext → libreoffice/)
    expect(text).toMatch(/passed through txt\./)
  })

  it('states what the conversion dropped, a bare "lossy" telling the model nothing it can act on', () => {
    const text = formatConvertOutput(value({
      to: 'txt',
      fidelity: 'lossy',
      steps: [{ from: 'docx', to: 'txt', provider: 'libreoffice' }],
      notes: [
        { code: 'TEXT_ONLY', message: 'Tables became lines of text.' },
        { code: 'IMAGES_DROPPED', message: 'Images were dropped.' },
      ],
    }))
    expect(text).toMatch(/What this conversion did not carry over:\n- Tables became lines of text\.\n- Images were dropped\./)
  })

  it('drops the generic warning once the steps have said what was actually lost', () => {
    const text = formatConvertOutput(value({
      to: 'txt',
      fidelity: 'lossy',
      steps: [{ from: 'docx', to: 'txt', provider: 'libreoffice' }],
      notes: [{ code: 'TEXT_ONLY', message: 'Tables became lines of text.' }],
    }))
    expect(text).not.toMatch(/This route is lossy/)
  })

  it('keeps the route line above the losses, so the first line still answers what was written', () => {
    const text = formatConvertOutput(value({
      from: 'pdf',
      to: 'xlsx',
      fidelity: 'lossy',
      steps: [
        { from: 'pdf', to: 'txt', provider: 'poppler-pdftotext' },
        { from: 'txt', to: 'xlsx', provider: 'libreoffice' },
      ],
      notes: [{ code: 'PDF_TEXT_EXTRACTED', message: 'Page layout was not preserved.' }],
    }))
    expect(text.split('\n')[1]).toBe('The conversion passed through txt.')
  })
})

describe('presentConvertCall', () => {
  it('presents an edit card, so the produced file joins the turn\'s deliverables', () => {
    expect(presentConvertCall(args)).toEqual({
      card: 'generic',
      title: 'Convert report.docx to pdf',
      kind: 'edit',
      rawInput: 'docs/report.docx',
      locations: [{ path: 'docs/report.pdf' }],
    })
  })

  it('follows an explicit output_path in its locations', () => {
    expect(presentConvertCall({ ...args, output_path: 'out/final.pdf' }).locations)
      .toEqual([{ path: 'out/final.pdf' }])
  })

  it('titles a source with no directory', () => {
    expect(presentConvertCall({ path: 'report.docx', to: 'pdf' }).title).toBe('Convert report.docx to pdf')
  })

  it('titles a windows path by its final segment', () => {
    expect(presentConvertCall({ path: 'C:\\docs\\report.docx', to: 'pdf' }).title)
      .toBe('Convert report.docx to pdf')
  })
})

describe('convertMetaFromResult', () => {
  it('reads back what convertMetaFromValue projected', () => {
    expect(convertMetaFromResult(convertMetaFromValue(value())))
      .toEqual({ path: '/ws/report.pdf', fidelity: 'faithful' })
  })

  it('rejects a non-object payload', () => {
    expect(convertMetaFromResult(undefined)).toBeUndefined()
    expect(convertMetaFromResult('x')).toBeUndefined()
    expect(convertMetaFromResult(null)).toBeUndefined()
    expect(convertMetaFromResult(['x'])).toBeUndefined()
  })

  it('rejects a payload missing or mistyping a field', () => {
    expect(convertMetaFromResult({ fidelity: 'faithful' })).toBeUndefined()
    expect(convertMetaFromResult({ path: 1, fidelity: 'faithful' })).toBeUndefined()
    expect(convertMetaFromResult({ path: '/a', fidelity: 'partial' })).toBeUndefined()
  })
})

describe('presentConvertResult', () => {
  it('titles the completed card with the written file', () => {
    expect(presentConvertResult(result())).toEqual({ card: 'generic', title: 'report.pdf' })
  })

  it('marks a lossy result on the card itself', () => {
    const lossy = result({ meta: convertMetaFromValue(value({ fidelity: 'lossy' })) })
    expect(presentConvertResult(lossy)).toEqual({ card: 'generic', title: 'report.pdf (lossy)' })
  })

  it('falls back to the generic card for a failed call', () => {
    expect(presentConvertResult(result({ isError: true }))).toBeUndefined()
  })

  it('falls back to the generic card when replayed metadata is malformed', () => {
    expect(presentConvertResult(result({ meta: { path: 7 } as never }))).toBeUndefined()
  })
})
