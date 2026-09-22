import { describe, expect, it } from 'vitest'
import {
  attributes,
  buildStyles,
  escapeXml,
  mm,
  paragraphStyle,
  PARAGRAPH_STYLES,
  pt,
  SIGNER_TEXT_STYLE,
  textStyle,
  XML_DECLARATION,
} from '../src/odf.ts'
import {
  CHAR_WIDTH_MM,
  CHARS_PER_LINE,
  FONT,
  LINE_HEIGHT_MM,
  MARGIN_BINDING_MM,
  MARGIN_BOTTOM_BODY_MM,
  MARGIN_OUTER_MM,
  MARGIN_TOP_MM,
  PAGE_NUMBER_OFFSET_MM,
  TYPE_SIZE_PT,
} from '../src/metrics.ts'

/** The one style document every call writes, built once because it depends on nothing. */
const styles = buildStyles()

/** The `<style:style>` element of one named style, so a case asserts against that style alone. */
function style(name: string): string {
  const opening = `<style:style style:name="${name}" `
  const start = styles.indexOf(opening)
  expect(start, `no style named ${name}`).toBeGreaterThanOrEqual(0)
  return styles.slice(start, styles.indexOf('</style:style>', start))
}

describe('escapeXml', () => {
  it('escapes the four characters that would otherwise close an element or an attribute', () => {
    expect(escapeXml('&<>"')).toBe('&amp;&lt;&gt;&quot;')
  })

  it('escapes an ampersand before the entities it introduces', () => {
    expect(escapeXml('a & <b>')).toBe('a &amp; &lt;b&gt;')
  })

  it('leaves the 六角括号 of a 发文字号 alone', () => {
    expect(escapeXml('国办发〔2026〕3号')).toBe('国办发〔2026〕3号')
  })
})

describe('attributes', () => {
  it('drops the pairs with no value so an optional property can be passed unconditionally', () => {
    expect(attributes([['a', '1'], ['b', undefined], ['c', '2']])).toBe(' a="1" c="2"')
  })

  it('returns nothing when every value is absent', () => {
    expect(attributes([['a', undefined]])).toBe('')
  })

  it('escapes the values', () => {
    expect(attributes([['a', '<']])).toBe(' a="&lt;"')
  })
})

describe('mm and pt', () => {
  it('pass undefined through so a caller need not branch', () => {
    expect(mm(undefined)).toBeUndefined()
    expect(pt(undefined)).toBeUndefined()
  })

  it('round to a micrometre rather than carrying a derived value\'s full expansion', () => {
    expect(mm(225 / 22)).toBe('10.227mm')
    expect(pt(1 / 3)).toBe('0.333pt')
  })

  it('drop a trailing zero rather than writing 10.500mm', () => {
    expect(mm(10.5)).toBe('10.5mm')
    expect(pt(16)).toBe('16pt')
  })
})

describe('paragraphStyle', () => {
  it('descends from Standard unless it names another parent', () => {
    expect(paragraphStyle({ name: 'X' })).toContain('style:parent-style-name="Standard"')
    expect(paragraphStyle({ name: 'X', parent: 'Body' })).toContain('style:parent-style-name="Body"')
  })

  it('writes 左空N字 and 右空N字 as multiples of the 字 the 版心 grid fixes', () => {
    const emitted = paragraphStyle({ name: 'X', indentLeftChars: 2, indentRightChars: 4 })
    expect(emitted).toContain(`fo:margin-left="${mm(2 * CHAR_WIDTH_MM) as string}"`)
    expect(emitted).toContain(`fo:margin-right="${mm(4 * CHAR_WIDTH_MM) as string}"`)
  })

  it('writes 空N行 as multiples of the § 5.2.3 line pitch', () => {
    expect(paragraphStyle({ name: 'X', blankLinesAbove: 2 }))
      .toContain(`fo:margin-top="${mm(2 * LINE_HEIGHT_MM) as string}"`)
  })

  it('lets a millimetre gap override the line count, for the clauses stated in millimetres', () => {
    const emitted = paragraphStyle({ name: 'X', blankLinesAbove: 2, spaceAboveMm: 7 })
    expect(emitted).toContain('fo:margin-top="7mm"')
    expect(emitted).not.toContain(mm(2 * LINE_HEIGHT_MM) as string)
  })

  it('hangs a first line left of the rest when the indent is negative', () => {
    expect(paragraphStyle({ name: 'X', firstLineChars: -3 }))
      .toContain(`fo:text-indent="${mm(-3 * CHAR_WIDTH_MM) as string}"`)
  })

  it('draws a rule as a bottom border of the stated thickness and colour', () => {
    expect(paragraphStyle({ name: 'X', ruleBelow: [0.35, '#000000'] }))
      .toContain('fo:border-bottom="0.35mm solid #000000"')
  })

  it('places a right tab stop at a position measured in 字', () => {
    expect(paragraphStyle({ name: 'X', tabStopChars: 26 }))
      .toContain(`<style:tab-stop style:position="${mm(26 * CHAR_WIDTH_MM) as string}" style:type="right"/>`)
  })

  it('applies the § 5.2.3 tracking only to a style that asks for it', () => {
    expect(paragraphStyle({ name: 'X', tracked: true })).toContain('fo:letter-spacing=')
    expect(paragraphStyle({ name: 'X' })).not.toContain('fo:letter-spacing=')
  })

  it('writes nothing for a style that varies its parent in one property alone', () => {
    expect(paragraphStyle({ name: 'X', parent: 'Body' }))
      .toBe('<style:style style:name="X" style:family="paragraph" style:parent-style-name="Body">'
        + '<style:paragraph-properties></style:paragraph-properties><style:text-properties/></style:style>')
  })
})

/**
 * The bug this file exists to keep fixed: ODF keeps separate font properties per script, `fo:` covers the
 * Western one, and a CJK document that sets only `fo:` renders every glyph at the reader's default face
 * and size — correct-looking markup, wrong page.
 */
describe('per-script font properties', () => {
  it('sets the Asian typeface and size beside the Western pair on a paragraph style', () => {
    const emitted = paragraphStyle({ name: 'X', font: FONT.hei, sizePt: TYPE_SIZE_PT.h2 })
    expect(emitted).toContain(`style:font-name-asian="${FONT.hei}"`)
    expect(emitted).toContain('style:font-size-asian="22pt"')
  })

  it('sets the Asian typeface on a text style', () => {
    expect(textStyle('S', FONT.kai)).toContain(`style:font-name-asian="${FONT.kai}"`)
  })

  it('sets both on the Standard style every other style descends from', () => {
    expect(style('Standard')).toContain(`style:font-name-asian="${FONT.fangsong}"`)
    expect(style('Standard')).toContain(`style:font-size-asian="${pt(TYPE_SIZE_PT.h3) as string}"`)
  })

  it('sets both on the 标题, which is the element a missing Asian size is most visible on', () => {
    expect(style('Title')).toContain(`style:font-name-asian="${FONT.xiaobiaosong}"`)
    expect(style('Title')).toContain('style:font-size-asian="22pt"')
  })
})

describe('buildStyles', () => {
  it('is a well-formed styles part that depends on nothing, so equal documents carry equal bytes', () => {
    expect(styles.startsWith(`${XML_DECLARATION}<office:document-styles `)).toBe(true)
    expect(styles.endsWith('</office:document-styles>')).toBe(true)
    expect(buildStyles()).toBe(styles)
  })

  it('declares every typeface § 5.2.2 and § 7 name', () => {
    for (const font of Object.values(FONT)) {
      expect(styles).toContain(`<style:font-face style:name="${font}" svg:font-family="${font}"/>`)
    }
  })

  it('carries every style the content layer selects from, and the 签发人 run style', () => {
    for (const spec of PARAGRAPH_STYLES) expect(styles).toContain(`style:name="${spec.name}"`)
    expect(styles).toContain(`<style:style style:name="${SIGNER_TEXT_STYLE}" style:family="text">`)
  })

  it('fixes the line pitch as a length so 22 lines fill the 版心 (§ 5.2.3)', () => {
    expect(style('Standard')).toContain(`fo:line-height="${mm(LINE_HEIGHT_MM) as string}"`)
  })
})

describe('the page layout (§ 5.1, § 5.2.1, § 7.5)', () => {
  it('is A4 portrait', () => {
    expect(styles).toContain('fo:page-width="210mm" fo:page-height="297mm" style:print-orientation="portrait"')
  })

  it('mirrors the 订口 so it stays on the binding side of each leaf', () => {
    expect(styles).toContain('<style:page-layout style:name="OfficialPage" style:page-usage="mirrored">')
    expect(styles).toContain(`fo:margin-left="${mm(MARGIN_BINDING_MM) as string}"`)
    expect(styles).toContain(`fo:margin-right="${mm(MARGIN_OUTER_MM) as string}"`)
  })

  it('sets the 天头 and leaves the 页码 footer the space below the 版心', () => {
    expect(styles).toContain(`fo:margin-top="${mm(MARGIN_TOP_MM) as string}"`)
    expect(styles).toContain(`fo:margin-bottom="${mm(MARGIN_BOTTOM_BODY_MM) as string}"`)
    expect(styles).toContain(`fo:min-height="6mm" fo:margin-top="${mm(PAGE_NUMBER_OFFSET_MM) as string}"`)
  })

  it('alternates the 页码 between the outer corners by naming each master page the other\'s successor', () => {
    expect(styles).toContain('<style:master-page style:name="Standard" style:page-layout-name="OfficialPage"'
      + ' style:next-style-name="OfficialEven">')
    expect(styles).toContain('<style:master-page style:name="OfficialEven" style:page-layout-name="OfficialPage"'
      + ' style:next-style-name="Standard">')
  })

  it('flanks the page number with 一字线 on both master pages', () => {
    expect(styles).toContain('<text:p text:style-name="PageNumberOdd">'
      + '—<text:page-number text:select-page="current">1</text:page-number>—</text:p>')
    expect(styles).toContain('<text:p text:style-name="PageNumberEven">')
  })

  it('sets the 页码 in 四号宋体, right on an odd page and left on an even one (§ 7.5)', () => {
    expect(style('PageNumberOdd')).toContain(`style:font-name="${FONT.song}"`)
    expect(style('PageNumberOdd')).toContain('fo:text-align="end"')
    expect(style('PageNumberEven')).toContain(`fo:margin-left="${mm(CHAR_WIDTH_MM) as string}"`)
  })
})

describe('the styles that carry a clause\'s own measurement', () => {
  it('draws the red separator line in red at the stated thickness (§ 7.2.7)', () => {
    expect(style('HeaderRule')).toContain('fo:border-bottom="0.35mm solid #ff0000"')
  })

  it('draws the 版记\'s heavy and light lines at the two thicknesses § 7.4.1 states', () => {
    expect(style('ColophonRuleHeavy')).toContain('fo:border-bottom="0.35mm solid #000000"')
    expect(style('ColophonRuleLight')).toContain('fo:border-bottom="0.25mm solid #000000"')
  })

  it('sets the 发文机关标志 and the 标题 in 二号小标宋体, the 标志 in red (§ 7.2.4, § 7.3.1)', () => {
    expect(style('Issuer')).toContain('fo:color="#ff0000"')
    expect(style('Issuer')).toContain('fo:text-align="center"')
    expect(style('Title')).toContain('fo:text-align="center"')
    expect(style('Title')).not.toContain('fo:color=')
  })

  it('marks the first 正文 level in 黑体 and the second in 楷体, both over Body (§ 7.3.3)', () => {
    expect(style('BodyLevel1')).toContain('style:parent-style-name="Body"')
    expect(style('BodyLevel1')).toContain(`style:font-name="${FONT.hei}"`)
    expect(style('BodyLevel2')).toContain(`style:font-name="${FONT.kai}"`)
  })

  it('indents each 正文 paragraph 左空二字 as a first line, so 回行 comes back to the margin (§ 7.3.3)', () => {
    expect(style('Body')).toContain(`fo:text-indent="${mm(2 * CHAR_WIDTH_MM) as string}"`)
    expect(style('Body')).not.toContain('fo:margin-left=')
  })

  it('leaves the 发文字号 and the 签发人 a tab stop at the far edge of the 字 between their indents', () => {
    expect(style('DocNumberUpward'))
      .toContain(`style:position="${mm((CHARS_PER_LINE - 2) * CHAR_WIDTH_MM) as string}"`)
  })

  it('sets the 抄送机关 and the 印发机关 in 四号 (§ 7.4.2, § 7.4.3)', () => {
    expect(style('CopyTo')).toContain(`fo:font-size="${pt(TYPE_SIZE_PT.h4) as string}"`)
    expect(style('Printer')).toContain(`fo:font-size="${pt(TYPE_SIZE_PT.h4) as string}"`)
  })

  it('sets the 签发人姓名 in 楷体 (§ 7.2.6)', () => {
    expect(style(SIGNER_TEXT_STYLE)).toContain(`style:font-name="${FONT.kai}"`)
  })

  it('puts the 成文日期 右空四字 (§ 7.3.5.4)', () => {
    expect(style('IssueDate')).toContain(`fo:margin-right="${mm(4 * CHAR_WIDTH_MM) as string}"`)
  })
})
