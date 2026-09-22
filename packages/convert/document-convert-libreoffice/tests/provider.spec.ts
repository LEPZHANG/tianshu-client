import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { ConvertStepSpec, DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import * as LibreOffice from '@deepseek-ai/dsh-document-convert-libreoffice'
import { LibreOfficeConvertProvider, LIBREOFFICE_CONVERSIONS } from '@deepseek-ai/dsh-document-convert-libreoffice'
import { documentFixture, storedZip, zeroCrcDocx } from '../../document-convert/tests/fixtures.ts'
import { ScriptedSubprocess, sofficeOutputPath } from '../../document-convert/tests/scripted-subprocess.ts'

/**
 * These tests substitute the subprocess seam rather than the provider: the provider's real argv
 * construction, filter selection, output discovery, and file move all run, while the scripted backend
 * stands in for LibreOffice itself. Pinning the argv matters because the `<ext>:<filter>` spelling and
 * the private `-env:UserInstallation` profile are the two things `soffice` silently misbehaves without.
 *
 * `real-converters.spec.ts` covers the same provider against a real installation.
 */

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-lo-provider-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** Mount the seam, the scripted subprocess backend, and the LibreOffice provider plugin. */
async function mount(config: LibreOffice.Config = {}): Promise<{
  ctx: Context
  convert: DocumentConvertRuntime
  subprocess: ScriptedSubprocess
}> {
  const ctx = new Context()
  await ctx.plugin(ScriptedSubprocess)
  const subprocess = ctx.subprocess as ScriptedSubprocess
  subprocess.outputPathOf = sofficeOutputPath
  await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
  await ctx.plugin(LibreOffice, Object.assign({ workDir: workspace }, config))
  return { ctx, convert: ctx.documentConvert, subprocess }
}

/** Convert a fixture of `from` into `to`, returning the spawn spec the provider built. */
async function convertFixture(
  from: DocumentFormat,
  to: Parameters<DocumentConvertRuntime['resolve']>[0]['targetFormat'],
  config: LibreOffice.Config = {},
): Promise<{ argv: readonly string[]; outputPath: string; subprocess: ScriptedSubprocess }> {
  const { convert, subprocess } = await mount(config)
  const sourcePath = join(workspace, `report.${from}`)
  await writeFile(sourcePath, documentFixture(from))
  const outcome = await convert.run(convert.resolve({ sourcePath, targetFormat: to }))
  return { argv: subprocess.spawns[0]?.argv ?? [], outputPath: outcome.outputPath, subprocess }
}

describe('LibreOffice route table', () => {
  it('declares every writer-family pair, both directions', () => {
    const writer = ['doc', 'docx', 'odt', 'rtf', 'txt', 'html']
    const missing = writer.flatMap(from =>
      writer.filter(to => to !== from && !LIBREOFFICE_CONVERSIONS.has(`${from}->${to}`)).map(to => `${from}->${to}`))
    expect(missing).toEqual([])
  })

  it('declares every family source to pdf', () => {
    const sources = ['doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']
    const missing = sources.filter(from => !LIBREOFFICE_CONVERSIONS.has(`${from}->pdf`))
    expect(missing).toEqual([])
  })

  it('declares no route into a format LibreOffice writes as another application\'s document', () => {
    // Verified by conversion: these produce a file of the wrong type, or an empty one.
    expect(LIBREOFFICE_CONVERSIONS.has('txt->pptx')).toBe(false)
    expect(LIBREOFFICE_CONVERSIONS.has('txt->odp')).toBe(false)
    expect(LIBREOFFICE_CONVERSIONS.has('odt->odp')).toBe(false)
    expect(LIBREOFFICE_CONVERSIONS.has('pdf->odt')).toBe(false)
  })

  it('declares html only from odp, because the export drops text imported from ppt and pptx', () => {
    expect(LIBREOFFICE_CONVERSIONS.has('odp->html')).toBe(true)
    expect(LIBREOFFICE_CONVERSIONS.has('ppt->html')).toBe(false)
    expect(LIBREOFFICE_CONVERSIONS.has('pptx->html')).toBe(false)
  })

  it('marks conversions into plain text lossy and conversions out of it faithful', () => {
    expect(LIBREOFFICE_CONVERSIONS.get('docx->txt')?.fidelity).toBe('lossy')
    expect(LIBREOFFICE_CONVERSIONS.get('txt->docx')?.fidelity).toBe('faithful')
    expect(LIBREOFFICE_CONVERSIONS.get('xlsx->txt')?.fidelity).toBe('lossy')
  })

  it('marks the text-to-spreadsheet bridge lossy, since it reinterprets the text as delimited data', () => {
    for (const key of ['txt->ods', 'txt->xlsx', 'txt->xls']) {
      expect(LIBREOFFICE_CONVERSIONS.get(key)?.fidelity).toBe('lossy')
      expect(LIBREOFFICE_CONVERSIONS.get(key)?.importFilter).toMatch(/StarCalc/)
    }
  })

  it('declares no import filter for an ordinary conversion', () => {
    expect(LIBREOFFICE_CONVERSIONS.get('docx->pdf')?.importFilter).toBeUndefined()
  })
})

describe('LibreOfficeConvertProvider argv', () => {
  it('names the export filter explicitly, which a bare extension fails to select', async () => {
    const { argv } = await convertFixture('docx', 'pdf')
    expect(argv[argv.indexOf('--convert-to') + 1]).toBe('pdf:writer_pdf_Export')
  })

  it('selects the filter by the source family, not by the target alone', async () => {
    const writer = await convertFixture('docx', 'html')
    const calc = await convertFixture('xlsx', 'html')
    expect(writer.argv[writer.argv.indexOf('--convert-to') + 1]).toBe('html:HTML (StarWriter)')
    expect(calc.argv[calc.argv.indexOf('--convert-to') + 1]).toBe('html:HTML (StarCalc)')
  })

  it('gives each conversion a private user profile, so concurrent runs do not collide', async () => {
    const { argv } = await convertFixture('docx', 'pdf')
    const profile = argv.find(argument => argument.startsWith('-env:UserInstallation='))
    expect(profile).toMatch(/^-env:UserInstallation=file:\/\/\//)
  })

  it('runs headless without session restore', async () => {
    const { argv } = await convertFixture('docx', 'pdf')
    expect(argv).toContain('--headless')
    expect(argv).toContain('--norestore')
  })

  it('passes the import filter only for the spreadsheet bridge', async () => {
    const bridged = await convertFixture('txt', 'xlsx')
    const ordinary = await convertFixture('docx', 'pdf')
    expect(bridged.argv.some(argument => argument.startsWith('--infilter='))).toBe(true)
    expect(ordinary.argv.some(argument => argument.startsWith('--infilter='))).toBe(false)
  })

  it('runs the configured binary', async () => {
    const { argv } = await convertFixture('docx', 'pdf', { binary: 'my-soffice' })
    expect(argv[0]).toBe('/usr/bin/my-soffice')
  })
})

describe('LibreOfficeConvertProvider output handling', () => {
  it('moves the produced file to the caller\'s path and leaves no scratch directory', async () => {
    const { outputPath } = await convertFixture('docx', 'pdf')
    expect(await readFile(outputPath)).toEqual(documentFixture('pdf'))
    expect((await readdir(workspace)).filter(entry => entry.startsWith('dsh-soffice-'))).toEqual([])
  })

  it('fails when the run reports success but produced no file', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { produce: false, stderr: 'Error: no export filter' }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' })))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_PROVIDER_FAILED' }))
  })

  it('reports the diagnostic output when the run produced no file', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { produce: false, stderr: 'Error: no export filter' }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' })))
      .rejects.toThrow(/no export filter/)
  })

  it('fails on a non-zero exit code', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { exitCode: 77, produce: false }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' })))
      .rejects.toThrow(/exit code 77/)
  })

  it('names the signal when the run was killed', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { signal: 'SIGKILL', produce: false }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' })))
      .rejects.toThrow(/signal SIGKILL/)
  })

  it('reports cancellation rather than a process failure when the caller aborted', async () => {
    const { convert, subprocess } = await mount()
    subprocess.script = { exitCode: 1, produce: false }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    const controller = new AbortController()
    controller.abort()
    const spec = convert.resolve({ sourcePath, targetFormat: 'pdf' })
    // The seam refuses before dispatch; the provider carries the same refusal for a direct caller.
    await expect(convert.run(spec, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CANCELLED' }))
  })
})

describe('LibreOfficeConvertProvider cancellation and diagnostics', () => {
  it('reports cancellation when the caller aborts while the converter is running', async () => {
    const { ctx, subprocess } = await mount()
    const controller = new AbortController()
    subprocess.script = { produce: false }
    subprocess.onSpawn = () => { controller.abort() }
    const provider = new LibreOfficeConvertProvider(ctx, {
      binary: 'soffice', workDir: workspace, priority: 10, graceMs: 1000,
    })
    await provider.probe()
    await writeFile(join(workspace, 'a.docx'), documentFixture('docx'))
    await expect(provider.convert({
      sourcePath: join(workspace, 'a.docx'),
      sourceFormat: 'docx',
      outputPath: join(workspace, 'a.pdf'),
      targetFormat: 'pdf',
    }, controller.signal)).rejects.toThrow(expect.objectContaining({ code: 'CONVERT_CANCELLED' }))
  })

  it('still reports the failure when the backend supplied no collected readers', async () => {
    const { convert, subprocess } = await mount()
    subprocess.omitReaders = true
    subprocess.script = { exitCode: 1, produce: false }
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' })))
      .rejects.toThrow(/exit code 1/)
  })

  it('finds the output of a source whose name carries no extension', async () => {
    const { ctx } = await mount()
    const provider = new LibreOfficeConvertProvider(ctx, {
      binary: 'soffice', workDir: workspace, priority: 10, graceMs: 1000,
    })
    await provider.probe()
    const sourcePath = join(workspace, 'report')
    await writeFile(sourcePath, documentFixture('docx'))
    // `--convert-to` names its output after the source stem; with no extension the whole name is the
    // stem, which is how a caller converting an extensionless file with an explicit format reaches here.
    await provider.convert({
      sourcePath,
      sourceFormat: 'docx',
      outputPath: join(workspace, 'report.pdf'),
      targetFormat: 'pdf',
    })
    expect(await readFile(join(workspace, 'report.pdf'))).toEqual(documentFixture('pdf'))
  })
})

describe('LibreOfficeConvertProvider damaged-source preflight', () => {
  /** Run `docx -> pdf` over a source file holding exactly the given bytes. */
  async function convertSource(bytes: Buffer): Promise<ReturnType<DocumentConvertRuntime['run']>> {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, bytes)
    return convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' }))
  }

  it('refuses a container whose entries claim no checksum, which LibreOffice rejects on load', async () => {
    await expect(convertSource(zeroCrcDocx()))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_SOURCE_DAMAGED' }))
  })

  it('names the damaged entries and the remedy, the whole point of checking', async () => {
    await expect(convertSource(zeroCrcDocx())).rejects.toThrow(/word\/media\/image1\.png/)
    await expect(convertSource(zeroCrcDocx())).rejects.toThrow(/Re-save the document/)
  })

  it('counts the damaged entries and stops listing them, a long list telling the caller no more', async () => {
    const damaged = storedZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>', 'utf8') },
      { name: 'word/document.xml', data: Buffer.from('<document/>', 'utf8') },
      ...['a', 'b', 'c', 'd'].map(name => ({
        name: `word/media/${name}.png`,
        data: Buffer.from('not really a png', 'utf8'),
        crc: 0,
      })),
    ])
    await expect(convertSource(damaged))
      .rejects.toThrow(/4 entries with no checksum \(word\/media\/a\.png, word\/media\/b\.png, word\/media\/c\.png, …\)/)
  })

  it('refuses a file named docx that is not a container at all', async () => {
    await expect(convertSource(Buffer.from('this was never a docx', 'utf8')))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_SOURCE_DAMAGED' }))
  })

  it('starts no converter for a source it refuses', async () => {
    const { convert, subprocess } = await mount()
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, zeroCrcDocx())
    await expect(convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' }))).rejects.toThrow()
    expect(subprocess.spawns).toEqual([])
  })

  it('leaves a source that is not a ZIP container to the converter, having nothing to inspect', async () => {
    const { subprocess } = await convertFixture('rtf', 'pdf')
    expect(subprocess.spawns).toHaveLength(1)
  })

  it('leaves a source too large to hold in memory to the converter rather than reading it', async () => {
    const { convert, subprocess } = await mount()
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    // Sparse, so the bound is exercised without the test writing 64 MiB.
    await truncate(sourcePath, 64 * 1024 * 1024 + 1)
    await convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' }))
    expect(subprocess.spawns).toHaveLength(1)
  })

  it('leaves a source it cannot read at all to the converter, whose own failure names it', async () => {
    const { ctx } = await mount()
    const provider = new LibreOfficeConvertProvider(ctx, {
      binary: 'soffice', workDir: workspace, priority: 10, graceMs: 1000,
    })
    await provider.probe()
    // The tool stats the source first, so this is reached only by a direct caller — and LibreOffice
    // reports a missing file better than a preflight that never opened it could.
    await expect(provider.convert({
      sourcePath: join(workspace, 'absent.docx'),
      sourceFormat: 'docx',
      outputPath: join(workspace, 'absent.pdf'),
      targetFormat: 'pdf',
    })).resolves.toBeDefined()
  })
})

describe('LibreOfficeConvertProvider caveats', () => {
  it('says what a conversion into plain text left behind', async () => {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    const outcome = await convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' }))
    expect(outcome.notes.map(note => note.code)).toEqual(['TEXT_ONLY'])
    expect(outcome.notes[0]?.message).toMatch(/formatting/)
  })

  it('says the spreadsheet text export keeps one sheet of values', async () => {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'book.xlsx')
    await writeFile(sourcePath, documentFixture('xlsx'))
    const outcome = await convert.run(convert.resolve({ sourcePath, targetFormat: 'txt' }))
    expect(outcome.notes.map(note => note.code)).toEqual(['SPREADSHEET_FIRST_SHEET_ONLY'])
  })

  it('says the text-to-spreadsheet bridge read the file as delimited data', async () => {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'notes.txt')
    await writeFile(sourcePath, documentFixture('txt'))
    const outcome = await convert.run(convert.resolve({ sourcePath, targetFormat: 'xlsx' }))
    expect(outcome.notes.map(note => note.code)).toEqual(['TEXT_READ_AS_CSV'])
  })

  it('reports nothing for a conversion that preserved the document', async () => {
    const { convert } = await mount()
    const sourcePath = join(workspace, 'report.docx')
    await writeFile(sourcePath, documentFixture('docx'))
    const outcome = await convert.run(convert.resolve({ sourcePath, targetFormat: 'pdf' }))
    expect(outcome.notes).toEqual([])
  })

  it('gives every lossy edge a caveat, a route that says only "lossy" telling the model nothing', () => {
    const silent = [...LIBREOFFICE_CONVERSIONS]
      .filter(([, conversion]) => conversion.fidelity === 'lossy' && conversion.caveat === undefined)
      .map(([key]) => key)
    expect(silent).toEqual([])
  })
})

describe('LibreOfficeConvertProvider availability', () => {
  it('registers as unusable when the binary cannot be resolved', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    ;(ctx.subprocess as ScriptedSubprocess).resolvable = false
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await ctx.plugin(LibreOffice, { workDir: workspace })
    expect(() => ctx.documentConvert.resolve({ sourcePath: '/w/a.docx', targetFormat: 'pdf' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })

  it('refuses a direct convert call for a pair it does not serve', async () => {
    const { ctx } = await mount()
    const provider = new LibreOfficeConvertProvider(ctx, {
      binary: 'soffice', workDir: workspace, priority: 10, graceMs: 1000,
    })
    await provider.probe()
    const step: ConvertStepSpec = {
      sourcePath: '/w/a.xlsx', sourceFormat: 'xlsx', outputPath: '/w/a.odp', targetFormat: 'odp',
    }
    await expect(provider.convert(step))
      .rejects.toThrow(expect.objectContaining({ code: 'CONVERT_PROVIDER_UNAVAILABLE' }))
  })
})

describe('document-convert-libreoffice config', () => {
  it('refuses an empty binary name', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await expect(ctx.plugin(LibreOffice, { binary: '  ' })).rejects.toThrow(/non-empty command name/)
  })

  it('refuses a non-integer priority', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await expect(ctx.plugin(LibreOffice, { priority: 1.5 })).rejects.toThrow(/priority must be an integer/)
  })

  it('refuses a grace period outside the timer range', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
    await expect(ctx.plugin(LibreOffice, { graceMs: 0 })).rejects.toThrow(/graceMs/)
    await expect(ctx.plugin(LibreOffice, { graceMs: 2_147_483_648 })).rejects.toThrow(/graceMs/)
  })
})

/**
 * Loader export-shape guard. This is a NAMESPACE plugin with `inject`, so a stray `export default apply`
 * would make the Loader's `unwrapExports` collapse the module to the bare `apply` and drop `inject`
 * (postmortem 0001).
 */
describe('dsh-document-convert-libreoffice Loader export shape', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in LibreOffice).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(LibreOffice) as Record<string, unknown>
    expect(unwrapped).toBe(LibreOffice)
    expect(unwrapped.name).toBe('document-convert-libreoffice')
    expect(unwrapped.inject).toEqual(['documentConvert', 'subprocess'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
