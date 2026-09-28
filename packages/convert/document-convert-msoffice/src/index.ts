/**
 * `@deepseek-ai/dsh-document-convert-msoffice`: registers Microsoft Office and WPS Office as conversion
 * providers on `ctx.documentConvert`, driven over COM on Windows. A function/namespace plugin (NOT a
 * default-export service).
 *
 * Six providers, one per application per suite, because Office is installed per application and
 * `available()` belongs to a provider rather than to a route: a machine with Word but no PowerPoint keeps
 * the Word routes instead of losing all of them. Microsoft Office outranks WPS and both outrank
 * LibreOffice, so the seam prefers the application that owns the format and falls back to LibreOffice
 * where neither suite is installed.
 *
 * This plugin mounts on every platform. Off Windows, and on a Windows machine with neither suite, all six
 * providers register as unavailable and the seam plans around them — the same outcome as a machine without
 * LibreOffice.
 * @module @deepseek-ai/dsh-document-convert-msoffice
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-document-convert'
import type {} from '@deepseek-ai/dsh-subprocess'
import { probeOfficePrograms } from './probe.ts'
import { OfficeConvertProvider } from './provider.ts'

export { OFFICE_CONVERSIONS, officeRoutes, PDF_REFLOW_CAVEAT, PDF_REFLOW_TARGETS } from './conversions.ts'
export type { OfficeConversions } from './conversions.ts'
export { OFFICE_PROGRAMS, processName } from './programs.ts'
export type { OfficeDialect, OfficeEngine, OfficeProgram } from './programs.ts'
export { powershellLiteral } from './powershell.ts'
export {
  buildProbeScript,
  describeProgramStatus,
  parseProbeOutput,
  probeOfficePrograms,
  programStatus,
  serverExecutableName,
} from './probe.ts'
export type {
  OfficeProbe,
  OfficeProbeOptions,
  OfficeProgramStatus,
  OfficeProgramVerdict,
} from './probe.ts'
export { buildConversionScript, parseSpawnedPids } from './script.ts'
export type { ConversionScriptRequest } from './script.ts'
export { OfficeConvertProvider } from './provider.ts'
export type { OfficeProviderOptions } from './provider.ts'

/** Node coerces a larger timer delay to 1 ms, so the grace period is bounded by it. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Cordis plugin name used by loader diagnostics. */
export const name = 'document-convert-msoffice'

/** The services these providers need: the conversion seam they join and the process seam they run through. */
export const inject = ['documentConvert', 'subprocess']

/** Plugin config: which shell drives COM, where conversions may write, and how the suites rank. */
export interface Config {
  /**
   * The PowerShell executable: a bare PATH name or an absolute path. Windows PowerShell 5.1 is the
   * default because Office COM interop is most thoroughly exercised there and it is present on every
   * Windows installation, while PowerShell 7 is an optional install.
   */
  shellBinary?: string
  /** Parent directory for the scratch directory each conversion creates. */
  workDir?: string
  /**
   * Tie-break rank for Microsoft Office's routes; higher wins. The shipped default outranks both WPS and
   * LibreOffice, so a machine with Microsoft Office converts OOXML through the application that defines
   * the format.
   */
  msofficePriority?: number
  /** Tie-break rank for WPS Office's routes; must differ from {@link Config.msofficePriority}. */
  wpsPriority?: number
  /** SIGTERM→SIGKILL grace period when a conversion is cancelled, in milliseconds. */
  graceMs?: number
}

export const Config: z<Config> = z.object({
  shellBinary: z.string().default('powershell'),
  workDir: z.string().default(tmpdir()),
  msofficePriority: z.number().default(30),
  wpsPriority: z.number().default(25),
  graceMs: z.number().default(3_000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** The grace period feeds a timer, so it must be positive, finite, and within Node's timer range. */
function assertGraceMs(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`document-convert-msoffice: graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Reject a configuration that makes a route unresolvable.
 *
 * Both suites declare the same edges at the same `faithful` fidelity, so equal ranks leave the seam with
 * a tie it refuses as `CONVERT_ROUTE_AMBIGUOUS` — on a machine carrying both suites, and only there.
 * Failing at load instead keeps that from being discovered by a user's conversion.
 */
function assertPriorities(config: ResolvedConfig): void {
  for (const [field, value] of [
    ['msofficePriority', config.msofficePriority],
    ['wpsPriority', config.wpsPriority],
  ] as const) {
    if (!Number.isInteger(value)) throw new Error(`document-convert-msoffice: ${field} must be an integer`)
  }
  if (config.msofficePriority === config.wpsPriority) {
    throw new Error(
      'document-convert-msoffice: msofficePriority and wpsPriority must differ, because both suites '
      + 'declare the same routes at the same fidelity and a machine carrying both could not resolve one',
    )
  }
}

/** A resolved config together with the host platform the probe will be run against. */
export interface OfficeRegistration extends Required<Config> {
  /** The host platform; anything other than `win32` leaves every provider unavailable. */
  readonly platform: string
}

/**
 * Probe the machine once, then register all six providers with that verdict.
 *
 * The platform is a parameter rather than a read of `process.platform` so that a test on any host can
 * exercise the Windows path, which is the only path where these providers do anything.
 * @param ctx - context carrying `documentConvert` and `subprocess`; each registration is effect-scoped
 *   and unregisters on plugin dispose.
 * @param options - the resolved config plus the platform to probe as.
 * @returns the registered providers, in {@link OFFICE_PROGRAMS} order.
 */
export async function registerOfficeProviders(
  ctx: Context,
  options: OfficeRegistration,
): Promise<readonly OfficeConvertProvider[]> {
  const probe = await probeOfficePrograms(ctx, {
    platform: options.platform,
    shellBinary: options.shellBinary,
    graceMs: options.graceMs,
  })
  return probe.verdicts.map(({ program, status }) => {
    const provider = new OfficeConvertProvider(ctx, program, {
      status,
      shell: probe.shell,
      workDir: options.workDir,
      priority: program.engine === 'msoffice' ? options.msofficePriority : options.wpsPriority,
      graceMs: options.graceMs,
    })
    // An installed application this package refuses to drive is worth naming: the machine has Office and
    // conversions will still fall back to LibreOffice, which is otherwise indistinguishable from not
    // having installed Office at all.
    const refused = provider.unavailableBecause()
    if (refused !== undefined) ctx.logger.warn(refused)
    ctx.documentConvert.registerProvider(provider)
    return provider
  })
}

/**
 * Validate the config, then register every provider for this machine.
 * @param ctx - context carrying `documentConvert` and `subprocess`.
 * @param config - the plugin config after schemastery defaults.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const resolved = config as ResolvedConfig
  if (resolved.shellBinary.trim().length === 0) {
    throw new Error('document-convert-msoffice: shellBinary must be a non-empty command name or path')
  }
  assertPriorities(resolved)
  assertGraceMs(resolved.graceMs)
  await registerOfficeProviders(ctx, { ...resolved, platform: process.platform })
}
