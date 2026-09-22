import { afterEach, describe, expect, it } from 'vitest'
import { nativeFilePathResolver } from '../src/client/input/nativeFilePath.ts'

type WithBridge = { dshDesktopFilePath?: unknown }

afterEach(() => {
  delete (globalThis as WithBridge).dshDesktopFilePath
})

describe('nativeFilePathResolver', () => {
  it('returns undefined in a plain browser (no bridge published)', () => {
    expect(nativeFilePathResolver()).toBeUndefined()
  })

  it('returns undefined when a bridge is present but forFile is not a function', () => {
    ;(globalThis as WithBridge).dshDesktopFilePath = { forFile: 'nope' }
    expect(nativeFilePathResolver()).toBeUndefined()
  })

  it('wraps the published forFile so the composer never touches the window global', () => {
    const seen: File[] = []
    const file = { name: 'a.ts' } as unknown as File
    ;(globalThis as WithBridge).dshDesktopFilePath = {
      forFile: (f: File): string => { seen.push(f); return '/root/a.ts' },
    }
    const resolve = nativeFilePathResolver()
    expect(resolve).toBeDefined()
    expect(resolve!(file)).toBe('/root/a.ts')
    expect(seen).toEqual([file])
  })
})
