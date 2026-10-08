/**
 * The model-facing `write_official_document` tool: turn structured content into a file laid out to
 * GB/T 9704—2012.
 *
 * This module owns the schema, the containment decision, and the order the two are applied in; the layout
 * modules own the standard, and `ctx.documentConvert` owns every format except `odt`, which is written
 * directly.
 *
 * The `.odt` is produced in a temporary directory the tool owns and then converted into place, because
 * the conversion seam reads and writes with the harness process's own authority. The sandbox decision is
 * therefore made here, before any path is touched — the same arrangement, for the same reason, as
 * `convert_document`.
 * @module @deepseek-ai/dsh-tool-official-document/tool
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ConvertError } from '@deepseek-ai/dsh-document-convert'
import type { ConvertFidelity } from '@deepseek-ai/dsh-document-convert'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import {
  assertWithinWorkspace,
  assertWritable,
  CONVERT_NOTES_SCHEMA,
  filePolicy,
  sessionCwd,
} from '@deepseek-ai/dsh-tool-document-convert'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { documentElements } from './content.ts'
import { dedupeEmbeddedFonts } from './docx-fonts.ts'
import type { FontScan } from './fonts.ts'
import { REQUIRED_FONTS } from './metrics.ts'
import { buildOdtPackage } from './package.ts'
import {
  formatOfficialDocumentOutput,
  OFFICIAL_DOCUMENT_FORMATS,
  officialDocumentMetaFromValue,
  presentOfficialDocumentCall,
  presentOfficialDocumentResult,
  resolveOfficialDocumentFormat,
} from './present.ts'
import type {
  OfficialDocumentFormat,
  OfficialDocumentOutputNote,
  OfficialDocumentToolArgs,
} from './present.ts'
import {
  OFFICIAL_DOC_FONTS_EMBEDDED,
  OFFICIAL_DOC_FONTS_REQUIRED,
  OFFICIAL_DOC_FORMAT_UNREACHABLE,
  OFFICIAL_DOC_OUTPUT_EXISTS,
  OfficialDocumentError,
} from './types.ts'
import type { OfficialDocument } from './types.ts'
import { validateOfficialDocument } from './validate.ts'

/**
 * Assemble the document from the call's arguments. The paragraph levels are carried across unnarrowed and
 * {@link validateOfficialDocument} rejects the ones outside 1–4, so an out-of-range level is reported as
 * the § 7.3.3 violation it is rather than as a schema error that cites no clause.
 * @param args - the schema-validated arguments.
 * @returns the document, ready to validate.
 */
export function assembleOfficialDocument(args: OfficialDocumentToolArgs): OfficialDocument {
  return {
    header: {
      ...args.copy_number === undefined ? {} : { copyNumber: args.copy_number },
      ...args.secrecy === undefined ? {} : { secrecy: args.secrecy },
      ...args.urgency === undefined ? {} : { urgency: args.urgency },
      ...args.issuer === undefined ? {} : { issuer: args.issuer },
      ...args.doc_number === undefined ? {} : { docNumber: args.doc_number },
      ...args.signer === undefined ? {} : { signer: args.signer },
    },
    body: {
      title: args.title,
      ...args.main_recipient === undefined ? {} : { mainRecipients: args.main_recipient },
      paragraphs: args.body.map(paragraph => ({
        ...paragraph.level === undefined ? {} : { level: paragraph.level as 1 | 2 | 3 | 4 },
        text: paragraph.text,
      })),
      ...args.attachments === undefined ? {} : { attachments: args.attachments },
      ...args.signature === undefined ? {} : { signature: args.signature },
      ...args.date === undefined ? {} : { date: args.date },
      ...args.note === undefined ? {} : { note: args.note },
    },
    colophon: {
      ...args.copy_to === undefined ? {} : { copyTo: args.copy_to },
      ...args.printer === undefined ? {} : { printer: args.printer },
    },
  }
}

/**
 * The note every result carries, saying which of the standard's typefaces travel inside the file and
 * which the reader's own machine has to supply.
 *
 * Embedding is what makes the distinction worth reporting. A family carried in the package renders the
 * same on a machine that has never seen the font; a family only named renders in whatever face the
 * reader's machine substitutes, silently, while every measurement stays as the standard sets it. The
 * model repeats this to the user, so it states which of the two happened rather than a general warning.
 * @param scan - the typefaces this build carries, and the ones a licence refused.
 * @returns the note to put first in the result.
 */
export function fontNote(scan: FontScan): OfficialDocumentOutputNote {
  const embedded = scan.embedded.map(font => font.family)
  if (embedded.length === 0) {
    return {
      code: OFFICIAL_DOC_FONTS_REQUIRED,
      message: `The layout asks for the typefaces GB/T 9704—2012 names (${REQUIRED_FONTS.join(', ')}). A `
        + 'machine that does not have them substitutes other faces, so the glyphs will differ from the '
        + 'standard even though every measurement, indent, and rule is as the standard sets it.',
    }
  }
  const named = REQUIRED_FONTS.filter(family => !embedded.includes(family))
  return {
    code: OFFICIAL_DOC_FONTS_EMBEDDED,
    message: `The file carries the typefaces ${embedded.join(', ')}, so they render correctly on a `
      + 'machine that does not have them installed.'
      + (named.length === 0
        ? ''
        : ` It names ${named.join(', ')} without carrying them; a machine without those substitutes `
          + 'other faces for them.')
      + (scan.restricted.length === 0
        ? ''
        : ` ${scan.restricted.join(', ')} could not be carried because the font's own licence bits `
          + 'forbid embedding.'),
  }
}

/** Refuse to replace an existing file unless the call asked for it. */
async function assertFreeOutput(
  ctx: Context,
  target: FsTarget,
  args: OfficialDocumentToolArgs,
  exec: ToolExecution,
): Promise<void> {
  if (args.overwrite === true) return
  if (await ctx.fs.stat(target, exec.signal) === undefined) return
  throw new OfficialDocumentError(
    `"${target.displayPath}" already exists; pass overwrite to replace it, or name a different output_path`,
    OFFICIAL_DOC_OUTPUT_EXISTS,
  )
}

/** What producing the requested format cost, beyond the `.odt` the tool wrote. */
interface Produced {
  readonly fidelity: ConvertFidelity
  readonly bytes: number
  readonly notes: readonly OfficialDocumentOutputNote[]
}

/**
 * Convert the staged `.odt` into the requested format. A host with no route to that format fails here,
 * naming `odt` as the format that needs no converter — which is the one thing the caller can act on.
 */
async function convertStaged(
  ctx: Context,
  stagedPath: string,
  outputPath: string,
  format: OfficialDocumentFormat,
  signal: AbortSignal | undefined,
): Promise<Produced> {
  const request = { sourcePath: stagedPath, targetFormat: format, outputPath }
  try {
    const outcome = await ctx.documentConvert.run(ctx.documentConvert.resolve(request), signal)
    return {
      fidelity: outcome.fidelity,
      bytes: outcome.bytes,
      notes: outcome.notes.map(note => ({ code: note.code, message: note.message })),
    }
  } catch (error) {
    if (!(error instanceof ConvertError)) throw error
    throw new OfficialDocumentError(
      `this host cannot turn the OpenDocument file into ${format}: ${error.message}. Pass format: "odt" `
      + 'to keep the OpenDocument file itself, which this tool writes without a converter.',
      OFFICIAL_DOC_FORMAT_UNREACHABLE,
    )
  }
}

/**
 * Register the `write_official_document` tool and its system-prompt guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the registrations; both are
 *   effect-scoped and unregister on plugin dispose.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the tool's
 *   `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 * @param fonts - the typefaces every document this plugin writes carries, read once at apply.
 */
export function applyOfficialDocumentTool(ctx: Context, timeoutMs: number, fonts: FontScan = EMPTY_FONTS): void {
  ctx.systemPrompt.section({
    name: 'tool:write_official_document',
    order: 113,
    text: 'Use the write_official_document tool to produce a 党政机关公文 laid out to GB/T 9704—2012. '
      + 'Write the wording yourself — the 标题 as 发文机关+事由+文种, the 主送机关, and the 正文 divided '
      + 'into levels — and let the tool set the page. It refuses a document that breaks the standard and '
      + 'names the clause; fix that field and call again. Repeat its notes to the user rather than '
      + 'claiming the file is printable as it stands.',
  })
  ctx.tools.register(officialDocumentTool(ctx, timeoutMs, fonts))
}

/** A build that carries no typefaces, which is what an unset `fontDirectory` produces. */
export const EMPTY_FONTS: FontScan = { embedded: [], restricted: [] }

/**
 * The `write_official_document` definition. Separate from registration so its schema, execution, and pure
 * presenters can be exercised directly.
 *
 * @param ctx - context supplying the filesystem and the conversion seam at execution time.
 * @param timeoutMs - the cooperative tool-call budget attached to the definition.
 * @param fonts - the typefaces to embed in every document, held here rather than re-read per call: the
 *   three 公文 faces are about 11 MB together, and they are the same bytes for the plugin's whole life.
 * @returns the tool definition to register.
 */
export function officialDocumentTool(ctx: Context, timeoutMs: number, fonts: FontScan = EMPTY_FONTS): ToolDefinition {
  return defineTool({
    name: 'write_official_document',
    description: 'Write text as a 党政机关公文 (Chinese Party and government official document) laid out '
      + 'to GB/T 9704—2012: A4 with a 156×225 mm 版心, 22 lines of 28 characters, 三号仿宋 body, the red '
      + 'separator line, the numbered 一、/（一）/1./（1） levels, and the 版记. Supply the wording; the '
      + 'tool sets the page. It refuses content that breaks the standard and names the clause.',
    parameters: {
      output_path: {
        type: 'string',
        required: true,
        description: 'Where to write the document, resolved by the filesystem backend.',
      },
      title: {
        type: 'string',
        required: true,
        description: '标题 (§ 7.3.1), normally 发文机关+事由+文种, e.g. ×××市人民政府关于×××的通知.',
      },
      body: {
        type: 'array',
        required: true,
        description: '正文 (§ 7.3.3), one entry per paragraph in order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            level: {
              type: 'integer',
              description: 'Structural level 1–4. The tool supplies the 一、/（一）/1./（1） ordinal and '
                + 'the typeface; omit for ordinary body text.',
            },
            text: {
              type: 'string',
              required: true,
              description: 'The paragraph text without its ordinal.',
            },
          },
        },
      },
      format: {
        type: 'string',
        enum: OFFICIAL_DOCUMENT_FORMATS,
        description: 'The file format. Defaults to the output_path extension, or docx. Only odt needs no '
          + 'converter on the host.',
      },
      issuer: {
        type: 'string',
        description: '发文机关标志 (§ 7.2.4), set in red at the top, e.g. ×××市人民政府文件.',
      },
      doc_number: {
        type: 'string',
        description: '发文字号 (§ 7.2.5) as 机关代字〔年份〕序号号, e.g. 国办发〔2026〕3号. No 第, and no '
          + 'padded sequence number.',
      },
      signer: {
        type: 'string',
        description: '签发人 (§ 7.2.6). Supply it only for an 上行文; it moves the 发文字号 to the left of '
          + 'its line, so doc_number is required with it.',
      },
      main_recipient: {
        type: 'array',
        items: { type: 'string' },
        description: '主送机关 (§ 7.3.2), the bodies addressed. The tool joins them and adds the colon.',
      },
      copy_number: {
        type: 'integer',
        description: '份号 (§ 7.2.1), this copy\'s serial number, laid out as six digits.',
      },
      secrecy: {
        type: 'object',
        additionalProperties: false,
        description: '密级和保密期限 (§ 7.2.2).',
        properties: {
          level: { type: 'string', required: true, description: 'e.g. 秘密, 机密, 绝密.' },
          period: { type: 'string', description: 'e.g. 5年.' },
        },
      },
      urgency: {
        type: 'string',
        enum: ['特急', '加急'],
        description: '紧急程度 (§ 7.2.3). Omit for an ordinary document.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: '附件说明 (§ 7.3.4), the attachment titles in order. No punctuation after a title.',
      },
      signature: {
        type: 'string',
        description: '发文机关署名 (§ 7.3.5.2), centred over the 成文日期.',
      },
      date: {
        type: 'string',
        description: '成文日期 (§ 7.3.5.4) as YYYY-MM-DD; laid out as e.g. 2026年9月1日.',
      },
      note: {
        type: 'string',
        description: '附注 (§ 7.3.6). The tool adds the round brackets.',
      },
      copy_to: {
        type: 'array',
        items: { type: 'string' },
        description: '抄送机关 (§ 7.4.2), in the 版记 on the last page.',
      },
      printer: {
        type: 'object',
        additionalProperties: false,
        description: '印发机关和印发日期 (§ 7.4.3), the last line of the 版记.',
        properties: {
          agency: { type: 'string', required: true, description: 'The body that printed the document.' },
          date: { type: 'string', required: true, description: 'The printing date as YYYY-MM-DD.' },
        },
      },
      overwrite: {
        type: 'boolean',
        description: 'Replace the output file if it already exists. Defaults to false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true, enum: OFFICIAL_DOCUMENT_FORMATS },
          fidelity: { type: 'string', required: true, enum: ['faithful', 'lossy'] },
          bytes: { type: 'integer', required: true },
          elements: { type: 'array', required: true, items: { type: 'string' } },
          notes: CONVERT_NOTES_SCHEMA,
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatOfficialDocumentOutput(value) }],
      presentationMeta: (_args, value) => officialDocumentMetaFromValue(value),
    },
    timeoutMs,
    async execute(args, exec) {
      // Resolve what this session may write BEFORE any path is touched: this tool always produces a
      // file, and it and the seam's providers write with the harness process's own authority.
      const policy = filePolicy(ctx, exec)
      assertWritable(policy, 'writing an official document')

      const cwd = sessionCwd(exec)
      const output = await ctx.fs.resolve(args.output_path, {
        ...cwd === undefined ? {} : { cwd },
        signal: exec.signal,
      })
      await assertWithinWorkspace(ctx, policy, output, exec.signal)
      await assertFreeOutput(ctx, output, args, exec)

      const document = assembleOfficialDocument(args)
      validateOfficialDocument(document)
      const odt = buildOdtPackage(document, fonts.embedded)

      const format = resolveOfficialDocumentFormat(args)
      const outputPath = ctx.fs.processPath(output)
      const produced = format === 'odt'
        ? await writeFile(outputPath, odt).then((): Produced => ({
          fidelity: 'faithful',
          bytes: odt.byteLength,
          notes: [],
        }))
        : await stageAndConvert(ctx, odt, outputPath, format, exec.signal)
      const shrunk = format === 'docx' ? await shrinkRepeatedFonts(outputPath, produced) : produced

      return {
        // The model-facing path, not the process path the file was written through.
        path: output.displayPath,
        format,
        fidelity: shrunk.fidelity,
        bytes: shrunk.bytes,
        elements: [...documentElements(document)],
        notes: [fontNote(fonts), ...shrunk.notes],
      }
    },
    presentCall: presentOfficialDocumentCall,
    presentResult: (_args, result) => presentOfficialDocumentResult(result),
  })
}

/** Write the `.odt` to a directory this tool owns, convert it into place, and remove the staging copy. */
async function stageAndConvert(
  ctx: Context,
  odt: Uint8Array,
  outputPath: string,
  format: OfficialDocumentFormat,
  signal: AbortSignal | undefined,
): Promise<Produced> {
  const staging = await mkdtemp(join(tmpdir(), 'dsh-official-document-'))
  try {
    const staged = join(staging, 'document.odt')
    await writeFile(staged, odt)
    return await convertStaged(ctx, staged, outputPath, format, signal)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Remove the font parts an OOXML conversion repeats, and report the size that leaves.
 *
 * A family that has only a regular face is written into both the regular and the bold slot, which
 * carries its bytes twice; Word synthesizes bold when no distinct bold file is present, so the repeat
 * buys nothing and doubles what the typefaces cost the document. See `docx-fonts.ts`.
 *
 * The seam verifies a converted file before returning it, so the `.docx` read here is a readable
 * container by the time this runs.
 *
 * @param outputPath - the file the conversion wrote.
 * @param produced - what the conversion reported.
 * @returns what to report, with the size the file has once the repeats are gone.
 */
async function shrinkRepeatedFonts(outputPath: string, produced: Produced): Promise<Produced> {
  const converted = new Uint8Array(await readFile(outputPath))
  const deduped = dedupeEmbeddedFonts(converted)
  if (deduped === converted) return produced
  await writeFile(outputPath, deduped)
  return { ...produced, bytes: deduped.byteLength }
}
