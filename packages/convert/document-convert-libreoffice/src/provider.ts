/**
 * The LibreOffice headless conversion provider: one `soffice --convert-to` run per step.
 *
 * Three properties of `soffice` shape this implementation and are not optional details:
 *
 * - **A headless run needs its own user profile.** A second instance sharing the default profile
 *   refuses to start, so every conversion passes `-env:UserInstallation` pointing at a private
 *   directory. Without it, concurrent conversions fail non-deterministically.
 * - **The output filename cannot be chosen.** `--convert-to` writes `<source stem>.<ext>` into
 *   `--outdir` and offers no name argument, so each run converts into a private directory and the
 *   result is then moved to the caller's path. That also keeps a failed run from leaving a partial file
 *   at the destination.
 * - **The exit code cannot be trusted.** `soffice` exits 0 on conversions it did not perform, so the
 *   expected output file is checked for existence rather than the status alone.
 * @module @deepseek-ai/dsh-document-convert-libreoffice/provider
 */

import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConvertNote,
  ConvertRoute,
  ConvertStepSpec,
  DocumentConvertProvider,
  DocumentFormat,
} from '@deepseek-ai/dsh-document-convert'
import {
  ConvertError, describeDiagnostics, isRegularFile, moveConverted, readZipEntries, runConverter,
  zeroCrcEntries,
} from '@deepseek-ai/dsh-document-convert'
import { libreOfficeConversion, LIBREOFFICE_CONVERSIONS } from './filters.ts'

/** The provider id this package registers under. */
export const LIBREOFFICE_PROVIDER_ID = 'libreoffice'

/** Bytes of `soffice` diagnostic output retained to explain a failure. */
const STDERR_TAIL_BYTES = 8_000

/**
 * Largest source, in bytes, read into memory for the damaged-container preflight. The check exists to
 * turn one specific generic load failure into an actionable message, which is not worth holding an
 * arbitrarily large document in memory for; above this size the conversion simply runs.
 */
const MAX_PREFLIGHT_BYTES = 64 * 1024 * 1024

/** The formats whose files are ZIP containers, and so can carry the damage the preflight looks for. */
const ZIP_CONTAINER_FORMATS: ReadonlySet<DocumentFormat> = new Set<DocumentFormat>([
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp',
])

/** Everything the provider needs from its plugin config, already defaulted and validated. */
export interface LibreOfficeProviderOptions {
  /** Executable to run: a bare PATH name or an absolute path. */
  readonly binary: string
  /** Parent directory for the per-conversion user profile and output directories. */
  readonly workDir: string
  /** Tie-break rank for every route this provider declares. */
  readonly priority: number
  /** SIGTERM→SIGKILL grace period for a cancelled conversion, in milliseconds. */
  readonly graceMs: number
}

/**
 * Converts documents by running LibreOffice in headless mode. Registered into `ctx.documentConvert`.
 *
 * Availability is sampled once, when the plugin applies: the binary is resolved through the subprocess
 * seam and the answer is cached, because `available()` must be cheap and synchronous. A LibreOffice
 * installed after the harness started is therefore invisible until the plugin is remounted.
 */
export class LibreOfficeConvertProvider implements DocumentConvertProvider {
  readonly id = LIBREOFFICE_PROVIDER_ID
  readonly routes: readonly ConvertRoute[]

  private readonly ctx: Context
  private readonly options: LibreOfficeProviderOptions
  private executable: string | undefined

  constructor(ctx: Context, options: LibreOfficeProviderOptions) {
    this.ctx = ctx
    this.options = options
    this.routes = [...LIBREOFFICE_CONVERSIONS].map(([key, conversion]) => {
      const [from, to] = key.split('->') as [DocumentFormat, DocumentFormat]
      return { from, to, fidelity: conversion.fidelity, priority: options.priority }
    })
  }

  /**
   * Resolve the configured executable once and remember the answer. An unresolvable binary is this
   * machine lacking LibreOffice, not a failure: the provider simply reports itself unusable and the
   * seam plans around it.
   * @param signal - aborts the lookup.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    this.executable = await this.ctx.subprocess
      .resolveExecutable(this.options.binary, undefined, signal)
      .catch(() => undefined)
  }

  available(): boolean {
    return this.executable !== undefined
  }

  async convert(step: ConvertStepSpec, signal?: AbortSignal): Promise<readonly ConvertNote[]> {
    const conversion = libreOfficeConversion(step.sourceFormat, step.targetFormat)
    // The seam only dispatches steps taken from this provider's own declared routes, and the route list
    // is built from the same table this lookup reads.
    if (conversion === undefined || this.executable === undefined) {
      throw new ConvertError(
        `LibreOffice does not convert ${step.sourceFormat} to ${step.targetFormat}`,
        'CONVERT_PROVIDER_UNAVAILABLE',
      )
    }
    await assertLoadableSource(step)
    const work = await mkdtemp(join(this.options.workDir, 'dsh-soffice-'))
    try {
      // `--outdir` is created here rather than left to `soffice`: the run must not depend on whether a
      // given build creates a missing output directory or fails for it.
      const outputDir = join(work, 'out')
      await mkdir(outputDir, { recursive: true })
      const stderr = await this.runSoffice(this.executable, {
        profile: join(work, 'profile'),
        outputDir,
        importFilter: conversion.importFilter,
        target: `${step.targetFormat}:${conversion.exportFilter}`,
        sourcePath: step.sourcePath,
      }, signal)
      const produced = join(outputDir, `${sourceStem(step.sourcePath)}.${step.targetFormat}`)
      if (!await isRegularFile(produced)) {
        throw new ConvertError(
          `LibreOffice did not convert "${step.sourcePath}" to ${step.targetFormat}${describeDiagnostics(stderr)}`,
          'CONVERT_PROVIDER_FAILED',
        )
      }
      await moveConverted(produced, step.outputPath)
      return conversion.caveat === undefined ? [] : [conversion.caveat]
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  /** Run one `soffice` conversion and return its diagnostic output tail. */
  private async runSoffice(
    executable: string,
    run: {
      profile: string
      outputDir: string
      importFilter: string | undefined
      target: string
      sourcePath: string
    },
    signal: AbortSignal | undefined,
  ): Promise<string> {
    return runConverter(this.ctx, {
      argv: [
        executable,
        '--headless',
        '--norestore',
        `-env:UserInstallation=${pathToFileURL(run.profile).href}`,
        ...run.importFilter !== undefined ? [`--infilter=${run.importFilter}`] : [],
        '--convert-to', run.target,
        '--outdir', run.outputDir,
        run.sourcePath,
      ],
      // A conversion reads and writes absolute paths only, so the working directory is the scratch
      // directory rather than anything of the caller's.
      cwd: run.outputDir,
      tailBytes: STDERR_TAIL_BYTES,
      graceMs: this.options.graceMs,
      label: 'LibreOffice',
      signal,
    })
  }
}

/**
 * Refuse a ZIP-container source LibreOffice will reject, before starting it.
 *
 * LibreOffice validates every entry's CRC-32 when it opens an OOXML or ODF document and rejects the whole
 * file if one is wrong, reporting only that the source could not be loaded. Word and WPS do not validate,
 * so a file whose images carry a zero CRC — what several re-packaging tools and chat clients write — opens
 * for the person who sent it and fails here, with nothing in the message to suggest why or what to do.
 * Naming the damaged entries, and the one-line remedy, is the whole value of this check.
 *
 * Only the container's directory is inspected; nothing is decompressed and the conversion is unaffected
 * when the source is sound or too large to inspect.
 */
async function assertLoadableSource(step: ConvertStepSpec): Promise<void> {
  if (!ZIP_CONTAINER_FORMATS.has(step.sourceFormat)) return
  const info = await stat(step.sourcePath).catch(() => undefined)
  if (info === undefined || info.size > MAX_PREFLIGHT_BYTES) return
  const entries = readZipEntries(await readFile(step.sourcePath))
  if (entries === undefined) {
    throw new ConvertError(
      `"${step.sourcePath}" is named ${step.sourceFormat} but its container cannot be read, so LibreOffice `
      + `cannot open it; the file is damaged or is not really a ${step.sourceFormat} file`,
      'CONVERT_SOURCE_DAMAGED',
    )
  }
  const damaged = zeroCrcEntries(entries)
  if (damaged.length === 0) return
  throw new ConvertError(
    `"${step.sourcePath}" carries ${damaged.length} entr${damaged.length === 1 ? 'y' : 'ies'} with no `
    + `checksum (${damaged.slice(0, 3).join(', ')}${damaged.length > 3 ? ', …' : ''}). LibreOffice refuses `
    + 'such a file even though Word and WPS open it. Re-save the document from the application that wrote '
    + 'it, then convert the re-saved copy.',
    'CONVERT_SOURCE_DAMAGED',
  )
}

/** The source filename without its directory or extension — the stem `--convert-to` names its output by. */
function sourceStem(sourcePath: string): string {
  const start = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\')) + 1
  const name = sourcePath.slice(start)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
