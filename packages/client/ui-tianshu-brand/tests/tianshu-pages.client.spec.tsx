// @vitest-environment jsdom
/**
 * Management surface behavior: when it paints, what each destination shows,
 * the two-axis sessions page (folders navigate, state filters), and that its
 * actions route through the injected face while its view state stays local.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CollectionId, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SkillEntry, SuiteEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { TianshuNavKey, TianshuPagesComponentProps } from '../src/client/contract/slots.ts'
import { createNavStore } from '../src/client/nav-store.ts'
import { TianshuPages } from '../src/client/TianshuPages.tsx'
import { en } from '../src/client/locales.ts'

const t: TianshuPagesComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

afterEach(() => { cleanup() })

/** Session rows as the framework delivers them (host order in `ids`). */
interface SessionSeed { id: string; title?: string; blank?: boolean }

/** Collections + the two grouping sets, as the workspaces hook reports them. */
interface WorkspaceSeed {
  collections?: Array<{ id: string; title: string; sessionIds?: string[] }>
  archived?: string[]
  deleted?: string[]
}

/** The injected face with every call recorded. */
function injectedActions() {
  return {
    openSession: vi.fn(),
    renameSession: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => {}),
    createCollection: vi.fn(async () => {}),
    renameCollection: vi.fn(async () => {}),
    deleteCollection: vi.fn(async () => {}),
    addSessionToCollection: vi.fn(async () => {}),
    removeSessionFromCollection: vi.fn(async () => {}),
    sendSkillToComposer: vi.fn(() => true),
    listSuites: vi.fn(async (): Promise<readonly SuiteEntry[]> => []),
    installSuite: vi.fn(async (_id: string): Promise<readonly SuiteEntry[]> => []),
    uninstallSuite: vi.fn(async (_id: string): Promise<readonly SuiteEntry[]> => []),
    listSkills: vi.fn(async (): Promise<readonly SkillEntry[] | undefined> => undefined),
  }
}

/**
 * Mount the surface over a real store instance, optionally pre-selected.
 * @param options.active - destination open at mount.
 * @param options.sessions - session rows the framework hook reports.
 * @param options.workspaces - the grouping sets the workspaces hook reports.
 * @returns the store snapshot reader and the recorded action face.
 */
/** One suite row a test seeds the catalogue with. */
interface SuiteSeed {
  id: string
  title: string
  skillNames: string[]
  installed?: boolean
}

const suiteView = (seed: SuiteSeed): SuiteEntry => ({
  id: seed.id,
  title: seed.title,
  tag: '通用',
  description: `${seed.title} description`,
  skills: seed.skillNames.map(name => ({ name, title: `${name} 技能`, summary: `${name} 说明` })),
  installed: seed.installed === true,
})

function mountPages(options: {
  active?: TianshuNavKey
  sessions?: SessionSeed[]
  workspaces?: WorkspaceSeed
  /** Injected before render, so the component closes over the stub. */
  sendSkillToComposer?: () => boolean
  /** Catalogue the suite RPCs serve; install/uninstall echo a flip. */
  suites?: readonly SuiteSeed[]
  /** Host skill rows the listing RPC serves; default simulates no session. */
  hostSkills?: readonly { name: string; description: string }[]
  /** Replaces individual injected actions after the default wiring, so a test
   *  can make one reject (the failure paths) or record a specific call. */
  overrides?: Partial<ReturnType<typeof injectedActions>>
} = {}) {
  const nav = createNavStore().create()
  if (options.active !== undefined) nav.actions.select(options.active)
  const seeds = options.sessions ?? []
  const listState = {
    ids: seeds.map(s => s.id),
    byId: Object.fromEntries(seeds.map(s => [s.id, { title: s.title, blank: s.blank }])),
  }
  const workspacesState = {
    items: [],
    state: 'idle' as const,
    phase: 'ready' as const,
    error: null,
    baselinesReady: true,
    recentWorkspaceId: undefined,
    archivedSessionIds: (options.workspaces?.archived ?? []).map(id => id as SessionId),
    deletedSessionIds: (options.workspaces?.deleted ?? []).map(id => id as SessionId),
    collections: (options.workspaces?.collections ?? []).map(c => ({
      collectionId: c.id as CollectionId,
      title: c.title,
      sessionIds: (c.sessionIds ?? []).map(id => id as SessionId),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
  }
  const useSessions = ((selector: (s: unknown) => unknown) =>
    selector(listState)) as TianshuPagesComponentProps['useSessions']
  const useWorkspaces = ((selector: (s: unknown) => unknown) =>
    selector(workspacesState)) as TianshuPagesComponentProps['useWorkspaces']
  const actions = injectedActions()
  if (options.sendSkillToComposer !== undefined) {
    actions.sendSkillToComposer = vi.fn(options.sendSkillToComposer)
  }
  const suiteSeeds = options.suites ?? [
    { id: 'office-essentials', title: '办公五件套', skillNames: ['a', 'b', 'c', 'd', 'e'] },
  ]
  let installedIds = new Set(suiteSeeds.filter(seed => seed.installed).map(seed => seed.id))
  actions.listSkills = vi.fn(async () =>
    options.hostSkills === undefined ? undefined
      : options.hostSkills.map(row => ({ name: row.name, description: row.description, modelInvocable: true })))
  actions.listSuites = vi.fn(async () => suiteSeeds.map(seed => suiteView({ ...seed, installed: installedIds.has(seed.id) })))
  actions.installSuite = vi.fn(async (id: string) => {
    installedIds = new Set([...installedIds, id])
    return suiteSeeds.map(seed => suiteView({ ...seed, installed: installedIds.has(seed.id) }))
  })
  actions.uninstallSuite = vi.fn(async (id: string) => {
    installedIds = new Set([...installedIds].filter(held => held !== id))
    return suiteSeeds.map(seed => suiteView({ ...seed, installed: installedIds.has(seed.id) }))
  })
  Object.assign(actions, options.overrides ?? {})

  function Bench() {
    const snapshot = useSyncExternalStore(fn => nav.subscribe(fn), () => nav.getSnapshot())
    const useStore = ((selector: (s: unknown) => unknown) =>
      selector(snapshot)) as TianshuPagesComponentProps['useStore']
    return (
      <TianshuPages
        useStore={useStore} actions={nav.actions}
        useSessions={useSessions} useWorkspaces={useWorkspaces}
        {...actions}
        t={t}
      />
    )
  }
  const view = render(<Bench />)
  return { state: () => nav.getSnapshot(), actions, container: view.container, unmount: view.unmount }
}

describe('TianshuPages gating', () => {
  it('paints nothing while no destination is selected', () => {
    mountPages()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('renders no dedicated exit control: navigation and conversation entries close the page', () => {
    mountPages({ active: 'tasks' })
    // The X is gone by design: nav rows toggle pages, and the sidebar's
    // current-session watch retires one on any conversation entry. The only
    // controls the header offers are the title and caption.
    expect(screen.queryByRole('button', { name: 'Back to conversation' })).toBeNull()
    // And the header offers no buttons at all.
    expect(document.querySelector('.pane header button')).toBeNull()
  })
})

describe('TianshuPages tasks', () => {
  it('shows the template catalogue and says it cannot create tasks yet', () => {
    mountPages({ active: 'tasks' })
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeTruthy()
    expect(screen.getByText('Critical data backup')).toBeTruthy()
    // The notice is the honest part: templates render but create nothing.
    expect(screen.getByText(/no template capability yet/)).toBeTruthy()
  })

  it('states why the task list is empty rather than showing a bare zero', () => {
    mountPages({ active: 'tasks' })
    expect(screen.getByText(/session-scoped model tools/)).toBeTruthy()
  })
})

describe('TianshuPages sessions: list and states', () => {
  it('lists sessions in host order with the state row and folder rail', () => {
    mountPages({
      active: 'sessions',
      sessions: [{ id: 'a', title: '第一个会话' }, { id: 'b', title: '第二个会话' }],
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual(['第一个会话⋯', '第二个会话⋯'])
    // Both axes are present at the root: the state row and the rail.
    expect(screen.getByRole('button', { name: 'All2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uncategorized' })).toBeTruthy()
  })

  it('labels a session with no title', () => {
    mountPages({ active: 'sessions', sessions: [{ id: 'a' }] })
    expect(screen.getByText('New Session')).toBeTruthy()
  })

  it('labels a session whose title is empty', () => {
    // A blank title is not the same value as an absent one, and both must read
    // as untitled rather than rendering an empty row.
    mountPages({ active: 'sessions', sessions: [{ id: 'a', title: '' }] })
    expect(screen.getByText('New Session')).toBeTruthy()
  })

  it('names a blank session the way the workspace tree does', () => {
    // The tree calls a blank session "New Session" (ui-workspace rows). A
    // carried-over title on a still-blank session would otherwise give one
    // session two names across two surfaces.
    mountPages({ active: 'sessions', sessions: [{ id: 'a', title: 'stale title', blank: true }] })
    expect(screen.getByText('New Session')).toBeTruthy()
    expect(screen.queryByText('stale title')).toBeNull()
  })

  it('filters the state axis and counts each bucket', () => {
    mountPages({
      active: 'sessions',
      sessions: [{ id: 'live' }, { id: 'arch' }, { id: 'gone' }],
      workspaces: { archived: ['arch'], deleted: ['gone'] },
    })
    // All counts every non-deleted session: 2 = Active 1 + Archived 1, while
    // Deleted is its own bucket and never mixes into All.
    expect(screen.getByRole('button', { name: 'All2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Active1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archived1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deleted1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
    const rows = screen.getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual(['New SessionArchived⋯'])
  })

  it('shows the recycle bin with restore, and no open affordance on deleted rows', () => {
    const { actions } = mountPages({
      active: 'sessions',
      sessions: [{ id: 'gone', title: '误删的草稿' }],
      workspaces: { deleted: ['gone'] },
    })
    fireEvent.click(screen.getByRole('button', { name: /Deleted/ }))
    expect(screen.getAllByRole('listitem').map(r => r.textContent)).toEqual(['误删的草稿DeletedRestore'])

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(actions.restoreSession).toHaveBeenCalledWith('gone')
    expect(actions.openSession).not.toHaveBeenCalled()
  })

  it('opens a session and closes the page beside the call', () => {
    const { actions, state } = mountPages({
      active: 'sessions',
      sessions: [{ id: 'a', title: '看板重排' }],
    })
    fireEvent.click(screen.getByRole('button', { name: '看板重排' }))
    expect(actions.openSession).toHaveBeenCalledWith('a')
    // The page's visibility is its own store action, taken beside the open.
    expect(state().active).toBeUndefined()
  })
})

describe('TianshuPages sessions: folder axis', () => {
  const folderSeed = {
    sessions: [
      { id: 'in1', title: '月报' },
      { id: 'in2', title: '提纲' },
      { id: 'out', title: '杂项' },
    ],
    workspaces: { collections: [{ id: 'c1', title: '材料整理', sessionIds: ['in1', 'in2'] }] },
  }

  it('retires the global state row inside a folder and counts within scope', () => {
    mountPages({ active: 'sessions', ...folderSeed })
    fireEvent.click(screen.getByRole('button', { name: '材料整理' }))

    // The folder is the scope: heading names it, the scope bar replaces the
    // global chips, and sub-filters count within the folder.
    expect(screen.getByRole('heading', { level: 2, name: '材料整理' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Deleted/ })).toBeNull()
    expect(screen.getByText('2 sessions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All2' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').map(r => r.textContent)).toEqual(['月报⋯', '提纲⋯'])
  })

  it('does not repeat the folder tag on rows already inside it', () => {
    mountPages({ active: 'sessions', ...folderSeed })
    // At the root, the folder membership shows as a tag on the row.
    expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('材料整理')

    fireEvent.click(screen.getByRole('button', { name: '材料整理' }))
    // Inside the folder the tag is noise: every row is in it by definition,
    // so no row carries the folder title anymore (the rail still may).
    expect(screen.getAllByRole('listitem')
      .every(row => !row.textContent?.includes('材料整理'))).toBe(true)
  })

  it('groups the folder-less sessions under 未归类', () => {
    mountPages({ active: 'sessions', ...folderSeed })
    fireEvent.click(screen.getByRole('button', { name: 'Uncategorized' }))
    expect(screen.getAllByRole('listitem').map(r => r.textContent)).toEqual(['杂项⋯'])
  })

  it('files a session into a folder through the row menu', () => {
    const { actions } = mountPages({ active: 'sessions', ...folderSeed })
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[2]!)
    fireEvent.click(screen.getAllByText('材料整理').at(-1)!)
    expect(actions.addSessionToCollection).toHaveBeenCalledWith('c1', 'out')
  })

  it('archives through the row menu and asks before deleting', () => {
    const { actions } = mountPages({
      active: 'sessions',
      sessions: [{ id: 'a', title: '月报' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Archive'))
    expect(actions.archiveSession).toHaveBeenCalledWith('a')

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Delete'))
    // The confirm dialog is the only path to the injected delete.
    expect(actions.deleteSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(actions.deleteSession).toHaveBeenCalledWith('a')
  })

  it('creates a folder from the rail, refusing a blank name locally', () => {
    const { actions } = mountPages({ active: 'sessions', sessions: [{ id: 'a' }] })
    fireEvent.click(screen.getByRole('button', { name: '＋ New folder' }))

    const field = screen.getByPlaceholderText('e.g. Reports')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // A blank name never leaves the page.
    expect(screen.getByText('Name must not be blank')).toBeTruthy()
    expect(actions.createCollection).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: '  周报  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.createCollection).toHaveBeenCalledWith('周报')
  })
})

describe('TianshuPages suites', () => {
  it('lists the host catalogue with its skill counts and install state', async () => {
    mountPages({
      active: 'suites',
      suites: [
        { id: 'office-essentials', title: '办公五件套', skillNames: ['a', 'b', 'c', 'd', 'e'] },
        { id: 'gov', title: '政务公文', skillNames: ['x', 'y'], installed: true },
      ],
    })
    expect(await screen.findByText('办公五件套')).toBeTruthy()
    expect(screen.getByText('政务公文')).toBeTruthy()
    expect(screen.getByText('Includes 5')).toBeTruthy()
    expect(screen.getByText('Includes 2')).toBeTruthy()
    // Each suite lists its skills with a per-skill command and summary.
    expect(screen.getByText('/a')).toBeTruthy()
    expect(screen.getByText('a 说明')).toBeTruthy()
    // The installed suite shows its badge and uninstall; the other an install button.
    expect(screen.getByText('Installed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
  })

  it('installs through the injected action and adopts the echoed catalogue', async () => {
    const { actions } = mountPages({ active: 'suites' })
    await screen.findByText('办公五件套')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await screen.findByText('Installed')
    expect(actions.installSuite).toHaveBeenCalledWith('office-essentials')
    // The echoed catalogue replaced the row's install button.
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('uninstalls through the injected action and returns to installable', async () => {
    const { actions } = mountPages({
      active: 'suites',
      suites: [{ id: 'office-essentials', title: '办公五件套', skillNames: ['a'], installed: true }],
    })
    await screen.findByText('办公五件套')
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    await screen.findByRole('button', { name: 'Install' })
    expect(actions.uninstallSuite).toHaveBeenCalledWith('office-essentials')
  })
})

describe('TianshuPages skills', () => {
  it('lists the four catalogued skills with counts, categories, and calling names', () => {
    mountPages({ active: 'skills' })
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy()
    // Four rows, each carrying its /name calling convention.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(screen.getByText('/data-visualization')).toBeTruthy()
    expect(screen.getByText('/tech-proposal')).toBeTruthy()
    // Category chips count the catalogue: 2 documents, 2 data, 0 creative.
    expect(screen.getByRole('button', { name: /All4/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Documents2/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Data2/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Creative0/ })).toBeTruthy()
  })

  it('serves the host catalogue when a session lists skills, merging known titles', async () => {
    mountPages({
      active: 'skills',
      hostSkills: [
        { name: 'data-visualization', description: 'host row for the known skill' },
        { name: 'custom-thing', description: 'a skill only the host knows' },
      ],
    })
    // The host rows arrive async; both land once they do.
    expect(await screen.findByText('/custom-thing')).toBeTruthy()
    expect(screen.getByText('host row for the known skill')).toBeTruthy()
    // A known name keeps its Chinese title; an unknown one shows the raw name.
    expect(screen.getByText('数据可视化')).toBeTruthy()
    expect(screen.getByText('custom-thing')).toBeTruthy()
  })

  it('filters by category and by search', () => {
    mountPages({ active: 'skills' })
    fireEvent.click(screen.getByRole('button', { name: /Documents/ }))
    const docRows = screen.getAllByRole('listitem')
    expect(docRows).toHaveLength(2)
    expect(docRows.every(row => row.textContent?.includes('/weekly-report') || row.textContent?.includes('/tech-proposal'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /All/ }))
    const search = screen.getByLabelText('Search skills or descriptions…')
    fireEvent.change(search, { target: { value: '周报' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(search, { target: { value: '不存在的东西' } })
    expect(screen.getByText('No matching skills')).toBeTruthy()
  })

  it('shows a skill body in the detail dialog and sends to the composer from it', () => {
    const { actions } = mountPages({ active: 'skills' })
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    // The first row is data-visualization; its condensed rule set renders.
    expect(screen.getByText(/选什么图/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Send to composer' }).at(-1)!)
    expect(actions.sendSkillToComposer).toHaveBeenCalled()
  })

  it('prefills the composer and closes the page only when the send applied', () => {
    const applied = mountPages({ active: 'skills' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Send to composer' })[0]!)
    expect(applied.actions.sendSkillToComposer).toHaveBeenCalledWith('data-visualization')
    // The prefill applied, so the page retired to show the conversation.
    expect(applied.state().active).toBeUndefined()

    const refused = mountPages({ active: 'skills', sendSkillToComposer: () => false })
    // A refused prefill (no current session) keeps the page open.
    const sendButton = [...refused.container.querySelectorAll('button')]
      .find(button => button.textContent === 'Send to composer')
    fireEvent.click(sendButton!)
    expect(refused.actions.sendSkillToComposer).toHaveBeenCalled()
    expect(refused.state().active).toBe('skills')
  })
})

describe('TianshuPages mcp and connector', () => {
  it('states how an MCP server attaches instead of a fabricated catalogue', () => {
    mountPages({ active: 'mcp' })
    expect(screen.getByRole('heading', { level: 1, name: 'MCP' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Server list' })).toBeTruthy()
    // The notice names the real mechanism (a cordis.yml plugin instance).
    expect(screen.getByText(/mcp-client plugin instance/)).toBeTruthy()
  })

  it('points the connector page at the providers Settings already manages', () => {
    mountPages({ active: 'connector' })
    expect(screen.getByRole('heading', { level: 1, name: 'Connectors' })).toBeTruthy()
    expect(screen.getByText(/model providers/)).toBeTruthy()
  })
})

describe('TianshuPages suites: failure paths', () => {
  it('shows the load failure and clears it on retry', async () => {
    mountPages({ active: 'suites', overrides: { listSuites: vi.fn(async () => { throw new Error('offline') }) } })
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    // Retry clears the failure; with no successful reload the loading notice returns.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Loading the suite catalogue…')).toBeTruthy()
  })

  it('stringifies a non-Error load rejection', async () => {
    mountPages({ active: 'suites', overrides: { listSuites: vi.fn(async () => { throw 'nope' }) } })
    expect((await screen.findByRole('alert')).textContent).toContain('nope')
  })

  it('surfaces an install failure', async () => {
    mountPages({ active: 'suites', overrides: { installSuite: vi.fn(async () => { throw new Error('disk full') }) } })
    await screen.findByText('办公五件套')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect((await screen.findByRole('alert')).textContent).toContain('disk full')
  })

  it('stringifies a non-Error uninstall rejection', async () => {
    mountPages({
      active: 'suites',
      suites: [{ id: 'office-essentials', title: '办公五件套', skillNames: ['a'], installed: true }],
      overrides: { uninstallSuite: vi.fn(async () => { throw 'busy' }) },
    })
    await screen.findByText('办公五件套')
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect((await screen.findByRole('alert')).textContent).toContain('busy')
  })

  it('drops a suite load that resolves after unmount', async () => {
    const deferred = Promise.withResolvers<readonly SuiteEntry[]>()
    const { unmount } = mountPages({ active: 'suites', overrides: { listSuites: vi.fn(() => deferred.promise) } })
    await screen.findByText('Loading the suite catalogue…')
    // Unmount before the load settles: the cleanup flags it, so the resolved
    // rows are dropped rather than written into a gone component.
    unmount()
    deferred.resolve([])
    await deferred.promise
    await Promise.resolve()
  })

  it('drops a suite load that rejects after unmount', async () => {
    const deferred = Promise.withResolvers<readonly SuiteEntry[]>()
    const { unmount } = mountPages({ active: 'suites', overrides: { listSuites: vi.fn(() => deferred.promise) } })
    await screen.findByText('Loading the suite catalogue…')
    unmount()
    deferred.reject(new Error('late'))
    await deferred.promise.catch(() => {})
    await Promise.resolve()
  })
})

describe('TianshuPages skills: extra paths', () => {
  it('keeps the local catalogue when the skill listing rejects', async () => {
    const { actions } = mountPages({
      active: 'skills',
      overrides: { listSkills: vi.fn(async () => { throw new Error('no session') }) },
    })
    // The rejection is swallowed; the shipped catalogue still stands in.
    expect(await screen.findByText('/data-visualization')).toBeTruthy()
    expect(actions.listSkills).toHaveBeenCalled()
  })

  it('closes the skill detail dialog from the footer and via Escape', () => {
    mountPages({ active: 'skills' })
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    // The footer ghost "Close" (the Modal's own close control shares the label).
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Reopen and dismiss through the Modal's Escape close.
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('TianshuPages sessions: action failures', () => {
  it('surfaces a rejected lifecycle action inline', async () => {
    mountPages({
      active: 'sessions',
      sessions: [{ id: 'a', title: '月报' }],
      overrides: { archiveSession: vi.fn(async () => { throw new Error('locked') }) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Archive'))
    expect((await screen.findByRole('alert')).textContent).toContain('locked')
  })

  it('stringifies a non-Error restore rejection', async () => {
    mountPages({
      active: 'sessions',
      sessions: [{ id: 'gone', title: '草稿' }],
      workspaces: { deleted: ['gone'] },
      overrides: { restoreSession: vi.fn(async () => { throw 'gone-for-good' }) },
    })
    fireEvent.click(screen.getByRole('button', { name: /Deleted/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect((await screen.findByRole('alert')).textContent).toContain('gone-for-good')
  })
})

describe('TianshuPages sessions: folder rail and scope bar', () => {
  const folderSeed = {
    sessions: [
      { id: 'in1', title: '月报' },
      { id: 'in2', title: '提纲' },
      { id: 'out', title: '杂项' },
    ],
    workspaces: { collections: [{ id: 'c1', title: '材料整理', sessionIds: ['in1', 'in2'] }] },
  }

  it('walks into a folder, filters within scope, and leaves it', () => {
    mountPages({ active: 'sessions', ...folderSeed })
    fireEvent.click(screen.getByRole('button', { name: '材料整理' }))
    // The in-folder scope bar counts within the folder; a sub-chip re-filters it.
    expect(screen.getByText('2 sessions')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }))
    expect(screen.getByText('No sessions in this folder yet')).toBeTruthy()
    // Leave restores the global state row.
    fireEvent.click(screen.getByRole('button', { name: 'Leave this folder' }))
    expect(screen.getByRole('button', { name: /^Deleted/ })).toBeTruthy()
    // The root rail item is operable from anywhere.
    fireEvent.click(screen.getByRole('button', { name: '材料整理' }))
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }))
    expect(screen.getByRole('button', { name: /^Deleted/ })).toBeTruthy()
  })

  it('picking a folder or 未归类 leaves the recycle bin', () => {
    mountPages({ active: 'sessions', ...folderSeed })
    fireEvent.click(screen.getByRole('button', { name: /Deleted/ }))
    // From the bin, choosing a folder resets the state filter and scopes in.
    fireEvent.click(screen.getByRole('button', { name: '材料整理' }))
    expect(screen.getByText('2 sessions')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Leave this folder' }))
    fireEvent.click(screen.getByRole('button', { name: /Deleted/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Uncategorized' }))
    expect(screen.getAllByRole('listitem').map(r => r.textContent)).toEqual(['杂项⋯'])
  })

  it('renames a folder from the rail, prefilling its title', () => {
    const { actions } = mountPages({ active: 'sessions', ...folderSeed })
    fireEvent.click(screen.getByRole('button', { name: '材料整理' }))
    fireEvent.click(screen.getByTitle('Rename folder'))
    const field = screen.getByPlaceholderText('e.g. Reports') as HTMLInputElement
    expect(field.value).toBe('材料整理')
    fireEvent.change(field, { target: { value: '归档材料' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.renameCollection).toHaveBeenCalledWith('c1', '归档材料')
  })

  it('deletes a folder through the confirm dialog', () => {
    const { actions } = mountPages({ active: 'sessions', ...folderSeed })
    fireEvent.click(screen.getByRole('button', { name: '材料整理' }))
    fireEvent.click(screen.getByTitle('Delete folder?'))
    expect(screen.getByText('No sessions are deleted; they simply leave this folder.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(actions.deleteCollection).toHaveBeenCalledWith('c1')
  })

  it('states an empty recycle bin', () => {
    mountPages({ active: 'sessions', sessions: [{ id: 'a', title: '月报' }] })
    fireEvent.click(screen.getByRole('button', { name: /Deleted/ }))
    expect(screen.getByText('The recycle bin is empty')).toBeTruthy()
  })

  it('submits a folder name on Enter and ignores other keys', () => {
    const { actions } = mountPages({ active: 'sessions', sessions: [{ id: 'a' }] })
    fireEvent.click(screen.getByRole('button', { name: '＋ New folder' }))
    const field = screen.getByPlaceholderText('e.g. Reports')
    fireEvent.change(field, { target: { value: '季度汇报' } })
    fireEvent.keyDown(field, { key: 'a' })
    expect(actions.createCollection).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(actions.createCollection).toHaveBeenCalledWith('季度汇报')
  })
})

describe('TianshuPages sessions: row menu dispatch', () => {
  const folderSeed = {
    sessions: [
      { id: 'in1', title: '月报' },
      { id: 'out', title: '杂项' },
    ],
    workspaces: { collections: [{ id: 'c1', title: '材料整理', sessionIds: ['in1'] }] },
  }

  it('opens a session from the row menu', () => {
    const { actions } = mountPages({ active: 'sessions', sessions: [{ id: 'a', title: '月报' }] })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Open session'))
    expect(actions.openSession).toHaveBeenCalledWith('a')
  })

  it('renames a titled and an untitled session from the row menu', () => {
    const { actions } = mountPages({
      active: 'sessions',
      sessions: [{ id: 'a', title: '月报' }, { id: 'b' }],
    })
    // Titled: the dialog's stored initial reads the title (?? left path).
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]!)
    fireEvent.click(screen.getByText('Rename'))
    let field = screen.getByPlaceholderText('Session name')
    fireEvent.change(field, { target: { value: '九月月报' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.renameSession).toHaveBeenCalledWith('a', '九月月报')

    // Untitled: the stored initial falls to '' (?? right path).
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1]!)
    fireEvent.click(screen.getByText('Rename'))
    field = screen.getByPlaceholderText('Session name')
    fireEvent.change(field, { target: { value: '草稿命名' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.renameSession).toHaveBeenCalledWith('b', '草稿命名')
  })

  it('unarchives a session from the row menu', () => {
    const { actions } = mountPages({
      active: 'sessions',
      sessions: [{ id: 'a', title: '月报' }],
      workspaces: { archived: ['a'] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Unarchive'))
    expect(actions.unarchiveSession).toHaveBeenCalledWith('a')
  })

  it('confirms deleting an untitled session by its placeholder name', () => {
    const { actions } = mountPages({ active: 'sessions', sessions: [{ id: 'a' }] })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText(/New Session moves to the recycle bin/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(actions.deleteSession).toHaveBeenCalledWith('a')
  })

  it('removes a session from a folder it already belongs to', () => {
    const { actions } = mountPages({ active: 'sessions', ...folderSeed })
    // in1 is the first row and already a member of 材料整理.
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]!)
    fireEvent.click(screen.getAllByText('材料整理').at(-1)!)
    expect(actions.removeSessionFromCollection).toHaveBeenCalledWith('c1', 'in1')
  })

  it('toggles a row menu closed and dismisses it on Escape', () => {
    mountPages({ active: 'sessions', sessions: [{ id: 'a', title: '月报' }] })
    const more = screen.getByRole('button', { name: 'More actions' })
    fireEvent.click(more)
    expect(screen.getByText('Open session')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(more)
    fireEvent.click(more)
    // The second same-row click routes through the closing arm of the toggle.
    expect(screen.queryByText('Open session')).toBeNull()
  })

  it('closes a dialog on cancel without acting', () => {
    const { actions } = mountPages({ active: 'sessions', sessions: [{ id: 'a', title: '月报' }] })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Rename'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(actions.renameSession).not.toHaveBeenCalled()
  })
})

