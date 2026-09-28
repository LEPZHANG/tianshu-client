import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildCollection, buildFont, windowsFont } from './font-fixtures.ts'
import { loadEmbeddableFonts, readFontEmbedding, readFontFamilies } from '../src/fonts.ts'

/**
 * Every fixture here is a synthetic sfnt from `font-fixtures.ts`, because the real GB/T 9704—2012
 * typefaces are commercially licensed and cannot enter this repository. They cover exactly the part of
 * a font this module reads; that a genuine font survives into Word is a Windows check, not this one.
 */

describe('readFontFamilies', () => {
  it('reads a Windows family name, which stores UTF-16BE', () => {
    expect(readFontFamilies(windowsFont('FangSong_GB2312'))).toEqual(['FangSong_GB2312'])
  })

  it('reads a Macintosh family name, which stores one byte per character', () => {
    const font = buildFont({ names: [{ platform: 1, nameId: 1, text: 'KaiTi_GB2312' }] })
    expect(readFontFamilies(font)).toEqual(['KaiTi_GB2312'])
  })

  it('reads a Unicode-platform family name, which stores UTF-16BE like the Windows one', () => {
    expect(readFontFamilies(buildFont({ names: [{ platform: 0, nameId: 1, text: 'SimSun' }] })))
      .toEqual(['SimSun'])
  })

  it('reads a CJK family name, because a 公文 font names itself in Chinese too', () => {
    const font = buildFont({
      names: [
        { platform: 3, nameId: 1, text: 'FZXiaoBiaoSong-B05S' },
        { platform: 3, nameId: 1, text: '方正小标宋简体' },
      ],
    })
    expect(readFontFamilies(font)).toEqual(['FZXiaoBiaoSong-B05S', '方正小标宋简体'])
  })

  it('reads the typographic family, which differs from the legacy one for a large family', () => {
    const font = buildFont({ names: [{ platform: 3, nameId: 16, text: 'SimSun' }] })
    expect(readFontFamilies(font)).toEqual(['SimSun'])
  })

  it('returns each name once, however many records carry it', () => {
    const font = buildFont({
      names: [
        { platform: 3, nameId: 1, text: 'SimHei' },
        { platform: 1, nameId: 1, text: 'SimHei' },
        { platform: 3, nameId: 16, text: 'SimHei' },
      ],
    })
    expect(readFontFamilies(font)).toEqual(['SimHei'])
  })

  it('ignores the name IDs that are not the family', () => {
    const font = buildFont({
      names: [
        { platform: 3, nameId: 0, text: 'Copyright notice' },
        { platform: 3, nameId: 4, text: 'FangSong_GB2312 Regular' },
        { platform: 3, nameId: 1, text: 'FangSong_GB2312' },
      ],
    })
    expect(readFontFamilies(font)).toEqual(['FangSong_GB2312'])
  })

  it('skips a record whose platform it cannot decode rather than guessing bytes', () => {
    const font = buildFont({ names: [{ platform: 2, nameId: 1, text: 'Deprecated' }] })
    expect(readFontFamilies(font)).toEqual([])
  })

  it('skips an empty name, which carries no family to match against', () => {
    const font = buildFont({ names: [{ platform: 3, nameId: 1, text: '' }] })
    expect(readFontFamilies(font)).toEqual([])
  })

  it('refuses a CFF font, whose outlines the OOXML embedding path does not take', () => {
    const otto = buildFont({ names: [{ platform: 3, nameId: 1, text: 'Whatever' }], version: 0x4f54544f })
    expect(readFontFamilies(otto)).toEqual([])
  })

  it('refuses an sfnt version that is neither TrueType nor a collection', () => {
    expect(readFontFamilies(buildFont({ names: [{ platform: 3, nameId: 1, text: 'Odd' }], version: 0 })))
      .toEqual([])
  })

  it('reads every face of a collection, so one .ttc can supply several families', () => {
    const collection = buildCollection([windowsFont('SimSun'), windowsFont('NSimSun')])
    expect(readFontFamilies(collection)).toEqual(['SimSun', 'NSimSun'])
  })

  it('returns a family once when two faces of a collection declare it', () => {
    expect(readFontFamilies(buildCollection([windowsFont('SimSun'), windowsFont('SimSun')])))
      .toEqual(['SimSun'])
  })

  it('skips an OTTO face inside a collection while reading the TrueType ones', () => {
    const cff = buildFont({ names: [{ platform: 3, nameId: 1, text: 'CFFFace' }], version: 0x4f54544f })
    expect(readFontFamilies(buildCollection([cff, windowsFont('SimSun')]))).toEqual(['SimSun'])
  })

  it('refuses a collection header whose face offsets run past the end', () => {
    const truncated = new Uint8Array(16)
    const view = new DataView(truncated.buffer)
    view.setUint32(0, 0x74746366)
    view.setUint32(8, 4)
    expect(readFontFamilies(truncated)).toEqual([])
  })

  it('skips a face offset beyond the file rather than reading past it', () => {
    const header = new Uint8Array(16)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x74746366)
    view.setUint32(8, 1)
    view.setUint32(12, 64)
    expect(readFontFamilies(header)).toEqual([])
  })

  it('refuses a file too short to hold an offset table', () => {
    expect(readFontFamilies(new Uint8Array(8))).toEqual([])
  })

  it('refuses a file whose table directory runs past its end', () => {
    const truncated = buildFont({ names: [{ platform: 3, nameId: 1, text: 'SimHei' }] }).subarray(0, 20)
    expect(readFontFamilies(truncated)).toEqual([])
  })

  it('refuses a font with no name table', () => {
    expect(readFontFamilies(buildFont({ fsType: 0 }))).toEqual([])
  })

  it('stops at a name record truncated away, instead of reading past the file', () => {
    const font = buildFont({ names: [{ platform: 3, nameId: 1, text: 'SimHei' }] })
    // Offset table and one directory entry (28 bytes), the name header (6), then 11 of the record's 12.
    expect(readFontFamilies(font.subarray(0, 28 + 6 + 11))).toEqual([])
  })

  it('refuses a font whose name table header itself was truncated away', () => {
    const font = buildFont({ names: [{ platform: 3, nameId: 1, text: 'SimHei' }] })
    // The directory is whole, but the name table's own header is cut to four of its six bytes.
    expect(readFontFamilies(font.subarray(0, 32))).toEqual([])
  })

  it('skips a string whose storage was truncated away', () => {
    const font = buildFont({ names: [{ platform: 3, nameId: 1, text: 'SimHei' }] })
    expect(readFontFamilies(font.subarray(0, font.length - 10))).toEqual([])
  })

  it('skips a UTF-16 string of odd length, which cannot be whole', () => {
    const font = buildFont({ names: [{ platform: 3, nameId: 1, text: 'SimHei' }] })
    // One byte shorter than the two-byte units it claims to hold.
    new DataView(font.buffer, font.byteOffset, font.byteLength).setUint16(12 + 16 + 6 + 8, 11)
    expect(readFontFamilies(font)).toEqual([])
  })
})

describe('readFontEmbedding', () => {
  it('reads Installable, which permits embedding outright', () => {
    expect(readFontEmbedding(windowsFont('FangSong_GB2312', 0x0000))).toBe('installable')
  })

  it('reads Editable, which is what the 小标宋 face carries', () => {
    expect(readFontEmbedding(windowsFont('FZXiaoBiaoSong-B05S', 0x0008))).toBe('editable')
  })

  it('reads Preview & Print', () => {
    expect(readFontEmbedding(windowsFont('Preview', 0x0004))).toBe('preview-print')
  })

  it('reads Restricted, the one permission that forbids embedding', () => {
    expect(readFontEmbedding(windowsFont('Restricted', 0x0002))).toBe('restricted')
  })

  it('treats a font that sets Restricted beside another bit as Restricted', () => {
    expect(readFontEmbedding(windowsFont('Confused', 0x000a))).toBe('restricted')
  })

  it('ignores the bits above the permission, which carry unrelated flags', () => {
    // Bit 8 is NoSubset and bit 9 is bitmap-only; neither withdraws the Editable permission.
    expect(readFontEmbedding(windowsFont('Flagged', 0x0308))).toBe('editable')
  })

  it('treats a font with no OS/2 table as installable, as every reader does', () => {
    const font = buildFont({ names: [{ platform: 3, nameId: 1, text: 'Ancient' }] })
    expect(readFontEmbedding(font)).toBe('installable')
  })

  it('treats a truncated OS/2 table as installable rather than reading past the file', () => {
    const font = windowsFont('Truncated', 0x0002)
    expect(readFontEmbedding(font.subarray(0, font.length - 4))).toBe('installable')
  })

  it('treats a file that is not a font as installable, having no permission to read', () => {
    expect(readFontEmbedding(new Uint8Array(4))).toBe('installable')
  })
})

describe('loadEmbeddableFonts', () => {
  const families = ['FZXiaoBiaoSong-B05S', 'FangSong_GB2312', 'KaiTi_GB2312', 'SimHei']
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-official-document-fonts-'))
    // Deliberately unhelpful file names: the match is on what the font says it is, not on the file.
    await writeFile(join(directory, 'FZXBSJW.TTF'), windowsFont('FZXiaoBiaoSong-B05S', 0x0008))
    await writeFile(join(directory, 'a.ttf'), windowsFont('FangSong_GB2312'))
    await writeFile(join(directory, 'b.ttf'), windowsFont('KaiTi_GB2312'))
    await writeFile(join(directory, 'licensed.ttf'), windowsFont('SimHei', 0x0002))
    await writeFile(join(directory, 'unrelated.ttf'), windowsFont('Helvetica'))
    await writeFile(join(directory, 'readme.txt'), 'not a font')
    await writeFile(join(directory, 'noextension'), windowsFont('FangSong_GB2312'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('matches on the family the font declares, not on its file name', async () => {
    const scan = await loadEmbeddableFonts(directory, families)
    expect(scan.embedded.map(font => font.family))
      .toEqual(['FZXiaoBiaoSong-B05S', 'FangSong_GB2312', 'KaiTi_GB2312'])
  })

  it('refuses a font whose own licence bits forbid embedding, and says which', async () => {
    const scan = await loadEmbeddableFonts(directory, families)
    expect(scan.restricted).toEqual(['SimHei'])
    expect(scan.embedded.map(font => font.family)).not.toContain('SimHei')
  })

  it('gives each font a package entry under Fonts/', async () => {
    const scan = await loadEmbeddableFonts(directory, families)
    expect(scan.embedded.map(font => font.entry)).toEqual([
      'Fonts/FZXiaoBiaoSong-B05S.ttf',
      'Fonts/FangSong_GB2312.ttf',
      'Fonts/KaiTi_GB2312.ttf',
    ])
  })

  it('carries the font file through byte for byte', async () => {
    const scan = await loadEmbeddableFonts(directory, families)
    expect(scan.embedded[1]?.bytes).toEqual(windowsFont('FangSong_GB2312'))
  })

  it('ignores a font the layout never asks for', async () => {
    const scan = await loadEmbeddableFonts(directory, families)
    expect(scan.embedded.map(font => font.family)).not.toContain('Helvetica')
  })

  it('passes over a family the directory does not offer, which is the ordinary case', async () => {
    // SimSun ships with Windows, so a 公文 font directory has no reason to hold it.
    const scan = await loadEmbeddableFonts(directory, ['SimSun'])
    expect(scan.embedded).toEqual([])
    expect(scan.restricted).toEqual([])
  })

  it('reads only .ttf files, so a text file beside the fonts costs nothing', async () => {
    const scan = await loadEmbeddableFonts(directory, families)
    expect(scan.embedded).toHaveLength(3)
  })

  it('refuses a directory it cannot read, rather than writing documents with no fonts in them', async () => {
    await expect(loadEmbeddableFonts(join(directory, 'absent'), families))
      .rejects.toThrow(/cannot read the font directory/)
  })
})

describe('loadEmbeddableFonts with a collection', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-official-document-fonts-ttc-'))
    await writeFile(join(directory, 'simsun.ttc'), buildCollection([
      windowsFont('SimSun'),
      windowsFont('NSimSun', 0x0002),
    ]))
    await writeFile(join(directory, 'broken.ttc'), brokenCollection())
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('embeds one face as a standalone font, not the collection it came from', async () => {
    const scan = await loadEmbeddableFonts(directory, ['SimSun'])
    expect(scan.embedded.map(font => font.entry)).toEqual(['Fonts/SimSun.ttf'])
    const bytes = scan.embedded[0]?.bytes as Uint8Array
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)).toBe(0x00010000)
    expect(readFontFamilies(bytes)).toEqual(['SimSun'])
  })

  it('reads the licence of the face it embeds, so a restricted sibling does not hide it', async () => {
    const scan = await loadEmbeddableFonts(directory, ['SimSun', 'NSimSun'])
    expect(scan.embedded.map(font => font.family)).toEqual(['SimSun'])
    expect(scan.restricted).toEqual(['NSimSun'])
  })

  it('skips a face whose table runs past the end rather than embedding a broken font', async () => {
    const scan = await loadEmbeddableFonts(directory, ['Broken'])
    expect(scan.embedded).toEqual([])
    expect(scan.restricted).toEqual([])
  })

  it('ignores a collection that declares no requested family', async () => {
    const scan = await loadEmbeddableFonts(directory, ['Helvetica'])
    expect(scan.embedded).toEqual([])
    expect(scan.restricted).toEqual([])
  })
})

/**
 * A collection whose single face declares a family but whose second table points past the end of the
 * file, which is a file the reader must refuse to embed rather than copy out broken.
 */
function brokenCollection(): Uint8Array {
  const bytes = buildCollection([windowsFont('Broken')])
  const view = new DataView(bytes.buffer)
  const base = view.getUint32(12)
  // The second table record's offset field; the first holds the readable `name` table.
  view.setUint32(base + 12 + 16 + 8, bytes.length + 8)
  return bytes
}

describe('loadEmbeddableFonts with the typefaces the standard names in Chinese', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-official-document-fonts-cjk-'))
    await writeFile(join(directory, 'a.ttf'), windowsFont('仿宋_GB2312'))
    await writeFile(join(directory, 'b.ttf'), windowsFont('楷体_GB2312'))
    await writeFile(join(directory, 'c.ttf'), windowsFont('黑体'))
    await writeFile(join(directory, 'd.ttf'), windowsFont('宋体'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('gives every family its own entry, including two whose names escape alike', async () => {
    const scan = await loadEmbeddableFonts(directory, ['仿宋_GB2312', '楷体_GB2312', '黑体', '宋体'])
    const entries = scan.embedded.map(font => font.entry)
    expect(entries).toEqual([
      'Fonts/_u4EFF_u5B8B_GB2312.ttf', 'Fonts/_u6977_u4F53_GB2312.ttf',
      'Fonts/_u9ED1_u4F53.ttf', 'Fonts/_u5B8B_u4F53.ttf',
    ])
    // Escaping each character to a bare underscore would put the first two, and the last two, in one
    // entry, so one font would overwrite the other inside the package.
    expect(new Set(entries).size).toBe(entries.length)
  })
})

describe('loadEmbeddableFonts with two files for one family', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-official-document-fonts-dup-'))
    await writeFile(join(directory, 'second.ttf'), buildFont({
      names: [{ platform: 3, nameId: 1, text: 'SimHei' }, { platform: 3, nameId: 16, text: 'Second' }],
      fsType: 0,
    }))
    await writeFile(join(directory, 'first.ttf'), windowsFont('SimHei'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('takes the first file in name order, so the same directory always yields the same bytes', async () => {
    const scan = await loadEmbeddableFonts(directory, ['SimHei'])
    expect(scan.embedded).toHaveLength(1)
    expect(scan.embedded[0]?.bytes).toEqual(windowsFont('SimHei'))
  })
})
