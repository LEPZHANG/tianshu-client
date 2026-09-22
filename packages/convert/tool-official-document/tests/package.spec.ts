import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildOdtPackage, ODT_MIMETYPE } from '../src/package.ts'
import type { OfficialDocument } from '../src/types.ts'

/**
 * OpenDocument fixes two things about the ZIP container beyond ordinary ZIP, and both are checked against
 * the raw bytes rather than through a reader, because a reader that tolerates a compressed `mimetype` would
 * hide exactly the defect these cases exist to catch.
 */

const document: OfficialDocument = {
  header: { docNumber: '国办发〔2026〕3号' },
  body: { title: '关于××的通知', paragraphs: [{ text: '正文' }] },
  colophon: {},
}

const bytes = buildOdtPackage(document)

/** The bytes at an offset, as Latin-1 text — the encoding a ZIP local header's fixed fields use. */
function ascii(start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

/** A little-endian unsigned integer of `length` bytes at `start`. */
function integer(start: number, length: number): number {
  let value = 0
  for (let index = length - 1; index >= 0; index -= 1) value = value * 256 + (bytes[start + index] as number)
  return value
}

describe('the ODF package', () => {
  it('opens with a ZIP local file header', () => {
    expect(ascii(0, 4)).toBe('PK')
  })

  it('puts mimetype first, so a reader identifies the file from its first bytes', () => {
    expect(integer(26, 2)).toBe('mimetype'.length)
    expect(ascii(30, 'mimetype'.length)).toBe('mimetype')
  })

  it('stores mimetype uncompressed and inline, as OpenDocument requires', () => {
    // Compression method 0 is STORED; the media type then follows the name verbatim.
    expect(integer(8, 2)).toBe(0)
    expect(ascii(38, ODT_MIMETYPE.length)).toBe(ODT_MIMETYPE)
    expect(integer(18, 4)).toBe(ODT_MIMETYPE.length)
  })

  it('compresses the XML parts, which are large and repetitive', () => {
    const unzipped = unzipSync(bytes)
    const parts = Object.values(unzipped).reduce((total, part) => total + part.length, 0)
    expect(bytes.length).toBeLessThan(parts)
  })

  it('carries the four parts a reader needs and nothing else', () => {
    expect(Object.keys(unzipSync(bytes)).sort())
      .toEqual(['META-INF/manifest.xml', 'content.xml', 'mimetype', 'styles.xml'])
  })

  it('lists every part in the manifest, under the package\'s own media type', () => {
    const manifest = strFromU8(unzipSync(bytes)['META-INF/manifest.xml'] as Uint8Array)
    expect(manifest).toContain(`manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIMETYPE}"`)
    expect(manifest).toContain('manifest:full-path="content.xml" manifest:media-type="text/xml"')
    expect(manifest).toContain('manifest:full-path="styles.xml" manifest:media-type="text/xml"')
  })

  it('writes the same bytes for the same document, so a snapshot can compare them', () => {
    expect(buildOdtPackage(document)).toEqual(bytes)
  })

  it('carries the document\'s own content and the fixed styles', () => {
    const unzipped = unzipSync(bytes)
    expect(strFromU8(unzipped['content.xml'] as Uint8Array)).toContain('关于××的通知')
    expect(strFromU8(unzipped['styles.xml'] as Uint8Array)).toContain('fo:page-width="210mm"')
  })
})
