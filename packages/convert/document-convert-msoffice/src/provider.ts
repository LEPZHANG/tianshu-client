/**
 * One Office application as a conversion provider: each step is one PowerShell run against the
 * application's COM object model.
 *
 * Three properties of automating a desktop application shape this implementation:
 *
 * - **Conversions cannot overlap.** One application instance drives one document at a time, and a second
 *   concurrent `Documents.Open` against the same instance fails in ways that depend on what the first one
 *   was doing. Every conversion this provider performs is therefore queued behind the previous one.
 * - **The output cannot be written in place.** The application writes into a private scratch directory
 *   and the result is moved afterwards, so a run that fails midway leaves nothing at the caller's path.
 * - **The application outlives the shell.** It is a COM server rather than a child process, so the
 *   script records what it started and this provider kills those processes when the run did not end
 *   cleanly. Without that, a cancelled conversion leaves `WINWORD.EXE` holding a document open.
 * @module @deepseek-ai/dsh-document-convert-msoffice/provider
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConvertNote,
  ConvertRoute,
  ConvertStepSpec,
  DocumentConvertProvider,
} from '@deepseek-ai/dsh-document-convert'
import {
  ConvertError, describeDiagnostics, isRegularFile, moveConverted, routeKey, runConverter,
} from '@deepseek-ai/dsh-document-convert'
import { officeRoutes, PDF_REFLOW_CAVEAT } from './conversions.ts'
import { describeProgramStatus } from './probe.ts'
import type { OfficeProgramStatus } from './probe.ts'
import { buildConversionScript, parseSpawnedPids } from './script.ts'
import type { OfficeProgram } from './programs.ts'

/** Bytes of PowerShell diagnostic output retained to explain a failure. */
const STDERR_TAIL_BYTES = 8_000

/** Bytes retained from `taskkill`, which is run for its effect and never read. */
const KILL_OUTPUT_BYTES = 1_000

/**
 * The Windows command that ends a process tree. Fixed rather than configurable: it is part of the
 * operating system this provider only ever runs on.
 */
const TASKKILL = 'taskkill'

/** Everything the provider takes from its plugin config and from the machine probe. */
export interface OfficeProviderOptions {
  /** What the apply-time probe established about this application. */
  readonly status: OfficeProgramStatus
  /** The resolved PowerShell executable, absent when the machine has none. */
  readonly shell: string | undefined
  /** Parent directory for the scratch directory each conversion creates. */
  readonly workDir: string
  /** Tie-break rank for every route this provider declares. */
  readonly priority: number
  /** SIGTERM→SIGKILL grace period for a cancelled run, in milliseconds. */
  readonly graceMs: number
}

/**
 * Converts documents by driving one Office application over COM. Registered into `ctx.documentConvert`.
 *
 * Availability is decided once, when the plugin applies, because `available()` must be cheap and
 * synchronous: an Office installed after the harness started is invisible until the plugin is remounted.
 */
export class OfficeConvertProvider implements DocumentConvertProvider {
  readonly id: string
  readonly routes: readonly ConvertRoute[]

  private readonly ctx: Context
  private readonly program: OfficeProgram
  private readonly options: OfficeProviderOptions
  private readonly served: ReadonlySet<string>
  /** Tail of the conversion queue; every step chains onto it so no two run against one instance. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, program: OfficeProgram, options: OfficeProviderOptions) {
    this.ctx = ctx
    this.program = program
    this.options = options
    this.id = program.id
    this.routes = officeRoutes(program.family, options.priority, program.engine)
    this.served = new Set(this.routes.map(route => routeKey(route.from, route.to)))
  }

  available(): boolean {
    return this.options.status.kind === 'available' && this.options.shell !== undefined
  }

  /**
   * Why this application is unusable, for a composition that expected it to be usable. Absent while it
   * is available.
   * @returns the explanation, or `undefined` when nothing needs saying.
   */
  unavailableBecause(): string | undefined {
    if (this.options.shell === undefined && this.options.status.kind === 'available') {
      return `${this.id} is disabled: no PowerShell was found to drive it`
    }
    return describeProgramStatus(this.program, this.options.status)
  }

  async convert(step: ConvertStepSpec, signal?: AbortSignal): Promise<readonly ConvertNote[]> {
    const run = this.queue.then(() => this.runConversion(step, signal))
    // The queue must survive a failed step, so the chain tracks completion rather than outcome.
    this.queue = run.then(() => {}, () => {})
    return run
  }

  /** Perform one conversion, with this provider's queue already held. */
  private async runConversion(
    step: ConvertStepSpec,
    signal: AbortSignal | undefined,
  ): Promise<readonly ConvertNote[]> {
    const shell = this.options.shell
    // The seam dispatches only steps drawn from this provider's own declared routes; the guard turns a
    // composition that pinned an unreachable one into the seam's own error rather than a COM failure.
    if (shell === undefined || !this.available()) {
      throw new ConvertError(
        this.unavailableBecause() ?? `${this.id} is not available`,
        'CONVERT_PROVIDER_UNAVAILABLE',
      )
    }
    if (!this.served.has(routeKey(step.sourceFormat, step.targetFormat))) {
      throw new ConvertError(
        `${this.id} does not convert ${step.sourceFormat} to ${step.targetFormat}`,
        'CONVERT_PROVIDER_UNAVAILABLE',
      )
    }
    const work = await mkdtemp(join(this.options.workDir, 'dsh-office-'))
    const pidFilePath = join(work, 'office.pid')
    const produced = join(work, `output.${step.targetFormat}`)
    let quitCleanly = false
    try {
      const diagnostics = await this.runScript(shell, buildConversionScript({
        program: this.program,
        sourcePath: step.sourcePath,
        sourceFormat: step.sourceFormat,
        outputPath: produced,
        targetFormat: step.targetFormat,
        pidFilePath,
      }), work, signal)
      quitCleanly = true
      if (!await isRegularFile(produced)) {
        throw new ConvertError(
          `${this.id} did not convert "${step.sourcePath}" to ${step.targetFormat}${describeDiagnostics(diagnostics)}`,
          'CONVERT_PROVIDER_FAILED',
        )
      }
      await moveConverted(produced, step.outputPath)
      return step.sourceFormat === 'pdf' ? [PDF_REFLOW_CAVEAT] : []
    } finally {
      // The script's own `finally` quits the application on every path that reaches an exit code, so a
      // surviving process means the shell was killed — cancellation, or the grace period expiring.
      if (!quitCleanly) await this.terminateSpawned(pidFilePath)
      await rm(work, { recursive: true, force: true })
    }
  }

  /** Run one conversion script and return its diagnostic output tail. */
  private async runScript(
    shell: string,
    script: string,
    work: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    return runConverter(this.ctx, {
      // `-Command` rather than `-File`: it is not subject to the execution policy, so conversion works on
      // a domain-managed machine that forbids running scripts.
      argv: [shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      // Every path in the script is absolute, so the working directory is the scratch directory rather
      // than anything of the caller's.
      cwd: work,
      tailBytes: STDERR_TAIL_BYTES,
      graceMs: this.options.graceMs,
      label: this.id,
      signal,
    })
  }

  /**
   * End the Office processes this conversion started, and only those. An empty record means the script
   * attached to an application the user already had open, which must be left alone.
   *
   * Failure is not reported: this runs on the way out of a conversion that has already failed or been
   * cancelled, and a `taskkill` that reports "process not found" is the expected answer whenever the
   * script's own `Quit` won the race.
   */
  private async terminateSpawned(pidFilePath: string): Promise<void> {
    // A missing or unreadable file means the script died before recording anything, so nothing is known
    // to kill; there is no other way to learn which process to end.
    const contents = await readFile(pidFilePath, 'utf8').catch(() => '')
    const pids = parseSpawnedPids(contents)
    if (pids.length === 0) return
    // A machine whose PATH has no `taskkill` cannot be cleaned up, and saying so would replace a real
    // conversion error with a secondary one.
    const taskkill = await this.ctx.subprocess.resolveExecutable(TASKKILL).catch(() => undefined)
    if (taskkill === undefined) return
    for (const pid of pids) {
      // No signal is passed: this runs precisely when the caller's signal is already aborted.
      const handle = this.ctx.subprocess.spawn({
        argv: [taskkill, '/T', '/F', '/PID', String(pid)],
        cwd: process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: KILL_OUTPUT_BYTES },
          stderr: { maxBytes: KILL_OUTPUT_BYTES },
        },
        graceMs: this.options.graceMs,
      })
      await handle.done
    }
  }
}
