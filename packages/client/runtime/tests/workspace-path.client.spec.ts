import { describe, expect, it } from 'vitest'
import { resolveWorkspacePath, workspaceRelativePath } from '../src/client/workspaces/path.ts'

describe('resolveWorkspacePath', () => {
  it('leaves absolute paths (posix, drive, UNC) untouched', () => {
    expect(resolveWorkspacePath('/root', '/abs/x')).toBe('/abs/x')
    expect(resolveWorkspacePath('/root', 'C:\\abs\\x')).toBe('C:\\abs\\x')
    expect(resolveWorkspacePath('/root', '\\\\host\\share')).toBe('\\\\host\\share')
  })

  it('joins a relative path onto the workspace root, or returns it unchanged without one', () => {
    expect(resolveWorkspacePath('/root/', 'src/a.ts')).toBe('/root/src/a.ts')
    expect(resolveWorkspacePath(undefined, 'src/a.ts')).toBe('src/a.ts')
    expect(resolveWorkspacePath('', 'src/a.ts')).toBe('src/a.ts')
  })
})

describe('workspaceRelativePath', () => {
  it('returns null when the workspace root is unknown', () => {
    expect(workspaceRelativePath(undefined, '/root/a.ts')).toBeNull()
    expect(workspaceRelativePath('', '/root/a.ts')).toBeNull()
  })

  it('relativizes a path beneath the root and returns "." for the root itself', () => {
    expect(workspaceRelativePath('/root', '/root/src/a.ts')).toBe('src/a.ts')
    expect(workspaceRelativePath('/root/', '/root/a.ts')).toBe('a.ts')
    expect(workspaceRelativePath('/root', '/root')).toBe('.')
  })

  it('does not let a sibling whose name shares the prefix pass as inside', () => {
    expect(workspaceRelativePath('/root/backend', '/root/backend2/a.ts')).toBeNull()
  })

  it('returns null for a path outside the workspace', () => {
    expect(workspaceRelativePath('/root', '/elsewhere/a.ts')).toBeNull()
  })

  it('normalizes Windows separators on both root and path', () => {
    expect(workspaceRelativePath('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe('src/a.ts')
  })
})
