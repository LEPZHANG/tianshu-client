import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LlmTunnelService from '../src/index.ts'
import type { TunnelHostConfig } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** In-memory settings provider: the minimal concrete SettingsProvider. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/** One spawned "ssh" recorded by the fake subprocess seam. */
interface FakeChild {
  argv: readonly string[]
  terminated: boolean
  exit: (code: number | null, signal: NodeJS.Signals | null) => void
  stderrText: string
}

/** A subprocess seam that hands back controllable fake children. */
function fakeSubprocess() {
  const spawned: FakeChild[] = []
  const runtime: Plugin.Object = {
    name: 'fake-subprocess',
    apply(ctx) {
      ctx.provide('subprocess', {
        spawn(spec: { argv: readonly string[] }) {
          let settle: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
          const child: FakeChild = {
            argv: spec.argv,
            terminated: false,
            stderrText: 'ssh: connection refused',
            exit: (code, signal) => { settle({ exitCode: code, signal }) },
          }
          spawned.push(child)
          ctx.effect(() => () => { child.terminated = true })
          return {
            pid: 1000 + spawned.length,
            stdin: undefined,
            stdout: undefined,
            stderr: undefined,
            collected: {
              stderr: { readFrom: () => ({ text: child.stderrText, nextOffset: child.stderrText.length, lossy: false }) },
            },
            done: new Promise((resolve) => { settle = resolve }),
            terminate: () => { child.terminated = true },
            waitForExit: () => Promise.resolve(true),
          }
        },
      })
    },
  }
  return { spawned, runtime }
}

/** Assemble settings + fake subprocess + the tunnel service over one context. */
async function harness(hosts: Record<string, TunnelHostConfig>) {
  const fake = fakeSubprocess()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  await ctx.plugin(MemorySettings, {})
  await ctx.plugin(fake.runtime)
  await ctx.plugin(LlmTunnelService, { hosts })
  const service = ctx.get('llmTunnel') as LlmTunnelService
  return { ctx, service, spawned: fake.spawned }
}

const HOST: TunnelHostConfig = {
  host: 'gpu.example', sshPort: 22, user: 'ops',
  remoteHost: '127.0.0.1', remotePort: 8000, localPort: 18000,
}

describe('LlmTunnelService', () => {
  it('publishes snapshot, restart, and probe under the llmTunnel namespace', async () => {
    const { service } = await harness({})
    expect(service.typertRemote).toMatchObject({ serviceKey: 'llmTunnel', namespace: 'llmTunnel' })
    expect(remoteMethods(service).map(m => m.method).sort()).toEqual(['probe', 'restart', 'snapshot'])
  })

  it('spawns one ssh forward per configured host with the pinned flags', async () => {
    const { spawned } = await harness({ gpu: HOST })
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.argv).toEqual([
      'ssh', '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
      '-p', '22', '-L', '18000:127.0.0.1:8000', 'ops@gpu.example',
    ])
  })

  it('reports connecting, then failed with the ssh diagnostic when the child dies', async () => {
    const { service, spawned } = await harness({ gpu: HOST })
    expect(service.snapshot().tunnels[0]).toMatchObject({ phase: 'connecting' })
    spawned[0]!.exit(255, null)
    await vi.waitFor(() => {
      expect(service.snapshot().tunnels[0]).toMatchObject({ phase: 'failed', detail: 'ssh: connection refused' })
    })
  })

  it('keeps an unrelated host running when another is added', async () => {
    const { ctx, service, spawned } = await harness({ gpu: HOST })
    expect(spawned).toHaveLength(1)
    const first = spawned[0]!
    // A settings change that only adds a second host must not touch the
    // first host's child: it stays live, and no re-spawn happens for it.
    const provider = ctx.get('settings') as MemorySettings
    await provider.update('llm-tunnel' as never, { hosts: { gpu: HOST, second: { ...HOST, host: 'gpu2.example', localPort: 18001 } } })
    await vi.waitFor(() => { expect(spawned).toHaveLength(2) })
    expect(first.terminated).toBe(false)
    expect(spawned[1]!.argv).toContain('ops@gpu2.example')
    expect(service.snapshot().tunnels).toHaveLength(2)
  })

  it('answers probe failure honestly when the tunnel has failed', async () => {
    const { service, spawned } = await harness({ gpu: HOST })
    spawned[0]!.exit(255, null)
    await vi.waitFor(() => { expect(service.snapshot().tunnels[0]!.phase).toBe('failed') })
    const probe = await service.probe('gpu' as never)
    expect(probe.ok).toBe(false)
    expect(probe.detail).toBe('ssh: connection refused')
    expect(probe.models).toEqual([])
  })

  it('restart of an unknown host reports stopped rather than inventing a child', async () => {
    const { service } = await harness({})
    expect(service.restart('nope' as never)).toMatchObject({ phase: 'stopped' })
  })
})
