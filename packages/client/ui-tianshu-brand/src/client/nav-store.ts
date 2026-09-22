/**
 * Navigation selection shared by the sidebar and the surfaces it opens.
 *
 * The sidebar entry and the page entry are two registrations, so the selection
 * is cross-entry state: it belongs in a declared store, and both registrations
 * receive the SAME handle from `apply`. Keeping it in the sidebar's local state
 * would leave the page with no way to read it.
 *
 * Not persisted: which page you were on is a per-visit fact, and restoring a
 * management page over a fresh load would hide the conversation the product
 * opens with.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { TianshuNavKey } from './contract/slots.ts'

/** Store state: the open destination, or none (the conversation shows through). */
type NavState = { active: TianshuNavKey | undefined }

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type NavActions = {
  select: (draft: NavState, key: TianshuNavKey) => void
  clear: (draft: NavState) => void
}

/**
 * Create the navigation store handle.
 * @returns the handle shared by the sidebar and page registrations.
 */
export function createNavStore(): EngineStoreHandle<NavState, NavActions> {
  return defineStore({
    init: (): NavState => ({ active: undefined }),
    actions: {
      // Re-selecting the open destination closes it, so the same row toggles
      // back to the conversation.
      select: (draft, key) => { draft.active = draft.active === key ? undefined : key },
      clear: (draft) => { draft.active = undefined },
    },
  })
}
