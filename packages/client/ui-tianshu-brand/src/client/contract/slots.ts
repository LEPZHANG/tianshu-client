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
import type { CollectionId, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SkillEntry, SuiteEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { createNavStore } from '../nav-store.ts'
import type { TianshuSidebarKey } from '../locales.ts'

/** The navigation destinations the design's sidebar lists below New Session. */
export type TianshuNavKey = 'suites' | 'skills' | 'mcp' | 'connector' | 'tasks' | 'sessions'

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
 * Registrant-private injected share of the management surface (arrives via the
 * register inject factory). Actions only: every read rides the standard
 * `useWorkspaces` hook, so this face carries no queries.
 *
 * A type alias for the same index-signature reason as
 * {@link TianshuSidebarInjected}.
 */
export type TianshuPagesInjected = {
  /**
   * Open one session as the current conversation. Only opens: the surface
   * closes its own page through its store action beside this call, because
   * the page's visibility is the page's own declared state.
   */
  openSession: (sessionId: SessionId) => void
  /** Rename a session; rejects with the host's message on failure. */
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  /** Archive a session into the registry-global set; rejects on failure. */
  archiveSession: (sessionId: SessionId) => Promise<void>
  /** Unarchive a session back to its grouping position; rejects on failure. */
  unarchiveSession: (sessionId: SessionId) => Promise<void>
  /** Soft-delete a session into the recycle bin; rejects on failure. */
  deleteSession: (sessionId: SessionId) => Promise<void>
  /** Restore a soft-deleted session; rejects on failure. */
  restoreSession: (sessionId: SessionId) => Promise<void>
  /** Create an empty collection; rejects on a blank title. */
  createCollection: (title: string) => Promise<void>
  /** Rename a collection; rejects on a blank title or unknown id. */
  renameCollection: (collectionId: CollectionId, title: string) => Promise<void>
  /** Delete a collection; member sessions keep every other membership. */
  deleteCollection: (collectionId: CollectionId) => Promise<void>
  /** File a session under a collection; rejects on an unknown id. */
  addSessionToCollection: (collectionId: CollectionId, sessionId: SessionId) => Promise<void>
  /** Take a session out of a collection. */
  removeSessionFromCollection: (collectionId: CollectionId, sessionId: SessionId) => Promise<void>
  /**
   * Prefill the composer of the current session with a skill invocation
   * (the `/name` token plus a trailing space). Resolves false when no
   * current session or its input shell is absent — the caller keeps the
   * page open in that case rather than stranding the text.
   */
  sendSkillToComposer: (name: string) => boolean
  /**
   * List the user-invocable skill catalogue for the CURRENT session's
   * project (the host's only skill listing RPC is session-addressed).
   * Resolves undefined when no session is current — the caller falls back
   * to its local catalogue rather than implying a load.
   */
  listSkills: () => Promise<readonly SkillEntry[] | undefined>
  /**
   * List the built-in suite catalogue with its install state. Rejects when
   * the host composition does not mount the suite service.
   */
  listSuites: () => Promise<readonly SuiteEntry[]>
  /**
   * Install one suite (writes its skills under the user skill root);
   * resolves to the re-projected catalogue. Rejects on an unknown id.
   */
  installSuite: (suiteId: string) => Promise<readonly SuiteEntry[]>
  /**
   * Uninstall one suite (user-edited skills survive); resolves to the
   * re-projected catalogue. Rejects on an unknown id.
   */
  uninstallSuite: (suiteId: string) => Promise<readonly SuiteEntry[]>
}

/**
 * Full component props of the management surface: the nav store the sidebar
 * writes, the injected action face, and the locale seat. It reads no owner
 * params — `shell.overlay` supplies none.
 */
export type TianshuPagesComponentProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createNavStore>>
  & TianshuPagesInjected
  & PropsLocale<'tianshuBrand'>

/** Re-exported so the locale key union travels with the contract. */
export type { TianshuSidebarKey }
