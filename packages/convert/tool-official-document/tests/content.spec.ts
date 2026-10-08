import { describe, expect, it } from 'vitest'
import { buildContent, charUnits, documentElements } from '../src/content.ts'
import { ISSUER_OFFSET_MM, LINE_HEIGHT_MM } from '../src/metrics.ts'
import { mm } from '../src/odf.ts'
import type { OfficialDocument } from '../src/types.ts'

/** The minimum a validated document carries, which each case below adds one element to. */
function base(): OfficialDocument {
  return { header: {}, body: { title: '关于××的通知', paragraphs: [{ text: '正文' }] }, colophon: {} }
}

/** `content.xml` for a document, built through the same function the package uses. */
function content(document: OfficialDocument): string {
  return buildContent(document)
}

describe('charUnits', () => {
  it('counts a Chinese character as one 字 and a Latin letter or digit as half', () => {
    expect(charUnits('市政府')).toBe(3)
    expect(charUnits('ab12')).toBe(2)
    expect(charUnits('2026年9月1日')).toBe(2 + 1 + 0.5 + 1 + 0.5 + 1)
  })

  it('counts nothing for the empty string', () => {
    expect(charUnits('')).toBe(0)
  })
})

describe('the 版头 (§ 7.2)', () => {
  it('orders the three corner markings as § 7.2.1–7.2.3 number them', () => {
    const xml = content({
      ...base(),
      header: { copyNumber: 7, secrecy: { level: '秘密', period: '5年' }, urgency: '特急' },
    })
    expect(xml).toContain('<text:p text:style-name="CopyNumber">000007</text:p>'
      + '<text:p text:style-name="Secrecy">秘密★5年</text:p>'
      + '<text:p text:style-name="Urgency">特急</text:p>')
  })

  it('writes a 密级 with no stated period on its own', () => {
    expect(content({ ...base(), header: { secrecy: { level: '绝密' } } }))
      .toContain('<text:p text:style-name="Secrecy">绝密</text:p>')
  })

  it('centres the 发文字号 of a 下行文 (§ 7.2.5)', () => {
    expect(content({ ...base(), header: { docNumber: '国办发〔2026〕3号' } }))
      .toContain('<text:p text:style-name="DocNumber">国办发〔2026〕3号</text:p>')
  })

  it('puts the 发文字号 and the 签发人 on one line for an 上行文 (§ 7.2.5, § 7.2.6)', () => {
    expect(content({ ...base(), header: { docNumber: '×政发〔2026〕3号', signer: '张××' } }))
      .toContain('<text:p text:style-name="DocNumberUpward">×政发〔2026〕3号<text:tab/>签发人：'
        + '<text:span text:style-name="SignerName">张××</text:span></text:p>')
  })

  it('draws the red line below the 版头 marks (§ 7.2.7)', () => {
    expect(content({ ...base(), header: { issuer: '××市人民政府文件' } }))
      .toContain('<text:p text:style-name="HeaderRule"/>')
  })

  it('draws no red line when there is no 版头 mark above it', () => {
    expect(content(base())).not.toContain('HeaderRule')
  })

  it('subtracts the lines the corner markings took from the 发文机关标志\'s 35 mm (§ 7.2.4)', () => {
    const xml = content({
      ...base(),
      header: { copyNumber: 1, urgency: '加急', issuer: '××市人民政府文件' },
    })
    expect(xml).toContain(`fo:margin-top="${mm(ISSUER_OFFSET_MM - 2 * LINE_HEIGHT_MM) as string}"`)
    expect(xml).toContain('<text:p text:style-name="IssuerPlaced">××市人民政府文件</text:p>')
  })

  it('never pushes the 发文机关标志 above the top of the 版心, however many marks precede it', () => {
    const many = { copyNumber: 1, secrecy: { level: '秘密', period: '一万年' }, urgency: '特急' as const }
    const xml = content({ ...base(), header: { ...many, issuer: '××市人民政府文件' } })
    expect(xml).toContain(`fo:margin-top="${mm(ISSUER_OFFSET_MM - 3 * LINE_HEIGHT_MM) as string}"`)
  })
})

describe('the 主体 (§ 7.3)', () => {
  it('joins the 主送机关 and supplies the colon (§ 7.3.2)', () => {
    expect(content({
      ...base(),
      body: { ...base().body, mainRecipients: ['各区人民政府', '市政府各部门'] },
    })).toContain('<text:p text:style-name="Recipient">各区人民政府、市政府各部门：</text:p>')
  })

  it('omits the 主送机关 line when the document names none', () => {
    expect(content(base())).not.toContain('Recipient')
  })

  it('gives each 正文 level its ordinal and the style its typeface (§ 7.3.3)', () => {
    const xml = content({
      ...base(),
      body: {
        ...base().body,
        paragraphs: [
          { level: 1, text: '一项' },
          { level: 2, text: '二项' },
          { level: 3, text: '三项' },
          { level: 4, text: '四项' },
          { text: '正文' },
        ],
      },
    })
    expect(xml).toContain('<text:p text:style-name="BodyLevel1">一、一项</text:p>')
    expect(xml).toContain('<text:p text:style-name="BodyLevel2">（一）二项</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body">1.三项</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body">（1）四项</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body">正文</text:p>')
  })

  it('sets only the heading of a run-in 第一层 or 第二层 paragraph in its level face (§ 7.3.3)', () => {
    const xml = content({
      ...base(),
      body: {
        ...base().body,
        paragraphs: [
          { level: 1, text: '总体要求。坚持统一标准。' },
          { level: 2, text: '依赖专家知识。传统算法以细节点比对为主。' },
          { level: 2, text: '健全机制。' },
          { level: 3, text: '三项。其后正文。' },
        ],
      },
    })
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level1Heading">'
      + '一、总体要求。</text:span>坚持统一标准。</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level2Heading">'
      + '（一）依赖专家知识。</text:span>传统算法以细节点比对为主。</text:p>')
    expect(xml).toContain('<text:p text:style-name="BodyLevel2">（二）健全机制。</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body">1.三项。其后正文。</text:p>')
  })

  it('closes a run-in heading at any mark that can end one, not only 。 (§ 7.3.3)', () => {
    const xml = content({
      ...base(),
      body: {
        ...base().body,
        paragraphs: [
          { level: 1, text: '压实工作责任：各地区各部门要确保见效。' },
          { level: 2, text: '指导思想；以规范化为抓手。' },
          { level: 1, text: '总体要求！真抓实干。' },
          { level: 2, text: '工作目标？先立后破。' },
        ],
      },
    })
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level1Heading">'
      + '一、压实工作责任：</text:span>各地区各部门要确保见效。</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level2Heading">'
      + '（一）指导思想；</text:span>以规范化为抓手。</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level1Heading">'
      + '二、总体要求！</text:span>真抓实干。</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level2Heading">'
      + '（一）工作目标？</text:span>先立后破。</text:p>')
  })

  it('treats a line break in a run-in heading as the separation, not as heading text (§ 7.3.3)', () => {
    const xml = content({
      ...base(),
      body: {
        ...base().body,
        paragraphs: [
          { level: 1, text: '总体要求\n坚持统一标准。' },
          { level: 2, text: '健全机制：\n各部门落实责任。' },
        ],
      },
    })
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level1Heading">'
      + '一、总体要求</text:span>坚持统一标准。</text:p>')
    expect(xml).toContain('<text:p text:style-name="Body"><text:span text:style-name="Level2Heading">'
      + '（一）健全机制：</text:span>各部门落实责任。</text:p>')
  })

  it('keeps a heading that ends at the mark and carries no body in its level face (§ 7.3.3)', () => {
    const xml = content({
      ...base(),
      body: { ...base().body, paragraphs: [{ level: 1, text: '总体要求：' }, { level: 2, text: '健全机制\n' }] },
    })
    expect(xml).toContain('<text:p text:style-name="BodyLevel1">一、总体要求：</text:p>')
    expect(xml).toContain('<text:p text:style-name="BodyLevel2">（一）健全机制</text:p>')
  })

  it('writes a single attachment as 附件：××× (§ 7.3.4)', () => {
    expect(content({ ...base(), body: { ...base().body, attachments: ['公文格式检查表'] } }))
      .toContain('<text:p text:style-name="Attachment">附件：公文格式检查表</text:p>')
  })

  it('numbers several attachments and aligns the later ones under the first (§ 7.3.4)', () => {
    expect(content({ ...base(), body: { ...base().body, attachments: ['检查表', '对照说明'] } }))
      .toContain('<text:p text:style-name="Attachment">附件：1.检查表</text:p>'
        + '<text:p text:style-name="AttachmentMore">2.对照说明</text:p>')
  })

  it('centres the 发文机关署名 over the 成文日期 (§ 7.3.5.2, § 7.3.5.4)', () => {
    const xml = content({
      ...base(),
      body: { ...base().body, signature: '××市人民政府', date: '2026-09-21' },
    })
    // 2026年9月21日 is 7 字 and ××市人民政府 is 7, so the署名 keeps the date's own 右空四字.
    expect(xml).toContain('<style:style style:name="SignatureCentred" style:family="paragraph"'
      + ' style:parent-style-name="Signature">')
    expect(xml).toContain('<text:p text:style-name="SignatureCentred">××市人民政府</text:p>')
    expect(xml).toContain('<text:p text:style-name="IssueDate">2026年9月21日</text:p>')
  })

  it('leaves a署名 with no date on the plain right-aligned style', () => {
    expect(content({ ...base(), body: { ...base().body, signature: '××市人民政府' } }))
      .toContain('<text:p text:style-name="Signature">××市人民政府</text:p>')
  })

  it('never indents the署名 off the left edge when it is wider than the date leaves room for', () => {
    const xml = content({
      ...base(),
      body: { ...base().body, signature: '中共××市××区××街道办事处委员会', date: '2026-09-21' },
    })
    expect(xml).toContain('<style:style style:name="SignatureCentred"')
    expect(xml).not.toContain('fo:margin-right="-')
  })

  it('puts the 附注 in round brackets (§ 7.3.6)', () => {
    expect(content({ ...base(), body: { ...base().body, note: '此件公开发布' } }))
      .toContain('<text:p text:style-name="Note">（此件公开发布）</text:p>')
  })
})

describe('the 版记 (§ 7.4)', () => {
  it('is absent when the document has neither 抄送机关 nor 印发机关', () => {
    expect(content(base())).not.toContain('Colophon')
  })

  it('encloses the 抄送 and the 印发 lines between the two heavy rules, parted by a light one', () => {
    const xml = content({
      ...base(),
      colophon: { copyTo: ['市委办公厅', '市人大常委会办公厅'], printer: { agency: '市政府办公厅', date: '2026-09-22' } },
    })
    expect(xml).toContain('<text:p text:style-name="ColophonRuleHeavy"/>'
      + '<text:p text:style-name="CopyTo">抄送：市委办公厅，市人大常委会办公厅。</text:p>'
      + '<text:p text:style-name="ColophonRuleLight"/>'
      + '<text:p text:style-name="Printer">市政府办公厅<text:tab/>2026年9月22日印发</text:p>'
      + '<text:p text:style-name="ColophonRuleHeavy"/>')
  })

  it('draws no light rule when only one of the two elements is present', () => {
    const copyOnly = content({ ...base(), colophon: { copyTo: ['市委办公厅'] } })
    expect(copyOnly).toContain('ColophonRuleHeavy')
    expect(copyOnly).not.toContain('ColophonRuleLight')
    const printOnly = content({ ...base(), colophon: { printer: { agency: '市政府办公厅', date: '2026-09-22' } } })
    expect(printOnly).not.toContain('ColophonRuleLight')
  })
})

describe('buildContent', () => {
  it('is a well-formed content part with the automatic styles before the body', () => {
    const xml = content(base())
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><office:document-content ')).toBe(true)
    expect(xml.indexOf('<office:automatic-styles>')).toBeLessThan(xml.indexOf('<office:body>'))
    expect(xml.endsWith('</office:document-content>')).toBe(true)
  })

  it('escapes text that would otherwise close an element', () => {
    expect(content({ ...base(), body: { ...base().body, title: '关于<A&B>的通知' } }))
      .toContain('<text:p text:style-name="Title">关于&lt;A&amp;B&gt;的通知</text:p>')
  })

  it('lays the 版头, the 主体, and the 版记 out in the order § 7.1 divides them', () => {
    const xml = content({
      header: { docNumber: '国办发〔2026〕3号' },
      body: { ...base().body, signature: '国务院办公厅', date: '2026-09-21' },
      colophon: { copyTo: ['各部委'] },
    })
    const order = ['DocNumber', 'HeaderRule', 'Title', 'Body', 'SignatureCentred', 'CopyTo']
      .map(name => xml.indexOf(`<text:p text:style-name="${name}"`))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})

describe('documentElements', () => {
  it('lists only the elements the document carries, each with its clause', () => {
    expect(documentElements(base())).toEqual(['§ 7.3.1 标题', '§ 7.3.3 正文'])
  })

  it('lists every element of a complete document in the order § 7 arranges them', () => {
    expect(documentElements({
      header: {
        copyNumber: 1,
        secrecy: { level: '秘密' },
        urgency: '特急',
        issuer: '××市人民政府文件',
        docNumber: '×政发〔2026〕3号',
        signer: '张××',
      },
      body: {
        title: '关于××的通知',
        mainRecipients: ['各区人民政府'],
        paragraphs: [{ text: '正文' }],
        attachments: ['检查表'],
        signature: '××市人民政府',
        date: '2026-09-21',
        note: '此件公开发布',
      },
      colophon: { copyTo: ['市委办公厅'], printer: { agency: '市政府办公厅', date: '2026-09-22' } },
    })).toEqual([
      '§ 7.2.1 份号',
      '§ 7.2.2 密级和保密期限',
      '§ 7.2.3 紧急程度',
      '§ 7.2.4 发文机关标志',
      '§ 7.2.5 发文字号',
      '§ 7.2.6 签发人',
      '§ 7.3.1 标题',
      '§ 7.3.2 主送机关',
      '§ 7.3.3 正文',
      '§ 7.3.4 附件说明',
      '§ 7.3.5.2 发文机关署名',
      '§ 7.3.5.4 成文日期',
      '§ 7.3.6 附注',
      '§ 7.4.2 抄送机关',
      '§ 7.4.3 印发机关和印发日期',
    ])
  })
})
