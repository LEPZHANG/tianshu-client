/**
 * Tianshu brand plugin: stacks the brand token layer on the active theme,
 * registers the branded sidebar into the layout-owned `sidebar` slot, and adds
 * the management surface its navigation opens.
 *
 * The sidebar slot is `single`, so this registration REPLACES the shipped
 * shell rather than adding to it — the bundle disables the `ui-sidebar` row
 * accordingly. This package re-declares the three holes that shell declared,
 * so ui-workspace and ui-settings keep their seats.
 *
 * The sidebar and the management surface are two registrations sharing ONE
 * navigation store handle, minted here: that is the sanctioned way to hold
 * cross-entry state, and it is why both live in this package rather than
 * splitting the pages into a second one (which would need a cross-package
 * channel the client rules do not provide).
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the theme plugin's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the input-trigger scoped-event declarations
// ('slash/input-prefill-text') into this program so the composer prefill
// dispatches against the declared event map.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { BRAND_TOKEN_SOURCE, BRAND_TOKENS } from './brand-tokens.ts'
import { createNavStore } from './nav-store.ts'
import { TianshuPages } from './TianshuPages.tsx'
import { TianshuSidebar } from './TianshuSidebar.tsx'
import { en, zh, type TianshuSidebarKey } from './locales.ts'
import type { SkillEntry, SuiteEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { TianshuPagesInjected, TianshuSidebarInjected } from './contract/slots.ts'

export type {
  TianshuNavKey, TianshuPagesComponentProps, TianshuSidebarComponentProps, TianshuSidebarInjected,
} from './contract/slots.ts'
export type { TianshuSidebarKey } from './locales.ts'
export { createNavStore } from './nav-store.ts'

/**
 * The connection RPC envelope the skill calls below read: a value on success,
 * nothing but the flag on failure.
 */
type SkillRpc<T> = { result: { ok: true; value: T } } | { result: { ok: false } }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Platform shell copy (sidebar controls, navigation, management pages). */
    tianshuBrand: TianshuSidebarKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'tianshuBrand'

/** Services required by the brand plugin. */
export const inject = ['slots', 'layout', 'theme', 'sessions', 'workspaces', 'locale', 'connection']

/**
 * Install the brand layer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-tianshu-brand: dictionaries')

  ctx.effect(
    () => ctx.theme.overrideTokens(BRAND_TOKEN_SOURCE, BRAND_TOKENS),
    'ui-tianshu-brand: token layer',
  )

  // One handle, two registrations: the sidebar writes the selection and the
  // management surface renders from it.
  const nav = createNavStore()

  /* jscpd:ignore-start -- the replacement column must declare the shipped
     sidebar's registration verbatim: same slot name, same three child seats,
     same injected callbacks. Registrants seat themselves by those names, so a
     divergence here would silently strip the browsing region or the foot. */
  const injectProps = (): TianshuSidebarInjected => ({
    startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
  })
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      children: {
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      store: nav,
      inject: injectProps,
    }, TianshuSidebar),
    'ui-tianshu-brand: sidebar registration',
  )
  /* jscpd:ignore-end */

  /**
   * The management surface's action face: session lifecycle verbs plus the
   * collection axis, each hop one service call. Opening a session only opens;
   * closing the page is the page's own store action, taken by the component
   * beside this call (a raw `create()` here would mint a second engine
   * instance, not reach the one the components read).
   */
  /* jscpd:ignore-start -- the session verbs repeat ui-workspace's browser face
     because both faces are the same one-call hops onto the same services; the
     surfaces differ, the way to reach a session does not. */
  const pagesInjected = (): TianshuPagesInjected => ({
    openSession: (sessionId) => { ctx.sessions.open(sessionId) },
    renameSession: async (sessionId, title) => {
      // Row → session-face hop: rename is a per-session verb (ISession), not
      // a list-service verb; the binding resolves any listed session.
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    archiveSession: async (sessionId) => { await ctx.workspaces.archiveSession(sessionId) },
    unarchiveSession: async (sessionId) => { await ctx.workspaces.unarchiveSession(sessionId) },
    deleteSession: async (sessionId) => { await ctx.workspaces.deleteSession(sessionId) },
    restoreSession: async (sessionId) => { await ctx.workspaces.restoreSession(sessionId) },
    createCollection: async (title) => { await ctx.workspaces.createCollection(title) },
    renameCollection: async (collectionId, title) => { await ctx.workspaces.renameCollection(collectionId, title) },
    deleteCollection: async (collectionId) => { await ctx.workspaces.deleteCollection(collectionId) },
    addSessionToCollection: async (collectionId, sessionId) => {
      await ctx.workspaces.addSessionToCollection(collectionId, sessionId)
    },
    removeSessionFromCollection: async (collectionId, sessionId) => {
      await ctx.workspaces.removeSessionFromCollection(collectionId, sessionId)
    },
    /* jscpd:ignore-end */
    listSkills: async () => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return undefined
      const api = (ctx.get('connection') as { api: { skills: {
        list(payload: { sessionId: SessionId }): Promise<SkillRpc<{ skills: readonly SkillEntry[] }>>
      } } }).api
      const response = await api.skills.list({ sessionId: current })
      if (!response.result.ok) throw new Error('skill listing failed')
      return response.result.value.skills
    },
    listSuites: async () => {
      const api = (ctx.get('connection') as { api: { skills: {
        suiteList(payload: {}): Promise<SkillRpc<{ suites: readonly SuiteEntry[] }>>
      } } }).api
      const response = await api.skills.suiteList({})
      if (!response.result.ok) throw new Error('suite list failed')
      return response.result.value.suites
    },
    installSuite: async (suiteId) => {
      const api = (ctx.get('connection') as { api: { skills: {
        suiteInstall(payload: { suiteId: string }): Promise<SkillRpc<{ suites: readonly SuiteEntry[] }>>
      } } }).api
      const response = await api.skills.suiteInstall({ suiteId })
      if (!response.result.ok) throw new Error('suite install failed')
      return response.result.value.suites
    },
    uninstallSuite: async (suiteId) => {
      const api = (ctx.get('connection') as { api: { skills: {
        suiteUninstall(payload: { suiteId: string }): Promise<SkillRpc<{ suites: readonly SuiteEntry[] }>>
      } } }).api
      const response = await api.skills.suiteUninstall({ suiteId })
      if (!response.result.ok) throw new Error('suite uninstall failed')
      return response.result.value.suites
    },
    sendSkillToComposer: (name) => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return false
      const binding = ctx.sessions.binding(current)
      if (binding === undefined) return false
      // Out-of-band prefill: append `/name ` at the composer's draft end. This
      // is a scoped event with no pick moment, so it carries no span CAS — the
      // session's input listener stamps the live draft revision itself. An
      // ordinary insert-text span would demand a pick-time draftRev this caller
      // cannot know, so a non-pristine composer would silently reject it.
      const applied = binding.ctx.bail(
        binding.ctx, 'slash/input-prefill-text', { text: `/${name} ` },
      )
      return applied === true
    },
  })

  // The overlay slot is declared by ui-layout, whose apply order relative to
  // this one is unconstrained: wait for the declaration rather than assuming it.
  ctx.effect(
    () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'tianshu-pages',
      locale: NS,
      store: nav,
      inject: pagesInjected,
    }, TianshuPages)),
    'ui-tianshu-brand: management surface registration',
  )
}
