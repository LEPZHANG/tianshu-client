/**
 * SSH port-forward tunnels that surface remote-GPU OpenAI-compatible model
 * endpoints on localhost.
 *
 * One configured host becomes one `ssh -N -L` child process owned by the
 * subprocess seam (tree-scoped termination, disposal cleanup) plus a
 * `llm-pi-ai` provider row pointing at the forwarded local port — so model
 * requests, model discovery, and the Models settings UI all work through the
 * ordinary provider path and never learn a tunnel exists.
 *
 * Authentication stays with the system `ssh` binary: the key material, agent,
 * and `~/.ssh/config` aliases the user already has keep working unchanged.
 * The first milestone deliberately assumes key-based auth; password-only
 * servers are surfaced as a tunnel failure with the ssh diagnostic, not as a
 * separate interactive password path.
 *
 * @module @deepseek-ai/dsh-host-llm-tunnel
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type {
  TunnelHostConfig,
  TunnelHostId,
  TunnelModelListing,
  TunnelProbeResult,
  TunnelSnapshot,
  TunnelStatus,
} from './types.ts'
import { TunnelManager } from './manager.ts'
import { Config, NS } from './config.ts'

export type * from './types.ts'
export { Config, NS } from './config.ts'

/** Effective configuration of the whole tunnel namespace. */
export interface TunnelSection {
  hosts: Record<string, TunnelHostConfig>
}

/**
 * Remote-only service owning the tunnels. Configuration arrives through the
 * `llm-tunnel` settings namespace (see {@link Config}); live lifecycle and
 * probing are RPC because they are host-process facts the browser cannot
 * hold.
 */
export class LlmTunnelService extends TypertRemoteService {
  static inject = ['subprocess']

  private readonly manager: TunnelManager

  constructor(ctx: Context, config: TunnelSection) {
    super(ctx, 'llmTunnel')
    this.manager = new TunnelManager(ctx)
    // The settings section owns configuration truth: every effective change
    // (user edit, composition base, provider detach) reconciles the live
    // tunnel set against it — starting new hosts, stopping removed ones.
    installSettingsSection(ctx, NS, Config, config, {
      setSource: (getter) => { this.configGetter = getter },
      onChange: () => { this.manager.syncAll(this.configGetter().hosts) },
    })
    ctx.effect(() => () => { this.manager.disposeAll() }, 'llm-tunnel: teardown')
  }

  /** Reads the effective settings section; swapped by installSettingsSection. */
  private configGetter: () => TunnelSection = () => ({ hosts: {} })

  /**
   * Live projection of every configured tunnel.
   * @returns one status per configured host, in settings order.
   */
  @Remote('snapshot')
  snapshot(): TunnelSnapshot {
    return this.manager.snapshot()
  }

  /**
   * Restart one tunnel — the recovery action the status row offers.
   * @param id - the configured host to reconnect.
   * @returns the tunnel's status after the restart begins.
   */
  @Remote('restart')
  restart(id: TunnelHostId): TunnelStatus {
    return this.manager.restart(id)
  }

  /**
   * Probe one tunnel's model endpoint through the forward and list the
   * models an OpenAI-compatible server reports. The probe reads the local
   * port directly, so a successful answer proves the whole chain.
   * @param id - the configured host to probe.
   * @returns the listing on success, or the failure reason.
   */
  @Remote('probe')
  async probe(id: TunnelHostId): Promise<TunnelProbeResult & { models: readonly TunnelModelListing[] }> {
    return this.manager.probe(id)
  }
}

export default LlmTunnelService
