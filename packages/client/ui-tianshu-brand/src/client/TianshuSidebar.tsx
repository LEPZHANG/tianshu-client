/**
 * Tianshu sidebar shell: the branded replacement for the shipped dsh sidebar.
 *
 * Keeps the shipped column's structural behavior — collapse is a slide plus
 * crossfade, the browsing region and foot seats are slots, the scrollbars are
 * a pointer affordance — and adds the design's navigation block between New
 * Session and the browsing region.
 *
 * The column paints the brand gradient, so all ink inside it is rebound to the
 * inverted scale in the stylesheet rather than through global theme tokens.
 */
import { useEffect } from 'react'
import clsx from 'clsx'
import {
  IconChecklistOutline14, IconConnectorOutline16, IconMcpOutline16,
  IconQueueOutline14, IconSkillSpark16, IconSuiteOutline16,
  SidebarBrandButton, SidebarColumn, SidebarFoot, SidebarNewSessionButton, SidebarToggleButton,
  Tooltip, useSidebarCollapse, useSidebarScrollbars,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { TianshuWordmark } from './TianshuMarks.tsx'
import type { TianshuNavKey, TianshuSidebarComponentProps } from './contract/slots.ts'
import css from './TianshuSidebar.module.css'

/** Collapsed rail width; the frame's own constant for the closed column. */
const RAIL_WIDTH = 56

/**
 * Document-level custom property carrying the rendered sidebar width. The
 * management surface reads it to keep the column uncovered; publishing it here
 * keeps the frame's geometry as the single source.
 */
const SIDEBAR_WIDTH_VAR = '--dsh-tianshu-sidebar-width'

/** Navigation rows below New Session, in render order. */
const NAV_ITEMS: readonly {
  key: TianshuNavKey
  label: 'nav.suites' | 'nav.skills' | 'nav.mcp' | 'nav.connector' | 'nav.tasks' | 'nav.sessions'
}[] = [
  { key: 'suites', label: 'nav.suites' },
  { key: 'skills', label: 'nav.skills' },
  { key: 'mcp', label: 'nav.mcp' },
  { key: 'connector', label: 'nav.connector' },
  { key: 'tasks', label: 'nav.tasks' },
  { key: 'sessions', label: 'nav.sessions' },
]

/** Glyph per navigation destination. */
function NavIcon({ nav, size }: { nav: TianshuNavKey; size: number }) {
  if (nav === 'suites') return <IconSuiteOutline16 size={size} />
  if (nav === 'skills') return <IconSkillSpark16 size={size} />
  if (nav === 'mcp') return <IconMcpOutline16 size={size} />
  if (nav === 'connector') return <IconConnectorOutline16 size={size} />
  if (nav === 'tasks') return <IconChecklistOutline14 size={size} />
  return <IconQueueOutline14 size={size} />
}

/**
 * Render the branded sidebar column.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function TianshuSidebar({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  useSessions,
  useStore,
  actions,
  t,
  renderSlot,
}: TianshuSidebarComponentProps) {
  const collapse = useSidebarCollapse(collapsed, width)
  const { wide, wideWidth } = collapse

  // Rendered column width, published to the document so the management surface
  // can leave the sidebar uncovered without restating the frame's geometry.
  // Written here because this component is the only one the frame hands the
  // live width to; the effect retracts it so nothing survives an unmount.
  const renderedWidth = wide ? (collapsed ? wideWidth : width) : RAIL_WIDTH
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(SIDEBAR_WIDTH_VAR, `${String(renderedWidth)}px`)
    return () => { root.style.removeProperty(SIDEBAR_WIDTH_VAR) }
  }, [renderedWidth])

  /**
   * Any conversation entry retires an open management page: the page overlay
   * spans the conversation column, so a surviving page would cover the
   * session the user just asked for. Rather than chase every entry point
   * (this column's New Session, the workspace browser's rows, a fork), the
   * sidebar watches the current session — the one fact every entry point
   * changes — and closes the page whenever it moves. The page's visibility is
   * this store's own action.
   */
  const currentSession = useSessions(s => s.current)
  const activeNav = useStore(s => s.active)
  useEffect(() => {
    if (currentSession !== undefined && activeNav !== undefined) actions.clear()
    // activeNav is read only to gate the write; the watched fact is the
    // current session, so it alone belongs in the dependency list.
  }, [currentSession])

  const bars = useSidebarScrollbars()

  /* jscpd:ignore-start -- deliberate parallel of the shipped dsh column: this
     is the same shell (ui-primitives SidebarColumn and its three controls)
     composed in the same order, because a replacement column owes its host the
     same seats and the same collapse behavior. What differs is the stylesheet,
     the wordmark, the absent rail mark, and the navigation block. */
  return (
    <SidebarColumn classes={css} collapsed={collapsed} width={width} collapse={collapse} bars={bars}>
      <div className={css.logoRow}>
        {/* Expanded, the wordmark doubles as a New Session shortcut. */}
        {wide && (
          <SidebarBrandButton classes={css} label={t('session.new.label')} onActivate={startSession}>
            <TianshuWordmark />
          </SidebarBrandButton>
        )}
        <SidebarToggleButton
          classes={css}
          label={collapsed ? t('toggle.open') : t('toggle.collapse')}
          wide={wide}
          onToggle={toggleSidebar}
        />
      </div>

      {/* Primary action, styled as the first row of the navigation list. */}
      <SidebarNewSessionButton
        classes={css}
        label={t('session.new.label')}
        text={t('session.new')}
        wide={wide}
        wideIconSize={16}
        onStart={startSession}
      />

      <nav className={css.nav} aria-label={t('nav.region')}>
        {NAV_ITEMS.map(item => (
          <Tooltip key={item.key} label={t(item.label)} delayMs={500} disabled={wide}>
            <button
              type="button"
              className={clsx(css.navItem, activeNav === item.key && css.navItemActive)}
              aria-label={t(item.label)}
              aria-current={activeNav === item.key ? 'page' : undefined}
              onClick={() => { actions.select(item.key) }}
            >
              <NavIcon nav={item.key} size={wide ? 16 : 18} />
              {wide && <span className={clsx(css.navLabel, css.wide)}>{t(item.label)}</span>}
            </button>
          </Tooltip>
        ))}
      </nav>

      {/* The browsing region fills the column between the nav and the foot. */}
      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      <SidebarFoot
        classes={css}
        actions={renderSlot('sidebar.footer.action', { wide })}
        settings={renderSlot('sidebar.settings', { wide })}
      />
    </SidebarColumn>
  )
  /* jscpd:ignore-end */
}
