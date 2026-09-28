# @deepseek-ai/dsh-skill-suites

English | [中文](README.zh.md)

Built-in expert-suite catalogue: skill bundles whose install writes the bundled SKILL.md bodies into the user skill root.

## Model

- The suite table is a shipped constant (`src/catalogue.ts`); suites have no remote source (product decision).
- Install writes each bundled skill to `$DSH_HOME/skills/<name>/SKILL.md`. **Install state is file presence** — no stored record, so a hand-deleted folder is an uninstall and reinstall is idempotent.
- A skill may declare assets: files shipped under `assets/` that install writes into the skill directory beside SKILL.md. The filesystem provider reports that directory as the skill's resource base, so the body addresses an asset by bare file name and the model resolves it. The 数据可视化 skill uses this to ship ECharts, so the chart pages it writes load the library from disk instead of a CDN.
- `list()` reports `installed` (every skill directory present) and `current` (every installed SKILL.md hashes to the body this package ships). A suite installed from an older body is installed but not current, which is what a client turns into a reinstall action; a user-edited file reports the same way, and reinstalling overwrites it.
- Uninstall removes only directories whose SKILL.md still hashes to the bundled body; a user-edited skill survives. A skill left behind by a shipped-body change therefore cannot be uninstalled, only reinstalled over.
- The package never touches the skill registry: the filesystem provider (`dsh-skill-filesystem`) discovers installed skills on its next scan, the same path a hand-written skill takes.

## Model Experience

Indirectly, through the skill files an install writes: `dsh-skill-filesystem` discovers them on its next scan, and `dsh-tool-skill` catalogs and renders them exactly as it does a hand-written skill.

#### KV Cache effect

An install or uninstall changes the skill catalog the next request prefix carries, invalidating the cached prefix from the catalog message onward; this package assembles and sends no request of its own.

## Known Limitations and Deferred Work

- Install does not force a provider rescan: the composer's `/` menu reflects a newly installed skill on the provider's own scan cadence, not immediately.
- One suite ships (`office-essentials`, six skills); the table is the single place to add more.
- A skill installed before its assets existed is still reported installed, because install state is directory presence. Its directory has no asset files until the suite is installed again, which rewrites whatever does not match the bundled bytes.
