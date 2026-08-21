// @vitest-environment jsdom
/**
 * Management surface behavior: when it paints, what each destination shows, and
 * that its empty states state the backend gap rather than implying a load.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TianshuNavKey, TianshuPagesComponentProps } from '../src/client/contract/slots.ts'
import { createNavStore } from '../src/client/nav-store.ts'
import { TianshuPages } from '../src/client/TianshuPages.tsx'
import { en } from '../src/client/locales.ts'

const t: TianshuPagesComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// The surface never reads the workspaces hook, but it rides the standard
// props share; stub it as a never-called function.
const neverHook = (() => { throw new Error('pages must not read the workspaces hook') }) as never

afterEach(() => { cleanup() })

/** Session rows as the framework delivers them (host order in `ids`). */
interface SessionSeed { id: string; title?: string; blank?: boolean }

/**
 * Mount the surface over a real store instance, optionally pre-selected.
 * @param options.active - destination open at mount.
 * @param options.sessions - session rows the framework hook reports.
 * @returns the store snapshot reader.
 */
function mountPages(options: { active?: TianshuNavKey; sessions?: SessionSeed[] } = {}) {
  const nav = createNavStore().create()
  if (options.active !== undefined) nav.actions.select(options.active)
  const seeds = options.sessions ?? []
  const listState = {
    ids: seeds.map(s => s.id),
    byId: Object.fromEntries(seeds.map(s => [s.id, { title: s.title, blank: s.blank }])),
  }
  const useSessions = ((selector: (s: unknown) => unknown) =>
    selector(listState)) as TianshuPagesComponentProps['useSessions']

  function Bench() {
    const snapshot = useSyncExternalStore(fn => nav.subscribe(fn), () => nav.getSnapshot())
    const useStore = ((selector: (s: unknown) => unknown) =>
      selector(snapshot)) as TianshuPagesComponentProps['useStore']
    return (
      <TianshuPages
        useStore={useStore} actions={nav.actions}
        useSessions={useSessions} useWorkspaces={neverHook}
        t={t}
      />
    )
  }
  render(<Bench />)
  return { state: () => nav.getSnapshot() }
}

describe('TianshuPages gating', () => {
  it('paints nothing while no destination is selected', () => {
    mountPages()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('closes back to the conversation', () => {
    const pages = mountPages({ active: 'tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(pages.state().active).toBeUndefined()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })
})

describe('TianshuPages tasks', () => {
  it('shows the template catalogue and says it cannot create tasks yet', () => {
    mountPages({ active: 'tasks' })
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(screen.getByText('Critical data backup')).toBeTruthy()
    // The notice is the honest part: templates render but create nothing.
    expect(screen.getByText(/no template capability yet/)).toBeTruthy()
  })

  it('states why the task list is empty rather than showing a bare zero', () => {
    mountPages({ active: 'tasks' })
    expect(screen.getByText(/session-scoped model tools/)).toBeTruthy()
  })
})

describe('TianshuPages sessions', () => {
  it('lists sessions in host order', () => {
    mountPages({
      active: 'sessions',
      sessions: [{ id: 'a', title: '第一个会话' }, { id: 'b', title: '第二个会话' }],
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual(['第一个会话', '第二个会话'])
  })

  it('labels a session with no title', () => {
    mountPages({ active: 'sessions', sessions: [{ id: 'a' }] })
    expect(screen.getByText('New Session')).toBeTruthy()
  })

  it('labels a session whose title is empty', () => {
    // A blank title is not the same value as an absent one, and both must read
    // as untitled rather than rendering an empty row.
    mountPages({ active: 'sessions', sessions: [{ id: 'a', title: '' }] })
    expect(screen.getByText('New Session')).toBeTruthy()
  })

  it('names a blank session the way the workspace tree does', () => {
    // The tree calls a blank session "New Session" (ui-workspace rows). A
    // carried-over title on a still-blank session would otherwise give one
    // session two names across two surfaces.
    mountPages({ active: 'sessions', sessions: [{ id: 'a', title: 'stale title', blank: true }] })
    expect(screen.getByText('New Session')).toBeTruthy()
    expect(screen.queryByText('stale title')).toBeNull()
  })

  it('shows an empty state with no sessions', () => {
    mountPages({ active: 'sessions' })
    expect(screen.getByText('No sessions yet')).toBeTruthy()
  })
})

describe('TianshuPages config', () => {
  it('points at Settings instead of duplicating it', () => {
    mountPages({ active: 'config' })
    expect(screen.getByRole('heading', { level: 1, name: 'Configuration' })).toBeTruthy()
    expect(screen.getByText(/lives in Settings/)).toBeTruthy()
  })
})
