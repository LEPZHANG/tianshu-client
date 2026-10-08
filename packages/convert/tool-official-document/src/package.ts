/**
 * The ODF package: the ZIP container an `.odt` file is.
 *
 * OpenDocument fixes two things about that container beyond ordinary ZIP — `mimetype` must be the first
 * entry and must be stored uncompressed, so a reader can identify the file from its first bytes without
 * inflating anything. Both are enforced here, and a test reads the raw bytes back to prove it.
 * @module @deepseek-ai/dsh-tool-official-document/package
 */

import { strToU8, zipSync } from 'fflate'
import { buildContent } from './content.ts'
import type { EmbeddedFont } from './fonts.ts'
import { buildStyles, XML_DECLARATION } from './odf.ts'
import type { OfficialDocument } from './types.ts'

/** The media type of an OpenDocument text document. */
export const ODT_MIMETYPE = 'application/vnd.oasis.opendocument.text'

/** The media type an ODF manifest gives an embedded TrueType font. */
const TRUETYPE_MEDIA_TYPE = 'application/x-font-ttf'

/**
 * A fixed modification time for every entry, so the same document always produces the same bytes and a
 * snapshot can compare them. 1980-01-01 UTC is the earliest instant a ZIP entry can record.
 */
const FIXED_MTIME = Date.UTC(1980, 0, 1)

/** Entries written without compression, as OpenDocument requires of `mimetype`. */
const STORED = { level: 0, mtime: FIXED_MTIME } as const

/** Entries written compressed; the XML parts are large and highly repetitive. */
const DEFLATED = { level: 6, mtime: FIXED_MTIME } as const

/** `META-INF/manifest.xml`, which lists every part of the package and the package's own media type. */
function manifest(fonts: readonly EmbeddedFont[]): string {
  const entry = (path: string, mediaType: string): string =>
    `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${mediaType}"/>`
  return `${XML_DECLARATION}<manifest:manifest`
    + ' xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">'
    + `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIMETYPE}"/>`
    + entry('content.xml', 'text/xml')
    + entry('styles.xml', 'text/xml')
    + (fonts.length === 0 ? '' : entry('settings.xml', 'text/xml'))
    + fonts.map(font => entry(font.entry, TRUETYPE_MEDIA_TYPE)).join('')
    + '</manifest:manifest>'
}

/**
 * `settings.xml`, written only for a package that carries fonts.
 *
 * `EmbedFonts` is what makes the font files in `Fonts/` an instruction rather than dead weight: without
 * it LibreOffice reads the package, ignores the embedded faces in favour of whatever the machine has,
 * and drops them again on export.
 * @returns the `settings.xml` part, as UTF-8 text.
 */
function settings(): string {
  return `${XML_DECLARATION}<office:document-settings`
    + ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    + ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3">'
    + '<office:settings><config:config-item-set config:name="ooo:configuration-settings">'
    + '<config:config-item config:name="EmbedFonts" config:type="boolean">true</config:config-item>'
    + '</config:config-item-set></office:settings></office:document-settings>'
}

/**
 * Build the `.odt` file for one document.
 *
 * Fonts are written whole rather than subset. A subset is an order of magnitude smaller, but it holds
 * only the glyphs this document already uses, so the first character the recipient types in Word falls
 * back to a substituted face — which is the failure embedding exists to remove.
 *
 * @param document - the validated document.
 * @param fonts - the typefaces to carry inside the package; empty leaves the document naming them only.
 * @returns the complete ODF package bytes, ready to write or to hand to a converter.
 */
export function buildOdtPackage(document: OfficialDocument, fonts: readonly EmbeddedFont[] = []): Uint8Array {
  return zipSync({
    mimetype: [strToU8(ODT_MIMETYPE), STORED],
    'content.xml': [strToU8(buildContent(document)), DEFLATED],
    'styles.xml': [strToU8(buildStyles(fonts)), DEFLATED],
    ...(fonts.length === 0 ? {} : { 'settings.xml': [strToU8(settings()), DEFLATED] as const }),
    ...Object.fromEntries(fonts.map(font => [font.entry, [font.bytes, DEFLATED] as const])),
    'META-INF/manifest.xml': [strToU8(manifest(fonts)), DEFLATED],
  })
}
