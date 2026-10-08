import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  OFFICE_PROGRAMS,
  buildProbeScript,
  describeProgramStatus,
  parseProbeOutput,
  probeOfficePrograms,
  programStatus,
  serverExecutableName,
} from '@deepseek-ai/dsh-document-convert-msoffice'
import type { OfficeProbe, OfficeProgram, OfficeProgramStatus } from '@deepseek-ai/dsh-document-convert-msoffice'
import { ScriptedSubprocess } from '../../document-convert/tests/scripted-subprocess.ts'
import { WORD_SERVER, WPS_WRITER_SERVER, probeStdout } from './support.ts'

/**
 * Reading the machine. The case that matters most is the last one: a WPS installation holding
 * `Word.Application` must disable `msoffice-word` rather than be driven as if it were Microsoft Word,
 * because the seam checks a result's format and not which application produced it.
 */

/** The application with a given provider id. */
function program(id: string): OfficeProgram {
  const found = OFFICE_PROGRAMS.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no such program: ${id}`)
  return found
}

describe('probe script', () => {
  const script = buildProbeScript(OFFICE_PROGRAMS)

  it('asks about every ProgID this package knows', () => {
    for (const candidate of OFFICE_PROGRAMS) expect(script).toContain(`'${candidate.progId}'`)
  })

  it('resolves ProgIDs through the registry rather than by starting an application', () => {
    expect(script).toContain('[Type]::GetTypeFromProgID($id)')
    expect(script).not.toContain('New-Object')
  })

  it('reads the per-user hive before the machine hive, for a Click-to-Run installation', () => {
    expect(script.indexOf('HKCU:')).toBeLessThan(script.indexOf('HKLM:'))
    expect(script).toContain('LocalServer32')
  })
})

describe('parseProbeOutput', () => {
  it('maps each reported ProgID to its class server', () => {
    const registry = parseProbeOutput(probeStdout({ 'Word.Application': WORD_SERVER }))
    expect(registry.get('Word.Application')).toBe(WORD_SERVER)
  })

  it('keeps a ProgID whose class server could not be read, with an empty value', () => {
    const registry = parseProbeOutput('Word.Application\t\n')
    expect(registry.has('Word.Application')).toBe(true)
    expect(registry.get('Word.Application')).toBe('')
  })

  it('ignores lines that are not a ProgID and a value', () => {
    expect(parseProbeOutput('\nnot a record\n\tleading tab\n').size).toBe(0)
  })
})

describe('serverExecutableName', () => {
  it('takes a quoted path whole, dropping the automation switch after it', () => {
    expect(serverExecutableName(WORD_SERVER)).toBe('winword.exe')
  })

  it('cuts an unquoted command line at its first switch', () => {
    expect(serverExecutableName('C:\\Office\\WINWORD.EXE /Automation')).toBe('winword.exe')
  })

  it('accepts a bare executable name', () => {
    expect(serverExecutableName('WINWORD.EXE')).toBe('winword.exe')
  })

  it('reports nothing for a value naming no executable', () => {
    expect(serverExecutableName('')).toBeUndefined()
    expect(serverExecutableName('   ')).toBeUndefined()
    expect(serverExecutableName('"   "')).toBeUndefined()
  })

  it('takes the rest of an unterminated quoted path, which is all there is to take', () => {
    expect(serverExecutableName('"C:\\Office\\WINWORD.EXE')).toBe('winword.exe')
  })
})

describe('programStatus', () => {
  it('reports an application whose class server is its own executable as available', () => {
    const status = programStatus(program('msoffice-word'), parseProbeOutput(probeStdout({
      'Word.Application': WORD_SERVER,
    })))
    expect(status).toEqual({ kind: 'available', server: 'winword.exe' })
  })

  it('reports an unregistered ProgID as absent', () => {
    expect(programStatus(program('msoffice-excel'), new Map())).toEqual({ kind: 'absent' })
  })

  it('refuses an application whose class server could not be read', () => {
    const status = programStatus(program('msoffice-word'), new Map([['Word.Application', '']]))
    expect(status).toEqual({ kind: 'unverifiable' })
  })

  it('names the suite that took a ProgID when WPS holds Word.Application', () => {
    const registry = parseProbeOutput(probeStdout({
      'Word.Application': WPS_WRITER_SERVER,
      'KWPS.Application': WPS_WRITER_SERVER,
    }))
    expect(programStatus(program('msoffice-word'), registry))
      .toEqual({ kind: 'mismatched', server: 'wps.exe', engine: 'wps' })
    expect(programStatus(program('wps-writer'), registry))
      .toEqual({ kind: 'available', server: 'wps.exe' })
  })

  it('reports a class server no suite here ships without guessing a suite', () => {
    const registry = new Map([['Word.Application', 'C:\\weird\\thing.exe']])
    expect(programStatus(program('msoffice-word'), registry))
      .toEqual({ kind: 'mismatched', server: 'thing.exe', engine: undefined })
  })
})

describe('describeProgramStatus', () => {
  it('says nothing about an application that works or is simply not installed', () => {
    expect(describeProgramStatus(program('msoffice-word'), { kind: 'available', server: 'winword.exe' }))
      .toBeUndefined()
    expect(describeProgramStatus(program('msoffice-word'), { kind: 'absent' })).toBeUndefined()
  })

  it('explains a hijacked ProgID by naming both executables and the suite that answers', () => {
    const message = describeProgramStatus(program('msoffice-word'), {
      kind: 'mismatched',
      server: 'wps.exe',
      engine: 'wps',
    })
    expect(message).toContain('msoffice-word is disabled')
    expect(message).toContain('wps.exe')
    expect(message).toContain('winword.exe')
    expect(message).toContain('WPS Office')
  })

  it('names Microsoft Office when it holds a WPS ProgID, which is the same failure reversed', () => {
    const message = describeProgramStatus(program('wps-writer'), {
      kind: 'mismatched',
      server: 'winword.exe',
      engine: 'msoffice',
    })
    expect(message).toContain('wps-writer is disabled')
    expect(message).toContain('Microsoft Office')
    expect(message).toContain('msoffice providers cover that suite')
  })

  it('stops short of naming a suite for an executable it does not recognize', () => {
    const message = describeProgramStatus(program('msoffice-word'), {
      kind: 'mismatched',
      server: 'thing.exe',
      engine: undefined,
    })
    expect(message).toContain('thing.exe')
    expect(message).toContain('does not start the application this provider drives')
    expect(message).not.toContain('providers cover that suite')
  })

  it('explains an unreadable class server in terms of the converter being unidentified', () => {
    expect(describeProgramStatus(program('wps-writer'), { kind: 'unverifiable' }))
      .toContain('unidentified converter')
  })
})

describe('probeOfficePrograms', () => {
  let ctx: Context
  let subprocess: ScriptedSubprocess

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(ScriptedSubprocess)
    subprocess = ctx.subprocess as ScriptedSubprocess
    subprocess.script = { produce: false }
  })

  /** One application's verdict, which the probe reports for every application it knows. */
  function status(probe: OfficeProbe, id: string): OfficeProgramStatus {
    const found = probe.verdicts.find(verdict => verdict.program.id === id)
    if (found === undefined) throw new Error(`the probe reported nothing for ${id}`)
    return found.status
  }

  /** Whether the probe gave up on the whole machine. */
  function allAbsent(probe: OfficeProbe): boolean {
    expect(probe.verdicts).toHaveLength(OFFICE_PROGRAMS.length)
    return probe.verdicts.every(verdict => verdict.status.kind === 'absent')
  }

  it('spawns nothing off Windows and reports every application absent', async () => {
    const probe = await probeOfficePrograms(ctx, {
      platform: 'linux',
      shellBinary: 'powershell',
      graceMs: 3_000,
    })
    expect(subprocess.spawns).toEqual([])
    expect(probe.shell).toBeUndefined()
    expect(allAbsent(probe)).toBe(true)
  })

  it('reports every application absent when the machine has no PowerShell', async () => {
    subprocess.resolvable = false
    const probe = await probeOfficePrograms(ctx, {
      platform: 'win32',
      shellBinary: 'powershell',
      graceMs: 3_000,
    })
    expect(probe.shell).toBeUndefined()
    expect(allAbsent(probe)).toBe(true)
  })

  it('runs the configured shell with -Command, which the execution policy does not restrict', async () => {
    subprocess.script = { produce: false, stdout: probeStdout({ 'Word.Application': WORD_SERVER }) }
    const probe = await probeOfficePrograms(ctx, {
      platform: 'win32',
      shellBinary: 'my-powershell',
      graceMs: 3_000,
    })
    expect(probe.shell).toBe('/usr/bin/my-powershell')
    const argv = subprocess.spawns[0]?.argv ?? []
    expect(argv.slice(0, 5)).toEqual([
      '/usr/bin/my-powershell',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
    ])
    expect(argv[5]).toBe(buildProbeScript(OFFICE_PROGRAMS))
  })

  it('reads a status for every application from one run', async () => {
    subprocess.script = {
      produce: false,
      stdout: probeStdout({ 'Word.Application': WORD_SERVER, 'KET.Application': 'C:\\WPS\\et.exe' }),
    }
    const probe = await probeOfficePrograms(ctx, {
      platform: 'win32',
      shellBinary: 'powershell',
      graceMs: 3_000,
    })
    expect(subprocess.spawns).toHaveLength(1)
    expect(probe.verdicts).toHaveLength(OFFICE_PROGRAMS.length)
    expect(status(probe, 'msoffice-word').kind).toBe('available')
    expect(status(probe, 'wps-spreadsheets').kind).toBe('available')
    expect(status(probe, 'msoffice-powerpoint').kind).toBe('absent')
  })

  it('reports every application absent when the probe itself failed', async () => {
    subprocess.script = {
      produce: false,
      exitCode: 1,
      stdout: probeStdout({ 'Word.Application': WORD_SERVER }),
    }
    const probe = await probeOfficePrograms(ctx, {
      platform: 'win32',
      shellBinary: 'powershell',
      graceMs: 3_000,
    })
    expect(probe.shell).toBe('/usr/bin/powershell')
    expect(allAbsent(probe)).toBe(true)
  })

  it('reports every application absent when the run retained no output to read', async () => {
    subprocess.omitReaders = true
    const probe = await probeOfficePrograms(ctx, {
      platform: 'win32',
      shellBinary: 'powershell',
      graceMs: 3_000,
    })
    expect(allAbsent(probe)).toBe(true)
  })
})
