/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-document-convert-pandoc`.
 * @module @deepseek-ai/dsh-document-convert-pandoc/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-document-convert-pandoc'

/** Cordis companion plugin name. */
export const name = 'document-convert-pandoc-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider's route set and binary path are settled once at apply and never
 * change afterwards, and every conversion's result is checked by the seam that dispatched it. There is
 * no mutable registry or event stream this package owns for a check to fold over.
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
