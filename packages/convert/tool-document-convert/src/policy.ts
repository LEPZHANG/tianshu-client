/**
 * Where a convert-family tool is allowed to read and write.
 *
 * The seam is not a confinement boundary — its providers hand argv to `ctx.subprocess` and the converter
 * writes with the harness process's own authority. This module is where the decision is actually made,
 * before anything is dispatched: the tool resolves both paths through `ctx.fs` and refuses an output the
 * session's sandbox mode does not permit. A direct in-process caller of `ctx.documentConvert` bypasses
 * it, which the seam's README records.
 *
 * Both tools that produce a file this way — `convert_document` here and `write_official_document` in
 * `@deepseek-ai/dsh-tool-official-document` — make the same decision, so it has one home and they share
 * these functions rather than each carrying a copy. The same applies to the other facts they share by
 * both being convert-family tools that write one file: the tool-call budget, the presentation meta, and
 * the `notes` schema.
 * @module @deepseek-ai/dsh-tool-document-convert/policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { ConvertError } from '@deepseek-ai/dsh-document-convert'
import type { ConvertFidelity } from '@deepseek-ai/dsh-document-convert'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Reject a configured tool-call budget a timer cannot represent. Both tools take the same budget for the
 * same reason — a cold LibreOffice start dominates it — so they refuse the same values.
 * @param plugin - the plugin name to lead the message with.
 * @param timeoutMs - the configured budget after schemastery defaults.
 */
export function assertTimeoutBudget(plugin: string, timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${plugin}: timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
}

/**
 * The presentation meta a convert-family completed card needs: the file that was actually written, and
 * whether reaching the requested format cost fidelity. Both tools carry exactly these two facts.
 */
export interface ConvertFileMeta {
  /** The path actually written. */
  path: string
  /** Whether the executed route preserved the source. */
  fidelity: ConvertFidelity
}

/**
 * Narrow opaque live or replayed result metadata to a {@link ConvertFileMeta}. Malformed metadata returns
 * `undefined` so presentation falls back to the generic card instead of throwing during replay.
 * @param meta - result metadata.
 * @returns the validated meta, or undefined for absent or malformed data.
 */
export function convertFileMetaFromResult(meta: unknown): ConvertFileMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { path, fidelity } = meta as Record<string, unknown>
  if (typeof path !== 'string') return undefined
  if (fidelity !== 'faithful' && fidelity !== 'lossy') return undefined
  return { path, fidelity }
}

/**
 * The output-schema fragment for the `notes` a convert-family tool reports: the codes and messages that
 * tell the model what the written file does not deliver. Both tools declare the same one.
 */
export const CONVERT_NOTES_SCHEMA = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true },
      message: { type: 'string', required: true },
    },
  },
} as const

/**
 * The working directory this call resolves relative paths against: the calling agent's session
 * workspace, mirroring how the filesystem and shell tools resolve theirs. A non-agent caller has none,
 * and the filesystem backend then applies its own default.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the session workspace directory, or undefined for a non-agent caller.
 */
export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}

/**
 * The file-effect policy standing for this call, or `undefined` when the composition mounts no sandbox
 * policy at all and therefore confines nothing.
 * @param ctx - the plugin context; `sandboxPolicy` is optional and read through `ctx.get`.
 * @param exec - the tool-execution context supplying the calling session.
 * @returns the resolved policy, or undefined in an unconfined composition.
 */
export function filePolicy(ctx: Context, exec: ToolExecution): SandboxExecutionPolicy | undefined {
  return ctx.get('sandboxPolicy')?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} })
}

/**
 * Refuse the call outright under a mode that permits no writing. A convert-family tool always produces a
 * file, so there is no read-only form of it to fall back to.
 * @param policy - the standing file-effect policy, when the composition has one.
 * @param operation - what the call is doing, named as a gerund phrase, so the refusal says which tool was
 *   denied rather than describing conversion for every caller.
 */
export function assertWritable(policy: SandboxExecutionPolicy | undefined, operation: string): void {
  if (policy?.mode === 'read-only') {
    throw new ConvertError(
      `${operation} writes a new file, which this session's read-only sandbox does not permit`,
      'CONVERT_SANDBOX_DENIED',
    )
  }
}

/**
 * Refuse an output outside the workspace the session may write to. Only `workspace-write` confines a
 * destination: an unconfined composition and `danger-full-access` place no root-based limit on it, and
 * `read-only` was already refused.
 *
 * @param ctx - the plugin context, for resolving the workspace root as a filesystem target.
 * @param policy - the standing file-effect policy, when the composition has one.
 * @param output - the resolved output target.
 * @param signal - the call's cancellation signal, which a tool execution always carries.
 */
export async function assertWithinWorkspace(
  ctx: Context,
  policy: SandboxExecutionPolicy | undefined,
  output: FsTarget,
  signal: AbortSignal,
): Promise<void> {
  if (policy?.mode !== 'workspace-write') return
  const root = await ctx.fs.resolve(policy.workspaceRoot, { signal })
  if (ctx.fs.contains(root, output)) return
  throw new ConvertError(
    `"${output.displayPath}" is outside this session's workspace, which is the only place it may write`,
    'CONVERT_SANDBOX_DENIED',
  )
}
