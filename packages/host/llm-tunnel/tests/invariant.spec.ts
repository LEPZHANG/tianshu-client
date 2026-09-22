import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as LlmTunnelInvariant from '../src/invariant.ts'

describe('llm-tunnel invariant companion', () => {
  it('registers the package-owned installer and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(LlmTunnelInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(LlmTunnelInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
