/**
 * `@deepseek-ai/dsh-document-convert-pandoc`: registers pandoc as a conversion provider on
 * `ctx.documentConvert`. A function/namespace plugin (NOT a default-export service).
 *
 * pandoc is mounted for the edges that reach or leave HTML, where converting through a document model
 * beats re-encoding a file format: LibreOffice's HTML export is a flat run of positioned `<p>` elements,
 * pandoc's keeps the headings, lists, and tables. The office-to-office edges are declared `lossy` so
 * that LibreOffice, which round-trips those formats themselves, keeps them wherever both are installed.
 * @module @deepseek-ai/dsh-document-convert-pandoc
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-document-convert'
import type {} from '@deepseek-ai/dsh-subprocess'
import { PandocConvertProvider } from './provider.ts'

export { MIN_PANDOC_MAJOR, PANDOC_PROVIDER_ID, PandocConvertProvider, pandocMajor } from './provider.ts'
export type { PandocProviderOptions } from './provider.ts'
export { PANDOC_CONVERSIONS, PANDOC_READERS, PANDOC_WRITERS } from './conversions.ts'
export type { PandocConversion, PandocSourceFormat, PandocTargetFormat } from './conversions.ts'

/** Node coerces a larger timer delay to 1 ms, so the grace period is bounded by it. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used by loader diagnostics. */
export const name = 'document-convert-pandoc'

/** The services this provider needs: the conversion seam it joins and the process seam it runs through. */
export const inject = ['documentConvert', 'subprocess']

/** Plugin config: which pandoc to run and how its routes rank (all defaulted). */
export interface Config {
  /** The pandoc executable: a bare PATH name or an absolute path. */
  binary?: string
  /**
   * Tie-break rank for every route pandoc declares; higher wins. The shipped default outranks
   * LibreOffice so that the HTML edges reach pandoc, while the office-to-office edges stay with
   * LibreOffice regardless — those are declared `lossy`, and fidelity is ranked ahead of priority.
   */
  priority?: number
  /** SIGTERM→SIGKILL grace period when a conversion is cancelled, in milliseconds. */
  graceMs?: number
}

export const Config: z<Config> = z.object({
  binary: z.string().default('pandoc'),
  priority: z.number().default(20),
  graceMs: z.number().default(3_000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Register the pandoc provider after asking the installed pandoc what it can do.
 * @param ctx - context carrying `documentConvert` and `subprocess`; registration is effect-scoped and
 *   unregisters on plugin dispose.
 * @param config - the plugin config after schemastery defaults.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const resolved = config as ResolvedConfig
  if (resolved.binary.trim().length === 0) {
    throw new Error('document-convert-pandoc: the binary must be a non-empty command name or path')
  }
  if (!Number.isInteger(resolved.priority)) {
    throw new Error('document-convert-pandoc: priority must be an integer')
  }
  if (!Number.isFinite(resolved.graceMs) || resolved.graceMs <= 0 || resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`document-convert-pandoc: graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const provider = new PandocConvertProvider(ctx, {
    binary: resolved.binary,
    priority: resolved.priority,
    graceMs: resolved.graceMs,
  })
  await provider.probe()
  ctx.documentConvert.registerProvider(provider)
}
