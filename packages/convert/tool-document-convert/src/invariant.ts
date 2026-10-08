/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-document-convert`.
 * @module @deepseek-ai/dsh-tool-document-convert/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-document-convert'

/**
 * No runtime invariant: this package owns one tool registration and one prompt section, both held by the
 * registries that verify them, and its per-call decisions — source existence, sandbox containment, and
 * the overwrite guard — are enforced inside the execution that makes them rather than recorded in state
 * a check could fold over.
 */
const install: InvariantInstaller = () => {}

/** Cordis companion plugin name. */
export const name = 'tool-document-convert-invariant'
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
