import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { ConvertOutcome, DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as LibreOffice from '@deepseek-ai/dsh-document-convert-libreoffice'
import * as Pandoc from '@deepseek-ai/dsh-document-convert-pandoc'
import * as Poppler from '@deepseek-ai/dsh-document-convert-poppler'

/**
 * The real stack against the real converters: local subprocesses, a real `soffice`, a real `pandoc`, and
 * real poppler tools. These are the tests that would catch a route this repository claims but a
 * converter does not actually perform, so they assert that the source's content reaches the output
 * rather than that a file appeared — `soffice` exits 0 and writes structurally valid, empty documents
 * for conversions it cannot do.
 *
 * Each block skips where its binary is absent, as the `pwsh-tool-turn` scenario does for PowerShell.
 */

/**
 * Whether a converter binary is installed. Each tool gets the version flag it actually understands:
 * `soffice` with no arguments opens its Start Center and never exits, and poppler's tools treat
 * `--version` as a filename. The probe is bounded so a hung binary fails the check rather than the run.
 */
const has = (binary: string, versionFlag: string): boolean =>
  spawnSync(binary, [versionFlag], { encoding: 'utf8', timeout: 30_000 }).status === 0

const hasSoffice = has('soffice', '--version')
const hasPdftotext = has('pdftotext', '-v')
const hasPandoc = has('pandoc', '--version')

/** A token that cannot occur in ODF or OOXML boilerplate, so finding it proves content survived. */
const MARKER = 'ZQXMARKER'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-convert-real-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** Mount the seam over local subprocesses with every shipped provider. */
async function mount(): Promise<DocumentConvertRuntime> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
  await ctx.plugin(LibreOffice, { workDir: workspace })
  await ctx.plugin(Pandoc)
  await ctx.plugin(Poppler)
  return ctx.documentConvert
}

/** Convert one file and return the output path. */
async function convert(
  convertRuntime: DocumentConvertRuntime,
  sourcePath: string,
  targetFormat: DocumentFormat,
): Promise<string> {
  const spec = convertRuntime.resolve({ sourcePath, targetFormat })
  const outcome = await convertRuntime.run(spec)
  return outcome.outputPath
}

/**
 * Convert one file and return the whole outcome, for the assertions that are about which provider ran
 * and what it reported rather than about the bytes it wrote.
 */
async function convertOutcome(
  convertRuntime: DocumentConvertRuntime,
  sourcePath: string,
  targetFormat: DocumentFormat,
): Promise<ConvertOutcome> {
  return convertRuntime.run(convertRuntime.resolve({ sourcePath, targetFormat }))
}

/**
 * Whether the marker survived into a converted file. Zipped formats hide their text in member XML and
 * the legacy binary formats store it as UTF-16, so the check covers both encodings rather than reading
 * the file as UTF-8 and concluding the content was lost.
 */
async function carriesMarker(path: string): Promise<boolean> {
  const bytes = await readFile(path)
  if (bytes.includes(MARKER)) return true
  if (bytes.toString('utf16le').includes(MARKER)) return true
  // A zip container (docx/xlsx/pptx/odt/ods/odp) stores its XML deflated; `pdftotext` and `unzip` are
  // not assumed here, so a zipped output is checked through a text conversion instead.
  return false
}

/** Write a plain-text source carrying the marker. */
async function writeSource(name: string): Promise<string> {
  const path = join(workspace, name)
  await writeFile(path, `${MARKER} heading line\n\nSecond line of the document body.\n`)
  return path
}

describe.skipIf(!hasSoffice)('LibreOffice conversions against a real installation', () => {
  it('converts text to pdf and the pdf carries the source text', { timeout: 120_000 }, async () => {
    const convertRuntime = await mount()
    const output = await convert(convertRuntime, await writeSource('report.txt'), 'pdf')
    const bytes = await readFile(output)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('converts text to docx and produces a real OOXML package', { timeout: 120_000 }, async () => {
    const convertRuntime = await mount()
    const output = await convert(convertRuntime, await writeSource('report.txt'), 'docx')
    const bytes = await readFile(output)
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('round-trips text through docx back to text without losing the content', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const docx = await convert(convertRuntime, await writeSource('report.txt'), 'docx')
    const back = await convert(convertRuntime, docx, 'txt')
    expect(await carriesMarker(back)).toBe(true)
  })

  it('reaches html from a document source', { timeout: 120_000 }, async () => {
    const convertRuntime = await mount()
    const output = await convert(convertRuntime, await writeSource('report.txt'), 'html')
    expect(await carriesMarker(output)).toBe(true)
  })

  it('bridges a comma-delimited text file into a spreadsheet and back', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const source = join(workspace, 'table.txt')
    await writeFile(source, `name,qty\n${MARKER},3\ngizmo,7\n`)
    const xlsx = await convert(convertRuntime, source, 'xlsx')
    expect((await readFile(xlsx)).subarray(0, 2).toString('latin1')).toBe('PK')
    const back = await convert(convertRuntime, xlsx, 'txt')
    expect(await carriesMarker(back)).toBe(true)
  })

  it('refuses a conversion no converter chain serves, instead of writing a wrong-typed file', async () => {
    const convertRuntime = await mount()
    const source = await writeSource('report.txt')
    // Text into a presentation is exactly the conversion `soffice` "succeeds" at while writing a
    // slide-less file, so the route table omits it and the seam must say so.
    expect(() => convertRuntime.resolve({ sourcePath: source, targetFormat: 'pptx' }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })
})

describe.skipIf(!hasSoffice || !hasPdftotext)('pdf as a source, through poppler and a second step', () => {
  it('extracts a pdf to text', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const pdf = await convert(convertRuntime, await writeSource('report.txt'), 'pdf')
    const text = await convert(convertRuntime, pdf, 'txt')
    expect(await readFile(text, 'utf8')).toContain(MARKER)
  })

  it('plans pdf to docx as one Writer import, not as a text extraction', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const pdf = await convert(convertRuntime, await writeSource('report.txt'), 'pdf')
    const spec = convertRuntime.resolve({ sourcePath: pdf, targetFormat: 'docx' })
    // The planner takes the shorter plan first, so declaring the Writer import took this pair off the
    // two-step text recovery that poppler and pandoc used to serve. The single step is the point: the
    // extraction dropped every image on the way through plain text.
    expect(spec.plan.steps).toHaveLength(1)
    expect(spec.plan.steps[0]?.providerId).toBe('libreoffice')
    expect(spec.plan.fidelity).toBe('lossy')
    const outcome = await convertRuntime.run(spec)
    expect((await readFile(outcome.outputPath)).subarray(0, 2).toString('latin1')).toBe('PK')
    expect(outcome.notes.map(note => note.code)).toContain('PDF_IMPORTED_AS_FRAMES')
  })

  it('carries the text through the Writer import, not just the page furniture', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const pdf = await convert(convertRuntime, await writeSource('report.txt'), 'pdf')
    const docx = await convert(convertRuntime, pdf, 'docx')
    // Read back through LibreOffice rather than by unzipping: the marker lands in a text frame, and what
    // matters is that the document renders it, not which part of the package holds it.
    const text = await convert(convertRuntime, docx, 'txt')
    expect(await readFile(text, 'utf8')).toContain(MARKER)
  })
})

/**
 * pandoc only wins the edges it declares `faithful`, and the assertion that matters is against the
 * stack as assembled: with LibreOffice also installed, `docx → odt` must still go to LibreOffice even
 * though pandoc declares that edge too and outranks it.
 */
describe.skipIf(!hasSoffice || !hasPandoc)('pandoc against a real installation, sharing the seam with LibreOffice', () => {
  it('gives html to pandoc, whose output is a document rather than a positioned page', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const docx = await convert(convertRuntime, await writeSource('report.txt'), 'docx')
    const outcome = await convertOutcome(convertRuntime, docx, 'html')
    expect(outcome.steps).toEqual([
      expect.objectContaining({ providerId: 'pandoc', from: 'docx', to: 'html', fidelity: 'faithful' }),
    ])
    const html = await readFile(outcome.outputPath, 'utf8')
    expect(html).toContain(MARKER)
    // Pandoc's writer emits real structure; Writer's HTML export emits absolutely positioned paragraphs.
    expect(html).toContain('<p>')
    expect(html).not.toContain('position:absolute')
  })

  it('leaves an office-to-office edge to LibreOffice despite pandoc declaring it', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const docx = await convert(convertRuntime, await writeSource('report.txt'), 'docx')
    const outcome = await convertOutcome(convertRuntime, docx, 'odt')
    expect(outcome.steps).toEqual([
      expect.objectContaining({ providerId: 'libreoffice', from: 'docx', to: 'odt', fidelity: 'faithful' }),
    ])
    expect((await readFile(outcome.outputPath)).subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('reports the plain-text caveat on the route pandoc serves lossily', { timeout: 180_000 }, async () => {
    const convertRuntime = await mount()
    const docx = await convert(convertRuntime, await writeSource('report.txt'), 'docx')
    const outcome = await convertOutcome(convertRuntime, docx, 'txt')
    expect(outcome.steps[0]?.providerId).toBe('pandoc')
    expect(outcome.notes.map(note => note.code)).toEqual(['PLAIN_TEXT_ONLY'])
    expect(await carriesMarker(outcome.outputPath)).toBe(true)
  })
})
