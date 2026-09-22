/**
 * Service Definition for the document conversion capability seam (`ctx.documentConvert`): a provider
 * registry over declared format routes, an explicit request→spec resolution step that plans the route,
 * and step-by-step execution with the intermediate files a multi-step plan needs.
 *
 * The seam owns selection and orchestration; a provider owns one converting mechanism. Selection never
 * depends on registration order — see `./plan.ts` for the ranking rules.
 * @module @deepseek-ai/dsh-document-convert
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defaultOutputPath, detectFormat, DOCUMENT_FORMATS } from './format.ts'
import { parseRouteKey, planRoute, routeKey } from './plan.ts'
import type {
  ConvertNote,
  ConvertOutcome,
  ConvertPlanStep,
  ConvertRequest,
  ConvertSpec,
  DocumentConvertProvider,
  DocumentFormat,
} from './types.ts'
import { ConvertError } from './types.ts'
import { verifyConvertedBytes } from './verify.ts'

export { ConvertError } from './types.ts'
export type {
  ConvertFidelity,
  ConvertNote,
  ConvertOutcome,
  ConvertPlan,
  ConvertPlanStep,
  ConvertRequest,
  ConvertRoute,
  ConvertSpec,
  ConvertStepSpec,
  DocumentConvertProvider,
  DocumentFamily,
  DocumentFormat,
} from './types.ts'
export {
  defaultOutputPath,
  detectFormat,
  DOCUMENT_FORMATS,
  formatFamily,
} from './format.ts'
export { parseRouteKey, routeKey } from './plan.ts'
export { isZipContainer, readOdfMediaType, readZipEntries, zeroCrcEntries } from './container.ts'
export type { ZipEntry } from './container.ts'
export { verifyConvertedBytes } from './verify.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    documentConvert: DocumentConvertRuntime
  }
}

/**
 * Config for the conversion seam.
 *
 * `maxSteps` bounds how far planning will chain converters. Two is the shipped ceiling because one hop
 * covers every conversion a single converter performs and the second exists to reach a target through an
 * intermediate format; raising it buys increasingly dubious chains, and lowering it to 1 restricts the
 * seam to conversions some registered provider performs directly.
 *
 * `routes` pins an edge to one provider, spelled `{ 'docx->html': 'pandoc' }`. It is the remedy a
 * `CONVERT_ROUTE_AMBIGUOUS` failure names, and the way a composition overrides the fidelity/priority
 * ranking for a pair it has an opinion about.
 *
 * `tempDir` is the parent directory for the scratch directory a multi-step plan writes intermediates
 * into.
 *
 * `maxVerifyBytes` bounds the output-verification read. Every step's result is read back and checked
 * against its target format, which needs the whole file in memory; above this size the check is skipped,
 * because the failures it catches — an empty export, a container of the wrong type — produce small files,
 * and a converter that wrote tens of megabytes wrote a document.
 */
export interface DocumentConvertConfig {
  /** Maximum converter steps one plan may chain. */
  readonly maxSteps?: number
  /** Edge key (`<from>-><to>`) to the provider id that must serve it. */
  readonly routes?: Readonly<Record<string, string>>
  /** Parent directory for per-conversion scratch directories. */
  readonly tempDir?: string
  /** Largest output, in bytes, that is read back and verified. */
  readonly maxVerifyBytes?: number
}

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<DocumentConvertConfig>

/**
 * The document conversion service. Registered as `ctx.documentConvert` (one instance per context).
 *
 * Usage is two explicit phases: {@link resolve} applies every default and plans the route, failing loud
 * when the request cannot be served; {@link run} executes the resolved plan. Keeping them apart lets a
 * caller learn the output path and the fidelity it is about to accept before anything is written.
 */
export class DocumentConvertRuntime extends Service {
  /** Planning ceiling, edge pins, scratch-directory parent, and verification read limit. */
  static Config: z<DocumentConvertConfig> = z.object({
    maxSteps: z.number().default(2),
    routes: z.dict(z.string()).default({}),
    tempDir: z.string().default(tmpdir()),
    maxVerifyBytes: z.number().default(64 * 1024 * 1024),
  })

  private readonly providers = new Map<string, DocumentConvertProvider>()
  private readonly config: ResolvedConfig
  private readonly pinned: ReadonlyMap<string, string>

  constructor(ctx: Context, config: DocumentConvertConfig = {}) {
    super(ctx, 'documentConvert')
    this.config = config as ResolvedConfig
    if (!Number.isInteger(this.config.maxSteps) || this.config.maxSteps < 1) {
      throw new ConvertError('maxSteps must be a positive integer', 'CONVERT_CONFIG_INVALID')
    }
    // Key syntax and format names are self-contained, so a typo fails here rather than on the first
    // conversion. Whether the named provider exists is not self-contained and is checked at planning.
    const pinned = new Map<string, string>()
    for (const [key, providerId] of Object.entries(this.config.routes)) {
      const { from, to } = parseRouteKey(key)
      pinned.set(routeKey(from, to), providerId)
    }
    this.pinned = pinned
  }

  /**
   * Register a conversion provider. Throws {@link ConvertError} `CONVERT_DUPLICATE_PROVIDER` if its id is
   * already registered. Returns a disposer; disposed with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: DocumentConvertProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new ConvertError(`a conversion provider with id "${provider.id}" is already registered`, 'CONVERT_DUPLICATE_PROVIDER')
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'documentConvert.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous fire-and-forget —
    // discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Apply every default to a request and plan its route. This is the seam's only defaulting step: the
   * source format comes from the source path's extension when unstated, the output path is derived
   * beside the source when unstated, and the route is chosen from the currently usable providers.
   *
   * @param request - the source path, target format, and any explicit overrides.
   * @returns the fully-resolved conversion, including the plan and its fidelity.
   * @throws {@link ConvertError} `CONVERT_FORMAT_UNKNOWN` when the source format is neither stated nor
   *   readable from the path, plus any planning failure from `planRoute`.
   */
  resolve(request: ConvertRequest): ConvertSpec {
    const sourceFormat = request.sourceFormat ?? detectFormat(request.sourcePath)
    if (sourceFormat === undefined) {
      const known = DOCUMENT_FORMATS.join(', ')
      throw new ConvertError(
        `cannot tell the format of "${request.sourcePath}" from its extension; known formats: ${known}`,
        'CONVERT_FORMAT_UNKNOWN',
      )
    }
    const plan = planRoute(sourceFormat, request.targetFormat, {
      providers: [...this.providers.values()],
      maxSteps: this.config.maxSteps,
      pinned: this.pinned,
    })
    return {
      sourcePath: request.sourcePath,
      sourceFormat,
      outputPath: request.outputPath ?? defaultOutputPath(request.sourcePath, request.targetFormat),
      targetFormat: request.targetFormat,
      plan,
    }
  }

  /**
   * Execute a resolved conversion. Each step runs through its planned provider; a multi-step plan writes
   * its intermediates into a scratch directory that is removed whether the conversion succeeds or fails,
   * and only the final step writes `spec.outputPath`.
   *
   * Every step's result is checked against its target format before the next step reads it, so a
   * converter that reported success without producing a usable document fails here rather than handing
   * back a file that opens empty. A rejected file is deleted, including at the destination.
   *
   * @param spec - the resolved conversion from {@link resolve}.
   * @param signal - optional cancellation signal, checked between steps and forwarded to providers.
   * @returns what was written: the path, the executed steps, the fidelity, the byte size, and the notes
   *   the steps reported about what the document lost.
   * @throws {@link ConvertError} `CONVERT_CANCELLED` when the signal fires, `CONVERT_PROVIDER_UNAVAILABLE`
   *   when a planned provider is no longer registered, `CONVERT_OUTPUT_MISSING` when a step reports
   *   success without producing its file, or `CONVERT_OUTPUT_UNUSABLE` when it produces one that is not a
   *   document of the format it promised.
   */
  async run(spec: ConvertSpec, signal?: AbortSignal): Promise<ConvertOutcome> {
    const scratch = spec.plan.steps.length > 1
      ? await mkdtemp(join(this.config.tempDir, 'dsh-convert-'))
      : undefined
    try {
      const notes = new Map<string, ConvertNote>()
      let sourcePath = spec.sourcePath
      let bytes = 0
      for (const [index, step] of spec.plan.steps.entries()) {
        this.assertNotCancelled(signal)
        const last = index === spec.plan.steps.length - 1
        const outputPath = last
          ? spec.outputPath
          // A non-final step always has a scratch directory: one is created for every multi-step plan.
          : join(scratch as string, `step-${index}.${step.to}`)
        // A code names a fixed consequence, so two steps that report the same one describe one loss; the
        // caller is told what the document lost, not how many converters mentioned it.
        for (const note of await this.runStep(step, sourcePath, outputPath, signal)) {
          if (!notes.has(note.code)) notes.set(note.code, note)
        }
        bytes = await this.acceptOutput(outputPath, step.to)
        sourcePath = outputPath
      }
      return {
        outputPath: spec.outputPath,
        sourceFormat: spec.sourceFormat,
        targetFormat: spec.targetFormat,
        fidelity: spec.plan.fidelity,
        steps: spec.plan.steps,
        bytes,
        notes: [...notes.values()],
      }
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
    }
  }

  /** Run one planned step through its provider and return the notes it reported. */
  private async runStep(
    step: ConvertPlanStep,
    sourcePath: string,
    outputPath: string,
    signal: AbortSignal | undefined,
  ): Promise<readonly ConvertNote[]> {
    const provider = this.providers.get(step.providerId)
    if (provider === undefined || !provider.available()) {
      throw new ConvertError(
        `provider "${step.providerId}" planned for ${routeKey(step.from, step.to)} is no longer usable`,
        'CONVERT_PROVIDER_UNAVAILABLE',
      )
    }
    return await provider.convert({
      sourcePath,
      sourceFormat: step.from,
      outputPath,
      targetFormat: step.to,
    }, signal)
  }

  /**
   * Accept a step's output, or delete it and refuse. Returns its size in bytes.
   *
   * Deleting a rejected file is the point rather than tidiness: the alternative is leaving a document at
   * the path the caller asked for, which reads to everyone downstream as a conversion that worked.
   */
  private async acceptOutput(outputPath: string, format: DocumentFormat): Promise<number> {
    const info = await stat(outputPath).catch(() => undefined)
    if (info === undefined || !info.isFile()) {
      throw new ConvertError(`the converter reported success but wrote no file at "${outputPath}"`, 'CONVERT_OUTPUT_MISSING')
    }
    if (info.size > this.config.maxVerifyBytes) return info.size
    const reason = verifyConvertedBytes(format, await readFile(outputPath))
    if (reason !== undefined) {
      await rm(outputPath, { force: true })
      throw new ConvertError(
        `the converter reported success but did not produce a usable ${format} file: ${reason}`,
        'CONVERT_OUTPUT_UNUSABLE',
      )
    }
    return info.size
  }

  /** Stop before starting more work once the caller has abandoned the conversion. */
  private assertNotCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) throw new ConvertError('the conversion was cancelled', 'CONVERT_CANCELLED')
  }
}

export default DocumentConvertRuntime
