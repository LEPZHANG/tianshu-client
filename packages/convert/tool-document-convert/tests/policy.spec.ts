import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { ConvertStepSpec } from '@deepseek-ai/dsh-document-convert'
import * as ToolConvert from '@deepseek-ai/dsh-tool-document-convert'
import { documentFixture } from '../../document-convert/tests/fixtures.ts'

/**
 * Where a conversion may write. The tool decides this before dispatching, because the seam's providers
 * hand argv to `ctx.subprocess` and the converter writes with the harness process's own authority — no
 * filesystem backend stands between them and the destination.
 */

let root: string
let workspace: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-convert-policy-')))
  workspace = join(root, 'ws')
  outside = join(root, 'elsewhere')
  await mkdir(workspace)
  await mkdir(outside)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Mount the tool with the session's standing sandbox mode, or with no sandbox policy at all. */
async function mount(mode?: SandboxMode): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  if (mode !== undefined) await ctx.plugin(SandboxPolicy, { mode, workspaceRoot: workspace })
  await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
  ctx.documentConvert.registerProvider({
    id: 'test-converter',
    routes: [{ from: 'docx', to: 'pdf', fidelity: 'faithful', priority: 10 }],
    available: () => true,
    convert: async (step: ConvertStepSpec) => {
      await writeFile(step.outputPath, documentFixture(step.targetFormat))
      return []
    },
  })
  await ctx.plugin(ToolConvert)
  return ctx
}

let seq = 0
const testToolSignal = new AbortController().signal

/**
 * A calling agent whose session is the workspace. The empty event log matters: the sandbox policy folds
 * a session's `sandbox/mode` events over the deployment default, so a session without them resolves to
 * the mode this mount configured.
 */
function agent(): unknown {
  return { session: { id: 'policy-test-session', header: { cwd: workspace }, events: [] } }
}

function call(ctx: Context, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: `policy-${++seq}` as never,
    name: 'convert_document',
    arguments: args,
    agent: agent() as never,
  })
}

async function source(): Promise<string> {
  await writeFile(join(workspace, 'report.docx'), 'source')
  return 'report.docx'
}

describe('convert_document under workspace-write', () => {
  it('converts inside the workspace', async () => {
    const ctx = await mount('workspace-write')
    const result = await call(ctx, { path: await source(), to: 'pdf' })
    expect(result.isError).toBe(false)
    await ctx.fiber.dispose()
  })

  it('refuses an output outside the workspace', async () => {
    const ctx = await mount('workspace-write')
    const result = await call(ctx, {
      path: await source(),
      to: 'pdf',
      output_path: join(outside, 'escaped.pdf'),
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_SANDBOX_DENIED')
    await ctx.fiber.dispose()
  })

  it('refuses an output that climbs out of the workspace with a relative path', async () => {
    const ctx = await mount('workspace-write')
    const result = await call(ctx, { path: await source(), to: 'pdf', output_path: '../elsewhere/escaped.pdf' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_SANDBOX_DENIED')
    await ctx.fiber.dispose()
  })
})

describe('convert_document under read-only', () => {
  it('refuses any conversion, because every conversion writes a file', async () => {
    const ctx = await mount('read-only')
    const result = await call(ctx, { path: await source(), to: 'pdf' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_SANDBOX_DENIED')
    await ctx.fiber.dispose()
  })
})

describe('convert_document under danger-full-access', () => {
  it('writes outside the workspace, the mode having removed that limit', async () => {
    const ctx = await mount('danger-full-access')
    const result = await call(ctx, {
      path: await source(),
      to: 'pdf',
      output_path: join(outside, 'allowed.pdf'),
    })
    expect(result.isError).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('convert_document with no sandbox policy mounted', () => {
  it('places no root-based limit on the output, the composition confining nothing', async () => {
    const ctx = await mount()
    const result = await call(ctx, {
      path: await source(),
      to: 'pdf',
      output_path: join(outside, 'unconfined.pdf'),
    })
    expect(result.isError).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('convert_document without a calling agent', () => {
  it('confines an agentless call to the deployment\'s configured workspace root', async () => {
    const ctx = await mount('workspace-write')
    await source()
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: `policy-agentless-${++seq}` as never,
      name: 'convert_document',
      arguments: { path: join(workspace, 'report.docx'), to: 'pdf', output_path: join(outside, 'escaped.pdf') },
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_SANDBOX_DENIED')
    await ctx.fiber.dispose()
  })
})
