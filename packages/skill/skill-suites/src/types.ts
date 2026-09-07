/**
 * Built-in expert-suite catalogue: the fixed constant table shipped with the
 * host (the product decision: suites have no remote source). Each suite
 * bundles complete SKILL.md bodies; installing one writes them into the user
 * skill root, where the filesystem skill provider discovers them on its next
 * scan — the suite never talks to the skill registry directly.
 *
 * Types only — the service and id factory live in `index.ts`.
 * @module @deepseek-ai/dsh-skill-suites/src/types
 */

/** One bundled skill: its `/name` and the complete SKILL.md body. */
export interface BundledSkill {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Complete SKILL.md document, frontmatter included. */
  readonly body: string
}

/** One built-in suite: an id plus the skills it installs. */
export interface SuiteDefinition {
  /** Stable suite id (referenced by the install-state store and the RPC). */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Display category tag. */
  readonly tag: string
  /** One-line description of what the suite is for. */
  readonly description: string
  /** The skills this suite installs, in catalogue order. */
  readonly skills: readonly BundledSkill[]
}

/** Install-state view of one suite, as the RPC projects it. */
export interface SuiteView {
  /** Stable suite id. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Display category tag. */
  readonly tag: string
  /** One-line description. */
  readonly description: string
  /** Skill names this suite installs, in order. */
  readonly skillNames: readonly string[]
  /** Whether the suite's files are currently under the user skill root. */
  readonly installed: boolean
}
