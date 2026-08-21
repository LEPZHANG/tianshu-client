# Agent Note: Six dsh-desktop patches became Harness source

Status: implemented

English | [中文](2026-08-20-desktop-patches-into-source.zh.md)

## Problem

[Pointing the desktop shell at this checkout](2026-08-18-tianshu-desktop-integration.md) retired all twelve of `dsh-desktop`'s `patch-package` patches, because they rewrite compiled `lib/client.js` bundles in `node_modules` and this checkout supplies that code as source. Two were ported then, because the shell does not boot without them. The other ten were left as a list of behavior the desktop build had and this one does not.

Six of those ten are ordinary product improvements with nothing desktop-specific about them. Leaving them in a disabled patch file means the browser build never gets them, and the next `dsh-desktop` upgrade has to rebase them against a bundle whose CSS-module hashes changed.

## Decision

Port those six into source. Each was reimplemented against the source it targets rather than transliterated from the patch, because a patch against a bundle carries the bundler's artifacts — inline CSS strings, `documentElement.lang` checks, generated class names — that source has real facilities for.

**`403` is no longer `AUTH`** (`llm-deepseek`, `llm-pi-ai`, `client-runtime`). Both adapters classified `401` and `403` together, so a working key refused for a region, model entitlement, or org policy was reported as an invalid key. `403` now answers `FORBIDDEN`. Quota classification also moves ahead of the status test in both adapters: providers report an exhausted balance as `403` as readily as `429`, and status-first filed those under `AUTH` — telling the user to replace a key that works. The GUI's failure projection answers `QUOTA` and `FORBIDDEN` with copy naming the actual remedy, joining the existing `AUTH` substitution; all three replace provider wording that misdirects, and the raw diagnostic stays in the session log.

`FORBIDDEN` is a bare string beside `AUTH` rather than a new exported constant. The exported codes (`QUOTA`, `CONTEXT_WINDOW_EXCEEDED`, `EMPTY_RESPONSE`, `INVALID_CREDENTIAL`) exist because a shared classifier or thrower backs each one; `FORBIDDEN` is decided by an HTTP status at two sites, which is what `AUTH` and `RATE_LIMIT` already are. It stays outside the default retryable set: a refused entitlement fails identically on every attempt.

**Inline code that spells a path links** (`ui-deliverables`). The mention vocabulary matched only the current turn's produced paths, so a turn that explained by citing files linked none of them. A second tier now recognizes path *spelling* — a leading `/`, `~/`, `./`, `../`, drive letter, or UNC root; any token with a separator; or a bare filename with a plausible extension — stripping a trailing `:line`, `:line:col`, or `#Lline`. The produced-path tier still runs first and still refuses to guess between two paths sharing a basename.

This relaxes a documented guarantee, which the README and its Known Limitations now state instead of the old one. The guarantee was that a mention "can never open the wrong file or 404". The first half survives: the produced tier is unchanged. The second half is deliberately given up, because the opener already swallows Host/OS failures, so a wrong guess costs one click that opens nothing. The heuristic cannot separate `Object.prototype.hasOwnProperty` from `archive.tar.gz`; narrowing it would drop real multi-part filenames, so the false positive is preferred and documented.

**The query rail** (`ui-conversation`). A fixed column of tick marks beside the transcript, one per user query and steering message, marking which turn owns the reading position. Rebuilt as a CSS module and dictionary keys: the patch injected a `<style>` tag at module scope and branched on `documentElement.lang.startsWith('zh')`, both of which exist in source as `.module.css` and `ctx.locale`. Its geometry is measured from the resolved scrollport and the composer's top edge rather than restated in CSS, so it follows the window, the sidebar, and a growing input card.

It renders **last** in `ChatView`, which is load-bearing and not cosmetic: React commits child layout effects before the parent's, so a rail placed first measured `listRef` and `columnRef` before either had attached and permanently withdrew itself. It is `position: fixed`, so document order does not place it.

**The searchable provider grid** (`ui-settings-models`). The add card's native dropdown listed dozens of dormant routes with no search and no route id visible until a name was chosen. It is now a card grid over a search box matching display name and route id together, so `kimi` and `moonshotai-cn` find the same card, with common routes ordered ahead of the alphabetical tail. The card opens summarized on its chosen route — filling in that route's key is the common path — and expands on **Change**.

`ProviderChoice` is generic in its target so the page's own editor-target type, which carries settings addressing this component has no use for, reaches `onChoose` unflattened.

**The sidebar's shell layout anchors came back** (`ui-tianshu-brand`). While triaging what the disabled `…ui-sidebar…` patch actually did, it turned out its `data-dsh-sidebar-root` / `-wide` attributes were not branding: `src/preload/windows-titlebar.ts` measures the sidebar column through the root and pads it while wide. It locates them by attribute and returns silently when absent, so retiring the patch had broken that layout with no error anywhere. The 天枢 sidebar now publishes both, with a test pinning them and the README stating the contract — a comment alone would not have survived the next refactor. (The patch's third attribute, `-footer`, anchored the phone-pairing button, which [a later change](2026-08-20-desktop-drop-pairing-and-localize.md) removed.)

## Consequences

The browser build gets all six; the desktop build gets them through the same source it already runs. Six patch files stop being maintenance debt against a moving bundle.

Two obsolete assertions changed with the behavior they described: `ui-deliverables` asserted that a turn producing nothing yields no mention vocabulary at all, and `ui-settings-models` drove the add card through `<select>` options. Both now assert the new behavior.

`patches/` is deleted from `dsh-desktop` rather than emptied. All twelve patch files live under `docs/patches-disabled-for-tianshu/`, whose README triages each; `patch-package` scans subdirectories of `patches/`, so a disabled patch parked there still failed `npm install`.

Four patches remain unported, for reasons rather than lack of time: `…ui-sidebar…` and `…ui-layout…` target chrome the 天枢 sidebar replaced; the preset-archive half of the apiproxy patch needs host endpoints this build does not serve, which is why `…ui-agent-preset…` stays off with it; and the settings-models onboarding-dialog half would replace this checkout's first-run step, which is a product decision.

The `dsh-desktop` tests that assert the literal contents of these six patches now fail for a further reason — the behavior moved rather than disappeared. They should be rewritten to assert the behavior through the running app, or deleted.

## Alternatives considered

**Transliterate each patch.** Faster and diff-checkable against the original. Rejected: the patches carry bundler artifacts with no place in source. Copying the injected `<style>` tag and the `lang` sniff would have imported two anti-patterns this repository has explicit facilities against, and the reviewer could not tell intent from bundler residue.

**Port all ten.** Consistent, and it would empty the directory. Rejected: the four named above are blocked on decisions or missing capabilities, not on effort. Porting them would have meant either inventing a host capability inside a patch-porting change, or replacing a first-run flow without asking.

**Leave the six as patches and rebase them per upgrade.** No source change, and the desktop build keeps its behavior. Rejected: it withholds all six from the browser build, and the rebase target is a compiled bundle whose CSS-module hashes change on every upstream build.

## Testing

Package tests carry each port: the two adapters' status tables gained their `403` and quota-before-status cases; `client-runtime` gained a `failure-display` spec covering all three substituted codes and the pass-through; `ui-deliverables` gained the path-spelling tiers, the inert cases, and the documented false positive; `ui-conversation` gained a `query-rail` spec for the reading-position threshold and six ChatView cases for the rendered rail; `ui-settings-models` gained a `provider-picker` spec for ordering, search, and both postures.

Every changed package under `packages/*/*/src` holds per-file 100%. `packages/client/runtime/src/**` is coverage-exempt, so its new spec is behavioral coverage rather than a gate requirement.

The `verify-models-section-styles` gate caught a real thing during this work: it flagged `ProviderPicker.tsx` for a `<select>` without the shared chevron class. The match was the word inside a prose comment, not markup — the gate splits on the literal string. The comment was reworded; the gate reads source text, and tightening it to skip comments is a separate change.
