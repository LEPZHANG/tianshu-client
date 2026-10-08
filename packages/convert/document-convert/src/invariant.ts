/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-document-convert`.
 * @module @deepseek-ai/dsh-document-convert/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-document-convert'

/** Cordis companion plugin name. */
export const name = 'document-convert-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider registry is private, a provider's routes are static data the type
 * system constrains at its declaration site, and every plan is checked as it is built — `planRoute`
 * refuses an unreachable, pinned-but-unservable, or tied route instead of returning one, and `run`
 * refuses a step that produced no file. The seam publishes no registry view or outcome event stream that
 * a check could fold over.
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
