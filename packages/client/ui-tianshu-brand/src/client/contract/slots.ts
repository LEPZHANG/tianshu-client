/**
 * Tianshu sidebar slot contract: this shell occupies the layout-owned `sidebar`
 * slot in place of the shipped one, and claims the same three holes at
 * registration so existing contributors (ui-workspace's browser, ui-settings'
 * foot) keep working unchanged.
 *
 * The three hole declarations are REUSED from ui-sidebar rather than
 * re-declared here. `SlotMap` is a declaration-merged interface spanning the
 * whole compilation, so a second declaration of the same key would collide
 * with the shipped one even though only one of the two plugins is ever mounted
 * — `gen-client-catalog` rejects the duplicate because it cannot tell which
 * documentation describes the live slot. The type-only import below pulls
 * those declarations in; runtime authorization still comes from this package's
 * own `children` at register, which is what the slot core checks.
 *
 * The dependency also acts as a tripwire: if upstream changes one of the three
 * specs, this package stops compiling instead of silently drifting.
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidebar' entry) into every
// program that sees this contract, so PropsRuntime<'sidebar'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the three sidebar child-slot declarations (see module doc).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { createNavStore } from '../nav-store.ts'
import type { TianshuSidebarKey } from '../locales.ts'

/** The navigation destinations the design's sidebar lists below New Session. */
export type TianshuNavKey = 'config' | 'tasks' | 'sessions'

/**
 * Registrant-private injected share (arrives via the register inject factory).
 *
 * A type alias rather than an interface: only an alias carries the implicit
 * index signature that lets it satisfy the erased `Record<string, unknown>`
 * inject face.
 */
export type TianshuSidebarInjected = {
  /**
   * Start a New Session: with a workspace, reuse-or-create its blank session
   * and open it; without one, inherit the current Session Workspace.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
}

/** Full component props: owner state, the three declared holes, the shared nav store, injected callbacks, locale seat. */
export type TianshuSidebarComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createNavStore>>
  & TianshuSidebarInjected & PropsLocale<'tianshuBrand'>

/**
 * Full props of the management surface: the same nav store the sidebar writes,
 * plus the locale seat. It reads no owner params — `shell.overlay` supplies none.
 */
export type TianshuPagesComponentProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createNavStore>>
  & PropsLocale<'tianshuBrand'>

/** Re-exported so the locale key union travels with the contract. */
export type { TianshuSidebarKey }
