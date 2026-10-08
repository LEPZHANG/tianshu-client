import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocumentConvertRuntime, {
  ConvertError,
  type ConvertNote,
  type ConvertRoute,
  type ConvertStepSpec,
  type DocumentConvertProvider,
  type DocumentFormat,
} from '@deepseek-ai/dsh-document-convert'
import { documentFixture } from './fixtures.ts'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-convert-runtime-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** Mount a runtime on a fresh root context. */
async function mount(
  config: ConstructorParameters<typeof DocumentConvertRuntime>[1] = {},
): Promise<{ ctx: Context; convert: DocumentConvertRuntime }> {
  const ctx = new Context()
  await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace, ...config })
  return { ctx, convert: ctx.documentConvert }
}

function route(from: DocumentFormat, to: DocumentFormat, priority = 10): ConvertRoute {
  return { from, to, fidelity: 'faithful', priority }
}

/** A provider that writes a real file of the target format for every step it is given. */
function writingProvider(
  id: string,
  routes: readonly ConvertRoute[],
  options: {
    available?: boolean
    onStep?: (step: ConvertStepSpec) => void
    write?: boolean
    contents?: string
    notes?: readonly ConvertNote[]
  } = {},
): DocumentConvertProvider {
  return {
    id,
    routes,
    available: () => options.available ?? true,
    async convert(step) {
      options.onStep?.(step)
      if (options.write === false) return []
      await writeFile(step.outputPath, options.contents ?? documentFixture(step.targetFormat))
      return options.notes ?? []
    },
  }
}

describe('DocumentConvertRuntime registration', () => {
  it('registers a provider and unregisters it through the returned disposer', async () => {
    const { convert } = await mount()
    const dispose = convert.registerProvider(writingProvider('one', [route('docx', 'pdf')]))
    expect(convert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'pdf' }).plan.steps).toHaveLength(1)
    dispose()
    expect(() => convert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'pdf' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })

  it('unregisters a provider when the registering fiber is disposed', async () => {
    const { ctx, convert } = await mount()
    // Registration must go through the registering fiber's own context: that is what binds the
    // effect's lifetime to that fiber, and it is how a real provider plugin reaches the seam.
    const fork = await ctx.plugin({
      inject: ['documentConvert'],
      apply: (inner: Context) => {
        inner.documentConvert.registerProvider(writingProvider('scoped', [route('docx', 'pdf')]))
      },
    })
    expect(convert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'pdf' }).plan.steps).toHaveLength(1)
    await fork.dispose()
    expect(() => convert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'pdf' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })

  it('refuses a second provider with an id already registered', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('one', [route('docx', 'pdf')]))
    expect(() => convert.registerProvider(writingProvider('one', [route('odt', 'pdf')])))
      .toThrow(expect.objectContaining({ code: 'CONVERT_DUPLICATE_PROVIDER' }))
  })
})

describe('DocumentConvertRuntime config', () => {
  it('refuses a step ceiling that is not a positive integer', async () => {
    await expect(mount({ maxSteps: 0 })).rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CONFIG_INVALID' }))
    await expect(mount({ maxSteps: 1.5 })).rejects.toThrow(ConvertError)
  })

  it('refuses a malformed route pin at load rather than on the first conversion', async () => {
    await expect(mount({ routes: { 'docx-pdf': 'lo' } }))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_KEY_INVALID' }))
  })

  it('applies a configured pin to planning', async () => {
    const { convert } = await mount({ routes: { 'docx->pdf': 'second' } })
    convert.registerProvider(writingProvider('first', [route('docx', 'pdf', 99)]))
    convert.registerProvider(writingProvider('second', [route('docx', 'pdf', 1)]))
    const spec = convert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'pdf' })
    expect(spec.plan.steps[0]?.providerId).toBe('second')
  })
})

describe('DocumentConvertRuntime.resolve', () => {
  it('reads the source format from the path and derives the output beside it', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')]))
    const spec = convert.resolve({ sourcePath: '/w/report.docx', targetFormat: 'pdf' })
    expect(spec).toMatchObject({
      sourcePath: '/w/report.docx',
      sourceFormat: 'docx',
      outputPath: '/w/report.pdf',
      targetFormat: 'pdf',
    })
  })

  it('honors an explicit source format over the path extension', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('txt', 'pdf')]))
    const spec = convert.resolve({ sourcePath: '/w/notes.log', targetFormat: 'pdf', sourceFormat: 'txt' })
    expect(spec.sourceFormat).toBe('txt')
  })

  it('honors an explicit output path', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')]))
    const spec = convert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'pdf', outputPath: '/out/b.pdf' })
    expect(spec.outputPath).toBe('/out/b.pdf')
  })

  it('refuses a source whose format is neither stated nor readable from its path', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')]))
    expect(() => convert.resolve({ sourcePath: '/w/report.zip', targetFormat: 'pdf' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_FORMAT_UNKNOWN' }))
  })
})

describe('DocumentConvertRuntime.run', () => {
  it('runs a single step into the resolved output path and reports its size', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')]))
    await writeFile(join(workspace, 'report.docx'), 'source')
    const spec = convert.resolve({ sourcePath: join(workspace, 'report.docx'), targetFormat: 'pdf' })
    const outcome = await convert.run(spec)
    expect(outcome).toMatchObject({
      outputPath: join(workspace, 'report.pdf'),
      sourceFormat: 'docx',
      targetFormat: 'pdf',
      fidelity: 'faithful',
    })
    expect(outcome.bytes).toBeGreaterThan(0)
    expect(outcome.steps).toHaveLength(1)
  })

  it('feeds each step the previous step\'s output and writes only the last one to the destination', async () => {
    const { convert } = await mount()
    const seen: ConvertStepSpec[] = []
    const record = (step: ConvertStepSpec): void => void seen.push(step)
    convert.registerProvider(writingProvider('extract', [{ from: 'pdf', to: 'txt', fidelity: 'lossy', priority: 20 }], { onStep: record }))
    convert.registerProvider(writingProvider('office', [route('txt', 'xlsx')], { onStep: record }))
    await writeFile(join(workspace, 'scan.pdf'), 'source')
    const spec = convert.resolve({ sourcePath: join(workspace, 'scan.pdf'), targetFormat: 'xlsx' })
    const outcome = await convert.run(spec)

    expect(seen).toHaveLength(2)
    expect(seen[0]?.sourcePath).toBe(join(workspace, 'scan.pdf'))
    expect(seen[0]?.outputPath).not.toBe(outcome.outputPath)
    expect(seen[1]?.sourcePath).toBe(seen[0]?.outputPath)
    expect(seen[1]?.outputPath).toBe(join(workspace, 'scan.xlsx'))
    expect(outcome.fidelity).toBe('lossy')
  })

  it('removes the scratch directory after a multi-step plan succeeds', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('extract', [{ from: 'pdf', to: 'txt', fidelity: 'lossy', priority: 20 }]))
    convert.registerProvider(writingProvider('office', [route('txt', 'xlsx')]))
    await writeFile(join(workspace, 'scan.pdf'), 'source')
    await convert.run(convert.resolve({ sourcePath: join(workspace, 'scan.pdf'), targetFormat: 'xlsx' }))
    expect(await readdir(workspace)).toEqual(expect.arrayContaining(['scan.pdf', 'scan.xlsx']))
    expect((await readdir(workspace)).filter(entry => entry.startsWith('dsh-convert-'))).toEqual([])
  })

  it('removes the scratch directory after a multi-step plan fails', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('extract', [{ from: 'pdf', to: 'txt', fidelity: 'lossy', priority: 20 }]))
    convert.registerProvider({
      id: 'office',
      routes: [route('txt', 'xlsx')],
      available: () => true,
      convert: () => Promise.reject(new ConvertError('boom', 'CONVERT_PROVIDER_FAILED')),
    })
    await writeFile(join(workspace, 'scan.pdf'), 'source')
    await expect(convert.run(convert.resolve({ sourcePath: join(workspace, 'scan.pdf'), targetFormat: 'xlsx' })))
      .rejects.toThrow(/boom/)
    expect((await readdir(workspace)).filter(entry => entry.startsWith('dsh-convert-'))).toEqual([])
  })

  it('refuses a step whose provider reported success without writing its file', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('silent', [route('docx', 'pdf')], { write: false }))
    await writeFile(join(workspace, 'a.docx'), 'source')
    await expect(convert.run(convert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'pdf' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_OUTPUT_MISSING' }))
  })

  it('refuses to start once the caller has cancelled', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')]))
    await writeFile(join(workspace, 'a.docx'), 'source')
    const spec = convert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'pdf' })
    await expect(convert.run(spec, AbortSignal.abort()))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CANCELLED' }))
  })

  it('refuses a plan whose provider was disposed between resolution and execution', async () => {
    const { convert } = await mount()
    const dispose = convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')]))
    await writeFile(join(workspace, 'a.docx'), 'source')
    const spec = convert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'pdf' })
    dispose()
    await expect(convert.run(spec))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_PROVIDER_UNAVAILABLE' }))
  })

  it('refuses a plan whose provider became unusable between resolution and execution', async () => {
    const { convert } = await mount()
    let usable = true
    convert.registerProvider({
      id: 'lo',
      routes: [route('docx', 'pdf')],
      available: () => usable,
      convert: async (step) => {
        await writeFile(step.outputPath, documentFixture(step.targetFormat))
        return []
      },
    })
    await writeFile(join(workspace, 'a.docx'), 'source')
    const spec = convert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'pdf' })
    usable = false
    await expect(convert.run(spec))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_PROVIDER_UNAVAILABLE' }))
  })
})

describe('DocumentConvertRuntime output verification', () => {
  const stem = 'a.docx'

  /** Run `docx -> pdf` through a provider that writes exactly the given bytes. */
  async function runWriting(contents: string, config: { maxVerifyBytes?: number } = {}): Promise<string> {
    const { convert } = await mount(config)
    convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')], { contents }))
    await writeFile(join(workspace, stem), 'source')
    await convert.run(convert.resolve({ sourcePath: join(workspace, stem), targetFormat: 'pdf' }))
    return join(workspace, 'a.pdf')
  }

  it('refuses a result that is not a document of the format the step promised', async () => {
    await expect(runWriting('this is not a PDF'))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_OUTPUT_UNUSABLE' }))
  })

  it('names what was wrong with the result rather than only that it was refused', async () => {
    await expect(runWriting('%PDF-1.4\nno trailer here'))
      .rejects.toThrow(/no trailer, so no pages were written/)
  })

  it('refuses an empty result, which is what a converter that read nothing writes', async () => {
    await expect(runWriting('')).rejects.toThrow(/the file is empty/)
  })

  it('deletes a refused result, so no file is left where a caller would read one as converted', async () => {
    await expect(runWriting('this is not a PDF')).rejects.toThrow(ConvertError)
    expect((await readdir(workspace))).not.toContain('a.pdf')
  })

  it('skips the check for a result too large to hold in memory, which is a document by its size alone', async () => {
    await expect(runWriting('this is not a PDF', { maxVerifyBytes: 4 })).resolves.toBeDefined()
  })
})

describe('DocumentConvertRuntime notes', () => {
  const textOnly: ConvertNote = { code: 'TEXT_ONLY', message: 'Plain text keeps the words only.' }
  const firstSheet: ConvertNote = { code: 'FIRST_SHEET', message: 'The first sheet only.' }

  it('reports what each step said the document lost', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('docx', 'txt')], { notes: [textOnly] }))
    await writeFile(join(workspace, 'a.docx'), 'source')
    const outcome = await convert.run(convert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'txt' }))
    expect(outcome.notes).toEqual([textOnly])
  })

  it('reports nothing when every step preserved the document', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('lo', [route('docx', 'pdf')]))
    await writeFile(join(workspace, 'a.docx'), 'source')
    const outcome = await convert.run(convert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'pdf' }))
    expect(outcome.notes).toEqual([])
  })

  it('states one loss once however many steps reported it', async () => {
    const { convert } = await mount()
    convert.registerProvider(writingProvider('extract', [route('pdf', 'txt', 20)], { notes: [textOnly, firstSheet] }))
    convert.registerProvider(writingProvider('office', [route('txt', 'xlsx')], { notes: [textOnly] }))
    await writeFile(join(workspace, 'scan.pdf'), 'source')
    const outcome = await convert.run(convert.resolve({ sourcePath: join(workspace, 'scan.pdf'), targetFormat: 'xlsx' }))
    expect(outcome.notes).toEqual([textOnly, firstSheet])
  })
})
