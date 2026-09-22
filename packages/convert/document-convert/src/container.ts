/**
 * The little of the ZIP format the seam reads to tell one converted file from another. Six of the
 * thirteen formats are ZIP containers, and their container metadata answers two questions nothing else
 * can: what kind of document a file actually is, and whether a source file is damaged in the one way
 * that makes LibreOffice refuse it outright.
 *
 * Only the central directory and the first local header are parsed, and nothing is decompressed. Entry
 * names are stored uncompressed in both places, which is all the identification here needs.
 * @module @deepseek-ai/dsh-document-convert/container
 */

/** End-of-central-directory signature, the record every ZIP reader starts from. */
const EOCD_SIGNATURE = 0x06054b50

/** Central directory file header signature. */
const CENTRAL_SIGNATURE = 0x02014b50

/** Local file header signature, which also identifies a buffer as a ZIP at all. */
const LOCAL_SIGNATURE = 0x04034b50

/** Fixed size of the EOCD record before its variable-length comment. */
const EOCD_FIXED_SIZE = 22

/** Largest ZIP comment, and so the furthest back from the end the EOCD can begin. */
const MAX_COMMENT_SIZE = 0xffff

/** One entry as the central directory describes it. Sizes and CRC come from the directory, not the data. */
export interface ZipEntry {
  /** The entry's path within the archive, as stored. */
  readonly name: string
  /** The CRC-32 the archive claims for the entry's uncompressed data. */
  readonly crc32: number
  /** Stored (possibly compressed) byte length. */
  readonly compressedSize: number
}

/**
 * Whether a buffer begins with a local file header, the cheap test for "this is a ZIP container".
 * @param bytes - the file's leading bytes.
 * @returns true when the buffer starts with the ZIP local header signature.
 */
export function isZipContainer(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL_SIGNATURE
}

/** Offset of the EOCD record, searching backwards over the largest comment a ZIP may carry. */
function findEndOfCentralDirectory(bytes: Buffer): number {
  const earliest = Math.max(0, bytes.length - EOCD_FIXED_SIZE - MAX_COMMENT_SIZE)
  for (let offset = bytes.length - EOCD_FIXED_SIZE; offset >= earliest; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/**
 * Every entry the central directory lists.
 *
 * @param bytes - the complete archive.
 * @returns the entries in directory order, or `undefined` when the buffer is not a readable ZIP — a
 *   truncated archive, a ZIP64 directory, or a damaged directory all read as unreadable rather than as an
 *   empty archive, because "no entries" and "cannot tell" are different answers to every caller here.
 */
export function readZipEntries(bytes: Buffer): readonly ZipEntry[] | undefined {
  if (!isZipContainer(bytes)) return undefined
  const eocd = findEndOfCentralDirectory(bytes)
  if (eocd === -1) return undefined
  const count = bytes.readUInt16LE(eocd + 10)
  let offset = bytes.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index += 1) {
    // A header that runs past the directory, or does not start with the signature, means the offsets are
    // not describing this file — ZIP64 archives land here, since their real offsets live elsewhere.
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return undefined
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    if (offset + 46 + nameLength > eocd) return undefined
    entries.push({
      name: bytes.toString('utf8', offset + 46, offset + 46 + nameLength),
      crc32: bytes.readUInt32LE(offset + 16),
      compressedSize: bytes.readUInt32LE(offset + 20),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * The media type an OpenDocument container declares.
 *
 * ODF fixes this entry's position: `mimetype` must be the archive's first entry, stored uncompressed and
 * without an extra field, so its value is readable from the leading bytes with no directory walk. That
 * rule is what makes an ODF container self-identifying — the file extension does not, and LibreOffice
 * will write a Writer document under an `.odp` name without complaint.
 *
 * @param bytes - the archive's leading bytes; the first entry is all that is read.
 * @returns the declared media type, or `undefined` when the container does not lead with `mimetype`.
 */
export function readOdfMediaType(bytes: Buffer): string | undefined {
  if (!isZipContainer(bytes) || bytes.length < 30) return undefined
  const compressionMethod = bytes.readUInt16LE(8)
  const compressedSize = bytes.readUInt32LE(18)
  const nameLength = bytes.readUInt16LE(26)
  const extraLength = bytes.readUInt16LE(28)
  if (compressionMethod !== 0) return undefined
  if (bytes.toString('utf8', 30, 30 + nameLength) !== 'mimetype') return undefined
  const start = 30 + nameLength + extraLength
  if (start + compressedSize > bytes.length) return undefined
  return bytes.toString('utf8', start, start + compressedSize).trim()
}

/**
 * Entries whose stored CRC-32 is zero despite holding data.
 *
 * Some producers — notably the re-packing done by chat clients and export tools — write image entries
 * with a zero CRC rather than computing one. Word opens such a file; LibreOffice validates the CRC and
 * refuses the whole document with a generic load failure, so naming the damaged entries is the difference
 * between an unexplained failure and a fixable one.
 *
 * @param entries - the central directory's entries.
 * @returns the names of entries claiming a zero CRC over non-empty data.
 */
export function zeroCrcEntries(entries: readonly ZipEntry[]): readonly string[] {
  return entries.filter(entry => entry.crc32 === 0 && entry.compressedSize > 0).map(entry => entry.name)
}
