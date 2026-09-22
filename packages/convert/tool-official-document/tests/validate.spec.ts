import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_DOC_FIELD_INVALID,
  OFFICIAL_DOC_FIELD_MISSING,
  OfficialDocumentError,
} from '../src/types.ts'
import type { OfficialDocument } from '../src/types.ts'
import { validateOfficialDocument } from '../src/validate.ts'

/**
 * One rejected counterexample per rule GB/T 9704—2012 states as a prohibition, because a validator that
 * accepts everything passes every test written from the accepting side.
 */

/** A document that breaks nothing, which each case below then breaks in exactly one place. */
function valid(): OfficialDocument {
  return {
    header: { docNumber: '国办发〔2026〕3号' },
    body: { title: '关于××的通知', paragraphs: [{ text: '正文' }] },
    colophon: {},
  }
}

/** The violation lines of the error a document raises, or a failure when it raises none. */
function violations(document: OfficialDocument): string {
  try {
    validateOfficialDocument(document)
  } catch (error) {
    if (error instanceof OfficialDocumentError) return error.message
    throw error
  }
  return expect.unreachable('expected the document to be refused')
}

/** The `code` of the error a document raises. */
function code(document: OfficialDocument): unknown {
  try {
    validateOfficialDocument(document)
  } catch (error) {
    return (error as OfficialDocumentError).code
  }
  return expect.unreachable('expected the document to be refused')
}

describe('a document that breaks nothing', () => {
  it('passes with only the elements the standard requires', () => {
    expect(() => { validateOfficialDocument(valid()) }).not.toThrow()
  })

  it('passes with every optional element present', () => {
    expect(() => { validateOfficialDocument({
      header: {
        copyNumber: 1,
        secrecy: { level: '秘密', period: '5年' },
        urgency: '特急',
        issuer: '××市人民政府文件',
        docNumber: '×政发〔2026〕3号',
        signer: '张××',
      },
      body: {
        title: '关于××的通知',
        mainRecipients: ['各区人民政府'],
        paragraphs: [{ level: 1, text: '一项' }, { text: '正文' }],
        attachments: ['公文格式检查表'],
        signature: '××市人民政府',
        date: '2026-09-21',
        note: '此件公开发布',
      },
      colophon: { copyTo: ['市委办公厅'], printer: { agency: '市政府办公厅', date: '2026-09-22' } },
    }) }).not.toThrow()
  })
})

describe('§ 7.3.1–7.3.3 the elements no document may omit', () => {
  it('refuses a blank 标题', () => {
    expect(violations({ ...valid(), body: { ...valid().body, title: '  ' } })).toMatch(/标题 \(§ 7\.3\.1\)/)
  })

  it('refuses a 正文 with no paragraphs', () => {
    expect(violations({ ...valid(), body: { ...valid().body, paragraphs: [] } }))
      .toMatch(/正文 \(§ 7\.3\.3\) must have at least one paragraph/)
  })

  it('refuses a blank paragraph, naming its position', () => {
    expect(violations({
      ...valid(),
      body: { ...valid().body, paragraphs: [{ text: '正文' }, { text: '' }] },
    })).toMatch(/正文 \(§ 7\.3\.3\) paragraph 2 is blank/)
  })

  it('refuses a paragraph below a level the standard numbers', () => {
    expect(violations({
      ...valid(),
      body: { ...valid().body, paragraphs: [{ level: 5 as 1, text: '深' }] },
    })).toMatch(/cannot be at level 5/)
  })

  it('reports a document missing only required fields as missing rather than invalid', () => {
    expect(code({ ...valid(), body: { ...valid().body, title: '' } })).toBe(OFFICIAL_DOC_FIELD_MISSING)
  })
})

describe('§ 7.2.5 发文字号', () => {
  it('refuses a 第 before the sequence number', () => {
    expect(violations({ ...valid(), header: { docNumber: '国办发〔2026〕第3号' } }))
      .toMatch(/must not contain 第/)
  })

  it('refuses a padded sequence number, which the clause writes as 1 不编为 01', () => {
    expect(violations({ ...valid(), header: { docNumber: '国办发〔2026〕01号' } }))
      .toMatch(/must be Arabic and unpadded/)
  })

  it('refuses square brackets in place of 六角括号', () => {
    expect(violations({ ...valid(), header: { docNumber: '国办发[2026]3号' } }))
      .toMatch(/六角括号/)
  })

  it('refuses a two-digit year', () => {
    expect(violations({ ...valid(), header: { docNumber: '国办发〔26〕3号' } })).toMatch(/六角括号/)
  })

  it('reports a malformed field as invalid rather than missing', () => {
    expect(code({ ...valid(), header: { docNumber: '国办发〔2026〕01号' } })).toBe(OFFICIAL_DOC_FIELD_INVALID)
  })
})

describe('§ 7.2.6 签发人', () => {
  it('refuses a signer with no 发文字号 to share a line with', () => {
    expect(violations({ ...valid(), header: { signer: '张××' } }))
      .toMatch(/must also carry a 发文字号/)
  })

  it('refuses a blank signer', () => {
    expect(violations({ ...valid(), header: { ...valid().header, signer: ' ' } }))
      .toMatch(/签发人 \(§ 7\.2\.6\)/)
  })
})

describe('§ 7.2.1 份号', () => {
  it('refuses a value wider than the six digits the field holds', () => {
    expect(violations({ ...valid(), header: { ...valid().header, copyNumber: 1_000_000 } }))
      .toMatch(/份号 \(§ 7\.2\.1\)/)
  })

  it('refuses zero and refuses a fraction', () => {
    expect(violations({ ...valid(), header: { ...valid().header, copyNumber: 0 } })).toMatch(/份号/)
    expect(violations({ ...valid(), header: { ...valid().header, copyNumber: 1.5 } })).toMatch(/份号/)
  })
})

describe('§ 7.2.2 and § 7.2.4 the marks that must carry text', () => {
  it('refuses a blank 密级', () => {
    expect(violations({ ...valid(), header: { ...valid().header, secrecy: { level: '' } } }))
      .toMatch(/密级 \(§ 7\.2\.2\)/)
  })

  it('refuses a blank 发文机关标志', () => {
    expect(violations({ ...valid(), header: { ...valid().header, issuer: '  ' } }))
      .toMatch(/发文机关标志 \(§ 7\.2\.4\)/)
  })
})

describe('§ 7.3.4 附件说明', () => {
  it('refuses a title that ends in punctuation', () => {
    expect(violations({ ...valid(), body: { ...valid().body, attachments: ['公文格式检查表。'] } }))
      .toMatch(/take no punctuation after them/)
  })

  it('refuses a Latin full stop as well as a Chinese one', () => {
    expect(violations({ ...valid(), body: { ...valid().body, attachments: ['Checklist.'] } }))
      .toMatch(/take no punctuation after them/)
  })

  it('refuses an empty attachment list, which means nothing the clause can lay out', () => {
    expect(violations({ ...valid(), body: { ...valid().body, attachments: [] } }))
      .toMatch(/empty list; omit it instead/)
  })

  it('refuses a blank title among real ones', () => {
    expect(violations({ ...valid(), body: { ...valid().body, attachments: ['检查表', ' '] } }))
      .toMatch(/contains a blank name/)
  })
})

describe('§ 7.3.2 主送机关 and § 7.4.2 抄送机关', () => {
  it('refuses an empty 主送机关 list', () => {
    expect(violations({ ...valid(), body: { ...valid().body, mainRecipients: [] } }))
      .toMatch(/主送机关 \(§ 7\.3\.2\)/)
  })

  it('refuses a blank 抄送机关', () => {
    expect(violations({ ...valid(), colophon: { copyTo: [''] } })).toMatch(/抄送机关 \(§ 7\.4\.2\)/)
  })
})

describe('§ 7.3.5.4 成文日期 and § 7.4.3 印发日期', () => {
  it('refuses a date written in Chinese numerals', () => {
    expect(violations({ ...valid(), body: { ...valid().body, date: '二〇二六年九月二十一日' } }))
      .toMatch(/成文日期 \(§ 7\.3\.5\.4\)/)
  })

  it('refuses a date naming a day the month does not have', () => {
    expect(violations({ ...valid(), body: { ...valid().body, date: '2026-02-30' } }))
      .toMatch(/成文日期/)
  })

  it('refuses a malformed 印发日期 and a blank 印发机关', () => {
    expect(violations({ ...valid(), colophon: { printer: { agency: ' ', date: '2026/09/22' } } }))
      .toMatch(/印发机关 \(§ 7\.4\.3\)[\s\S]*印发日期 \(§ 7\.4\.3\)/)
  })
})

describe('§ 7.3.5.2 发文机关署名 and § 7.3.6 附注', () => {
  it('refuses a blank署名 and a blank 附注', () => {
    expect(violations({ ...valid(), body: { ...valid().body, signature: '', note: ' ' } }))
      .toMatch(/发文机关署名 \(§ 7\.3\.5\.2\)[\s\S]*附注 \(§ 7\.3\.6\)/)
  })
})

describe('reporting', () => {
  it('collects every violation into one refusal so a caller fixes them together', () => {
    const message = violations({
      header: { copyNumber: 0, docNumber: '国办发〔2026〕01号' },
      body: { title: '', paragraphs: [] },
      colophon: {},
    })
    expect(message.split('\n- ')).toHaveLength(5)
    expect(message).toMatch(/^this is not a GB\/T 9704—2012 official document yet:/)
  })
})
