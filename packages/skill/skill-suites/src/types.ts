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
  /** Human-facing display name for the catalogue card (distinct from the model-routing `description:` in the body). */
  readonly title: string
  /** One-line UI summary of what the skill produces, shown on the suite card. */
  readonly summary: string
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
  /** The skills this suite installs, in order (name, display title, and UI summary; no body). */
  readonly skills: readonly SuiteSkillView[]
  /** Whether the suite's files are currently under the user skill root. */
  readonly installed: boolean
}

/** One skill of a suite as the RPC projects it: identity and display copy, without the SKILL.md body. */
export interface SuiteSkillView {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Human-facing display name for the catalogue card. */
  readonly title: string
  /** One-line UI summary of what the skill produces. */
  readonly summary: string
}
