import { describe, expect, it, vi } from 'vitest'

const { existsSync } = vi.hoisted(() => ({ existsSync: vi.fn() }))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync
}))

const { buildHarnessSpawnOptions, libreOfficeDirectory } = await import(
  '../src/main/runtime/harness-runtime'
)

const WINDOWS_PROGRAM = 'C:\\Program Files\\LibreOffice\\program'
const MACOS_PROGRAM = '/Applications/LibreOffice.app/Contents/MacOS'

/** Report only the named paths as present, so probing never depends on the test machine. */
function present(...paths: string[]): void {
  existsSync.mockReset()
  existsSync.mockImplementation((path: string) => paths.includes(path))
}

describe('LibreOffice discovery', () => {
  it('finds the Windows install through ProgramFiles rather than a hardcoded drive', () => {
    present('D:\\Apps\\LibreOffice\\program\\soffice.exe')

    expect(
      libreOfficeDirectory('win32', { ProgramFiles: 'D:\\Apps' })
    ).toBe('D:\\Apps\\LibreOffice\\program')
  })

  it('falls back to the 32-bit Windows install location', () => {
    present('C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe')

    expect(
      libreOfficeDirectory('win32', {
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)'
      })
    ).toBe('C:\\Program Files (x86)\\LibreOffice\\program')
  })

  it('finds soffice inside the macOS application bundle', () => {
    present(`${MACOS_PROGRAM}/soffice`)

    expect(libreOfficeDirectory('darwin', {})).toBe(MACOS_PROGRAM)
  })

  it('probes nothing on Linux, where a distribution install is already on PATH', () => {
    present(`${MACOS_PROGRAM}/soffice`)

    expect(libreOfficeDirectory('linux', {})).toBeUndefined()
    expect(existsSync).not.toHaveBeenCalled()
  })

  it('reports nothing when LibreOffice is not installed', () => {
    present()

    expect(libreOfficeDirectory('win32', { ProgramFiles: 'C:\\Program Files' })).toBeUndefined()
    expect(libreOfficeDirectory('darwin', {})).toBeUndefined()
  })
})

describe('LibreOffice on the Harness PATH', () => {
  it('prepends the install to BOTH PATH casings on Windows', () => {
    present(`${WINDOWS_PROGRAM}\\soffice.exe`)

    const { env } = buildHarnessSpawnOptions('C:\\launch', 'C:\\harness', undefined, 'win32', {
      ProgramFiles: 'C:\\Program Files',
      PATH: 'stale-path',
      Path: 'windows-path'
    })

    // The Harness resolves `soffice` by reading PATH exactly, so leaving the stale
    // uppercase value in place would shadow the injection and silently do nothing.
    expect(env?.Path).toBe(`${WINDOWS_PROGRAM};windows-path`)
    expect(env?.PATH).toBe(`${WINDOWS_PROGRAM};windows-path`)
  })

  it('prepends the macOS bundle to PATH', () => {
    present(`${MACOS_PROGRAM}/soffice`)

    const { env } = buildHarnessSpawnOptions('/launch', '/harness', undefined, 'darwin', {
      PATH: '/usr/bin'
    })

    expect(env?.PATH).toBe(`${MACOS_PROGRAM}:/usr/bin`)
  })

  it('leaves PATH untouched on Linux', () => {
    present()

    const { env } = buildHarnessSpawnOptions('/launch', '/harness', undefined, 'linux', {
      PATH: '/usr/bin:/usr/local/bin'
    })

    expect(env?.PATH).toBe('/usr/bin:/usr/local/bin')
  })

  it('leaves PATH untouched when LibreOffice is absent', () => {
    present()

    const { env } = buildHarnessSpawnOptions('C:\\launch', 'C:\\harness', undefined, 'win32', {
      ProgramFiles: 'C:\\Program Files',
      Path: 'windows-path'
    })

    expect(env?.Path).toBe('windows-path')
  })

  it('does not duplicate an install the user already put on PATH', () => {
    present(`${MACOS_PROGRAM}/soffice`)

    const { env } = buildHarnessSpawnOptions('/launch', '/harness', undefined, 'darwin', {
      PATH: `/usr/bin:${MACOS_PROGRAM}`
    })

    expect(env?.PATH).toBe(`/usr/bin:${MACOS_PROGRAM}`)
  })
})
