import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { ConvertRoute, ConvertStepSpec, DocumentConvertProvider } from '@deepseek-ai/dsh-document-convert'
import * as Pandoc from '@deepseek-ai/dsh-document-convert-pandoc'
import { PANDOC_CONVERSIONS, PANDOC_PROVIDER_ID, PandocConvertProvider } from '@deepseek-ai/dsh-document-convert-pandoc'
import { documentFixture } from '../../document-convert/tests/fixtures.ts'
import type { ScriptedRun } from '../../document-convert/tests/scripted-subprocess.ts'
import { ScriptedSubprocess, pandocOutputPath } from '../../document-convert/tests/scripted-subprocess.ts'

/**
 * pandoc with the subprocess seam scripted, so the probe, the argv, the declared routes, and the notes
 * are all covered without pandoc installed. The real binary is exercised by the LibreOffice package's
 * `real-converters.spec.ts`, which owns the skip-guarded suite for every installed converter.
 */

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-pandoc-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** What a pandoc that can do everything this package knows about answers when asked. */
const CAPABLE: Readonly<Record<string, ScriptedRun>> = {
  '--version': { produce: false, stdout: 'pandoc 3.1.11.1\nFeatures: +server +lua\n' },
  '--list-input-formats': { produce: false, stdout: 'docx\nhtml\nmarkdown\nodt\nrtf\n' },
  '--list-output-formats': { produce: false, stdout: 'docx\nhtml\nodt\nplain\npptx\nrtf\n' },
}

/** Mount the seam, the scripted subprocess backend, and the pandoc plugin. */
async function mount(options: {
  config?: Pandoc.Config
  answers?: Readonly<Record<string, ScriptedRun>>
} = {}): Promise<{ ctx: Context; convert: DocumentConvertRuntime; subprocess: ScriptedSubprocess }> {
  const ctx = new Context()
  await ctx.plugin(ScriptedSubprocess)
  const subprocess = ctx.subprocess as ScriptedSubprocess
  subprocess.outputPathOf = pandocOutputPath
  const answers = { ...CAPABLE, ...options.answers }
  subprocess.scriptOf = spec => answers[spec.argv[1] as string]
  await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
  await ctx.plugin(Pandoc, options.config ?? {})
  return { ctx, convert: ctx.documentConvert, subprocess }
}

/** Convert a fixture of `from` into `to`, returning the argv the provider built and what came back. */
async function convertFixture(
  from: 'docx' | 'odt' | 'rtf' | 'html',
  to: 'docx' | 'odt' | 'rtf' | 'html' | 'txt',
  options: { config?: Pandoc.Config } = {},
): Promise<{ argv: readonly string[]; notes: readonly { code: string; message: string }[]; outputPath: string }> {
  const { convert, subprocess } = await mount(options)
  const sourcePath = join(workspace, `report.${from}`)
  await writeFile(sourcePath, documentFixture(from))
  const spec = convert.resolve({ sourcePath, targetFormat: to })
  const outcome = await convert.run(spec)
  const conversion = subprocess.spawns[subprocess.spawns.length - 1]
  return { argv: conversion?.argv ?? [], notes: outcome.notes, outputPath: spec.outputPath }
}

/** A stand-in for a converter that round-trips the file formats themselves, as LibreOffice does. */
function fileFormatProvider(routes: readonly ConvertRoute[]): DocumentConvertProvider {
  return {
    id: 'file-format-converter',
    routes,
    available: () => true,
    convert: async (step: ConvertStepSpec) => {
      await writeFile(step.outputPath, documentFixture(step.targetFormat))
      return []
    },
  }
}

describe('pandoc conversions', () => {
  it('offers every readable format to every writable one except itself', () => {
    expect(PANDOC_CONVERSIONS).toHaveLength(16)
    expect(PANDOC_CONVERSIONS.filter(conversion => conversion.from === conversion.to)).toEqual([])
  })

  it('converts through the reader and writer names pandoc knows the formats by, not the seam\'s', async () => {
    const { argv } = await convertFixture('docx', 'txt')
    expect(argv.slice(1, 5)).toEqual(['--from', 'docx', '--to', 'plain'])
  })

  it('asks for a whole document, since a fragment carries no preamble a later reader could use', async () => {
    const { argv } = await convertFixture('html', 'rtf')
    expect(argv).toContain('--standalone')
  })

  it('embeds images into an html result, a provider having to write exactly one file', async () => {
    const { argv } = await convertFixture('docx', 'html')
    expect(argv).toContain('--embed-resources')
  })

  it('leaves that flag off a target that carries its own images', async () => {
    const { argv } = await convertFixture('html', 'docx')
    expect(argv).not.toContain('--embed-resources')
  })

  it('resolves a source\'s relative images against the source\'s own directory', async () => {
    const { argv } = await convertFixture('html', 'docx')
    expect(argv[argv.indexOf('--resource-path') + 1]).toBe(workspace)
  })

  it('names the output path explicitly and passes the source last', async () => {
    const { argv, outputPath } = await convertFixture('docx', 'html')
    expect(argv[argv.indexOf('--output') + 1]).toBe(outputPath)
    expect(argv[argv.length - 1]).toBe(join(workspace, 'report.docx'))
  })

  it('writes a file of the target format, which the seam then accepts', async () => {
    const { outputPath } = await convertFixture('docx', 'html')
    expect(await readFile(outputPath)).toEqual(documentFixture('html'))
  })

  it('runs the configured binary', async () => {
    const { argv } = await convertFixture('docx', 'html', { config: { binary: 'my-pandoc' } })
    expect(argv[0]).toBe('/usr/bin/my-pandoc')
  })
})

describe('pandoc ranking against a file-format converter', () => {
  /** Mount pandoc alongside a stand-in declaring the same edges faithfully at LibreOffice's rank. */
  async function rivalled(): Promise<DocumentConvertRuntime> {
    const { convert } = await mount()
    convert.registerProvider(fileFormatProvider([
      { from: 'docx', to: 'html', fidelity: 'faithful', priority: 10 },
      { from: 'docx', to: 'odt', fidelity: 'faithful', priority: 10 },
      { from: 'docx', to: 'txt', fidelity: 'lossy', priority: 10 },
    ]))
    return convert
  }

  /** The provider the seam would use for one edge out of `report.docx`. */
  function chosenFor(convert: DocumentConvertRuntime, to: 'html' | 'odt' | 'txt'): string | undefined {
    return convert.resolve({ sourcePath: join(workspace, 'report.docx'), targetFormat: to }).plan.steps[0]?.providerId
  }

  it('takes the html edge, which is what converting through a document model is for', async () => {
    expect(chosenFor(await rivalled(), 'html')).toBe(PANDOC_PROVIDER_ID)
  })

  it('takes the plain-text edge, where a rival that only re-encodes has nothing better to offer', async () => {
    expect(chosenFor(await rivalled(), 'txt')).toBe(PANDOC_PROVIDER_ID)
  })

  it('leaves an office-to-office edge to the converter that round-trips those formats, despite ranking below it', async () => {
    expect(chosenFor(await rivalled(), 'odt')).toBe('file-format-converter')
  })
})

describe('pandoc notes', () => {
  /** The note codes one conversion reports. */
  async function codes(from: 'docx' | 'html', to: 'docx' | 'odt' | 'html' | 'txt'): Promise<readonly string[]> {
    const { notes } = await convertFixture(from, to)
    return notes.map(note => note.code)
  }

  it('says an html result reflows instead of paginating, so page setup had no equivalent', async () => {
    expect(await codes('docx', 'html')).toEqual(['HTML_REFLOWS'])
  })

  it('says a plain-text result kept the words and nothing else', async () => {
    expect(await codes('docx', 'txt')).toEqual(['PLAIN_TEXT_ONLY'])
  })

  it('says a document laid out from html used default page setup, the source having declared none', async () => {
    expect(await codes('html', 'docx')).toEqual(['PAGE_SETUP_DEFAULTED'])
  })

  it('says an office target was rebuilt from structure rather than re-encoded', async () => {
    expect(await codes('docx', 'odt')).toEqual(['DOCUMENT_MODEL_REBUILD'])
  })

  it('names what was dropped concretely enough to relay, not only that something was', async () => {
    const { notes } = await convertFixture('docx', 'html')
    expect(notes[0]?.message).toMatch(/headers, and footers/)
  })
})

describe('pandoc probe', () => {
  /** Whether the seam can plan `docx -> html`, which only pandoc offers in these mounts. */
  async function offersHtml(answers: Readonly<Record<string, ScriptedRun>>): Promise<boolean> {
    const { convert } = await mount({ answers })
    try {
      convert.resolve({ sourcePath: join(workspace, 'report.docx'), targetFormat: 'html' })
      return true
    } catch {
      // The seam's own refusal for an edge no usable provider declares, which is what "registered
      // nothing" looks like from outside the provider.
      return false
    }
  }

  it('registers routes when the installed pandoc confirms it reads and writes them', async () => {
    expect(await offersHtml({})).toBe(true)
  })

  it('registers nothing on a machine without pandoc', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    ;(ctx.subprocess as ScriptedSubprocess).resolvable = false
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await ctx.plugin(Pandoc)
    expect(() => ctx.documentConvert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'html' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })

  it('registers nothing for a pandoc older than the flag an html target depends on', async () => {
    expect(await offersHtml({ '--version': { produce: false, stdout: 'pandoc 2.19.2\n' } })).toBe(false)
  })

  it('registers nothing when the version line is not one pandoc wrote', async () => {
    expect(await offersHtml({ '--version': { produce: false, stdout: 'command not found\n' } })).toBe(false)
  })

  it('registers nothing when pandoc cannot report its version', async () => {
    expect(await offersHtml({ '--version': { produce: false, exitCode: 1 } })).toBe(false)
  })

  it('registers nothing when pandoc cannot list what it reads', async () => {
    expect(await offersHtml({ '--list-input-formats': { produce: false, exitCode: 1 } })).toBe(false)
  })

  it('registers nothing when pandoc cannot list what it writes', async () => {
    expect(await offersHtml({ '--list-output-formats': { produce: false, exitCode: 1 } })).toBe(false)
  })

  it('registers nothing when the build shares no format with this package', async () => {
    expect(await offersHtml({
      '--list-input-formats': { produce: false, stdout: 'markdown\n' },
      '--list-output-formats': { produce: false, stdout: 'markdown\n' },
    })).toBe(false)
  })

  it('drops only the edges whose reader this build lacks, keeping the rest', async () => {
    const answers = { '--list-input-formats': { produce: false, stdout: 'docx\nhtml\nodt\n' } }
    const { convert } = await mount({ answers })
    expect(convert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'html' }).plan.steps)
      .toHaveLength(1)
    expect(() => convert.resolve({ sourcePath: join(workspace, 'a.rtf'), targetFormat: 'html' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })

  it('asks once, when the plugin applies, and never again per conversion', async () => {
    const { convert, subprocess } = await mount()
    expect(subprocess.spawns).toHaveLength(3)
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await convert.run(convert.resolve({ sourcePath, targetFormat: 'html' }))
    expect(subprocess.spawns).toHaveLength(4)
  })
})

describe('pandoc failure handling', () => {
  /** Run `docx -> html` with the conversion itself scripted to fail as described. */
  async function failing(script: ScriptedRun, signal?: AbortSignal): Promise<unknown> {
    const { convert, subprocess } = await mount()
    subprocess.script = script
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    return convert.run(convert.resolve({ sourcePath, targetFormat: 'html' }), signal)
  }

  it('fails on a non-zero exit code and reports the diagnostic output', async () => {
    await expect(failing({ exitCode: 64, produce: false, stderr: 'Unknown input format rtf' }))
      .rejects.toThrow(/exit code 64.*Unknown input format rtf/s)
  })

  it('names the signal when the run was killed', async () => {
    await expect(failing({ signal: 'SIGKILL', produce: false })).rejects.toThrow(/signal SIGKILL/)
  })

  it('reports cancellation rather than a process failure when the caller aborted', async () => {
    await expect(failing({ exitCode: 1, produce: false }, AbortSignal.abort()))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CANCELLED' }))
  })

  it('reports cancellation when the caller aborts while the conversion is running', async () => {
    const { convert, subprocess } = await mount()
    const controller = new AbortController()
    subprocess.script = { produce: false }
    // The seam checks the signal before each step, so reaching the provider's own check needs a signal
    // that is still live at dispatch and fires once the process is under way.
    subprocess.onSpawn = () => { controller.abort() }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'html' }), controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CANCELLED' }))
  })

  it('still reports the failure when the backend supplied no collected readers', async () => {
    const { convert, subprocess } = await mount()
    subprocess.omitReaders = true
    subprocess.script = { exitCode: 2, produce: false }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'html' })))
      .rejects.toThrow(/exit code 2/)
  })

  it('refuses a direct convert call on a provider that was never probed', async () => {
    const { ctx } = await mount()
    const provider = new PandocConvertProvider(ctx, { binary: 'pandoc', priority: 20, graceMs: 1000 })
    await expect(provider.convert({
      sourcePath: '/w/a.docx', sourceFormat: 'docx', outputPath: '/w/a.html', targetFormat: 'html',
    })).rejects.toThrow(expect.objectContaining({ code: 'CONVERT_PROVIDER_UNAVAILABLE' }))
  })

  it('refuses a direct convert call for a pair it does not serve, naming both ends', async () => {
    const { ctx } = await mount()
    const provider = new PandocConvertProvider(ctx, { binary: 'pandoc', priority: 20, graceMs: 1000 })
    await provider.probe()
    // The seam only dispatches this provider's own declared edges, so this is reached by a direct caller.
    await expect(provider.convert({
      sourcePath: '/w/a.docx', sourceFormat: 'docx', outputPath: '/w/a.pdf', targetFormat: 'pdf',
    })).rejects.toThrow(/does not convert docx to pdf/)
  })
})

describe('document-convert-pandoc config', () => {
  /** Mount the seam and the scripted backend, then apply pandoc with a config expected to be refused. */
  async function applying(config: Pandoc.Config): Promise<unknown> {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    return ctx.plugin(Pandoc, config)
  }

  it('refuses an empty binary name', async () => {
    await expect(applying({ binary: '  ' })).rejects.toThrow(/non-empty command name/)
  })

  it('refuses a non-integer priority', async () => {
    await expect(applying({ priority: 1.5 })).rejects.toThrow(/priority must be an integer/)
  })

  it('refuses a grace period outside the timer range', async () => {
    await expect(applying({ graceMs: 0 })).rejects.toThrow(/graceMs/)
    await expect(applying({ graceMs: 2_147_483_648 })).rejects.toThrow(/graceMs/)
  })
})

describe('document-convert-pandoc disposal', () => {
  it('unregisters the provider when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    const subprocess = ctx.subprocess as ScriptedSubprocess
    subprocess.scriptOf = spec => CAPABLE[spec.argv[1] as string]
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    const fork = await ctx.plugin(Pandoc)
    expect(ctx.documentConvert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'html' }).plan.steps)
      .toHaveLength(1)
    await fork.dispose()
    expect(() => ctx.documentConvert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'html' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })
})

/** Loader export-shape guard: a namespace plugin with `inject` must survive `unwrapExports` (postmortem 0001). */
describe('dsh-document-convert-pandoc Loader export shape', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in Pandoc).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(Pandoc) as Record<string, unknown>
    expect(unwrapped).toBe(Pandoc)
    expect(unwrapped.name).toBe('document-convert-pandoc')
    expect(unwrapped.inject).toEqual(['documentConvert', 'subprocess'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
