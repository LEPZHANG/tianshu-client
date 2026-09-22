import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { ConvertNote, ConvertStepSpec, DocumentConvertProvider } from '@deepseek-ai/dsh-document-convert'
import * as ToolConvert from '@deepseek-ai/dsh-tool-document-convert'
import { documentFixture } from '../../document-convert/tests/fixtures.ts'

/**
 * The tool over a real registry, a real filesystem backend, and the real seam. The converter itself is a
 * registered test provider: what these tests own is the tool's own work — path resolution against the
 * session workspace, the source and overwrite guards, the canonical value, and the rendered text — and a
 * real LibreOffice would make none of that clearer while making every case slower and machine-dependent.
 *
 * `document-convert-libreoffice/tests/real-converters.spec.ts` covers the converters for real.
 */

let root: string
let workspace: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tool-convert-')))
  workspace = join(root, 'ws')
  await mkdir(workspace)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * A provider that writes a real file of whatever format the step names, since the seam checks every
 * result against its target format, and reports the notes it was built with.
 */
function testProvider(
  notes: readonly ConvertNote[] = [],
  overrides: Partial<DocumentConvertProvider> = {},
): DocumentConvertProvider {
  return {
    id: 'test-converter',
    routes: [
      { from: 'docx', to: 'pdf', fidelity: 'faithful', priority: 10 },
      { from: 'docx', to: 'txt', fidelity: 'lossy', priority: 10 },
      { from: 'txt', to: 'docx', fidelity: 'faithful', priority: 10 },
      { from: 'pdf', to: 'txt', fidelity: 'lossy', priority: 10 },
    ],
    available: () => true,
    convert: async (step: ConvertStepSpec) => {
      await writeFile(step.outputPath, documentFixture(step.targetFormat))
      return notes
    },
    ...overrides,
  }
}

/** Mount the tool over the real registry, filesystem, and seam, plus a registered test converter. */
async function mount(options: {
  provider?: DocumentConvertProvider
  config?: ToolConvert.Config
} = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
  ctx.documentConvert.registerProvider(options.provider ?? testProvider())
  await ctx.plugin(ToolConvert, options.config ?? {})
  return ctx
}

let seq = 0
const testToolSignal = new AbortController().signal

/** Invoke `convert_document` the way the loop does, as an agent whose session workspace is `workspace`. */
function call(ctx: Context, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: `convert-${++seq}` as never,
    name: 'convert_document',
    arguments: args,
    agent: { session: { header: { cwd: workspace } } } as never,
  })
}

/** The text the model sees for a call. */
function text(result: ToolExecutionResult): string {
  const [block] = result.content
  return block !== undefined && block.type === 'text' ? block.text : ''
}

async function writeSource(name: string, contents = 'source'): Promise<string> {
  await writeFile(join(workspace, name), contents)
  return name
}

describe('convert_document execution', () => {
  it('converts a workspace-relative path and writes beside the source', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'pdf' })
    expect(result.isError).toBe(false)
    expect(await readFile(join(workspace, 'report.pdf'))).toEqual(documentFixture('pdf'))
    await ctx.fiber.dispose()
  })

  it('returns a canonical value a program can read without parsing prose', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'pdf' })
    expect(result.value).toEqual({
      path: join(workspace, 'report.pdf'),
      from: 'docx',
      to: 'pdf',
      fidelity: 'faithful',
      steps: [{ from: 'docx', to: 'pdf', provider: 'test-converter' }],
      bytes: documentFixture('pdf').length,
      notes: [],
    })
    await ctx.fiber.dispose()
  })

  it('writes to an explicit output_path', async () => {
    const ctx = await mount()
    await mkdir(join(workspace, 'out'))
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'pdf', output_path: 'out/final.pdf' })
    expect(result.isError).toBe(false)
    expect(await readFile(join(workspace, 'out/final.pdf'))).toEqual(documentFixture('pdf'))
    await ctx.fiber.dispose()
  })

  it('chains a multi-step plan and reports every step it took', async () => {
    const ctx = await mount()
    await writeSource('scan.pdf')
    const result = await call(ctx, { path: 'scan.pdf', to: 'docx' })
    expect(result.isError).toBe(false)
    expect((result.value as { steps: unknown[] }).steps).toEqual([
      { from: 'pdf', to: 'txt', provider: 'test-converter' },
      { from: 'txt', to: 'docx', provider: 'test-converter' },
    ])
    await ctx.fiber.dispose()
  })
})

describe('convert_document refusals', () => {
  it('refuses a source that does not exist', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: 'absent.docx', to: 'pdf' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_SOURCE_MISSING')
    await ctx.fiber.dispose()
  })

  it('refuses a source that is a directory', async () => {
    const ctx = await mount()
    await mkdir(join(workspace, 'folder.docx'))
    const result = await call(ctx, { path: 'folder.docx', to: 'pdf' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_SOURCE_NOT_FILE')
    await ctx.fiber.dispose()
  })

  it('refuses to replace an existing output unless asked', async () => {
    const ctx = await mount()
    await writeSource('report.docx')
    await writeFile(join(workspace, 'report.pdf'), 'existing')
    const result = await call(ctx, { path: 'report.docx', to: 'pdf' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_OUTPUT_EXISTS')
    expect(await readFile(join(workspace, 'report.pdf'), 'utf8')).toBe('existing')
    await ctx.fiber.dispose()
  })

  it('replaces an existing output when overwrite is set', async () => {
    const ctx = await mount()
    await writeSource('report.docx')
    await writeFile(join(workspace, 'report.pdf'), 'existing')
    const result = await call(ctx, { path: 'report.docx', to: 'pdf', overwrite: true })
    expect(result.isError).toBe(false)
    expect(await readFile(join(workspace, 'report.pdf'))).toEqual(documentFixture('pdf'))
    await ctx.fiber.dispose()
  })

  it('refuses a conversion no provider chain serves, naming the pair', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'odp' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('CONVERT_ROUTE_UNSUPPORTED')
    expect(text(result)).toMatch(/docx into odp/)
    await ctx.fiber.dispose()
  })

  it('refuses a blank path', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: '   ', to: 'pdf' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/non-empty file path/)
    await ctx.fiber.dispose()
  })

  it('refuses a blank output_path', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'pdf', output_path: ' ' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/non-empty file path/)
    await ctx.fiber.dispose()
  })

  it('refuses a target format outside the declared vocabulary before executing', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'zip' })
    expect(result.isError).toBe(true)
    await ctx.fiber.dispose()
  })
})

describe('convert_document model-facing text', () => {
  it('states the file, its size, and the route for a faithful conversion', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'pdf' })
    expect(text(result)).toBe(
      `Converted docx to pdf: ${join(workspace, 'report.pdf')} `
      + `(${documentFixture('pdf').length} bytes, via test-converter)`)
    await ctx.fiber.dispose()
  })

  it('warns that a lossy route kept only the text', async () => {
    const ctx = await mount()
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'txt' })
    expect(text(result)).toMatch(/This route is lossy: the text carried over but layout, styling, and structure did not\./)
    await ctx.fiber.dispose()
  })

  it('names the intermediate format a multi-step route passed through', async () => {
    const ctx = await mount()
    await writeSource('scan.pdf')
    const result = await call(ctx, { path: 'scan.pdf', to: 'docx' })
    expect(text(result)).toMatch(/passed through txt\./)
    await ctx.fiber.dispose()
  })

  it('tells the model what the conversion left behind, in place of the generic lossy warning', async () => {
    const ctx = await mount({
      provider: testProvider([{ code: 'TEXT_ONLY', message: 'Tables became lines of text.' }]),
    })
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'txt' })
    expect(text(result)).toMatch(/What this conversion did not carry over:\n- Tables became lines of text\./)
    expect(text(result)).not.toMatch(/This route is lossy/)
    await ctx.fiber.dispose()
  })

  it('reports the notes as data as well as prose, for a caller that reads the value', async () => {
    const note = { code: 'TEXT_ONLY', message: 'Tables became lines of text.' }
    const ctx = await mount({ provider: testProvider([note]) })
    const result = await call(ctx, { path: await writeSource('report.docx'), to: 'txt' })
    expect((result.value as { notes: unknown }).notes).toEqual([note])
    await ctx.fiber.dispose()
  })
})

describe('convert_document presentation through the registered definition', () => {
  it('threads the pending card onto the definition', async () => {
    const ctx = await mount()
    const definition = ToolConvert.convertDocumentTool(ctx, 1000)
    expect(definition.presentCall?.({ path: 'a/report.docx', to: 'pdf' })).toEqual({
      card: 'generic',
      title: 'Convert report.docx to pdf',
      kind: 'edit',
      rawInput: 'a/report.docx',
      locations: [{ path: 'a/report.pdf' }],
    })
    await ctx.fiber.dispose()
  })

  it('threads the completed card onto the definition', async () => {
    const ctx = await mount()
    const definition = ToolConvert.convertDocumentTool(ctx, 1000)
    const view = definition.presentResult?.({ path: 'report.docx', to: 'pdf' }, {
      isError: false,
      content: [],
      meta: { path: '/ws/report.pdf', fidelity: 'lossy' },
    })
    expect(view).toEqual({ card: 'generic', title: 'report.pdf (lossy)' })
    await ctx.fiber.dispose()
  })
})

describe('convert_document without a calling agent', () => {
  it('resolves against the filesystem backend\'s own directory', async () => {
    const ctx = await mount()
    await writeSource('report.docx')
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: `convert-agentless-${++seq}` as never,
      name: 'convert_document',
      arguments: { path: 'report.docx', to: 'pdf' },
    })
    expect(result.isError).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('convert_document tool schema', () => {
  it('advertises every format the seam names, so the model cannot ask for one that cannot exist', async () => {
    const ctx = await mount()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'convert_document')
    const properties = (schema?.parameters as { properties: Record<string, { enum?: string[] }> }).properties
    expect(properties.to?.enum).toEqual([
      'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp',
    ])
    await ctx.fiber.dispose()
  })

  it('unregisters the tool and its prompt section when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
    ctx.documentConvert.registerProvider(testProvider())
    const fork = await ctx.plugin(ToolConvert)
    expect(ctx.tools.schemas().some(entry => entry.name === 'convert_document')).toBe(true)
    await fork.dispose()
    expect(ctx.tools.schemas().some(entry => entry.name === 'convert_document')).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('tool-document-convert config', () => {
  it('refuses a tool budget outside the timer range', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
    await expect(ctx.plugin(ToolConvert, { timeoutMs: 0 })).rejects.toThrow(/timeoutMs/)
    await expect(ctx.plugin(ToolConvert, { timeoutMs: 2_147_483_648 })).rejects.toThrow(/timeoutMs/)
    await ctx.fiber.dispose()
  })
})

/** Loader export-shape guard: a namespace plugin with `inject` must survive `unwrapExports` (postmortem 0001). */
describe('dsh-tool-document-convert Loader export shape', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in ToolConvert).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ToolConvert) as Record<string, unknown>
    expect(unwrapped).toBe(ToolConvert)
    expect(unwrapped.name).toBe('tool-document-convert')
    expect(unwrapped.inject).toEqual(['tools', 'systemPrompt', 'documentConvert', 'fs'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
