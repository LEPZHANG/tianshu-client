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
import { EMPTY_FONTS, applyOfficialDocumentTool } from './tool.ts'
import { loadEmbeddableFonts } from './fonts.ts'
import { REQUIRED_FONTS } from './metrics.ts'

export { buildContent, charUnits, documentElements } from './content.ts'
export { loadEmbeddableFonts, readFontEmbedding, readFontFamilies } from './fonts.ts'
export { buildOdtPackage, ODT_MIMETYPE } from './package.ts'
export {
  attributes,
  buildStyles,
  escapeXml,
  mm,
  LEVEL_HEADING_TEXT_STYLES,
  ODF_EMBEDDED_FONT_NAMESPACES,
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
export {
  applyOfficialDocumentTool,
  assembleOfficialDocument,
  EMPTY_FONTS,
  fontNote,
  officialDocumentTool,
} from './tool.ts'
export {
  OFFICIAL_DOC_FIELD_INVALID,
  OFFICIAL_DOC_FIELD_MISSING,
  OFFICIAL_DOC_FONTS_EMBEDDED,
  OFFICIAL_DOC_FONTS_REQUIRED,
  OFFICIAL_DOC_FORMAT_UNREACHABLE,
  OFFICIAL_DOC_OUTPUT_EXISTS,
  OfficialDocumentError,
} from './types.ts'
export { validateOfficialDocument } from './validate.ts'
export type { EmbeddedFont, FontEmbedding, FontScan } from './fonts.ts'
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

/** Plugin config: the deployment's tool-call budget, and where the typefaces to embed are kept. */
export interface Config {
  /**
   * Cooperative tool-call budget in milliseconds. Writing the `.odt` costs milliseconds; every other
   * format then pays for a LibreOffice start, which is where the budget actually goes.
   */
  timeoutMs?: number
  /**
   * Directory holding the GB/T 9704—2012 `.ttf` files, whose fonts every document written here then
   * carries inside it. Empty, the default, writes documents that only name the typefaces — correct for
   * a host whose readers all have them installed.
   *
   * The fonts are commercially licensed and are not in this repository, so this names a directory the
   * deployment supplies; the desktop application points it at the typefaces inside its own installer.
   * A directory that cannot be read fails at apply rather than producing documents with nothing in them.
   */
  fontDirectory?: string
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(120_000),
  fontDirectory: z.string().default(''),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Register the official-document tool and its prompt section.
 * @param ctx - context carrying `tools`, `systemPrompt`, `documentConvert`, and `fs`; both registrations
 *   are effect-scoped and unregister on plugin dispose.
 * @param config - the plugin config after schemastery defaults.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const { timeoutMs, fontDirectory } = config as ResolvedConfig
  assertTimeoutBudget('tool-official-document', timeoutMs)
  const fonts = fontDirectory === ''
    ? EMPTY_FONTS
    : await loadEmbeddableFonts(fontDirectory, REQUIRED_FONTS)
  applyOfficialDocumentTool(ctx, timeoutMs, fonts)
}
/* jscpd:ignore-end */
