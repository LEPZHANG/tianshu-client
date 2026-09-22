export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000

/**
 * Whether this build may contact an update feed at all.
 *
 * This application is distributed by installing a new package, so no feed is
 * served: the configured publisher points at a host this project does not
 * operate. With the gate off, {@link supportsAutoUpdates} reports the build as
 * update-unsupported, which stops the startup and interval checks and makes the
 * manual menu action answer without a network request. Raise it only after
 * repointing `build.publish` in `package.json` at a reachable internal host.
 */
const AUTO_UPDATE_FEED_ENABLED = false

/**
 * Whether the running installation can host automatic updates.
 * @param isPackaged - whether Electron runs from a packaged application.
 * @param platform - the host platform.
 * @returns `true` only for a packaged macOS or Windows build with the feed
 *   gate raised; a development run has no installed application to replace.
 */
export function supportsAutoUpdates(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return (
    AUTO_UPDATE_FEED_ENABLED
    && isPackaged
    && (platform === 'darwin' || platform === 'win32')
  )
}

export function shouldCheckAfterResume(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS
}
