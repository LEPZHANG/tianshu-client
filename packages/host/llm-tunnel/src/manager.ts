/**
 * Tunnel lifecycle owner: one `ssh -N -L` child per configured host, kept in
 * step with the effective settings section.
 *
 * The child runs under the subprocess seam, so termination is tree-scoped and
 * disposal cleanup is the seam's. Connection phase is derived, not commanded:
 * `ssh` is "connected" exactly while the process lives, so the status is the
 * child's liveness plus the last stderr line when it died. That is honest
 * without port-probing on a timer — the probe RPC answers "does the endpoint
 * actually work" on demand, which is when the user is looking.
 *
 * @module @deepseek-ai/dsh-host-llm-tunnel/manager
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {
  TunnelHostConfig,
  TunnelHostId,
  TunnelModelListing,
  TunnelProbeResult,
  TunnelSnapshot,
  TunnelStatus,
} from './types.ts'
import { tunnelHostId } from './types.ts'

/** ssh flags every tunnel shares: forward only, no shell, fail fast, keep alive. */
const SSH_FLAGS = ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes'] as const

/** One live tunnel: the child plus the phase it derived. */
interface LiveTunnel {
  handle: SubprocessHandle
  id: TunnelHostId
  config: TunnelHostConfig
  phase: 'connecting' | 'connected' | 'failed'
  detail: string | null
}

/** stderr tail cap per tunnel: the diagnostic line, not the transcript. */
const STDERR_TAIL_BYTES = 4096

/**
 * Manages the tunnel set. All methods are host-side; the RPC surface in
 * index.ts is the only client-visible entry.
 */
export class TunnelManager {
  /** Live children keyed by host id. Absent = not configured or stopped. */
  private readonly live = new Map<TunnelHostId, LiveTunnel>()

  constructor(private readonly ctx: Context) {}

  /**
   * Reconcile the live set against one effective configuration: start hosts
   * that gained configuration, stop hosts that lost it, and leave everything
   * else running — a settings edit that does not touch host A must not
   * restart host A's tunnel and drop its in-flight requests.
   * @param hosts - the effective `hosts` map from the settings section.
   * @returns the disposal of everything this call started.
   */
  syncAll(hosts: Record<string, TunnelHostConfig>): void {
    // Keys are branded once here; every later map operation rides the brand.
    const wanted = new Map(Object.entries(hosts).map(([id, config]) => [tunnelHostId(id), config]))
    for (const [id, tunnel] of this.live) {
      const config = wanted.get(id)
      // A host whose config changed shape (different remote/local port) also
      // restarts: the running child's forward is stale.
      if (config === undefined || !sameTarget(config, tunnel.config)) {
        this.stop(id)
      }
    }
    for (const [id, config] of wanted) {
      if (!this.live.has(id)) this.start(id, config)
    }
  }

  /**
   * One tunnel's status, materialized for the snapshot.
   * @param id - the host to report.
   * @returns its live status, or `stopped` when no child runs.
   */
  statusOf(id: TunnelHostId): TunnelStatus {
    const tunnel = this.live.get(id)
    if (tunnel === undefined) return { id, phase: 'stopped', detail: null, localBaseURL: 'http://127.0.0.1:0/v1' }
    return {
      id: tunnel.id,
      phase: tunnel.phase,
      detail: tunnel.detail,
      localBaseURL: `http://127.0.0.1:${String(tunnel.config.localPort)}/v1`,
    }
  }

  /**
   * The full snapshot, in settings iteration order.
   * @returns every configured tunnel's status.
   */
  snapshot(): TunnelSnapshot {
    return { tunnels: [...this.live.keys()].map(id => this.statusOf(id)) }
  }

  /**
   * Stop and immediately re-spawn one tunnel — the recovery affordance when
   * a status row reads `failed`.
   * @param id - the host to restart.
   * @returns the status of the freshly started child.
   */
  restart(id: TunnelHostId): TunnelStatus {
    this.stop(id)
    const tunnel = this.live.get(id)
    if (tunnel !== undefined) return this.statusOf(id)
    // restart of an unknown id: the sync will not re-create it; report
    // stopped rather than inventing a child for an unconfigured host.
    return { id, phase: 'stopped', detail: null, localBaseURL: 'http://127.0.0.1:0/v1' }
  }

  /**
   * Probe one tunnel's endpoint through the forward and list its models.
   * Uses plain fetch against the local port, so a 200 proves ssh, the
   * forward, and the model server in one round trip.
   * @param id - the host to probe.
   * @returns the model listing, or the failure chain.
   */
  async probe(id: TunnelHostId): Promise<TunnelProbeResult & { models: readonly TunnelModelListing[] }> {
    const tunnel = this.live.get(id)
    if (tunnel === undefined) {
      return { id, ok: false, detail: 'tunnel is not running', models: [] }
    }
    if (tunnel.phase === 'failed') {
      return { id, ok: false, detail: tunnel.detail ?? 'tunnel failed', models: [] }
    }
    const url = `http://127.0.0.1:${String(tunnel.config.localPort)}/v1/models`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) {
        return { id, ok: false, detail: `endpoint answered ${String(response.status)}`, models: [] }
      }
      const body = await response.json() as { data?: Array<{ id?: unknown }> }
      const models = Array.isArray(body.data)
        ? body.data.flatMap(entry => typeof entry.id === 'string' ? [{ id: entry.id } satisfies TunnelModelListing] : [])
        : []
      return { id, ok: true, detail: null, models }
    } catch (error) {
      return { id, ok: false, detail: error instanceof Error ? error.message : String(error), models: [] }
    }
  }

  /**
   * Stop every tunnel and clear the map. Called from the service's teardown.
   */
  disposeAll(): void {
    for (const id of [...this.live.keys()]) this.stop(id)
  }

  /** Stop one child and drop it from the map. Idempotent. */
  private stop(id: TunnelHostId): void {
    const tunnel = this.live.get(id)
    if (tunnel === undefined) return
    this.live.delete(id)
    tunnel.handle.terminate()
  }

  /** Spawn one tunnel child and wire its liveness into the status. */
  private start(id: TunnelHostId, config: TunnelHostConfig): void {
    const argv = [
      'ssh',
      ...SSH_FLAGS,
      '-p', String(config.sshPort),
      '-L', `${String(config.localPort)}:${config.remoteHost}:${String(config.remotePort)}`,
      `${config.user}@${config.host}`,
    ]
    const tunnel: LiveTunnel = {
      id,
      config,
      phase: 'connecting',
      detail: null,
      // Assigned right after spawn; the definite assignment window is closed
      // before any observer can run (the sync that called start is
      // synchronous with the assignment).
      handle: undefined as unknown as SubprocessHandle,
    }
    try {
      const handle = this.ctx.subprocess.spawn({
        argv,
        cwd: join(homedir()),
        stdio: {
          stdin: 'ignore',
          // ssh -N writes diagnostics to stderr only; stdout stays empty and
          // is collected so an unexpected writer cannot fill a pipe.
          stdout: { maxBytes: STDERR_TAIL_BYTES },
          stderr: { maxBytes: STDERR_TAIL_BYTES },
        },
        graceMs: 5_000,
      })
      tunnel.handle = handle
      this.live.set(id, tunnel)
      void handle.done.then((outcome) => {
        // A child that died while connecting never established the forward;
        // one that died after connecting reconnects only through restart/sync.
        // Both land on `failed` with the same diagnostic — the phase it died in
        // is already carried by `detail`.
        //
        // The map entry stays: a `failed` row with its diagnostic is the honest
        // projection, and sync only replaces it on config change.
        tunnel.phase = 'failed'
        tunnel.detail = sshDiagnostic(handle, outcome)
      })
    } catch (error) {
      // Spawn-level failure (e.g. no ssh on PATH): report through the same
      // failed status rather than throwing into settings reconciliation.
      tunnel.phase = 'failed'
      tunnel.detail = error instanceof Error ? error.message : String(error)
      this.live.set(id, { ...tunnel, handle: deadHandle() })
    }
  }
}

/** Whether two configurations forward the same endpoint the same way. */
function sameTarget(a: TunnelHostConfig, b: TunnelHostConfig): boolean {
  return a.host === b.host && a.sshPort === b.sshPort && a.user === b.user
    && a.remoteHost === b.remoteHost && a.remotePort === b.remotePort && a.localPort === b.localPort
}

/** The last stderr line, or the exit facts when stderr said nothing. */
function sshDiagnostic(handle: SubprocessHandle, outcome: { exitCode: number | null; signal: NodeJS.Signals | null }): string {
  const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
  const lastLine = (stderr.split('\n').at(-1) ?? '').trim()
  if (lastLine.length > 0) return lastLine
  if (outcome.signal !== null) return `ssh died from ${String(outcome.signal)}`
  return `ssh exited with code ${String(outcome.exitCode)}`
}

/** A handle stub for spawn-level failures: dead on arrival, reads empty. */
function deadHandle(): SubprocessHandle {
  const done = Promise.resolve({ exitCode: null, signal: 'SIGKILL' as NodeJS.Signals })
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done,
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  }
}
