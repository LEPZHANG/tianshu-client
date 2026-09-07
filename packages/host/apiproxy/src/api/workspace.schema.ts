/**
 * workspace domain zod schemas (names derived from map keys). The
 * WorkspaceId brand cast lives in sessions.schema (see the note there) and
 * is re-exported here as the domain-local name.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { CollectionView, WorkspaceView } from './workspace.ts'
import { sessionIdSchema, workspaceIdSchema } from './sessions.schema.ts'

export { workspaceIdSchema } from './sessions.schema.ts'

/** CollectionId brand cast at the wire boundary, the same posture as workspaceIdSchema. */
export const collectionIdSchema = z.string().min(1) as unknown as z.ZodType<CollectionView['collectionId']>

/** WorkspaceView row of every workspace.* response. */
export const workspaceViewSchema = z.object({
  workspaceId: workspaceIdSchema,
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(sessionIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<WorkspaceView>>

/** CollectionView row carried by the collection-mutating workspace.* values. */
export const collectionViewSchema = z.object({
  collectionId: collectionIdSchema,
  title: z.string(),
  sessionIds: z.array(sessionIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<CollectionView>>

/** workspace.list request payload (empty object literal). */
export const workspaceListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.list'>>>

/** workspace.list response value. */
export const workspaceListValueSchema = z.object({
  items: z.array(workspaceViewSchema),
  archivedSessionIds: z.array(sessionIdSchema),
  collections: z.array(collectionViewSchema),
  deletedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.list'>>>

/** workspace.create request payload: the existing directory to adopt. */
export const workspaceCreateRequestSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.create'>>>

/** workspace.create response value. */
export const workspaceCreateValueSchema = z.object({
  workspace: workspaceViewSchema,
  created: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.create'>>>

/** workspace.rename request payload: the new title must be non-blank. */
export const workspaceRenameRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.rename requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.rename'>>>

/** workspace.rename response value. */
export const workspaceRenameValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.rename'>>>

/** workspace.delete request payload. */
export const workspaceDeleteRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.delete'>>>

/** workspace.delete response value. */
export const workspaceDeleteValueSchema = z.object({
  deleted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.delete'>>>

/** workspace.insertBefore request payload (anchor omitted = append to end). */
export const workspaceInsertBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  beforeWorkspaceId: workspaceIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertBefore'>>>

/** workspace.insertBefore response value: the complete durable display order. */
export const workspaceInsertBeforeValueSchema = z.object({
  workspaceIds: z.array(workspaceIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertBefore'>>>

/** workspace.insertSessionBefore request payload (anchor omitted = append to end). */
export const workspaceInsertSessionBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
  beforeSessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertSessionBefore'>>>

/** workspace.insertSessionBefore response value. */
export const workspaceInsertSessionBeforeValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertSessionBefore'>>>

/** workspace.archiveSession request payload. */
export const workspaceArchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.archiveSession'>>>

/** workspace.archiveSession response value: the full updated archive set. */
export const workspaceArchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.archiveSession'>>>

/** workspace.unarchiveSession request payload. */
export const workspaceUnarchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.unarchiveSession'>>>

/** workspace.unarchiveSession response value: the full updated archive set. */
export const workspaceUnarchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.unarchiveSession'>>>

/** workspace.createCollection request payload: the non-blank title. */
export const workspaceCreateCollectionRequestSchema = z.object({
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.createCollection requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.createCollection'>>>

/** workspace.createCollection response value: the full updated collection list. */
export const workspaceCreateCollectionValueSchema = z.object({
  collections: z.array(collectionViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.createCollection'>>>

/** workspace.renameCollection request payload: the new non-blank title. */
export const workspaceRenameCollectionRequestSchema = z.object({
  collectionId: collectionIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.renameCollection requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.renameCollection'>>>

/** workspace.renameCollection response value: the full updated collection list. */
export const workspaceRenameCollectionValueSchema = z.object({
  collections: z.array(collectionViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.renameCollection'>>>

/** workspace.deleteCollection request payload. */
export const workspaceDeleteCollectionRequestSchema = z.object({
  collectionId: collectionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.deleteCollection'>>>

/** workspace.deleteCollection response value: the full updated collection list. */
export const workspaceDeleteCollectionValueSchema = z.object({
  collections: z.array(collectionViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.deleteCollection'>>>

/** workspace.addSessionToCollection request payload. */
export const workspaceAddSessionToCollectionRequestSchema = z.object({
  collectionId: collectionIdSchema,
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.addSessionToCollection'>>>

/** workspace.addSessionToCollection response value: the full updated collection list. */
export const workspaceAddSessionToCollectionValueSchema = z.object({
  collections: z.array(collectionViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.addSessionToCollection'>>>

/** workspace.removeSessionFromCollection request payload. */
export const workspaceRemoveSessionFromCollectionRequestSchema = z.object({
  collectionId: collectionIdSchema,
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.removeSessionFromCollection'>>>

/** workspace.removeSessionFromCollection response value: the full updated collection list. */
export const workspaceRemoveSessionFromCollectionValueSchema = z.object({
  collections: z.array(collectionViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.removeSessionFromCollection'>>>

/** workspace.listCollections request payload (empty object literal). */
export const workspaceListCollectionsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.listCollections'>>>

/** workspace.listCollections response value: the full ordered collection list. */
export const workspaceListCollectionsValueSchema = z.object({
  collections: z.array(collectionViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.listCollections'>>>

/** workspace.deleteSession request payload. */
export const workspaceDeleteSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.deleteSession'>>>

/** workspace.deleteSession response value: the full updated soft-delete set. */
export const workspaceDeleteSessionValueSchema = z.object({
  deletedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.deleteSession'>>>

/** workspace.restoreSession request payload. */
export const workspaceRestoreSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.restoreSession'>>>

/** workspace.restoreSession response value: the full updated soft-delete set. */
export const workspaceRestoreSessionValueSchema = z.object({
  deletedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.restoreSession'>>>

/** workspace.listDeletedSessions request payload (empty object literal). */
export const workspaceListDeletedSessionsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.listDeletedSessions'>>>

/** workspace.listDeletedSessions response value: the full soft-delete set. */
export const workspaceListDeletedSessionsValueSchema = z.object({
  deletedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.listDeletedSessions'>>>
