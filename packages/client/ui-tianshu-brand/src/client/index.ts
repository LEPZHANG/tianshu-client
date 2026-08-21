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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the theme plugin's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { BRAND_TOKEN_SOURCE, BRAND_TOKENS } from './brand-tokens.ts'
import { createNavStore } from './nav-store.ts'
import { TianshuPages } from './TianshuPages.tsx'
import { TianshuSidebar } from './TianshuSidebar.tsx'
import { en, zh, type TianshuSidebarKey } from './locales.ts'
import type { TianshuSidebarInjected } from './contract/slots.ts'

export type {
  TianshuNavKey, TianshuPagesComponentProps, TianshuSidebarComponentProps, TianshuSidebarInjected,
} from './contract/slots.ts'
export type { TianshuSidebarKey } from './locales.ts'
export { createNavStore } from './nav-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Platform shell copy (sidebar controls, navigation, management pages). */
    tianshuBrand: TianshuSidebarKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'tianshuBrand'

/** Services required by the brand plugin. */
export const inject = ['slots', 'layout', 'theme', 'sessions', 'workspaces', 'locale']

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

  // The overlay slot is declared by ui-layout, whose apply order relative to
  // this one is unconstrained: wait for the declaration rather than assuming it.
  ctx.effect(
    () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'tianshu-pages',
      locale: NS,
      store: nav,
    }, TianshuPages)),
    'ui-tianshu-brand: management surface registration',
  )
}
