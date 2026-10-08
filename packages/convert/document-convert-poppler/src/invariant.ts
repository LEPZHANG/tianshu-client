/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-document-convert-poppler`.
 * @module @deepseek-ai/dsh-document-convert-poppler/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-document-convert-poppler'

/** Cordis companion plugin name. */
export const name = 'document-convert-poppler-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each provider holds one immutable route and one binary path sampled at apply,
 * and every extraction verifies its own result — the run rejects an empty output rather than trusting
 * the exit code. There is no mutable registry or event stream this package owns for a check to fold over.
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
