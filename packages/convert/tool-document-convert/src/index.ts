/**
 * `@deepseek-ai/dsh-tool-document-convert`: registers the model-facing `convert_document` tool. A
 * function/namespace plugin (NOT a default-export service).
 * @module @deepseek-ai/dsh-tool-document-convert
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-document-convert'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-tools'
import { assertTimeoutBudget } from './policy.ts'
import { applyConvertDocumentTool } from './tool.ts'

export {
  applyConvertDocumentTool,
  CONVERTIBLE_FORMATS,
  convertDocumentTool,
  parseConvertArgs,
} from './tool.ts'
export {
  convertMetaFromResult,
  convertMetaFromValue,
  formatConvertOutput,
  plannedOutputPath,
  presentConvertCall,
  presentConvertResult,
} from './present.ts'
export {
  assertTimeoutBudget,
  assertWithinWorkspace,
  assertWritable,
  convertFileMetaFromResult,
  CONVERT_NOTES_SCHEMA,
  filePolicy,
  sessionCwd,
} from './policy.ts'
export type { ConvertFileMeta } from './policy.ts'
export type {
  ConvertMeta,
  ConvertOutputNote,
  ConvertOutputStep,
  ConvertOutputValue,
  ConvertToolArgs,
} from './present.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-document-convert'

/** The services the tool needs: the registries it joins, the conversion seam, and the filesystem. */
export const inject = ['tools', 'systemPrompt', 'documentConvert', 'fs']

/** Plugin config: the deployment's tool-call budget for one conversion. */
export interface Config {
  /**
   * Cooperative tool-call budget in milliseconds. The default is large because a cold LibreOffice start
   * costs seconds before the document is read, and a multi-step plan pays that cost per step.
   */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(120_000),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Register the conversion tool and its prompt section.
 * @param ctx - context carrying `tools`, `systemPrompt`, `documentConvert`, and `fs`; both registrations
 *   are effect-scoped and unregister on plugin dispose.
 * @param config - the plugin config after schemastery defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = config as ResolvedConfig
  assertTimeoutBudget('tool-document-convert', resolved.timeoutMs)
  applyConvertDocumentTool(ctx, resolved.timeoutMs)
}
