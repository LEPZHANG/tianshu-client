/**
 * The management surfaces the sidebar's navigation opens: 任务管理 and 会话管理.
 *
 * Registered into `shell.overlay`, so the surface is mounted for the whole
 * session and paints only when a destination is selected; with none it renders
 * `null` and the click-through layer stays out of the way. This keeps the
 * conversation column untouched — `conversation` is a single slot owned by
 * ui-conversation, and occupying it would displace the whole chat surface.
 *
 * The sessions page carries two orthogonal axes: the archive state (全部 /
 * 未归档 / 已归档 / 已删除) and the folder axis (collections). Folders are
 * navigation on a left rail; state is a filter row — and once a folder is the
 * scope, the global state row retires in favour of an in-folder scope bar
 * whose sub-filters count within that folder, so the two axes never read as
 * one mutually-exclusive list. 已删除 is global-only: the recycle bin has no
 * folder filtering.
 *
 * What the pages can honestly show is bounded by what the host actually has;
 * see the package README's Known Limitations before adding to them.
 */
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import {
  Input,
  Menu,
  Modal,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollectionId, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SkillEntry, SuiteEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { TianshuPagesComponentProps, TianshuPagesInjected } from './contract/slots.ts'
import type { TianshuSidebarKey } from './locales.ts'
import css from './TianshuPages.module.css'

/**
 * Template catalogue. These are presentation-only: the host has no template
 * concept, so selecting one cannot create anything yet (README).
 */
const TEMPLATES: readonly { id: string; name: 'tpl.backup' | 'tpl.summary' | 'tpl.report'; tag: 'tpl.tag.image' | 'tpl.tag.text' }[] = [
  { id: 'backup', name: 'tpl.backup', tag: 'tpl.tag.image' },
  { id: 'summary', name: 'tpl.summary', tag: 'tpl.tag.text' },
  { id: 'report', name: 'tpl.report', tag: 'tpl.tag.text' },
]

/** Rail sentinel for sessions that belong to no folder. */
const UNGROUPED = 'uncategorized' as const
/** Folder selection: `null` is the root scope, the sentinel the 未归类 pseudo-folder. */
type FolderSelection = CollectionId | typeof UNGROUPED | null
/** Archive-state axis. */
type StateFilter = 'all' | 'active' | 'archived' | 'bin'

/** Locale key of each state filter's label, one source for both filter rows. */
const STATE_LABEL: Record<StateFilter, TianshuSidebarKey> = {
  all: 'page.sessions.filterAll',
  active: 'page.sessions.filterActive',
  archived: 'page.sessions.filterArchived',
  bin: 'page.sessions.filterDeleted',
}

/** One modal the sessions page can hold open; exactly one at a time. */
type Dialog =
  | { kind: 'renameSession'; sessionId: SessionId; initial: string }
  | { kind: 'newFolder' }
  | { kind: 'renameFolder'; collectionId: CollectionId; initial: string }
  | { kind: 'deleteSession'; sessionId: SessionId; title: string }
  | { kind: 'deleteFolder'; collectionId: CollectionId }

/**
 * Render the management surface for the selected destination.
 * @param props - composed slot props (nav store + injected actions + locale seat, contract/slots.ts).
 * @returns the page tree, or null when no destination is open.
 */
export function TianshuPages(props: TianshuPagesComponentProps) {
  const active = props.useStore(s => s.active)

  if (active === undefined) return null

  const heading = active === 'tasks' ? 'page.tasks.title'
    : active === 'sessions' ? 'page.sessions.title'
      : active === 'suites' ? 'page.suites.title'
        : active === 'skills' ? 'page.skills.title'
          : active === 'mcp' ? 'page.mcp.title'
            : 'page.connector.title'
  const caption = active === 'tasks' ? 'page.tasks.caption'
    : active === 'sessions' ? 'page.sessions.caption'
      : active === 'suites' ? 'page.suites.caption'
        : active === 'skills' ? 'page.skills.caption'
          : active === 'mcp' ? 'page.mcp.caption'
            : 'page.connector.caption'
  // The redesigned pages carry the brand-style header (glyph + letterspaced
  // subtitle + right caption); the rest keep the plain stacked one.
  const subKey = active === 'suites' ? 'page.suites.sub'
    : active === 'skills' ? 'page.skills.sub'
      : undefined

  return (
    <div className={css.root}>
      {/* First grid track is the sidebar's: left empty so it stays operable. */}
      <div className={css.pane}>
        {/* No close button: navigation rows toggle pages (re-selecting the
            current one closes it) and any conversation entry retires the page
            through the sidebar's current-session watch, so the page needs no
            dedicated exit affordance. */}
        <header className={css.head}>
          {subKey === undefined ? (
            <div>
              <h1 className={css.title}>{props.t(heading)}</h1>
              <p className={css.caption}>{props.t(caption)}</p>
            </div>
          ) : (
            <div className={css.headRow}>
              <span className={css.glyphBox}>
                {active === 'suites' ? <SuiteGlyph size={22} /> : <SkillGlyph size={22} />}
              </span>
              <div>
                <h1 className={css.headTitle}>{props.t(heading)}</h1>
                <div className={css.headSub}>{props.t(subKey)}</div>
              </div>
              <div className={css.headLine} />
              <p className={css.headCaption}>{props.t(caption)}</p>
            </div>
          )}
        </header>

        <div className={css.body}>
          {active === 'tasks' && <TasksPage t={props.t} />}
          {active === 'suites' && <SuitesPage {...props} />}
          {active === 'skills' && <SkillsPage {...props} />}
          {active === 'mcp' && <McpPage t={props.t} />}
          {active === 'connector' && <ConnectorPage t={props.t} />}
          {active === 'sessions' && <SessionsPage {...props} />}
        </div>
      </div>
    </div>
  )
}

/** The 任务管理 page: presentation-only until the host gains template concepts. */
function TasksPage({ t }: { t: TianshuPagesComponentProps['t'] }) {
  return (
    <>
      <section>
        <h2 className={css.sectionTitle}>{t('page.tasks.templates')}</h2>
        {/* Presentation-only: no host template concept exists to create from. */}
        <p className={css.notice}>{t('page.tasks.templatesNotice')}</p>
        <div className={css.grid}>
          {TEMPLATES.map(tpl => (
            <article key={tpl.id} className={css.card}>
              <div className={css.cardHead}>
                <span className={css.cardName}>{t(tpl.name)}</span>
                <span className={css.tag}>{t(tpl.tag)}</span>
              </div>
              <p className={css.cardBody}>{t('tpl.placeholder')}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className={css.sectionTitle}>{t('page.tasks.mine')}</h2>
        {/* Scheduled reminders are session-scoped model tools, not a
            cross-session task table; there is nothing global to list. */}
        <p className={css.empty}>{t('page.tasks.empty')}</p>
      </section>
    </>
  )
}

/* Presentation-only demo suites, appended after the host catalogue. The host
   catalogue today ships one suite; these rows keep the square's layout and
   interactions reviewable until the host carries them. The `demo:` id prefix
   routes every mutation attempt to a notice instead of a doomed RPC. */
const DEMO_SUITES: readonly [SuiteEntry, ...SuiteEntry[]] = [
  {
    id: 'demo:gov-writing',
    title: '公文写作组',
    tag: '政务',
    description: '通知通告、请示报告、会议纪要三类上行文与下行文，文种判定、结构骨架与用语规范一次配齐。',
    installed: false,
    current: false,
    skills: [
      { name: 'gov-notice', title: '通知通告', summary: '判定文种后按「缘由—事项—要求」成文，收敛用语与格式，附成稿自检清单。' },
      { name: 'gov-request', title: '请示报告', summary: '请示一文一事、报告分综合与专题，缘由与请求分项陈述，遵循上行文格式。' },
      { name: 'gov-minutes', title: '会议纪要', summary: '议定事项与讨论过程分列，三要素缺项如实标注，不补写会上未议内容。' },
    ],
  },
  {
    id: 'demo:engineering',
    title: '工程研发台',
    tag: '研发',
    description: '代码评审、接口文档、发布说明、故障复盘四个研发交付场景，按可验收的清单式规范成文。',
    installed: false,
    current: false,
    skills: [
      { name: 'code-review', title: '代码评审', summary: '按正确性、边界条件、并发与可测性逐项走查，意见按阻塞与建议分级输出。' },
      { name: 'api-doc', title: '接口文档', summary: '按端点、参数、示例与错误码四段成文，字段口径与实现保持一致。' },
      { name: 'release-notes', title: '发布说明', summary: '按用户可感知的变化归类（新增 / 变更 / 修复 / 已知问题），条目带影响面与升级注意。' },
      { name: 'incident-review', title: '故障复盘', summary: '按时间线还原、根因分析、改进项与验证标准成文，追责性表述不进入正文。' },
    ],
  },
]

/** Whether one suite id belongs to the presentation-only demo set. */
const isDemoSuite = (suiteId: string): boolean => suiteId.startsWith('demo:')

/** The suite glyph: a solid 2×2 grid, the shared suite mark. */
function SuiteGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" />
    </svg>
  )
}

/** The skill glyph: three solid bars, the shared skill mark. */
function SkillGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="3.2" width="11" height="1.7" rx="0.85" />
      <rect x="2.5" y="7.15" width="11" height="1.7" rx="0.85" />
      <rect x="2.5" y="11.1" width="7" height="1.7" rx="0.85" />
    </svg>
  )
}

/** Sort of the square: catalogue order vs reversed (presentation-only). */
type SuiteSort = 'hot' | 'new'

/** Scope of the square: every catalogued suite vs the installed ones. */
type SuiteScope = 'all' | 'installed'

/**
 * The 专家套件 square, driven by the host's suite RPCs. Install writes
 * the bundled skills under the user skill root (the filesystem provider
 * discovers them on its next scan, so a freshly installed skill appears in
 * the composer's `/` menu without a restart); uninstall removes them unless
 * the user edited one — the host enforces that, the page only reports.
 *
 * The demo suites ride along presentation-only: their ids are not host ids,
 * so a mutation attempt on one surfaces a notice instead of a doomed RPC.
 */
function SuitesPage(props: TianshuPagesComponentProps) {
  const { t, listSuites, installSuite, uninstallSuite, listSkills, sendSkillToComposer, actions } = props
  const [suites, setSuites] = useState<readonly SuiteEntry[] | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  const [hostSkillNames, setHostSkillNames] = useState<readonly string[] | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [heroIndex, setHeroIndex] = useState(0)
  const [sort, setSort] = useState<SuiteSort>('hot')
  const [scope, setScope] = useState<SuiteScope>('all')
  const [enabled, setEnabled] = useState<Readonly<Record<string, boolean>>>({})
  const [hint, setHint] = useState<string | undefined>(undefined)

  // One load on mount; a refetch after each mutation rides the mutation's
  // own echo (the RPC returns the re-projected catalogue).
  useEffect(() => {
    let cancelled = false
    listSuites()
      .then((rows) => { if (!cancelled) setSuites(rows) })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error))
      })
    return () => { cancelled = true }
    // The injected face is stable for the registration's lifetime.
  }, [])

  // The per-skill "in place" facts come from the current session's skill
  // catalogue; a rejection or no-session undefined leaves the install-state
  // fallback in charge.
  useEffect(() => {
    let cancelled = false
    listSkills()
      .then((rows) => {
        if (!cancelled) setHostSkillNames(rows === undefined ? undefined : rows.map(row => row.name))
      })
      .catch(() => { /* the install-state fallback stands in */ })
    return () => { cancelled = true }
    // The injected face is stable for the registration's lifetime.
  }, [])

  const allSuites: readonly SuiteEntry[] = [...(suites ?? []), ...DEMO_SUITES]
  // The demo set is a non-empty tuple, so the fallback keeps hero total.
  const hero = allSuites[heroIndex % allSuites.length] ?? DEMO_SUITES[0]

  // The hero carousel advances itself while the square shows; opening a
  // detail view retires the timer so the slide never moves under the user.
  useEffect(() => {
    if (selectedId !== undefined) return
    const timer = window.setInterval(() => { setHeroIndex(index => (index + 1) % allSuites.length) }, 5000)
    return () => { window.clearInterval(timer) }
    // Restart only when the detail view opens/closes or the catalogue size moves.
  }, [selectedId, allSuites.length])

  /** Run one suite mutation, installing the echoed catalogue. */
  const mutate = (suiteId: string, action: (id: string) => Promise<readonly SuiteEntry[]>): void => {
    setFailure(undefined)
    setHint(undefined)
    setBusyId(suiteId)
    action(suiteId)
      .then((rows) => { setSuites(rows); setBusyId(undefined) })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error))
        setBusyId(undefined)
      })
  }

  /** Install one suite; demo suites answer with a notice, not an RPC. */
  const onInstall = (suite: SuiteEntry): void => {
    if (isDemoSuite(suite.id)) { setHint(t('page.suites.demoNotice')); return }
    mutate(suite.id, installSuite)
  }

  /** Uninstall one suite; demo suites answer with a notice, not an RPC. */
  const onUninstall = (suite: SuiteEntry): void => {
    if (isDemoSuite(suite.id)) { setHint(t('page.suites.demoNotice')); return }
    mutate(suite.id, uninstallSuite)
  }

  /** Whether one skill of the suite is discoverable by the skills page. */
  const isPlaced = (suite: SuiteEntry, name: string): boolean =>
    hostSkillNames !== undefined ? hostSkillNames.includes(name) : suite.installed

  if (failure !== undefined) {
    return (
      <section>
        <p className={css.errorLine} role="alert">{t('page.suites.loadFailed')}：{failure}</p>
        <button type="button" className={css.rowActionBtn} onClick={() => { setFailure(undefined) }}>
          {t('page.suites.retry')}
        </button>
      </section>
    )
  }
  if (suites === undefined) {
    return (
      <section>
        <p className={css.notice}>{t('page.suites.loading')}</p>
      </section>
    )
  }

  const selected = allSuites.find(suite => suite.id === selectedId)
  if (selected !== undefined) {
    return (
      <SuiteDetail
        suite={selected}
        ready={selected.skills.filter(skill => isPlaced(selected, skill.name)).length}
        placed={name => isPlaced(selected, name)}
        enabled={enabled[selected.id] ?? true}
        busy={busyId === selected.id}
        t={t}
        onToggleEnable={() => { setEnabled(prev => ({ ...prev, [selected.id]: !(prev[selected.id] ?? true) })) }}
        onBack={() => { setSelectedId(undefined) }}
        onInstall={() => { onInstall(selected) }}
        onUninstall={() => { onUninstall(selected) }}
        onSend={(name) => { if (sendSkillToComposer(name)) actions.clear() }}
      />
    )
  }

  const ordered = sort === 'hot' ? allSuites : [...allSuites].reverse()
  const visible = ordered.filter(suite => scope === 'all' || suite.installed)

  return (
    <section>
      <div className={css.hero}>
        <div className={css.heroMain}>
          <div className={css.heroDots}>
            {allSuites.map((suite, index) => (
              <button
                key={suite.id} type="button"
                className={clsx(css.heroDot, index === heroIndex % allSuites.length && css.heroDotOn)}
                aria-label={suite.title}
                onClick={() => { setHeroIndex(index) }}
              />
            ))}
          </div>
          <div className={css.heroTitle}>{hero.title}</div>
          <p className={css.heroDesc}>{hero.description}</p>
          <button type="button" className={css.heroBtn} onClick={() => { setHint(t('page.suites.createNotice')) }}>
            {t('page.suites.heroCreate')}
          </button>
        </div>
        <div className={css.heroPills}>
          {allSuites.map(suite => (
            <button key={suite.id} type="button" className={css.heroPill} onClick={() => { setSelectedId(suite.id) }}>
              <SkillGlyph size={14} />{suite.title}
            </button>
          ))}
        </div>
      </div>
      {hint !== undefined && <p className={css.hintLine} role="status">{hint}</p>}

      <div className={css.tabsRow}>
        <button type="button" className={clsx(css.tab, scope === 'all' && css.tabOn)} onClick={() => { setScope('all') }}>
          {t('page.suites.square')}<span className={css.tabCount}>{allSuites.length}</span>
        </button>
        <button type="button" className={clsx(css.tab, scope === 'installed' && css.tabOn)} onClick={() => { setScope('installed') }}>
          {t('page.suites.installedTab')}<span className={css.tabCount}>{allSuites.filter(suite => suite.installed).length}</span>
        </button>
        <span className={css.seg}>
          <button type="button" className={clsx(css.segBtn, sort === 'hot' && css.segBtnOn)} onClick={() => { setSort('hot') }}>{t('page.suites.hot')}</button>
          <button type="button" className={clsx(css.segBtn, sort === 'new' && css.segBtnOn)} onClick={() => { setSort('new') }}>{t('page.suites.newest')}</button>
        </span>
      </div>

      <div className={css.suiteGrid}>
        {visible.map((suite) => {
          const ready = suite.skills.filter(skill => isPlaced(suite, skill.name)).length
          return (
            <article key={suite.id} className={css.suiteCard} onClick={() => { setSelectedId(suite.id) }}>
              {suite.installed
                ? (
                  <span className={css.suiteCheck} role="img" aria-label={t('page.suites.inPlace')}>
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
                  </span>
                )
                : (
                  <button
                    type="button" className={css.suitePlus} aria-label={t('page.suites.install')}
                    disabled={busyId === suite.id}
                    onClick={(event) => { event.stopPropagation(); onInstall(suite) }}
                  >+</button>
                )}
              <span className={css.glyphBox}><SuiteGlyph /></span>
              <div className={css.suiteName}>{suite.title}</div>
              <div className={css.suiteMeta}>{suite.tag} · {t('page.suites.official')}</div>
              <p className={css.suiteDesc}>{suite.description}</p>
              <div className={css.suiteFoot}>
                <span>{suite.skills.length} {t('page.suites.skillsUnit')}</span>
                <span className={css.suiteState}>
                  {suite.installed
                    ? `${t('page.suites.inPlace')} ${ready}/${suite.skills.length}`
                    : t('page.suites.notInstalled')}
                  {/* A shipped body that changed under an install: uninstall would preserve the
                      outdated files, so the card flags the state and the detail offers reinstall. */}
                  {suite.installed && !suite.current && (
                    <>
                      {' · '}
                      <span className={css.suiteOutdated}>{t('page.suites.outdated')}</span>
                    </>
                  )}
                </span>
              </div>
            </article>
          )
        })}
      </div>
      <p className={css.notice}>{t('page.suites.installNote')}</p>
    </section>
  )
}

/** Props of {@link SuiteDetail}. */
interface SuiteDetailProps {
  suite: SuiteEntry
  /** How many of the suite's skills the skills page currently recognizes. */
  ready: number
  /** Per-skill placement predicate — the same facts the count derives from. */
  placed: (name: string) => boolean
  enabled: boolean
  busy: boolean
  t: TianshuPagesComponentProps['t']
  onToggleEnable: () => void
  onBack: () => void
  onInstall: () => void
  onUninstall: () => void
  onSend: (name: string) => void
}

/**
 * One suite's detail view: the header card with the enable toggle, the quick
 * command rows (each one sends to the composer), and the knowledge rows
 * carrying the per-skill placement state.
 */
function SuiteDetail(props: SuiteDetailProps) {
  const { suite, t } = props
  return (
    <section>
      <button type="button" className={css.backLink} onClick={props.onBack}>← {t('page.suites.backSquare')}</button>
      <div className={css.detailHead}>
        <div className={css.detailHeadTop}>
          <span className={css.glyphBox}><SuiteGlyph /></span>
          <div className={css.detailTitleBox}>
            <div className={css.detailTitleLine}>
              <span className={css.detailTitle}>{suite.title}</span>
              <span className={css.detailTag}>{suite.tag}</span>
            </div>
            <div className={css.detailOrigin}>{t('page.suites.official')}</div>
          </div>
          <button
            type="button"
            className={clsx(css.detailToggle, props.enabled && css.detailToggleOn)}
            aria-pressed={props.enabled}
            onClick={props.onToggleEnable}
          >
            <span>{t('page.suites.enable')}</span>
            <span className={css.toggleKnob} />
          </button>
        </div>
        <p className={css.detailDesc}>{suite.description}</p>
        <div className={css.detailRecog}>
          <span>{t('page.suites.recognized')} {props.ready}/{suite.skills.length}</span>
          {!isDemoSuite(suite.id) && (
            <>
              {/* A shipped body that changed under an install: reinstall overwrites the user's
                  edited skills, so it sits beside 卸载 rather than replacing it. */}
              {suite.installed && !suite.current && (
                <button type="button" className={clsx(css.rowActionBtn, css.rowActionPrimary)} disabled={props.busy} onClick={props.onInstall}>
                  {t('page.suites.reinstall')}
                </button>
              )}
              {suite.installed
                ? (
                  <button type="button" className={css.rowActionBtn} disabled={props.busy} onClick={props.onUninstall}>
                    {t('page.suites.uninstall')}
                  </button>
                )
                : (
                  <button type="button" className={clsx(css.rowActionBtn, css.rowActionPrimary)} disabled={props.busy} onClick={props.onInstall}>
                    {t('page.suites.install')}
                  </button>
                )}
            </>
          )}
        </div>
      </div>

      <h2 className={css.sectionTitle}>{t('page.suites.quickCmds')} ({suite.skills.length})</h2>
      {suite.skills.map(skill => (
        <button key={skill.name} type="button" className={css.cmdRow} onClick={() => { props.onSend(skill.name) }}>
          <code className={css.cmdPill}>/{skill.name}</code>
          <span className={css.cmdTitle}>{skill.title}</span>
          <span className={css.cmdArrow} aria-hidden="true">→</span>
        </button>
      ))}

      <h2 className={css.sectionTitle}>{t('page.suites.knownSkills')} ({suite.skills.length})</h2>
      {suite.skills.map(skill => (
        <div key={skill.name} className={css.knowRow}>
          <div className={css.knowMain}>
            <div className={css.knowName}>{skill.title}</div>
            <p className={css.knowDesc}>{skill.summary}</p>
          </div>
          <span className={clsx(css.knowState, !props.placed(skill.name) && css.knowStateMiss)}>
            {props.placed(skill.name) ? t('page.suites.inPlace') : t('page.suites.notInPlace')}
          </span>
        </div>
      ))}

      <p className={css.notice}>{t('page.suites.installNote')}</p>
    </section>
  )
}

/**
 * One catalogued skill row. `body` is the condensed rule set the detail
 * dialog shows; `origin` names the suite (or the user's own root) the row
 * comes from; `modelInvocable` drives the invocable/manual badge.
 */
interface CataloguedSkill {
  readonly name: string
  readonly zh: string
  readonly category: 'doc' | 'data' | 'dev'
  readonly description: string
  readonly body: string
  readonly origin: string
  readonly fromSuite: boolean
  readonly modelInvocable: boolean
}

/**
 * The built-in skill catalogue — the five shipped skills with their local
 * Chinese titles, categories, and condensed bodies. Presentation metadata:
 * the host carries only names.
 */
const BUILTIN_SKILLS: readonly CataloguedSkill[] = [
  {
    name: 'data-visualization',
    zh: '数据可视化',
    category: 'data',
    description: '按数据特征选图型（趋势/对比/构成/分布/关系），产出 ECharts 配置或独立 HTML 图表页，附关键数字复述与作图规则。',
    body: '何时选什么图：趋势→折线（≤5序列）；类别对比→柱状（>12类改横条）；构成→饼/环（>6扇区合并“其他”）；分布→直方；关系→散点（>2000点抽样）。\n\n产出形态二选一：独立 HTML 单文件（echarts CDN，深浅色跟随系统）或纯 option 配置 JSON。\n\n规则：结论数字先行；坐标轴从 0 起；空/单点/全零数据说明原因不作图；中文标签超宽旋转 30° 不截断。',
    origin: '办公六件套',
    fromSuite: true,
    modelInvocable: true,
  },
  {
    name: 'weekly-report',
    zh: '工作周报',
    category: 'doc',
    description: '从口述/会话记录提取「完成/进行中/下周计划/风险」四段，书面语润色不虚构，附纯文本粘贴版。',
    body: '固定四段：本周完成（动词开头 ≤6 条带量化）、进行中（进度%+预计完成）、下周计划（3-5 条，未完成置顶）、风险与求助（无则写“无”）。\n\n素材优先级：口述→会话记录（引用具体数字）→都没有则追问，不虚构。\n\n语体：用“完成/推进/上线/修复”；数字带单位；每条 ≤40 字。产出末尾附纯文本块供粘贴进 OA/IM。',
    origin: '办公六件套',
    fromSuite: true,
    modelInvocable: true,
  },
  {
    name: 'data-analysis',
    zh: '数据分析',
    category: 'data',
    description: '数据体检→描述统计→分组对比与加法拆解→结论先行报告，相关不称因果，小样本必标注。',
    body: '流程固定：① 数据体检（缺失/重复先报告不静默处理）② 描述统计（只报相关列）③ 按维度对比，变化类做量×价拆解指出主贡献 ④ 结论三层：关键发现 ≤3 条→支撑数字→建议（标“供参考”）。\n\n规则：结论先行不倒叙；相关≠因果；样本 <30 标注；缺失 >40% 的列不参与；超 20 个数字的统计必须写代码执行，不手算。',
    origin: '办公六件套',
    fromSuite: true,
    modelInvocable: true,
  },
  {
    name: 'tech-proposal',
    zh: '技术方案',
    category: 'doc',
    description: '「背景目标-选型-架构-实施-风险」五段结构，含选型对比表与里程碑验收标准，产出 Word 文件并在对话中给出正文。',
    body: '交付两件：① Word 文件——先用 write 写成 HTML（选型对比用真 <table>），再 convert_document 转 docx，报 lossy 时说明损失；② 对话里的 Markdown 正文（架构可附 Mermaid）。\n\n五段缺一不可：① 背景与目标（痛点带数字、目标可验收、明确“不做什么”）② 选型（≥2 候选逐项对比：成熟度/生态/熟悉度/迁移成本/许可证，表格+一句话结论）③ 架构（模块/数据流/关键接口，每个决策附“为什么不用显然的替代”；Word 里用文字描述）④ 实施（里程碑含交付物/验收标准/依赖，工期乐观正常两档）⑤ 风险（概率×影响+对策+兜底，无兜底标“需上报”）。\n\n语体：数字带单位与前提；无法核实的写“待压测确认”。成稿后逐条过自检清单。',
    origin: '办公六件套',
    fromSuite: true,
    modelInvocable: true,
  },
  {
    name: 'format-convert',
    zh: '格式转换',
    category: 'doc',
    description: '在 13 种文档/表格/演示格式之间转换文件，族内互转与导出 PDF 完整，跨族直接拒绝，转后如实报告版面是否保留。',
    body: '调用 convert_document：path（源文件）、to（目标格式）、output_path（可选，默认同目录换扩展名）、overwrite（可选，默认 false）。\n\n能转什么：文档族（doc/docx/odt/rtf/txt/html）、表格族（xls/xlsx/ods）、演示族（ppt/pptx/odp）各族内部任意互转；三族任意格式都能导出 pdf；pdf 作为源只取得回文字；跨族（如 xlsx→pptx）不存在，工具直接拒绝，不绕路硬凑。\n\n保真度必须转述：faithful 直接说“已转换”；lossy 必须明说损失了什么（版面/样式/结构没保留）。绝不把 lossy 说成 faithful，也绝不宣称被拒绝的转换。\n\n规则：不自行改输出目录；目标已存在时先问覆盖还是换名，不默认 overwrite；多文件逐个转逐个报告；失败时原样转述原因，不猜是否缺程序。',
    origin: '办公六件套',
    fromSuite: true,
    modelInvocable: true,
  },
]

/** Metadata of the demo own row, shared with the extras table below. */
const DEMO_OWN_META: { zh: string; category: 'doc' | 'data' | 'dev' } = { zh: '内部规范整理', category: 'doc' }

/**
 * Metadata for catalogued skills beyond the shipped five: suite skills the
 * host catalogue carries (official-document), the demo-suite skills, and the
 * demo own skill. One lookup serves every row source; the host carries only
 * names, so titles and categories stay UI-local.
 */
const EXTRA_SKILL_META: Readonly<Record<string, { zh: string; category: 'doc' | 'data' | 'dev' }>> = {
  'official-document': { zh: '公文格式', category: 'doc' },
  'gov-notice': { zh: '通知通告', category: 'doc' },
  'gov-request': { zh: '请示报告', category: 'doc' },
  'gov-minutes': { zh: '会议纪要', category: 'doc' },
  'code-review': { zh: '代码评审', category: 'dev' },
  'api-doc': { zh: '接口文档', category: 'dev' },
  'release-notes': { zh: '发布说明', category: 'dev' },
  'incident-review': { zh: '故障复盘', category: 'dev' },
  'team-style-guide': DEMO_OWN_META,
}

/** The presentation-only own-skill row, shown only while no session lists
 *  skills — the same stand-in rule the suite catalogue follows. */
const DEMO_OWN_SKILL = {
  name: 'team-style-guide',
  description: '按团队既有规范整理文档结构与用语，仅手动调用，不开放给模型自动触发。',
}

/** Catalogue category keys, in filter order. */
const SKILL_CATEGORIES = [
  { key: 'all', label: 'page.skills.catAll' },
  { key: 'doc', label: 'page.skills.catDoc' },
  { key: 'data', label: 'page.skills.catData' },
  { key: 'dev', label: 'page.skills.catDev' },
] as const

type SkillCategoryFilter = (typeof SKILL_CATEGORIES)[number]['key']

/** Scope tab of the skill square: everything, suite-derived rows, own rows. */
type SkillScope = 'square' | 'suite' | 'own'

/** Sort of the square: catalogue order vs by Chinese title. */
type SkillSort = 'frequent' | 'name'

/**
 * The 技能 square. The suite-derived rows come from the same merged suite
 * catalogue the suites page shows; the own rows are the host's session skill
 * listing minus the suite skills — with no session (or an empty one), the
 * presentation-only demo own row stands in rather than implying an empty
 * catalogue. The category chips are a UI-local grouping, not a host source.
 */
function SkillsPage(props: TianshuPagesComponentProps) {
  const { t, sendSkillToComposer, listSkills, listSuites, actions } = props
  const [scope, setScope] = useState<SkillScope>('square')
  const [sort, setSort] = useState<SkillSort>('frequent')
  const [category, setCategory] = useState<SkillCategoryFilter>('all')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<CataloguedSkill | undefined>(undefined)
  const [hostRows, setHostRows] = useState<readonly SkillEntry[] | undefined>(undefined)
  const [suites, setSuites] = useState<readonly SuiteEntry[] | undefined>(undefined)

  // Session-addressed listing: only a current session can be asked. A
  // refusal or absence keeps the local stand-in — the page never implies a
  // load it cannot serve.
  useEffect(() => {
    let cancelled = false
    listSkills()
      .then((rows) => { if (!cancelled) setHostRows(rows) })
      .catch(() => { /* the local stand-in rules the rows */ })
    return () => { cancelled = true }
    // The injected face is stable for the registration's lifetime.
  }, [])

  // The suite-derived rows ride the catalogue the suites page shows; a
  // rejection (no suite service mounted) leaves the demo suites alone.
  useEffect(() => {
    let cancelled = false
    listSuites()
      .then((rows) => { if (!cancelled) setSuites(rows) })
      .catch(() => { /* the demo suites stand in */ })
    return () => { cancelled = true }
    // The injected face is stable for the registration's lifetime.
  }, [])

  /** One row's local metadata lookup: the shipped table first, extras second. */
  const metaOf = (name: string): { zh: string; category: 'doc' | 'data' | 'dev'; body?: string } => {
    const builtin = BUILTIN_SKILLS.find(skill => skill.name === name)
    if (builtin !== undefined) return builtin
    return EXTRA_SKILL_META[name] ?? { zh: name, category: 'doc' }
  }

  const suiteRows: readonly CataloguedSkill[] = [...(suites ?? []), ...DEMO_SUITES].flatMap(suite =>
    suite.skills.map((skill) => {
      const meta = metaOf(skill.name)
      return {
        name: skill.name,
        zh: skill.title,
        category: meta.category,
        description: skill.summary,
        body: meta.body ?? skill.summary,
        origin: suite.title,
        fromSuite: true,
        modelInvocable: true,
      }
    }))

  const suiteNames = new Set(suiteRows.map(row => row.name))
  const ownRows: readonly CataloguedSkill[] = (hostRows ?? [])
    .filter(entry => !suiteNames.has(entry.name))
    .map((entry) => {
      const meta = metaOf(entry.name)
      return {
        name: entry.name,
        zh: meta.zh,
        category: meta.category,
        description: entry.description,
        body: meta.body ?? entry.description,
        origin: t('page.skills.ownSource'),
        fromSuite: false,
        modelInvocable: entry.modelInvocable !== false,
      }
    })
  const rows: readonly CataloguedSkill[] = scope === 'suite' ? suiteRows
    : scope === 'own' ? ownRows
      : [...suiteRows, ...ownRows]
  // With no session listing (or an empty one), the demo own row keeps the
  // own scope from reading as a bare zero.
  const standingOwnRow: readonly CataloguedSkill[] = (hostRows === undefined || hostRows.length === 0)
    ? [{
      name: DEMO_OWN_SKILL.name,
      zh: DEMO_OWN_META.zh,
      category: DEMO_OWN_META.category,
      description: DEMO_OWN_SKILL.description,
      body: DEMO_OWN_SKILL.description,
      origin: t('page.skills.ownSource'),
      fromSuite: false,
      modelInvocable: false,
    }]
    : []
  // The demo own row stands in for the own scope on the square and the own
  // tab; the suite tab stays purely suite-derived.
  const rowsWithOwn = scope === 'suite' ? rows : [...rows, ...standingOwnRow]

  const ordered = sort === 'frequent'
    ? rowsWithOwn
    : [...rowsWithOwn].sort((a, b) => a.zh.localeCompare(b.zh, 'zh'))
  const visible = ordered.filter(row =>
    (category === 'all' || row.category === category)
    && (query.trim() === ''
      || `${row.zh}${row.name}${row.description}`.toLowerCase().includes(query.trim().toLowerCase())))

  /** Count one category chip over the rows the current scope serves. */
  const countOf = (key: SkillCategoryFilter): number =>
    key === 'all' ? rowsWithOwn.length : rowsWithOwn.filter(row => row.category === key).length

  /** Prefill the current session's composer; keep the page open on failure. */
  const send = (name: string): void => {
    if (sendSkillToComposer(name)) props.actions.clear()
  }

  return (
    <section>
      <div className={css.skillHero}>
        <span className={css.skillHeroIcon}><SuiteGlyph size={22} /></span>
        <div className={css.skillHeroMain}>
          <div className={css.skillHeroTitle}>{t('page.skills.heroTitle')}</div>
          <p className={css.skillHeroDesc}>{t('page.skills.heroDesc')}</p>
        </div>
        <button type="button" className={css.skillHeroBtn} onClick={() => { actions.select('suites') }}>
          {t('page.skills.gotoSuites')} →
        </button>
      </div>

      <div className={css.tabsRow}>
        <button type="button" className={clsx(css.tab, scope === 'square' && css.tabOn)} onClick={() => { setScope('square') }}>
          {t('page.skills.square')}<span className={css.tabCount}>{suiteRows.length + ownRows.length + standingOwnRow.length}</span>
        </button>
        <button type="button" className={clsx(css.tab, scope === 'suite' && css.tabOn)} onClick={() => { setScope('suite') }}>
          {t('page.skills.suiteOwned')}<span className={css.tabCount}>{suiteRows.length}</span>
        </button>
        <button type="button" className={clsx(css.tab, scope === 'own' && css.tabOn)} onClick={() => { setScope('own') }}>
          {t('page.skills.own')}<span className={css.tabCount}>{ownRows.length + standingOwnRow.length}</span>
        </button>
        <span className={css.seg}>
          <button type="button" className={clsx(css.segBtn, sort === 'frequent' && css.segBtnOn)} onClick={() => { setSort('frequent') }}>{t('page.skills.frequent')}</button>
          <button type="button" className={clsx(css.segBtn, sort === 'name' && css.segBtnOn)} onClick={() => { setSort('name') }}>{t('page.skills.byName')}</button>
        </span>
      </div>

      <div className={css.chipsRow}>
        {SKILL_CATEGORIES.map(({ key, label }) => (
          <button
            key={key} type="button"
            className={clsx(css.chip, category === key && css.chipActive)}
            onClick={() => { setCategory(key) }}
          >
            {t(label)}
            <span className={css.chipCount}>{countOf(key)}</span>
          </button>
        ))}
        <input
          className={css.skillSearch}
          type="search"
          placeholder={t('page.skills.searchPlaceholder')}
          aria-label={t('page.skills.searchPlaceholder')}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </div>

      {visible.length === 0
        ? <p className={css.empty}>{t('page.skills.emptySearch')}</p>
        : (
          <div className={css.skillGrid}>
            {visible.map(row => (
              <article key={row.name} className={css.skillCard}>
                <div className={css.skillCardTop}>
                  <span className={css.glyphBox}><SkillGlyph /></span>
                  <div className={css.skillCardTitleBox}>
                    <div className={css.skillCardName}>{row.zh}</div>
                    <div className={css.skillCardCmd}>/{row.name}</div>
                  </div>
                  <span className={clsx(css.skillBadge, !row.modelInvocable && css.skillBadgeManual)}>
                    {row.modelInvocable ? t('page.skills.modelInvocable') : t('page.skills.manualOnly')}
                  </span>
                </div>
                <p className={css.skillCardDesc}>{row.description}</p>
                <div className={css.skillCardFoot}>
                  <span className={css.skillFrom}>{t('page.skills.from')} <b>{row.origin}</b></span>
                  <span className={css.skillBtns}>
                    <button type="button" className={css.btnView} onClick={() => { setDetail(row) }}>
                      {t('page.skills.view')}
                    </button>
                    <button type="button" className={css.btnSend} onClick={() => { send(row.name) }}>
                      {t('page.skills.sendToComposer')}
                    </button>
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

      <Modal
        open={detail !== undefined}
        onClose={() => { setDetail(undefined) }}
        title={detail === undefined ? '' : `${detail.zh} /${detail.name}`}
        closeLabel={t('page.skills.close')}
        footer={(
          <>
            <button type="button" className={css.btnGhost} onClick={() => { setDetail(undefined) }}>
              {t('page.skills.close')}
            </button>
            {detail !== undefined && (
              <button
                type="button" className={css.btnPrimary}
                onClick={() => { const name = detail.name; setDetail(undefined); send(name) }}
              >
                {t('page.skills.sendToComposer')}
              </button>
            )}
          </>
        )}
      >
        <p className={css.dialogBody}>{detail?.body}</p>
      </Modal>
    </section>
  )
}

/**
 * The MCP page: connected Model Context Protocol servers. Each mcp-client
 * instance is one server configured through the profile's cordis.yml, and
 * none ships enabled by default — so the page presents the honest empty
 * state (how to add a server) rather than a fabricated catalogue.
 */
function McpPage({ t }: { t: TianshuPagesComponentProps['t'] }) {
  return (
    <section>
      <h2 className={css.sectionTitle}>{t('page.mcp.catalogue')}</h2>
      <p className={css.notice}>{t('page.mcp.deferredNotice')}</p>
    </section>
  )
}

/**
 * The 连接器 page: the platform's external service attachments. The host's
 * attachable surfaces today are the model providers and credentials managed
 * in Settings — this page states that honestly until a dedicated connector
 * domain exists.
 */
function ConnectorPage({ t }: { t: TianshuPagesComponentProps['t'] }) {
  return (
    <section>
      <h2 className={css.sectionTitle}>{t('page.connector.catalogue')}</h2>
      <p className={css.notice}>{t('page.connector.deferredNotice')}</p>
    </section>
  )
}

/**
 * The 会话管理 page: every session across the two axes, with open, rename,
 * archive/unarchive, folder filing, soft-delete, and restore.
 *
 * View state (folder, state filter, open menu, dialog) is component-local: it
 * dies with the page and no other entry reads it. Every durable fact arrives
 * through the framework hooks and leaves through the injected actions.
 */
function SessionsPage(props: TianshuPagesComponentProps) {
  const { useSessions, useWorkspaces, t } = props
  // Session rows come from the framework's standard delivery, so the list is
  // the same truth the sidebar browser renders. `ids` carries host order.
  const ids = useSessions(s => s.ids)
  const sessionsById = useSessions(s => s.byId)
  // One snapshot read: the state object is reference-stable between changes.
  const workspaces = useWorkspaces(s => s)

  const [folder, setFolder] = useState<FolderSelection>(null)
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [menuFor, setMenuFor] = useState<SessionId | undefined>(undefined)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const archived = useMemo(() => new Set(workspaces.archivedSessionIds), [workspaces])
  const deleted = useMemo(() => new Set(workspaces.deletedSessionIds), [workspaces])
  // Session → owning folder ids, derived once per collection snapshot.
  const memberships = useMemo(() => {
    const map = new Map<SessionId, CollectionId[]>()
    for (const collection of workspaces.collections) {
      for (const id of collection.sessionIds) {
        const list = map.get(id) ?? []
        list.push(collection.collectionId)
        map.set(id, list)
      }
    }
    return map
  }, [workspaces])

  /** Whether one session is in the current folder scope; root passes all. */
  const inFolderScope = (id: SessionId): boolean => {
    if (folder === null) return true
    const members = memberships.get(id) ?? []
    return folder === UNGROUPED ? members.length === 0 : members.includes(folder)
  }
  /** Whether one session passes the archive-state axis. */
  const passState = (id: SessionId, filter: StateFilter): boolean => {
    if (filter === 'bin') return deleted.has(id)
    if (deleted.has(id)) return false
    if (filter === 'active') return !archived.has(id)
    if (filter === 'archived') return archived.has(id)
    return true
  }

  const visible = ids.filter(id => inFolderScope(id) && passState(id, stateFilter))
  /** Count within the current folder scope — the intersection, not the total. */
  const countInScope = (filter: StateFilter): number =>
    ids.filter(id => inFolderScope(id) && passState(id, filter)).length

  /** Run one injected action, surfacing a rejection instead of dropping it. */
  const run = (action: () => Promise<void>): void => {
    setFailure(undefined)
    action().catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
    })
  }

  const folderTitle = folder === UNGROUPED
    ? t('page.sessions.uncategorized')
    : workspaces.collections.find(c => c.collectionId === folder)?.title ?? ''
  const heading = stateFilter === 'bin'
    ? t('page.sessions.filterDeleted')
    : folder !== null ? folderTitle : t('page.sessions.rootFolder')

  return (
    <section className={css.sessionsBody}>
      <aside className={css.rail}>
        <div className={css.railHead}>{t('page.sessions.folders')}</div>
        <div className={css.railRow}>
          <button
            type="button"
            className={clsx(css.railItem, folder === null && css.railActive)}
            onClick={() => { setFolder(null) }}
          >
            <span className={css.railName}>{t('page.sessions.rootFolder')}</span>
          </button>
        </div>
        {workspaces.collections.map(collection => (
          <div key={collection.collectionId} className={css.railRow}>
            <button
              type="button"
              className={clsx(css.railItem, folder === collection.collectionId && css.railActive)}
              onClick={() => { setFolder(collection.collectionId); if (stateFilter === 'bin') setStateFilter('all') }}
            >
              <span className={css.railName}>{collection.title}</span>
            </button>
            {folder === collection.collectionId && (
              <>
                <button
                  type="button" className={css.railTool} title={t('page.sessions.renameFolderTitle')}
                  onClick={() => { setDialog({ kind: 'renameFolder', collectionId: collection.collectionId, initial: collection.title }) }}
                >✎</button>
                <button
                  type="button" className={css.railTool} title={t('page.sessions.deleteFolderTitle')}
                  onClick={() => { setDialog({ kind: 'deleteFolder', collectionId: collection.collectionId }) }}
                >✕</button>
              </>
            )}
          </div>
        ))}
        <div className={css.railRow}>
          <button
            type="button"
            className={clsx(css.railItem, folder === UNGROUPED && css.railActive)}
            onClick={() => { setFolder(UNGROUPED); if (stateFilter === 'bin') setStateFilter('all') }}
          >
            <span className={css.railName}>{t('page.sessions.uncategorized')}</span>
          </button>
        </div>
        <button type="button" className={css.railAdd} onClick={() => { setDialog({ kind: 'newFolder' }) }}>
          {t('page.sessions.newFolder')}
        </button>
      </aside>

      <div className={css.main}>
        {folder !== null && stateFilter !== 'bin' ? (
          // In-folder scope bar: the global state row retires so the axes
          // never read as one list; sub-filters count within the folder.
          <div className={css.scopeBar}>
            <span className={css.scopeCount}>{visible.length} {t('page.sessions.scopeUnit')}</span>
            <span className={css.filtersSep} />
            {(['all', 'active', 'archived'] as const).map(filter => (
              <button
                key={filter} type="button"
                className={clsx(css.subChip, stateFilter === filter && css.subChipActive)}
                onClick={() => { setStateFilter(filter) }}
              >
                {t(STATE_LABEL[filter])}
                <span className={css.chipCount}>{countInScope(filter)}</span>
              </button>
            ))}
            <button type="button" className={css.exitFolder} onClick={() => { setFolder(null) }}>
              {t('page.sessions.exitFolder')}
            </button>
          </div>
        ) : (
          <div className={css.filters}>
            {(['all', 'active', 'archived', 'bin'] as const).map(filter => (
              <button
                key={filter} type="button"
                className={clsx(css.chip, stateFilter === filter && css.chipActive)}
                onClick={() => { setStateFilter(filter); if (filter === 'bin') setFolder(null) }}
              >
                {t(STATE_LABEL[filter])}
                <span className={css.chipCount}>{ids.filter(id => passState(id, filter)).length}</span>
              </button>
            ))}
          </div>
        )}

        <h2 className={css.sectionTitle}>{heading}</h2>

        {failure !== undefined && (
          <p className={css.errorLine} role="alert">{t('page.sessions.actionFailed')}：{failure}</p>
        )}

        {visible.length === 0
          ? (
            <p className={css.empty}>{
              stateFilter === 'bin' ? t('page.sessions.emptyBin')
                : folder !== null ? t('page.sessions.emptyFolder')
                  : t('page.sessions.empty')
            }</p>
          )
          : (
            <ul className={css.list}>
              {visible.map(id => (
                <SessionRow
                  key={id}
                  id={id}
                  title={sessionsById[id]?.title}
                  blank={sessionsById[id]?.blank === true}
                  deleted={deleted.has(id)}
                  archived={archived.has(id)}
                  folderTags={folder === null || folder === UNGROUPED
                    ? workspaces.collections
                      .filter(c => (memberships.get(id) ?? []).includes(c.collectionId))
                      .map(c => c.title)
                    : []}
                  menuOpen={menuFor === id}
                  menuEntries={menuEntriesFor(id)}
                  memberFolderIds={(memberships.get(id) ?? []).map(cid => `file:${cid}`)}
                  t={t}
                  onOpen={() => { props.actions.clear(); props.openSession(id) }}
                  onMenuToggle={() => { setMenuFor(menuFor === id ? undefined : id) }}
                  onMenuClose={() => { setMenuFor(undefined) }}
                  onMenuSelect={(entry) => { setMenuFor(undefined); handleMenuSelect(id, entry) }}
                  onRestore={() => { run(() => props.restoreSession(id)) }}
                />
              ))}
            </ul>
          )}
      </div>

      {dialog !== undefined && (
        <SessionsDialog
          key={`${dialog.kind}:${'sessionId' in dialog ? dialog.sessionId : ''}${'collectionId' in dialog ? dialog.collectionId : ''}`}
          dialog={dialog}
          actions={props}
          t={t}
          onClose={() => { setDialog(undefined) }}
          run={run}
        />
      )}
    </section>
  )

  /** Row-menu entries for one session: lifecycle verbs plus folder filing. */
  function menuEntriesFor(id: SessionId): readonly MenuEntry[] {
    const filing: MenuEntry[] = workspaces.collections.length === 0
      ? [{ id: 'no-folders', label: t('page.sessions.menuNoFolders'), disabled: true }]
      : workspaces.collections.map(collection => ({
        id: `file:${collection.collectionId}`,
        label: collection.title,
      }))
    return [
      { id: 'open', label: t('page.sessions.menuOpen') },
      { id: 'rename', label: t('page.sessions.menuRename') },
      archived.has(id)
        ? { id: 'unarchive', label: t('page.sessions.menuUnarchive') }
        : { id: 'archive', label: t('page.sessions.menuArchive') },
      { type: 'separator', id: 'file-sep' },
      { type: 'label', id: 'file-label', text: t('page.sessions.menuFileUnder') },
      ...filing,
      { type: 'separator', id: 'danger-sep' },
      { id: 'delete', label: t('page.sessions.menuDelete'), danger: true },
    ]
  }

  /** Dispatch one row-menu selection, including folder membership toggles. */
  function handleMenuSelect(id: SessionId, entry: string): void {
    if (entry === 'open') { props.openSession(id); return }
    if (entry === 'rename') {
      const summary = sessionsById[id]
      setDialog({ kind: 'renameSession', sessionId: id, initial: summary?.title ?? '' })
      return
    }
    if (entry === 'archive') { run(() => props.archiveSession(id)); return }
    if (entry === 'unarchive') { run(() => props.unarchiveSession(id)); return }
    if (entry === 'delete') {
      const summary = sessionsById[id]
      setDialog({ kind: 'deleteSession', sessionId: id, title: summary?.title ?? '' })
      return
    }
    /* v8 ignore else -- every non-filing verb returns above, so only the file: filing rows reach here. */
    if (entry.startsWith('file:')) {
      const collectionId = entry.slice('file:'.length) as CollectionId
      const isMember = (memberships.get(id) ?? []).includes(collectionId)
      run(() => isMember
        ? props.removeSessionFromCollection(collectionId, id)
        : props.addSessionToCollection(collectionId, id))
    }
  }
}

/** Props of {@link SessionRow}. */
interface SessionRowProps {
  id: SessionId
  title: string | undefined
  blank: boolean
  deleted: boolean
  archived: boolean
  /** Folder tags; suppressed when the row already sits inside one of them. */
  folderTags: readonly string[]
  menuOpen: boolean
  menuEntries: readonly MenuEntry[]
  /** Filing menu-entry ids of folders this session already sits in. */
  memberFolderIds: readonly string[]
  t: TianshuPagesComponentProps['t']
  onOpen: () => void
  onMenuToggle: () => void
  onMenuClose: () => void
  onMenuSelect: (entry: string) => void
  onRestore: () => void
}

/** One session row: the title opens; the ⋯ menu carries the verbs; bin rows restore. */
function SessionRow(props: SessionRowProps) {
  const { t } = props
  // Same rule the workspace tree applies (rows/Rows.tsx): a blank session is
  // named for what it is, so the two surfaces do not give one session two
  // names. A titled session that has gone untitled falls back separately.
  const untitled = props.blank || (props.title ?? '') === ''
  const title = untitled ? t('page.sessions.untitled') : props.title

  return (
    <li className={css.row}>
      <div className={css.rowMain}>
        <button
          type="button"
          className={clsx(css.rowTitle, css.rowTitleButton, untitled && css.rowUntitled)}
          disabled={props.deleted}
          onClick={props.onOpen}
        >
          {title}
        </button>
        <span className={css.rowTags}>
          {props.folderTags.map(tag => (
            <span key={tag} className={css.stateTag}>{tag}</span>
          ))}
          {props.archived && <span className={clsx(css.stateTag, css.stateTagArchived)}>{t('page.sessions.filterArchived')}</span>}
          {props.deleted && <span className={clsx(css.stateTag, css.stateTagDeleted)}>{t('page.sessions.filterDeleted')}</span>}
        </span>
      </div>
      {props.deleted
        ? (
          <button type="button" className={css.rowActionBtn} onClick={props.onRestore}>
            {t('page.sessions.restore')}
          </button>
        )
        : (
          <Menu
            open={props.menuOpen}
            onClose={props.onMenuClose}
            items={props.menuEntries}
            selectedIds={props.memberFolderIds}
            onSelect={props.onMenuSelect}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button" className={css.more} aria-label={t('page.sessions.rowMenu')}
                onClick={props.onMenuToggle}
              >⋯</button>
            )}
          />
        )}
    </li>
  )
}

/** Props of {@link SessionsDialog}. */
interface SessionsDialogProps {
  dialog: Dialog
  actions: TianshuPagesInjected
  t: TianshuPagesComponentProps['t']
  onClose: () => void
  /** Runs the dialog's action after the dialog has closed itself. */
  run: (action: () => Promise<void>) => void
}

/** The one modal the sessions page holds: rename / folder create / confirms. */
function SessionsDialog(props: SessionsDialogProps) {
  const { dialog, actions, t, onClose, run } = props

  if (dialog.kind === 'renameSession') {
    return (
      <NamedDialog
        title={t('page.sessions.renameTitle')}
        placeholder={t('page.sessions.renamePlaceholder')}
        t={t}
        onClose={onClose}
        onSubmit={(value) => { run(() => actions.renameSession(dialog.sessionId, value)) }}
      />
    )
  }
  if (dialog.kind === 'newFolder' || dialog.kind === 'renameFolder') {
    const renaming = dialog.kind === 'renameFolder'
    return (
      <NamedDialog
        title={renaming ? t('page.sessions.renameFolderTitle') : t('page.sessions.newFolderTitle')}
        description={t('page.sessions.folderNote')}
        placeholder={t('page.sessions.folderNamePlaceholder')}
        initial={renaming ? dialog.initial : ''}
        t={t}
        onClose={onClose}
        onSubmit={(value) => {
          run(() => renaming
            ? actions.renameCollection(dialog.collectionId, value)
            : actions.createCollection(value))
        }}
      />
    )
  }
  if (dialog.kind === 'deleteSession') {
    return (
      <ConfirmDialog
        title={t('page.sessions.deleteTitle')}
        body={`${dialog.title === '' ? t('page.sessions.untitled') : dialog.title}${t('page.sessions.deleteBody')}`}
        t={t}
        onClose={onClose}
        onConfirm={() => { run(() => actions.deleteSession(dialog.sessionId)) }}
      />
    )
  }
  return (
    <ConfirmDialog
      title={t('page.sessions.deleteFolderTitle')}
      body={t('page.sessions.deleteFolderBody')}
      t={t}
      onClose={onClose}
      onConfirm={() => { run(() => actions.deleteCollection(dialog.collectionId)) }}
    />
  )
}

/** Props of {@link NamedDialog}. */
interface NamedDialogProps {
  title: string
  description?: string
  placeholder: string
  /** Prefilled value; a fresh dialog starts empty. */
  initial?: string
  t: TianshuPagesComponentProps['t']
  onClose: () => void
  onSubmit: (value: string) => void
}

/** The text-input modal family: session rename and folder create/rename. */
function NamedDialog(props: NamedDialogProps) {
  const [value, setValue] = useState(props.initial ?? '')
  const [error, setError] = useState('')

  const submit = (): void => {
    // The host rejects blanks too; this local guard keeps the dialog open and
    // answers before a round trip.
    if (value.trim() === '') { setError(props.t('page.sessions.nameRequired')); return }
    props.onSubmit(value.trim())
  }

  return (
    <Modal
      open onClose={props.onClose} title={props.title}
      closeLabel={props.t('page.sessions.cancel')}
      {...(props.description !== undefined ? { description: props.description } : {})}
      footer={(
        <>
          <button type="button" className={css.btnGhost} onClick={props.onClose}>{props.t('page.sessions.cancel')}</button>
          <button type="button" className={css.btnPrimary} onClick={submit}>{props.t('page.sessions.save')}</button>
        </>
      )}
    >
      <Input
        autoFocus
        value={value}
        placeholder={props.placeholder}
        aria-label={props.title}
        onChange={(event) => { setValue(event.target.value) }}
        onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
      />
      {error !== '' && <p className={css.errorLine} role="alert">{error}</p>}
    </Modal>
  )
}

/** Props of {@link ConfirmDialog}. */
interface ConfirmDialogProps {
  title: string
  body: string
  t: TianshuPagesComponentProps['t']
  onClose: () => void
  onConfirm: () => void
}

/** The confirm modal family: delete-session and delete-folder. */
function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Modal
      open onClose={props.onClose} title={props.title}
      closeLabel={props.t('page.sessions.cancel')}
      footer={(
        <>
          <button type="button" className={css.btnGhost} onClick={props.onClose}>{props.t('page.sessions.cancel')}</button>
          <button type="button" className={css.btnDanger} onClick={props.onConfirm}>{props.t('page.sessions.deleteAction')}</button>
        </>
      )}
    >
      <p className={css.dialogBody}>{props.body}</p>
    </Modal>
  )
}
