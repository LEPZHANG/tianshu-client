/**
 * The model-facing `convert_document` tool. This module owns its schema, its path resolution, its
 * containment decision, and its presentation; `ctx.documentConvert` owns route selection and the
 * conversion itself.
 *
 * Timeout is deployment policy rather than a model argument: config becomes `ToolDefinition.timeoutMs`,
 * the timeout policy enforces it, and this tool forwards the resulting signal. The default is generous
 * because a cold LibreOffice start costs seconds before any document is read.
 * @module @deepseek-ai/dsh-tool-document-convert/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { ConvertError, DOCUMENT_FORMATS } from '@deepseek-ai/dsh-document-convert'
import type { DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  assertWithinWorkspace,
  assertWritable,
  CONVERT_NOTES_SCHEMA,
  filePolicy,
  sessionCwd,
} from './policy.ts'
import {
  convertMetaFromValue,
  CONVERT_COLLISION_POLICIES,
  formatConvertOutput,
  plannedOutputPath,
  presentConvertCall,
  presentConvertResult,
} from './present.ts'
import type { ConvertCollisionPolicy, ConvertToolArgs } from './present.ts'

/**
 * Validate what the schema cannot express: a non-blank source path, and a non-blank output path when one
 * is given.
 * @param args - the schema-validated arguments.
 * @returns the arguments with blanks rejected.
 */
export function parseConvertArgs(args: ConvertToolArgs): ConvertToolArgs {
  if (args.path.trim().length === 0) throw new Error('path must be a non-empty file path')
  if (args.output_path !== undefined && args.output_path.trim().length === 0) {
    throw new Error('output_path must be a non-empty file path when given')
  }
  return args
}

/** Confirm the source exists and is a regular file before any converter is started. */
async function assertConvertibleSource(ctx: Context, target: FsTarget, exec: ToolExecution): Promise<void> {
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    throw new ConvertError(`there is no file at "${target.displayPath}"`, 'CONVERT_SOURCE_MISSING')
  }
  if (info.type !== 'file') {
    throw new ConvertError(`"${target.displayPath}" is a ${info.type}, not a file`, 'CONVERT_SOURCE_NOT_FILE')
  }
}

/** How many names beside the requested one a `rename` collision will try before giving up. */
const MAX_RENAME_ATTEMPTS = 100

/**
 * The nth name beside a path: `report.doc` becomes `report-1.doc`, and an extensionless path gets the
 * suffix at the end. This works on the requested path rather than the resolved one so the model sees a
 * name in the vocabulary it asked in.
 */
function alternativePath(path: string, index: number): string {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return dot > slash ? `${path.slice(0, dot)}-${index}${path.slice(dot)}` : `${path}-${index}`
}

/** The file a call will write, and the path it asked for when that one was taken. */
interface ResolvedOutput {
  readonly target: FsTarget
  readonly renamedFrom?: string
}

/**
 * Apply the call's collision policy to the requested output path.
 *
 * The existence check races anything else writing the same directory, exactly as the overwrite guard it
 * replaces does; the window is the same one `convert_document` has always had, and closing it needs an
 * exclusive create the filesystem backend does not offer.
 *
 * @param ctx - context supplying the filesystem backend.
 * @param requested - the output path the call named or derived.
 * @param policy - what to do when that path is taken.
 * @param resolveOptions - the cwd and signal every resolution shares.
 * @param signal - the call's cancellation signal.
 * @returns the file to write, and the requested path when a different one was chosen.
 */
async function resolveOutputTarget(
  ctx: Context,
  requested: string,
  policy: ConvertCollisionPolicy,
  resolveOptions: { cwd?: string; signal: AbortSignal },
  signal: AbortSignal,
): Promise<ResolvedOutput> {
  const target = await ctx.fs.resolve(requested, resolveOptions)
  if (policy === 'overwrite') return { target }
  if (await ctx.fs.stat(target, signal) === undefined) return { target }
  if (policy === 'refuse') {
    throw new ConvertError(
      `"${target.displayPath}" already exists; pass if_exists to replace or rename it, or name a different output_path`,
      'CONVERT_OUTPUT_EXISTS',
    )
  }
  for (let index = 1; index <= MAX_RENAME_ATTEMPTS; index += 1) {
    const candidate = await ctx.fs.resolve(alternativePath(requested, index), resolveOptions)
    if (await ctx.fs.stat(candidate, signal) === undefined) {
      return { target: candidate, renamedFrom: target.displayPath }
    }
  }
  throw new ConvertError(
    `"${target.displayPath}" and the ${MAX_RENAME_ATTEMPTS} names beside it are all taken; name an output_path`,
    'CONVERT_OUTPUT_EXISTS',
  )
}

/**
 * Register the `convert_document` tool and its system-prompt guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the registrations; both are
 *   effect-scoped and unregister on plugin dispose.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the tool's
 *   `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 */
export function applyConvertDocumentTool(ctx: Context, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:convert_document',
    order: 112,
    text: 'Use the convert_document tool to convert a file between document, spreadsheet, and presentation '
      + 'formats. It reports whether the conversion preserved the source or only its text; say so when it '
      + 'did not, and never claim a conversion the tool refused.',
  })
  ctx.tools.register(convertDocumentTool(ctx, timeoutMs))
}

/**
 * The `convert_document` definition. Separate from registration so its schema, execution, and pure
 * presenters can be exercised directly.
 *
 * @param ctx - context supplying the filesystem and the conversion seam at execution time.
 * @param timeoutMs - the cooperative tool-call budget attached to the definition.
 * @returns the tool definition to register.
 */
export function convertDocumentTool(ctx: Context, timeoutMs: number): ToolDefinition {
  return defineTool({
    name: 'convert_document',
    description: 'Convert a document, spreadsheet, or presentation file to another format, writing a new '
      + 'file. Supported formats: pdf, doc, docx, odt, rtf, txt, html, xls, xlsx, ods, ppt, pptx, odp. '
      + 'Not every pair is convertible; the tool refuses a conversion it cannot perform rather than '
      + 'writing an unusable file.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Path to the file to convert, resolved by the filesystem backend.',
      },
      to: {
        type: 'string',
        required: true,
        enum: DOCUMENT_FORMATS,
        description: 'The format to produce.',
      },
      output_path: {
        type: 'string',
        description: 'Where to write the result. Defaults to the source path with the new extension.',
      },
      if_exists: {
        type: 'string',
        enum: CONVERT_COLLISION_POLICIES,
        description: 'What to do when the output path is already taken: "rename" (the default) writes '
          + 'beside it and reports the new name, "overwrite" replaces it, "refuse" fails the call.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          from: { type: 'string', required: true, enum: DOCUMENT_FORMATS },
          to: { type: 'string', required: true, enum: DOCUMENT_FORMATS },
          fidelity: { type: 'string', required: true, enum: ['faithful', 'lossy'] },
          steps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                from: { type: 'string', required: true, enum: DOCUMENT_FORMATS },
                to: { type: 'string', required: true, enum: DOCUMENT_FORMATS },
                provider: { type: 'string', required: true },
              },
            },
          },
          bytes: { type: 'integer', required: true },
          notes: CONVERT_NOTES_SCHEMA,
          renamed_from: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatConvertOutput(value) }],
      presentationMeta: (_args, value) => convertMetaFromValue(value),
    },
    timeoutMs,
    async execute(args, exec) {
      const input = parseConvertArgs(args)
      // Resolve what this session may write BEFORE any path is touched: a conversion always produces a
      // file, and the seam's providers write with the harness process's own authority.
      const policy = filePolicy(ctx, exec)
      assertWritable(policy, 'converting a document')

      const resolveOptions = { ...sessionCwd(exec) !== undefined ? { cwd: sessionCwd(exec) as string } : {}, signal: exec.signal }
      const source = await ctx.fs.resolve(input.path, resolveOptions)
      await assertConvertibleSource(ctx, source, exec)

      const output = await resolveOutputTarget(
        ctx,
        plannedOutputPath(input),
        input.if_exists ?? 'rename',
        resolveOptions,
        exec.signal,
      )
      await assertWithinWorkspace(ctx, policy, output.target, exec.signal)

      const spec = ctx.documentConvert.resolve({
        sourcePath: ctx.fs.processPath(source),
        targetFormat: input.to,
        outputPath: ctx.fs.processPath(output.target),
      })
      const outcome = await ctx.documentConvert.run(spec, exec.signal)
      return {
        // The model-facing path, not the process path the providers ran against.
        path: output.target.displayPath,
        from: outcome.sourceFormat,
        to: outcome.targetFormat,
        fidelity: outcome.fidelity,
        steps: outcome.steps.map(step => ({ from: step.from, to: step.to, provider: step.providerId })),
        bytes: outcome.bytes,
        notes: outcome.notes.map(note => ({ code: note.code, message: note.message })),
        ...output.renamedFrom !== undefined ? { renamed_from: output.renamedFrom } : {},
      }
    },
    presentCall: presentConvertCall,
    presentResult: (_args, result) => presentConvertResult(result),
  })
}

/** The formats the tool advertises, re-exported so a composition can check its own wiring. */
export const CONVERTIBLE_FORMATS: readonly DocumentFormat[] = DOCUMENT_FORMATS
