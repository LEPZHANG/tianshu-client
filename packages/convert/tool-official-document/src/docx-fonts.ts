/**
 * Removing the font parts an OOXML export repeats.
 *
 * `w:embedTrueTypeFonts` makes LibreOffice embed every face a document uses. A CJK family that has only
 * a regular face gets two slots — `w:embedRegular` and `w:embedBold` — carrying the same font, so a
 * document with three typefaces carries them twice: measured at 15.8 MB for one page of a 公文 against
 * 8 MB once the repeats are gone. Word synthesizes the bold face from the regular one when no distinct
 * bold file is present, so removing the repeat changes no rendering.
 *
 * The two copies are not byte-identical on disk. OOXML obfuscates an embedded font's first 32 bytes
 * with the `w:fontKey` of the slot it sits in, and each slot has its own key, so the repeat is
 * recognised only by comparing through those keys — which is what {@link sameFont} does.
 *
 * Only a repeat of another part **inside the same `<w:font>`** is removed. Two families that carry the
 * same font are both kept: a reader resolves each family separately, and dropping one would lose that
 * family's embedding outright.
 * @module @deepseek-ai/dsh-tool-official-document/docx-fonts
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

/** The part holding the OOXML font table, which names every embedded face. */
const FONT_TABLE = 'word/fontTable.xml'

/** The part holding that table's relationships, which resolve each `r:id` to a font file. */
const FONT_RELS = 'word/_rels/fontTable.xml.rels'

/** Prefix of every part a font table's relationship can name. */
const PART_PREFIX = 'word/'

/** Compression level for the rebuilt package; the original export's own level is not recorded in it. */
const COMPRESSION_LEVEL = 6

/** Bytes of an OOXML font key: the obfuscation XORs the file's first bytes with these, reversed. */
const FONT_KEY_BYTES = 16

/** The leading stretch of an embedded font that differs from the plain font. */
const OBFUSCATED_HEAD_BYTES = 32

/** One `<w:embed*>` element: how it is written, the relationship it names, and the part that resolves to. */
interface FontSlot {
  readonly element: string
  readonly id: string
  readonly target: string
  readonly bytes: Uint8Array
  readonly key: Uint8Array | undefined
}

/** An attribute's value in one XML element, or undefined when the element omits it. */
function attribute(element: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(element)?.[1]
}

/**
 * A `w:fontKey` as the bytes its obfuscation XORs with.
 * @param key - the attribute value, a braced GUID.
 * @returns its 16 bytes, or undefined when the value is absent or not a GUID.
 */
function fontKeyBytes(key: string | undefined): Uint8Array | undefined {
  if (key === undefined) return undefined
  const hex = key.replace(/[{}-]/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) return undefined
  const bytes = new Uint8Array(FONT_KEY_BYTES)
  for (let index = 0; index < FONT_KEY_BYTES; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/**
 * The plain form of a part's first bytes, which is the only stretch OOXML obfuscates.
 * @param bytes - the stored part.
 * @param key - the key it was obfuscated with, or undefined when it carries none.
 * @returns a copy of the head, de-obfuscated.
 */
function plainHead(bytes: Uint8Array, key: Uint8Array | undefined): Uint8Array {
  const head = bytes.slice(0, OBFUSCATED_HEAD_BYTES)
  if (key === undefined) return head
  for (let index = 0; index < head.length; index += 1) {
    // The key applies from its last byte backwards, repeating over the 32-byte head.
    head[index] = (head[index] as number) ^ (key[FONT_KEY_BYTES - 1 - (index % FONT_KEY_BYTES)] as number)
  }
  return head
}

/**
 * Whether two slots carry the same font.
 *
 * Two slots naming one part are the same font outright. Otherwise the heads are compared through their
 * own keys and the rest directly, so two copies stored under different keys are still recognised as one
 * font, and two genuinely different faces are not.
 * @param left - one embedded slot.
 * @param right - the slot to compare it with.
 * @returns true when both carry the same font.
 */
function sameFont(left: FontSlot, right: FontSlot): boolean {
  if (left.target === right.target) return true
  if (left.bytes.length !== right.bytes.length) return false
  const head = plainHead(left.bytes, left.key)
  const other = plainHead(right.bytes, right.key)
  for (let index = 0; index < head.length; index += 1) {
    if (head[index] !== other[index]) return false
  }
  for (let index = OBFUSCATED_HEAD_BYTES; index < left.bytes.length; index += 1) {
    if (left.bytes[index] !== right.bytes[index]) return false
  }
  return true
}

/**
 * Parse a relationships part into `r:id` → package part path.
 * @param xml - the relationships part's text.
 * @returns one entry per relationship that names both an id and a target.
 */
function relationships(xml: string): ReadonlyMap<string, string> {
  const rels = new Map<string, string>()
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const element = match[0]
    const id = attribute(element, 'Id')
    const target = attribute(element, 'Target')
    if (id !== undefined && target !== undefined) rels.set(id, target)
  }
  return rels
}

/**
 * The embedded fonts one `<w:font>` segment names, in the order the segment writes them.
 * @param segment - the segment's XML, from its `<w:font>` up to the next font's.
 * @param rels - the font table's relationships.
 * @param entries - the package's parts, which each relationship's target resolves against.
 * @returns one slot per embed element whose relationship and part the package carries.
 */
function fontSlots(
  segment: string,
  rels: ReadonlyMap<string, string>,
  entries: Readonly<Record<string, Uint8Array>>,
): readonly FontSlot[] {
  const slots: FontSlot[] = []
  for (const match of segment.matchAll(/<w:embed\w+\b[^>]*\/>/g)) {
    const element = match[0]
    const id = attribute(element, 'r:id')
    const target = id === undefined ? undefined : rels.get(id)
    const bytes = target === undefined ? undefined : entries[`${PART_PREFIX}${target}`]
    if (id !== undefined && target !== undefined && bytes !== undefined) {
      slots.push({ element, id, target, bytes, key: fontKeyBytes(attribute(element, 'w:fontKey')) })
    }
  }
  return slots
}

/**
 * Remove the font parts one converted document repeats.
 *
 * The font table is walked one `<w:font>` at a time, and within each of them the first occurrence of a
 * font is kept while later ones — and their relationships — are dropped. Parts are deleted only when no
 * surviving relationship still names them.
 *
 * @param bytes - the converted OOXML file.
 * @returns the file with its repeated font parts removed, or `bytes` itself when it repeats none.
 */
export function dedupeEmbeddedFonts(bytes: Uint8Array): Uint8Array {
  const entries = unzipSync(bytes)
  const tablePart = entries[FONT_TABLE]
  const relsPart = entries[FONT_RELS]
  if (tablePart === undefined || relsPart === undefined) return bytes

  const rels = relationships(strFromU8(relsPart))
  const dropped = new Set<string>()
  // Split before each font block, so a part repeated across two families is never merged into one.
  const segments = strFromU8(tablePart).split(/(?=<w:font\b)/)
  const table = segments.map((segment, index) => {
    if (index === 0) return segment
    const kept: FontSlot[] = []
    let output = segment
    for (const slot of fontSlots(segment, rels, entries)) {
      if (kept.some(other => sameFont(other, slot))) {
        output = output.replace(slot.element, '')
        dropped.add(slot.id)
        continue
      }
      kept.push(slot)
    }
    return output
  }).join('')

  if (dropped.size === 0) return bytes

  const survivors = new Set([...rels].filter(([id]) => !dropped.has(id)).map(([, target]) => target))
  for (const id of dropped) {
    const target = rels.get(id) as string
    if (!survivors.has(target)) delete entries[`${PART_PREFIX}${target}`]
  }
  const survivorsXml = strFromU8(relsPart).replace(/<Relationship\b[^>]*\/>/g, (element) => {
    const id = attribute(element, 'Id')
    return id !== undefined && dropped.has(id) ? '' : element
  })
  entries[FONT_TABLE] = strToU8(table)
  entries[FONT_RELS] = strToU8(survivorsXml)
  return zipSync(entries, { level: COMPRESSION_LEVEL })
}
