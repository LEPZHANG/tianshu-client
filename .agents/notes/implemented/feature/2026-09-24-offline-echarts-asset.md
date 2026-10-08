# Agent Note: shipping ECharts with the skill that needs it

Status: implemented

English | [中文](2026-09-24-offline-echarts-asset.zh.md)

## Problem

The 数据可视化 skill told the model to build chart pages around `https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js`. This product installs onto local networks with no route to the internet, so that reference resolves to nothing.

The failure is silent, which is what makes it worth fixing rather than documenting. The model succeeds, the file is written, the user double-clicks it, and a blank page opens. No tool reports an error, the transcript looks correct, and nothing in the page says the missing piece was a network fetch.

It was also the last one. A grep for `http` across `src/catalogue.ts` matched that single line; the other five skill bodies send the model nowhere.

## Decision

### The library ships inside the package that installs the skill

`packages/skill/skill-suites/assets/echarts/` holds `echarts.min.js` (upstream `echarts@5.6.0` `dist/echarts.min.js`, unmodified) and `echarts-LICENSE.txt`. `package.json` lists `assets/**` in `files`, so the npm tarball carries them.

An npm dependency on `echarts` was the alternative. It was rejected because it reintroduces the thing being removed: resolving the library becomes something that has to have happened on some machine with a registry reachable, and the failure mode moves from install time to a place nobody looks. Committed bytes are available to every install path — desktop installer, plain CLI, a clone on an isolated network — with no step in between.

The `vendor/` tree was not an option either. `collectVendored()` in `scripts/gen-third-party-notices.ts` requires a `vendor/<dir>/package.json` and hard-fails any license other than MIT; ECharts is Apache-2.0.

### The skill directory is the delivery point, because the model is already told about it

`BundledSkill` gained an optional `assets` list, and `install()` writes each entry into the skill directory beside SKILL.md. No new config key was needed, and the path never has to reach the skill body, because the mechanism already exists:

`skill-filesystem` reports each discovered skill's directory as `resourceBase: { kind: 'directory', path }` ([`src/index.ts:217`](../../../../packages/skill/skill-filesystem/src/index.ts)), and `dsh-skill` renders it to the model as `Base directory for this skill: <path>` followed by an instruction to resolve relative paths against it ([`src/index.ts:197`](../../../../packages/skill/skill/src/index.ts)). A body that names `echarts.min.js` therefore names a file the model can find.

The skill body now produces a folder — `<chart>.html`, `echarts.min.js`, `echarts-LICENSE.txt` — with the page loading `./echarts.min.js`. That folder can be copied to a share or sent to a colleague and still opens offline, which the previous single file could not do without a network. The license text travels because handing the folder to someone else is a redistribution of Apache-2.0 code.

### The page names a fallback stack, not one typeface

The skill requires a `font-family` stack that ends in a generic family (`sans-serif`) and forbids making one specific typeface the only one. A chart page is opened on whatever machine receives it, and a page asking for a font that machine does not have is not blank: the browser substitutes silently, the labels reflow, and nothing reports it — the same class of failure the bundled library exists to avoid, one property over. The rule sits with the no-CDN rule in the skill body, because both are about the page surviving on a machine that has only what it shipped with.

### Install state stays directory presence

`list()` was left alone. Its rule — the directory IS the record — is a stated product decision, and the upgrade case is not worth bending it for: a body edited by the user must not be reported as uninstalled, which is exactly what a content-based check would do. The cost is recorded as a limitation in the package README: a skill installed before the assets existed keeps reporting installed and has no asset files until the suite is installed again.

Asset writing is byte-comparison idempotent, matching the existing `bodyHash` check for SKILL.md. A damaged asset is rewritten on the next install; an intact one is not touched.

## Enforcement

Two package tests hold the invariant that made this necessary:

- no bundled skill body matches `https?://`, so the CDN reference cannot return by way of a future skill;
- every declared asset exists on disk and is named by the body that has to copy it, so a declaration and its file cannot drift apart.

`scripts/gen-third-party-notices.ts` gained a `BUNDLED_ASSETS` table and a `## Bundled assets` section. Every other tier of that document derives from a manifest, so a file committed into a package would otherwise be disclosed nowhere; `collectBundledAssets()` fails when a row names a file the tree does not have.

## Consequences

The repository now carries a 1 MB minified file, its largest, ahead of `pnpm-lock.yaml`. It is committed verbatim and never edited in place: a version bump replaces the file, its license text, and the version recorded in `THIRD_PARTY_NOTICES.md` together.

A chart is now a folder of roughly 1 MB rather than one HTML file, and the folder is the unit that gets copied or sent. A user who moves only the `.html` out of it gets back the blank page this change removed.

An existing install keeps reporting installed with no asset files in its directory. It gets them when the suite is installed again, which rewrites any asset whose bytes do not match the shipped copy.

## Alternatives considered

- **Inline the library into each HTML file** via a shell splice. Produces a genuinely self-contained file, at 1 MB per chart, and depends on a shell tool with different commands per platform. Rejected as the most fragile option for the least gain.
- **Reference the skill directory by absolute path.** Smallest output, but the page only opens on the machine that made it — a chart is something people send.
- **Fetch it in `dsh-desktop/scripts/fetch-convert-tools.mjs`** alongside LibreOffice and poppler. Consistent with the other offline tools, but reachable only from the desktop installer, and the skill would need a config path to find it.
