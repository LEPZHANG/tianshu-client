# @deepseek-ai/dsh-client-ui-tianshu-brand

English | [中文](README.zh.md)

天枢平台 brand layer. It contributes two things: a theme token override layer carrying the platform's identity, and the branded sidebar shell that replaces the shipped one.

This package is the fork's brand seam. It exists so the platform's visual identity lives in one added package instead of edits spread across upstream files, which keeps `git pull` from upstream conflict-free.

## Token layer

`brand-tokens.ts` stacks a layer on the active theme through [`ctx.theme.overrideTokens`](../ui-theme/README.md), keyed by this package's name. Only tokens whose Tianshu value differs from the shipped theme belong there — currently the sidebar column fill (an ice-blue translucent glass gradient in light theme, translucent navy glass in dark) and the brand text ink. The layer is global, so it carries identity only; ink that must change *inside* the glass column is rebound locally in `TianshuSidebar.module.css`, because a global override would repaint the whole application.

The light-theme column is a light surface, so its local rebinds read deep-navy on glass; the dark theme re-rebinds the same tokens to the white family through `body[data-ds-dark-theme]` (ui-theme's canonical dark signal), because the dark column stays a translucent navy over dark surfaces. The column also applies `backdrop-filter: blur(18px)`, so whatever the window paints behind it reads as frosted glass. Dark-theme values keep the column readable rather than reusing the light glass, which would strand dark-on-light text.

## Sidebar

`sidebar` is a `single` slot, so registering into it **replaces** the shipped shell rather than adding to it; the web-app bundle disables the `ui-sidebar` row accordingly. This package re-declares the same three holes — `sidebar.workspaces`, `sidebar.settings`, `sidebar.footer.action` — so [ui-workspace](../ui-workspace/README.md)'s browser and [ui-settings](../ui-settings/README.md)'s foot keep their seats unchanged.

The column keeps the shipped shell's structural behavior: collapse is a slide plus crossfade into the layout-owned 56px rail, the content freezes at its expanded width while fading so nothing reflows mid-slide, and scrollbars are a pointer affordance that rebinds ui-theme's scrollbar indirection away while the pointer is elsewhere. Added on top is the navigation block (配置 / 任务管理 / 会话管理) between New Session and the browsing region.

The navigation rows open management surfaces this package owns. Selection is cross-entry state — the sidebar and the pages are two registrations — so it lives in a declared store whose one handle both receive from `apply`; re-selecting the open row closes it. It is not persisted, because which page you were on is a per-visit fact and restoring one over a fresh load would hide the conversation the product opens with.

`TianshuPages` registers into `shell.overlay` rather than `conversation`: that slot is a single entry owned by ui-conversation, and taking it would displace the whole chat surface. The overlay spans the entire frame, so the page is a two-track grid whose first track is the sidebar's — left empty and click-through, because the navigation that closes the page lives there. That track's width comes from `--dsh-tianshu-sidebar-width`, published by the sidebar from the width the frame already hands it, so a drag or collapse moves the page with the column and no width is restated. What the pages can honestly show is bounded by what the host has; see Known Limitations.

The column carries `data-dsh-sidebar-root` and `data-dsh-sidebar-wide`. These are layout anchors for an embedding shell, not styling hooks: the desktop client's Windows titlebar measures the column through the root and pads it while wide, finding them by attribute and returning silently when absent. Dropping them would break that layout with no error anywhere, so a test pins them.

`TianshuSidebarComponentProps` composes the layout owner share, the framework session hooks, the three declared child slots, and injected `startSession` plus sidebar-toggle callbacks. There is no plugin store.

The `/client` exports are the plugin body (`apply`/`inject`) plus contract types only; the components and the token table remain package-internal.

## Model Experience

None, as this package renders browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **任务管理's template catalogue is presentation only** — the three template cards render fixed copy and create nothing, because the host has no template concept to create from. The page says so in place rather than implying a load. Making them real needs a host-side capability, not a change here.
- **任务管理 lists no tasks** — the host's scheduling is session-scoped model-visible reminders (`after`/`at`/`every`), not the cross-session task table the reference design shows. There is nothing global to enumerate, so the section is honestly empty; a real table is a new host capability.
- **会话管理's deletion is soft only** — the page carries every verb the wire offers (open, rename, archive/unarchive, folder filing, delete-to-bin, restore), but a deleted session's log stays on disk because session persistence exposes no row removal; the recycle bin has no purge or empty action until that host capability exists. The row menu's delete is a two-step confirm, and the bin row offers restore only, so no control on this surface can reach for a capability the host lacks.
- **会话管理 has no search, sort, or batch selection** — rows follow the framework's host-ordered delivery; the filtering is by archive state and folder only. Session search exists on the wire (`sessions.search`), but wiring it here is deferred until the list is long enough to need it.
- **专家套件 install does not refresh the running session's `/` menu live** — installing writes under the user skill root and the filesystem provider discovers it on its next scan; when that scan re-fires the composer menu updates, but the page does not force it. **技能 falls back to the shipped catalogue when no session is current** — the host's only skill listing RPC is session-addressed, so a sessionless view shows the local table (host rows otherwise take over, with Chinese titles merged from the local table by name).
- **技能 renders the shipped catalogue, not the host list** — the five built-in skills (with categories and detail bodies) are a UI-local table; the host's read-only per-session `skill.list` channel replaces it when wired, at which point the local categories give way to the host `source` vocabulary. 「发送到对话」 prefills the current session's composer through the scoped insert-text event — the same path a menu pick takes — and keeps the page open when no current session accepts it.
- **MCP lists no servers** — each mcp-client instance is one server declared in the profile's cordis.yml and none ships enabled by default, so the page states how a server attaches rather than rendering a fabricated catalogue. A server-management surface is a host capability that does not exist yet.
- **连接器 points at the providers Settings already manages** — the host's attachable external services today are model providers with credentials in Settings; a dedicated connector domain is deferred.
- **The wordmark is an inlined font subset** — `TianshuMarks.module.css` embeds a woff2 covering exactly 天枢平台TIANSHUPLATFORM, subset from Source Han Serif CN Heavy (SIL OFL) because the package bundles no asset pipeline. Extending the lockup's text means regenerating the subset (`pyftsubset --text=… --flavor=woff2`); other codepoints fall through to the system stack.
- **Column ink is rebound by rule, not by audit** — the stylesheet inverts the ink, border, and interactive token families a nested surface is expected to read. A contributor registering into `sidebar.workspaces` with a token outside those families can still land dark-on-blue.
