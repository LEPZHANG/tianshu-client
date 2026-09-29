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
  /** An installed suite counts as current unless a test says its shipped body changed. */
  current?: boolean
}

const suiteView = (seed: SuiteSeed): SuiteEntry => ({
  id: seed.id,
  title: seed.title,
  tag: '通用',
  description: `${seed.title} description`,
  skills: seed.skillNames.map(name => ({ name, title: `${name} 技能`, summary: `${name} 说明` })),
  installed: seed.installed === true,
  current: seed.current ?? seed.installed === true,
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
  // Seeded as installed-from-an-older-body; a reinstall is what clears the mismatch, as the host does.
  let outdatedIds = new Set(suiteSeeds.filter(seed => seed.installed && seed.current === false).map(seed => seed.id))
  const suiteRows = (): SuiteEntry[] => suiteSeeds.map(seed => suiteView({
    ...seed,
    installed: installedIds.has(seed.id),
    current: installedIds.has(seed.id) && !outdatedIds.has(seed.id),
  }))
  actions.listSkills = vi.fn(async () =>
    options.hostSkills === undefined ? undefined
      : options.hostSkills.map(row => ({ name: row.name, description: row.description, modelInvocable: true })))
  actions.listSuites = vi.fn(async () => suiteRows())
  actions.installSuite = vi.fn(async (id: string) => {
    installedIds = new Set([...installedIds, id])
    outdatedIds = new Set([...outdatedIds].filter(held => held !== id))
    return suiteRows()
  })
  actions.uninstallSuite = vi.fn(async (id: string) => {
    installedIds = new Set([...installedIds].filter(held => held !== id))
    return suiteRows()
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
  it('lists the host catalogue plus the demo rows with counts and install state', async () => {
    mountPages({
      active: 'suites',
      suites: [
        { id: 'office-essentials', title: '办公五件套', skillNames: ['a', 'b', 'c', 'd', 'e'], installed: true },
      ],
    })
    expect(await screen.findAllByText('办公五件套')).toBeTruthy()
    // The demo suites ride along after the host rows.
    expect(screen.getAllByText('公文写作组')[0]).toBeTruthy()
    expect(screen.getAllByText('工程研发台')[0]).toBeTruthy()
    // The installed suite shows its in-place count; the demos stay uninstalled.
    expect(screen.getByText('In place 5/5')).toBeTruthy()
    expect(screen.getAllByText('Not installed')).toHaveLength(2)
  })

  it('installs through the card button and adopts the echoed catalogue', async () => {
    const { actions } = mountPages({ active: 'suites' })
    await screen.findAllByText('办公五件套')
    // The uninstalled host card carries the install button; the demo cards follow.
    fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[0]!)
    await screen.findByText('In place 5/5')
    expect(actions.installSuite).toHaveBeenCalledWith('office-essentials')
  })

  it('offers a reinstall for an installed suite whose shipped body changed, and installs through it', async () => {
    const { actions } = mountPages({
      active: 'suites',
      suites: [{
        id: 'office-essentials', title: '办公五件套', skillNames: ['a'], installed: true, current: false,
      }],
    })
    await screen.findAllByText('办公五件套')
    // The card footer flags the outdated install; the detail header offers the reinstall.
    expect(screen.getByText('Update available')).toBeTruthy()
    fireEvent.click(screen.getAllByText('办公五件套').at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: 'Reinstall' }))
    expect(actions.installSuite).toHaveBeenCalledWith('office-essentials')
  })

  it('uninstalls from the detail view and returns to installable', async () => {
    const { actions } = mountPages({
      active: 'suites',
      suites: [{ id: 'office-essentials', title: '办公五件套', skillNames: ['a'], installed: true }],
    })
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getAllByText('办公五件套').at(-1)!)
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    await screen.findByRole('button', { name: 'Install' })
    expect(actions.uninstallSuite).toHaveBeenCalledWith('office-essentials')
  })

  it('answers a demo-suite install with a notice instead of an RPC', async () => {
    const { actions } = mountPages({ active: 'suites' })
    await screen.findAllByText('办公五件套')
    // Card order: host rows first, then the demo rows.
    fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[1]!)
    expect(screen.getByRole('status').textContent).toContain('Demo suites are for preview only')
    expect(actions.installSuite).not.toHaveBeenCalled()
  })

  it('opens a suite detail with quick commands, knowledge rows, and the back link', async () => {
    mountPages({
      active: 'suites',
      suites: [{ id: 'office-essentials', title: '办公五件套', skillNames: ['a', 'b'] }],
      hostSkills: [{ name: 'a', description: 'host a' }],
    })
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getAllByText('办公五件套').at(-1)!)
    // The header card counts the one recognized skill of two.
    expect(screen.getByText(/Recognized on the skills page 1\/2/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /\/a/ })).toBeTruthy()
    // Knowledge rows carry per-skill placement; the unrecognized one flags missing.
    expect(screen.getByText('Missing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back to suite square/ }))
    expect(screen.getByText('Suite square')).toBeTruthy()
  })

  it('toggles the enable switch in the detail header', async () => {
    mountPages({ active: 'suites' })
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getAllByText('办公五件套').at(-1)!)
    const toggle = screen.getByRole('button', { name: 'Enabled' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('filters the square to the installed suites', async () => {
    mountPages({
      active: 'suites',
      suites: [{ id: 'office-essentials', title: '办公五件套', skillNames: ['a'], installed: true }],
    })
    await screen.findAllByText('工程研发台')
    fireEvent.click(screen.getByRole('button', { name: 'Installed1' }))
    // Only the card leaves; the hero pill keeps naming the demo suite.
    expect(screen.getAllByText('工程研发台')).toHaveLength(1)
    expect(screen.getAllByText('办公五件套').length).toBeGreaterThan(1)
  })

  it('states that suite authoring is not open instead of pretending to create', async () => {
    mountPages({ active: 'suites' })
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Tianshu to build a suite for me' }))
    expect(screen.getByRole('status').textContent).toContain('not available yet')
  })
})

describe('TianshuPages skills', () => {
  it('lists the suite-derived rows plus the demo own row with counts and badges', async () => {
    mountPages({ active: 'skills' })
    // The host suite rows arrive async; wait for the load before counting.
    await screen.findAllByText('办公五件套')
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy()
    // The demo suite skills and the demo own row are present by default.
    expect(screen.getByText('/gov-notice')).toBeTruthy()
    expect(screen.getByText('/team-style-guide')).toBeTruthy()
    // The demo own row is manual-only; suite rows are model-invocable.
    expect(screen.getByText('Manual only')).toBeTruthy()
    expect(screen.getAllByText('Model-invocable').length).toBeGreaterThan(0)
    // Tabs count the three scopes: 5 host + 7 demo suite skills + 1 own row.
    expect(screen.getByRole('button', { name: 'Skill square13' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'From suites12' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Own1' })).toBeTruthy()
    // Category chips count over the square: the generic host skills are documents.
    expect(screen.getByRole('button', { name: /Documents9/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Engineering4/ })).toBeTruthy()
  })

  it('serves the host rows as own skills, titled from the local table', async () => {
    mountPages({
      active: 'skills',
      hostSkills: [
        { name: 'data-visualization', description: 'host row for the known skill' },
        { name: 'custom-thing', description: 'a skill only the host knows' },
      ],
    })
    expect(await screen.findByText('/custom-thing')).toBeTruthy()
    // The own scope holds exactly the two host rows (neither is a suite skill).
    fireEvent.click(screen.getByRole('button', { name: 'Own2' }))
    expect(screen.getByText('数据可视化')).toBeTruthy()
    expect(screen.getByText('host row for the known skill')).toBeTruthy()
    expect(screen.getByText('a skill only the host knows')).toBeTruthy()
  })

  it('filters by category and by search', async () => {
    mountPages({ active: 'skills' })
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getByRole('button', { name: /Engineering/ }))
    const devCards = screen.getAllByText(/\/(code-review|api-doc|release-notes|incident-review)/)
    expect(devCards).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: /All13/ }))
    const search = screen.getByLabelText('Search skills or descriptions…')
    fireEvent.change(search, { target: { value: '通告' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.change(search, { target: { value: '不存在的东西' } })
    expect(screen.getByText('No matching skills')).toBeTruthy()
  })

  it('re-sorts the square by name and back', async () => {
    mountPages({ active: 'skills' })
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getByRole('button', { name: 'By name' }))
    expect(screen.getAllByRole('article')).toHaveLength(13)
    fireEvent.click(screen.getByRole('button', { name: 'Frequent' }))
    expect(screen.getAllByRole('article')).toHaveLength(13)
  })

  it('shows a skill body in the detail dialog and sends to the composer from it', async () => {
    const { actions } = mountPages({
      active: 'skills',
      hostSkills: [{ name: 'data-visualization', description: 'host row' }],
    })
    await screen.findByText('/data-visualization')
    // The data-visualization card is the last one (own rows render after suites).
    fireEvent.click(screen.getAllByRole('button', { name: 'View' }).at(-1)!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/选什么图/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Send to composer' }).at(-1)!)
    expect(actions.sendSkillToComposer).toHaveBeenCalled()
  })

  it('prefills the composer and closes the page only when the send applied', async () => {
    const applied = mountPages({ active: 'skills' })
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getAllByRole('button', { name: 'Send to composer' })[0]!)
    expect(applied.actions.sendSkillToComposer).toHaveBeenCalledWith('a')
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

  it('routes the hero button to the suites page', () => {
    const { state } = mountPages({ active: 'skills' })
    fireEvent.click(screen.getByRole('button', { name: /Go to Expert Suites/ }))
    expect(state().active).toBe('suites')
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
    await screen.findAllByText('办公五件套')
    fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[0]!)
    expect((await screen.findByRole('alert')).textContent).toContain('disk full')
  })

  it('stringifies a non-Error uninstall rejection', async () => {
    mountPages({
      active: 'suites',
      suites: [{ id: 'office-essentials', title: '办公五件套', skillNames: ['a'], installed: true }],
      overrides: { uninstallSuite: vi.fn(async () => { throw 'busy' }) },
    })
    await screen.findAllByText('办公五件套')
    // Uninstall lives in the detail view's header card.
    fireEvent.click(screen.getAllByText('办公五件套').at(-1)!)
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
    // The rejection is swallowed; the suite-derived rows still stand in.
    expect(await screen.findByText('/gov-notice')).toBeTruthy()
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
