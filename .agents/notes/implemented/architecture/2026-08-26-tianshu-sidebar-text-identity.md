# Agent Note: The Tianshu column identity became type-only

Status: implemented

English | [中文](2026-08-26-tianshu-sidebar-text-identity.zh.md)

## Problem

Two identity elements of the branded column came from the reference design (design 首页) and were both questioned by the product owner on 2026-08-26.

First, 新建会话 rendered as a light elevated pill — a distinct visual tier above the navigation block below it (配置管理 / 定时任务 / 会话管理), which the owner wanted gone: the four rows should read as one aligned list.

Second, the column carried a geometric emblem (an inline SVG sphere in `TianshuMarks.tsx`, drawn to approximate the reference logo and admitted in the package README as a hand-drawn stand-in). The owner asked for its deletion and for the platform name 天枢平台 to carry the identity alone, with a typeface suitable for a government-facing platform that still needs a technical character.

## Decision

新建会话 is now styled as the first row of the navigation list: same geometry (38px height, 10px radius, 12px horizontal padding, 10px icon-text gap), same ink (`label-secondary`, primary on hover), same hover fill (`--dsw-specific-sidebar-nav-item-hover`) as `.navItem`, in both the wide column and the collapsed rail. The icon rides the same 16px size the navigation icons use.

The emblem is deleted outright: `TianshuEmblem`, its rail seat in the collapsed toggle, and the emblem/panel-icon hover swap in the stylesheet are gone. The collapsed toggle now always shows the panel icon, matching the shipped dsh rail.

The wordmark renders as pure type in an inlined woff2 covering exactly 天枢平台TIANSHUPLATFORM — a subset of Source Han Serif CN Heavy (思源宋体, SIL OFL 1.1; subsetting and embedding are license-permitted), 5.5KB as a data URI in the new `TianshuMarks.module.css`. The lockup is the G2 variant the product owner picked from a six-variant review plus two refinement rounds: the Chinese name at 21px / 0.18em tracking over a small uppercase Latin subtitle `TIANSHU PLATFORM` at 8px / 0.34em, struck through by a full-row hairline. The 1px line rides the subtitle's mid-height, runs from the row head past the glyphs and on beneath the column toggle, fading 40%→4% white; the shell's `.logoRow` clip is the edge that stops it (`.brand` no longer clips, or the line would end at the wordmark box). The subtitle occludes the line through a background-blue `paint-order: stroke` halo (the column's top gradient stop `#2563EB`), so the glyphs knock the line out around themselves while the letter gaps let it read through — the instrument-label look. The serif cut carries the official-document register; the tracked Latin subtitle carries the institutional bilingual identity. The font declares weight 700 so the system fallback stack (`STSong` / `SimSun` / `Helvetica Neue`) stays reasonable while the woff2 loads or if it ever fails.

The package has no asset pipeline (tsdown/rolldown bundles no file handling — the reason the emblem was inline SVG), so the data URI is not a workaround but the same build-free route, following the `DshChipCell` precedent in ui-conversation.

## Consequences

The column reads as one list: four rows, one rhythm, the primary action no longer a separate tier. This is a deliberate deviation from the reference design, made by the product owner — the design 首页 pill is no longer the target for this element.

Deleting the emblem removes the rail's only brand presence: collapsed, the column shows a generic panel toggle. Accepted by the owner; the wordmark cannot fit a 56px rail.

Extending the wordmark text now means regenerating the font subset (`pyftsubset --text=… --flavor=woff2 --desubroutinize`); any other codepoint falls through to the system stack. The README's Known Limitations records this maintenance fact where the hand-drawn-emblem caveat used to be.

The subset was verified byte-exact against the generated woff2 after embedding (a hand-paste had dropped one base64 character; the check caught it). Regeneration should keep that verification step.

## Alternatives considered

**Keep the pill and restyle it lighter.** Would have preserved the primary-action hierarchy the reference design drew. Rejected: the owner explicitly wanted the rows aligned, and the nav-row treatment loses no function — the button still leads the list and keeps its tooltip and aria-label.

**Ship the full OTF and let the browser load it.** 8.8MB for four glyphs, plus an asset path the bundler does not support. The subset is 1.3KB and needs no pipeline.

**Use a system font stack alone at heavy weight.** No shipping system font is uniformly Heavy across the deployment's platforms (PingFang tops out at Semibold, YaHei at Bold), so the identity would render differently per machine. The inlined subset pins the glyphs everywhere.

**A drawn logotype (SVG paths per glyph).** Same bytes-for-bytes appearance as the font at fixed size, but hand-maintained path data that no tool can regenerate from text. The subset regenerates from any Source Han Sans release.

## Testing

The package suites pass (37 tests): the wordmark remains a second New Session button by accessible name, the rail toggle keeps its open/collapse labels, and no test referenced the emblem's SVG. Repository `typecheck` is clean. The embedded base64 was programmatically verified to decode to the exact subset bytes.
