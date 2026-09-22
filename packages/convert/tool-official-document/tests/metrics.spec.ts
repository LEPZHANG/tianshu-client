import { describe, expect, it } from 'vitest'
import {
  BODY_LETTER_SPACING_PT,
  CHAR_WIDTH_MM,
  CHARS_PER_LINE,
  COLOPHON_RULE_HEAVY_MM,
  COLOPHON_RULE_LIGHT_MM,
  HEADER_RULE_GAP_MM,
  HEADER_RULE_THICKNESS_MM,
  ISSUER_OFFSET_MM,
  LINE_HEIGHT_MM,
  LINES_PER_PAGE,
  MARGIN_BINDING_MM,
  MARGIN_BOTTOM_BODY_MM,
  MARGIN_BOTTOM_MM,
  MARGIN_OUTER_MM,
  MARGIN_TOP_MM,
  OFFICIAL_BLACK,
  OFFICIAL_RED,
  PAGE_HEIGHT_MM,
  PAGE_NUMBER_HEIGHT_MM,
  PAGE_NUMBER_OFFSET_MM,
  PAGE_WIDTH_MM,
  REQUIRED_FONTS,
  TYPE_AREA_HEIGHT_MM,
  TYPE_AREA_WIDTH_MM,
  TYPE_SIZE_PT,
} from '../src/metrics.ts'

/**
 * Each case names the clause its number comes from. A derived constant is checked against the arithmetic
 * the clause implies rather than against a copy of its own expression, so a changed derivation fails here.
 */

describe('§ 5.1 幅面', () => {
  it('is A4', () => {
    expect([PAGE_WIDTH_MM, PAGE_HEIGHT_MM]).toEqual([210, 297])
  })
})

describe('§ 5.2.1 版面', () => {
  it('states the 天头, the 订口, and the 版心', () => {
    expect(MARGIN_TOP_MM).toBe(37)
    expect(MARGIN_BINDING_MM).toBe(28)
    expect([TYPE_AREA_WIDTH_MM, TYPE_AREA_HEIGHT_MM]).toEqual([156, 225])
  })

  it('leaves the other two margins as what the page has left over', () => {
    expect(MARGIN_BINDING_MM + TYPE_AREA_WIDTH_MM + MARGIN_OUTER_MM).toBe(PAGE_WIDTH_MM)
    expect(MARGIN_TOP_MM + TYPE_AREA_HEIGHT_MM + MARGIN_BOTTOM_MM).toBe(PAGE_HEIGHT_MM)
  })

  it('gives the flowing text a smaller bottom margin so the 页码 footer fits below the 版心', () => {
    expect(MARGIN_BOTTOM_BODY_MM + PAGE_NUMBER_OFFSET_MM + PAGE_NUMBER_HEIGHT_MM).toBe(MARGIN_BOTTOM_MM)
    expect(MARGIN_BOTTOM_BODY_MM).toBeGreaterThan(0)
  })
})

describe('§ 5.2.3 字体和字号', () => {
  it('fills the 版心 with 22 lines of 28 characters', () => {
    expect([LINES_PER_PAGE, CHARS_PER_LINE]).toEqual([22, 28])
    expect(LINE_HEIGHT_MM * LINES_PER_PAGE).toBeCloseTo(TYPE_AREA_HEIGHT_MM, 9)
    expect(CHAR_WIDTH_MM * CHARS_PER_LINE).toBeCloseTo(TYPE_AREA_WIDTH_MM, 9)
  })

  it('tightens the 正文 advance to the difference between a 三号 glyph and a grid cell', () => {
    expect(CHAR_WIDTH_MM * (72 / 25.4) - TYPE_SIZE_PT.h3).toBeCloseTo(BODY_LETTER_SPACING_PT, 9)
    expect(BODY_LETTER_SPACING_PT).toBeLessThan(0)
  })
})

describe('§ 5.2.2 and § 7 type sizes', () => {
  it('names 二号, 三号, and 四号 in points', () => {
    expect(TYPE_SIZE_PT).toEqual({ h2: 22, h3: 16, h4: 14 })
  })
})

describe('the positions § 7 states in millimetres', () => {
  it('puts the 发文机关标志 35 mm below the top of the 版心 (§ 7.2.4)', () => {
    expect(ISSUER_OFFSET_MM).toBe(35)
  })

  it('puts the red line 4 mm below the 发文字号 (§ 7.2.7)', () => {
    expect(HEADER_RULE_GAP_MM).toBe(4)
  })

  it('gives the red line the one rule thickness the standard states (§ 7.4.1)', () => {
    expect(HEADER_RULE_THICKNESS_MM).toBe(COLOPHON_RULE_HEAVY_MM)
  })

  it('states the two 版记 rule thicknesses (§ 7.4.1)', () => {
    expect([COLOPHON_RULE_HEAVY_MM, COLOPHON_RULE_LIGHT_MM]).toEqual([0.35, 0.25])
  })

  it('puts the 页码 7 mm below the bottom of the 版心 (§ 7.5)', () => {
    expect(PAGE_NUMBER_OFFSET_MM).toBe(7)
  })
})

describe('ink and typefaces', () => {
  it('sets every element but the 红头 in black (§ 5.2.4)', () => {
    expect(OFFICIAL_BLACK).toBe('#000000')
    expect(OFFICIAL_RED).toBe('#ff0000')
  })

  it('names the five typefaces § 5.2.2 and § 7 call for, without repeats', () => {
    expect(REQUIRED_FONTS).toEqual([
      'FZXiaoBiaoSong-B05S', 'FangSong_GB2312', 'SimHei', 'KaiTi_GB2312', 'SimSun',
    ])
    expect(new Set(REQUIRED_FONTS).size).toBe(REQUIRED_FONTS.length)
  })
})
