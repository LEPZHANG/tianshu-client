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

  return (
    <div className={css.root}>
      {/* First grid track is the sidebar's: left empty so it stays operable. */}
      <div className={css.pane}>
        {/* No close button: navigation rows toggle pages (re-selecting the
            current one closes it) and any conversation entry retires the page
            through the sidebar's current-session watch, so the page needs no
            dedicated exit affordance. */}
        <header className={css.head}>
          <div>
            <h1 className={css.title}>{props.t(heading)}</h1>
            <p className={css.caption}>{props.t(caption)}</p>
          </div>
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

/**
 * The 专家套件 catalogue, driven by the host's suite RPCs. Install writes
 * the bundled skills under the user skill root (the filesystem provider
 * discovers them on its next scan, so a freshly installed skill appears in
 * the composer's `/` menu without a restart); uninstall removes them unless
 * the user edited one — the host enforces that, the page only reports.
 */
function SuitesPage(props: TianshuPagesComponentProps) {
  const { t, listSuites, installSuite, uninstallSuite } = props
  const [suites, setSuites] = useState<readonly SuiteEntry[] | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [busyId, setBusyId] = useState<string | undefined>(undefined)

  // One load on mount; a refetch after each mutation rides the mutation's
  // own echo (the RPC returns the re-projected catalogue).
  useEffect(() => {
    let cancelled = false
    listSuites()
      .then(rows => { if (!cancelled) setSuites(rows) })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error))
      })
    return () => { cancelled = true }
    // The injected face is stable for the registration's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Run one suite mutation, installing the echoed catalogue. */
  const mutate = (suiteId: string, action: (id: string) => Promise<readonly SuiteEntry[]>): void => {
    setFailure(undefined)
    setBusyId(suiteId)
    action(suiteId)
      .then(rows => { setSuites(rows); setBusyId(undefined) })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error))
        setBusyId(undefined)
      })
  }

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

  return (
    <section>
      <h2 className={css.sectionTitle}>{t('page.suites.catalogue')}</h2>
      <div className={css.grid}>
        {suites.map(suite => (
          <article key={suite.id} className={css.card}>
            <div className={css.cardHead}>
              <span className={css.cardName}>{suite.title}</span>
              <span className={css.tag}>{suite.tag}</span>
            </div>
            <p className={css.cardBody}>{suite.description}</p>
            <div className={css.cardFoot}>
              {suite.installed
                ? (
                    <>
                      <span className={clsx(css.stateTag, css.stateTagModel)}>{t('page.suites.installed')}</span>
                      <button
                        type="button" className={css.rowActionBtn}
                        disabled={busyId === suite.id}
                        onClick={() => { mutate(suite.id, uninstallSuite) }}
                      >
                        {t('page.suites.uninstall')}
                      </button>
                    </>
                  )
                : (
                    <button
                      type="button" className={clsx(css.rowActionBtn, css.rowActionPrimary)}
                      disabled={busyId === suite.id}
                      onClick={() => { mutate(suite.id, installSuite) }}
                    >
                      {t('page.suites.install')}
                    </button>
                  )}
              <span className={css.cardMeta}>{t('page.suites.skillCount')}{suite.skillNames.length}</span>
            </div>
          </article>
        ))}
      </div>
      <p className={css.notice}>{t('page.suites.installNote')}</p>
    </section>
  )
}

/**
 * One catalogued skill row. Fields mirror what a SKILL.md frontmatter
 * carries; `body` is the condensed rule set the detail dialog shows.
 */
interface CataloguedSkill {
  readonly name: string
  readonly zh: string
  readonly category: 'doc' | 'data' | 'creative'
  readonly description: string
  readonly body: string
}

/**
 * The built-in skill catalogue — the five shipped skills, presented locally
 * until the host `skill.list` channel replaces it (README Known
 * Limitations). Categories are a UI-local grouping, not a host `source`.
 */
const BUILTIN_SKILLS: readonly CataloguedSkill[] = [
  {
    name: 'data-visualization',
    zh: '数据可视化',
    category: 'data',
    description: '按数据特征选图型（趋势/对比/构成/分布/关系），产出 ECharts 配置或独立 HTML 图表页，附关键数字复述与作图规则。',
    body: '何时选什么图：趋势→折线（≤5序列）；类别对比→柱状（>12类改横条）；构成→饼/环（>6扇区合并“其他”）；分布→直方；关系→散点（>2000点抽样）。\n\n产出形态二选一：独立 HTML 单文件（echarts CDN，深浅色跟随系统）或纯 option 配置 JSON。\n\n规则：结论数字先行；坐标轴从 0 起；空/单点/全零数据说明原因不作图；中文标签超宽旋转 30° 不截断。',
  },
  {
    name: 'weekly-report',
    zh: '工作周报',
    category: 'doc',
    description: '从口述/会话记录提取「完成/进行中/下周计划/风险」四段，书面语润色不虚构，附纯文本粘贴版。',
    body: '固定四段：本周完成（动词开头 ≤6 条带量化）、进行中（进度%+预计完成）、下周计划（3-5 条，未完成置顶）、风险与求助（无则写“无”）。\n\n素材优先级：口述→会话记录（引用具体数字）→都没有则追问，不虚构。\n\n语体：用“完成/推进/上线/修复”；数字带单位；每条 ≤40 字。产出末尾附纯文本块供粘贴进 OA/IM。',
  },
  {
    name: 'data-analysis',
    zh: '数据分析',
    category: 'data',
    description: '数据体检→描述统计→分组对比与加法拆解→结论先行报告，相关不称因果，小样本必标注。',
    body: '流程固定：① 数据体检（缺失/重复先报告不静默处理）② 描述统计（只报相关列）③ 按维度对比，变化类做量×价拆解指出主贡献 ④ 结论三层：关键发现 ≤3 条→支撑数字→建议（标“供参考”）。\n\n规则：结论先行不倒叙；相关≠因果；样本 <30 标注；缺失 >40% 的列不参与；超 20 个数字的统计必须写代码执行，不手算。',
  },
  {
    name: 'image-creation',
    zh: '图像创作',
    category: 'creative',
    description: '按「主体-风格-构图-细节-用途」五要素把模糊想法扩写成中英双语绘画提示词，附比例/张数参数块。',
    body: '五要素齐全才生成：主体（姿态表情）、风格（政务默认扁平插画风）、构图（视角与主体位置）、细节（光线色调材质）、用途（决定比例留白）。缺要素先追问，一次最多问两个。\n\n参数：海报 3:4 或 9:16、配图 16:9、头像 1:1；海报留文字位要提醒 AI 文字可能不准，重要文字建议后期加。\n\n规则：中英提示词各一版；真实人像/商标/版权角色说明风险并拒绝；末尾附参数块（比例 尺寸 建议张数）。',
  },
  {
    name: 'tech-proposal',
    zh: '技术方案',
    category: 'doc',
    description: '「背景目标-选型-架构-实施-风险」五段结构，含选型对比表、Mermaid 架构图、里程碑验收标准与风险矩阵。',
    body: '五段缺一不可：① 背景与目标（痛点带数字、目标可验收、明确“不做什么”）② 选型（≥2 候选逐项对比：成熟度/生态/熟悉度/迁移成本/许可证，表格+一句话结论）③ 架构（模块/数据流/关键接口，Mermaid graph TD，每个决策附“为什么不用显然的替代”）④ 实施（里程碑含交付物/验收标准/依赖，工期乐观正常两档）⑤ 风险（概率×影响+对策+兜底，无兜底标“需上报”）。\n\n语体：数字带单位与前提；无法核实的写“待压测确认”。成稿后五项自检清单。',
  },
]

/** Catalogue category keys, in filter order. */
const SKILL_CATEGORIES = [
  { key: 'all', label: 'page.skills.catAll' },
  { key: 'doc', label: 'page.skills.catDoc' },
  { key: 'data', label: 'page.skills.catData' },
  { key: 'creative', label: 'page.skills.catCreative' },
] as const

type SkillCategoryFilter = (typeof SKILL_CATEGORIES)[number]['key']

/**
 * The 技能 page: the skills with their `/name` calling convention. With a
 * current session the host's session-addressed `skill.list` is the catalogue
 * (the categories then filter the host rows by name-prefix lookup into the
 * local table); without one — or while it loads — the shipped catalogue
 * stands in, clearly a local view rather than an implied load. The category
 * chips are a UI-local grouping, not a host `source`.
 */
function SkillsPage(props: TianshuPagesComponentProps) {
  const { t, sendSkillToComposer, listSkills } = props
  const [category, setCategory] = useState<SkillCategoryFilter>('all')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<CataloguedSkill | undefined>(undefined)
  const [hostRows, setHostRows] = useState<readonly SkillEntry[] | undefined>(undefined)

  // Session-addressed listing: only a current session can be asked. A
  // refusal or absence keeps the local catalogue — the page never implies a
  // load it cannot serve.
  useEffect(() => {
    let cancelled = false
    listSkills()
      .then(rows => { if (!cancelled) setHostRows(rows) })
      .catch(() => { /* the local catalogue stands in */ })
    return () => { cancelled = true }
    // The injected face is stable for the registration's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows: readonly CataloguedSkill[] = hostRows === undefined || hostRows.length === 0
    ? BUILTIN_SKILLS
    : hostRows.map(entry => {
      // The host carries no Chinese title; the local table supplies it when
      // the name matches, else the raw name stands alone.
      const local = BUILTIN_SKILLS.find(skill => skill.name === entry.name)
      return {
        name: entry.name,
        zh: local?.zh ?? entry.name,
        category: local?.category ?? 'creative',
        description: entry.description,
        body: local?.body ?? entry.description,
      }
    })

  const visible = rows.filter(skill =>
    (category === 'all' || skill.category === category)
    && (query.trim() === ''
      || `${skill.zh}${skill.name}${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())))

  /** Prefill the current session's composer; keep the page open on failure. */
  const send = (name: string): void => {
    if (sendSkillToComposer(name)) props.actions.clear()
  }

  return (
    <section>
      <div className={css.filters}>
        {SKILL_CATEGORIES.map(({ key, label }) => (
          <button
            key={key} type="button"
            className={clsx(css.chip, category === key && css.chipActive)}
            onClick={() => { setCategory(key) }}
          >
            {t(label)}
            <span className={css.chipCount}>{
              key === 'all' ? rows.length
                : rows.filter(skill => skill.category === key).length
            }</span>
          </button>
        ))}
        <input
          className={css.skillSearch}
          type="search"
          placeholder={t('page.skills.searchPlaceholder')}
          aria-label={t('page.skills.searchPlaceholder')}
          value={query}
          onChange={event => { setQuery(event.target.value) }}
        />
      </div>
      <h2 className={css.sectionTitle}>{t('page.skills.catalogue')}</h2>
      {visible.length === 0
        ? <p className={css.empty}>{t('page.skills.emptySearch')}</p>
        : (
          <ul className={css.list}>
            {visible.map(skill => (
              <li key={skill.name} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.skillTitle}>
                    {skill.zh} <span className={css.skillCmd}>/{skill.name}</span>
                  </div>
                  <div className={css.skillDesc}>{skill.description}</div>
                </div>
                <span className={css.rowTags}>
                  <span className={clsx(css.stateTag, css.stateTagModel)}>{t('page.skills.modelInvocable')}</span>
                  <button type="button" className={css.rowActionBtn} onClick={() => { setDetail(skill) }}>
                    {t('page.skills.view')}
                  </button>
                  <button type="button" className={clsx(css.rowActionBtn, css.rowActionPrimary)} onClick={() => { send(skill.name) }}>
                    {t('page.skills.sendToComposer')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      <p className={css.skillLine}>
        {t('page.skills.usageNote')}
      </p>

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
                  onMenuSelect={entry => { setMenuFor(undefined); handleMenuSelect(id, entry) }}
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
        onSubmit={value => { run(() => actions.renameSession(dialog.sessionId, value)) }}
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
        onSubmit={value => {
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
        onChange={event => { setValue(event.target.value) }}
        onKeyDown={event => { if (event.key === 'Enter') submit() }}
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
