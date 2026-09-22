/**
 * The ODF style layer: every named paragraph style GB/T 9704—2012 implies, plus the page layout and the
 * odd/even 页码 master pages, emitted as `styles.xml`.
 *
 * Layout lives in styles rather than in the text because the standard's rules are typographic — 左空二字,
 * 空二行, 右空四字, 与版心等宽的分隔线. Each style below names the clause it answers to, so a reader can
 * check one style against one clause; the content layer then only decides which style each element gets.
 * @module @deepseek-ai/dsh-tool-official-document/odf
 */

import {
  BODY_LETTER_SPACING_PT,
  CHAR_WIDTH_MM,
  CHARS_PER_LINE,
  COLOPHON_RULE_HEAVY_MM,
  COLOPHON_RULE_LIGHT_MM,
  FONT,
  HEADER_RULE_GAP_MM,
  HEADER_RULE_THICKNESS_MM,
  LINE_HEIGHT_MM,
  MARGIN_BINDING_MM,
  MARGIN_BOTTOM_BODY_MM,
  MARGIN_OUTER_MM,
  MARGIN_TOP_MM,
  OFFICIAL_BLACK,
  OFFICIAL_RED,
  PAGE_HEIGHT_MM,
  PAGE_NUMBER_HEIGHT_MM,
  PAGE_NUMBER_OFFSET_MM,
  PAGE_WIDTH_MM,
  REQUIRED_FONTS,
  TYPE_SIZE_PT,
} from './metrics.ts'

/** The namespace declarations both ODF parts carry, written once so the two files cannot drift apart. */
export const ODF_NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'office:version="1.3"',
].join(' ')

/** The XML declaration every part of the package starts with. */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

/** The hairline pitch of a paragraph that carries nothing but a rule. */
const RULE_LINE_HEIGHT_MM = 0.1

/**
 * Escape text for an XML text node or a double-quoted attribute value.
 * @param value - the raw text.
 * @returns the text with `&`, `<`, `>`, and `"` replaced by entities.
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Render attributes, dropping the ones with no value so every optional style property can be passed
 * unconditionally.
 * @param pairs - attribute name and value, in the order they should appear.
 * @returns the attributes, each with a leading space, or the empty string.
 */
export function attributes(pairs: readonly (readonly [string, string | undefined])[]): string {
  return pairs
    .filter((pair): pair is readonly [string, string] => pair[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('')
}

/**
 * A length in millimetres, as ODF writes it. Rounded to a micrometre so derived values such as the line
 * pitch do not carry seventeen digits into the file.
 * @param value - the length in millimetres, or undefined to omit the attribute.
 * @returns the ODF length, or undefined.
 */
export function mm(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Number(value.toFixed(3))}mm`
}

/**
 * A length in points, as ODF writes it.
 * @param value - the length in points, or undefined to omit the attribute.
 * @returns the ODF length, or undefined.
 */
export function pt(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Number(value.toFixed(3))}pt`
}

/** Multiply a count of 字 or of grid lines into an ODF length, passing undefined through. */
function scale(count: number | undefined, unitMm: number): string | undefined {
  return count === undefined ? undefined : mm(count * unitMm)
}

/**
 * The text properties of one style.
 *
 * ODF keeps a separate typeface and size for each of the Western, Asian, and complex scripts, and `fo:`
 * carries only the Western pair. Setting it alone leaves every Chinese character at the reader's default
 * face and size, which is how a document with correct-looking markup still comes out with a 二号标题 set
 * in whatever the machine felt like — so both pairs are written, and a test asserts the Asian one.
 */
function textProperties(
  font: string | undefined,
  sizePt: number | undefined,
  color: string | undefined,
  tracked: boolean | undefined,
): string {
  return attributes([
    ['style:font-name', font],
    ['style:font-name-asian', font],
    ['fo:font-size', pt(sizePt)],
    ['style:font-size-asian', pt(sizePt)],
    ['fo:color', color],
    ['fo:letter-spacing', tracked === true ? pt(BODY_LETTER_SPACING_PT) : undefined],
  ])
}

/** One paragraph style, in the terms the clauses use rather than in ODF attribute names. */
export interface ParagraphStyleSpec {
  /** The style name the content layer refers to. */
  readonly name: string
  /** The style this one varies, defaulting to `Standard`. */
  readonly parent?: string
  /** Typeface, defaulting to the 仿宋体 of § 5.2.2 when absent. */
  readonly font?: string
  /** Type size in points, defaulting to 三号 when absent. */
  readonly sizePt?: number
  /** Ink colour, defaulting to black when absent. */
  readonly color?: string
  /** Horizontal alignment; absent means the flush-left default. */
  readonly align?: 'center' | 'end'
  /** 空N行 above this element, in whole lines of the § 5.2.3 grid. */
  readonly blankLinesAbove?: number
  /** Space above this element as a length, for the clauses that state millimetres instead of lines. */
  readonly spaceAboveMm?: number
  /** 左空N字. */
  readonly indentLeftChars?: number
  /** 右空N字. */
  readonly indentRightChars?: number
  /** First-line indent in 字; negative values hang the first line left of the rest. */
  readonly firstLineChars?: number
  /** A rule drawn under the paragraph, as `[thicknessMm, color]`. */
  readonly ruleBelow?: readonly [number, string]
  /** A right-aligned tab stop this many 字 in from the paragraph's own left edge. */
  readonly tabStopChars?: number
  /** Override the § 5.2.3 line pitch, for paragraphs that carry only a rule. */
  readonly lineHeightMm?: number
  /** Whether the § 5.2.3 tracking applies; only the 正文 grid needs it. */
  readonly tracked?: boolean
}

/**
 * Emit one paragraph style. Every style descends from `Standard` unless it names another parent, so
 * anything a spec leaves out falls back to the 三号仿宋 § 5.2.2 sets for elements it does not name.
 * @param spec - the style in clause terms.
 * @returns the `<style:style>` element.
 */
export function paragraphStyle(spec: ParagraphStyleSpec): string {
  const tabStops = spec.tabStopChars === undefined
    ? ''
    : '<style:tab-stops>'
      + `<style:tab-stop style:position="${mm(spec.tabStopChars * CHAR_WIDTH_MM) as string}" style:type="right"/>`
      + '</style:tab-stops>'
  const paragraph = attributes([
    ['fo:text-align', spec.align],
    [
      'fo:margin-top',
      spec.spaceAboveMm === undefined ? scale(spec.blankLinesAbove, LINE_HEIGHT_MM) : mm(spec.spaceAboveMm),
    ],
    ['fo:margin-left', scale(spec.indentLeftChars, CHAR_WIDTH_MM)],
    ['fo:margin-right', scale(spec.indentRightChars, CHAR_WIDTH_MM)],
    ['fo:text-indent', scale(spec.firstLineChars, CHAR_WIDTH_MM)],
    ['fo:line-height', mm(spec.lineHeightMm)],
    [
      'fo:border-bottom',
      spec.ruleBelow === undefined ? undefined : `${mm(spec.ruleBelow[0]) as string} solid ${spec.ruleBelow[1]}`,
    ],
  ])
  const text = textProperties(spec.font, spec.sizePt, spec.color, spec.tracked)
  return `<style:style style:name="${escapeXml(spec.name)}" style:family="paragraph"`
    + ` style:parent-style-name="${escapeXml(spec.parent ?? 'Standard')}">`
    + `<style:paragraph-properties${paragraph}>${tabStops}</style:paragraph-properties>`
    + `<style:text-properties${text}/>`
    + '</style:style>'
}

/**
 * Emit a character style, which the 上行文 header line needs: § 7.2.6 sets 「签发人：」 in 仿宋体 and the
 * name beside it in 楷体, so one paragraph carries two typefaces.
 * @param name - the style name.
 * @param font - the typeface for the run.
 * @returns the `<style:style>` element.
 */
export function textStyle(name: string, font: string): string {
  return `<style:style style:name="${escapeXml(name)}" style:family="text">`
    + `<style:text-properties${textProperties(font, undefined, undefined, undefined)}/>`
    + '</style:style>'
}

/**
 * Every paragraph style the layout uses, each answering to the clause named in its comment. These names
 * are the vocabulary the content layer selects from.
 *
 * Two elements need more than a fixed style because their position depends on the document rather than on
 * the standard alone: the 发文机关标志's distance from the top of the 版心 depends on how many of
 * § 7.2.1–7.2.3 sit above it, and the 发文机关署名's centring depends on the width of the date it is
 * centred over. Both get an automatic style varying `Issuer` and `Signature`.
 */
export const PARAGRAPH_STYLES: readonly ParagraphStyleSpec[] = [
  /** 份号 (§ 7.2.1): 顶格编排在版心左上角第一行. § 5.2.2 leaves its typeface at the 仿宋体 default. */
  { name: 'CopyNumber' },
  /** 密级和保密期限 (§ 7.2.2): 3号黑体, 顶格. */
  { name: 'Secrecy', font: FONT.hei },
  /** 紧急程度 (§ 7.2.3): 3号黑体, 顶格. */
  { name: 'Urgency', font: FONT.hei },
  /**
   * 发文机关标志 (§ 7.2.4): 小标宋体, red, centred. The clause caps the mark at 22 mm × 15 mm without
   * fixing a type size; 二号 stays inside that cap and matches the 标题, so the two agree.
   */
  { name: 'Issuer', font: FONT.xiaobiaosong, sizePt: TYPE_SIZE_PT.h2, color: OFFICIAL_RED, align: 'center' },
  /** 发文字号 (§ 7.2.5) on a 下行文: 发文机关标志下空二行, 居中. */
  { name: 'DocNumber', align: 'center', blankLinesAbove: 2 },
  /**
   * 发文字号 (§ 7.2.5) on an 上行文: 居左空一字, sharing its line with the 签发人, which § 7.2.6 puts
   * 居右空一字 — a right tab stop at the far edge of the 26 字 left between the two indents.
   */
  {
    name: 'DocNumberUpward',
    blankLinesAbove: 2,
    indentLeftChars: 1,
    indentRightChars: 1,
    tabStopChars: CHARS_PER_LINE - 2,
  },
  /**
   * 红色分隔线 (§ 7.2.7): 与版心等宽, 4 mm below the 发文字号. An empty paragraph carrying only a bottom
   * border is how ODF draws a rule; its pitch is cut to a hairline so the stated 4 mm is the whole gap.
   */
  {
    name: 'HeaderRule',
    sizePt: 1,
    lineHeightMm: RULE_LINE_HEIGHT_MM,
    spaceAboveMm: HEADER_RULE_GAP_MM - RULE_LINE_HEIGHT_MM,
    ruleBelow: [HEADER_RULE_THICKNESS_MM, OFFICIAL_RED],
  },
  /** 标题 (§ 7.3.1): 2号小标宋体, 红色分隔线下空二行, 居中. */
  { name: 'Title', font: FONT.xiaobiaosong, sizePt: TYPE_SIZE_PT.h2, align: 'center', blankLinesAbove: 2 },
  /** 主送机关 (§ 7.3.2): 标题下空一行, 居左顶格, 回行时仍顶格. */
  { name: 'Recipient', blankLinesAbove: 1 },
  /** 正文 (§ 7.3.3): 每个自然段左空二字, 回行顶格 — a first-line indent, not a left margin. */
  { name: 'Body', firstLineChars: 2, tracked: true },
  /** 第一层层次序数 (§ 7.3.3): 黑体. */
  { name: 'BodyLevel1', parent: 'Body', font: FONT.hei },
  /** 第二层层次序数 (§ 7.3.3): 楷体. */
  { name: 'BodyLevel2', parent: 'Body', font: FONT.kai },
  /**
   * 附件说明 (§ 7.3.4): 正文下空一行, 左空二字编排「附件：」, 回行时与附件说明的首字对齐 — a hanging
   * indent three 字 deep, the width of 「附件：」.
   */
  { name: 'Attachment', blankLinesAbove: 1, indentLeftChars: 5, firstLineChars: -3 },
  /** Second and later attachment titles (§ 7.3.4), aligned under the first one. */
  { name: 'AttachmentMore', indentLeftChars: 5 },
  /** 发文机关署名 (§ 7.3.5.2): the parent of the automatic style that centres it over the 成文日期. */
  { name: 'Signature', align: 'end', blankLinesAbove: 1 },
  /** 成文日期 (§ 7.3.5.4): 右空四字. */
  { name: 'IssueDate', align: 'end', indentRightChars: 4 },
  /** 附注 (§ 7.3.6): 成文日期下一行, 左空二字, 加圆括号. */
  { name: 'Note', indentLeftChars: 2 },
  /** 版记 first and last 分隔线 (§ 7.4.1): 粗线, 与版心等宽. */
  {
    name: 'ColophonRuleHeavy',
    sizePt: 1,
    lineHeightMm: RULE_LINE_HEIGHT_MM,
    blankLinesAbove: 1,
    ruleBelow: [COLOPHON_RULE_HEAVY_MM, OFFICIAL_BLACK],
  },
  /** 版记 interior 分隔线 (§ 7.4.1): 细线. */
  {
    name: 'ColophonRuleLight',
    sizePt: 1,
    lineHeightMm: RULE_LINE_HEIGHT_MM,
    ruleBelow: [COLOPHON_RULE_LIGHT_MM, OFFICIAL_BLACK],
  },
  /** 抄送机关 (§ 7.4.2): 4号仿宋, 左右各空一字, 回行时与冒号后的首字对齐. */
  { name: 'CopyTo', sizePt: TYPE_SIZE_PT.h4, indentLeftChars: 4, indentRightChars: 1, firstLineChars: -3 },
  /** 印发机关和印发日期 (§ 7.4.3): 4号仿宋, 印发机关左空一字, 印发日期右空一字. */
  {
    name: 'Printer',
    sizePt: TYPE_SIZE_PT.h4,
    indentLeftChars: 1,
    indentRightChars: 1,
    tabStopChars: CHARS_PER_LINE - 2,
  },
  /** 页码 (§ 7.5): 4号半角宋体, 单页码居右空一字. */
  { name: 'PageNumberOdd', font: FONT.song, sizePt: TYPE_SIZE_PT.h4, align: 'end', indentRightChars: 1 },
  /** 页码 (§ 7.5): 双页码居左空一字. */
  { name: 'PageNumberEven', font: FONT.song, sizePt: TYPE_SIZE_PT.h4, indentLeftChars: 1 },
]

/** 签发人姓名 (§ 7.2.6): 3号楷体, set as a run inside the 上行文 header line. */
export const SIGNER_TEXT_STYLE = 'SignerName'

/** Declare a typeface so a reader that has it uses it and one that does not knows what was asked for. */
function fontFace(name: string): string {
  return `<style:font-face style:name="${escapeXml(name)}" svg:font-family="${escapeXml(name)}"/>`
}

/**
 * `Standard`, the parent of every other style: 三号仿宋体 (§ 5.2.2) on the fixed 22-line grid of § 5.2.3.
 * The pitch is a length rather than a percentage because § 5.2.3 fixes how many lines must fill the 版心,
 * not a multiple of the type size.
 */
function standardStyle(): string {
  return '<style:style style:name="Standard" style:family="paragraph">'
    + `<style:paragraph-properties fo:line-height="${mm(LINE_HEIGHT_MM) as string}" fo:text-align="start"/>`
    + `<style:text-properties${textProperties(FONT.fangsong, TYPE_SIZE_PT.h3, OFFICIAL_BLACK, undefined)}/>`
    + '</style:style>'
}

/**
 * The A4 page of § 5.1 with the 版心 of § 5.2.1. `mirrored` keeps the 28 mm 订口 on the binding side of
 * each leaf, which is the arrangement § 7.5 assumes when it moves the page number between outer corners.
 */
function pageLayout(): string {
  return '<style:page-layout style:name="OfficialPage" style:page-usage="mirrored">'
    + '<style:page-layout-properties'
    + attributes([
      ['fo:page-width', mm(PAGE_WIDTH_MM)],
      ['fo:page-height', mm(PAGE_HEIGHT_MM)],
      ['style:print-orientation', 'portrait'],
      ['fo:margin-top', mm(MARGIN_TOP_MM)],
      ['fo:margin-bottom', mm(MARGIN_BOTTOM_BODY_MM)],
      ['fo:margin-left', mm(MARGIN_BINDING_MM)],
      ['fo:margin-right', mm(MARGIN_OUTER_MM)],
    ])
    + '/><style:footer-style><style:header-footer-properties'
    + attributes([
      ['fo:min-height', mm(PAGE_NUMBER_HEIGHT_MM)],
      ['fo:margin-top', mm(PAGE_NUMBER_OFFSET_MM)],
      ['style:dynamic-spacing', 'false'],
    ])
    + '/></style:footer-style></style:page-layout>'
}

/**
 * 页码 (§ 7.5): 一字线 either side of the numeral. An em dash is exactly one 字 wide in the CJK faces the
 * standard names, so it is the 一字线.
 */
function pageNumberFooter(styleName: string): string {
  return `<style:footer><text:p text:style-name="${styleName}">`
    + '—<text:page-number text:select-page="current">1</text:page-number>—'
    + '</text:p></style:footer>'
}

/** The odd and even master pages, each naming the other as its successor so the footer alternates sides. */
function masterPages(): string {
  return '<style:master-page style:name="Standard" style:page-layout-name="OfficialPage"'
    + ' style:next-style-name="OfficialEven">'
    + pageNumberFooter('PageNumberOdd')
    + '</style:master-page>'
    + '<style:master-page style:name="OfficialEven" style:page-layout-name="OfficialPage"'
    + ' style:next-style-name="Standard">'
    + pageNumberFooter('PageNumberEven')
    + '</style:master-page>'
}

/**
 * Build `styles.xml`: the typefaces of § 5.2.2, every style in {@link PARAGRAPH_STYLES}, the A4 page
 * layout of § 5.1 and § 5.2.1, and the two master pages that alternate the 页码 of § 7.5.
 *
 * Nothing here depends on the document, so every file this tool writes carries the same bytes.
 * @returns the `styles.xml` part, as UTF-8 text.
 */
export function buildStyles(): string {
  return `${XML_DECLARATION}<office:document-styles ${ODF_NAMESPACES}>`
    + `<office:font-face-decls>${REQUIRED_FONTS.map(fontFace).join('')}</office:font-face-decls>`
    + '<office:styles>'
    + standardStyle()
    + PARAGRAPH_STYLES.map(paragraphStyle).join('')
    + textStyle(SIGNER_TEXT_STYLE, FONT.kai)
    + '</office:styles>'
    + `<office:automatic-styles>${pageLayout()}</office:automatic-styles>`
    + `<office:master-styles>${masterPages()}</office:master-styles>`
    + '</office:document-styles>'
}
