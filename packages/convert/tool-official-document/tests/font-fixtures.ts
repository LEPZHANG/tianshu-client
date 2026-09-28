/**
 * Synthetic sfnt fixtures.
 *
 * The real GB/T 9704—2012 typefaces are commercially licensed and cannot enter this repository, so the
 * tests build fonts instead: an offset table, a `name` table, and an OS/2 table truncated to the
 * `fsType` field. That is the whole of what `src/fonts.ts` reads, so the fixtures drive the real code
 * path — what they cannot show is a genuine 11 MB font surviving into Word, which needs Windows.
 * @module @deepseek-ai/dsh-tool-official-document/tests/font-fixtures
 */

/** One `name` record to write into a fixture. */
interface NameRecord {
  readonly platform: number
  readonly nameId: number
  readonly text: string
}

/** What a fixture font should contain. */
export interface FontSpec {
  readonly names?: readonly NameRecord[]
  /** Omitted leaves the font with no OS/2 table at all. */
  readonly fsType?: number
  /** Defaults to TrueType; `0x4f54544f` is `OTTO`, which carries CFF outlines. */
  readonly version?: number
}

/** Encode one `name` record's string the way its platform stores it. */
function encodeName(record: NameRecord): Uint8Array {
  if (record.platform === 3 || record.platform === 0) {
    const bytes = new Uint8Array(record.text.length * 2)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < record.text.length; index += 1) {
      view.setUint16(index * 2, record.text.charCodeAt(index))
    }
    return bytes
  }
  return Uint8Array.from({ length: record.text.length }, (_, index) => record.text.charCodeAt(index))
}

/**
 * Build a minimal but structurally valid sfnt file.
 * @param spec - the names, permission, and sfnt version the font should declare.
 * @returns the font file's bytes.
 */
export function buildFont(spec: FontSpec = {}): Uint8Array {
  const names = spec.names ?? []
  const strings = names.map(encodeName)
  const storageSize = strings.reduce((total, string) => total + string.length, 0)
  const nameLength = 6 + names.length * 12 + storageSize
  const os2Length = spec.fsType === undefined ? 0 : 10

  const tables = [
    { tag: 'name', length: nameLength },
    ...(spec.fsType === undefined ? [] : [{ tag: 'OS/2', length: os2Length }]),
  ]
  const directoryLength = 12 + tables.length * 16
  const bytes = new Uint8Array(directoryLength + nameLength + os2Length)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, spec.version ?? 0x00010000)
  view.setUint16(4, tables.length)
  let offset = directoryLength
  tables.forEach((table, index) => {
    const record = 12 + index * 16
    for (let byte = 0; byte < 4; byte += 1) view.setUint8(record + byte, table.tag.charCodeAt(byte))
    view.setUint32(record + 8, offset)
    view.setUint32(record + 12, table.length)
    offset += table.length
  })

  const name = directoryLength
  view.setUint16(name + 2, names.length)
  view.setUint16(name + 4, 6 + names.length * 12)
  let stringOffset = 0
  names.forEach((record, index) => {
    const entry = name + 6 + index * 12
    const string = strings[index] as Uint8Array
    view.setUint16(entry, record.platform)
    view.setUint16(entry + 6, record.nameId)
    view.setUint16(entry + 8, string.length)
    view.setUint16(entry + 10, stringOffset)
    bytes.set(string, name + 6 + names.length * 12 + stringOffset)
    stringOffset += string.length
  })

  if (spec.fsType !== undefined) view.setUint16(directoryLength + nameLength + 8, spec.fsType)
  return bytes
}

/**
 * A font naming one family through the Windows platform.
 * @param family - the family name to declare.
 * @param fsType - the OS/2 embedding permission; installable by default.
 * @returns the font file's bytes.
 */
export function windowsFont(family: string, fsType = 0x0000): Uint8Array {
  return buildFont({ names: [{ platform: 3, nameId: 1, text: family }], fsType })
}

/** Bytes needed after a table so the next one starts aligned, as the format requires. */
function padding(length: number): number {
  return (4 - (length % 4)) % 4
}

/**
 * Build a TrueType collection holding the given faces.
 *
 * Each face is laid out after the collection header, and the copy's table offsets are rewritten to be
 * absolute — which is the format's rule for a collection, and the reason a collection's faces cannot
 * simply be concatenated. Two faces share nothing here unless a caller passes the same bytes twice,
 * which is enough for a reader that only walks each face's directory.
 * @param fonts - the faces to include, in order.
 * @returns the collection's bytes.
 */
export function buildCollection(fonts: readonly Uint8Array[]): Uint8Array {
  const header = 12 + fonts.length * 4
  const bytes = new Uint8Array(
    fonts.reduce((total, font) => total + font.length + padding(font.length), header),
  )
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x74746366)
  view.setUint32(4, 0x00010000)
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
    base += font.length + padding(font.length)
  })
  return bytes
}
