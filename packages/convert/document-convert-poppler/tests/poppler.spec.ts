import { mkdtemp, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import * as Poppler from '@deepseek-ai/dsh-document-convert-poppler'
import { PDFTOHTML_PROVIDER_ID, PDFTOTEXT_PROVIDER_ID, PopplerConvertProvider } from '@deepseek-ai/dsh-document-convert-poppler'
import { ScriptedSubprocess } from '../../document-convert/tests/scripted-subprocess.ts'

/**
 * The poppler providers with the subprocess seam scripted, so the argv, the empty-extraction refusal,
 * and the per-binary availability are all covered without poppler installed. The real binaries are
 * exercised by the LibreOffice package's `real-converters.spec.ts`, where a PDF to extract from exists.
 */

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-poppler-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** Mount the seam, the scripted subprocess backend, and the poppler plugin. */
async function mount(config: Poppler.Config = {}): Promise<{
  ctx: Context
  convert: DocumentConvertRuntime
  subprocess: ScriptedSubprocess
}> {
  const ctx = new Context()
  await ctx.plugin(ScriptedSubprocess)
  const subprocess = ctx.subprocess as ScriptedSubprocess
  await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
  await ctx.plugin(Poppler, config)
  return { ctx, convert: ctx.documentConvert, subprocess }
}

/** Extract a PDF fixture into `to`, returning the argv the provider built. */
async function extract(
  to: 'txt' | 'html',
  config: Poppler.Config = {},
): Promise<{ argv: readonly string[]; providerId: string }> {
  const { convert, subprocess } = await mount(config)
  const sourcePath = join(workspace, 'scan.pdf')
  await writeFile(sourcePath, 'source')
  const spec = convert.resolve({ sourcePath, targetFormat: to })
  await convert.run(spec)
  return { argv: subprocess.spawns[0]?.argv ?? [], providerId: spec.plan.steps[0]?.providerId ?? '' }
}

describe('poppler routes', () => {
  it('extracts pdf to text through pdftotext, preserving the page layout', async () => {
    const { argv, providerId } = await extract('txt')
    expect(providerId).toBe(PDFTOTEXT_PROVIDER_ID)
    expect(argv[0]).toBe('/usr/bin/pdftotext')
    expect(argv).toContain('-layout')
  })

  it('extracts pdf to html through pdftohtml as one image-free document', async () => {
    const { argv, providerId } = await extract('html')
    expect(providerId).toBe(PDFTOHTML_PROVIDER_ID)
    expect(argv[0]).toBe('/usr/bin/pdftohtml')
    expect(argv).toEqual(expect.arrayContaining(['-s', '-i', '-noframes']))
  })

  it('passes the source then the output as the final two arguments', async () => {
    const { argv } = await extract('txt')
    expect(argv.slice(-2)).toEqual([join(workspace, 'scan.pdf'), join(workspace, 'scan.txt')])
  })

  it('runs the configured binaries', async () => {
    const { argv } = await extract('txt', { pdftotextBinary: 'my-pdftotext' })
    expect(argv[0]).toBe('/usr/bin/my-pdftotext')
  })

  it('declares both extractions lossy, since a pdf keeps its layout and the text does not', async () => {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    expect(convert.resolve({ sourcePath, targetFormat: 'txt' }).plan.fidelity).toBe('lossy')
    expect(convert.resolve({ sourcePath, targetFormat: 'html' }).plan.fidelity).toBe('lossy')
  })
})

describe('poppler empty extractions', () => {
  /** A `pdffonts` listing: its header, then one row per font. */
  const FONT_HEADER = 'name                                 type              encoding         emb sub uni object ID\n'
    + '------------------------------------ ----------------- ---------------- --- --- --- ---------\n'

  /** Run `pdf -> txt` with the extraction producing nothing and `pdffonts` answering as scripted. */
  async function extractNothing(pdffonts: { stdout?: string; exitCode?: number } = {}): Promise<unknown> {
    const { convert, subprocess } = await mount()
    subprocess.script = { contents: '' }
    subprocess.scriptByCommand.pdffonts = { produce: false, ...pdffonts }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    return convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' }))
  }

  it('reports a PDF that embeds no fonts as a scan, which is a source problem and not a failure to fix here', async () => {
    await expect(extractNothing({ stdout: FONT_HEADER }))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_SOURCE_SCANNED' }))
  })

  it('tells the caller what to do about a scan rather than only that nothing came out', async () => {
    await expect(extractNothing({ stdout: FONT_HEADER })).rejects.toThrow(/read by OCR/)
  })

  it('reports a PDF that does embed fonts as an extraction failure, which needs a different remedy', async () => {
    const listing = `${FONT_HEADER}ABCDEF+Helvetica                     Type 1C           Custom           yes yes yes      7  0\n`
    await expect(extractNothing({ stdout: listing }))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_PROVIDER_FAILED' }))
    await expect(extractNothing({ stdout: listing })).rejects.toThrow(/protected against extraction/)
  })

  it('names both causes when pdffonts could not answer, rather than picking one', async () => {
    await expect(extractNothing({ exitCode: 1 })).rejects.toThrow(/either a scan.*or is protected/s)
  })

  it('names both causes when pdffonts is not installed at all', async () => {
    const { convert, subprocess } = await mount({ pdffontsBinary: 'pdffonts' })
    subprocess.script = { contents: '' }
    subprocess.resolvableExcept = ['pdffonts']
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' })))
      .rejects.toThrow(/either a scan/)
  })

  it('leaves no empty file where a caller would read one as an extraction', async () => {
    await expect(extractNothing({ stdout: FONT_HEADER })).rejects.toThrow()
    await expect(stat(join(workspace, 'scan.txt'))).rejects.toThrow()
  })

  it('treats an html extraction with no visible text as empty, the tag skeleton not being content', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { contents: '<html><body><a name="1"></a></body></html>' }
    subprocess.scriptByCommand.pdffonts = { produce: false, stdout: FONT_HEADER }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'html' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_SOURCE_SCANNED' }))
  })

  it('consults pdffonts only once an extraction has already come back empty', async () => {
    const { convert, subprocess } = await mount()
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' }))
    expect(subprocess.spawns).toHaveLength(1)
  })

  it('skips the check for a result too large to hold in memory, which extracted something by its size alone', async () => {
    const { convert, subprocess } = await mount()
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    // Sparse, so the bound is exercised without the test writing 4 MiB; the extraction is scripted to
    // leave this file where it found it.
    await writeFile(join(workspace, 'scan.txt'), 'extracted\n')
    await truncate(join(workspace, 'scan.txt'), 4 * 1024 * 1024 + 1)
    subprocess.script = { produce: false }
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' }))).resolves.toBeDefined()
    expect(subprocess.spawns).toHaveLength(1)
  })
})

describe('poppler caveats', () => {
  it('says a PDF extraction recovers page text without the document structure', async () => {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    const outcome = await convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' }))
    expect(outcome.notes.map(note => note.code)).toEqual(['PDF_TEXT_EXTRACTED'])
    expect(outcome.notes[0]?.message).toMatch(/reading order/)
  })
})

describe('poppler failure handling', () => {
  it('refuses an extraction that produced no file at all, through the seam\'s own backstop', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { produce: false }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_OUTPUT_MISSING' }))
  })

  it('fails on a non-zero exit code and reports the diagnostic output', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { exitCode: 3, produce: false, stderr: 'Syntax Error: Couldn\'t read xref table' }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' })))
      .rejects.toThrow(/exit code 3.*xref table/s)
  })

  it('names the signal when the run was killed', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { signal: 'SIGTERM', produce: false }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' })))
      .rejects.toThrow(/signal SIGTERM/)
  })

  it('reports cancellation rather than a process failure when the caller aborted', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { exitCode: 1, produce: false }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' }), AbortSignal.abort()))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CANCELLED' }))
  })

  it('reports cancellation when the caller aborts while the extraction is running', async () => {
    const { ctx, convert, subprocess } = await mount()
    const controller = new AbortController()
    subprocess.script = { produce: false }
    subprocess.onSpawn = () => { controller.abort() }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    const spec = convert.resolve({ sourcePath, targetFormat: 'txt' })
    // The seam checks the signal before each step, so reaching the provider's own check needs a signal
    // that is still live at dispatch and fires once the process is under way.
    await expect(ctx.documentConvert.run(spec, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CANCELLED' }))
  })

  it('still reports the failure when the backend supplied no collected readers', async () => {
    const { convert, subprocess } = await mount()
    subprocess.omitReaders = true
    subprocess.script = { exitCode: 2, produce: false }
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' })))
      .rejects.toThrow(/exit code 2/)
  })

  it('plans around a provider whose binary was never resolved', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    ;(ctx.subprocess as ScriptedSubprocess).resolvable = false
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await ctx.plugin(Poppler)
    expect(() => ctx.documentConvert.resolve({ sourcePath: '/w/a.pdf', targetFormat: 'txt' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })

  it('refuses a direct convert call on a provider whose binary was never resolved', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    ;(ctx.subprocess as ScriptedSubprocess).resolvable = false
    const provider = new PopplerConvertProvider(ctx, {
      id: PDFTOTEXT_PROVIDER_ID,
      binary: 'pdftotext',
      route: { from: 'pdf', to: 'txt', fidelity: 'lossy', priority: 20 },
      flags: ['-layout'],
      caveat: { code: 'PDF_TEXT_EXTRACTED', message: 'page text only' },
    }, { graceMs: 1000, fontsBinary: 'pdffonts' })
    await provider.probe()
    await expect(provider.convert({
      sourcePath: '/w/a.pdf', sourceFormat: 'pdf', outputPath: '/w/a.txt', targetFormat: 'txt',
    })).rejects.toThrow(expect.objectContaining({ code: 'CONVERT_PROVIDER_UNAVAILABLE' }))
  })
})

describe('document-convert-poppler config', () => {
  it('outranks LibreOffice by default, so pdf to html reaches text extraction', async () => {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'scan.pdf')
    await writeFile(sourcePath, 'source')
    const step = convert.resolve({ sourcePath, targetFormat: 'html' }).plan.steps[0]
    expect(step?.providerId).toBe(PDFTOHTML_PROVIDER_ID)
  })

  it('refuses an empty binary name', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await expect(ctx.plugin(Poppler, { pdftotextBinary: '  ' })).rejects.toThrow(/non-empty command name/)
  })

  it('refuses a non-integer priority', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await expect(ctx.plugin(Poppler, { priority: 1.5 })).rejects.toThrow(/priority must be an integer/)
  })

  it('refuses a grace period outside the timer range', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await expect(ctx.plugin(Poppler, { graceMs: 0 })).rejects.toThrow(/graceMs/)
    await expect(ctx.plugin(Poppler, { graceMs: 2_147_483_648 })).rejects.toThrow(/graceMs/)
  })
})

/** Loader export-shape guard: a namespace plugin with `inject` must survive `unwrapExports` (postmortem 0001). */
describe('dsh-document-convert-poppler Loader export shape', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in Poppler).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(Poppler) as Record<string, unknown>
    expect(unwrapped).toBe(Poppler)
    expect(unwrapped.name).toBe('document-convert-poppler')
    expect(unwrapped.inject).toEqual(['documentConvert', 'subprocess'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
