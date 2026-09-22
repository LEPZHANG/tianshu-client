/**
 * Resolve a workspace-relative path into the Host-facing spelling used by openPath.
 * @param cwd - session workspace root, when known.
 * @param path - absolute or workspace-relative path.
 * @returns an absolute path when a workspace root is available, otherwise the original path.
 */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')) return path
  if (cwd === undefined || cwd === '') return path
  const base = cwd.replace(/[/\\]+$/, '')
  const rel = path.replace(/^[/\\]+/, '')
  return `${base}/${rel}`
}

/**
 * Express an absolute filesystem path as a path relative to the workspace root.
 * The inverse of {@link resolveWorkspacePath}, for OS drag-drop sources that
 * arrive absolute and must be shown workspace-relative.
 * @param cwd - session workspace root, when known.
 * @param path - absolute filesystem path.
 * @returns the workspace-relative spelling when path is the root (`.`) or
 *   beneath it; null when cwd is unknown or path lies outside the workspace.
 */
export function workspaceRelativePath(cwd: string | undefined, path: string): string | null {
  if (cwd === undefined || cwd === '') return null
  const base = cwd.replace(/[/\\]+$/, '').replace(/\\/g, '/')
  const abs = path.replace(/\\/g, '/')
  if (abs === base) return '.'
  const prefix = `${base}/`
  if (!abs.startsWith(prefix)) return null
  return abs.slice(prefix.length)
}
