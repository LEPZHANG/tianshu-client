import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import DocumentConvertRuntime from '@deepseek-ai/dsh-document-convert'
import type { ConvertStepSpec, DocumentConvertProvider } from '@deepseek-ai/dsh-document-convert'
import { documentFixture } from '../../document-convert/tests/fixtures.ts'
import { windowsFont } from './font-fixtures.ts'
import * as ToolOfficial from '../src/index.ts'

/**
 * The tool over a real registry, a real filesystem backend, and the real conversion seam, with a test
 * provider standing in for LibreOffice: what these tests own is the tool's own work — the containment
 * decision, the refusals, the `.odt` it writes itself, and the value the model sees. The layout is checked
 * in `odf.spec.ts` and `content.spec.ts`, and the real converters in the LibreOffice package.
 */

let root: string
let workspace: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-official-document-')))
  workspace = join(root, 'ws')
  await mkdir(workspace)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A converter that declares the routes out of `odt` LibreOffice declares, and writes a real file. */
function testProvider(overrides: Partial<DocumentConvertProvider> = {}): DocumentConvertProvider {
  return {
    id: 'test-converter',
    routes: [
      { from: 'odt', to: 'docx', fidelity: 'faithful', priority: 10 },
      { from: 'odt', to: 'pdf', fidelity: 'faithful', priority: 10 },
      { from: 'odt', to: 'txt', fidelity: 'lossy', priority: 10 },
    ],
    available: () => true,
    convert: async (step: ConvertStepSpec) => {
      await writeFile(step.outputPath, documentFixture(step.targetFormat))
      return []
    },
    ...overrides,
  }
}

/** Mount the tool over the real registry, filesystem, and seam. */
async function mount(provider: DocumentConvertProvider = testProvider()): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
  ctx.documentConvert.registerProvider(provider)
  await ctx.plugin(ToolOfficial)
  return ctx
}

/**
 * A converted `.docx` whose font table repeats one family's face in its bold slot under another font
 * key, which is what LibreOffice writes for a typeface that has no distinct bold file.
 */
function duplicatedFontDocx(): Uint8Array {
  const face = strToU8('FANGSONG-REGULAR-FACE'.repeat(2))
  const bold = Uint8Array.from(face)
  const key = [0x05, 0x01, 0x4a, 0x78, 0xca, 0xbc, 0x4e, 0xf0, 0x12, 0xac, 0x5c, 0xd8, 0x9a, 0xef, 0xde, 0x05]
  const other = [0x06, 0x01, 0x4a, 0x78, 0xca, 0xbc, 0x4e, 0xf0, 0x12, 0xac, 0x5c, 0xd8, 0x9a, 0xef, 0xde, 0x06]
  for (let index = 0; index < Math.min(32, face.length); index += 1) {
    const at = 15 - (index % 16)
    face[index] = (face[index] as number) ^ (key[at] as number)
    bold[index] = (bold[index] as number) ^ (other[at] as number)
  }
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<w:document/>'),
    'word/fontTable.xml': strToU8('<w:fonts><w:font w:name="FangSong_GB2312">'
      + '<w:embedRegular r:id="rId5" w:fontKey="{05014A78-CABC-4EF0-12AC-5CD89AEFDE05}"/>'
      + '<w:embedBold r:id="rId6" w:fontKey="{06014A78-CABC-4EF0-12AC-5CD89AEFDE06}"/>'
      + '</w:font></w:fonts>'),
    'word/_rels/fontTable.xml.rels': strToU8('<Relationships>'
      + '<Relationship Id="rId5" Target="fonts/font5.odttf"/>'
      + '<Relationship Id="rId6" Target="fonts/font6.odttf"/>'
      + '</Relationships>'),
    'word/fonts/font5.odttf': face,
    'word/fonts/font6.odttf': bold,
  })
}

let seq = 0
const testToolSignal = new AbortController().signal

/** Invoke `write_official_document` the way the loop does, as an agent whose workspace is `workspace`. */
function call(ctx: Context, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: `official-${++seq}` as never,
    name: 'write_official_document',
    arguments: args,
    agent: { session: { header: { cwd: workspace } } } as never,
  })
}

/** The text the model sees for a call. */
function text(result: ToolExecutionResult): string {
  const [block] = result.content
  return block !== undefined && block.type === 'text' ? block.text : ''
}

/** The arguments of a minimal accepted call. */
function args(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    output_path: '通知.odt',
    title: '××市人民政府关于开展公文格式规范化工作的通知',
    body: [{ text: '现就有关事项通知如下。' }],
    ...overrides,
  }
}

describe('write_official_document execution', () => {
  it('writes a real ODF package the tool builds itself, with no converter involved', async () => {
    const ctx = await mount()
    const result = await call(ctx, args())
    expect(result.isError).toBe(false)
    const parts = unzipSync(await readFile(join(workspace, '通知.odt')))
    expect(strFromU8(parts['content.xml'] as Uint8Array))
      .toContain('<text:p text:style-name="Title">××市人民政府关于开展公文格式规范化工作的通知</text:p>')
    await ctx.fiber.dispose()
  })

  it('returns a canonical value naming the clauses the document answers to', async () => {
    const ctx = await mount()
    const result = await call(ctx, args({ doc_number: '×政发〔2026〕3号', main_recipient: ['各区人民政府'] }))
    expect(result.value).toMatchObject({
      path: join(workspace, '通知.odt'),
      format: 'odt',
      fidelity: 'faithful',
      elements: ['§ 7.2.5 发文字号', '§ 7.3.1 标题', '§ 7.3.2 主送机关', '§ 7.3.3 正文'],
    })
    expect((result.value as { bytes: number }).bytes).toBeGreaterThan(0)
    await ctx.fiber.dispose()
  })

  it('converts the staged ODF into any other format the seam can reach', async () => {
    const ctx = await mount()
    const result = await call(ctx, args({ output_path: '通知.docx' }))
    expect(result.isError).toBe(false)
    expect(await readFile(join(workspace, '通知.docx'))).toEqual(documentFixture('docx'))
    expect(result.value).toMatchObject({ format: 'docx', fidelity: 'faithful' })
    await ctx.fiber.dispose()
  })

  it('removes the font parts the converter repeated, and reports the size that leaves', async () => {
    const ctx = await mount(testProvider({
      convert: async (step: ConvertStepSpec) => {
        await writeFile(step.outputPath, duplicatedFontDocx())
        return []
      },
    }))
    const result = await call(ctx, args({ output_path: '通知.docx' }))
    expect(result.isError).toBe(false)
    const written = await readFile(join(workspace, '通知.docx'))
    const parts = unzipSync(written)
    expect(strFromU8(parts['word/fontTable.xml'] as Uint8Array)).not.toContain('embedBold')
    expect(parts['word/fonts/font6.odttf']).toBeUndefined()
    expect(parts['word/fonts/font5.odttf']).toBeDefined()
    expect((result.value as { bytes: number }).bytes).toBe(written.byteLength)
    await ctx.fiber.dispose()
  })

  it('leaves no staging directory behind after a conversion', async () => {
    const before = (await readdir(tmpdir())).filter(entry => entry.startsWith('dsh-official-document-'))
    const ctx = await mount()
    await call(ctx, args({ output_path: '通知.docx' }))
    const after = (await readdir(tmpdir())).filter(entry => entry.startsWith('dsh-official-document-'))
    expect(after).toEqual(before)
    await ctx.fiber.dispose()
  })

  it('takes an explicit format over the output path\'s extension', async () => {
    const ctx = await mount()
    const result = await call(ctx, args({ output_path: '通知.dat', format: 'odt' }))
    expect(result.isError).toBe(false)
    expect(unzipSync(await readFile(join(workspace, '通知.dat')))['mimetype']).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('numbers the 正文 levels the model asked for rather than the ordinals it wrote itself', async () => {
    const ctx = await mount()
    await call(ctx, args({
      body: [{ level: 1, text: '统一格式标准' }, { level: 2, text: '版面要求' }, { text: '正文' }],
    }))
    const parts = unzipSync(await readFile(join(workspace, '通知.odt')))
    const content = strFromU8(parts['content.xml'] as Uint8Array)
    expect(content).toContain('<text:p text:style-name="BodyLevel1">一、统一格式标准</text:p>')
    expect(content).toContain('<text:p text:style-name="BodyLevel2">（一）版面要求</text:p>')
    await ctx.fiber.dispose()
  })

  it('lays out every element the standard admits, in one document', async () => {
    const ctx = await mount()
    const result = await call(ctx, args({
      copy_number: 7,
      secrecy: { level: '秘密', period: '5年' },
      urgency: '特急',
      issuer: '××市人民政府文件',
      doc_number: '×政发〔2026〕3号',
      main_recipient: ['各区人民政府', '市政府各部门'],
      attachments: ['公文格式检查表'],
      signature: '××市人民政府',
      date: '2026-09-21',
      note: '此件公开发布',
      copy_to: ['市委办公厅'],
      printer: { agency: '市政府办公厅', date: '2026-09-22' },
    }))
    expect((result.value as { elements: string[] }).elements).toHaveLength(14)
    await ctx.fiber.dispose()
  })

  it('puts the 发文字号 and the 签发人 on one line for an 上行文', async () => {
    const ctx = await mount()
    await call(ctx, args({ doc_number: '×政发〔2026〕3号', signer: '张××' }))
    const parts = unzipSync(await readFile(join(workspace, '通知.odt')))
    expect(strFromU8(parts['content.xml'] as Uint8Array)).toContain('DocNumberUpward')
    await ctx.fiber.dispose()
  })
})

describe('write_official_document refusals', () => {
  it('refuses a document that breaks the standard, naming the clause, before writing anything', async () => {
    const ctx = await mount()
    const result = await call(ctx, args({ doc_number: '国办发〔2026〕第01号' }))
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('OFFICIAL_DOC_FIELD_INVALID')
    expect(text(result)).toMatch(/§ 7\.2\.5/)
    await expect(readFile(join(workspace, '通知.odt'))).rejects.toThrow()
    await ctx.fiber.dispose()
  })

  it('refuses a level outside the four § 7.3.3 numbers, as the clause rather than as a schema error', async () => {
    const ctx = await mount()
    const result = await call(ctx, args({ body: [{ level: 5, text: '深' }] }))
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/cannot be at level 5/)
    await ctx.fiber.dispose()
  })

  it('refuses to replace an existing file unless asked', async () => {
    const ctx = await mount()
    await writeFile(join(workspace, '通知.odt'), 'existing')
    const result = await call(ctx, args())
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('OFFICIAL_DOC_OUTPUT_EXISTS')
    expect(await readFile(join(workspace, '通知.odt'), 'utf8')).toBe('existing')
    await ctx.fiber.dispose()
  })

  it('replaces an existing file when overwrite is set', async () => {
    const ctx = await mount()
    await writeFile(join(workspace, '通知.odt'), 'existing')
    const result = await call(ctx, args({ overwrite: true }))
    expect(result.isError).toBe(false)
    expect(unzipSync(await readFile(join(workspace, '通知.odt')))['mimetype']).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('names odt as the way out when the host has no route to the requested format', async () => {
    const ctx = await mount(testProvider({ routes: [] }))
    const result = await call(ctx, args({ output_path: '通知.docx' }))
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('OFFICIAL_DOC_FORMAT_UNREACHABLE')
    expect(text(result)).toMatch(/Pass format: "odt"/)
    await ctx.fiber.dispose()
  })

  it('lets a failure that is not a conversion failure through unchanged', async () => {
    const ctx = await mount(testProvider({
      convert: () => Promise.reject(new RangeError('converter exploded')),
    }))
    const result = await call(ctx, args({ output_path: '通知.docx' }))
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).not.toBe('OFFICIAL_DOC_FORMAT_UNREACHABLE')
    await ctx.fiber.dispose()
  })

  it('refuses a format outside the ones it can write, before executing', async () => {
    const ctx = await mount()
    const result = await call(ctx, args({ format: 'xlsx' }))
    expect(result.isError).toBe(true)
    await ctx.fiber.dispose()
  })
})

describe('write_official_document model-facing text', () => {
  it('states the file and the clauses, and reports which typefaces the file does not carry', async () => {
    const ctx = await mount()
    const result = await call(ctx, args())
    expect(text(result)).toMatch(/^Wrote a GB\/T 9704—2012 official document to /)
    expect(text(result)).toMatch(/Elements laid out: § 7\.3\.1 标题; § 7\.3\.3 正文\./)
    expect(text(result)).toMatch(/What this file does not deliver:\n- The layout asks for the typefaces/)
    await ctx.fiber.dispose()
  })

  it('carries the font note as data as well as prose', async () => {
    const ctx = await mount()
    const result = await call(ctx, args())
    expect((result.value as { notes: { code: string }[] }).notes[0]?.code).toBe('OFFICIAL_DOC_FONTS_REQUIRED')
    await ctx.fiber.dispose()
  })

  it('reports the conversion\'s own notes after its own', async () => {
    const ctx = await mount(testProvider({
      convert: async (step: ConvertStepSpec) => {
        await writeFile(step.outputPath, documentFixture(step.targetFormat))
        return [{ code: 'TEXT_ONLY', message: 'Rules became blank lines.' }]
      },
    }))
    const result = await call(ctx, args({ output_path: '通知.txt' }))
    expect((result.value as { notes: { code: string }[] }).notes.map(note => note.code))
      .toEqual(['OFFICIAL_DOC_FONTS_REQUIRED', 'TEXT_ONLY'])
    await ctx.fiber.dispose()
  })
})

describe('write_official_document presentation through the registered definition', () => {
  it('threads the pending card onto the definition', async () => {
    const ctx = await mount()
    const definition = ToolOfficial.officialDocumentTool(ctx, 1000)
    expect(definition.presentCall?.({ output_path: 'out/通知.docx', title: '关于××的通知', body: [] })).toEqual({
      card: 'generic',
      title: 'Write 关于××的通知 as docx',
      kind: 'edit',
      rawInput: '关于××的通知',
      locations: [{ path: 'out/通知.docx' }],
    })
    await ctx.fiber.dispose()
  })

  it('threads the completed card onto the definition', async () => {
    const ctx = await mount()
    const definition = ToolOfficial.officialDocumentTool(ctx, 1000)
    expect(definition.presentResult?.({ output_path: '通知.txt', title: 'x', body: [] }, {
      isError: false,
      content: [],
      meta: { path: '/ws/通知.txt', fidelity: 'lossy' },
    })).toEqual({ card: 'generic', title: '通知.txt (lossy)' })
    await ctx.fiber.dispose()
  })
})

describe('write_official_document carrying its typefaces', () => {
  let fontDirectory: string

  beforeEach(async () => {
    fontDirectory = join(root, 'fonts')
    await mkdir(fontDirectory)
    // Named after nothing in particular: the plugin matches on what each font says it is.
    await writeFile(join(fontDirectory, '1.ttf'), windowsFont('仿宋_GB2312'))
    await writeFile(join(fontDirectory, '2.ttf'), windowsFont('方正小标宋简体', 0x0008))
    await writeFile(join(fontDirectory, '3.ttf'), windowsFont('楷体_GB2312'))
  })

  /** The tool with a font directory, mounted the way a deployment configures it. */
  async function mountWithFonts(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
    ctx.documentConvert.registerProvider(testProvider())
    await ctx.plugin(ToolOfficial, { fontDirectory })
    return ctx
  }

  it('writes the typefaces into the .odt it produces', async () => {
    const ctx = await mountWithFonts()
    await call(ctx, args({ output_path: '通知.odt' }))
    const parts = unzipSync(await readFile(join(workspace, '通知.odt')))
    expect(Object.keys(parts)).toContain('Fonts/_u4EFF_u5B8B_GB2312.ttf')
    expect(strFromU8(parts['styles.xml'] as Uint8Array))
      .toContain('<svg:font-face-uri xlink:href="Fonts/_u65B9_u6B63_u5C0F_u6807_u5B8B_u7B80_u4F53.ttf"')
    await ctx.fiber.dispose()
  })

  it('tells the model which typefaces travel with the file and which do not', async () => {
    const ctx = await mountWithFonts()
    const result = await call(ctx, args({ output_path: '通知.odt' }))
    const note = (result.value as { notes: { code: string; message: string }[] }).notes[0]
    expect(note?.code).toBe('OFFICIAL_DOC_FONTS_EMBEDDED')
    expect(note?.message).toContain('方正小标宋简体, 仿宋_GB2312, 楷体_GB2312')
    // 黑体 and 宋体 ship with Windows, so the directory has no reason to hold them.
    expect(note?.message).toContain('It names 黑体, 宋体 without carrying them')
    await ctx.fiber.dispose()
  })

  it('reports no uncarried typefaces when the directory holds all five', async () => {
    await writeFile(join(fontDirectory, '4.ttf'), windowsFont('黑体'))
    await writeFile(join(fontDirectory, '5.ttf'), windowsFont('宋体'))
    const ctx = await mountWithFonts()
    const result = await call(ctx, args({ output_path: '通知.odt' }))
    const note = (result.value as { notes: { code: string; message: string }[] }).notes[0]
    expect(note?.code).toBe('OFFICIAL_DOC_FONTS_EMBEDDED')
    expect(note?.message).not.toContain('without carrying them')
    await ctx.fiber.dispose()
  })

  it('will not carry a font whose own licence bits forbid embedding', async () => {
    await writeFile(join(fontDirectory, '4.ttf'), windowsFont('黑体', 0x0002))
    const ctx = await mountWithFonts()
    const result = await call(ctx, args({ output_path: '通知.odt' }))
    const note = (result.value as { notes: { message: string }[] }).notes[0]
    expect(note?.message).toContain("黑体 could not be carried because the font's own licence bits")
    expect(Object.keys(unzipSync(await readFile(join(workspace, '通知.odt')))))
      .not.toContain('Fonts/_u9ED1_u4F53.ttf')
    await ctx.fiber.dispose()
  })

  it('refuses to start when the configured directory cannot be read', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
    await expect(ctx.plugin(ToolOfficial, { fontDirectory: join(root, 'absent') }))
      .rejects.toThrow(/cannot read the font directory/)
    await ctx.fiber.dispose()
  })
})

describe('write_official_document without a calling agent', () => {
  it('resolves against the filesystem backend\'s own directory', async () => {
    const ctx = await mount()
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: `official-agentless-${++seq}` as never,
      name: 'write_official_document',
      arguments: args(),
    })
    expect(result.isError).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('write_official_document tool schema', () => {
  it('advertises only the formats an ODF file can reach', async () => {
    const ctx = await mount()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'write_official_document')
    const properties = (schema?.parameters as { properties: Record<string, { enum?: string[] }> }).properties
    expect(properties.format?.enum).toEqual(['docx', 'odt', 'doc', 'rtf', 'pdf', 'html', 'txt'])
    expect(properties.urgency?.enum).toEqual(['特急', '加急'])
    await ctx.fiber.dispose()
  })

  it('unregisters the tool and its prompt section when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
    ctx.documentConvert.registerProvider(testProvider())
    const fork = await ctx.plugin(ToolOfficial)
    expect(ctx.tools.schemas().some(entry => entry.name === 'write_official_document')).toBe(true)
    await fork.dispose()
    expect(ctx.tools.schemas().some(entry => entry.name === 'write_official_document')).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('tool-official-document config', () => {
  it('refuses a tool budget outside the timer range', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(DocumentConvertRuntime, { tempDir: root })
    await expect(ctx.plugin(ToolOfficial, { timeoutMs: 0 })).rejects.toThrow(/timeoutMs/)
    await expect(ctx.plugin(ToolOfficial, { timeoutMs: 2_147_483_648 })).rejects.toThrow(/timeoutMs/)
    await ctx.fiber.dispose()
  })
})

/** Loader export-shape guard: a namespace plugin with `inject` must survive `unwrapExports` (postmortem 0001). */
describe('dsh-tool-official-document Loader export shape', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in ToolOfficial).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ToolOfficial) as Record<string, unknown>
    expect(unwrapped).toBe(ToolOfficial)
    expect(unwrapped.name).toBe('tool-official-document')
    expect(unwrapped.inject).toEqual(['tools', 'systemPrompt', 'documentConvert', 'fs'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
