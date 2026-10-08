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
import { declaredFontFamilies, EXPECTED_FONT_FAMILIES, missingFontFamilies } from '../scripts/fetch-convert-tools.mjs'

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
 *
 * The check reads what each font declares, not what its file is called — the same match the tool makes
 * when it embeds a face — so these fixtures are minimal sfnt files built here rather than real fonts.
 */
describe('公文 typeface completeness', () => {
  let fontsRoot: string

  beforeEach(async () => {
    fontsRoot = await mkdtemp(join(tmpdir(), 'dsh-fonts-'))
  })

  afterEach(async () => {
    await rm(fontsRoot, { recursive: true, force: true })
  })

  /** Write one fixture font, or any other file, into the directory under test. */
  const write = async (name: string, bytes: Uint8Array | string): Promise<void> => {
    await writeFile(join(fontsRoot, name), bytes)
  }

  it('requires the three faces Windows does not ship, matched by family rather than by file name', async () => {
    expect(EXPECTED_FONT_FAMILIES).toEqual(['方正小标宋简体', '仿宋_GB2312', '楷体_GB2312'])
    // Deliberately unhelpful file names: a deployment keeps its files however it likes.
    await write('face-one.ttf', fontDeclaring(['方正小标宋简体']))
    await write('FACE-TWO.TTF', fontDeclaring(['仿宋_GB2312']))
    await write('kai.ttf', fontDeclaring(['楷体_GB2312']))
    expect(await missingFontFamilies(fontsRoot)).toEqual([])
  })

  it('reads a collection, whose faces share one file', async () => {
    await write('simsun.ttc', collectionOf([fontDeclaring(['宋体']), fontDeclaring(['楷体_GB2312'])]))
    await write('song-of-record.ttf', fontDeclaring(['方正小标宋简体']))
    await write('fang.ttf', fontDeclaring(['仿宋_GB2312']))
    expect(await missingFontFamilies(fontsRoot)).toEqual([])
  })

  it('names the family no font in the directory declares', async () => {
    await write('face-one.ttf', fontDeclaring(['方正小标宋简体']))
    expect(await missingFontFamilies(fontsRoot)).toEqual(['仿宋_GB2312', '楷体_GB2312'])
  })

  it('reports every family for a directory that is absent, rather than failing', async () => {
    expect(await missingFontFamilies(join(fontsRoot, 'absent'))).toEqual(EXPECTED_FONT_FAMILIES)
  })

  it('counts nothing from a file it cannot read as a TrueType font', async () => {
    await write('notes.txt', 'not a font')
    await write('broken.ttf', 'not a font either')
    await write('cff.ttf', fontDeclaring(['黑体'], 0x4f54544f))
    expect(await missingFontFamilies(fontsRoot)).toEqual(EXPECTED_FONT_FAMILIES)
    expect(declaredFontFamilies(fontDeclaring(['黑体'], 0x4f54544f))).toEqual([])
  })
})

/** One `name` record to write into a fixture font. */
interface FixtureName {
  readonly nameId: number
  readonly text: string
}

/**
 * Build a minimal but structurally valid sfnt declaring the given families.
 *
 * That is the whole of what the packaging reader looks at — a table directory and a Windows-platform
 * `name` table — so these fixtures drive the real code path without a real 4 MB typeface.
 * @param families - family names to declare as nameID 1.
 * @param version - the sfnt version; `0x4f54544f` is `OTTO`, which carries CFF outlines.
 * @returns the font file's bytes.
 */
function fontDeclaring(families: readonly string[], version = 0x00010000): Uint8Array {
  const names: FixtureName[] = families.map(text => ({ nameId: 1, text }))
  const strings = names.map((record) => {
    const bytes = new Uint8Array(record.text.length * 2)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < record.text.length; index += 1) {
      view.setUint16(index * 2, record.text.charCodeAt(index))
    }
    return bytes
  })
  const storage = strings.reduce((total, string) => total + string.length, 0)
  const nameLength = 6 + names.length * 12 + storage
  const directoryLength = 12 + 16
  const bytes = new Uint8Array(directoryLength + nameLength)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, version)
  view.setUint16(4, 1)
  for (let byte = 0; byte < 4; byte += 1) view.setUint8(12 + byte, 'name'.charCodeAt(byte))
  view.setUint32(12 + 8, directoryLength)
  view.setUint32(12 + 12, nameLength)

  const name = directoryLength
  view.setUint16(name + 2, names.length)
  view.setUint16(name + 4, 6 + names.length * 12)
  let offset = 0
  names.forEach((record, index) => {
    const entry = name + 6 + index * 12
    const string = strings[index] as Uint8Array
    view.setUint16(entry, 3)
    view.setUint16(entry + 6, record.nameId)
    view.setUint16(entry + 8, string.length)
    view.setUint16(entry + 10, offset)
    bytes.set(string, name + 6 + names.length * 12 + offset)
    offset += string.length
  })
  return bytes
}

/** Wrap standalone faces in a TrueType collection, rewriting each copy's table offsets to be absolute. */
function collectionOf(fonts: readonly Uint8Array[]): Uint8Array {
  const header = 12 + fonts.length * 4
  const bytes = new Uint8Array(fonts.reduce((total, font) => total + font.length, header))
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x74746366)
  view.setUint32(8, fonts.length)
  let base = header
  fonts.forEach((font, index) => {
    view.setUint32(12 + index * 4, base)
    bytes.set(font, base)
    const count = view.getUint16(base + 4)
    for (let record = 0; record < count; record += 1) {
      const offset = base + 12 + record * 16 + 8
      view.setUint32(offset, view.getUint32(offset) + base)
    }
    base += font.length
  })
  return bytes
}
