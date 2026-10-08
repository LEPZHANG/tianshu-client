import { writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConvertStepSpec } from '@deepseek-ai/dsh-document-convert'
import { ConvertError } from '@deepseek-ai/dsh-document-convert'
import { OFFICE_PROGRAMS, OfficeConvertProvider, PDF_REFLOW_CAVEAT } from '@deepseek-ai/dsh-document-convert-msoffice'
import type { OfficeProgramStatus } from '@deepseek-ai/dsh-document-convert-msoffice'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ScriptedSubprocess } from '../../document-convert/tests/scripted-subprocess.ts'
import { officeOutputPath, pidFilePath } from './support.ts'

/**
 * One provider driving a scripted PowerShell, which keeps the argv construction, the output move, the
 * failure classification, the process cleanup, and the queue under test without Windows.
 */

let workspace: string
let ctx: Context
let subprocess: ScriptedSubprocess

/** Word, which every conversion below drives. */
const WORD = OFFICE_PROGRAMS.find(program => program.id === 'msoffice-word')

/** A conversion spawn, as opposed to the `taskkill` that may follow it. */
function isConversion(spec: SubprocessSpawnSpec): boolean {
  return (spec.argv[0] as string).endsWith('powershell')
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-msoffice-'))
  ctx = new Context()
  await ctx.plugin(ScriptedSubprocess)
  subprocess = ctx.subprocess as ScriptedSubprocess
  subprocess.outputPathOf = officeOutputPath
  subprocess.scriptByCommand = { taskkill: { produce: false } }
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** A provider for Word with the given verdict. */
function provider(status: OfficeProgramStatus = { kind: 'available', server: 'winword.exe' }): OfficeConvertProvider {
  if (WORD === undefined) throw new Error('msoffice-word is missing from the program table')
  return new OfficeConvertProvider(ctx, WORD, {
    status,
    shell: '/usr/bin/powershell',
    workDir: workspace,
    priority: 30,
    graceMs: 3_000,
  })
}

/** A `docx -> pdf` step with the source written and a destination inside the workspace. */
async function step(name = 'report'): Promise<ConvertStepSpec> {
  const sourcePath = join(workspace, `${name}.docx`)
  await writeFile(sourcePath, 'source')
  return {
    sourcePath,
    sourceFormat: 'docx',
    outputPath: join(workspace, `${name}.pdf`),
    targetFormat: 'pdf',
  }
}

/**
 * Write the process ids a real script would have recorded, at the path the script names. Synchronously,
 * because the provider reads the file as soon as the run it is cleaning up after has ended.
 */
function recordPids(pids: string): void {
  subprocess.onSpawn = (spec) => {
    if (isConversion(spec)) writeFileSync(pidFilePath(spec), pids)
  }
}

/**
 * The {@link ConvertError} a conversion rejected with, so a case can assert both its code and the
 * diagnostic text without the matcher losing the type.
 * @param attempt - the conversion, which must reject.
 * @returns the error it rejected with.
 */
async function failure(attempt: Promise<unknown>): Promise<ConvertError> {
  const reason = await attempt.then(() => undefined, (error: unknown) => error)
  if (!(reason instanceof ConvertError)) {
    throw new Error(`expected a ConvertError, got ${String(reason)}`)
  }
  return reason
}

describe('running a conversion', () => {
  it('drives the resolved shell with the script as one -Command argument', async () => {
    await provider().convert(await step())
    const argv = subprocess.spawns[0]?.argv ?? []
    expect(argv.slice(0, 5)).toEqual([
      '/usr/bin/powershell',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
    ])
    expect(argv).toHaveLength(6)
    expect(argv[5]).toContain('$app.AutomationSecurity = 3')
  })

  it('converts into a private scratch directory, then moves the result to the caller\'s path', async () => {
    const spec = await step()
    expect(await provider().convert(spec)).toEqual([])
    expect((await readFile(spec.outputPath)).length).toBeGreaterThan(0)
    const produced = officeOutputPath(subprocess.spawns[0] as SubprocessSpawnSpec)
    expect(produced).not.toBe(spec.outputPath)
    expect(produced.startsWith(workspace)).toBe(true)
  })

  it('removes the scratch directory whether the conversion succeeded or failed', async () => {
    await provider().convert(await step('ok'))
    subprocess.script = { produce: false, exitCode: 1 }
    await expect(provider().convert(await step('bad'))).rejects.toThrow(ConvertError)
    const scratch = subprocess.spawns.filter(isConversion).map(spec => spec.cwd)
    expect(scratch).toHaveLength(2)
    for (const directory of scratch) await expect(stat(directory)).rejects.toThrow()
  })

  it('reports no notes for a conversion between the application\'s own formats', async () => {
    expect(await provider().convert(await step())).toEqual([])
  })

  it('names the reflow a PDF went through, and opens it read-only like any other source', async () => {
    const sourcePath = join(workspace, 'proposal.pdf')
    await writeFile(sourcePath, 'source')
    const notes = await provider().convert({
      sourcePath,
      sourceFormat: 'pdf',
      outputPath: join(workspace, 'proposal.docx'),
      targetFormat: 'docx',
    })
    expect(notes).toEqual([PDF_REFLOW_CAVEAT])
    expect(subprocess.spawns[0]?.argv[5]).toContain('$app.Documents.Open($source, $false, $true, $false)')
  })

  it('declares the reflow routes for Word only', () => {
    const wps = OFFICE_PROGRAMS.find(program => program.id === 'wps-writer')
    if (wps === undefined) throw new Error('wps-writer is missing from the program table')
    const options = { status: { kind: 'available', server: 'wps.exe' } as const, shell: 'pwsh', workDir: workspace, priority: 20, graceMs: 1 }
    expect(provider().routes.some(route => route.from === 'pdf')).toBe(true)
    expect(new OfficeConvertProvider(ctx, wps, options).routes.some(route => route.from === 'pdf')).toBe(false)
  })
})

describe('refusing to run', () => {
  it('refuses when the application is not installed, naming no reason a user cannot act on', async () => {
    const office = provider({ kind: 'absent' })
    expect(office.available()).toBe(false)
    expect(office.unavailableBecause()).toBeUndefined()
    expect((await failure(office.convert(await step()))).code).toBe('CONVERT_PROVIDER_UNAVAILABLE')
    expect(subprocess.spawns).toEqual([])
  })

  it('refuses when another suite holds the ProgID, and says which one', async () => {
    const office = provider({ kind: 'mismatched', server: 'wps.exe', engine: 'wps' })
    expect(office.available()).toBe(false)
    expect(office.unavailableBecause()).toContain('wps.exe')
    expect((await failure(office.convert(await step()))).code).toBe('CONVERT_PROVIDER_UNAVAILABLE')
  })

  it('refuses when the machine has no PowerShell to drive an installed application', async () => {
    if (WORD === undefined) throw new Error('msoffice-word is missing from the program table')
    const office = new OfficeConvertProvider(ctx, WORD, {
      status: { kind: 'available', server: 'winword.exe' },
      shell: undefined,
      workDir: workspace,
      priority: 30,
      graceMs: 3_000,
    })
    expect(office.available()).toBe(false)
    expect(office.unavailableBecause()).toContain('no PowerShell')
  })

  it('refuses a step outside its own declared routes rather than attempting it', async () => {
    const spec = await step()
    const error = await failure(provider().convert({ ...spec, targetFormat: 'odt' }))
    expect(error.code).toBe('CONVERT_PROVIDER_UNAVAILABLE')
    expect(error.message).toContain('does not convert docx to odt')
    expect(subprocess.spawns).toEqual([])
  })
})

describe('classifying a failure', () => {
  it('reports the exit code and the application\'s own diagnostic', async () => {
    subprocess.script = { produce: false, exitCode: 1, stderr: 'The RPC server is unavailable.' }
    const error = await failure(provider().convert(await step()))
    expect(error.code).toBe('CONVERT_PROVIDER_FAILED')
    expect(error.message).toContain('exit code 1')
    expect(error.message).toContain('The RPC server is unavailable.')
  })

  it('reports a killed shell by its signal', async () => {
    subprocess.script = { produce: false, signal: 'SIGKILL' }
    const error = await failure(provider().convert(await step()))
    expect(error.code).toBe('CONVERT_PROVIDER_FAILED')
    expect(error.message).toContain('signal SIGKILL')
  })

  it('refuses a run that reported success and wrote nothing', async () => {
    subprocess.script = { produce: false }
    const error = await failure(provider().convert(await step()))
    expect(error.code).toBe('CONVERT_PROVIDER_FAILED')
    expect(error.message).toContain('did not convert')
  })

  it('reports the exit code alone when the run retained no diagnostics to quote', async () => {
    subprocess.omitReaders = true
    subprocess.script = { produce: false, exitCode: 1, stderr: 'never read' }
    const error = await failure(provider().convert(await step()))
    expect(error.code).toBe('CONVERT_PROVIDER_FAILED')
    expect(error.message).toContain('exit code 1')
    expect(error.message).not.toContain('never read')
  })

  it('reports cancellation as cancellation, not as a conversion failure', async () => {
    const controller = new AbortController()
    subprocess.onSpawn = () => {
      controller.abort()
    }
    const error = await failure(provider().convert(await step(), controller.signal))
    expect(error.code).toBe('CONVERT_CANCELLED')
  })
})

describe('the Office process, which is not a child of the shell', () => {
  it('kills what the script started when the run did not end cleanly', async () => {
    recordPids('4321 8765')
    subprocess.script = { produce: false, exitCode: 1 }
    await expect(provider().convert(await step())).rejects.toThrow(ConvertError)
    const kills = subprocess.spawns.filter(spec => !isConversion(spec)).map(spec => spec.argv)
    expect(kills).toEqual([
      ['/usr/bin/taskkill', '/T', '/F', '/PID', '4321'],
      ['/usr/bin/taskkill', '/T', '/F', '/PID', '8765'],
    ])
  })

  it('kills what the script started when the conversion was cancelled', async () => {
    const controller = new AbortController()
    subprocess.onSpawn = (spec) => {
      if (!isConversion(spec)) return
      writeFileSync(pidFilePath(spec), '4321')
      controller.abort()
    }
    const error = await failure(provider().convert(await step(), controller.signal))
    expect(error.code).toBe('CONVERT_CANCELLED')
    expect(subprocess.spawns.filter(spec => !isConversion(spec))).toHaveLength(1)
  })

  it('kills nothing after a run that quit on its own', async () => {
    recordPids('4321')
    await provider().convert(await step())
    expect(subprocess.spawns.filter(spec => !isConversion(spec))).toEqual([])
  })

  it('kills nothing when the script attached to an application the user had open', async () => {
    recordPids('')
    subprocess.script = { produce: false, exitCode: 1 }
    await expect(provider().convert(await step())).rejects.toThrow(ConvertError)
    expect(subprocess.spawns.filter(spec => !isConversion(spec))).toEqual([])
  })

  it('lets a conversion error stand when the machine has no taskkill', async () => {
    recordPids('4321')
    subprocess.resolvableExcept = ['taskkill']
    subprocess.script = { produce: false, exitCode: 1 }
    expect((await failure(provider().convert(await step()))).code).toBe('CONVERT_PROVIDER_FAILED')
  })
})

describe('one application, one document at a time', () => {
  it('queues conversions so no two run against the same instance', async () => {
    const office = provider()
    const order: string[] = []
    subprocess.onSpawn = (spec) => {
      if (isConversion(spec)) order.push('spawn')
    }
    await Promise.all([
      office.convert(await step('first')).then(() => order.push('done')),
      office.convert(await step('second')).then(() => order.push('done')),
    ])
    expect(order).toEqual(['spawn', 'done', 'spawn', 'done'])
  })

  it('keeps the queue running after a step that failed', async () => {
    const office = provider()
    let firstRun = true
    subprocess.scriptOf = (spec) => {
      if (!isConversion(spec) || !firstRun) return undefined
      firstRun = false
      return { produce: false, exitCode: 1 }
    }
    const failed = office.convert(await step('first'))
    const second = await step('second')
    const succeeded = office.convert(second)
    await expect(failed).rejects.toThrow(ConvertError)
    expect(await succeeded).toEqual([])
    expect((await readFile(second.outputPath)).length).toBeGreaterThan(0)
  })
})
