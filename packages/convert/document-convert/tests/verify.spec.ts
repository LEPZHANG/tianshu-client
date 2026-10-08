import { describe, expect, it } from 'vitest'
import { DOCUMENT_FORMATS, verifyConvertedBytes } from '@deepseek-ai/dsh-document-convert'
import { documentFixture, storedZip } from './fixtures.ts'

/**
 * What the seam accepts as a converted file. Every check here exists because a converter reported success
 * and produced the file being rejected: LibreOffice exits 0 for a PDF export that wrote no pages, for a
 * presentation exported to HTML with no slide text, and for an `.odp` that is a Writer document inside.
 */

/** The bytes of a UTF-8 string, which is how these cases spell a malformed file. */
function bytes(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

describe('verifyConvertedBytes', () => {
  it('accepts a real file of every format it knows, so no check rejects its own target', () => {
    const rejected = DOCUMENT_FORMATS
      .map(format => [format, verifyConvertedBytes(format, documentFixture(format))] as const)
      .filter(([, reason]) => reason !== undefined)
    expect(rejected).toEqual([])
  })

  it('refuses an empty file whatever the format, that being what a failed extraction writes', () => {
    expect(verifyConvertedBytes('pdf', Buffer.alloc(0))).toBe('the file is empty')
    expect(verifyConvertedBytes('docx', Buffer.alloc(0))).toBe('the file is empty')
  })
})

describe('verifyConvertedBytes for pdf', () => {
  it('refuses a file that is not a PDF at all', () => {
    expect(verifyConvertedBytes('pdf', bytes('Error: no export filter'))).toMatch(/PDF signature/)
  })

  it('refuses a PDF with a header and no trailer, which is an export that wrote no pages', () => {
    expect(verifyConvertedBytes('pdf', bytes('%PDF-1.4\n1 0 obj\n')))
      .toBe('the PDF has no trailer, so no pages were written')
  })
})

describe('verifyConvertedBytes for the Office 97 formats', () => {
  it('refuses a file lacking the compound-file header, naming the application', () => {
    expect(verifyConvertedBytes('doc', bytes('not a doc'))).toMatch(/Word 97/)
    expect(verifyConvertedBytes('xls', bytes('not an xls'))).toMatch(/Excel 97/)
    expect(verifyConvertedBytes('ppt', bytes('not a ppt'))).toMatch(/PowerPoint 97/)
  })
})

describe('verifyConvertedBytes for the OOXML formats', () => {
  it('refuses a file that is not a readable container', () => {
    expect(verifyConvertedBytes('docx', bytes('PK is not enough')))
      .toBe('the file is not a readable Office Open XML container')
  })

  it('refuses a container holding another Office application\'s document', () => {
    expect(verifyConvertedBytes('pptx', documentFixture('docx')))
      .toBe('the container holds no ppt/presentation.xml, so it is not pptx')
  })

  it('accepts a container carrying extra parts alongside the one that identifies it', () => {
    const archive = storedZip([
      { name: '[Content_Types].xml', data: bytes('<Types/>') },
      { name: 'xl/workbook.xml', data: bytes('<workbook/>') },
      { name: 'xl/worksheets/sheet1.xml', data: bytes('<worksheet/>') },
    ])
    expect(verifyConvertedBytes('xlsx', archive)).toBeUndefined()
  })
})

describe('verifyConvertedBytes for the OpenDocument formats', () => {
  it('refuses a file that is not a container', () => {
    expect(verifyConvertedBytes('odt', bytes('not a container')))
      .toBe('the file is not an OpenDocument container')
  })

  it('refuses a container that declares no media type, every OOXML file being one', () => {
    expect(verifyConvertedBytes('odt', documentFixture('docx')))
      .toBe('the container declares no OpenDocument media type')
  })

  it('refuses the document LibreOffice writes when it exports through the wrong application', () => {
    expect(verifyConvertedBytes('odp', documentFixture('odt')))
      .toBe('the container declares "application/vnd.oasis.opendocument.text", not odp')
  })
})

describe('verifyConvertedBytes for rtf', () => {
  it('refuses a file without the RTF signature', () => {
    expect(verifyConvertedBytes('rtf', bytes('{not rtf}'))).toMatch(/RTF signature/)
  })
})

describe('verifyConvertedBytes for txt', () => {
  it('refuses a file holding only whitespace, which no extraction of a real page produces', () => {
    expect(verifyConvertedBytes('txt', bytes('\n \n\t\n'))).toBe('the file is empty')
  })

  it('accepts a single line of extracted text', () => {
    expect(verifyConvertedBytes('txt', bytes('Quarterly report\n'))).toBeUndefined()
  })
})

describe('verifyConvertedBytes for html', () => {
  const empty = 'the page has no visible text, so no content was carried over'

  it('refuses a complete page carrying no text, which an Impress export of a ppt produces', () => {
    expect(verifyConvertedBytes('html', bytes('<html><body><a name="1"></a></body></html>'))).toBe(empty)
  })

  it('refuses a fragment with no body element either, reading the whole file as the page', () => {
    expect(verifyConvertedBytes('html', bytes('<div><img src="a.png"></div>'))).toBe(empty)
  })

  it('accepts a fragment with no body element when it does carry text', () => {
    expect(verifyConvertedBytes('html', bytes('<div>Quarterly report</div>'))).toBeUndefined()
  })

  it('counts neither scripts, styles, comments, nor head metadata as visible text', () => {
    const page = '<html><head><title>Report</title></head><body>'
      + '<style>p { color: red }</style><script>const a = 1</script><!-- draft --> &nbsp;'
      + '</body></html>'
    expect(verifyConvertedBytes('html', bytes(page))).toBe(empty)
  })

  it('accepts a page whose text sits among the markup that carried none', () => {
    const page = '<html><body><style>p { color: red }</style><p>Quarterly report</p></body></html>'
    expect(verifyConvertedBytes('html', bytes(page))).toBeUndefined()
  })
})
