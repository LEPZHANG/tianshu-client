/**
 * Smallest files that are genuinely of each document format, for tests whose subject is the conversion
 * machinery rather than a converter.
 *
 * The seam checks every step's result against its target format, so a test provider that writes the word
 * "converted" into a file named `.docx` is now refused — correctly, and for the same reason a real
 * converter writing nothing is refused. These fixtures satisfy that check without pulling in a document
 * library: each one carries exactly the marker its format is identified by.
 * @module @deepseek-ai/dsh-document-convert/tests/fixtures
 */

import { crc32 } from 'node:zlib'
import type { DocumentFormat } from '@deepseek-ai/dsh-document-convert'

/** One member of a fixture archive. */
export interface ZipMember {
  /** Path within the archive. */
  readonly name: string
  /** Stored bytes; fixtures never compress, so this is also the entry's uncompressed data. */
  readonly data: Buffer
  /** CRC-32 to claim, overriding the real one — how a damaged-container fixture is built. */
  readonly crc?: number
}

/** DOS timestamp every fixture entry carries, so a fixture's bytes do not depend on when it was built. */
const FIXED_DOS_TIME = 0

/**
 * Build a ZIP whose entries are all stored uncompressed, which is all these fixtures need.
 * @param members - the entries, in the order they are written.
 * @returns the complete archive.
 */
export function storedZip(members: readonly ZipMember[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8')
    const checksum = member.crc ?? crc32(member.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(FIXED_DOS_TIME, 10)
    local.writeUInt16LE(FIXED_DOS_TIME, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(member.data.length, 18)
    local.writeUInt32LE(member.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, member.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(FIXED_DOS_TIME, 12)
    central.writeUInt16LE(FIXED_DOS_TIME, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(member.data.length, 20)
    central.writeUInt32LE(member.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + member.data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(members.length, 8)
  end.writeUInt16LE(members.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** An OOXML container holding only the part its format is recognized by. */
function ooxml(part: string): Buffer {
  return storedZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>', 'utf8') },
    { name: part, data: Buffer.from('<document/>', 'utf8') },
  ])
}

/** An ODF container leading with the `mimetype` entry the format requires. */
function odf(mediaType: string): Buffer {
  return storedZip([
    { name: 'mimetype', data: Buffer.from(mediaType, 'utf8') },
    { name: 'content.xml', data: Buffer.from('<document/>', 'utf8') },
  ])
}

/** The compound-file header the three Office 97 formats share. */
const OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/** The Office 97 formats carry no format marker beyond the shared header, padded to a plausible size. */
const OLE_FILE = Buffer.concat([OLE_HEADER, Buffer.alloc(504)])

const FIXTURES: Readonly<Record<DocumentFormat, () => Buffer>> = {
  pdf: () => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n', 'utf8'),
  doc: () => OLE_FILE,
  xls: () => OLE_FILE,
  ppt: () => OLE_FILE,
  docx: () => ooxml('word/document.xml'),
  xlsx: () => ooxml('xl/workbook.xml'),
  pptx: () => ooxml('ppt/presentation.xml'),
  odt: () => odf('application/vnd.oasis.opendocument.text'),
  ods: () => odf('application/vnd.oasis.opendocument.spreadsheet'),
  odp: () => odf('application/vnd.oasis.opendocument.presentation'),
  rtf: () => Buffer.from('{\\rtf1\\ansi converted}', 'utf8'),
  txt: () => Buffer.from('converted\n', 'utf8'),
  html: () => Buffer.from('<html><body><p>converted</p></body></html>', 'utf8'),
}

/**
 * The smallest file that is genuinely of one format.
 * @param format - the format to produce.
 * @returns bytes that pass the seam's output check for that format.
 */
export function documentFixture(format: DocumentFormat): Buffer {
  return FIXTURES[format]()
}

/**
 * A `docx` whose image entry claims no checksum — the damage Word ignores and LibreOffice refuses.
 * @returns a readable container carrying one zero-CRC entry.
 */
export function zeroCrcDocx(): Buffer {
  return storedZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from('<document/>', 'utf8') },
    { name: 'word/media/image1.png', data: Buffer.from('not really a png', 'utf8'), crc: 0 },
  ])
}
