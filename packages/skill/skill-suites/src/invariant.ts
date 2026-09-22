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
 * Invariant: the built-in suite table's every skill body is a well-formed
 * SKILL.md (frontmatter present, its name matching the install directory).
 * Asserted in package tests; the installer reserves package ownership so
 * the runtime reporter covers the table once loaded.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
