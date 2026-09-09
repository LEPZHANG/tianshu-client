/**
 * skills domain contract: read-only skill catalog lookup addressed by
 * session, plus the built-in suite catalogue's install lifecycle. Skill
 * lookup resolves the session's header cwd to the canonical project root
 * host-side — the client never submits a raw path, and lookup never creates
 * or resumes an Agent. Suite install/uninstall write under the user skill
 * root; the filesystem provider discovers the result on its next scan.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). Listing
 * is the domain's only RPC: invocation itself is a plain `session.prompt`
 * whose leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire.
 */
/** Suite catalogue row (wire projection of the host SuiteView). */
export interface SuiteEntry {
  /** Stable suite id. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Display category tag. */
  readonly tag: string
  /** One-line description. */
  readonly description: string
  /** The skills this suite installs, in order (identity plus display copy). */
  readonly skills: readonly SuiteSkillEntry[]
  /** Whether the suite's files are under the user skill root. */
  readonly installed: boolean
}

/** One skill of a suite (wire projection of the host SuiteSkillView): identity and display copy, no body. */
export interface SuiteSkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Human-facing display name for the catalogue card. */
  readonly title: string
  /** One-line UI summary of what the skill produces. */
  readonly summary: string
}

export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
  /** Lists the built-in suite catalogue with its install state. */
  suiteList(request: RpcRequest<{}>): Promise<RpcResponse<{ suites: readonly SuiteEntry[] }>>
  /**
   * Installs one built-in suite (idempotent). An unknown id fails with
   * `suite-not-found`.
   */
  suiteInstall(request: RpcRequest<{ suiteId: string }>): Promise<RpcResponse<{ suites: readonly SuiteEntry[] }>>
  /**
   * Uninstalls one built-in suite; skills the user edited after install
   * survive. An unknown id fails with `suite-not-found`.
   */
  suiteUninstall(request: RpcRequest<{ suiteId: string }>): Promise<RpcResponse<{ suites: readonly SuiteEntry[] }>>
}
