/**
 * Whether a converted file is actually a usable document of the format it was asked for.
 *
 * A converter's exit status does not answer that. LibreOffice exits 0 and writes a structurally valid
 * file for conversions it did not perform: a presentation exported to HTML with no slide text at all, an
 * ODF *text* document written under an `.odp` name, a PDF with a header and no page tree. Those files
 * open, so nothing downstream notices; the person who asked for the conversion notices. Each format below
 * is therefore checked for the two things a converter can silently get wrong — that the container is the
 * target's own kind, and that something of the source survived into it.
 *
 * The checks are deliberately shallow. They reject files no one would accept, not files a specialist
 * would criticise: a passing check means the file is a real document of the right type with content in
 * it, not that the conversion was good.
 * @module @deepseek-ai/dsh-document-convert/verify
 */

import { isZipContainer, readOdfMediaType, readZipEntries } from './container.ts'
import type { DocumentFormat } from './types.ts'

/** The compound-file header shared by the pre-2007 Microsoft Office formats. */
const OLE_COMPOUND_FILE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/** The part whose presence identifies each OOXML container's own document type. */
const OOXML_PRIMARY_PARTS: Readonly<Record<'docx' | 'xlsx' | 'pptx', string>> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
}

/** The media type each OpenDocument container declares in its `mimetype` entry. */
const ODF_MEDIA_TYPES: Readonly<Record<'odt' | 'ods' | 'odp', string>> = {
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
}

/** A check over a converted file's bytes: a reason when the file is unusable, nothing when it passes. */
type OutputCheck = (bytes: Buffer) => string | undefined

/** Require a byte prefix — the format's own signature. */
function requireMagic(magic: Buffer | string, described: string): OutputCheck {
  const expected = typeof magic === 'string' ? Buffer.from(magic, 'ascii') : magic
  return bytes => bytes.subarray(0, expected.length).equals(expected)
    ? undefined
    : `the file does not begin with ${described}`
}

/** Require an OOXML container carrying the target type's primary part. */
function requireOoxmlPart(format: keyof typeof OOXML_PRIMARY_PARTS): OutputCheck {
  const part = OOXML_PRIMARY_PARTS[format]
  return (bytes) => {
    const entries = readZipEntries(bytes)
    if (entries === undefined) return 'the file is not a readable Office Open XML container'
    return entries.some(entry => entry.name === part)
      ? undefined
      : `the container holds no ${part}, so it is not ${format}`
  }
}

/** Require an OpenDocument container declaring the target type's media type. */
function requireOdfMediaType(format: keyof typeof ODF_MEDIA_TYPES): OutputCheck {
  const expected = ODF_MEDIA_TYPES[format]
  return (bytes) => {
    if (!isZipContainer(bytes)) return 'the file is not an OpenDocument container'
    const declared = readOdfMediaType(bytes)
    if (declared === undefined) return 'the container declares no OpenDocument media type'
    // This is the check that catches the conversions LibreOffice performs by loading the source into the
    // wrong application: asked for `.odp` it will happily write a Writer document, whose media type says
    // so even though the file name does not.
    return declared === expected
      ? undefined
      : `the container declares "${declared}", not ${format}`
  }
}

/**
 * Text a browser would show, with markup, comments, scripts, and styles removed. Entities are not
 * decoded: the question is only whether anything is there, and an entity-only page has no words either.
 */
function visibleHtmlText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)
  return (body?.[1] ?? html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Every format's check, as an exhaustive record so a new {@link DocumentFormat} cannot be added without
 * deciding what makes its output usable.
 *
 * PDF is checked at both ends because a header alone is what a failed export leaves behind; the trailer
 * is written only once a page tree exists. The three text-shaped formats are checked for content rather
 * than for a signature, since an empty file is exactly what a failed text extraction produces.
 */
const OUTPUT_CHECKS: Readonly<Record<DocumentFormat, OutputCheck>> = {
  pdf: (bytes) => {
    const header = requireMagic('%PDF-', 'the PDF signature')(bytes)
    if (header !== undefined) return header
    return bytes.includes('%%EOF') ? undefined : 'the PDF has no trailer, so no pages were written'
  },
  doc: requireMagic(OLE_COMPOUND_FILE_HEADER, 'a Word 97 compound file header'),
  xls: requireMagic(OLE_COMPOUND_FILE_HEADER, 'an Excel 97 compound file header'),
  ppt: requireMagic(OLE_COMPOUND_FILE_HEADER, 'a PowerPoint 97 compound file header'),
  docx: requireOoxmlPart('docx'),
  xlsx: requireOoxmlPart('xlsx'),
  pptx: requireOoxmlPart('pptx'),
  odt: requireOdfMediaType('odt'),
  ods: requireOdfMediaType('ods'),
  odp: requireOdfMediaType('odp'),
  rtf: requireMagic('{\\rtf', 'the RTF signature'),
  txt: bytes => bytes.toString('utf8').trim().length > 0 ? undefined : 'the file is empty',
  html: (bytes) => {
    // An Impress document exported to HTML from an imported `ppt` produces a complete page with no slide
    // text whatsoever. It is well-formed, it is the right type, and it carries nothing.
    return visibleHtmlText(bytes.toString('utf8')).length > 0
      ? undefined
      : 'the page has no visible text, so no content was carried over'
  },
}

/**
 * Check a converted file's bytes against its target format.
 *
 * @param format - the format the file was supposed to be.
 * @param bytes - the complete file.
 * @returns a reason the file is unusable, or `undefined` when it passes.
 */
export function verifyConvertedBytes(format: DocumentFormat, bytes: Buffer): string | undefined {
  if (bytes.length === 0) return 'the file is empty'
  return OUTPUT_CHECKS[format](bytes)
}
