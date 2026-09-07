/**
 * Skill-suite host plugin: the built-in expert-suite catalogue plus its
 * install lifecycle. Installing a suite writes each bundled SKILL.md under
 * the user skill root (`$DSH_HOME/skills/<name>/SKILL.md`), where the
 * filesystem skill provider discovers it on its next scan — this plugin
 * never touches the skill registry itself, so an installed skill arrives
 * through exactly the same discovery path a hand-written one does.
 *
 * Install state is file presence, not a database row: the directory under
 * the user root IS the record, so a user who deletes a folder by hand has
 * uninstalled the skill, and re-installing is idempotent. Uninstall removes
 * only directories this catalogue owns — a directory whose SKILL.md no
 * longer matches the bundled body byte-for-byte was edited after install
 * and is left alone.
 *
 * Namespace plugin (named exports, no default export).
 *
 * @module @deepseek-ai/dsh-skill-suites
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { BUILTIN_SUITES } from './catalogue.ts'
import type { SuiteDefinition, SuiteView } from './types.ts'

export { BUILTIN_SUITES } from './catalogue.ts'
export type { BundledSkill, SuiteDefinition, SuiteView } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'skill-suites'

/** Services required by this plugin. */
export const inject: readonly string[] = []

/** Config accepted by this plugin. */
export interface Config {
  /** DeepSeek Harness config root; the user skill root lives beneath it. */
  dshHome?: string
}

/** Config schema (loader-validated). */
export const Config: Schema<Config> = z.object({
  dshHome: z.string(),
})

/** One suite id the catalogue does not hold. */
export class UnknownSuiteError extends Error {
  /**
   * @param suiteId - The unknown suite id.
   */
  constructor(readonly suiteId: string) {
    super(`unknown suite '${suiteId}'`)
    this.name = 'UnknownSuiteError'
  }
}

/** A directory under the user skill root that is not a plain directory. */
export class SkillRootEntryError extends Error {
  constructor(readonly path: string) {
    super(`skill root entry '${path}' is not a directory`)
    this.name = 'SkillRootEntryError'
  }
}

/** SHA-256 of a body, as the byte-identity check for edit detection. */
const bodyHash = (body: string): string => createHash('sha256').update(body, 'utf8').digest('hex')

/**
 * The skill-suite catalogue service: reads the shipped table, projects its
 * install state from the filesystem, and installs/uninstalls by writing or
 * removing directories under the user skill root.
 */
export class SkillSuites {
  private readonly userSkillRoot: string

  /**
   * @param config - plugin config (the home root override).
   */
  constructor(config: Config = {}) {
    this.userSkillRoot = join(resolveDshHome(config.dshHome), 'skills')
  }

  /** The user skill root this service installs beneath. */
  get skillRoot(): string {
    return this.userSkillRoot
  }

  /**
   * The shipped catalogue projected against the filesystem.
   * @returns one view per built-in suite, in catalogue order.
   */
  async list(): Promise<readonly SuiteView[]> {
    const present = await this.installedNames()
    return BUILTIN_SUITES.map(suite => ({
      id: suite.id,
      title: suite.title,
      tag: suite.tag,
      description: suite.description,
      skillNames: suite.skills.map(skill => skill.name),
      installed: suite.skills.every(skill => present.has(skill.name)),
    }))
  }

  /**
   * Install one suite: write every bundled SKILL.md under the user root.
   * Idempotent — an already-present skill with the bundled body is left
   * untouched (no rewrite, no timestamp churn).
   * @param suiteId - suite to install.
   * @throws {UnknownSuiteError} when the id is not in the catalogue.
   */
  async install(suiteId: string): Promise<void> {
    const suite = this.suite(suiteId)
    for (const skill of suite.skills) {
      const file = join(this.userSkillRoot, skill.name, 'SKILL.md')
      try {
        if (bodyHash(await readFile(file, 'utf8')) === bodyHash(skill.body)) continue
      } catch {
        // Absent (or unreadable) file: fall through and (re)write it.
      }
      await mkdir(join(this.userSkillRoot, skill.name), { recursive: true })
      await writeFile(file, skill.body, 'utf8')
    }
  }

  /**
   * Uninstall one suite: remove its skill directories, but only those whose
   * SKILL.md still matches the bundled body byte-for-byte — an edited skill
   * is the user's work and survives the uninstall. Idempotent: missing
   * directories resolve.
   * @param suiteId - suite to uninstall.
   * @throws {UnknownSuiteError} when the id is not in the catalogue.
   */
  async uninstall(suiteId: string): Promise<void> {
    const suite = this.suite(suiteId)
    for (const skill of suite.skills) {
      const dir = join(this.userSkillRoot, skill.name)
      const file = join(dir, 'SKILL.md')
      try {
        const current = await readFile(file, 'utf8')
        if (bodyHash(current) !== bodyHash(skill.body)) continue
        await rm(dir, { recursive: true })
      } catch {
        // Absent directory: nothing to remove.
      }
    }
  }

  /** Resolve one catalogue suite or fail: an unknown id is a caller bug. */
  private suite(suiteId: string): SuiteDefinition {
    const found = BUILTIN_SUITES.find(suite => suite.id === suiteId)
    if (found === undefined) throw new UnknownSuiteError(suiteId)
    return found
  }

  /** Skill directory names currently under the user root. */
  private async installedNames(): Promise<Set<string>> {
    const names = new Set<string>()
    try {
      for (const entry of await readdir(this.userSkillRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) names.add(entry.name)
        else throw new SkillRootEntryError(join(this.userSkillRoot, entry.name))
      }
    } catch (error) {
      // An absent root is an empty catalogue; anything else propagates.
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw error
      }
    }
    return names
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The skill-suite catalogue service this plugin installs. */
    skillSuites: SkillSuites
  }
}

/**
 * Plugin body: install the catalogue service onto the context.
 * @param ctx - Host root context.
 * @param config - Plugin config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.provide('skillSuites', new SkillSuites(config))
}
