import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildHarnessSpawnOptions,
  bundledFontDirectory,
  convertToolDirectories,
  officialDocumentFontDirectory
} from '../src/main/runtime/harness-runtime'
// @ts-expect-error — the fetch script is plain JavaScript with no declarations.
import { EXPECTED_FONT_FILES, missingFontFiles } from '../scripts/fetch-convert-tools.mjs'

/**
 * The runtime PATH injection and `scripts/fetch-convert-tools.mjs` agree on a directory layout that
 * neither one can check alone: the script writes `<tools>/libreoffice/program`, `<tools>/pandoc`,
 * `<tools>/poppler`, and the typefaces under `<tools>/libreoffice/share/fonts/truetype`, and the
 * runtime looks there. These cases run against a real toolkit tree rather than a mocked filesystem,
 * so a change to either half that breaks the agreement fails here.
 */
describe('bundled conversion toolkit layout', () => {
  let toolsRoot: string

  beforeEach(async () => {
    toolsRoot = await mkdtemp(join(tmpdir(), 'dsh-tools-'))
  })

  afterEach(async () => {
    await rm(toolsRoot, { recursive: true, force: true })
  })

  const layOut = async (...directories: string[]): Promise<void> => {
    for (const directory of directories) {
      await mkdir(join(toolsRoot, directory), { recursive: true })
    }
  }

  it('finds every converter the fetch script writes', async () => {
    await layOut('libreoffice/program', 'libreoffice/share/fonts/truetype', 'pandoc', 'poppler')
    await writeFile(join(toolsRoot, 'MANIFEST.json'), '{}')

    expect(convertToolDirectories(toolsRoot, 'linux', {})).toEqual([
      join(toolsRoot, 'libreoffice', 'program'),
      join(toolsRoot, 'pandoc'),
      join(toolsRoot, 'poppler')
    ])
  })

  it('reports nothing for the placeholder directory a fresh checkout has', async () => {
    await writeFile(join(toolsRoot, '.gitkeep'), '')

    expect(convertToolDirectories(toolsRoot, 'linux', {})).toEqual([])
  })

  it('finds the typefaces where the fetch script installs them', async () => {
    await layOut('libreoffice/program', 'libreoffice/share/fonts/truetype', 'pandoc', 'poppler')

    expect(bundledFontDirectory(toolsRoot, 'linux')).toBe(
      join(toolsRoot, 'libreoffice', 'share', 'fonts', 'truetype')
    )
  })

  it('reports no typefaces for a toolkit packaged without them', async () => {
    // `installFonts()` returns before creating the directory when the fonts are absent, which is
    // what a `package:win:no-fonts` build produces.
    await layOut('libreoffice/program', 'pandoc', 'poppler')

    expect(bundledFontDirectory(toolsRoot, 'linux')).toBeUndefined()
  })

  it('embeds from the desktop font directory when the toolkit has no typefaces', async () => {
    // A development run: `build/fonts` holds the faces, `build/tools` was never fetched.
    await layOut('fonts')
    const fonts = join(toolsRoot, 'fonts')

    expect(officialDocumentFontDirectory(join(toolsRoot, 'tools'), fonts, 'linux')).toBe(fonts)
    expect(
      buildHarnessSpawnOptions('/launch', '/harness', join(toolsRoot, 'tools'), 'linux', {}, fonts).env
        ?.DSH_OFFICIAL_DOCUMENT_FONTS
    ).toBe(fonts)
  })

  it('prefers the toolkit copy over the desktop font directory', async () => {
    await layOut('libreoffice/share/fonts/truetype', 'fonts')

    expect(officialDocumentFontDirectory(toolsRoot, join(toolsRoot, 'fonts'), 'linux')).toBe(
      join(toolsRoot, 'libreoffice', 'share', 'fonts', 'truetype')
    )
  })

  it('leaves the variable unset when neither location exists', () => {
    const options = buildHarnessSpawnOptions(
      '/launch',
      '/harness',
      toolsRoot,
      'linux',
      {},
      join(toolsRoot, 'absent')
    )

    expect(options.env).not.toHaveProperty('DSH_OFFICIAL_DOCUMENT_FONTS')
  })
})

/**
 * Packaging refuses a toolkit missing the GB/T 9704—2012 typefaces, because LibreOffice substitutes
 * silently: the 公文 PDF renders in the wrong faces and every step still reports success.
 */
describe('公文 typeface completeness', () => {
  it('requires all three faces Windows does not ship', () => {
    expect(EXPECTED_FONT_FILES).toEqual(['FZXBSJW.TTF', '仿宋_GB2312.ttf', '楷体_GB2312.ttf'])
    expect(missingFontFiles([])).toEqual(EXPECTED_FONT_FILES)
    expect(missingFontFiles(['FZXBSJW.TTF'])).toEqual(['仿宋_GB2312.ttf', '楷体_GB2312.ttf'])
  })

  it('accepts the faces under any casing, beside fonts it does not require', () => {
    expect(
      missingFontFiles(['fzxbsjw.ttf', '仿宋_GB2312.TTF', '楷体_GB2312.ttf', 'simhei.ttf'])
    ).toEqual([])
  })
})
