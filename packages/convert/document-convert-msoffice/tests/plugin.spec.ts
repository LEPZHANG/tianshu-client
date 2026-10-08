import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { ConvertRoute, DocumentConvertProvider } from '@deepseek-ai/dsh-document-convert'
import * as MsOffice from '@deepseek-ai/dsh-document-convert-msoffice'
import { OFFICE_PROGRAMS, registerOfficeProviders } from '@deepseek-ai/dsh-document-convert-msoffice'
import { ScriptedSubprocess } from '../../document-convert/tests/scripted-subprocess.ts'
import { WORD_SERVER, WPS_WRITER_SERVER, officeOutputPath, probeStdout } from './support.ts'

/**
 * The plugin as a composition sees it: what registers, what it ranks against, and what a misconfiguration
 * does. The route-selection cases are the point of the whole package — a machine with Microsoft Office must
 * stop converting OOXML through LibreOffice, and a machine without it must go on doing so.
 */

let workspace: string
let ctx: Context
let subprocess: ScriptedSubprocess

/** LibreOffice's rank, which is what the Office providers have to outrank to be chosen. */
const LIBREOFFICE_PRIORITY = 10

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-msoffice-plugin-'))
  ctx = new Context()
  await ctx.plugin(ScriptedSubprocess)
  subprocess = ctx.subprocess as ScriptedSubprocess
  subprocess.outputPathOf = officeOutputPath
  await ctx.plugin(DocumentConvertRuntime, { tempDir: workspace })
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** Stand in for the LibreOffice provider: it serves the edge at LibreOffice's rank and nothing else. */
function fallback(routes: readonly ConvertRoute[]): DocumentConvertProvider {
  return {
    id: 'libreoffice',
    routes,
    available: () => true,
    convert: () => Promise.resolve([]),
  }
}

/** The edge every route-selection case below asks for. */
const DOCX_TO_PDF: ConvertRoute = {
  from: 'docx',
  to: 'pdf',
  fidelity: 'faithful',
  priority: LIBREOFFICE_PRIORITY,
}

/** Register the six providers as if this were Windows with exactly the given ProgIDs registered. */
async function onWindows(registry: Readonly<Record<string, string>>): Promise<void> {
  subprocess.script = { produce: false, stdout: probeStdout(registry) }
  await registerOfficeProviders(ctx, {
    platform: 'win32',
    shellBinary: 'powershell',
    workDir: workspace,
    msofficePriority: 30,
    wpsPriority: 25,
    graceMs: 3_000,
  })
}

/** Which provider the seam picks for `docx -> pdf`. */
function chosenForDocxToPdf(): string {
  const spec = ctx.documentConvert.resolve({ sourcePath: join(workspace, 'a.docx'), targetFormat: 'pdf' })
  return spec.plan.steps[0]?.providerId ?? ''
}

describe('registration', () => {
  it('registers one provider per application per suite, on every platform', async () => {
    await ctx.plugin(MsOffice)
    // A duplicate id is refused by the seam, so a second mount that gets as far as the second provider
    // proves the first mount registered all six under their own ids.
    await expect(ctx.plugin(MsOffice)).rejects.toMatchObject({ code: 'CONVERT_DUPLICATE_PROVIDER' })
    expect(OFFICE_PROGRAMS).toHaveLength(6)
  })

  it('unregisters every provider when the fiber is disposed, so a remount succeeds', async () => {
    const fiber = await ctx.plugin(MsOffice)
    await fiber.dispose()
    await expect(ctx.plugin(MsOffice)).resolves.toBeDefined()
  })

  it('registers nothing usable off Windows, leaving the fallback to serve the edge', async () => {
    ctx.documentConvert.registerProvider(fallback([DOCX_TO_PDF]))
    await ctx.plugin(MsOffice)
    expect(chosenForDocxToPdf()).toBe('libreoffice')
  })
})

describe('route selection', () => {
  it('converts OOXML through Microsoft Office where it is installed', async () => {
    ctx.documentConvert.registerProvider(fallback([DOCX_TO_PDF]))
    await onWindows({ 'Word.Application': WORD_SERVER })
    expect(chosenForDocxToPdf()).toBe('msoffice-word')
  })

  it('converts through WPS where that is the only suite installed', async () => {
    ctx.documentConvert.registerProvider(fallback([DOCX_TO_PDF]))
    await onWindows({ 'KWPS.Application': WPS_WRITER_SERVER })
    expect(chosenForDocxToPdf()).toBe('wps-writer')
  })

  it('reflows a PDF through Word rather than importing it as frames through LibreOffice', async () => {
    const framed: ConvertRoute = { from: 'pdf', to: 'docx', fidelity: 'lossy', priority: LIBREOFFICE_PRIORITY }
    ctx.documentConvert.registerProvider(fallback([framed]))
    await onWindows({ 'Word.Application': WORD_SERVER })
    const spec = ctx.documentConvert.resolve({ sourcePath: join(workspace, 'a.pdf'), targetFormat: 'docx' })
    expect(spec.plan.steps.map(planStep => planStep.providerId)).toEqual(['msoffice-word'])
  })

  it('leaves a PDF with LibreOffice where only WPS is installed', async () => {
    const framed: ConvertRoute = { from: 'pdf', to: 'docx', fidelity: 'lossy', priority: LIBREOFFICE_PRIORITY }
    ctx.documentConvert.registerProvider(fallback([framed]))
    await onWindows({ 'KWPS.Application': WPS_WRITER_SERVER })
    const spec = ctx.documentConvert.resolve({ sourcePath: join(workspace, 'a.pdf'), targetFormat: 'docx' })
    expect(spec.plan.steps.map(planStep => planStep.providerId)).toEqual(['libreoffice'])
  })

  it('prefers Microsoft Office over WPS on a machine carrying both', async () => {
    await onWindows({ 'Word.Application': WORD_SERVER, 'KWPS.Application': WPS_WRITER_SERVER })
    expect(chosenForDocxToPdf()).toBe('msoffice-word')
  })

  it('falls back for a family whose application is missing, keeping the one that is present', async () => {
    ctx.documentConvert.registerProvider(fallback([
      DOCX_TO_PDF,
      { from: 'pptx', to: 'pdf', fidelity: 'faithful', priority: LIBREOFFICE_PRIORITY },
    ]))
    await onWindows({ 'Word.Application': WORD_SERVER })
    expect(chosenForDocxToPdf()).toBe('msoffice-word')
    const pptx = ctx.documentConvert.resolve({
      sourcePath: join(workspace, 'deck.pptx'),
      targetFormat: 'pdf',
    })
    expect(pptx.plan.steps[0]?.providerId).toBe('libreoffice')
  })

  it('leaves OpenDocument to the fallback even with every Office application installed', async () => {
    ctx.documentConvert.registerProvider(fallback([
      { from: 'odt', to: 'pdf', fidelity: 'faithful', priority: LIBREOFFICE_PRIORITY },
    ]))
    await onWindows({
      'Word.Application': WORD_SERVER,
      'Excel.Application': '"C:\\Office\\EXCEL.EXE" /Automation',
      'PowerPoint.Application': '"C:\\Office\\POWERPNT.EXE" /Automation',
    })
    const spec = ctx.documentConvert.resolve({
      sourcePath: join(workspace, 'notice.odt'),
      targetFormat: 'pdf',
    })
    expect(spec.plan.steps.map(planStep => planStep.providerId)).toEqual(['libreoffice'])
  })

  it('does not use an installed application whose ProgID another suite holds', async () => {
    ctx.documentConvert.registerProvider(fallback([DOCX_TO_PDF]))
    await onWindows({ 'Word.Application': WPS_WRITER_SERVER })
    expect(chosenForDocxToPdf()).toBe('libreoffice')
  })
})

describe('config', () => {
  it('refuses ranks that leave a dual-suite machine unable to resolve a route', async () => {
    await expect(ctx.plugin(MsOffice, { msofficePriority: 25, wpsPriority: 25 }))
      .rejects.toThrow(/msofficePriority and wpsPriority must differ/)
  })

  it('refuses a rank that is not an integer, which cannot order providers predictably', async () => {
    await expect(ctx.plugin(MsOffice, { wpsPriority: 25.5 }))
      .rejects.toThrow(/wpsPriority must be an integer/)
  })

  it('refuses an empty shell command', async () => {
    await expect(ctx.plugin(MsOffice, { shellBinary: '   ' }))
      .rejects.toThrow(/shellBinary must be a non-empty command name or path/)
  })

  it('refuses a grace period outside the range a timer accepts', async () => {
    await expect(ctx.plugin(MsOffice, { graceMs: 0 })).rejects.toThrow(/graceMs must be a positive/)
    await expect(ctx.plugin(MsOffice, { graceMs: 2_147_483_648 }))
      .rejects.toThrow(/graceMs must be a positive/)
  })

  it('probes the configured shell rather than a fixed one', async () => {
    subprocess.script = { produce: false, stdout: '' }
    await registerOfficeProviders(ctx, {
      platform: 'win32',
      shellBinary: 'pwsh',
      workDir: workspace,
      msofficePriority: 30,
      wpsPriority: 25,
      graceMs: 3_000,
    })
    expect(subprocess.spawns[0]?.argv[0]).toBe('/usr/bin/pwsh')
  })
})

/** Loader export-shape guard: a namespace plugin with `inject` must survive `unwrapExports` (postmortem 0001). */
describe('dsh-document-convert-msoffice Loader export shape', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in MsOffice).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(MsOffice) as Record<string, unknown>
    expect(unwrapped).toBe(MsOffice)
    expect(unwrapped.name).toBe('document-convert-msoffice')
    expect(unwrapped.inject).toEqual(['documentConvert', 'subprocess'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
