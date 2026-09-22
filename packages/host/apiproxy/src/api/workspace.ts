/**
 * workspace domain contract. Wire projection of the host-side workspace
 * entity (@deepseek-ai/dsh-workspace): a stable id over a directory path,
 * a display title, and the ordered session account. Method signatures are the
 * source of truth, same as the sessions domain.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side workspace id brand. Deliberately re-declared here rather than
 * imported from dsh-workspace: api/ must stay browser-importable with zero
 * host-package dependencies, and the brand string matches, so both sides
 * agree structurally.
 */
export type WorkspaceId = Branded<'WorkspaceId'>

/**
 * Wire-side collection id brand, re-declared for the same browser-importability
 * reason as {@link WorkspaceId}; the brand string matches dsh-workspace's.
 */
export type CollectionId = Branded<'CollectionId'>

/** One workspace row: the record projection every workspace.* value carries. */
export interface WorkspaceView {
  workspaceId: WorkspaceId
  /** Canonical directory path (host-side realpath canon). */
  path: string
  /** Display title (defaults to the path basename at create). */
  title: string
  /**
   * Sessions accounted under this workspace, in manually owned order
   * (attach prepends, insertSessionBefore reorders; activity never does).
   */
  sessionIds: SessionId[]
  /** ISO-8601 creation instant. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

/**
 * One collection row: the record projection every collection-mutating
 * `workspace.*` value carries. A collection is a view over sessions, so
 * membership lives here rather than in any {@link WorkspaceView}.
 */
export interface CollectionView {
  /** Stable collection id (generated uuid); survives rename. */
  collectionId: CollectionId
  /** Display title. Duplicates across collections are allowed. */
  title: string
  /** Member sessions in manual order: adding appends, activity never reorders. */
  sessionIds: SessionId[]
  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

/** Workspace-domain unary methods (the map keys workspace.* of RpcMethodMap). */
export interface WorkspaceApi {
  /**
   * Lists all workspaces in the registry's durable display order, plus the
   * registry-global archive set (the reconnect baseline of
   * `host/archived-sessions-changed`), the ordered collections (the baseline
   * of `host/collections-changed`), and the soft-delete set (the baseline of
   * `host/deleted-sessions-changed`). Archived sessions stay in their
   * workspace's `sessionIds` account; grouping surfaces hide them.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{
    items: WorkspaceView[]
    archivedSessionIds: SessionId[]
    collections: CollectionView[]
    deletedSessionIds: SessionId[]
  }>>

  /**
   * Creates (or idempotently resolves) a workspace over an EXISTING directory
   * (no mkdir — a missing or non-directory path fails with
   * `workspace-invalid-path`). A path resolving to a directory already owned
   * by a workspace returns that workspace (`created: false`). Adoption allows
   * distinct canonical paths whose basenames produce the same display title;
   * the registry's basename title default names the new workspace.
   */
  create(request: RpcRequest<{ path: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>>

  /**
   * Renames a workspace. `title` is trimmed and must be non-empty
   * (schema-enforced). An unknown id fails with `workspace-not-found`; a
   * title equal to another workspace's fails with `workspace-name-conflict`.
   * Renaming to the current title is a no-op success (no durable write).
   */
  rename(request: RpcRequest<{ workspaceId: WorkspaceId; title: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Removes one Workspace registration. The directory, every user file, and
   * every session log remain untouched; those Sessions consequently become
   * ungrouped. An unknown id fails with `workspace-not-found`.
   */
  delete(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ deleted: true }>>

  /**
   * Moves one Workspace within the registry display order,
   * DOM-insertBefore-like. An omitted anchor appends to the end.
   */
  insertBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    beforeWorkspaceId?: WorkspaceId
  }>): Promise<RpcResponse<{ workspaceIds: WorkspaceId[] }>>

  /**
   * Moves an accounted session within its workspace's manual order,
   * DOM-insertBefore-like: with `beforeSessionId` the session is inserted
   * before that anchor; omitted appends to the end. An unknown workspace
   * fails with `workspace-not-found`; a session or anchor not accounted by
   * the workspace fails with `workspace-move-invalid`. A move to the current
   * position is a no-op success.
   */
  insertSessionBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    sessionId: SessionId
    beforeSessionId?: SessionId
  }>): Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Adds one session to the registry-global archive set: the session
   * disappears from every grouping surface but keeps its session log and its
   * workspace accounting slot (a future unarchive restores its position).
   * Idempotent for an already archived id. A session neither live nor in
   * session persistence fails with `session-not-found`. Returns the full
   * updated set (same snapshot the changed frame carries).
   */
  archiveSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>

  /**
   * Removes one session from the registry-global archive set, making it
   * visible on the grouping surfaces again. Its workspace accounting slot was
   * never dropped, so it returns to the position it held before archiving.
   * Idempotent for an id that is not archived. A session neither live nor in
   * session persistence fails with `session-not-found`. Returns the full
   * updated set (same snapshot the changed frame carries).
   */
  unarchiveSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>

  /**
   * Creates an empty collection (a named, ordered view over sessions, not a
   * second owner of them). The title must be non-blank (schema-enforced);
   * duplicate titles are allowed since the id is the reference. Returns the
   * full updated ordered collection list (the snapshot
   * `host/collections-changed` carries).
   */
  createCollection(request: RpcRequest<{ title: string }>):
  Promise<RpcResponse<{ collections: CollectionView[] }>>

  /**
   * Replaces one collection's display title. The title must be non-blank
   * (schema-enforced); renaming to the current title is a no-op success. An
   * unknown collection fails with `collection-not-found`. Returns the full
   * updated ordered collection list.
   */
  renameCollection(request: RpcRequest<{ collectionId: CollectionId; title: string }>):
  Promise<RpcResponse<{ collections: CollectionView[] }>>

  /**
   * Deletes one collection. Member sessions are untouched: they simply stop
   * being filed under it, keeping every other membership and their workspace
   * accounting. An unknown collection fails with `collection-not-found`.
   * Returns the full updated ordered collection list.
   */
  deleteCollection(request: RpcRequest<{ collectionId: CollectionId }>):
  Promise<RpcResponse<{ collections: CollectionView[] }>>

  /**
   * Files one session under a collection, appended at the end of its manual
   * order; activity never reorders. Already a member is an idempotent no-op
   * success. An unknown collection fails with `collection-not-found`; a
   * session neither live nor in session persistence fails with
   * `session-not-found`. Returns the full updated ordered collection list.
   */
  addSessionToCollection(request: RpcRequest<{ collectionId: CollectionId; sessionId: SessionId }>):
  Promise<RpcResponse<{ collections: CollectionView[] }>>

  /**
   * Takes one session out of a collection. Idempotent and deliberately no
   * existence check: removing a reference cannot create a dangling one. An
   * unknown collection fails with `collection-not-found`. Returns the full
   * updated ordered collection list.
   */
  removeSessionFromCollection(request: RpcRequest<{ collectionId: CollectionId; sessionId: SessionId }>):
  Promise<RpcResponse<{ collections: CollectionView[] }>>

  /**
   * The registry-global ordered collection list, the reconnect baseline of
   * `host/collections-changed` re-read without a full `workspace.list`.
   */
  listCollections(request: RpcRequest<{}>):
  Promise<RpcResponse<{ collections: CollectionView[] }>>

  /**
   * Soft-deletes one session: hides it from every grouping surface while its
   * stored log stays on disk, so {@link restoreSession} can bring it back. It
   * leaves the archive set and every collection account but keeps its
   * workspace `sessionIds` slot. Idempotent for an already deleted id. A
   * session neither live nor in session persistence fails with
   * `session-not-found`. Returns the full updated soft-delete set (the
   * snapshot `host/deleted-sessions-changed` carries).
   */
  deleteSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ deletedSessionIds: SessionId[] }>>

  /**
   * Restores a soft-deleted session to the visible set: unarchived and in no
   * collection, because deletion dropped both, at the workspace position it
   * kept. An id that is not deleted is an idempotent no-op success. A session
   * neither live nor in session persistence fails with `session-not-found`.
   * Returns the full updated soft-delete set.
   */
  restoreSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ deletedSessionIds: SessionId[] }>>

  /**
   * The registry-global soft-delete set, the reconnect baseline of
   * `host/deleted-sessions-changed` re-read without a full `workspace.list`.
   */
  listDeletedSessions(request: RpcRequest<{}>):
  Promise<RpcResponse<{ deletedSessionIds: SessionId[] }>>
}
