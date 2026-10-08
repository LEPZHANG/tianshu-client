import { describe, expect, it } from 'vitest'
import {
  chineseNumeral,
  formatCopyNumber,
  formatOfficialDate,
  isCalendarDate,
  levelFont,
  levelOrdinal,
  numberParagraphs,
} from '../src/numbering.ts'
import { FONT } from '../src/metrics.ts'

/**
 * The rules GB/T 9704—2012 states in words rather than in millimetres. Each case below is the clause's
 * own example where it gives one, because that is the only way to check a numbering rule against its text.
 */

describe('chineseNumeral', () => {
  it('writes the single digits the first two levels are numbered with', () => {
    expect([1, 2, 3, 9].map(chineseNumeral)).toEqual(['一', '二', '三', '九'])
  })

  it('writes ten as 十 rather than 一十', () => {
    expect(chineseNumeral(10)).toBe('十')
    expect(chineseNumeral(12)).toBe('十二')
  })

  it('writes the tens above ten with their leading digit', () => {
    expect(chineseNumeral(20)).toBe('二十')
    expect(chineseNumeral(21)).toBe('二十一')
    expect(chineseNumeral(99)).toBe('九十九')
  })
})

describe('levelOrdinal and levelFont (§ 7.3.3)', () => {
  it('numbers the four levels as 一、（一）1.（1）', () => {
    expect([
      levelOrdinal(1, 1),
      levelOrdinal(2, 2),
      levelOrdinal(3, 3),
      levelOrdinal(4, 4),
    ]).toEqual(['一、', '（二）', '3.', '（4）'])
  })

  it('marks the first level in 黑体, the second in 楷体, and the last two in the 仿宋体 body face', () => {
    expect([levelFont(1), levelFont(2), levelFont(3), levelFont(4)])
      .toEqual([FONT.hei, FONT.kai, FONT.fangsong, FONT.fangsong])
  })
})

describe('numberParagraphs', () => {
  it('leaves an unlevelled paragraph without an ordinal', () => {
    expect(numberParagraphs([{ text: '正文' }])).toEqual([{ text: '正文' }])
  })

  it('restarts a deeper level whenever a shallower one advances', () => {
    const numbered = numberParagraphs([
      { level: 1, text: 'a' },
      { level: 2, text: 'a1' },
      { level: 2, text: 'a2' },
      { level: 1, text: 'b' },
      { level: 2, text: 'b1' },
    ])
    expect(numbered.map(item => item.ordinal)).toEqual(['一、', '（一）', '（二）', '二、', '（一）'])
  })

  it('counts each level independently of the paragraphs between its entries', () => {
    const numbered = numberParagraphs([
      { level: 3, text: '1' },
      { text: '正文' },
      { level: 3, text: '2' },
    ])
    expect(numbered.map(item => item.ordinal)).toEqual(['1.', undefined, '2.'])
  })
})

describe('isCalendarDate', () => {
  it('accepts an ISO date naming a day that exists', () => {
    expect(isCalendarDate('2026-09-21')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
  })

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(isCalendarDate('2026年9月21日')).toBe(false)
    expect(isCalendarDate('2026-9-21')).toBe(false)
  })

  it('rejects a month or day outside the calendar', () => {
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-00-01')).toBe(false)
    expect(isCalendarDate('2026-09-00')).toBe(false)
  })

  it('rejects a day the month does not have, which Date would otherwise roll forward', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2026-02-29')).toBe(false)
  })
})

describe('formatOfficialDate (§ 7.3.5.4)', () => {
  it('writes Arabic numerals with the year in full and no padded month or day', () => {
    expect(formatOfficialDate('2026-09-01')).toBe('2026年9月1日')
    expect(formatOfficialDate('2026-12-31')).toBe('2026年12月31日')
  })
})

describe('formatCopyNumber (§ 7.2.1)', () => {
  it('pads the serial to six digits', () => {
    expect(formatCopyNumber(7)).toBe('000007')
    expect(formatCopyNumber(999_999)).toBe('999999')
  })
})
