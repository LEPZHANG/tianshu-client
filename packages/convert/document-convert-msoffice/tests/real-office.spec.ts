import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as MsOffice from '@deepseek-ai/dsh-document-convert-msoffice'
import {
  OFFICE_PROGRAMS,
  buildProbeScript,
  parseProbeOutput,
  programStatus,
} from '@deepseek-ai/dsh-document-convert-msoffice'

/**
 * The real stack against a real Office installation: local subprocesses, real PowerShell, real COM. This
 * is the only suite that can catch an export method name or file-format constant the object model does not
 * actually have, which is why the WPS side of the dialect table is marked unverified until this suite has
 * run on a machine that has it.
 *
 * The whole file skips off Windows and on a Windows machine with neither suite installed. `txt` is the
 * source because it is the one format this package reads that a test can write by hand and have the
 * application genuinely parse; a hand-built `.docx` fixture is a container Word refuses to open.
 */

/**
 * Which applications this machine can be driven through, read exactly the way the plugin reads it.
 * `spawnSync` rather than the seam because the answer is needed before any test is declared; the probe is
 * bounded so a hung PowerShell fails the check rather than the run.
 */
function installedPrograms(): ReadonlySet<string> {
  if (process.platform !== 'win32') return new Set()
  const result = spawnSync(
    'powershell',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', buildProbeScript(OFFICE_PROGRAMS)],
    { encoding: 'utf8', timeout: 60_000 },
  )
  if (result.status !== 0) return new Set()
  const registry = parseProbeOutput(result.stdout)
  return new Set(
    OFFICE_PROGRAMS
      .filter(program => programStatus(program, registry).kind === 'available')
      .map(program => program.id),
  )
}

const installed = installedPrograms()
const hasWriter = installed.has('msoffice-word') || installed.has('wps-writer')

/** A token no document boilerplate contains, so finding it proves the text survived the conversion. */
const MARKER = 'ZQXMARKER'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-office-real-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** Mount the seam over local subprocesses with only the Office providers, so nothing else can serve. */
async function mount(): Promise<DocumentConvertRuntime> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
  await ctx.plugin(MsOffice, { workDir: workspace })
  return ctx.documentConvert
}

/** Convert a text file carrying the marker, returning the output and the provider that ran. */
async function convertMarker(
  targetFormat: DocumentFormat,
): Promise<{ output: Buffer; providerId: string }> {
  const sourcePath = join(workspace, 'note.txt')
  await writeFile(sourcePath, `${MARKER}\n这是一段中文，用于确认编码。\n`, 'utf8')
  const convert = await mount()
  const spec = convert.resolve({ sourcePath, targetFormat })
  const outcome = await convert.run(spec)
  return {
    output: await readFile(outcome.outputPath),
    providerId: spec.plan.steps[0]?.providerId ?? '',
  }
}

describe.skipIf(!hasWriter)('a real word processor', () => {
  it('converts text to a pdf through the installed suite rather than falling back', async () => {
    const { output, providerId } = await convertMarker('pdf')
    expect(['msoffice-word', 'wps-writer']).toContain(providerId)
    expect(output.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(output.length).toBeGreaterThan(1_000)
  })

  it('converts text to a docx the application itself wrote', async () => {
    const { output } = await convertMarker('docx')
    // Entry names are stored uncompressed in each local header, so the package's own parts are readable
    // without inflating anything: a container carrying these is one Word wrote, not a renamed zip.
    expect(output.includes('[Content_Types].xml')).toBe(true)
    expect(output.includes('word/document.xml')).toBe(true)
  })

  it('converts text to an rtf whose text is the source, so UTF-8 was read correctly', async () => {
    const { output } = await convertMarker('rtf')
    expect(output.subarray(0, 5).toString('latin1')).toBe('{\\rtf')
    expect(output.toString('latin1')).toContain(MARKER)
  })
})

describe.skipIf(!installed.has('msoffice-word'))('Word reflowing a PDF', () => {
  it('reads back the text of a PDF Word itself wrote, as an editable document', async () => {
    const pdf = await convertMarker('pdf')
    const sourcePath = join(workspace, 'round-trip.pdf')
    await writeFile(sourcePath, pdf.output)
    const convert = await mount()
    const spec = convert.resolve({ sourcePath, targetFormat: 'rtf' })
    const outcome = await convert.run(spec)
    expect(spec.plan.steps[0]?.providerId).toBe('msoffice-word')
    expect(outcome.notes.map(note => note.code)).toEqual(['PDF_REFLOWED_BY_WORD'])
    expect((await readFile(outcome.outputPath)).toString('latin1')).toContain(MARKER)
  })
})
