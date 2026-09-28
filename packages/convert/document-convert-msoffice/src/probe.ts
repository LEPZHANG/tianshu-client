/**
 * Deciding which Office applications this machine can actually drive, and which suite would answer.
 *
 * Two questions, one registry read. `[Type]::GetTypeFromProgID` resolves a ProgID through the registry
 * without starting the application, which is what makes this affordable as an apply-time probe: the
 * conversion seam requires `available()` to be cheap and synchronous, so every provider samples once
 * here and returns the cached verdict afterwards.
 *
 * The second question is the one a ProgID alone cannot answer. A WPS Office installation routinely
 * registers itself as `Word.Application`, and the seam verifies only that a conversion produced a file
 * of the target's type — not that the right application produced it. Reading the class's
 * `LocalServer32`, the command line COM would launch, is therefore not a refinement: without it the
 * whole priority ordering is a guess, and `msoffice-word` would drive WPS while reporting that
 * Microsoft Word ran.
 * @module @deepseek-ai/dsh-document-convert-msoffice/probe
 */

import type { Context } from '@deepseek-ai/cordis'
import { OFFICE_PROGRAMS } from './programs.ts'
import type { OfficeEngine, OfficeProgram } from './programs.ts'
import { powershellLiteral } from './powershell.ts'

/** Bytes of probe output retained: six lines of a ProgID and a program path. */
const PROBE_OUTPUT_BYTES = 8_000

/** Whether one application can be driven, and when not, what stands in the way. */
export type OfficeProgramStatus =
  /** The ProgID resolves and its class server is this application's own executable. */
  | { readonly kind: 'available'; readonly server: string }
  /** The ProgID does not resolve: this application is not installed. */
  | { readonly kind: 'absent' }
  /**
   * The ProgID resolves but its class server could not be read, so which suite would answer is unknown.
   * Treated as unusable: running an unidentified converter is the outcome this probe exists to prevent.
   */
  | { readonly kind: 'unverifiable' }
  /** The ProgID resolves to another suite's executable — routinely WPS holding Microsoft Office's ProgID. */
  | {
    readonly kind: 'mismatched'
    /** The executable `LocalServer32` names, as read. */
    readonly server: string
    /** Which suite owns that executable, when this package recognizes it. */
    readonly engine: OfficeEngine | undefined
  }

/** One application paired with what the probe concluded about it. */
export interface OfficeProgramVerdict {
  readonly program: OfficeProgram
  readonly status: OfficeProgramStatus
}

/** What one probe established: the shell that will run conversions, and each application's verdict. */
export interface OfficeProbe {
  /** The resolved PowerShell executable, absent off Windows or when the machine has none. */
  readonly shell: string | undefined
  /**
   * Every application's verdict, in {@link OFFICE_PROGRAMS} order. A list of pairs rather than a lookup
   * table because every caller registers one provider per entry: a map would make the exhaustiveness the
   * probe already guarantees look like something the caller has to handle.
   */
  readonly verdicts: readonly OfficeProgramVerdict[]
}

/** What the probe needs to know before it runs. */
export interface OfficeProbeOptions {
  /** The host platform; anything other than `win32` skips the probe and registers nothing usable. */
  readonly platform: string
  /** The PowerShell executable to resolve. */
  readonly shellBinary: string
  /** SIGTERM→SIGKILL grace period for the probe run, in milliseconds. */
  readonly graceMs: number
}

/**
 * The script that reports every resolvable ProgID with the command line COM would launch for it.
 *
 * `HKCU` is read before `HKLM` because a per-user Office installation — what Click-to-Run produces for
 * a user without administrative rights — registers its classes there and leaves `HKLM` empty. Checking
 * only the machine hive would report those installations as unverifiable and refuse to use them.
 * @param programs - the applications to ask about.
 * @returns a PowerShell script writing one `<ProgID>\t<LocalServer32>` line per resolvable ProgID.
 */
export function buildProbeScript(programs: readonly OfficeProgram[]): string {
  const progIds = programs.map(program => powershellLiteral(program.progId)).join(', ')
  return String.raw`$ErrorActionPreference = 'SilentlyContinue'
foreach ($id in @(${progIds})) {
  $type = [Type]::GetTypeFromProgID($id)
  if ($type -ne $null) {
    $server = ''
    foreach ($root in @('HKCU:\SOFTWARE\Classes\CLSID', 'HKLM:\SOFTWARE\Classes\CLSID')) {
      if ($server -eq '') {
        $key = $root + '\{' + $type.GUID.ToString() + '}\LocalServer32'
        $value = (Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).'(default)'
        if ($value) { $server = [string]$value }
      }
    }
    Write-Output ($id + [char]9 + $server)
  }
}
exit 0`
}

/**
 * The resolvable ProgIDs and their class servers, read from the probe's output.
 * @param stdout - the probe script's standard output.
 * @returns each reported ProgID mapped to its `LocalServer32` value, empty when the key was unreadable.
 */
export function parseProbeOutput(stdout: string): ReadonlyMap<string, string> {
  const registry = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    registry.set(line.slice(0, tab).trim(), line.slice(tab + 1).trim())
  }
  return registry
}

/**
 * The executable a `LocalServer32` value names, lowercased and without its directory.
 *
 * The value is a command line rather than a path: Office registers
 * `"C:\Program Files\…\WINWORD.EXE" /Automation`. A quoted path is taken whole, which is the form every
 * suite writes; an unquoted one is cut at the first switch so a directory containing spaces survives.
 * @param localServer32 - the registry value.
 * @returns the executable's lowercase basename, or `undefined` when the value names none.
 */
export function serverExecutableName(localServer32: string): string | undefined {
  const value = localServer32.trim()
  if (value.length === 0) return undefined
  const path = value.startsWith('"') ? quotedPath(value) : value.split(/\s+[-/]/)[0] as string
  const start = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1
  const name = path.slice(start).trim().toLowerCase()
  return name.length === 0 ? undefined : name
}

/**
 * One application's verdict, given what the probe read.
 * @param program - the application.
 * @param registry - the probe's ProgID-to-`LocalServer32` map.
 * @returns whether it can be driven, and when not, why.
 */
export function programStatus(
  program: OfficeProgram,
  registry: ReadonlyMap<string, string>,
): OfficeProgramStatus {
  const localServer32 = registry.get(program.progId)
  if (localServer32 === undefined) return { kind: 'absent' }
  const server = serverExecutableName(localServer32)
  if (server === undefined) return { kind: 'unverifiable' }
  if (server === program.server) return { kind: 'available', server }
  return { kind: 'mismatched', server, engine: engineOwning(server) }
}

/** The path a quoted `LocalServer32` command line opens with, less its quotes. */
function quotedPath(value: string): string {
  const end = value.indexOf('"', 1)
  return end === -1 ? value.slice(1) : value.slice(1, end)
}

/** Which suite ships one executable, when this package knows it. */
function engineOwning(server: string): OfficeEngine | undefined {
  return OFFICE_PROGRAMS.find(program => program.server === server)?.engine
}

/**
 * A sentence explaining a verdict that hides an installed application, or nothing when the verdict needs
 * no explanation. An absent ProgID means the suite is not installed, which is the ordinary case on most
 * machines and is not worth saying.
 * @param program - the application.
 * @param status - its verdict.
 * @returns the explanation, or `undefined`.
 */
export function describeProgramStatus(
  program: OfficeProgram,
  status: OfficeProgramStatus,
): string | undefined {
  switch (status.kind) {
    case 'available':
    case 'absent':
      return undefined
    case 'unverifiable':
      return `${program.id} is disabled: ${program.progId} is registered but its class server could not be `
        + 'read, so which application it would start is unknown. A conversion would produce a file of the '
        + 'right type from an unidentified converter.'
    case 'mismatched':
      return `${program.id} is disabled: ${program.progId} is registered to ${status.server} rather than `
        + program.server
        + (status.engine === undefined
          ? ', so it does not start the application this provider drives.'
          : `, so it starts ${status.engine === 'wps' ? 'WPS Office' : 'Microsoft Office'} instead. The `
            + `${status.engine} providers cover that suite.`)
    /* v8 ignore next 2 -- OfficeProgramStatus is closed and every member is handled above */
    default:
      return assertNever(status)
  }
}

/* v8 ignore start -- reachable only from a status member this module does not declare */
/** Refuse a value a closed `switch` should have handled. */
function assertNever(value: never): never {
  throw new Error(`document-convert-msoffice: unhandled probe status ${JSON.stringify(value)}`)
}
/* v8 ignore stop */

/**
 * Probe this machine once for every Office application, before any provider registers.
 *
 * A non-Windows host, an unresolvable PowerShell, and a probe that failed are all reported the same way:
 * every application absent. None of them is an error — the seam plans around unavailable providers, and
 * LibreOffice serves the same routes at a lower rank.
 * @param ctx - context carrying the `subprocess` seam.
 * @param options - the platform, shell, and grace period.
 * @param signal - aborts the probe.
 * @returns the resolved shell and every application's verdict.
 */
export async function probeOfficePrograms(
  ctx: Context,
  options: OfficeProbeOptions,
  signal?: AbortSignal,
): Promise<OfficeProbe> {
  if (options.platform !== 'win32') return { shell: undefined, verdicts: allAbsent() }
  const shell = await ctx.subprocess
    .resolveExecutable(options.shellBinary, undefined, signal)
    .catch(() => undefined)
  if (shell === undefined) return { shell: undefined, verdicts: allAbsent() }
  const handle = ctx.subprocess.spawn({
    // `-Command` rather than `-File`: it is not subject to the execution policy, so the probe works on a
    // domain-managed machine that forbids running scripts.
    argv: [shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', buildProbeScript(OFFICE_PROGRAMS)],
    // The probe reads the registry and touches no path, so the harness process's own directory — the only
    // one guaranteed to exist — satisfies the spawn seam's requirement without meaning anything.
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: PROBE_OUTPUT_BYTES },
      // The seam has no discard disposition, and an undrained stream would stall the child once its pipe
      // filled; a bounded collector nobody reads is how this run ignores diagnostics.
      stderr: { maxBytes: PROBE_OUTPUT_BYTES },
    },
    graceMs: options.graceMs,
    signal,
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0) return { shell, verdicts: allAbsent() }
  const registry = parseProbeOutput(handle.collected.stdout?.readFrom(0).text ?? '')
  return {
    shell,
    verdicts: OFFICE_PROGRAMS.map(program => ({ program, status: programStatus(program, registry) })),
  }
}

/** Every application reported absent, for a machine the probe could not or need not ask. */
function allAbsent(): readonly OfficeProgramVerdict[] {
  return OFFICE_PROGRAMS.map(program => ({ program, status: { kind: 'absent' } }))
}
