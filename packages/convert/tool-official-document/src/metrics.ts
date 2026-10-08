/**
 * The fixed measurements of GB/T 9704—2012. Every constant here is a published external specification,
 * so none of it is configurable: a deployment that changed the 版心 to 150 mm would not be producing a
 * Party and government official document at all.
 *
 * Lengths the standard states in millimetres stay in millimetres, because ODF accepts them directly and
 * a converted value could not be checked against the clause it came from. Type sizes are the traditional
 * 号 sizes in points, which is how § 5.2.2 and § 7 name them.
 * @module @deepseek-ai/dsh-tool-official-document/metrics
 */

/** Points per millimetre, for the few places a length must be expressed as type size. */
const POINTS_PER_MM = 72 / 25.4

/** A4, the 幅面 § 5.1 requires, in millimetres. */
export const PAGE_WIDTH_MM = 210

/** A4 height in millimetres (§ 5.1). */
export const PAGE_HEIGHT_MM = 297

/** 天头 — the white margin above the 版心 (§ 5.2.1). */
export const MARGIN_TOP_MM = 37

/** 订口 — the binding margin at the left of the 版心 (§ 5.2.1). */
export const MARGIN_BINDING_MM = 28

/** 版心 width (§ 5.2.1). */
export const TYPE_AREA_WIDTH_MM = 156

/** 版心 height (§ 5.2.1). */
export const TYPE_AREA_HEIGHT_MM = 225

/** The remaining right margin, fixed by the page width and the two values § 5.2.1 states. */
export const MARGIN_OUTER_MM = PAGE_WIDTH_MM - MARGIN_BINDING_MM - TYPE_AREA_WIDTH_MM

/** The remaining bottom margin, fixed by the page height and the two values § 5.2.1 states. */
export const MARGIN_BOTTOM_MM = PAGE_HEIGHT_MM - MARGIN_TOP_MM - TYPE_AREA_HEIGHT_MM

/** Lines per page (§ 5.2.3). */
export const LINES_PER_PAGE = 22

/** Characters per line (§ 5.2.3). */
export const CHARS_PER_LINE = 28

/**
 * Line pitch. § 5.2.3 requires 22 lines that fill the 版心, which fixes the pitch at the 版心 height
 * divided by 22 rather than leaving it to the renderer's default leading.
 */
export const LINE_HEIGHT_MM = TYPE_AREA_HEIGHT_MM / LINES_PER_PAGE

/**
 * The width of 一字 (§ 3.1), the unit § 7 measures horizontal indents in. § 5.2.3 requires 28 characters
 * that fill the 版心, so one character occupies exactly a 28th of it — which is slightly narrower than a
 * 三号 glyph, and {@link BODY_LETTER_SPACING_PT} is the difference that makes the grid come out true.
 */
export const CHAR_WIDTH_MM = TYPE_AREA_WIDTH_MM / CHARS_PER_LINE

/** Type sizes in points, under the traditional 号 names § 5.2.2 and § 7 use. */
export const TYPE_SIZE_PT = {
  /** 二号 — 标题 (§ 7.3.1). */
  h2: 22,
  /** 三号 — the default for every element (§ 5.2.2). */
  h3: 16,
  /** 四号 — 抄送机关, 印发机关和印发日期 (§ 7.4.2, § 7.4.3), and 页码 (§ 7.5). */
  h4: 14,
} as const

/**
 * Tracking applied to 正文 so that 28 三号 characters occupy exactly the 156 mm 版心. A 三号 glyph is
 * 16 pt wide and the grid cell is narrower, so the difference is removed from each character's advance.
 */
export const BODY_LETTER_SPACING_PT = CHAR_WIDTH_MM * POINTS_PER_MM - TYPE_SIZE_PT.h3

/** Distance from the top of the 版心 down to the top of the 发文机关标志 (§ 7.2.4). */
export const ISSUER_OFFSET_MM = 35

/** Distance below the 发文字号 at which the red separator line is printed (§ 7.2.7). */
export const HEADER_RULE_GAP_MM = 4

/** Thickness of the 版记's first and last separator lines — the heavy pair (§ 7.4.1). */
export const COLOPHON_RULE_HEAVY_MM = 0.35

/** Thickness of the 版记's interior separator lines — the light ones (§ 7.4.1). */
export const COLOPHON_RULE_LIGHT_MM = 0.25

/** Distance from the bottom of the 版心 down to the rules flanking the page number (§ 7.5). */
export const PAGE_NUMBER_OFFSET_MM = 7

/** Height reserved for the 页码 line, which holds one 四号 numeral between two 一字线. */
export const PAGE_NUMBER_HEIGHT_MM = 6

/**
 * Bottom margin of the flowing text. ODF places a footer inside the page area rather than inside the
 * bottom margin, so the 页码 footer's gap and height come out of the space below the 版心: the three
 * together must total {@link MARGIN_BOTTOM_MM} for the 版心 to keep the 225 mm § 5.2.1 gives it.
 */
export const MARGIN_BOTTOM_BODY_MM = MARGIN_BOTTOM_MM - PAGE_NUMBER_OFFSET_MM - PAGE_NUMBER_HEIGHT_MM

/**
 * Thickness of the red separator line. § 7.2.7 fixes the line's position and its width but states no
 * height; the 版记's heavy line is the one rule thickness the standard does state, so it is used here too.
 */
export const HEADER_RULE_THICKNESS_MM = COLOPHON_RULE_HEAVY_MM

/**
 * The red of the 发文机关标志 and the separator line. § 6.2 states the press requirement as ink densities
 * (Y 80 %, M 80 %) that the printed result must reach; those are minimums for a press, not a screen
 * value, and full red clears them.
 */
export const OFFICIAL_RED = '#ff0000'

/** Every other element is black (§ 5.2.4). */
export const OFFICIAL_BLACK = '#000000'

/**
 * The five typefaces GB/T 9704—2012 names, under the family names a Chinese word processor knows them
 * by. They are written into the document whether or not this host has them, because the file is read
 * elsewhere; {@link REQUIRED_FONTS} is what a result reports so a reader knows what the page assumes.
 *
 * The names are the Chinese ones the standard uses, which every one of these files also answers to.
 * An OOXML reader resolves a family through the name its document writes, and WPS does not match an
 * embedded face written under the English name alone: a document naming `SimHei` rendered in a
 * substituted face on a machine with no 黑体 installed, while the same document naming 黑体 used the
 * embedded file. See the
 * [naming note](../../../../.agents/notes/implemented/feature/2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md).
 */
export const FONT = {
  /** 仿宋体 — the default for every element (§ 5.2.2). */
  fangsong: '仿宋_GB2312',
  /** 黑体 — 密级, 紧急程度, 第一层层次序数, 出席人员名单 (§ 7.2.2, § 7.2.3, § 7.3.3). */
  hei: '黑体',
  /** 楷体 — 签发人姓名 and 第二层层次序数 (§ 7.2.6, § 7.3.3). */
  kai: '楷体_GB2312',
  /** 小标宋体 — 发文机关标志 and 标题 (§ 7.2.4, § 7.3.1). */
  xiaobiaosong: '方正小标宋简体',
  /** 宋体 — 页码 only, and there in half-width (§ 7.5). */
  song: '宋体',
} as const

/** The typefaces a faithful rendering needs, in the order the standard introduces them. */
export const REQUIRED_FONTS: readonly string[] = [
  FONT.xiaobiaosong,
  FONT.fangsong,
  FONT.hei,
  FONT.kai,
  FONT.song,
]
