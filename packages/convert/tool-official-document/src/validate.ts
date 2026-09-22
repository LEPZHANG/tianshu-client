/**
 * What GB/T 9704—2012 forbids outright, checked before anything is written.
 *
 * The standard states several of its rules as prohibitions on how a value is written — a 发文顺序号 may
 * not carry 第 and may not be padded (§ 7.2.5), a date must be Arabic with no padded month (§ 7.3.5.4),
 * an attachment title may not end in punctuation (§ 7.3.4). A document that breaks one is not a slightly
 * imperfect official document; it is not one. So the tool refuses it and names the clause, because a
 * model told which clause it broke can fix the field, while one told only that the call failed resends
 * the same value.
 *
 * Every violation is collected before throwing, so one round trip reports every field to correct.
 * @module @deepseek-ai/dsh-tool-official-document/validate
 */

import { isCalendarDate } from './numbering.ts'
import { OFFICIAL_DOC_FIELD_INVALID, OFFICIAL_DOC_FIELD_MISSING, OfficialDocumentError } from './types.ts'
import type { OfficialDocument } from './types.ts'

/**
 * 发文字号: an issuing-body abbreviation, the year in 六角括号, then the sequence number and 号 (§ 7.2.5).
 * The sequence number is matched as bare digits so padding and a stray 第 fail with their own message
 * rather than as a shapeless mismatch.
 */
const DOC_NUMBER = /^(\S+)〔(\d{4})〕(\S*?)号$/

/** A sequence number as § 7.2.5 admits it: Arabic, and not padded — "1 不编为 01". */
const UNPADDED_SEQUENCE = /^[1-9]\d*$/

/** Punctuation an attachment title may not end on (§ 7.3.4). */
const TRAILING_PUNCTUATION = new Set([
  '。', '，', '、', '；', '：', '？', '！', '.', ',', ';', ':', '?', '!',
])

/** Largest 份号 the six-digit field of § 7.2.1 can hold. */
const MAX_COPY_NUMBER = 999_999

/** A field that must carry text carries none. */
function requireText(violations: string[], value: string | undefined, field: string, clause: string): void {
  if (value !== undefined && value.trim().length > 0) return
  violations.push(`${field} (§ ${clause}) must not be blank`)
}

/** Check each entry of a list of body names, which the standard never allows to be blank. */
function requireNames(
  violations: string[],
  names: readonly string[] | undefined,
  field: string,
  clause: string,
): void {
  if (names === undefined) return
  if (names.length === 0) {
    violations.push(`${field} (§ ${clause}) was given as an empty list; omit it instead`)
    return
  }
  if (names.some(name => name.trim().length === 0)) {
    violations.push(`${field} (§ ${clause}) contains a blank name`)
  }
}

/** § 7.2.5, the clause with the most ways to be written wrongly. */
function checkDocNumber(violations: string[], docNumber: string | undefined): void {
  if (docNumber === undefined) return
  if (docNumber.includes('第')) {
    violations.push('发文字号 (§ 7.2.5) must not contain 第 before the sequence number')
    return
  }
  const parts = DOC_NUMBER.exec(docNumber)
  if (parts === null) {
    violations.push(
      '发文字号 (§ 7.2.5) must read as 机关代字〔YYYY〕N号 with the year in 六角括号 〔〕 and the full '
      + `year, e.g. 国办发〔2026〕3号; got "${docNumber}"`,
    )
    return
  }
  if (!UNPADDED_SEQUENCE.test(parts[3] as string)) {
    violations.push(
      `发文字号 (§ 7.2.5) sequence number must be Arabic and unpadded — 1 is written 1, not 01; got "${parts[3] as string}"`,
    )
  }
}

/** § 7.2.1: six Arabic digits, so the value has to fit in six of them. */
function checkCopyNumber(violations: string[], copyNumber: number | undefined): void {
  if (copyNumber === undefined) return
  if (!Number.isInteger(copyNumber) || copyNumber < 1 || copyNumber > MAX_COPY_NUMBER) {
    violations.push(`份号 (§ 7.2.1) is a six-digit number, so it must be an integer from 1 to ${MAX_COPY_NUMBER}`)
  }
}

/** § 7.3.4: an attachment title carries no punctuation after it. */
function checkAttachments(violations: string[], attachments: readonly string[] | undefined): void {
  requireNames(violations, attachments, '附件说明', '7.3.4')
  for (const title of attachments ?? []) {
    const trimmed = title.trim()
    if (trimmed.length > 0 && TRAILING_PUNCTUATION.has(trimmed.slice(-1))) {
      violations.push(`附件说明 (§ 7.3.4) titles take no punctuation after them; got "${title}"`)
    }
  }
}

/** § 7.3.5.4 and § 7.4.3 both require a full Arabic date, which this tool takes as an ISO calendar date. */
function checkDate(violations: string[], date: string | undefined, field: string, clause: string): void {
  if (date === undefined) return
  if (!isCalendarDate(date)) {
    violations.push(
      `${field} (§ ${clause}) must be an ISO calendar date, YYYY-MM-DD, which is laid out as Arabic `
      + `numerals with the year in full and no padded month or day; got "${date}"`,
    )
  }
}

/** § 7.3.3: four levels, and text in every paragraph. */
function checkParagraphs(violations: string[], document: OfficialDocument): void {
  const paragraphs = document.body.paragraphs
  if (paragraphs.length === 0) {
    violations.push('正文 (§ 7.3.3) must have at least one paragraph')
    return
  }
  paragraphs.forEach((paragraph, index) => {
    if (paragraph.text.trim().length === 0) {
      violations.push(`正文 (§ 7.3.3) paragraph ${index + 1} is blank`)
    }
    if (paragraph.level !== undefined && ![1, 2, 3, 4].includes(paragraph.level)) {
      violations.push(
        `正文 (§ 7.3.3) numbers four structural levels, so paragraph ${index + 1} cannot be at level ${paragraph.level}`,
      )
    }
  })
}

/**
 * Check a document against every rule GB/T 9704—2012 states as a prohibition, and throw once naming all
 * of them. A document that passes still depends on its author for the things the standard leaves to
 * judgement — 文种 selection, whether the 标题 carries all three of its parts, whether the 主送机关 is
 * the right body.
 *
 * @param document - the assembled document, before layout.
 * @throws {@link OfficialDocumentError} `OFFICIAL_DOC_FIELD_MISSING` when a required field is blank, or
 *   `OFFICIAL_DOC_FIELD_INVALID` when a present field is written in a form the standard forbids.
 */
export function validateOfficialDocument(document: OfficialDocument): void {
  const { header, body, colophon } = document
  const violations: string[] = []

  requireText(violations, body.title, '标题', '7.3.1')
  checkParagraphs(violations, document)
  const missing = violations.length

  requireNames(violations, body.mainRecipients, '主送机关', '7.3.2')
  checkCopyNumber(violations, header.copyNumber)
  if (header.secrecy !== undefined) requireText(violations, header.secrecy.level, '密级', '7.2.2')
  if (header.issuer !== undefined) requireText(violations, header.issuer, '发文机关标志', '7.2.4')
  checkDocNumber(violations, header.docNumber)
  if (header.signer !== undefined) {
    requireText(violations, header.signer, '签发人', '7.2.6')
    if (header.docNumber === undefined) {
      violations.push(
        '签发人 (§ 7.2.6) marks an 上行文, whose 发文字号 shares its line (§ 7.2.5), so a document with a '
        + 'signer must also carry a 发文字号',
      )
    }
  }
  checkAttachments(violations, body.attachments)
  if (body.signature !== undefined) requireText(violations, body.signature, '发文机关署名', '7.3.5.2')
  checkDate(violations, body.date, '成文日期', '7.3.5.4')
  if (body.note !== undefined) requireText(violations, body.note, '附注', '7.3.6')
  requireNames(violations, colophon.copyTo, '抄送机关', '7.4.2')
  if (colophon.printer !== undefined) {
    requireText(violations, colophon.printer.agency, '印发机关', '7.4.3')
    checkDate(violations, colophon.printer.date, '印发日期', '7.4.3')
  }

  if (violations.length === 0) return
  const code = violations.length === missing ? OFFICIAL_DOC_FIELD_MISSING : OFFICIAL_DOC_FIELD_INVALID
  throw new OfficialDocumentError(
    `this is not a GB/T 9704—2012 official document yet:\n${violations.map(line => `- ${line}`).join('\n')}`,
    code,
  )
}
