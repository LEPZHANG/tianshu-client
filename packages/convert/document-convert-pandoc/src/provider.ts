/**
 * pandoc as a conversion provider. One binary, one provider, and the routes it declares are the ones the
 * installed pandoc reports it can read and write rather than the ones this package knows about.
 *
 * pandoc writes exactly the output path it is given, so a step is one spawn with no scratch directory
 * and no rename — the seam checks the written file afterwards, as it does for every provider.
 * @module @deepseek-ai/dsh-document-convert-pandoc/provider
 */

import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConvertNote,
  ConvertRoute,
  ConvertStepSpec,
  DocumentConvertProvider,
  DocumentFormat,
} from '@deepseek-ai/dsh-document-convert'
import { ConvertError, outputTail, runConverter } from '@deepseek-ai/dsh-document-convert'
import type { PandocConversion } from './conversions.ts'
import { PANDOC_CONVERSIONS } from './conversions.ts'

/** The provider id pandoc registers under. */
export const PANDOC_PROVIDER_ID = 'pandoc'

/**
 * Oldest pandoc this provider will use. `--embed-resources` arrived in pandoc 3.0, replacing
 * `--self-contained`, and an HTML target without it writes references to image files that will not
 * exist beside the output — a result that looks converted and is not. Rather than branch on the flag
 * name, an older pandoc registers nothing and LibreOffice keeps the routes.
 */
export const MIN_PANDOC_MAJOR = 3

/** Bytes of diagnostic output retained to explain a failure. */
const STDERR_TAIL_BYTES = 8_000

/** Bytes of a format listing retained; pandoc's longest is a few hundred short names. */
const FORMAT_LISTING_BYTES = 16_000

/** Everything pandoc takes from the plugin config. */
export interface PandocProviderOptions {
  /** The pandoc executable: a bare PATH name or an absolute path. */
  readonly binary: string
  /** Tie-break rank declared on every route this provider offers; higher wins. */
  readonly priority: number
  /** SIGTERM→SIGKILL grace period when a conversion is cancelled, in milliseconds. */
  readonly graceMs: number
}

/** The `<from>-><to>` key an edge is looked up by. */
function edgeKey(from: DocumentFormat, to: DocumentFormat): string {
  return `${from}->${to}`
}

/**
 * pandoc as a conversion provider, registered into `ctx.documentConvert`.
 *
 * Availability and the route set are both settled once, when the plugin applies, because `available()`
 * must be cheap and synchronous; a pandoc installed or upgraded later is invisible until the plugin is
 * remounted.
 */
export class PandocConvertProvider implements DocumentConvertProvider {
  readonly id = PANDOC_PROVIDER_ID

  private readonly ctx: Context
  private readonly options: PandocProviderOptions
  private executable: string | undefined
  private declared: readonly ConvertRoute[] = []
  private readonly byEdge = new Map<string, PandocConversion>()

  constructor(ctx: Context, options: PandocProviderOptions) {
    this.ctx = ctx
    this.options = options
  }

  get routes(): readonly ConvertRoute[] {
    return this.declared
  }

  /**
   * Resolve pandoc, check that it is new enough, and ask it which formats it reads and writes, keeping
   * only the edges it confirms. Asking is what settles questions this package should not answer by
   * version arithmetic — whether this build carries the RTF reader, for one — and a pandoc that cannot
   * answer is treated as absent rather than assumed capable.
   * @param signal - aborts the lookup and the probing runs.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    const executable = await this.ctx.subprocess
      .resolveExecutable(this.options.binary, undefined, signal)
      .catch(() => undefined)
    if (executable === undefined) return
    const version = await this.ask(executable, '--version', signal)
    if (version === undefined || (pandocMajor(version) ?? 0) < MIN_PANDOC_MAJOR) return
    const readers = await this.ask(executable, '--list-input-formats', signal)
    const writers = await this.ask(executable, '--list-output-formats', signal)
    if (readers === undefined || writers === undefined) return
    const inputs = new Set(names(readers))
    const outputs = new Set(names(writers))
    const supported = PANDOC_CONVERSIONS
      .filter(conversion => inputs.has(conversion.reader) && outputs.has(conversion.writer))
    if (supported.length === 0) return
    for (const conversion of supported) this.byEdge.set(edgeKey(conversion.from, conversion.to), conversion)
    this.declared = supported.map(conversion => ({
      from: conversion.from,
      to: conversion.to,
      fidelity: conversion.fidelity,
      priority: this.options.priority,
    }))
    this.executable = executable
  }

  available(): boolean {
    return this.executable !== undefined
  }

  async convert(step: ConvertStepSpec, signal?: AbortSignal): Promise<readonly ConvertNote[]> {
    const conversion = this.byEdge.get(edgeKey(step.sourceFormat, step.targetFormat))
    if (this.executable === undefined || conversion === undefined) {
      throw new ConvertError(
        `${this.options.binary} does not convert ${step.sourceFormat} to ${step.targetFormat} on this machine`,
        'CONVERT_PROVIDER_UNAVAILABLE',
      )
    }
    await runConverter(this.ctx, {
      argv: [
        this.executable,
        '--from', conversion.reader,
        '--to', conversion.writer,
        // Without it the writers that distinguish a document from a fragment emit the fragment: an RTF
        // with no `{\rtf1` preamble, an HTML body with no enclosing page.
        '--standalone',
        // pandoc resolves a source's relative image references against the working directory, not
        // against the source; naming the source's own directory is what makes them resolvable.
        '--resource-path', dirname(step.sourcePath),
        ...conversion.flags,
        '--output', step.outputPath,
        step.sourcePath,
      ],
      // Every path pandoc is given is absolute and `--resource-path` covers what it looks up, so the
      // working directory is never consulted; the spawn seam requires one, and the harness process's own
      // is the only directory guaranteed to exist.
      cwd: process.cwd(),
      tailBytes: STDERR_TAIL_BYTES,
      graceMs: this.options.graceMs,
      label: this.options.binary,
      signal,
    })
    return [conversion.caveat]
  }

  /**
   * Run pandoc for an answer it prints, or `undefined` when it could not give one. Every caller treats
   * that as "this pandoc is not usable", so a failure here costs the routes rather than raising.
   */
  private async ask(executable: string, flag: string, signal: AbortSignal | undefined): Promise<string | undefined> {
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, flag],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: FORMAT_LISTING_BYTES },
        stderr: { maxBytes: FORMAT_LISTING_BYTES },
      },
      graceMs: this.options.graceMs,
      signal,
    })
    const outcome = await handle.done
    return outcome.exitCode === 0 ? outputTail(handle.collected.stdout) : undefined
  }
}

/**
 * The major version pandoc reports, or `undefined` when its first line is not the one pandoc writes.
 * `pandoc --version` leads with `pandoc 3.1.11.1` and follows it with build details.
 * @param version - the command's standard output.
 * @returns the leading version component.
 */
export function pandocMajor(version: string): number | undefined {
  const match = /^pandoc(?:\.exe)?\s+(\d+)\./.exec(version.trimStart())
  return match === null ? undefined : Number(match[1])
}

/** The format names in a `--list-input-formats` or `--list-output-formats` listing, one per line. */
function names(listing: string): readonly string[] {
  return listing.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}
