/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-tianshu-brand`.
 * @module @deepseek-ai/dsh-client-ui-tianshu-brand/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-tianshu-brand'

/** Cordis companion plugin name. */
export const name = 'client-ui-tianshu-brand-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a presentation-only plugin whose contributions are a
 * theme token override layer and one slot registration, both owned and
 * unwound by the theme and slot registries. It emits no cordis events and owns
 * no cross-plugin mutable state; token composition and sidebar behavior are
 * asserted by this package's component specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
