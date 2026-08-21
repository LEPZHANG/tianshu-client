/** Brand plugin registration: slot occupancy, the token layer, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-tianshu-brand/client'
import type { TianshuSidebarInjected } from '@deepseek-ai/dsh-client-ui-tianshu-brand/client'
import { BRAND_TOKEN_SOURCE } from '../src/client/brand-tokens.ts'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn() }
  const workspaces = { startSession: vi.fn() }
  const sessions = { open: vi.fn(), clear: vi.fn() }
  const disposeOverride = vi.fn()
  // Typed to the real signature: the assertions below read the call's
  // arguments, which an untyped vi.fn() would surface as `any`.
  const theme = {
    overrideTokens: vi.fn(
      (_source: string, _tokens: Record<string, { light: string; dark: string }>) => disposeOverride,
    ),
  }
  ctx.provide('layout', layout)
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('theme', theme as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
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
  return { ctx, slots, layout, workspaces, sessions, theme, disposeOverride }
}

describe('ui-tianshu-brand apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'theme', 'sessions', 'workspaces', 'locale'])
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
})
