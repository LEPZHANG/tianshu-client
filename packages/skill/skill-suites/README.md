# @deepseek-ai/dsh-skill-suites

Built-in expert-suite catalogue: skill bundles whose install writes the bundled SKILL.md bodies into the user skill root.

## Model

- The suite table is a shipped constant (`src/catalogue.ts`); suites have no remote source (product decision).
- Install writes each bundled skill to `$DSH_HOME/skills/<name>/SKILL.md`. **Install state is file presence** — no stored record, so a hand-deleted folder is an uninstall and reinstall is idempotent.
- Uninstall removes only directories whose SKILL.md still hashes to the bundled body; a user-edited skill survives.
- The package never touches the skill registry: the filesystem provider (`dsh-skill-filesystem`) discovers installed skills on its next scan, the same path a hand-written skill takes.

## Model Experience

Independent of live requests: installing or uninstalling a suite only writes or removes files under the user skill root, so no request prefix or KV-cache effect exists.

## Known Limitations and Deferred Work

- Install does not force a provider rescan: the composer's `/` menu reflects a newly installed skill on the provider's own scan cadence, not immediately.
- One suite ships (`office-essentials`, four skills); the table is the single place to add more.
