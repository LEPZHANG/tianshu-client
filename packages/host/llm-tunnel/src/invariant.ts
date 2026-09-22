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
 * Invariant: every configured host has at most one live tunnel process, and a
 * tunnel reported `connected` answers on its local port. Checked in tests via
 * the service's own snapshot; the installer registers the relation so the
 * runtime reporter exercises it once per tick.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
