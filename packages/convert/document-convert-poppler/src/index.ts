/**
 * `@deepseek-ai/dsh-document-convert-poppler`: registers poppler's `pdftotext` and `pdftohtml` as two
 * separate conversion providers on `ctx.documentConvert`. A function/namespace plugin (NOT a
 * default-export service).
 *
 * Both binaries are resolved during apply. Each registers independently, so a machine carrying only one
 * of them keeps the route that one serves instead of losing both.
 * @module @deepseek-ai/dsh-document-convert-poppler
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConvertRoute } from '@deepseek-ai/dsh-document-convert'
import type {} from '@deepseek-ai/dsh-subprocess'
import { PDFTOHTML_PROVIDER_ID, PDFTOTEXT_PROVIDER_ID, PopplerConvertProvider } from './provider.ts'
import type { PopplerToolSpec } from './provider.ts'

export {
  PDFTOHTML_PROVIDER_ID,
  PDFTOTEXT_PROVIDER_ID,
  PopplerConvertProvider,
} from './provider.ts'
export type { PopplerProviderOptions, PopplerToolSpec } from './provider.ts'

/** Node coerces a larger timer delay to 1 ms, so the grace period is bounded by it. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used by loader diagnostics. */
export const name = 'document-convert-poppler'

/** The services these providers need: the conversion seam they join and the process seam they run through. */
export const inject = ['documentConvert', 'subprocess']

/** Plugin config: which poppler binaries to run and how the extracted routes rank (all defaulted). */
export interface Config {
  /** The `pdftotext` executable: a bare PATH name or an absolute path. */
  pdftotextBinary?: string
  /** The `pdftohtml` executable: a bare PATH name or an absolute path. */
  pdftohtmlBinary?: string
  /**
   * The `pdffonts` executable, used only to explain an extraction that recovered nothing. Its absence
   * costs the explanation, never the conversion.
   */
  pdffontsBinary?: string
  /**
   * Tie-break rank for both extraction routes; higher wins. The shipped default outranks LibreOffice so
   * that `pdf -> html` reaches poppler's text extraction rather than LibreOffice's Draw-mediated export.
   */
  priority?: number
  /** SIGTERM→SIGKILL grace period when an extraction is cancelled, in milliseconds. */
  graceMs?: number
}

export const Config: z<Config> = z.object({
  pdftotextBinary: z.string().default('pdftotext'),
  pdftohtmlBinary: z.string().default('pdftohtml'),
  pdffontsBinary: z.string().default('pdffonts'),
  priority: z.number().default(20),
  graceMs: z.number().default(3_000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** What every PDF extraction costs, whichever tool performs it. */
const PDF_EXTRACTION_CAVEAT = {
  code: 'PDF_TEXT_EXTRACTED',
  message: 'A PDF stores positioned glyphs rather than a document structure, so this is the page text, '
    + 'recovered in reading order. Headings, tables, lists, and columns are approximations, and anything '
    + 'that was an image — including a scanned page — is absent.',
} as const

/**
 * The two tools this package registers.
 *
 * `pdftotext -layout` keeps the reading order and approximate column structure of the page. `pdftohtml`
 * runs with `-s` (one output document rather than per-page files), `-i` (skip images, which would
 * otherwise be written as separate files beside the output) and `-noframes` (a plain document, not a
 * frameset). Both drop the PDF's layout and styling, so both declare `lossy`.
 */
function toolSpecs(config: ResolvedConfig): readonly PopplerToolSpec[] {
  const route = (to: ConvertRoute['to']): ConvertRoute =>
    ({ from: 'pdf', to, fidelity: 'lossy', priority: config.priority })
  return [
    {
      id: PDFTOTEXT_PROVIDER_ID,
      binary: config.pdftotextBinary,
      route: route('txt'),
      flags: ['-layout'],
      caveat: PDF_EXTRACTION_CAVEAT,
    },
    {
      id: PDFTOHTML_PROVIDER_ID,
      binary: config.pdftohtmlBinary,
      route: route('html'),
      flags: ['-s', '-i', '-noframes'],
      caveat: PDF_EXTRACTION_CAVEAT,
    },
  ]
}

/** The grace period feeds a timer, so it must be positive, finite, and within Node's timer range. */
function assertGraceMs(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`document-convert-poppler: graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Register both poppler providers after sampling whether their binaries exist.
 * @param ctx - context carrying `documentConvert` and `subprocess`; registration is effect-scoped and
 *   unregisters on plugin dispose.
 * @param config - the plugin config after schemastery defaults.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const resolved = config as ResolvedConfig
  if (!Number.isInteger(resolved.priority)) {
    throw new Error('document-convert-poppler: priority must be an integer')
  }
  assertGraceMs(resolved.graceMs)

  for (const spec of toolSpecs(resolved)) {
    if (spec.binary.trim().length === 0) {
      throw new Error(`document-convert-poppler: the ${spec.id} binary must be a non-empty command name or path`)
    }
    const provider = new PopplerConvertProvider(ctx, spec, {
      graceMs: resolved.graceMs,
      fontsBinary: resolved.pdffontsBinary,
    })
    await provider.probe()
    ctx.documentConvert.registerProvider(provider)
  }
}
