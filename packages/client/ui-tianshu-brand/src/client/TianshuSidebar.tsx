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
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChecklistOutline14, IconNewChatOutline16, IconPanelLeftOutline16,
  IconQueueOutline14, IconSettingsOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { TianshuEmblem, TianshuWordmark } from './TianshuMarks.tsx'
import type { TianshuNavKey, TianshuSidebarComponentProps } from './contract/slots.ts'
import css from './TianshuSidebar.module.css'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/** How long the column's scrollbars stay drawn after the pointer leaves it. */
const SCROLLBAR_LINGER_MS = 2000

/** Collapsed rail width; the frame's own constant for the closed column. */
const RAIL_WIDTH = 56

/**
 * Document-level custom property carrying the rendered sidebar width. The
 * management surface reads it to keep the column uncovered; publishing it here
 * keeps the frame's geometry as the single source.
 */
const SIDEBAR_WIDTH_VAR = '--dsh-tianshu-sidebar-width'

/** Navigation rows below New Session, in render order. */
const NAV_ITEMS: readonly { key: TianshuNavKey; label: 'nav.config' | 'nav.tasks' | 'nav.sessions' }[] = [
  { key: 'config', label: 'nav.config' },
  { key: 'tasks', label: 'nav.tasks' },
  { key: 'sessions', label: 'nav.sessions' },
]

/** Glyph per navigation destination. */
function NavIcon({ nav, size }: { nav: TianshuNavKey; size: number }) {
  if (nav === 'config') return <IconSettingsOutline16 size={size} />
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
  useStore,
  actions,
  t,
  renderSlot,
}: TianshuSidebarComponentProps) {
  // Wide content stays mounted while the collapse animates, unmounts at
  // settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled

  // Freeze the content at its expanded width while it fades out, so the
  // sliding column clips it instead of reflowing it.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Rail-in only crossfades a live collapse; a refresh straight into the
  // collapsed state renders the rail statically.
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Rendered column width, published to the document so the management surface
  // can leave the sidebar uncovered without restating the frame's geometry.
  // Written here because this component is the only one the frame hands the
  // live width to; the effect retracts it so nothing survives an unmount.
  const renderedWidth = wide ? (collapsed ? lastWideWidth.current : width) : RAIL_WIDTH
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(SIDEBAR_WIDTH_VAR, `${String(renderedWidth)}px`)
    return () => { root.style.removeProperty(SIDEBAR_WIDTH_VAR) }
  }, [renderedWidth])

  // Which navigation row reads as current. The selection is cross-entry state
  // (the management surface renders from the same store), so it lives there
  // rather than in local state.
  const activeNav = useStore(s => s.active)

  // Scrollbars in the column follow the pointer: drawn while it is inside,
  // and for SCROLLBAR_LINGER_MS after it leaves.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not DOM containment: ui-settings
  // renders its full-viewport panel as a fixed-position DESCENDANT of this
  // column, so a pointer moved onto that panel fires no `pointerleave` here.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  return (
    <div
      ref={column}
      // Layout anchors for an embedding shell, not styling hooks: the desktop
      // client's Windows titlebar measures the column through the root and
      // pads it while wide. It finds them by attribute and returns silently
      // when absent, so they are part of what this column owes a host.
      data-dsh-sidebar-root=""
      data-dsh-sidebar-wide={wide ? 'true' : 'false'}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading, !pointerInside && css.quietBars,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      <div className={css.logoRow}>
        {/* Expanded, the lockup doubles as a New Session shortcut; the
            collapsed rail's emblem is the expand toggle below instead. */}
        {wide && (
          <button
            type="button"
            className={clsx(css.brand, css.wide)}
            aria-label={t('session.new.label')}
            onClick={() => { startSession() }}
          >
            <TianshuWordmark />
          </button>
        )}
        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.toggle)}
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            {!wide && <TianshuEmblem className={css.railEmblem} size={24} />}
            <IconPanelLeftOutline16 className={css.panelIcon} size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {/* Primary action: a solid light pill on the blue column (design 首页). */}
      <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.newSession}
          aria-label={t('session.new.label')}
          onClick={() => { startSession() }}
        >
          <IconNewChatOutline16 size={wide ? 14 : 18} />
          {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
        </button>
      </Tooltip>

      <nav className={css.nav} aria-label={t('nav.config')}>
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

      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
      </div>
    </div>
  )
}
