/**
 * Browser half of the native directory-picker backend: fills ui-workspace's
 * two directory-flow holes with a renderless occupant that answers each
 * `open` by driving `host.pickDirectory` (the node half's OS chooser) and
 * reporting the one outcome — picked path, cancellation, or failure — back
 * through the owner conversation. Mounting this package therefore composes
 * both sides of the native interaction with one cordis.yml row; no client
 * code branches on a capability kind.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { NativeFlowInjected } from './flow.ts'
import { NativeDirectoryFlow } from './flow.ts'


/** Required services (cordis fiber inject): the slot registry and the wire-facing workspace service. */
export const inject = ['slots', 'workspaces']

/** Shape an embedding shell may expose to own directory selection itself. */
interface DirectoryPickerBridge { pick: () => Promise<string | null> }

/**
 * The host-side chooser, or an embedder's own.
 *
 * A desktop shell that wraps this UI runs its platform's native dialog and
 * disables the host-side picker, so when it publishes a bridge on `window` that
 * bridge is the only working chooser. Absent one, this falls back to the host
 * service, which is what a plain browser deployment uses.
 */
function resolvePick(ctx: ClientContext): () => Promise<string | null> {
  const bridge = (globalThis as { dshDesktopDirectoryPicker?: DirectoryPickerBridge })
    .dshDesktopDirectoryPicker
  if (bridge !== undefined && typeof bridge.pick === 'function') return () => bridge.pick()
  return () => ctx.workspaces.pickDirectory()
}

/**
 * Client plugin body: register the renderless native flow into both
 * directory-flow holes through `slots.inject()` because the ui-workspace
 * entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const pick = resolvePick(ctx)
  const injected = (): NativeFlowInjected => ({ pick })
  // Both declaration lifetimes must be live before the pair installs; the
  // generator makes the two registrations one transactional effect. The
  // outer/inner nesting order is arbitrary; neither hole has precedence.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
    }))
}
