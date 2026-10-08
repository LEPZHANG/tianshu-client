/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillEntry } from './skills.ts'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>

/** One suite row of the built-in catalogue's wire projection. */
const suiteEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  tag: z.string(),
  description: z.string(),
  skills: z.array(z.object({
    name: z.string(),
    title: z.string(),
    summary: z.string(),
  })),
  installed: z.boolean(),
  current: z.boolean(),
})

/** skill.suiteList response value: the full catalogue with install state. */
export const skillSuiteListValueSchema = z.object({
  suites: z.array(suiteEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.suiteList'>>>

/** skill.suiteInstall request payload. */
export const skillSuiteInstallRequestSchema = z.object({
  suiteId: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.suiteInstall'>>>

/** skill.suiteInstall response value: the full catalogue after the write. */
export const skillSuiteInstallValueSchema = z.object({
  suites: z.array(suiteEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.suiteInstall'>>>

/** skill.suiteUninstall request payload. */
export const skillSuiteUninstallRequestSchema = z.object({
  suiteId: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.suiteUninstall'>>>

/** skill.suiteUninstall response value: the full catalogue after the removal. */
export const skillSuiteUninstallValueSchema = z.object({
  suites: z.array(suiteEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.suiteUninstall'>>>
