// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { TianshuSidebarComponentProps } from '../src/client/contract/slots.ts'
import { createNavStore } from '../src/client/nav-store.ts'
import { TianshuSidebar } from '../src/client/TianshuSidebar.tsx'
import { en } from '../src/client/locales.ts'

// The three seat owner shares, read from the slot declarations ui-sidebar
// owns (this package claims those holes rather than re-declaring them).
type SectionOwner = OwnerOf<'sidebar.workspaces'>
type SettingsOwner = OwnerOf<'sidebar.settings'>
type FooterOwner = OwnerOf<'sidebar.footer.action'>

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: TianshuSidebarComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never

function mountShell({ collapsed = false, width = 300 }: { collapsed?: boolean; width?: number } = {}) {
  const startSession = vi.fn()
  const toggleSidebar = vi.fn()
  const nav = createNavStore().create()
  let regionOwner: SectionOwner | undefined
  let settingsOwner: SettingsOwner | undefined
  let footerActionOwner: FooterOwner | undefined
  let current = { collapsed, width }
  function Bench({ collapsed: c, width: w }: { collapsed: boolean; width: number }) {
    const snapshot = useSyncExternalStore(fn => nav.subscribe(fn), () => nav.getSnapshot())
    const useStore = ((selector: (s: unknown) => unknown) =>
      selector(snapshot)) as TianshuSidebarComponentProps['useStore']
    return renderShell(c, w, useStore)
  }
  const renderShell = (
    c: boolean, w: number, useStore: TianshuSidebarComponentProps['useStore'],
  ) => (
    <TianshuSidebar
      collapsed={c} width={w}
      useSessions={neverHook} useWorkspaces={neverHook}
      useStore={useStore} actions={nav.actions}
      startSession={startSession} toggleSidebar={toggleSidebar} t={t}
      renderSlot={((
        key: string,
        owner: FooterOwner | SectionOwner | SettingsOwner,
      ) => {
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        regionOwner = owner as SectionOwner
        return <div data-testid="region" data-wide={owner.wide} />
      }) as TianshuSidebarComponentProps['renderSlot']}
    />
  )
  const root = () => <Bench collapsed={current.collapsed} width={current.width} />
  const view = render(root())
  return {
    startSession,
    toggleSidebar,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('TianshuSidebar shell', () => {
  it('routes New Session (wordmark + capsule) and the column toggle', () => {
    const b = mountShell()
    const starters = screen.getAllByRole('button', { name: 'New session' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('hands every seat its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    vi.useFakeTimers()
    const b = mountShell()
    b.rerender({ collapsed: true })
    // Wide content survives the crossfade window, then settles into the rail.
    expect(b.regionOwner().wide).toBe(true)
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(b.regionOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByTestId('region')).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders statically collapsed on a cold start', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('renders the three navigation destinations and marks the picked one current', () => {
    mountShell()
    for (const label of ['Configuration', 'Tasks', 'Sessions']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    const tasks = screen.getByRole('button', { name: 'Tasks' })
    expect(tasks.getAttribute('aria-current')).toBeNull()
    fireEvent.click(tasks)
    expect(tasks.getAttribute('aria-current')).toBe('page')
    // Selection is exclusive: picking another row releases the first.
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))
    expect(tasks.getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sessions' }).getAttribute('aria-current')).toBe('page')
  })

  it('keeps the navigation reachable as icon-only controls on the rail', () => {
    mountShell({ collapsed: true })
    // Labels collapse away, so the accessible name comes from aria-label.
    expect(screen.getByRole('button', { name: 'Configuration' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeTruthy()
  })

  it('publishes the layout anchors an embedding shell measures it by', () => {
    // The desktop client's Windows titlebar measures this column through the
    // root and pads it while wide. It finds them by attribute and returns
    // silently when absent, so dropping them would break that layout with no
    // error anywhere — hence a test rather than a comment.
    mountShell()
    const root = document.querySelector('[data-dsh-sidebar-root]')
    expect(root).not.toBeNull()
    expect(root?.getAttribute('data-dsh-sidebar-wide')).toBe('true')

    // Mounting already collapsed skips the settle animation, so the rail
    // posture is observable without driving transition events here.
    cleanup()
    mountShell({ collapsed: true })
    expect(document.querySelector('[data-dsh-sidebar-root]')
      ?.getAttribute('data-dsh-sidebar-wide')).toBe('false')
  })
})
