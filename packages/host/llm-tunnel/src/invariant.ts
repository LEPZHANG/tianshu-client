/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-llm-tunnel/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-llm-tunnel'

/** Cordis companion plugin name. */
export const name = 'host-llm-tunnel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a host's phase is computed from its `ssh` child's liveness at read time, so the
 * snapshot is a projection of the children rather than a second copy that could disagree with them. Whether
 * a connected tunnel answers on its local port is a network fact, established on demand by `probe` and
 * pinned by `tunnel.spec.ts`, not a relation this package holds in memory for a tick to fold over.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
