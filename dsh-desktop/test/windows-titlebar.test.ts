import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  WINDOWS_TITLEBAR_HEIGHT,
  desktopMenuCommands,
  isDesktopMenuCommand
} from '../src/shared/desktop-menu'

describe('Windows titlebar menu', () => {
  it('uses a Windows-only overlay while preserving the macOS frame behavior', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')

    expect(main).toContain("const isWindows = process.platform === 'win32'")
    expect(main).toContain("frame: process.platform !== 'darwin'")
    expect(main).toContain("titleBarStyle: 'hidden' as const")
    expect(main).toContain('titleBarOverlay: windowsTitleBarOverlay')
    expect(main).toContain('autoHideMenuBar: true')
    expect(main).toContain('window.setMenuBarVisibility(false)')
    expect(main).toContain('Menu.setApplicationMenu(Menu.buildFromTemplate(template))')
  })

  it('keeps the entire Windows app full-height without a visible titlebar band', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')
    const preload = await readFile('src/preload/windows-titlebar.ts', 'utf8')

    expect(WINDOWS_TITLEBAR_HEIGHT).toBe(36)
    expect(main).toContain("color: '#00000000'")
    expect(preload).not.toContain(`padding-top: \${WINDOWS_TITLEBAR_HEIGHT}px !important`)
    expect(preload).toContain('padding-top: 0 !important')
    expect(preload).toContain('[data-dsh-sidebar-root][data-dsh-sidebar-wide="true"]')
    expect(preload).toContain('padding-top: 6px !important')
    expect(preload).toContain('background: transparent')
    expect(preload).toContain('.safeArea::before')
    // A top strip shorter than the OS resize border (~8px, DPI-scaled) is
    // swallowed by hit-testing and leaves the window unmovable.
    expect(preload).toContain('height: 10px')
    expect(preload).toContain('left: 0')
    expect(preload).toContain('body.dsh-desktop-windows-titlebar-layout > #root')
    expect(preload).toContain('-webkit-app-region: drag')
    expect(preload).toContain('-webkit-app-region: no-drag')
    expect(preload).toContain('env(titlebar-area-width')
  })

  it('turns the app chrome bands into window drag surfaces with no-drag islands', async () => {
    const preload = await readFile('src/preload/windows-titlebar.ts', 'utf8')

    // The sidebar logo row and the conversation session header carry drag;
    // both are addressed structurally (hashed module class names are not
    // visible to the injected sheet), the header through its slot anchor.
    expect(preload).toContain('[data-dsh-sidebar-root] > :first-child')
    expect(preload).toContain('[data-slot="conversation.session.header"] header')
    // app-region inherits, so interactive descendants must opt back out.
    expect(preload).toContain('[data-dsh-sidebar-root] > :first-child button')
    expect(preload.match(/no-drag/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('accepts only the fixed menu command allowlist', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')

    expect(desktopMenuCommands).toContain('restart-harness')
    expect(desktopMenuCommands).toContain('check-for-updates')
    expect(desktopMenuCommands).toContain('toggle-fullscreen')
    expect(isDesktopMenuCommand('copy')).toBe(true)
    expect(isDesktopMenuCommand('run-shell-command')).toBe(false)
    expect(isDesktopMenuCommand({ command: 'quit' })).toBe(false)
    expect(main).toContain("ipcMain.handle('desktop-menu:execute'")
    expect(main).toContain('event.senderFrame !== mainWindow.webContents.mainFrame')
    expect(main).toContain('if (!isDesktopMenuCommand(command))')
  })

  it('synchronizes the native controls with Harness light and dark themes', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')
    const preload = await readFile('src/preload/windows-titlebar.ts', 'utf8')

    expect(main).toContain('window.setTitleBarOverlay(windowsTitleBarOverlay(isDark))')
    expect(main).toContain("ipcMain.handle('desktop-titlebar:set-theme'")
    expect(preload).toContain("attributeFilter: ['data-ds-dark-theme', 'class', 'style']")
    expect(preload).toContain("ipcRenderer.invoke('desktop-titlebar:set-theme', isDark)")
  })
})
