/** Wire-facing types of the SSH tunnel manager. @module @deepseek-ai/dsh-host-llm-tunnel/types */

/**
 * Brand an existing tunnel host id at the owning boundary.
 * @param value - the settings key naming the host, already known to exist.
 * @returns the same string, branded for cross-boundary use.
 */
export function tunnelHostId(value: string): TunnelHostId {
  return value as TunnelHostId
}

declare const brand: unique symbol
/** Identifier of one configured remote host, also its settings key. */
export type TunnelHostId = string & { readonly [brand]: never }

/** Where the SSH server is and how the model endpoint is reached through it. */
export interface TunnelHostConfig {
  /** SSH server hostname or address (a `~/.ssh/config` alias works). */
  host: string
  /** SSH server port. */
  sshPort: number
  /** SSH login user. */
  user: string
  /**
   * The model endpoint as seen FROM the SSH server. vLLM binds 127.0.0.1 by
   * default, so the common value is `127.0.0.1`.
   */
  remoteHost: string
  /** The model endpoint's port on the remote side. */
  remotePort: number
  /** The localhost port the forward listens on. */
  localPort: number
}

/** Lifecycle phase of one tunnel, as the browser status dot renders. */
export type TunnelPhase =
  | 'stopped'
  | 'connecting'
  | 'connected'
  | 'failed'

/** One tunnel's live projection. */
export interface TunnelStatus {
  /** The host this status belongs to. */
  id: TunnelHostId
  /** Current lifecycle phase. */
  phase: TunnelPhase
  /** Last diagnostic line when `phase` is `failed`; else undefined. */
  detail: string | null
  /** The local `http://127.0.0.1:<port>/v1` base URL a provider row uses. */
  localBaseURL: string
}

/** Snapshot of every configured tunnel. */
export interface TunnelSnapshot {
  tunnels: readonly TunnelStatus[]
}

/** Outcome of `probe`: did the model endpoint answer through the tunnel? */
export interface TunnelProbeResult {
  id: TunnelHostId
  ok: boolean
  /** Failure reason when `ok` is false. */
  detail: string | null
}

/** One model as the probe's OpenAI-compatible listing returns it. */
export interface TunnelModelListing {
  id: string
}
