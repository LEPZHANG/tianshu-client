import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn<(target: string) => boolean>()
}))

// The converter probes are filesystem lookups, so the toolkit cases below would otherwise depend on
// whether the machine running the tests happens to have LibreOffice, pandoc, or poppler installed.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: (target: string) => existsSyncMock(target)
}))

import {
  buildHarnessArguments,
  buildHarnessSpawnOptions,
  buildNodeArguments,
  bundledFontDirectory,
  convertToolDirectories,
  extractDuplicateLoaderEntryId,
  extractFailureCause,
  extractOffendingPlugin,
  extractOffendingPlugins,
  extractPluginFailureReferences,
  formatExitCode,
  updateReadyStability
} from '../src/main/runtime/harness-runtime'
import { canGrantWindowPermission, isTrustedAppUrl } from '../src/main/security-policy'
import {
  isAbortedNavigationError,
  shouldLoadHarnessUrl
} from '../src/main/window-navigation'

beforeEach(() => {
  existsSyncMock.mockReset()
  existsSyncMock.mockReturnValue(false)
})

describe('Harness launch contract', () => {
  it('does not treat a briefly reachable port as a completed Harness startup', () => {
    const firstProbe = updateReadyStability(undefined, true, 1_000)
    expect(firstProbe).toEqual({ readySince: 1_000, ready: false })

    const interruptedProbe = updateReadyStability(firstProbe.readySince, false, 1_400)
    expect(interruptedProbe).toEqual({ readySince: undefined, ready: false })

    const restartedProbe = updateReadyStability(interruptedProbe.readySince, true, 2_000)
    expect(updateReadyStability(restartedProbe.readySince, true, 2_499).ready).toBe(false)
    expect(updateReadyStability(restartedProbe.readySince, true, 2_500).ready).toBe(true)
  })

  it('binds the web server to a random loopback port', () => {
    expect(buildHarnessArguments(43127)).toEqual([
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      '43127'
    ])
  })

  it('applies the desktop composition patch before web arguments', () => {
    expect(buildHarnessArguments(43127, 'C:\\app\\dsh-desktop.patch.yml')).toEqual([
      'web',
      '--patch',
      'C:\\app\\dsh-desktop.patch.yml',
      '--host',
      '127.0.0.1',
      '--port',
      '43127'
    ])
  })

  it('launches Harness with the bundled Node.js runtime', () => {
    const options = buildHarnessSpawnOptions(
      'C:\\Users\\tester\\AppData\\Roaming\\dsh-desktop\\launch-root',
      'C:\\Users\\tester\\AppData\\Roaming\\dsh-desktop\\harness',
      undefined,
      'win32',
      {
        ELECTRON_RUN_AS_NODE: '1',
        PATH: 'fallback-path',
        Path: 'windows-path'
      }
    )

    expect(options).toMatchObject({
      cwd: 'C:\\Users\\tester\\AppData\\Roaming\\dsh-desktop\\launch-root',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        DSH_HOME: 'C:\\Users\\tester\\AppData\\Roaming\\dsh-desktop\\harness',
        NO_COLOR: '1',
        Path: 'windows-path'
      }
    })
    expect(options.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  })

  it('prepends every bundled converter the toolkit actually contains', () => {
    const toolsRoot = 'C:\\Program Files\\天枢平台\\resources\\tools'
    const bundled = [
      `${toolsRoot}\\libreoffice\\program`,
      `${toolsRoot}\\pandoc`,
      `${toolsRoot}\\poppler`
    ]
    existsSyncMock.mockImplementation((target) => bundled.includes(target))

    expect(convertToolDirectories(toolsRoot, 'win32', {})).toEqual(bundled)

    const options = buildHarnessSpawnOptions('C:\\launch', 'C:\\harness', toolsRoot, 'win32', {
      Path: 'C:\\Windows\\system32'
    })
    expect(options.env?.Path).toBe(`${bundled.join(';')};C:\\Windows\\system32`)
  })

  it('contributes the converters a partially fetched toolkit does have', () => {
    const toolsRoot = '/opt/tianshu/resources/tools'
    existsSyncMock.mockImplementation((target) => target === `${toolsRoot}/poppler`)

    expect(convertToolDirectories(toolsRoot, 'linux', {})).toEqual([`${toolsRoot}/poppler`])
  })

  it('falls back to an installed LibreOffice when the toolkit ships none', () => {
    const toolsRoot = 'C:\\Program Files\\天枢平台\\resources\\tools'
    const installed = 'C:\\Program Files\\LibreOffice\\program'
    existsSyncMock.mockImplementation((target) => target === `${installed}\\soffice.exe`)

    expect(
      convertToolDirectories(toolsRoot, 'win32', { ProgramFiles: 'C:\\Program Files' })
    ).toEqual([installed])
  })

  it('prefers the bundled LibreOffice over the installed one', () => {
    const toolsRoot = 'C:\\Program Files\\天枢平台\\resources\\tools'
    existsSyncMock.mockReturnValue(true)

    expect(
      convertToolDirectories(toolsRoot, 'win32', { ProgramFiles: 'C:\\Program Files' })
    ).toEqual([
      `${toolsRoot}\\libreoffice\\program`,
      `${toolsRoot}\\pandoc`,
      `${toolsRoot}\\poppler`
    ])
  })

  it('writes both PATH casings on Windows so the Harness lookup is not shadowed', () => {
    const toolsRoot = 'C:\\tools'
    existsSyncMock.mockImplementation((target) => target === `${toolsRoot}\\pandoc`)

    const options = buildHarnessSpawnOptions('C:\\launch', 'C:\\harness', toolsRoot, 'win32', {
      PATH: 'C:\\Windows\\system32',
      Path: 'C:\\Windows\\system32'
    })

    expect(options.env?.Path).toBe('C:\\tools\\pandoc;C:\\Windows\\system32')
    expect(options.env?.PATH).toBe(options.env?.Path)
  })

  it('does not prepend a converter directory that is already on PATH', () => {
    const toolsRoot = '/opt/tianshu/resources/tools'
    existsSyncMock.mockImplementation((target) => target === `${toolsRoot}/pandoc`)

    const options = buildHarnessSpawnOptions('/launch', '/harness', toolsRoot, 'linux', {
      PATH: `/usr/bin:${toolsRoot}/pandoc`
    })

    expect(options.env?.PATH).toBe(`/usr/bin:${toolsRoot}/pandoc`)
  })

  it('leaves PATH untouched when no toolkit was fetched and nothing is installed', () => {
    const options = buildHarnessSpawnOptions('/launch', '/harness', undefined, 'linux', {
      PATH: '/usr/bin'
    })

    expect(options.env?.PATH).toBe('/usr/bin')
    expect(existsSyncMock).not.toHaveBeenCalled()
  })

  it('passes the internal-loader flag directly to bundled Node.js', () => {
    expect(
      buildNodeArguments(
        'C:\\app\\harness-node-entry.mjs',
        'C:\\app\\dsh\\lib\\bin.js',
        43127,
        'C:\\app\\dsh-desktop.patch.yml'
      )
    ).toEqual([
      '--expose-internals',
      'C:\\app\\harness-node-entry.mjs',
      'C:\\app\\dsh\\lib\\bin.js',
      'web',
      '--patch',
      'C:\\app\\dsh-desktop.patch.yml',
      '--host',
      '127.0.0.1',
      '--port',
      '43127'
    ])
  })

  it('makes native Windows termination codes diagnosable', () => {
    expect(formatExitCode(4294930435)).toContain(
      '0xFFFF7003, Crashpad handler unavailable'
    )
  })
})

/**
 * The typefaces GB/T 9704—2012 names are commercially licensed, so the Harness cannot carry them and
 * reads them from a directory the deployment points it at. This is the desktop half of that: the
 * installer's own fonts, handed to the Harness through `DSH_OFFICIAL_DOCUMENT_FONTS`, which is what
 * lets a document the client writes open in a recipient's Word or WPS with the right glyphs.
 */
describe('the typefaces the official-document tool embeds', () => {
  const toolsRoot = 'C:\\Program Files\\天枢平台\\resources\\tools'
  const fonts = `${toolsRoot}\\libreoffice\\share\\fonts\\truetype`

  it('points the Harness at the fonts this installer bundles', () => {
    existsSyncMock.mockImplementation((target) => target === fonts)

    expect(bundledFontDirectory(toolsRoot, 'win32')).toBe(fonts)

    const options = buildHarnessSpawnOptions('C:\\launch', 'C:\\harness', toolsRoot, 'win32', {})
    expect(options.env?.DSH_OFFICIAL_DOCUMENT_FONTS).toBe(fonts)
  })

  it('resolves the directory in the target platform\'s own path flavour', () => {
    const posixRoot = '/opt/tianshu/resources/tools'
    existsSyncMock.mockReturnValue(true)

    expect(bundledFontDirectory(posixRoot, 'linux')).toBe(
      `${posixRoot}/libreoffice/share/fonts/truetype`
    )
  })

  it('says nothing to the Harness when this build ships no typefaces', () => {
    // `npm run package:win:no-fonts` produces a toolkit with the converters but no font directory;
    // the tool then writes documents that name the typefaces without carrying them.
    existsSyncMock.mockImplementation((target) => target === `${toolsRoot}\\pandoc`)

    expect(bundledFontDirectory(toolsRoot, 'win32')).toBeUndefined()

    const options = buildHarnessSpawnOptions('C:\\launch', 'C:\\harness', toolsRoot, 'win32', {})
    expect(options.env).not.toHaveProperty('DSH_OFFICIAL_DOCUMENT_FONTS')
  })

  it('says nothing to the Harness when no toolkit was fetched at all', () => {
    expect(bundledFontDirectory(undefined, 'win32')).toBeUndefined()

    const options = buildHarnessSpawnOptions('/launch', '/harness', undefined, 'linux', {})
    expect(options.env).not.toHaveProperty('DSH_OFFICIAL_DOCUMENT_FONTS')
    expect(existsSyncMock).not.toHaveBeenCalled()
  })

  it('does not let the parent environment name a font directory the build does not have', () => {
    existsSyncMock.mockReturnValue(false)

    const options = buildHarnessSpawnOptions('/launch', '/harness', '/opt/tools', 'linux', {
      DSH_OFFICIAL_DOCUMENT_FONTS: '/somewhere/else'
    })
    // Inherited rather than overwritten: a developer who sets it deliberately still wins, and an
    // installed client has nothing in its parent environment to inherit.
    expect(options.env?.DSH_OFFICIAL_DOCUMENT_FONTS).toBe('/somewhere/else')
  })
})



describe('harness failure cause extraction', () => {
  it('extracts the DSH entry failure message from stderr', () => {
    const logs = [
      '[stderr] [harness-node] DSH entry failed: Error: dsh: plugin tree failed to load',
      '[stderr] AggregateError: loader entries failed to apply',
    ]
    expect(extractFailureCause(logs)).toBe('Error: dsh: plugin tree failed to load')
  })

  it('extracts uncaught exception messages from stderr', () => {
    const logs = [
      '[stderr] [harness-node] uncaught exception: ReferenceError: foo is not defined',
    ]
    expect(extractFailureCause(logs)).toBe('ReferenceError: foo is not defined')
  })

  it('extracts unhandled rejection messages from stderr', () => {
    const logs = [
      '[stderr] [harness-node] unhandled rejection: TypeError: cannot read property x of null',
    ]
    expect(extractFailureCause(logs)).toBe('TypeError: cannot read property x of null')
  })

  it('prefers DSH entry failure over uncaught error', () => {
    const logs = [
      '[stderr] [harness-node] uncaught exception: some error',
      '[stderr] [harness-node] DSH entry failed: Error: plugin failed to load',
    ]
    expect(extractFailureCause(logs)).toBe('Error: plugin failed to load')
  })

  it('falls back to the last error-like stderr line', () => {
    const logs = [
      '[stderr] some random output',
      '[stderr] another line',
      '[stderr] FATAL: configuration error in settings.yaml',
    ]
    expect(extractFailureCause(logs)).toBe('FATAL: configuration error in settings.yaml')
  })

  it('falls back to the last stderr line when nothing matches', () => {
    const logs = [
      '[stderr] starting up',
      '[stderr] something happened',
      '[stderr] process exiting now',
    ]
    expect(extractFailureCause(logs)).toBe('process exiting now')
  })

  it('returns undefined when there are no stderr lines', () => {
    const logs = [
      '[stdout] normal output',
      '[desktop] starting harness',
    ]
    expect(extractFailureCause(logs)).toBeUndefined()
  })

  it('returns undefined for empty log array', () => {
    expect(extractFailureCause([])).toBeUndefined()
  })

  it('uses only the latest Harness launch when earlier attempts also failed', () => {
    const logs = [
      '[desktop] starting 2026-08-19T08:00:00.000Z',
      '[stderr] [harness-node] DSH entry failed: Error: first plugin failed',
      '[desktop] starting 2026-08-19T08:01:00.000Z',
      '[stderr] [harness-node] DSH entry failed: Error: second plugin failed'
    ]
    expect(extractFailureCause(logs)).toBe('Error: second plugin failed')
  })

  it('ignores long error lines (>200 chars) when falling back', () => {
    const longLine = 'x'.repeat(250)
    const logs = [
      `[stderr] ${longLine}`,
      '[stderr] short error message',
    ]
    expect(extractFailureCause(logs)).toBe('short error message')
  })
})

describe('offending plugin extraction', () => {
  it('extracts plugin name from loader entry failure in stderr', () => {
    const logs = [
      '[stderr] [harness-node] DSH entry failed: Error: dsh: plugin tree failed to load: failed to apply loader entry web-ui-better-sidebar (dsh-better-sidebar): webserver: duplicate prefix route "/sidebar/api"',
      '[stderr] Error: webserver: duplicate prefix route "/sidebar/api"'
    ]
    expect(extractOffendingPlugin(logs)).toBe('dsh-better-sidebar')
  })

  it('extracts scoped plugin name from loader entry failure', () => {
    const logs = [
      '[stderr] [harness-node] DSH entry failed: Error: dsh: plugin tree failed to load: failed to apply loader entry abc (@linxin666/dsh-web-ui-all): error message'
    ]
    expect(extractOffendingPlugin(logs)).toBe('@linxin666/dsh-web-ui-all')
  })

  it('extracts plugin name from cannot resolve profile bundle error', () => {
    const logs = [
      '[stderr] [harness-node] DSH entry failed: Error: dsh: cannot resolve profile bundle "custom-broken-bundle" from the dsh installation'
    ]
    expect(extractOffendingPlugin(logs)).toBe('custom-broken-bundle')
  })

  it('extracts plugin name from declares no dsh.bundle error', () => {
    const logs = [
      '[stderr] [harness-node] DSH entry failed: Error: dsh: profile bundle "plain-npm-package" declares no dsh.bundle in its package.json'
    ]
    expect(extractOffendingPlugin(logs)).toBe('plain-npm-package')
  })

  it('ignores core deepseek packages as offending plugins', () => {
    const logs = [
      '[stderr] [harness-node] DSH entry failed: Error: dsh: plugin tree failed to load: failed to apply loader entry picker (@deepseek-ai/dsh-client-ui-directory-picker-native): some error'
    ]
    expect(extractOffendingPlugin(logs)).toBeUndefined()
  })

  it('extracts only third-party packages from the frontend boot failure list', () => {
    const logs = [
      '[stderr] Failed to load plugins\n@deepseek-ai/dsh-client-ui-directory-picker-native\ndsh-remote\nweb boot: 2 entries did not activate'
    ]
    expect(extractOffendingPlugins(logs)).toEqual(['dsh-remote'])
    expect(extractPluginFailureReferences(logs)).toEqual([
      '@deepseek-ai/dsh-client-ui-directory-picker-native',
      'dsh-remote'
    ])
  })

  it('keeps a failed core entry as ownership evidence without making it uninstallable', () => {
    const logs = [
      '[stderr] failed to apply loader entry 43d01328 (@deepseek-ai/dsh-client-ui-directory-picker-browse): single slot "conversation.hero.workspace.directoryFlow" already has a registration at priority 0'
    ]
    expect(extractPluginFailureReferences(logs)).toEqual([
      '@deepseek-ai/dsh-client-ui-directory-picker-browse'
    ])
    expect(extractOffendingPlugins(logs)).toEqual([])
  })

  it('returns undefined when no plugin error is matched', () => {
    const logs = [
      '[stderr] [harness-node] uncaught exception: ReferenceError: x is not defined'
    ]
    expect(extractOffendingPlugin(logs)).toBeUndefined()
  })

  it('never treats an internal Cordis loader as an uninstallable plugin', () => {
    const logs = [
      '[stderr] [harness-node] DSH entry failed: Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): duplicate loader entry id: storage'
    ]
    expect(extractOffendingPlugins(logs)).toEqual([])
    expect(extractDuplicateLoaderEntryId(logs)).toBe('storage')
  })

  it('collects multiple unique plugins reported by the same launch', () => {
    const logs = [
      '[desktop] starting 2026-08-19T08:00:00.000Z',
      '[stderr] Error: failed to apply loader entry sidebar (dsh-better-sidebar): duplicate prefix route "/sidebar/api"',
      '[stderr] Error: failed to import loader entry tools (@example/dsh-tools): missing dependency',
      '[stderr] Error: failed to apply loader entry sidebar (dsh-better-sidebar): duplicate prefix route "/sidebar/api"'
    ]
    expect(extractOffendingPlugins(logs)).toEqual([
      'dsh-better-sidebar',
      '@example/dsh-tools'
    ])
  })

  it('does not keep offering a plugin removed during an earlier launch', () => {
    const logs = [
      '[desktop] starting 2026-08-19T08:00:00.000Z',
      '[stderr] Error: failed to apply loader entry sidebar (first-plugin): duplicate prefix route "/sidebar/api"',
      '[desktop] starting 2026-08-19T08:01:00.000Z',
      '[stderr] Error: failed to apply loader entry panel (second-plugin): duplicate prefix route "/panel/api"'
    ]
    expect(extractOffendingPlugins(logs)).toEqual(['second-plugin'])
  })
})

describe('navigation trust boundary', () => {
  it('only trusts the launcher and loopback HTTP pages', () => {
    expect(isTrustedAppUrl('file:///app/index.html')).toBe(true)
    expect(isTrustedAppUrl('http://127.0.0.1:43127')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:43127')).toBe(true)
    expect(isTrustedAppUrl('https://127.0.0.1:43127')).toBe(false)
    expect(isTrustedAppUrl('http://example.com')).toBe(false)
    expect(isTrustedAppUrl('javascript:alert(1)')).toBe(false)
  })

  it('only grants clipboard writes from the trusted main frame', () => {
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'http://127.0.0.1:43127/session',
        true
      )
    ).toBe(true)
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'http://localhost:43127/session',
        true
      )
    ).toBe(true)
    expect(
      canGrantWindowPermission('clipboard-read', 'http://127.0.0.1:43127/session', true)
    ).toBe(false)
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'http://127.0.0.1:43127/session',
        false
      )
    ).toBe(false)
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'https://example.com/session',
        true
      )
    ).toBe(false)
    expect(
      canGrantWindowPermission('clipboard-sanitized-write', 'file:///tmp/app.html', true)
    ).toBe(false)
  })
})

describe('Harness window activation', () => {
  it('preserves the current page when the existing Harness instance is focused again', () => {
    expect(
      shouldLoadHarnessUrl(
        'http://127.0.0.1:43127/settings/models',
        'http://127.0.0.1:43127'
      )
    ).toBe(false)
  })

  it('loads the page for a new window or a restarted Harness instance', () => {
    expect(shouldLoadHarnessUrl('about:blank', 'http://127.0.0.1:43127')).toBe(true)
    expect(
      shouldLoadHarnessUrl('http://127.0.0.1:43127/settings', 'http://127.0.0.1:43128')
    ).toBe(true)
  })

  it('recognizes Electron navigation cancellation without hiding other load failures', () => {
    expect(isAbortedNavigationError({ code: 'ERR_ABORTED', errno: -3 })).toBe(true)
    expect(
      isAbortedNavigationError(
        new Error("ERR_ABORTED (-3) loading 'http://127.0.0.1:43127/'")
      )
    ).toBe(true)
    expect(isAbortedNavigationError({ code: 'ERR_CONNECTION_REFUSED', errno: -102 })).toBe(
      false
    )
  })
})
