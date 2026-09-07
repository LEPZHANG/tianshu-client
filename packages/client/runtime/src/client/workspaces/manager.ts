/** Workspace baseline, incremental-frame, and unary-action owner. */

import type {
  CollectionId, CollectionView, HostFrame, IApiClient, RpcError, RpcRequest, RpcResult, SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import { Notifier } from '../sessions/notifier.ts'
import { Workspace, type WorkspaceCreateInput } from './workspace.ts'

/** Monotone workspace-list arrival lifecycle. */
export type WorkspaceListPhase = 'pending' | 'ready'

/** Immutable workspace-list snapshot. */
export interface WorkspaceListSnapshot {
  items: readonly WorkspaceView[]
  /**
   * Registry-global archive set in Host order (hidden from grouping
   * surfaces; accounting slots retained). A plain array, not a Set: public
   * snapshot state stays in the store engine's plain-data vocabulary
   * (immer drafts reject Sets without the MapSet plugin); membership
   * lookups build their own transient Set where they need one.
   */
  archivedSessionIds: readonly SessionId[]
  /**
   * Registry-global collections in Host display order (a view over sessions;
   * membership never changes workspace accounting). Plain data so the store
   * engine can carry it; a full snapshot replaced on every change.
   */
  collections: readonly CollectionView[]
  /**
   * Registry-global soft-delete set in Host order: hidden from every grouping
   * surface while its stored log stays on disk. Plain array, like the archive
   * set.
   */
  deletedSessionIds: readonly SessionId[]
  state: 'idle' | 'loading' | 'error'
  phase: WorkspaceListPhase
  error: RpcError | null
}

type WorkspaceDelta =
  | { type: 'upsert'; workspace: WorkspaceView }
  | { type: 'remove'; workspaceId: WorkspaceId }
  | { type: 'order'; workspaceIds: readonly WorkspaceId[] }

/** Workspace object cluster driven by one list baseline and changed-frame upserts. */
export class WorkspaceManager {
  private items: Workspace[] = []
  private itemViewsSource: readonly Workspace[] | null = null
  private itemViewsCache: readonly WorkspaceView[] = []
  // Full-snapshot state (list response / unary response / changed frame all
  // carry the complete set), so deltas never merge — installs replace.
  private archivedSessionIds: readonly SessionId[] = []
  private collections: readonly CollectionView[] = []
  private deletedSessionIds: readonly SessionId[] = []
  private state: WorkspaceListSnapshot['state'] = 'idle'
  private phase: WorkspaceListPhase = 'pending'
  private error: RpcError | null = null
  private inflight: Promise<void> | null = null
  private refreshFrames: WorkspaceDelta[] | null = null
  /**
   * True once a frame or unary echo installed the archive set while a list
   * request was in flight: that install is newer than the pending baseline,
   * so the baseline's (older) set must not roll it back — the archive
   * mirror of replaying refreshFrames over the item baseline.
   */
  private archivedSupersedesRefresh = false
  /**
   * Collection and soft-delete mirrors of {@link archivedSupersedesRefresh}:
   * a frame or unary echo that installed one while a list request was in
   * flight outranks that baseline's older value.
   */
  private collectionsSupersedesRefresh = false
  private deletedSupersedesRefresh = false
  /** Latest local reorder request; only its unary echo may install order. */
  private orderRequestGeneration = 0
  /** Increments on order frames so a later remote commit outranks an older unary echo. */
  private orderFrameGeneration = 0
  /** Last complete order accepted from a Host baseline, frame, or current unary echo. */
  private committedOrder: WorkspaceId[] = []
  /**
   * Ids this process has seen removed, kept for the connection's lifetime so
   * a late changed frame or a stale baseline row cannot resurrect a deleted
   * row. Correctness rests on Host ids never being reused (the registry mints
   * a fresh `randomUUID` per record, including when the same directory is
   * registered again) — a path-derived id scheme would turn these entries
   * into permanent blindfolds and must clear them instead.
   */
  private readonly removedIds = new Set<WorkspaceId>()
  private snapshotCache: WorkspaceListSnapshot
  private readonly notifier = new Notifier(() => {
    this.snapshotCache = this.buildSnapshot()
  })

  /** @param api - shared wire client. */
  constructor(private readonly api: IApiClient) {
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Refresh from workspace.list. The first successful response establishes
   * Host order; later responses re-establish the durable order so reconnects
   * adopt reorders committed while this client was offline. Frames arriving
   * during the RPC are replayed over its response.
   * @returns the shared in-flight refresh.
   */
  refresh(): Promise<void> {
    if (this.inflight !== null) return this.inflight
    this.state = 'loading'
    this.error = null
    const frames: WorkspaceDelta[] = []
    this.refreshFrames = frames
    this.notifier.markDirty()
    this.inflight = (async () => {
      try {
        const { result } = await this.api.workspace.list({})
        if (result.ok) {
          let items = result.value.items
          items = items.filter(workspace => !this.removedIds.has(workspace.workspaceId))
          for (const delta of frames) items = applyWorkspaceDelta(items, delta)
          this.installViews(items)
          if (!this.archivedSupersedesRefresh) this.installArchived(result.value.archivedSessionIds)
          if (!this.collectionsSupersedesRefresh) this.installCollections(result.value.collections)
          if (!this.deletedSupersedesRefresh) this.installDeleted(result.value.deletedSessionIds)
          this.state = 'idle'
          this.phase = 'ready'
        } else {
          this.state = 'error'
          this.error = result.error
        }
      } catch (error) {
        this.state = 'error'
        const folded = transportError<never>(error)
        /* v8 ignore next -- transportError always returns the failure branch. */
        this.error = folded.ok ? null : folded.error
      } finally {
        this.refreshFrames = null
        this.archivedSupersedesRefresh = false
        this.collectionsSupersedesRefresh = false
        this.deletedSupersedesRefresh = false
        this.inflight = null
        this.notifier.markDirty()
      }
    })()
    return this.inflight
  }

  /**
   * Create or resolve a real Workspace, then publish its returned snapshot
   * without waiting for the changed frame.
   * @param input - the existing absolute path to adopt.
   * @returns the wire result.
   */
  async create(input: WorkspaceCreateInput): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> {
    const workspace = new Workspace(this.api, input)
    const completion = workspace.materialize()
    if (completion === undefined) throw new Error('a local Workspace must be materializable')
    const result = await completion
    if (result.ok) this.upsert(result.value.workspace, workspace)
    return result
  }

  /**
   * Rename a Workspace, then publish its returned snapshot without waiting
   * for the changed frame.
   * @param workspaceId - target workspace.
   * @param title - new display title.
   * @returns the wire result.
   */
  async rename(workspaceId: WorkspaceId, title: string): Promise<RpcResult<{ workspace: WorkspaceView }>> {
    const { result } = await this.api.workspace.rename({ workspaceId, title })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Delete a Workspace registration and remove its local projection from the
   * unary response without waiting for the Host frame.
   * @param workspaceId - target workspace.
   * @returns the wire result.
   */
  async delete(workspaceId: WorkspaceId): Promise<RpcResult<{ deleted: true }>> {
    const { result } = await this.api.workspace.delete({ workspaceId })
    if (result.ok) this.remove(workspaceId, true)
    return result
  }

  /**
   * Move a Workspace within the registry display order and install the full
   * returned order without waiting for the Host frame.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   * @returns the wire result.
   */
  async insertBefore(
    workspaceId: WorkspaceId,
    beforeWorkspaceId?: WorkspaceId,
  ): Promise<RpcResult<{ workspaceIds: WorkspaceId[] }>> {
    const requestGeneration = ++this.orderRequestGeneration
    const frameGeneration = this.orderFrameGeneration
    const localOrder = this.itemViews().map(workspace => workspace.workspaceId)
    this.installOrder(insertIdBefore(localOrder, workspaceId, beforeWorkspaceId))
    let result: RpcResult<{ workspaceIds: WorkspaceId[] }>
    try {
      ;({ result } = await this.api.workspace.insertBefore({
        workspaceId,
        ...beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId },
      }))
    } catch (error) {
      if (requestGeneration === this.orderRequestGeneration
        && frameGeneration === this.orderFrameGeneration) {
        this.installOrder(this.committedOrder)
      }
      throw error
    }
    if (result.ok && requestGeneration === this.orderRequestGeneration
      && frameGeneration === this.orderFrameGeneration) {
      this.installOrder(result.value.workspaceIds, true)
    } else if (!result.ok && requestGeneration === this.orderRequestGeneration
      && frameGeneration === this.orderFrameGeneration) {
      this.installOrder(this.committedOrder)
    }
    return result
  }

  /**
   * Move a session within its Workspace's manual order, then publish the
   * returned snapshot without waiting for the changed frame.
   * @param workspaceId - owning workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the wire result.
   */
  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<RpcResult<{ workspace: WorkspaceView }>> {
    const { result } = await this.api.workspace.insertSessionBefore({
      workspaceId, sessionId,
      ...beforeSessionId === undefined ? {} : { beforeSessionId },
    })
    if (result.ok) this.upsert(result.value.workspace)
    return result
  }

  /**
   * Archive one session in the registry-global set, then install the
   * returned full set without waiting for the changed frame.
   * @param sessionId - session to archive.
   * @returns the wire result.
   */
  async archiveSession(sessionId: SessionId): Promise<RpcResult<{ archivedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.archiveSession({ sessionId })
    if (result.ok) this.installArchived(result.value.archivedSessionIds)
    return result
  }

  /**
   * Take one session out of the registry-global archive set, then install the
   * returned full set without waiting for the changed frame.
   * @param sessionId - session to unarchive.
   * @returns the wire result.
   */
  async unarchiveSession(sessionId: SessionId): Promise<RpcResult<{ archivedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.unarchiveSession({ sessionId })
    if (result.ok) this.installArchived(result.value.archivedSessionIds)
    return result
  }

  /**
   * Create an empty collection, then install the returned full collection list
   * without waiting for the changed frame.
   * @param title - the non-blank display title.
   * @returns the wire result.
   */
  async createCollection(title: string): Promise<RpcResult<{ collections: CollectionView[] }>> {
    const { result } = await this.api.workspace.createCollection({ title })
    if (result.ok) this.installCollections(result.value.collections)
    return result
  }

  /**
   * Rename a collection, then install the returned full collection list
   * without waiting for the changed frame.
   * @param collectionId - target collection.
   * @param title - the new non-blank display title.
   * @returns the wire result.
   */
  async renameCollection(collectionId: CollectionId, title: string): Promise<RpcResult<{ collections: CollectionView[] }>> {
    const { result } = await this.api.workspace.renameCollection({ collectionId, title })
    if (result.ok) this.installCollections(result.value.collections)
    return result
  }

  /**
   * Delete a collection, then install the returned full collection list
   * without waiting for the changed frame.
   * @param collectionId - target collection.
   * @returns the wire result.
   */
  async deleteCollection(collectionId: CollectionId): Promise<RpcResult<{ collections: CollectionView[] }>> {
    const { result } = await this.api.workspace.deleteCollection({ collectionId })
    if (result.ok) this.installCollections(result.value.collections)
    return result
  }

  /**
   * File a session under a collection, then install the returned full
   * collection list without waiting for the changed frame.
   * @param collectionId - target collection.
   * @param sessionId - session to file.
   * @returns the wire result.
   */
  async addSessionToCollection(
    collectionId: CollectionId,
    sessionId: SessionId,
  ): Promise<RpcResult<{ collections: CollectionView[] }>> {
    const { result } = await this.api.workspace.addSessionToCollection({ collectionId, sessionId })
    if (result.ok) this.installCollections(result.value.collections)
    return result
  }

  /**
   * Take a session out of a collection, then install the returned full
   * collection list without waiting for the changed frame.
   * @param collectionId - target collection.
   * @param sessionId - session to unfile.
   * @returns the wire result.
   */
  async removeSessionFromCollection(
    collectionId: CollectionId,
    sessionId: SessionId,
  ): Promise<RpcResult<{ collections: CollectionView[] }>> {
    const { result } = await this.api.workspace.removeSessionFromCollection({ collectionId, sessionId })
    if (result.ok) this.installCollections(result.value.collections)
    return result
  }

  /**
   * Re-read the full collection list and install it without waiting for a
   * frame (a targeted refresh that skips the workspace-item pull).
   * @returns the wire result.
   */
  async listCollections(): Promise<RpcResult<{ collections: CollectionView[] }>> {
    const { result } = await this.api.workspace.listCollections({})
    if (result.ok) this.installCollections(result.value.collections)
    return result
  }

  /**
   * Soft-delete a session, then install the returned full soft-delete set
   * without waiting for the changed frame.
   * @param sessionId - session to delete.
   * @returns the wire result.
   */
  async deleteSession(sessionId: SessionId): Promise<RpcResult<{ deletedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.deleteSession({ sessionId })
    if (result.ok) this.installDeleted(result.value.deletedSessionIds)
    return result
  }

  /**
   * Restore a soft-deleted session, then install the returned full
   * soft-delete set without waiting for the changed frame.
   * @param sessionId - session to restore.
   * @returns the wire result.
   */
  async restoreSession(sessionId: SessionId): Promise<RpcResult<{ deletedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.restoreSession({ sessionId })
    if (result.ok) this.installDeleted(result.value.deletedSessionIds)
    return result
  }

  /**
   * Re-read the full soft-delete set and install it without waiting for a
   * frame (a targeted refresh that skips the workspace-item pull).
   * @returns the wire result.
   */
  async listDeletedSessions(): Promise<RpcResult<{ deletedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.listDeletedSessions({})
    if (result.ok) this.installDeleted(result.value.deletedSessionIds)
    return result
  }

  /**
   * Host-frame entry. Non-workspace frames are ignored so the runtime can
   * fan one host stream out to both object managers.
   * @param envelope - host stream envelope.
   */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    if (envelope.payload.type === 'host/workspace-changed') this.upsert(envelope.payload.workspace)
    else if (envelope.payload.type === 'host/workspace-removed') this.remove(envelope.payload.workspaceId)
    else if (envelope.payload.type === 'host/workspace-order-changed') {
      this.orderFrameGeneration++
      this.installOrder(envelope.payload.workspaceIds, true)
    }
    else if (envelope.payload.type === 'host/archived-sessions-changed') {
      this.installArchived(envelope.payload.archivedSessionIds)
    }
    else if (envelope.payload.type === 'host/collections-changed') {
      this.installCollections(envelope.payload.collections)
    }
    else if (envelope.payload.type === 'host/deleted-sessions-changed') {
      this.installDeleted(envelope.payload.deletedSessionIds)
    }
  }

  /** Re-pull the baseline after each connection generation. */
  handleConnected(): void {
    void this.refresh()
  }

  /**
   * Subscribe to workspace snapshot invalidation.
   * @param listener - snapshot invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Read the cached workspace snapshot after flushing pending notifications.
   * @returns the cached workspace snapshot.
   */
  getSnapshot(): WorkspaceListSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  private buildSnapshot(): WorkspaceListSnapshot {
    return {
      items: this.itemViews(),
      archivedSessionIds: this.archivedSessionIds,
      collections: this.collections,
      deletedSessionIds: this.deletedSessionIds,
      state: this.state,
      phase: this.phase,
      error: this.error,
    }
  }

  /**
   * Replace the archive set when membership actually changed (array identity
   * backs Object.is short-circuits). Host snapshots are append-ordered, so
   * positional comparison is exact, not merely heuristic.
   */
  private installArchived(archivedSessionIds: readonly SessionId[]): void {
    if (this.refreshFrames !== null) this.archivedSupersedesRefresh = true
    if (archivedSessionIds.length === this.archivedSessionIds.length
      && archivedSessionIds.every((id, index) => id === this.archivedSessionIds[index])) return
    this.archivedSessionIds = [...archivedSessionIds]
    this.notifier.markDirty()
  }

  /**
   * Replace the collection list when it actually changed (positional
   * structural compare, the collection analogue of the archive guard: the set
   * is objects, so membership plus each durable field must match).
   */
  private installCollections(collections: readonly CollectionView[]): void {
    if (this.refreshFrames !== null) this.collectionsSupersedesRefresh = true
    if (sameCollectionList(collections, this.collections)) return
    this.collections = [...collections]
    this.notifier.markDirty()
  }

  /** Replace the soft-delete set when membership actually changed. */
  private installDeleted(deletedSessionIds: readonly SessionId[]): void {
    if (this.refreshFrames !== null) this.deletedSupersedesRefresh = true
    if (deletedSessionIds.length === this.deletedSessionIds.length
      && deletedSessionIds.every((id, index) => id === this.deletedSessionIds[index])) return
    this.deletedSessionIds = [...deletedSessionIds]
    this.notifier.markDirty()
  }

  /** Reorder known Workspace objects, optionally recording a Host-committed sequence. */
  private installOrder(workspaceIds: readonly WorkspaceId[], committed = false): void {
    if (committed) {
      this.refreshFrames?.push({ type: 'order', workspaceIds })
      this.committedOrder = [...workspaceIds]
    }
    const rank = new Map(workspaceIds.map((id, index) => [id, index]))
    const items = [...this.items].sort((left, right) => {
      const leftId = left.getSnapshot().view?.workspaceId
      const rightId = right.getSnapshot().view?.workspaceId
      return (leftId === undefined ? Number.MAX_SAFE_INTEGER : rank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
        - (rightId === undefined ? Number.MAX_SAFE_INTEGER : rank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
    })
    if (items.every((item, index) => item === this.items[index])) return
    this.items = items
    this.notifier.markDirty()
  }

  /** Upsert one Host view, optionally retaining the local object that materialized it. */
  private upsert(view: WorkspaceView, identity?: Workspace): void {
    if (this.removedIds.has(view.workspaceId)) return
    this.refreshFrames?.push({ type: 'upsert', workspace: view })
    const index = this.items.findIndex(item => item.getSnapshot().view?.workspaceId === view.workspaceId)
    // Mutation responses and changed frames race (two carriers, no ordering):
    // reject a snapshot strictly older than the installed projection so a
    // late unary response cannot roll back a newer frame.
    const installed = index === -1 ? undefined : this.items[index]?.getSnapshot().view
    if (installed !== undefined && Date.parse(view.updatedAt) < Date.parse(installed.updatedAt)) return
    if (!this.committedOrder.includes(view.workspaceId)) {
      this.committedOrder = [view.workspaceId, ...this.committedOrder]
    }
    if (identity !== undefined) {
      this.items = index === -1
        ? [identity, ...this.items]
        : this.items.map((item, position) => position === index ? identity : item)
    } else if (index === -1) {
      this.items = [new Workspace(this.api, view), ...this.items]
    } else {
      this.items[index]?.adopt(view)
      this.items = [...this.items]
    }
    this.notifier.markDirty()
  }

  /** Remove one id idempotently and retain a tombstone against late echoes. */
  private remove(workspaceId: WorkspaceId, direct = false): void {
    this.refreshFrames?.push({ type: 'remove', workspaceId })
    this.removedIds.add(workspaceId)
    this.committedOrder = this.committedOrder.filter(id => id !== workspaceId)
    const items = this.items.filter(item =>
      item.getSnapshot().view?.workspaceId !== workspaceId)
    if (items.length === this.items.length) {
      // The Host frame may have removed the row first but left its batched
      // notification pending. A successful unary echo still flushes that
      // committed state before the user action resolves.
      if (direct) this.notifier.notifyNow()
      return
    }
    this.items = items
    if (direct) this.notifier.notifyNow()
    else this.notifier.markDirty()
  }

  private installViews(views: readonly WorkspaceView[]): void {
    const existing = new Map(
      this.items.flatMap((workspace) => {
        const view = workspace.getSnapshot().view
        return view === undefined ? [] : [[view.workspaceId, workspace] as const]
      }),
    )
    const installed = new Map<WorkspaceView['workspaceId'], Workspace>()
    for (const view of views) {
      const duplicate = installed.get(view.workspaceId)
      if (duplicate !== undefined) {
        duplicate.adopt(view)
        continue
      }
      const workspace = existing.get(view.workspaceId) ?? new Workspace(this.api, view)
      workspace.adopt(view)
      installed.set(view.workspaceId, workspace)
    }
    this.items = [...installed.values()]
    this.committedOrder = views.map(view => view.workspaceId)
  }

  private itemViews(): readonly WorkspaceView[] {
    if (this.itemViewsSource === this.items) return this.itemViewsCache
    this.itemViewsSource = this.items
    this.itemViewsCache = this.items.flatMap((workspace) => {
      const view = workspace.getSnapshot().view
      return view === undefined ? [] : [view]
    })
    return this.itemViewsCache
  }
}

/** Known ids retain their position; a newly created Workspace enters first. */
function upsertWorkspace(items: readonly WorkspaceView[], workspace: WorkspaceView): WorkspaceView[] {
  const index = items.findIndex(item => item.workspaceId === workspace.workspaceId)
  return index === -1
    ? [workspace, ...items]
    : items.map((item, position) => position === index ? workspace : item)
}

/** Replay one ordered delta over a baseline: upsert in place, or drop the removed id. */
function applyWorkspaceDelta(items: readonly WorkspaceView[], delta: WorkspaceDelta): WorkspaceView[] {
  if (delta.type === 'upsert') return upsertWorkspace(items, delta.workspace)
  if (delta.type === 'remove') {
    return items.filter(workspace => workspace.workspaceId !== delta.workspaceId)
  }
  const rank = new Map(delta.workspaceIds.map((id, index) => [id, index]))
  return [...items].sort((left, right) =>
    (rank.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER))
}

/** Move one known id before an optional anchor; unknown ids leave the order unchanged. */
function insertIdBefore(
  ids: readonly WorkspaceId[],
  id: WorkspaceId,
  beforeId?: WorkspaceId,
): WorkspaceId[] {
  if (!ids.includes(id) || (beforeId !== undefined && !ids.includes(beforeId)) || beforeId === id) {
    return [...ids]
  }
  const without = ids.filter(candidate => candidate !== id)
  const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
  return [...without.slice(0, at), id, ...without.slice(at)]
}

/**
 * Structural equality of two ordered collection lists. A CollectionView is a
 * plain object, so the archive set's id-only positional compare is insufficient:
 * an unchanged set must not dirty the store, and equality covers every durable
 * field the Host projects.
 */
function sameCollectionList(
  incoming: readonly CollectionView[],
  current: readonly CollectionView[],
): boolean {
  return incoming.length === current.length && incoming.every((collection, index) => {
    const held = current[index]
    return held !== undefined
      && collection.collectionId === held.collectionId
      && collection.title === held.title
      && collection.createdAt === held.createdAt
      && collection.updatedAt === held.updatedAt
      && collection.sessionIds.length === held.sessionIds.length
      && collection.sessionIds.every((id, position) => id === held.sessionIds[position])
  })
}
