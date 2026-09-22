/**
 * `@deepseek-ai/dsh-tool-official-document`: registers the model-facing `write_official_document` tool,
 * which lays content out to GB/T 9704—2012《党政机关公文格式》. A function/namespace plugin (NOT a
 * default-export service).
 * @module @deepseek-ai/dsh-tool-official-document
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-document-convert'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-tools'
import { assertTimeoutBudget } from '@deepseek-ai/dsh-tool-document-convert'
import { applyOfficialDocumentTool } from './tool.ts'

export { buildContent, charUnits, documentElements } from './content.ts'
export { buildOdtPackage, ODT_MIMETYPE } from './package.ts'
export {
  attributes,
  buildStyles,
  escapeXml,
  mm,
  ODF_NAMESPACES,
  PARAGRAPH_STYLES,
  paragraphStyle,
  pt,
  SIGNER_TEXT_STYLE,
  textStyle,
  XML_DECLARATION,
} from './odf.ts'
export {
  chineseNumeral,
  formatCopyNumber,
  formatOfficialDate,
  isCalendarDate,
  levelFont,
  levelOrdinal,
  numberParagraphs,
} from './numbering.ts'
export {
  DEFAULT_OFFICIAL_DOCUMENT_FORMAT,
  formatOfficialDocumentOutput,
  OFFICIAL_DOCUMENT_FORMATS,
  officialDocumentMetaFromResult,
  officialDocumentMetaFromValue,
  presentOfficialDocumentCall,
  presentOfficialDocumentResult,
  resolveOfficialDocumentFormat,
} from './present.ts'
export { applyOfficialDocumentTool, assembleOfficialDocument, FONT_NOTE, officialDocumentTool } from './tool.ts'
export {
  OFFICIAL_DOC_FIELD_INVALID,
  OFFICIAL_DOC_FIELD_MISSING,
  OFFICIAL_DOC_FONTS_REQUIRED,
  OFFICIAL_DOC_FORMAT_UNREACHABLE,
  OFFICIAL_DOC_OUTPUT_EXISTS,
  OfficialDocumentError,
} from './types.ts'
export { validateOfficialDocument } from './validate.ts'
export type { NumberedParagraph } from './numbering.ts'
export type { ParagraphStyleSpec } from './odf.ts'
export type {
  OfficialDocumentFormat,
  OfficialDocumentMeta,
  OfficialDocumentOutputNote,
  OfficialDocumentOutputValue,
  OfficialDocumentToolArgs,
} from './present.ts'
export type {
  OfficialDocument,
  OfficialDocumentBody,
  OfficialDocumentColophon,
  OfficialDocumentHeader,
  OfficialDocumentNote,
  OfficialDocumentParagraph,
  OfficialDocumentPrinter,
  OfficialDocumentSecrecy,
  OfficialDocumentUrgency,
} from './types.ts'

/* jscpd:ignore-start -- the plugin protocol requires each package to declare its own name/inject/Config/apply */
/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-official-document'

/** The services the tool needs: the registries it joins, the conversion seam, and the filesystem. */
export const inject = ['tools', 'systemPrompt', 'documentConvert', 'fs']

/** Plugin config: the deployment's tool-call budget for writing one document. */
export interface Config {
  /**
   * Cooperative tool-call budget in milliseconds. Writing the `.odt` costs milliseconds; every other
   * format then pays for a LibreOffice start, which is where the budget actually goes.
   */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(120_000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Register the official-document tool and its prompt section.
 * @param ctx - context carrying `tools`, `systemPrompt`, `documentConvert`, and `fs`; both registrations
 *   are effect-scoped and unregister on plugin dispose.
 * @param config - the plugin config after schemastery defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const { timeoutMs } = config as ResolvedConfig
  assertTimeoutBudget('tool-official-document', timeoutMs)
  applyOfficialDocumentTool(ctx, timeoutMs)
}
/* jscpd:ignore-end */
