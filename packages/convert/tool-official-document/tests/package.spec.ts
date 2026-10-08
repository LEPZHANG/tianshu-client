import { unzipSync, strFromU8, strToU8 } from 'fflate'
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

/**
 * A package that carries its typefaces. The font bytes are never parsed by the packager, so an
 * identifiable filler stands in for the real 11 MB file; `fonts.spec.ts` covers the reading that
 * produces a real one.
 */
const fonts = [
  { family: '仿宋_GB2312', entry: 'Fonts/_u4EFF_u5B8B_GB2312.ttf', bytes: strToU8('fangsong-bytes') },
  { family: '黑体', entry: 'Fonts/_u9ED1_u4F53.ttf', bytes: strToU8('simhei-bytes') },
]

const embedded = buildOdtPackage(document, fonts)

describe('an ODF package carrying its typefaces', () => {
  it('writes each font as its own part', () => {
    const unzipped = unzipSync(embedded)
    expect(strFromU8(unzipped['Fonts/_u4EFF_u5B8B_GB2312.ttf'] as Uint8Array)).toBe('fangsong-bytes')
    expect(strFromU8(unzipped['Fonts/_u9ED1_u4F53.ttf'] as Uint8Array)).toBe('simhei-bytes')
  })

  it('turns embedding on in settings.xml, without which the font parts are dead weight', () => {
    const settings = strFromU8(unzipSync(embedded)['settings.xml'] as Uint8Array)
    expect(settings).toContain('config:name="EmbedFonts" config:type="boolean">true<')
  })

  it('lists the fonts and the settings in the manifest', () => {
    const manifest = strFromU8(unzipSync(embedded)['META-INF/manifest.xml'] as Uint8Array)
    expect(manifest)
      .toContain('manifest:full-path="Fonts/_u4EFF_u5B8B_GB2312.ttf" manifest:media-type="application/x-font-ttf"')
    expect(manifest).toContain('manifest:full-path="settings.xml" manifest:media-type="text/xml"')
  })

  it('points each declared family at the font file this package holds', () => {
    const styles = strFromU8(unzipSync(embedded)['styles.xml'] as Uint8Array)
    expect(styles).toContain('<svg:font-face-uri xlink:href="Fonts/_u4EFF_u5B8B_GB2312.ttf"')
  })

  it('keeps mimetype first and stored, which embedding must not disturb', () => {
    const name = 'mimetype'
    expect(String.fromCharCode(...embedded.subarray(30, 30 + name.length))).toBe(name)
    expect(embedded[8]).toBe(0)
  })

  it('leaves a package with no fonts byte-for-byte as it was before embedding existed', () => {
    // The two namespaces an embedded font needs are declared only where one is declared, so an
    // unconfigured deployment writes the same file it always did.
    expect(buildOdtPackage(document, [])).toEqual(bytes)
    expect(Object.keys(unzipSync(bytes))).not.toContain('settings.xml')
  })
})
