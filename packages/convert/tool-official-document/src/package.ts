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
import { buildStyles, XML_DECLARATION } from './odf.ts'
import type { OfficialDocument } from './types.ts'

/** The media type of an OpenDocument text document. */
export const ODT_MIMETYPE = 'application/vnd.oasis.opendocument.text'

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
function manifest(): string {
  const entry = (path: string, mediaType: string): string =>
    `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${mediaType}"/>`
  return `${XML_DECLARATION}<manifest:manifest`
    + ' xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">'
    + `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIMETYPE}"/>`
    + entry('content.xml', 'text/xml')
    + entry('styles.xml', 'text/xml')
    + '</manifest:manifest>'
}

/**
 * Build the `.odt` file for one document.
 *
 * @param document - the validated document.
 * @returns the complete ODF package bytes, ready to write or to hand to a converter.
 */
export function buildOdtPackage(document: OfficialDocument): Uint8Array {
  return zipSync({
    mimetype: [strToU8(ODT_MIMETYPE), STORED],
    'content.xml': [strToU8(buildContent(document)), DEFLATED],
    'styles.xml': [strToU8(buildStyles()), DEFLATED],
    'META-INF/manifest.xml': [strToU8(manifest()), DEFLATED],
  })
}
