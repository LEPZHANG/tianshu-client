/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-official-document`.
 * @module @deepseek-ai/dsh-tool-official-document/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-official-document'

/**
 * No runtime invariant: this package owns one tool registration and one prompt section, both held by the
 * registries that verify them, and everything else it does is a pure function of one call's arguments —
 * the GB/T 9704—2012 check, the ODF layout, and the staging directory all begin and end inside the
 * execution that made them, leaving no state a check could fold over.
 */
const install: InvariantInstaller = () => {}

/** Cordis companion plugin name. */
export const name = 'tool-official-document-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
