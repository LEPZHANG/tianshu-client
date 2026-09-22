import { describe, expect, it } from 'vitest'
import { isZipContainer, readOdfMediaType, readZipEntries, zeroCrcEntries } from '@deepseek-ai/dsh-document-convert'
import { documentFixture, storedZip, zeroCrcDocx } from './fixtures.ts'

/**
 * The ZIP reading the seam does for itself. What matters in every case below is that a container it
 * cannot read is reported as unreadable rather than as an empty archive: "no entries" would let a
 * truncated or ZIP64 file pass every check built on top of this.
 */

/** The EOCD begins 22 bytes from the end of an archive carrying no comment, as every fixture does. */
function endOfCentralDirectory(archive: Buffer): number {
  return archive.length - 22
}

/** Where the central directory starts, as the archive's own EOCD record says. */
function centralDirectoryOffset(archive: Buffer): number {
  return archive.readUInt32LE(endOfCentralDirectory(archive) + 16)
}

describe('isZipContainer', () => {
  it('accepts a file beginning with a local file header', () => {
    expect(isZipContainer(documentFixture('docx'))).toBe(true)
  })

  it('rejects a file of another kind', () => {
    expect(isZipContainer(documentFixture('pdf'))).toBe(false)
  })

  it('rejects a file too short to carry a signature at all', () => {
    expect(isZipContainer(Buffer.from([0x50, 0x4b]))).toBe(false)
  })
})

describe('readZipEntries', () => {
  it('lists every entry the central directory describes, in order', () => {
    expect(readZipEntries(documentFixture('docx'))?.map(entry => entry.name))
      .toEqual(['[Content_Types].xml', 'word/document.xml'])
  })

  it('reports the size and checksum the directory claims, not the ones the data would give', () => {
    const entries = readZipEntries(zeroCrcDocx())
    expect(entries?.find(entry => entry.name === 'word/media/image1.png'))
      .toEqual({ name: 'word/media/image1.png', crc32: 0, compressedSize: 'not really a png'.length })
  })

  it('walks past each header to the next, so a later entry is read as accurately as the first', () => {
    const archive = storedZip([
      { name: 'first.xml', data: Buffer.from('<a/>', 'utf8') },
      { name: 'second.xml', data: Buffer.from('<b/>', 'utf8') },
    ])
    expect(readZipEntries(archive)?.map(entry => entry.name)).toEqual(['first.xml', 'second.xml'])
  })

  it('refuses a file that is not a container', () => {
    expect(readZipEntries(documentFixture('rtf'))).toBeUndefined()
  })

  it('refuses a container with no end-of-directory record, which is a truncated archive', () => {
    expect(readZipEntries(documentFixture('docx').subarray(0, 40))).toBeUndefined()
  })

  it('refuses a directory whose offset points at no central header, as a ZIP64 archive does', () => {
    const archive = Buffer.from(documentFixture('docx'))
    archive.writeUInt32LE(0, endOfCentralDirectory(archive) + 16)
    expect(readZipEntries(archive)).toBeUndefined()
  })

  it('refuses a header that would run past the directory it belongs to', () => {
    const archive = Buffer.from(documentFixture('docx'))
    archive.writeUInt32LE(endOfCentralDirectory(archive) - 10, endOfCentralDirectory(archive) + 16)
    expect(readZipEntries(archive)).toBeUndefined()
  })

  it('refuses a header claiming a name longer than the directory holding it', () => {
    const archive = Buffer.from(documentFixture('docx'))
    archive.writeUInt16LE(0xffff, centralDirectoryOffset(archive) + 28)
    expect(readZipEntries(archive)).toBeUndefined()
  })
})

describe('readOdfMediaType', () => {
  it('reads the media type an OpenDocument container leads with', () => {
    expect(readOdfMediaType(documentFixture('odp'))).toBe('application/vnd.oasis.opendocument.presentation')
  })

  it('refuses a file that is not a container', () => {
    expect(readOdfMediaType(documentFixture('txt'))).toBeUndefined()
  })

  it('refuses a file too short to hold a local header', () => {
    expect(readOdfMediaType(documentFixture('odt').subarray(0, 20))).toBeUndefined()
  })

  it('refuses a container whose first entry is something else, as every OOXML file has', () => {
    expect(readOdfMediaType(documentFixture('docx'))).toBeUndefined()
  })

  it('refuses a compressed first entry, which ODF forbids for this one', () => {
    const archive = Buffer.from(documentFixture('ods'))
    archive.writeUInt16LE(8, 8)
    expect(readOdfMediaType(archive)).toBeUndefined()
  })

  it('refuses an entry whose declared size runs past the end of the file', () => {
    const archive = Buffer.from(documentFixture('ods'))
    archive.writeUInt32LE(0xffff, 18)
    expect(readOdfMediaType(archive)).toBeUndefined()
  })
})

describe('zeroCrcEntries', () => {
  it('names the entries claiming no checksum over data they do hold', () => {
    expect(zeroCrcEntries(readZipEntries(zeroCrcDocx()) ?? [])).toEqual(['word/media/image1.png'])
  })

  it('passes over an entry that is genuinely empty, whose checksum is zero because it has no data', () => {
    const archive = storedZip([
      { name: 'mimetype', data: Buffer.alloc(0) },
      { name: 'content.xml', data: Buffer.from('<a/>', 'utf8') },
    ])
    expect(zeroCrcEntries(readZipEntries(archive) ?? [])).toEqual([])
  })
})
