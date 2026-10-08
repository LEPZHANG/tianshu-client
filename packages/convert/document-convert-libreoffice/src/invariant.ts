/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-document-convert-libreoffice`.
 * @module @deepseek-ai/dsh-document-convert-libreoffice/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-document-convert-libreoffice'

/** Cordis companion plugin name. */
export const name = 'document-convert-libreoffice-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider holds one immutable filter table and one binary path sampled at
 * apply, and every conversion verifies its own result — the run checks that the expected output file
 * exists rather than trusting the exit code. There is no mutable registry or event stream this package
 * owns for a check to fold over.
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
