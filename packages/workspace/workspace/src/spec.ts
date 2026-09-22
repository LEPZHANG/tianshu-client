/**
 * The workspace domain declaration: record schema and the `defineDomain` spec
 * the registry opens. The zod schema is the durable-boundary validator today
 * and the direct source of the RPC wire projection in a later phase.
 * @module @deepseek-ai/dsh-workspace/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CollectionId, WorkspaceId } from './types.ts'

/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceId = z.string().transform(value => value as WorkspaceId)

/** Collection id schema at the durable boundary, for the same reason. */
const collectionId = z.string().transform(value => value as CollectionId)

/**
 * Durable shape of one workspace record. `path` is the `fs.realpath` canon
 * stamped at create; `sessionIds` is the ordered ownership account (array
 * order is display order); timestamps are ISO-8601 strings.
 */
export const workspaceRecord = z.object({
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(z.string().transform(SessionId)),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored workspace record, inferred from {@link workspaceRecord}. */
export type WorkspaceRecord = z.infer<typeof workspaceRecord>

/**
 * Durable shape of one collection record. Unlike a workspace it carries no
 * path: a collection owns no directory, so nothing about it is filesystem
 * derived. `sessionIds` is the ordered membership (array order is display
 * order); timestamps are ISO-8601 strings.
 */
export const collectionRecord = z.object({
  id: collectionId,
  title: z.string(),
  sessionIds: z.array(z.string().transform(SessionId)),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored collection record, inferred from {@link collectionRecord}. */
export type CollectionRecord = z.infer<typeof collectionRecord>

/**
 * Recoverable two-write mutation marker. The marker is persisted before the
 * record/order pair can diverge, so startup can distinguish an interrupted
 * registry operation from unexplained medium corruption.
 */
const workspacePendingMutation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create'), workspaceId }),
  z.object({ operation: z.literal('delete'), workspaceId }),
])

/**
 * Durable registry state. `initialized` distinguishes a valid empty registry
 * from one that still needs the header-only history bootstrap;
 * `workspaceIds` is the authoritative display order. `archivedSessionIds` is
 * the registry-global archive set layered over workspace accounting: an
 * archived session keeps its `sessionIds` slot (unarchiving must restore the
 * position), so the set never participates in the one-owner accounting
 * invariant. `collections` is the registry-global collection list in display
 * order; a collection is a view over sessions, so membership never
 * participates in that invariant either. `deletedSessionIds` is the
 * registry-global soft-delete set: a deleted session leaves the archive set
 * and every collection account, while its workspace `sessionIds` slot is kept
 * so restoring returns it to the position it held.
 *
 * All three later fields are defaulted, so records written before they existed
 * parse unchanged and the domain {@link workspaceDomainSpec} keeps its
 * version: a version change rejects already-written media at open, which an
 * additive field does not warrant.
 */
export const workspaceDomainState = z.object({
  initialized: z.boolean(),
  workspaceIds: z.array(workspaceId),
  archivedSessionIds: z.array(z.string().transform(SessionId)).default([]),
  collections: z.array(collectionRecord).default([]),
  deletedSessionIds: z.array(z.string().transform(SessionId)).default([]),
  pendingMutation: workspacePendingMutation.optional(),
})

/** Durable registry state inferred from {@link workspaceDomainState}. */
export type WorkspaceDomainState = z.infer<typeof workspaceDomainState>

/**
 * The workspace domain spec: one `workspaces` table keyed by
 * {@link WorkspaceId} plus the bootstrap/order singleton. The registry opens
 * this through `ctx.storage.domain`; the spec object is the single source of
 * the domain's identity, version, and schemas.
 */
export const workspaceDomainSpec = defineDomain({
  name: 'workspace',
  version: 2,
  global: {
    schema: workspaceDomainState,
    initial: { initialized: false, workspaceIds: [], archivedSessionIds: [], collections: [], deletedSessionIds: [] },
  },
  tables: { workspaces: domainTable<WorkspaceId, WorkspaceRecord>(workspaceRecord) },
})
