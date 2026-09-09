/**
 * The outward workspaces-service face — what `ctx.workspaces` exposes to
 * feature packages and the renderer host, and therefore exactly what the
 * test runtime's workspaces double must implement. Wire-pump entry points
 * (handleHostEnvelope/handleConnected/refresh/startInitialSelection) stay on
 * the concrete class. Widening this interface is the explicit act of
 * widening what features may do to the workspaces domain.
 */
import type {
  CollectionId, CollectionView, DirectoryListing, SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceListState } from '../workspaces/service.ts'
import type { ObservableSnapshot } from './store.ts'

/** The workspaces-service face injected as `ctx.workspaces`. */
export interface IWorkspaces {
  /** The useWorkspaces standard feed (read face — writes stay inside the domain). */
  readonly list: ObservableSnapshot<WorkspaceListState>
  /**
   * Connect a Workspace to its reusable or freshly created blank session.
   * @param workspaceId - target workspace.
   * @returns the connected session id.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * The New Session flow: connect the explicit, current-Session, or recent
   * Workspace and open the resulting session; failures surface on the session
   * list state.
   * @param workspaceId - explicit target; omitted inherits the current
   * Session's Workspace before falling back to the recency projection.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Register an existing path as a Workspace.
   * @param input - the Host create payload.
   * @returns the created or idempotently resolved Workspace.
   */
  create(input: { path: string }): Promise<WorkspaceView>
  /**
   * Open the Host's native directory picker.
   * @returns the selected path, or null when the user cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one directory level through the Host's `browse` capability.
   * @param path - absolute directory to list; absent lists the Host home directory.
   * @param signal - aborts the wire request (and the Host's scan) when the caller supersedes it.
   * @returns the level's listing with breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create one child directory through the Host's `browse` capability.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
  /**
   * Open a filesystem path with the Host operating system's default application.
   * @param path - absolute or host-resolvable path.
   */
  openPath(path: string): Promise<void>
  /**
   * Rename a Workspace.
   * @param workspaceId - target workspace.
   * @param title - the new display title.
   * @returns the updated Workspace view.
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
  /**
   * Delete a Workspace (its sessions fall back to the unaccounted group).
   * @param workspaceId - target workspace.
   */
  delete(workspaceId: WorkspaceId): Promise<void>
  /**
   * Move a Workspace within the registry display order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  /**
   * Move an accounted session within/into a Workspace's ordered list.
   * @param workspaceId - target workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the updated Workspace view.
   */
  insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<WorkspaceView>
  /**
   * Archive a session into the registry-global set (hidden from grouping
   * surfaces; session log and accounting slot remain). Archiving the current
   * session clears the selection into the New Session view state.
   * @param sessionId - session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>

  /**
   * Unarchive a session: the inverse of {@link archiveSession}. The session
   * returns to every grouping surface in the workspace position it held before
   * archiving. An id that is not archived resolves without a host write.
   * @param sessionId - session to return to the visible set.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>

  /**
   * Create an empty collection.
   * @param title - the non-blank display title.
   * @returns the ordered collections after the create.
   */
  createCollection(title: string): Promise<readonly CollectionView[]>
  /**
   * Rename a collection.
   * @param collectionId - target collection.
   * @param title - the new non-blank display title.
   */
  renameCollection(collectionId: CollectionId, title: string): Promise<void>
  /**
   * Delete a collection; its member sessions keep every other membership.
   * @param collectionId - target collection.
   */
  deleteCollection(collectionId: CollectionId): Promise<void>
  /**
   * File a session under a collection.
   * @param collectionId - target collection.
   * @param sessionId - session to file.
   */
  addSessionToCollection(collectionId: CollectionId, sessionId: SessionId): Promise<void>
  /**
   * Take a session out of a collection.
   * @param collectionId - target collection.
   * @param sessionId - session to unfile.
   */
  removeSessionFromCollection(collectionId: CollectionId, sessionId: SessionId): Promise<void>
  /**
   * Re-read the ordered collection list.
   * @returns the collections the Host currently holds.
   */
  listCollections(): Promise<readonly CollectionView[]>
  /**
   * Soft-delete a session (hidden from grouping surfaces; log kept on disk).
   * @param sessionId - session to delete.
   */
  deleteSession(sessionId: SessionId): Promise<void>
  /**
   * Restore a soft-deleted session to the visible set.
   * @param sessionId - session to restore.
   */
  restoreSession(sessionId: SessionId): Promise<void>
  /**
   * Re-read the registry-global soft-delete set.
   * @returns the deleted session ids the Host currently holds.
   */
  listDeletedSessions(): Promise<readonly SessionId[]>
}
