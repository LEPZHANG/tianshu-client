import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { dedupeEmbeddedFonts } from '../src/docx-fonts.ts'

/**
 * Every fixture is a synthetic OOXML package holding only the three parts this pass reads: the font
 * table, its relationships, and the font parts those relationships name.
 *
 * An embedded font is stored obfuscated with the key of the slot it sits in, so the fixtures obfuscate
 * too: the whole point of the pass is that two copies of one font are not byte-identical on disk.
 */

const FONT_TABLE = 'word/fontTable.xml'
const FONT_RELS = 'word/_rels/fontTable.xml.rels'

/** Two distinct OOXML font keys, as LibreOffice writes a regular and a bold slot. */
const KEY_REGULAR = '{05014A78-CABC-4EF0-12AC-5CD89AEFDE05}'
const KEY_BOLD = '{06014A78-CABC-4EF0-12AC-5CD89AEFDE06}'

/** Obfuscate a part the way OOXML does: its first 32 bytes XORed with the key, reversed and repeated. */
function obfuscated(body: string, key: string): Uint8Array {
  const bytes = strToU8(body)
  const hex = key.replace(/[{}-]/g, '')
  const keyBytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) {
    keyBytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  for (let index = 0; index < Math.min(32, bytes.length); index += 1) {
    bytes[index] = (bytes[index] as number) ^ (keyBytes[15 - (index % 16)] as number)
  }
  return bytes
}

/** Build a package around a font table, its relationships, and the parts under `word/`. */
function docx(table: string, rels: string, parts: Readonly<Record<string, Uint8Array>> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    [FONT_TABLE]: strToU8(table),
    [FONT_RELS]: strToU8(rels),
    ...Object.fromEntries(Object.entries(parts).map(([path, body]) => [`word/${path}`, body])),
  })
}

/** A relationship element naming a part. */
function relationship(id: string, target: string): string {
  return `<Relationship Id="${id}" Type="font" Target="${target}"/>`
}

/** A font block naming the slots given as `[element, rId, fontKey?]` tuples. */
function font(name: string, slots: readonly (readonly [string, string, string?])[]): string {
  return `<w:font w:name="${name}">`
    + slots.map(([element, id, key]) =>
      `<${element} r:id="${id}"${key === undefined ? '' : ` w:fontKey="${key}"`}/>`).join('')
    + '</w:font>'
}

/** One regular and one bold slot naming `rIdRegular` and `rIdBold` of the same font block. */
function twoSlots(): string {
  return font('FangSong_GB2312', [
    ['w:embedRegular', 'rIdRegular', KEY_REGULAR],
    ['w:embedBold', 'rIdBold', KEY_BOLD],
  ])
}

/** The relationships those two slots name. */
const TWO_SLOT_RELS = '<Relationships>'
  + relationship('rIdRegular', 'fonts/regular.odttf')
  + relationship('rIdBold', 'fonts/bold.odttf')
  + '</Relationships>'

describe('dedupeEmbeddedFonts', () => {
  it('recognises a repeated font stored under its own key, and removes it with its relationship and part', () => {
    const face = 'FANGSONG-REGULAR-FACE'.repeat(2)
    const regular = obfuscated(face, KEY_REGULAR)
    const bold = obfuscated(face, KEY_BOLD)
    // The premise of the whole pass: one font, two slots, two different byte strings on disk.
    expect(regular).not.toEqual(bold)

    const result = dedupeEmbeddedFonts(docx(
      `<w:fonts>${twoSlots()}</w:fonts>`,
      TWO_SLOT_RELS,
      { 'fonts/regular.odttf': regular, 'fonts/bold.odttf': bold },
    ))
    const entries = unzipSync(result)
    expect(strFromU8(entries[FONT_TABLE] as Uint8Array)).not.toContain('embedBold')
    expect(strFromU8(entries[FONT_TABLE] as Uint8Array)).toContain('embedRegular')
    expect(strFromU8(entries[FONT_RELS] as Uint8Array)).not.toContain('rIdBold')
    expect(entries['word/fonts/bold.odttf']).toBeUndefined()
    expect(entries['word/fonts/regular.odttf']).toBeDefined()
    expect(entries['[Content_Types].xml']).toBeDefined()
  })

  it('keeps two families that carry the same font, because each resolves on its own', () => {
    const face = 'ONE-FACE-TWO-FAMILIES'.repeat(2)
    const bytes = docx(
      `<w:fonts>${font('A', [['w:embedRegular', 'rId5', KEY_REGULAR]])}`
      + `${font('B', [['w:embedRegular', 'rId7', KEY_BOLD]])}</w:fonts>`,
      `<Relationships>${relationship('rId5', 'fonts/font5.odttf')}`
      + `${relationship('rId7', 'fonts/font7.odttf')}</Relationships>`,
      { 'fonts/font5.odttf': obfuscated(face, KEY_REGULAR), 'fonts/font7.odttf': obfuscated(face, KEY_BOLD) },
    )
    expect(dedupeEmbeddedFonts(bytes)).toBe(bytes)
  })

  it('keeps a part a surviving relationship still names', () => {
    const result = dedupeEmbeddedFonts(docx(
      `<w:fonts>${font('A', [['w:embedRegular', 'rId5', KEY_REGULAR], ['w:embedItalic', 'rId6', KEY_BOLD]])}</w:fonts>`,
      `<Relationships>${relationship('rId5', 'fonts/font5.odttf')}${relationship('rId6', 'fonts/font5.odttf')}</Relationships>`,
      { 'fonts/font5.odttf': obfuscated('SHARED-PART'.repeat(4), KEY_REGULAR) },
    ))
    const entries = unzipSync(result)
    expect(entries['word/fonts/font5.odttf']).toBeDefined()
    expect(strFromU8(entries[FONT_RELS] as Uint8Array)).not.toContain('rId6')
  })

  it('removes every repeat when a font carries more than two slots', () => {
    const result = dedupeEmbeddedFonts(docx(
      `<w:fonts>${font('A', [
        ['w:embedRegular', 'rId1', KEY_REGULAR], ['w:embedBold', 'rId2', KEY_BOLD],
        ['w:embedItalic', 'rId3', KEY_REGULAR], ['w:embedBoldItalic', 'rId4', KEY_BOLD],
      ])}</w:fonts>`,
      '<Relationships>'
        + relationship('rId1', 'fonts/a.odttf')
        + relationship('rId2', 'fonts/b.odttf')
        + relationship('rId3', 'fonts/c.odttf')
        + relationship('rId4', 'fonts/d.odttf')
        + '</Relationships>',
      // A repeat, a part of the same length but other bytes, and a part of another length.
      {
        'fonts/a.odttf': obfuscated('FONT', KEY_REGULAR),
        'fonts/b.odttf': obfuscated('FONT', KEY_BOLD),
        'fonts/c.odttf': obfuscated('LONG', KEY_REGULAR),
        'fonts/d.odttf': obfuscated('FONTLONG', KEY_BOLD),
      },
    ))
    const entries = unzipSync(result)
    expect(entries['word/fonts/b.odttf']).toBeUndefined()
    expect(entries['word/fonts/a.odttf']).toBeDefined()
    expect(entries['word/fonts/c.odttf']).toBeDefined()
    expect(entries['word/fonts/d.odttf']).toBeDefined()
  })

  it('keeps two parts that agree for the whole obfuscated head but diverge after it', () => {
    const head = 'H'.repeat(32)
    const bytes = docx(
      `<w:fonts>${font('A', [['w:embedRegular', 'rId1'], ['w:embedBold', 'rId2']])}</w:fonts>`,
      `<Relationships>${relationship('rId1', 'fonts/a.odttf')}${relationship('rId2', 'fonts/b.odttf')}</Relationships>`,
      { 'fonts/a.odttf': strToU8(`${head}AAAA`), 'fonts/b.odttf': strToU8(`${head}BBBB`) },
    )
    expect(dedupeEmbeddedFonts(bytes)).toBe(bytes)
  })

  it('treats a slot whose font key does not parse as one that carries no obfuscation', () => {
    const part = strToU8('PLAIN-FONT-BYTES'.repeat(2))
    const result = dedupeEmbeddedFonts(docx(
      `<w:fonts>${font('A', [
        ['w:embedRegular', 'rId1', 'not-a-guid'], ['w:embedBold', 'rId2'],
      ])}</w:fonts>`,
      `<Relationships>${relationship('rId1', 'fonts/a.odttf')}${relationship('rId2', 'fonts/b.odttf')}</Relationships>`,
      { 'fonts/a.odttf': part, 'fonts/b.odttf': part },
    ))
    const entries = unzipSync(result)
    expect(entries['word/fonts/a.odttf']).toBeDefined()
    expect(entries['word/fonts/b.odttf']).toBeUndefined()
  })

  it('returns the input untouched when the package holds no font table', () => {
    const bytes = zipSync({ 'word/document.xml': strToU8('<w:document/>') })
    expect(dedupeEmbeddedFonts(bytes)).toBe(bytes)
  })

  it('returns the input untouched when the font table has no relationships part', () => {
    const bytes = zipSync({ [FONT_TABLE]: strToU8('<w:fonts/>') })
    expect(dedupeEmbeddedFonts(bytes)).toBe(bytes)
  })

  it('returns the input untouched when the table repeats nothing', () => {
    const bytes = docx(
      `<w:fonts>${font('A', [['w:embedRegular', 'rId5', KEY_REGULAR]])}</w:fonts>`,
      `<Relationships>${relationship('rId5', 'fonts/font5.odttf')}</Relationships>`,
      { 'fonts/font5.odttf': obfuscated('ONLY-FACE'.repeat(3), KEY_REGULAR) },
    )
    expect(dedupeEmbeddedFonts(bytes)).toBe(bytes)
  })

  it('passes over a slot whose relationship or part the package does not carry', () => {
    const bytes = docx(
      '<w:fonts><w:font w:name="A">'
        + '<w:embedRegular r:id="rId5" w:fontKey="{0}"/>'
        + '<w:embedBold/>'
        + '<w:embedItalic r:id="rIdUnknown"/>'
        + '</w:font></w:fonts>',
      '<Relationships>'
        + relationship('rId5', 'fonts/gone.odttf')
        + '<Relationship Target="fonts/orphan.odttf"/>'
        + '<Relationship Id="rId9"/>'
        + '</Relationships>',
      { 'fonts/orphan.odttf': strToU8('ORPHAN') },
    )
    expect(dedupeEmbeddedFonts(bytes)).toBe(bytes)
  })
})
