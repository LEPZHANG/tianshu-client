/**
 * Poppler's PDF extraction tools as conversion providers. Unlike LibreOffice, these write exactly the
 * output path they are given, so a step is one spawn with no scratch directory or rename.
 *
 * Extraction is what makes PDF usable as a *source* at all. LibreOffice imports a PDF into Draw, which
 * can only export a canvas of positioned text boxes; asked for `odt` it writes an ODF *graphics*
 * document under an `.odt` name. Poppler recovers the text instead, and the conversion seam chains that
 * with a second step to reach the formats poppler itself does not write.
 * @module @deepseek-ai/dsh-document-convert-poppler/provider
 */

import { readFile, rm, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConvertNote,
  ConvertRoute,
  ConvertStepSpec,
  DocumentConvertProvider,
} from '@deepseek-ai/dsh-document-convert'
import { ConvertError, outputTail, runConverter, verifyConvertedBytes } from '@deepseek-ai/dsh-document-convert'

/** The provider id `pdftotext` registers under. */
export const PDFTOTEXT_PROVIDER_ID = 'poppler-pdftotext'

/** The provider id `pdftohtml` registers under. */
export const PDFTOHTML_PROVIDER_ID = 'poppler-pdftohtml'

/** Bytes of diagnostic output retained to explain a failure. */
const STDERR_TAIL_BYTES = 8_000

/**
 * Largest extraction result, in bytes, read back to check whether anything was recovered. Above it the
 * tool plainly recovered text, so the check has nothing to find and the read is pure cost.
 */
const MAX_EMPTINESS_CHECK_BYTES = 4 * 1024 * 1024

/** Bytes of a `pdffonts` listing retained: one line per font, and only whether any line exists matters. */
const FONT_LISTING_BYTES = 8_000

/** What distinguishes one poppler tool from the other. */
export interface PopplerToolSpec {
  /** Registry id. */
  readonly id: string
  /** Executable: a bare PATH name or an absolute path. */
  readonly binary: string
  /** The single route this tool serves. */
  readonly route: ConvertRoute
  /**
   * The tool's arguments after the executable. Both tools take the source path then the output path as
   * their final two arguments; the flags before them are what differ.
   */
  readonly flags: readonly string[]
  /** What this tool's extraction always costs the document, reported with every conversion. */
  readonly caveat: ConvertNote
}

/** Shared settings both tools take from the plugin config. */
export interface PopplerProviderOptions {
  /** SIGTERM→SIGKILL grace period for a cancelled extraction, in milliseconds. */
  readonly graceMs: number
  /** The `pdffonts` executable consulted only to explain an extraction that recovered nothing. */
  readonly fontsBinary: string
}

/**
 * One poppler extraction tool as a conversion provider. Registered into `ctx.documentConvert`; each tool
 * registers on its own so a machine with `pdftotext` but no `pdftohtml` keeps the route it can serve.
 *
 * Availability is sampled once, when the plugin applies, because `available()` must be cheap and
 * synchronous; a binary installed later is invisible until the plugin is remounted.
 */
export class PopplerConvertProvider implements DocumentConvertProvider {
  readonly id: string
  readonly routes: readonly ConvertRoute[]

  private readonly ctx: Context
  private readonly spec: PopplerToolSpec
  private readonly options: PopplerProviderOptions
  private executable: string | undefined

  constructor(ctx: Context, spec: PopplerToolSpec, options: PopplerProviderOptions) {
    this.ctx = ctx
    this.spec = spec
    this.options = options
    this.id = spec.id
    this.routes = [spec.route]
  }

  /**
   * Resolve the configured executable once and remember the answer. An unresolvable binary means this
   * machine lacks that poppler tool, which is a reported unavailability rather than a failure.
   * @param signal - aborts the lookup.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    this.executable = await this.ctx.subprocess
      .resolveExecutable(this.spec.binary, undefined, signal)
      .catch(() => undefined)
  }

  available(): boolean {
    return this.executable !== undefined
  }

  async convert(step: ConvertStepSpec, signal?: AbortSignal): Promise<readonly ConvertNote[]> {
    // The seam only dispatches steps drawn from this provider's own single declared route.
    if (this.executable === undefined) {
      throw new ConvertError(`${this.spec.binary} is not available`, 'CONVERT_PROVIDER_UNAVAILABLE')
    }
    await runConverter(this.ctx, {
      argv: [this.executable, ...this.spec.flags, step.sourcePath, step.outputPath],
      // Both tools address their input and output by the paths they are given, and the seam hands them
      // absolute ones, so the working directory is never consulted; the spawn seam requires one, and the
      // harness process's own is the only directory guaranteed to exist.
      cwd: process.cwd(),
      tailBytes: STDERR_TAIL_BYTES,
      graceMs: this.options.graceMs,
      label: this.spec.binary,
      signal,
    })
    await this.assertExtractedContent(step, signal)
    return [this.spec.caveat]
  }

  /**
   * Refuse an extraction that recovered nothing, and say which of its two causes applies.
   *
   * A PDF whose pages are images exits 0 and writes an empty document, so the empty result itself carries
   * no information: the same output means "this is a scan, extraction was never possible" and "this PDF
   * holds text that poppler could not read". `pdffonts` separates them — a PDF with no embedded fonts has
   * no text to extract — and the two cases need opposite responses from the caller, OCR against a bug
   * report. The check runs only once the result is already empty, so a successful extraction never pays
   * for it.
   *
   * A missing output file is left to the seam, which reports it uniformly for every provider.
   */
  private async assertExtractedContent(step: ConvertStepSpec, signal: AbortSignal | undefined): Promise<void> {
    const info = await stat(step.outputPath).catch(() => undefined)
    if (info === undefined) return
    if (info.size > MAX_EMPTINESS_CHECK_BYTES) return
    const empty = verifyConvertedBytes(step.targetFormat, await readFile(step.outputPath))
    if (empty === undefined) return
    await rm(step.outputPath, { force: true })
    const fonts = await this.hasEmbeddedFonts(step.sourcePath, signal)
    if (fonts === false) {
      throw new ConvertError(
        `"${step.sourcePath}" embeds no fonts, so its pages are images rather than text — a scan, or a `
        + 'PDF exported from photographs. There is nothing to extract; the pages must be read by OCR '
        + 'before they can be converted to a text format.',
        'CONVERT_SOURCE_SCANNED',
      )
    }
    throw new ConvertError(
      `${this.spec.binary} extracted nothing from "${step.sourcePath}": ${empty}. ${fonts === true
        ? 'The PDF does embed fonts, so it is protected against extraction, or stores its text in an '
          + 'encoding poppler cannot map back to characters.'
        : 'The PDF is either a scan, whose pages are images and must be read by OCR, or is protected '
          + 'against text extraction.'}`,
      'CONVERT_PROVIDER_FAILED',
    )
  }

  /**
   * Whether the PDF embeds any font, or `undefined` when `pdffonts` could not answer — it is not
   * installed, or it failed on a file poppler had just read. An unavailable diagnosis costs the precise
   * message, never the conversion, so it is never itself an error.
   */
  private async hasEmbeddedFonts(sourcePath: string, signal: AbortSignal | undefined): Promise<boolean | undefined> {
    const executable = await this.ctx.subprocess
      .resolveExecutable(this.options.fontsBinary, undefined, signal)
      .catch(() => undefined)
    if (executable === undefined) return undefined
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, sourcePath],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: FONT_LISTING_BYTES },
        // The seam has no discard disposition, and an undrained stream would stall the child once its
        // pipe filled; a bounded collector nobody reads is how this run ignores diagnostics.
        stderr: { maxBytes: FONT_LISTING_BYTES },
      },
      graceMs: this.options.graceMs,
      signal,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) return undefined
    return listsFont(outputTail(handle.collected.stdout))
  }
}

/**
 * Whether a `pdffonts` listing names at least one font. The command always writes its column header and
 * a rule of dashes, then one line per font, so a PDF with no fonts is the header alone.
 * @param listing - the command's standard output.
 * @returns whether any font row follows the header.
 */
function listsFont(listing: string): boolean {
  return listing.split('\n').some((line) => {
    const row = line.trim()
    if (row.length === 0 || row.startsWith('name')) return false
    return !/^[-\s]+$/.test(row)
  })
}
