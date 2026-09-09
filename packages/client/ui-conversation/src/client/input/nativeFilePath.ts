/**
 * Desktop-only bridge to a dropped file's absolute path. New Electron removes
 * `File.path`, so a preload publishes `webUtils.getPathForFile` on
 * `window.dshDesktopFilePath`; a plain browser has none. This module localizes
 * that window-global knowledge (the ui-directory-picker-native `resolvePick`
 * posture) so the composer stays free of Electron specifics.
 */

/** Shape a desktop shell exposes to resolve a dropped `File` to its path. */
interface NativeFilePathBridge {
  /** The dropped file's absolute filesystem path. */
  forFile: (file: File) => string
}

/**
 * The desktop file-path resolver, when a shell published one.
 * @returns a resolver mapping a dropped `File` to its absolute path, or
 *   undefined in a plain browser (no filesystem path is available there).
 */
export function nativeFilePathResolver(): ((file: File) => string) | undefined {
  const bridge = (globalThis as { dshDesktopFilePath?: NativeFilePathBridge }).dshDesktopFilePath
  if (bridge !== undefined && typeof bridge.forFile === 'function') return file => bridge.forFile(file)
  return undefined
}
