/**
 * `content.xml`: the elements of one document, in the order § 7.1 arranges them — 版头, 主体, 版记.
 *
 * Every decision here is which style an element gets and what text goes in it; how that style looks is
 * settled once in the `odf` module. Two elements need a style computed from the document itself, and both
 * are built here because only here is the document known.
 * @module @deepseek-ai/dsh-tool-official-document/content
 */

import { ISSUER_OFFSET_MM, LINE_HEIGHT_MM } from './metrics.ts'
import { formatCopyNumber, formatOfficialDate, numberParagraphs } from './numbering.ts'
import { escapeXml, ODF_NAMESPACES, paragraphStyle, SIGNER_TEXT_STYLE, XML_DECLARATION } from './odf.ts'
import type { OfficialDocument } from './types.ts'

/** 成文日期 sits 右空四字 (§ 7.3.5.4); the 发文机关署名 is centred over it (§ 7.3.5.2). */
const DATE_RIGHT_INDENT_CHARS = 4

/** The style names the two document-dependent automatic styles take. */
const PLACED_ISSUER = 'IssuerPlaced'
const CENTRED_SIGNATURE = 'SignatureCentred'

/** The paragraph style for each 正文 level, by the typeface § 7.3.3 marks that level in. */
const LEVEL_STYLES = ['BodyLevel1', 'BodyLevel2', 'Body', 'Body'] as const

/**
 * The width of a string in 字, the unit § 7 measures horizontal position in. Chinese characters and other
 * full-width forms occupy one 字; Latin letters and Arabic digits occupy half of one. Good enough for the
 * one place a width is needed — centring the 发文机关署名 over the 成文日期 — and wrong by at most half a
 * 字 for the agency names and dates that appear there.
 * @param text - the text to measure.
 * @returns its width in 字.
 */
export function charUnits(text: string): number {
  let units = 0
  for (const character of text) units += (character.codePointAt(0) as number) < 0x100 ? 0.5 : 1
  return units
}

/** One paragraph, with its text escaped. An element with no text is emitted empty, not omitted. */
function paragraph(style: string, text?: string): string {
  if (text === undefined) return `<text:p text:style-name="${style}"/>`
  return `<text:p text:style-name="${style}">${escapeXml(text)}</text:p>`
}

/**
 * 版头 (§ 7.2). § 7.2.3 fixes the order of the three corner markings — 份号, then 密级和保密期限, then
 * 紧急程度 — each on its own line, so the number of lines they take is what pushes the 发文机关标志 down.
 */
function header(document: OfficialDocument): readonly string[] {
  const { header: fields } = document
  const corner: string[] = []
  if (fields.copyNumber !== undefined) corner.push(paragraph('CopyNumber', formatCopyNumber(fields.copyNumber)))
  if (fields.secrecy !== undefined) {
    const { level, period } = fields.secrecy
    corner.push(paragraph('Secrecy', period === undefined ? level : `${level}★${period}`))
  }
  if (fields.urgency !== undefined) corner.push(paragraph('Urgency', fields.urgency))

  const marks: string[] = []
  if (fields.issuer !== undefined) marks.push(paragraph(PLACED_ISSUER, fields.issuer))
  if (fields.signer !== undefined) {
    marks.push(
      `<text:p text:style-name="DocNumberUpward">${escapeXml(fields.docNumber as string)}`
      + '<text:tab/>签发人：'
      + `<text:span text:style-name="${SIGNER_TEXT_STYLE}">${escapeXml(fields.signer)}</text:span>`
      + '</text:p>',
    )
  } else if (fields.docNumber !== undefined) {
    marks.push(paragraph('DocNumber', fields.docNumber))
  }
  // § 7.2.7 puts the red line below the 发文字号, so a document with no 版头 marks has no line to draw.
  if (marks.length > 0) marks.push(paragraph('HeaderRule'))
  return [...corner, ...marks]
}

/** 附件说明 (§ 7.3.4): one title reads 附件：×××, several are numbered and aligned under the first. */
function attachments(titles: readonly string[]): readonly string[] {
  const numbered = titles.length > 1
  return titles.map((title, index) => {
    const label = numbered ? `${index + 1}.${title}` : title
    return index === 0 ? paragraph('Attachment', `附件：${label}`) : paragraph('AttachmentMore', label)
  })
}

/** 发文机关署名, 成文日期, 附注 (§ 7.3.5, § 7.3.6), in the order the clauses stack them. */
function closing(document: OfficialDocument): readonly string[] {
  const { signature, date, note } = document.body
  const paragraphs: string[] = []
  if (signature !== undefined) paragraphs.push(paragraph(date === undefined ? 'Signature' : CENTRED_SIGNATURE, signature))
  if (date !== undefined) paragraphs.push(paragraph('IssueDate', formatOfficialDate(date)))
  if (note !== undefined) paragraphs.push(paragraph('Note', `（${note}）`))
  return paragraphs
}

/**
 * 版记 (§ 7.4). Its separator lines are drawn by empty paragraphs whose bottom border is the line, so the
 * heavy line that opens the block comes before the first element and the one that closes it comes last.
 */
function colophon(document: OfficialDocument): readonly string[] {
  const { copyTo, printer } = document.colophon
  if (copyTo === undefined && printer === undefined) return []
  const paragraphs = [paragraph('ColophonRuleHeavy')]
  if (copyTo !== undefined) {
    paragraphs.push(paragraph('CopyTo', `抄送：${copyTo.join('，')}。`))
    if (printer !== undefined) paragraphs.push(paragraph('ColophonRuleLight'))
  }
  if (printer !== undefined) {
    paragraphs.push(
      `<text:p text:style-name="Printer">${escapeXml(printer.agency)}`
      + `<text:tab/>${escapeXml(formatOfficialDate(printer.date))}印发</text:p>`,
    )
  }
  paragraphs.push(paragraph('ColophonRuleHeavy'))
  return paragraphs
}

/**
 * The two styles that cannot be fixed in advance.
 *
 * § 7.2.4 measures the 发文机关标志 from the top of the 版心, but the 份号, 密级 and 紧急程度 above it
 * already occupy whole lines, so the gap left to add is 35 mm less what they took. § 7.3.5.2 centres the
 * 发文机关署名 on the 成文日期, which is a right indent of the date's own 四字 plus half the difference in
 * their widths. Neither can go below zero, which is what happens when the signature is wider than the
 * space the date leaves.
 */
function documentStyles(document: OfficialDocument): string {
  const { header: fields, body } = document
  const styles: string[] = []
  if (fields.issuer !== undefined) {
    const above = [fields.copyNumber, fields.secrecy, fields.urgency].filter(field => field !== undefined).length
    styles.push(paragraphStyle({
      name: PLACED_ISSUER,
      parent: 'Issuer',
      spaceAboveMm: Math.max(0, ISSUER_OFFSET_MM - above * LINE_HEIGHT_MM),
    }))
  }
  if (body.signature !== undefined && body.date !== undefined) {
    const overhang = (charUnits(formatOfficialDate(body.date)) - charUnits(body.signature)) / 2
    styles.push(paragraphStyle({
      name: CENTRED_SIGNATURE,
      parent: 'Signature',
      indentRightChars: Math.max(0, DATE_RIGHT_INDENT_CHARS + overhang),
    }))
  }
  return styles.join('')
}

/**
 * Build `content.xml` for one document: the 版头 of § 7.2, the 主体 of § 7.3 with its 正文 ordinals
 * resolved, and the 版记 of § 7.4.
 *
 * The document must already have passed validation — the 上行文 branch reads the 发文字号 that a 签发人
 * requires, and both dates are formatted rather than checked.
 * @param document - the validated document.
 * @returns the `content.xml` part, as UTF-8 text.
 */
export function buildContent(document: OfficialDocument): string {
  const { body } = document
  const recipients = body.mainRecipients === undefined
    ? []
    : [paragraph('Recipient', `${body.mainRecipients.join('、')}：`)]
  const text = numberParagraphs(body.paragraphs).map((item) => {
    if (item.level === undefined) return paragraph('Body', item.text)
    return paragraph(LEVEL_STYLES[item.level - 1] as string, `${item.ordinal as string}${item.text}`)
  })
  const paragraphs = [
    ...header(document),
    paragraph('Title', body.title),
    ...recipients,
    ...text,
    ...(body.attachments === undefined ? [] : attachments(body.attachments)),
    ...closing(document),
    ...colophon(document),
  ]
  return `${XML_DECLARATION}<office:document-content ${ODF_NAMESPACES}>`
    + `<office:automatic-styles>${documentStyles(document)}</office:automatic-styles>`
    + `<office:body><office:text>${paragraphs.join('')}</office:text></office:body>`
    + '</office:document-content>'
}

/**
 * The elements the document actually carries, each labelled with the clause that governs it, in the order
 * § 7 arranges them.
 *
 * The standard makes most elements optional, so this is what tells a reader which ones a given call left
 * out: it is reported back to the model rather than kept for the layout's own use.
 * @param document - the validated document.
 * @returns one label per element present, e.g. `§ 7.2.5 发文字号`.
 */
export function documentElements(document: OfficialDocument): readonly string[] {
  const { header: fields, body, colophon: tail } = document
  const present: readonly (readonly [unknown, string])[] = [
    [fields.copyNumber, '§ 7.2.1 份号'],
    [fields.secrecy, '§ 7.2.2 密级和保密期限'],
    [fields.urgency, '§ 7.2.3 紧急程度'],
    [fields.issuer, '§ 7.2.4 发文机关标志'],
    [fields.docNumber, '§ 7.2.5 发文字号'],
    [fields.signer, '§ 7.2.6 签发人'],
    [body.title, '§ 7.3.1 标题'],
    [body.mainRecipients, '§ 7.3.2 主送机关'],
    [body.paragraphs, '§ 7.3.3 正文'],
    [body.attachments, '§ 7.3.4 附件说明'],
    [body.signature, '§ 7.3.5.2 发文机关署名'],
    [body.date, '§ 7.3.5.4 成文日期'],
    [body.note, '§ 7.3.6 附注'],
    [tail.copyTo, '§ 7.4.2 抄送机关'],
    [tail.printer, '§ 7.4.3 印发机关和印发日期'],
  ]
  return present.filter(([value]) => value !== undefined).map(([, label]) => label)
}
