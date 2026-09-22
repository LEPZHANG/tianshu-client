/**
 * The numbering rules GB/T 9704—2012 states in words: the four structural ordinals of § 7.3.3 with the
 * typeface each level is marked in, and the Arabic date form § 7.3.5.4 and § 7.4.3 require.
 *
 * Pure functions over plain values, so the layout code and its tests read the same rules.
 * @module @deepseek-ai/dsh-tool-official-document/numbering
 */

import { FONT } from './metrics.ts'
import type { OfficialDocumentParagraph } from './types.ts'

/** Chinese numeral digits, indexed by value; index 0 is unused because the ordinals start at one. */
const CHINESE_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/**
 * A counting number in Chinese numerals, as the first two structural levels are marked. Covers 1–99,
 * which is well past the depth any single document numbers to.
 * @param value - a counting number from 1 to 99.
 * @returns its Chinese numeral form, e.g. 21 as `二十一`.
 */
export function chineseNumeral(value: number): string {
  if (value < 10) return CHINESE_DIGITS[value] as string
  const tens = Math.floor(value / 10)
  const ones = value % 10
  const tensPart = tens === 1 ? '十' : `${CHINESE_DIGITS[tens] as string}十`
  return ones === 0 ? tensPart : `${tensPart}${CHINESE_DIGITS[ones] as string}`
}

/**
 * The ordinal marking one paragraph at one level, in the four forms § 7.3.3 lists in order.
 * @param level - the structural depth, 1 through 4.
 * @param position - this paragraph's one-based position among its siblings at that level.
 * @returns the ordinal text, including its punctuation or brackets.
 */
export function levelOrdinal(level: 1 | 2 | 3 | 4, position: number): string {
  switch (level) {
    case 1: return `${chineseNumeral(position)}、`
    case 2: return `（${chineseNumeral(position)}）`
    case 3: return `${position}.`
    case 4: return `（${position}）`
  }
}

/**
 * The typeface a level's ordinal and its paragraph are set in: § 7.3.3 marks the first level in 黑体, the
 * second in 楷体, and the third and fourth in 仿宋体 — which is also the body default, so the deepest two
 * levels are distinguished by their ordinal alone.
 * @param level - the structural depth, 1 through 4.
 * @returns the font family name for that level.
 */
export function levelFont(level: 1 | 2 | 3 | 4): string {
  switch (level) {
    case 1: return FONT.hei
    case 2: return FONT.kai
    case 3: return FONT.fangsong
    case 4: return FONT.fangsong
  }
}

/** One 正文 paragraph with its ordinal resolved, ready to lay out. */
export interface NumberedParagraph {
  /** The structural depth, absent for ordinary body text. */
  readonly level?: 1 | 2 | 3 | 4
  /** The ordinal prefix, absent for ordinary body text. */
  readonly ordinal?: string
  /** The paragraph text as given. */
  readonly text: string
}

/**
 * Resolve every paragraph's ordinal. Counters run per level and a deeper level restarts whenever a
 * shallower one advances, so the second `（一）` under the second `一、` is numbered from one rather than
 * continuing the first group.
 *
 * @param paragraphs - the 正文 paragraphs in document order.
 * @returns the same paragraphs, each carrying the ordinal it is marked with.
 */
export function numberParagraphs(
  paragraphs: readonly OfficialDocumentParagraph[],
): readonly NumberedParagraph[] {
  const counters = [0, 0, 0, 0]
  return paragraphs.map((paragraph) => {
    if (paragraph.level === undefined) return { text: paragraph.text }
    const index = paragraph.level - 1
    counters[index] = (counters[index] as number) + 1
    for (let deeper = index + 1; deeper < counters.length; deeper += 1) counters[deeper] = 0
    return {
      level: paragraph.level,
      ordinal: levelOrdinal(paragraph.level, counters[index]),
      text: paragraph.text,
    }
  })
}

/** ISO calendar dates, the only form the tool accepts so the rendered form is unambiguous. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Whether a string is an ISO calendar date naming a day that exists. `2026-02-30` parses as a date but
 * names no day, and JavaScript would silently roll it into March.
 * @param value - the candidate date string.
 * @returns true when the string is `YYYY-MM-DD` and the day exists.
 */
export function isCalendarDate(value: string): boolean {
  const parts = ISO_DATE.exec(value)
  if (parts === null) return false
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * A date in the form § 7.3.5.4 requires: Arabic numerals, the year in full, and no leading zero on the
 * month or the day. § 7.4.3 states the same rule for the printing date.
 *
 * @param iso - an ISO `YYYY-MM-DD` date, already validated.
 * @returns the date as e.g. `2026年9月1日`.
 */
export function formatOfficialDate(iso: string): string {
  const parts = ISO_DATE.exec(iso) as RegExpExecArray
  return `${Number(parts[1])}年${Number(parts[2])}月${Number(parts[3])}日`
}

/**
 * 份号 as § 7.2.1 renders it: six Arabic digits, zero-padded, which is the one place the standard asks
 * for leading zeros rather than forbidding them.
 * @param value - the copy's serial number.
 * @returns the six-digit form.
 */
export function formatCopyNumber(value: number): string {
  return String(value).padStart(6, '0')
}
