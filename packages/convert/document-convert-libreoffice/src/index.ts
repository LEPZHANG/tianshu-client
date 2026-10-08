/**
 * `@deepseek-ai/dsh-document-convert-libreoffice`: registers the LibreOffice headless conversion
 * provider with `ctx.documentConvert`. A function/namespace plugin (NOT a default-export service): it
 * registers INTO the seam's provider registry.
 *
 * The binary is resolved once during apply, so a composition that mounts this plugin on a machine
 * without LibreOffice gets a registered-but-unusable provider and the seam plans around it, rather than
 * a boot failure.
 * @module @deepseek-ai/dsh-document-convert-libreoffice
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-document-convert'
import type {} from '@deepseek-ai/dsh-subprocess'
import { LibreOfficeConvertProvider } from './provider.ts'

export {
  LIBREOFFICE_PROVIDER_ID,
  LibreOfficeConvertProvider,
} from './provider.ts'
export type { LibreOfficeProviderOptions } from './provider.ts'
export {
  libreOfficeConversion,
  LIBREOFFICE_CONVERSIONS,
} from './filters.ts'
export type { LibreOfficeConversion } from './filters.ts'

/** Node coerces a larger timer delay to 1 ms, so the grace period is bounded by it. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used by loader diagnostics. */
export const name = 'document-convert-libreoffice'

/** The services this provider needs: the conversion seam it joins and the process seam it runs through. */
export const inject = ['documentConvert', 'subprocess']

/** Plugin config: which LibreOffice to run, where it may write, and how it ranks (all defaulted). */
export interface Config {
  /**
   * The executable: a bare PATH name or an absolute path. A macOS installation that keeps `soffice`
   * inside the application bundle needs the absolute path
   * (`/Applications/LibreOffice.app/Contents/MacOS/soffice`).
   */
  binary?: string
  /** Parent directory for the private user profile and output directory each conversion creates. */
  workDir?: string
  /** Tie-break rank against other providers offering the same route at the same fidelity; higher wins. */
  priority?: number
  /** SIGTERM→SIGKILL grace period when a conversion is cancelled, in milliseconds. */
  graceMs?: number
}

export const Config: z<Config> = z.object({
  binary: z.string().default('soffice'),
  workDir: z.string().default(tmpdir()),
  priority: z.number().default(10),
  graceMs: z.number().default(3_000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** The grace period feeds a timer, so it must be positive, finite, and within Node's timer range. */
function assertGraceMs(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`document-convert-libreoffice: graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Register the LibreOffice provider after sampling whether its binary exists.
 * @param ctx - context carrying `documentConvert` and `subprocess`; registration is effect-scoped and
 *   unregisters on plugin dispose.
 * @param config - the plugin config after schemastery defaults.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const resolved = config as ResolvedConfig
  if (resolved.binary.trim().length === 0) {
    throw new Error('document-convert-libreoffice: binary must be a non-empty command name or path')
  }
  if (!Number.isInteger(resolved.priority)) {
    throw new Error('document-convert-libreoffice: priority must be an integer')
  }
  assertGraceMs(resolved.graceMs)

  const provider = new LibreOfficeConvertProvider(ctx, {
    binary: resolved.binary,
    workDir: resolved.workDir,
    priority: resolved.priority,
    graceMs: resolved.graceMs,
  })
  await provider.probe()
  ctx.documentConvert.registerProvider(provider)
}
