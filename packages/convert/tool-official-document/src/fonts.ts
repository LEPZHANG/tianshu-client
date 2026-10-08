/**
 * Reading typeface files from disk so a document can carry them.
 *
 * GB/T 9704—2012 names its typefaces, and until now the file only asked for them by name. Three of the
 * five are commercially licensed and absent from a stock Windows install, so a reader without them saw
 * substituted glyphs while every conversion step reported success. Embedding the font in the document
 * removes that failure, and this module is what reads the fonts in.
 *
 * Two facts are read out of each file rather than assumed. The family name comes from the font's own
 * `name` table, so the mapping to the `FONT` names in `metrics.ts` is checked against the file instead
 * of trusting a filename. The embedding permission comes from the OS/2 table's `fsType`, because a font whose licence
 * forbids embedding must not be embedded — Word refuses such a file, and the restriction is the font
 * vendor's to set, not this tool's to override.
 *
 * A file may hold several faces: SimSun, one of the families GB/T 9704—2012 names, ships as a `.ttc`
 * collection. The reader selects the face by its own family name and rebuilds it as a standalone font,
 * because a collection written into a document is a font no reader resolves.
 * @module @deepseek-ai/dsh-tool-official-document/fonts
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One typeface, ready to be written into the ODF package. */
export interface EmbeddedFont {
  /** The family name the layout refers to, exactly as `FONT` in `metrics.ts` spells it. */
  readonly family: string
  /** Path of this font's entry inside the ODF package. */
  readonly entry: string
  /** The font bytes the package carries: the file itself, or the selected face rebuilt from a collection. */
  readonly bytes: Uint8Array
}

/** What a font's OS/2 `fsType` permits, reduced to the one distinction that decides embedding. */
export type FontEmbedding = 'installable' | 'editable' | 'preview-print' | 'restricted'

/** What scanning a font directory found. */
export interface FontScan {
  /** The fonts to embed, in the order the requested families were given. */
  readonly embedded: readonly EmbeddedFont[]
  /** Families present in the directory whose own licence bits forbid embedding. */
  readonly restricted: readonly string[]
}

/**
 * sfnt version tags this reader accepts. `OTTO` is excluded deliberately: it carries CFF outlines, and
 * the OOXML embedding path LibreOffice exports into takes TrueType outlines only.
 */
const TRUETYPE_VERSIONS: readonly number[] = [0x00010000, 0x74727565]

/** `name` IDs naming the family: 1 is the legacy family, 16 the typographic family when they differ. */
const FAMILY_NAME_IDS: readonly number[] = [1, 16]

/** Byte offset of `fsType` within the OS/2 table, fixed in every version of it. */
const FS_TYPE_OFFSET = 8

/** The `fsType` bits that carry the permission; the rest are independent flags. */
const FS_TYPE_PERMISSION_MASK = 0x000f

/** File extensions this reader opens. A collection holds several faces in one file; SimSun ships as one. */
const TRUETYPE_EXTENSIONS: readonly string[] = ['.ttf', '.ttc']

/** sfnt version tag opening a TrueType collection, whose faces share one file and its tables. */
const COLLECTION_TAG = 0x74746366

/** The sfnt header and one table record: fixed sizes in every version of the format. */
const SFNT_HEADER_BYTES = 12
const TABLE_RECORD_BYTES = 16

/** Table data is aligned to this many bytes, which a rebuilt table directory must honour. */
const TABLE_ALIGNMENT = 4

/** One table of one face, positioned inside the file that face was read from. */
interface TableRecord {
  readonly tag: string
  readonly offset: number
  readonly length: number
}

/** Round a table length up to the alignment its offset must satisfy. */
function aligned(length: number): number {
  return Math.ceil(length / TABLE_ALIGNMENT) * TABLE_ALIGNMENT
}

/**
 * The offset of every TrueType face in a font file: one for a plain `.ttf`, one per face for a `.ttc`.
 *
 * An `OTTO` face is absent from the result rather than reported, because a face carrying CFF outlines
 * is the one thing this reader cannot pass on — see {@link TRUETYPE_VERSIONS}.
 * @param view - the whole font file.
 * @returns the sfnt header offset of each face this reader accepts.
 */
function trueTypeFaces(view: DataView): readonly number[] {
  if (view.byteLength < SFNT_HEADER_BYTES) return []
  const version = view.getUint32(0)
  if (TRUETYPE_VERSIONS.includes(version)) return [0]
  if (version !== COLLECTION_TAG) return []
  const count = view.getUint32(8)
  if (SFNT_HEADER_BYTES + count * 4 > view.byteLength) return []
  const faces: number[] = []
  for (let index = 0; index < count; index += 1) {
    const face = view.getUint32(SFNT_HEADER_BYTES + index * 4)
    if (face + SFNT_HEADER_BYTES > view.byteLength) continue
    if (TRUETYPE_VERSIONS.includes(view.getUint32(face))) faces.push(face)
  }
  return faces
}

/**
 * Read one face's table directory.
 *
 * Table offsets stay absolute: a collection records them from the start of the file, so a face's
 * records point at the tables wherever the file put them. A plain font's single face sits at offset 0,
 * where absolute and relative are the same thing.
 * @param view - the whole font file.
 * @param base - offset of the face's sfnt header.
 * @returns each table, or undefined when the directory runs past the end of the file.
 */
function faceTables(view: DataView, base: number): readonly TableRecord[] | undefined {
  if (base + SFNT_HEADER_BYTES > view.byteLength) return undefined
  const count = view.getUint16(base + 4)
  const tables: TableRecord[] = []
  for (let index = 0; index < count; index += 1) {
    const record = base + SFNT_HEADER_BYTES + index * TABLE_RECORD_BYTES
    if (record + TABLE_RECORD_BYTES > view.byteLength) return undefined
    let tag = ''
    for (let byte = 0; byte < 4; byte += 1) tag += String.fromCharCode(view.getUint8(record + byte))
    tables.push({ tag, offset: view.getUint32(record + 8), length: view.getUint32(record + 12) })
  }
  return tables
}

/**
 * Decode one `name` record's string.
 *
 * The two encodings that matter are decoded by hand rather than through `TextDecoder`, because
 * `utf-16be` is only available on a Node built with full ICU and a font's family name would otherwise
 * become a deployment-dependent value.
 * @param view - the whole font file.
 * @param platform - the record's platform ID.
 * @param offset - absolute offset of the string.
 * @param length - the string's length in bytes.
 * @returns the decoded name, or undefined for an encoding this reader does not decode.
 */
function decodeName(view: DataView, platform: number, offset: number, length: number): string | undefined {
  if (offset + length > view.byteLength) return undefined
  // Platform 0 (Unicode) and 3 (Windows) both store UTF-16BE; platform 1 (Macintosh) stores one byte
  // per character, and a family name's ASCII range is identical across Mac Roman and Latin-1.
  if (platform === 0 || platform === 3) {
    if (length % 2 !== 0) return undefined
    let text = ''
    for (let index = 0; index < length; index += 2) text += String.fromCharCode(view.getUint16(offset + index))
    return text
  }
  if (platform !== 1) return undefined
  let text = ''
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(view.getUint8(offset + index))
  return text
}

/** One accepted face of a font file, with everything read out of it. */
interface FontFace {
  /** Offset of this face's sfnt header; 0 when the file holds this face alone. */
  readonly base: number
  /** The face's table directory. */
  readonly tables: readonly TableRecord[]
  /** The family names the face declares. */
  readonly families: readonly string[]
}

/** The family names one face's `name` table declares. */
function familiesOf(view: DataView, tables: readonly TableRecord[]): readonly string[] {
  const name = tables.find(table => table.tag === 'name')
  if (name === undefined || name.offset + 6 > view.byteLength) return []
  const count = view.getUint16(name.offset + 2)
  const storage = name.offset + view.getUint16(name.offset + 4)
  const families: string[] = []
  for (let index = 0; index < count; index += 1) {
    const record = name.offset + 6 + index * 12
    if (record + 12 > view.byteLength) break
    if (!FAMILY_NAME_IDS.includes(view.getUint16(record + 6))) continue
    const text = decodeName(
      view,
      view.getUint16(record),
      storage + view.getUint16(record + 10),
      view.getUint16(record + 8),
    )
    if (text !== undefined && text.length > 0 && !families.includes(text)) families.push(text)
  }
  return families
}

/** Every accepted face of a font file, each parsed once. */
function fontFaces(view: DataView): readonly FontFace[] {
  const faces: FontFace[] = []
  for (const base of trueTypeFaces(view)) {
    const tables = faceTables(view, base)
    // A directory running past the end describes no face; the file is not one this reader can use.
    if (tables === undefined) continue
    faces.push({ base, tables, families: familiesOf(view, tables) })
  }
  return faces
}

/**
 * Read the family names a font answers to.
 *
 * A font carries the same family under several platform/encoding records, and a CJK font commonly adds
 * a localized Chinese name beside the Western one. All of them are returned, so a caller matching
 * against a known family finds it whichever record holds it. Every face of a collection contributes,
 * so one `.ttc` file can supply several of the families a document needs.
 * @param bytes - the font file.
 * @returns every distinct family name in the file, or an empty array when no accepted face declares one.
 */
export function readFontFamilies(bytes: Uint8Array): readonly string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const families: string[] = []
  for (const face of fontFaces(view)) {
    for (const family of face.families) {
      if (!families.includes(family)) families.push(family)
    }
  }
  return families
}

/**
 * Rebuild one face of a collection as a standalone font.
 *
 * The header and the table records are copied, then each record's offset is rewritten to where that
 * table lands in the new file. Table checksums are copied unchanged because the table bytes are;
 * `head.checkSumAdjustment` keeps the source's value, which is stale by the new layout and verified by
 * none of the readers this output reaches.
 * @param view - the whole collection.
 * @param base - offset of the face's sfnt header.
 * @param tables - the face's table directory.
 * @returns the single-face font bytes, or undefined when a table runs past the end of the file.
 */
function rebuildFace(view: DataView, base: number, tables: readonly TableRecord[]): Uint8Array | undefined {
  const directory = SFNT_HEADER_BYTES + tables.length * TABLE_RECORD_BYTES
  let total = directory
  for (const table of tables) {
    if (table.offset + table.length > view.byteLength) return undefined
    total += aligned(table.length)
  }

  const bytes = new Uint8Array(total)
  const out = new DataView(bytes.buffer)
  for (let byte = 0; byte < SFNT_HEADER_BYTES; byte += 1) out.setUint8(byte, view.getUint8(base + byte))
  let offset = directory
  tables.forEach((table, index) => {
    const record = SFNT_HEADER_BYTES + index * TABLE_RECORD_BYTES
    const source = base + SFNT_HEADER_BYTES + index * TABLE_RECORD_BYTES
    for (let byte = 0; byte < TABLE_RECORD_BYTES; byte += 1) out.setUint8(record + byte, view.getUint8(source + byte))
    out.setUint32(record + 8, offset)
    bytes.set(new Uint8Array(view.buffer, view.byteOffset + table.offset, table.length), offset)
    offset += aligned(table.length)
  })
  return bytes
}

/**
 * The bytes to embed for one face.
 *
 * A collection cannot be embedded as it stands: the OOXML embedding path takes a single TrueType face,
 * and a `ttcf` file written into a document is a font neither Word nor LibreOffice resolves. A face the
 * file already holds alone is passed through untouched, so a plain `.ttf` costs no copy.
 * @param view - the file the face was read from.
 * @param face - the parsed face.
 * @param source - that file's bytes.
 * @returns the single-face font bytes, or undefined when one of its tables runs past the file's end.
 */
function faceBytes(view: DataView, face: FontFace, source: Uint8Array): Uint8Array | undefined {
  return face.base === 0 ? source : rebuildFace(view, face.base, face.tables)
}

/**
 * Read what the font's licence bits permit.
 *
 * A font with no OS/2 table predates the permission scheme and is treated as installable, which is how
 * every reader treats it.
 * @param bytes - one face's bytes, as {@link extractFontFace} returns them.
 * @returns the permission `fsType` records.
 */
export function readFontEmbedding(bytes: Uint8Array): FontEmbedding {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const os2 = faceTables(view, 0)?.find(table => table.tag === 'OS/2')
  if (os2 === undefined || os2.offset + FS_TYPE_OFFSET + 2 > view.byteLength) return 'installable'
  const permission = view.getUint16(os2.offset + FS_TYPE_OFFSET) & FS_TYPE_PERMISSION_MASK
  // Bit 1 is exclusive of the others by the specification, and a font that sets it alongside another
  // is still refusing embedding, so it is tested before the permissive values.
  if ((permission & 0x0002) !== 0) return 'restricted'
  if ((permission & 0x0008) !== 0) return 'editable'
  if ((permission & 0x0004) !== 0) return 'preview-print'
  return 'installable'
}

/** The ODF package directory embedded fonts live in. */
const FONT_ENTRY_DIRECTORY = 'Fonts'

/**
 * The package entry for a family.
 *
 * ZIP entry names are compared byte-for-byte by readers, so a family outside ASCII is escaped rather
 * than written through: a character becomes `_u<code point>`, which is injective. Replacing every such
 * character with a bare `_` instead would give 仿宋_GB2312 and 楷体_GB2312 one entry, and 黑体 and 宋体
 * another, so one font would silently overwrite the other inside the package.
 * @param family - the family name.
 * @returns the entry path inside the ODF package.
 */
function fontEntry(family: string): string {
  const name = family.replace(
    /[^A-Za-z0-9._-]/gu,
    character => `_u${(character.codePointAt(0) as number).toString(16).toUpperCase()}`,
  )
  return `${FONT_ENTRY_DIRECTORY}/${name}.ttf`
}

/**
 * Read the fonts a document should embed out of one directory.
 *
 * A directory that cannot be read throws: it is a configured referent, and silently producing documents
 * with no embedded fonts is the failure this whole mechanism exists to remove. A family the directory
 * simply does not offer is not an error — 黑体 and 宋体 may be left to the reader's machine, and a build
 * packaged with `--allow-missing-fonts` has none of them.
 *
 * A `.ttc` collection is accepted, and the face declaring a requested family is embedded as a
 * standalone font rather than the collection itself.
 *
 * @param directory - the directory to scan, non-recursively.
 * @param families - the family names to look for, in the order they should be embedded.
 * @returns the fonts found, and the families a licence refused.
 */
export async function loadEmbeddableFonts(
  directory: string,
  families: readonly string[],
): Promise<FontScan> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (cause) {
    throw new Error(
      `tool-official-document: cannot read the font directory "${directory}". Point fontDirectory at the `
      + 'directory holding the GB/T 9704—2012 typefaces, or leave it unset to write documents that name '
      + 'the typefaces without carrying them.',
      { cause },
    )
  }

  const found = new Map<string, Uint8Array>()
  const restricted = new Set<string>()
  // Sorted so two directories with the same fonts under different names resolve identically.
  for (const entry of [...entries].sort()) {
    if (!TRUETYPE_EXTENSIONS.includes(extensionOf(entry))) continue
    const source = new Uint8Array(await readFile(join(directory, entry)))
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
    for (const face of fontFaces(view)) {
      const matched = face.families.filter(family => families.includes(family))
      if (matched.length === 0) continue
      const bytes = faceBytes(view, face, source)
      // A table running past the file's end leaves nothing sound to embed; the other faces still can be.
      if (bytes === undefined) continue
      const embedding = readFontEmbedding(bytes)
      for (const family of matched) {
        if (embedding === 'restricted') {
          restricted.add(family)
          continue
        }
        // First file wins, so a directory holding two files for one family stays deterministic.
        if (!found.has(family)) found.set(family, bytes)
      }
    }
  }

  return {
    embedded: families.flatMap((family) => {
      const bytes = found.get(family)
      return bytes === undefined ? [] : [{ family, entry: fontEntry(family), bytes }]
    }),
    restricted: [...restricted],
  }
}

/**
 * A file name's lowercased extension.
 * @param name - the file name.
 * @returns the extension including its dot, or an empty string when the name has none.
 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}
