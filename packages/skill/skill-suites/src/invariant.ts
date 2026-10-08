/** Package-owned invariant companion. @module @deepseek-ai/dsh-skill-suites/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-skill-suites'

/** Cordis companion plugin name. */
export const name = 'skill-suites-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the suite catalogue is one immutable table compiled into the package, and install
 * state is read back from the filesystem on every projection rather than tracked in memory, so this package
 * owns no mutable registry or event stream for a check to fold over. That the table's bodies are well-formed
 * SKILL.md files the provider would discover is a property of a fixed value, pinned by the package tests.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
