/** Brand plugin registration: slot occupancy, the token layer, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-tianshu-brand/client'
import type { TianshuSidebarInjected } from '@deepseek-ai/dsh-client-ui-tianshu-brand/client'
import type { TianshuPagesInjected } from '../src/client/contract/slots.ts'
import { BRAND_TOKEN_SOURCE } from '../src/client/brand-tokens.ts'

/** Per-test service overrides; each defaults to a minimal stub. */
interface BenchOverrides {
  sessions?: Record<string, unknown>
  workspaces?: Record<string, unknown>
  connection?: unknown
}

async function bench(declare = true, overrides: BenchOverrides = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn() }
  const workspaces = overrides.workspaces ?? { startSession: vi.fn() }
  const sessions = overrides.sessions ?? { open: vi.fn(), clear: vi.fn() }
  const disposeOverride = vi.fn()
  // Typed to the real signature: the assertions below read the call's
  // arguments, which an untyped vi.fn() would surface as `any`.
  const theme = {
    overrideTokens: vi.fn(
      (_source: string, _tokens: Record<string, { light: string; dark: string }>) => disposeOverride,
    ),
  }
  const connection = overrides.connection ?? { api: { skills: {
    suiteList: async () => ({ result: { ok: true, value: { suites: [] } } }),
    suiteInstall: async () => ({ result: { ok: true, value: { suites: [] } } }),
    suiteUninstall: async () => ({ result: { ok: true, value: { suites: [] } } }),
  } } }
  ctx.provide('layout', layout)
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('theme', theme as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('connection', connection as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      { name: 'root', children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      } } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, workspaces, sessions, connection, theme, disposeOverride }
}

/** Boot apply and return the real management-surface injected face. */
async function pagesFace(overrides: BenchOverrides = {}): Promise<{ face: TianshuPagesInjected; b: Awaited<ReturnType<typeof bench>> }> {
  const b = await bench(true, overrides)
  await b.ctx.plugin({ inject: [...inject], apply }).await()
  const face = (b.slots.entries('shell.overlay')[0]!.inject as () => TianshuPagesInjected)()
  return { face, b }
}

describe('ui-tianshu-brand apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'theme', 'sessions', 'workspaces', 'locale', 'connection'])
  })

  it('registers the shell and declares the seats the shipped sidebar declared', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.workspaces')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    expect(b.slots.entries('sidebar')[0]!.locale).toBe('tianshuBrand')
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => TianshuSidebarInjected)()
    expect(Object.keys(injected)).toEqual(['startSession', 'toggleSidebar'])
    injected.startSession('workspace' as never)
    expect(b.workspaces.startSession).toHaveBeenCalledWith('workspace')
    injected.startSession()
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith(undefined)
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('stacks the brand token layer under this package as the source', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.theme.overrideTokens).toHaveBeenCalledOnce()
    const call = b.theme.overrideTokens.mock.calls[0]
    if (call === undefined) throw new Error('token layer never stacked')
    const [source, tokens] = call
    expect(source).toBe(BRAND_TOKEN_SOURCE)
    // Every override carries both modes: a bare string is rejected downstream.
    for (const modes of Object.values(tokens)) {
      expect(Object.keys(modes).sort()).toEqual(['dark', 'light'])
      expect(typeof modes.light).toBe('string')
      expect(typeof modes.dark).toBe('string')
    }
    // The column fill is the identity token this layer exists to carry.
    expect(tokens).toHaveProperty('--dsw-specific-sidebar-fill')
  })

  it('registers the management surface into the overlay list', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = b.slots.entries('shell.overlay')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options.id).toBe('tianshu-pages')
    expect(entries[0]?.locale).toBe('tianshuBrand')
  })

  it('gives both registrations the SAME nav store handle', async () => {
    // The shared handle is what lets the sidebar's selection reach the pages;
    // two handles would render an always-empty surface.
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const sidebarStore = b.slots.entries('sidebar')[0]?.store
    const pagesStore = b.slots.entries('shell.overlay')[0]?.store
    expect(sidebarStore).toBeDefined()
    expect(pagesStore).toBe(sidebarStore)
  })

  it('fails when no live owner declared the sidebar slot', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes the entry, the child declarations, and the token layer on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(b.slots.spec('sidebar.workspaces')).toBeUndefined()
    expect(b.slots.spec('sidebar.footer.action')).toBeUndefined()
    expect(b.disposeOverride).toHaveBeenCalledOnce()
  })

  it('prefills the current session composer via the scoped input event', async () => {
    // The real pagesInjected face (not the pages spec's mock): "send to
    // composer" reads the current session, resolves its binding, and bails the
    // out-of-band prefill event on the session scope. The listener's own draft
    // revision stamping is why this caller passes no span.
    const bail = vi.fn((_actx: unknown, _event: string, _payload: unknown) => true)
    const binding = { ctx: { bail } }
    const sessions = {
      open: vi.fn(),
      list: { getSnapshot: () => ({ current: 's1' }) },
      binding: vi.fn((id: string) => (id === 's1' ? binding : undefined)),
    }
    const { face } = await pagesFace({ sessions })

    expect(face.sendSkillToComposer('data-visualization')).toBe(true)
    expect(sessions.binding).toHaveBeenCalledWith('s1')
    expect(bail).toHaveBeenCalledWith(
      binding.ctx, 'slash/input-prefill-text', { text: '/data-visualization ' },
    )
  })

  it('refuses to prefill without a current session or a resolvable binding', async () => {
    const noCurrent = {
      open: vi.fn(),
      list: { getSnapshot: () => ({ current: undefined }) },
      binding: vi.fn(() => undefined),
    }
    const first = await pagesFace({ sessions: noCurrent })
    expect(first.face.sendSkillToComposer('data-visualization')).toBe(false)
    expect(noCurrent.binding).not.toHaveBeenCalled()

    const noBinding = {
      open: vi.fn(),
      list: { getSnapshot: () => ({ current: 's1' }) },
      binding: vi.fn(() => undefined),
    }
    const second = await pagesFace({ sessions: noBinding })
    expect(second.face.sendSkillToComposer('data-visualization')).toBe(false)
    expect(noBinding.binding).toHaveBeenCalledWith('s1')
  })

  it('reports a refused bail (locked composer) as not sent', async () => {
    const bail = vi.fn(() => undefined)
    const sessions = {
      open: vi.fn(),
      list: { getSnapshot: () => ({ current: 's1' }) },
      binding: vi.fn(() => ({ ctx: { bail } })),
    }
    const { face } = await pagesFace({ sessions })
    expect(face.sendSkillToComposer('data-visualization')).toBe(false)
  })
})

describe('ui-tianshu-brand management-surface injected face', () => {
  /** A connection whose skill RPCs each resolve ok or fail, per the flags. */
  const connectionOf = (flags: {
    skillsList?: 'ok' | 'fail'
    suiteList?: 'ok' | 'fail'
    suiteInstall?: 'ok' | 'fail'
    suiteUninstall?: 'ok' | 'fail'
  }) => {
    const listReply = flags.skillsList === 'fail'
      ? { result: { ok: false } }
      : { result: { ok: true, value: { skills: [{ name: 'weekly-report' }] } } }
    const suitesReply = (flag: 'ok' | 'fail' | undefined) => (flag === 'fail'
      ? { result: { ok: false } }
      : { result: { ok: true, value: { suites: [{ id: 'office-essentials' }] } } })
    return { api: { skills: {
      list: vi.fn(async (_p: { sessionId: string }) => listReply),
      suiteList: vi.fn(async (_p: {}) => suitesReply(flags.suiteList)),
      suiteInstall: vi.fn(async (_p: { suiteId: string }) => suitesReply(flags.suiteInstall)),
      suiteUninstall: vi.fn(async (_p: { suiteId: string }) => suitesReply(flags.suiteUninstall)),
    } } }
  }

  it('opens a session as the current conversation', async () => {
    const sessions = { open: vi.fn() }
    const { face } = await pagesFace({ sessions })
    face.openSession('s1' as never)
    expect(sessions.open).toHaveBeenCalledWith('s1')
  })

  it('renames through the per-session binding, rejecting an unknown id or a host failure', async () => {
    const rename = vi.fn(async (_title: string) => ({ ok: true as const }))
    const bind = vi.fn((id: string) => (id === 's1' ? { session: { rename } } : undefined))
    const { face } = await pagesFace({ sessions: { open: vi.fn(), binding: bind } })
    await face.renameSession('s1' as never, 'New title')
    expect(rename).toHaveBeenCalledWith('New title')
    await expect(face.renameSession('missing' as never, 'x')).rejects.toThrow('unknown session "missing"')
    rename.mockResolvedValueOnce({ ok: false, error: { message: 'busy' } } as never)
    await expect(face.renameSession('s1' as never, 'y')).rejects.toThrow('busy')
  })

  it('routes the session lifecycle verbs to workspaces', async () => {
    const workspaces = {
      archiveSession: vi.fn(async () => {}),
      unarchiveSession: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
      restoreSession: vi.fn(async () => {}),
    }
    const { face } = await pagesFace({ sessions: { open: vi.fn() }, workspaces })
    await face.archiveSession('s1' as never)
    await face.unarchiveSession('s1' as never)
    await face.deleteSession('s1' as never)
    await face.restoreSession('s1' as never)
    expect(workspaces.archiveSession).toHaveBeenCalledWith('s1')
    expect(workspaces.unarchiveSession).toHaveBeenCalledWith('s1')
    expect(workspaces.deleteSession).toHaveBeenCalledWith('s1')
    expect(workspaces.restoreSession).toHaveBeenCalledWith('s1')
  })

  it('routes the collection verbs to workspaces', async () => {
    const workspaces = {
      createCollection: vi.fn(async () => {}),
      renameCollection: vi.fn(async () => {}),
      deleteCollection: vi.fn(async () => {}),
      addSessionToCollection: vi.fn(async () => {}),
      removeSessionFromCollection: vi.fn(async () => {}),
    }
    const { face } = await pagesFace({ sessions: { open: vi.fn() }, workspaces })
    await face.createCollection('周报')
    await face.renameCollection('c1' as never, '月报')
    await face.deleteCollection('c1' as never)
    await face.addSessionToCollection('c1' as never, 's1' as never)
    await face.removeSessionFromCollection('c1' as never, 's1' as never)
    expect(workspaces.createCollection).toHaveBeenCalledWith('周报')
    expect(workspaces.renameCollection).toHaveBeenCalledWith('c1', '月报')
    expect(workspaces.deleteCollection).toHaveBeenCalledWith('c1')
    expect(workspaces.addSessionToCollection).toHaveBeenCalledWith('c1', 's1')
    expect(workspaces.removeSessionFromCollection).toHaveBeenCalledWith('c1', 's1')
  })

  it('lists skills for the current session, falling back to undefined without one', async () => {
    const withNone = await pagesFace({
      sessions: { open: vi.fn(), list: { getSnapshot: () => ({ current: undefined }) } },
    })
    expect(await withNone.face.listSkills()).toBeUndefined()

    const connection = connectionOf({ skillsList: 'ok' })
    const { face } = await pagesFace({
      sessions: { open: vi.fn(), list: { getSnapshot: () => ({ current: 's1' }) } },
      connection,
    })
    expect(await face.listSkills()).toEqual([{ name: 'weekly-report' }])
    expect(connection.api.skills.list).toHaveBeenCalledWith({ sessionId: 's1' })
  })

  it('throws when the skill listing RPC fails', async () => {
    const { face } = await pagesFace({
      sessions: { open: vi.fn(), list: { getSnapshot: () => ({ current: 's1' }) } },
      connection: connectionOf({ skillsList: 'fail' }),
    })
    await expect(face.listSkills()).rejects.toThrow('skill listing failed')
  })

  it('lists, installs, and uninstalls suites, throwing on each RPC failure', async () => {
    const sessions = { open: vi.fn() }
    const okConn = connectionOf({})
    const ok = await pagesFace({ sessions, connection: okConn })
    expect(await ok.face.listSuites()).toEqual([{ id: 'office-essentials' }])
    expect(await ok.face.installSuite('office-essentials')).toEqual([{ id: 'office-essentials' }])
    expect(await ok.face.uninstallSuite('office-essentials')).toEqual([{ id: 'office-essentials' }])
    expect(okConn.api.skills.suiteInstall).toHaveBeenCalledWith({ suiteId: 'office-essentials' })
    expect(okConn.api.skills.suiteUninstall).toHaveBeenCalledWith({ suiteId: 'office-essentials' })

    const listFail = await pagesFace({ sessions, connection: connectionOf({ suiteList: 'fail' }) })
    await expect(listFail.face.listSuites()).rejects.toThrow('suite list failed')
    const installFail = await pagesFace({ sessions, connection: connectionOf({ suiteInstall: 'fail' }) })
    await expect(installFail.face.installSuite('x')).rejects.toThrow('suite install failed')
    const uninstallFail = await pagesFace({ sessions, connection: connectionOf({ suiteUninstall: 'fail' }) })
    await expect(uninstallFail.face.uninstallSuite('x')).rejects.toThrow('suite uninstall failed')
  })
})
