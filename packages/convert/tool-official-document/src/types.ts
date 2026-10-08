/**
 * The element set of a Party and government official document, as GB/T 9704—2012 § 7.1 divides it: the
 * 版头 (§ 7.2), the 主体 (§ 7.3), and the 版记 (§ 7.4). Every field names one numbered clause, so the
 * layout code and the validator can cite the clause a value answers to rather than an invented rule.
 *
 * Types only — the metrics, the validator, and the ODF writer live in their own modules.
 * @module @deepseek-ai/dsh-tool-official-document/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** The two urgency markings § 7.2.3 admits. A document with neither is ordinary and carries no marking. */
export type OfficialDocumentUrgency = '特急' | '加急'

/** 密级和保密期限 (§ 7.2.2): the classification and how long it holds. */
export interface OfficialDocumentSecrecy {
  /** The classification itself, e.g. 秘密 / 机密 / 绝密. */
  readonly level: string
  /** The period it holds for, e.g. 5年. Omitted when the classification carries no stated period. */
  readonly period?: string
}

/** 版头 (§ 7.2): everything above the red separator line on the first page. */
export interface OfficialDocumentHeader {
  /** 份号 (§ 7.2.1): the copy's serial number, rendered as six digits. */
  readonly copyNumber?: number
  /** 密级和保密期限 (§ 7.2.2). */
  readonly secrecy?: OfficialDocumentSecrecy
  /** 紧急程度 (§ 7.2.3). */
  readonly urgency?: OfficialDocumentUrgency
  /** 发文机关标志 (§ 7.2.4): the issuing body's name, set in red — the 红头 the page is known by. */
  readonly issuer?: string
  /** 发文字号 (§ 7.2.5), e.g. `国办发〔2026〕3号`. */
  readonly docNumber?: string
  /**
   * 签发人 (§ 7.2.6). Present only on an 上行文 — a document addressed upwards — and its presence moves
   * the 发文字号 from centred to the left of the same line, per § 7.2.5.
   */
  readonly signer?: string
}

/**
 * One paragraph of 正文 (§ 7.3.3). `level` selects the structural ordinal and the typeface that marks it;
 * a paragraph without one is ordinary body text.
 */
export interface OfficialDocumentParagraph {
  /** Structural depth 1–4, numbered `一、` / `（一）` / `1.` / `（1）` per § 7.3.3. */
  readonly level?: 1 | 2 | 3 | 4
  /** The paragraph's text, without its ordinal — the layout supplies that. */
  readonly text: string
}

/** 主体 (§ 7.3): from the red separator line down to the 版记. */
export interface OfficialDocumentBody {
  /** 标题 (§ 7.3.1). */
  readonly title: string
  /** 主送机关 (§ 7.3.2): the bodies the document is addressed to. */
  readonly mainRecipients?: readonly string[]
  /** 正文 (§ 7.3.3). */
  readonly paragraphs: readonly OfficialDocumentParagraph[]
  /** 附件说明 (§ 7.3.4): the attachment titles, in order. */
  readonly attachments?: readonly string[]
  /** 发文机关署名 (§ 7.3.5.2). */
  readonly signature?: string
  /** 成文日期 (§ 7.3.5.4) as an ISO `YYYY-MM-DD` calendar date. */
  readonly date?: string
  /** 附注 (§ 7.3.6), laid out in round brackets below the 成文日期. */
  readonly note?: string
}

/** 印发机关和印发日期 (§ 7.4.3). */
export interface OfficialDocumentPrinter {
  /** The body that printed and issued the document. */
  readonly agency: string
  /** The printing date as an ISO `YYYY-MM-DD` calendar date. */
  readonly date: string
}

/** 版记 (§ 7.4): the block on the last page, between its first and last separator lines. */
export interface OfficialDocumentColophon {
  /** 抄送机关 (§ 7.4.2). */
  readonly copyTo?: readonly string[]
  /** 印发机关和印发日期 (§ 7.4.3). */
  readonly printer?: OfficialDocumentPrinter
}

/** A complete official document, divided as § 7.1 divides it. */
export interface OfficialDocument {
  /** 版头 (§ 7.2). */
  readonly header: OfficialDocumentHeader
  /** 主体 (§ 7.3). */
  readonly body: OfficialDocumentBody
  /** 版记 (§ 7.4). */
  readonly colophon: OfficialDocumentColophon
}

/**
 * One statement about the produced document that its structured fields do not carry. Same two fields as
 * the conversion seam's note, and for the same reason: a code the caller can route on, and a message the
 * model can repeat to a user.
 */
export interface OfficialDocumentNote {
  /** Machine-routable, open-string code. */
  readonly code: string
  /** What the reader needs to know, in full. */
  readonly message: string
}

/**
 * A failure of official-document layout, carrying a machine-routable `code`. Validation failures name the
 * GB/T 9704—2012 clause the value violates in their message, because a model that is told which clause it
 * broke can correct the field, while one told only "invalid" retries the same value.
 */
export class OfficialDocumentError extends HarnessError {}

/** A required field is absent or blank. */
export const OFFICIAL_DOC_FIELD_MISSING = 'OFFICIAL_DOC_FIELD_MISSING'

/** A field is present but written in a form the standard forbids. */
export const OFFICIAL_DOC_FIELD_INVALID = 'OFFICIAL_DOC_FIELD_INVALID'

/** The requested output format needs a converter this host does not have. */
export const OFFICIAL_DOC_FORMAT_UNREACHABLE = 'OFFICIAL_DOC_FORMAT_UNREACHABLE'

/** The output file exists and the call did not ask to replace it. */
export const OFFICIAL_DOC_OUTPUT_EXISTS = 'OFFICIAL_DOC_OUTPUT_EXISTS'

/**
 * The four typefaces GB/T 9704—2012 names. A host that lacks them renders substitutes, so every result
 * carries this note code alongside the list.
 */
export const OFFICIAL_DOC_FONTS_REQUIRED = 'OFFICIAL_DOC_FONTS_REQUIRED'

/**
 * The file carries at least one of the standard's typefaces inside it, so those faces render on a
 * machine that never installed them. The note names the carried families and any still left to the
 * reader's own machine.
 */
export const OFFICIAL_DOC_FONTS_EMBEDDED = 'OFFICIAL_DOC_FONTS_EMBEDDED'
