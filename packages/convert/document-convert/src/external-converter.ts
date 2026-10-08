/**
 * Support for providers that convert by driving an external converter process.
 *
 * Every such provider spawns one command per step, retains a bounded tail of its output for
 * diagnostics, and turns a cancellation or a non-zero exit into the seam's error taxonomy. That
 * sequence is the same for all of them; only the argv and the name quoted in a failure differ.
 *
 * @module @deepseek-ai/dsh-document-convert
 */

import { copyFile, rm, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import { ConvertError } from './types.ts'

/** One external converter run. */
export interface ConverterRunSpec {
  /** Full argv, resolved executable first. */
  readonly argv: readonly string[]
  /** Working directory. Conversion paths are absolute, so this only satisfies the spawn seam. */
  readonly cwd: string
  /** Bytes retained from stdout and from stderr for a failure's diagnostics. */
  readonly tailBytes: number
  /** Milliseconds between the termination signal and the kill when a run is cancelled. */
  readonly graceMs: number
  /** The converter named in a failure message — a binary name or a provider id. */
  readonly label: string
  /** Caller's cancellation, propagated to the child. */
  readonly signal?: AbortSignal | undefined
}

/**
 * Run one external converter to completion and answer its retained output.
 *
 * Both streams are collected: the seam has no discard disposition, and an undrained stream would stall
 * the child once its pipe filled. A converter that writes its result to a file says nothing on stdout,
 * so in practice the answer is its stderr.
 *
 * @param ctx Context whose `subprocess` service spawns the run.
 * @param spec What to run and how to name it in a failure.
 * @returns The retained stdout and stderr, newline-joined, empty when the run said nothing.
 * @throws ConvertError `CONVERT_CANCELLED` when the caller's signal aborted, `CONVERT_PROVIDER_FAILED`
 * on a non-zero exit or a terminating signal, quoting the retained output.
 */
export async function runConverter(ctx: Context, spec: ConverterRunSpec): Promise<string> {
  const handle = ctx.subprocess.spawn({
    argv: [...spec.argv],
    cwd: spec.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: spec.tailBytes },
      stderr: { maxBytes: spec.tailBytes },
    },
    graceMs: spec.graceMs,
    signal: spec.signal,
  })
  const outcome = await handle.done
  const diagnostics = [
    outputTail(handle.collected.stdout),
    outputTail(handle.collected.stderr),
  ].filter(text => text.length > 0).join('\n')
  if (spec.signal?.aborted === true) {
    throw new ConvertError('the conversion was cancelled', 'CONVERT_CANCELLED')
  }
  if (outcome.exitCode !== 0) {
    const how = outcome.signal !== null ? `signal ${outcome.signal}` : `exit code ${outcome.exitCode}`
    throw new ConvertError(
      `${spec.label} failed with ${how}${describeDiagnostics(diagnostics)}`,
      'CONVERT_PROVIDER_FAILED',
    )
  }
  return diagnostics
}

/**
 * Read a collected stream's retained text.
 *
 * @param reader The collector, or `undefined` when the disposition produced no reader.
 * @returns The retained text without surrounding whitespace, empty when there is no reader.
 */
export function outputTail(reader: SubprocessOutputReader | undefined): string {
  return reader?.readFrom(0).text.trim() ?? ''
}

/**
 * Append a run's output to a failure message.
 *
 * @param diagnostics The run's retained output.
 * @returns The output behind a separator, or nothing when the run said nothing.
 */
export function describeDiagnostics(diagnostics: string): string {
  return diagnostics.length > 0 ? `: ${diagnostics}` : ''
}

/**
 * Whether a path exists and is a regular file.
 *
 * @param path Path to test.
 * @returns `true` only for an existing regular file; a missing path and a directory both answer `false`.
 */
export async function isRegularFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined)
  return info?.isFile() ?? false
}

/**
 * Move a converted file to its destination by copying and then removing the source.
 *
 * A `rename` would be cheaper but fails across filesystems, and a provider's scratch directory lives
 * under its configured work directory — routinely a different volume from the workspace — so the copy is
 * the path that always applies. Next to running a converter, copying one document costs nothing worth a
 * second code path.
 *
 * @param from The staged file the converter produced.
 * @param to Its destination.
 */
export async function moveConverted(from: string, to: string): Promise<void> {
  await copyFile(from, to)
  await rm(from, { force: true })
}
