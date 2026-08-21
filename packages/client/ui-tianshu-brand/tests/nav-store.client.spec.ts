/** Navigation store semantics: selection, the toggle-off rule, and clearing. */
import { describe, expect, it } from 'vitest'
import { createNavStore } from '../src/client/nav-store.ts'

describe('nav store', () => {
  it('starts with no destination open', () => {
    expect(createNavStore().create().getSnapshot().active).toBeUndefined()
  })

  it('opens a destination and switches between them', () => {
    const nav = createNavStore().create()
    nav.actions.select('tasks')
    expect(nav.getSnapshot().active).toBe('tasks')
    nav.actions.select('sessions')
    expect(nav.getSnapshot().active).toBe('sessions')
  })

  it('re-selecting the open destination closes it', () => {
    // The same sidebar row is both the way in and the way back.
    const nav = createNavStore().create()
    nav.actions.select('tasks')
    nav.actions.select('tasks')
    expect(nav.getSnapshot().active).toBeUndefined()
  })

  it('clears an open destination', () => {
    const nav = createNavStore().create()
    nav.actions.select('config')
    nav.actions.clear()
    expect(nav.getSnapshot().active).toBeUndefined()
  })

  it('does not persist the open destination across instances', () => {
    // Which page you were on is a per-visit fact: a fresh load opens the
    // conversation, not whatever management page was last viewed.
    const nav = createNavStore().create()
    nav.actions.select('tasks')
    expect(createNavStore().create().getSnapshot().active).toBeUndefined()
  })
})
