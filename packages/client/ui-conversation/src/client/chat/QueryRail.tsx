// QueryRail: a fixed column of tick marks beside the transcript, one per
// durable user query, showing which turn owns the reading position and
// jumping between them.
//
// Geometry is measured, not declared: the rail is positioned from the resolved
// scrollport's viewport box and the composer's top edge, both of which move
// with the window, the sidebar, and a growing input card. A CSS-only rail
// would have to restate those, and would drift the moment either changed.

import { useLayoutEffect, useRef, useState } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './QueryRail.module.css'

/** Below this the rail has no room to sit beside the transcript and is withdrawn. */
const MIN_RAIL_HEIGHT = 144

/** Inset from the scrollport's top and bottom edges. */
const RAIL_MARGIN = 12

/** Keeps the active tick clear of the rail's own scroll edges. */
const SCROLL_PADDING = 8

/** One navigable query: the flow row's anchor key and its preview copy. */
export interface RailQuery {
  /** `data-chat-anchor-key` of the row this tick scrolls to. */
  readonly key: string
  /** Single-line, length-capped preview shown in the hover tooltip. */
  readonly preview: string
}

/** Measured placement, or null while the rail does not fit. */
interface RailLayout {
  top: number
  left: number
  height: number
}

interface HoveredQuery {
  query: RailQuery
  /** Tooltip offset within the rail, clamped to keep it fully on screen. */
  top: number
}

/**
 * Select the query whose turn currently owns the reading position: the last
 * one whose row starts above the reading threshold.
 *
 * The threshold sits 55% down the visible flow rather than at its top edge, so
 * a query scrolled just into view does not steal the mark from the turn the
 * reader is still reading. The first query stays selected above all of them.
 * @param list - the chat flow element holding the anchored rows.
 * @param scrollport - the resolved scroll host.
 * @param queries - navigable queries in flow order.
 * @returns the active query key, or null when there are none.
 */
export function queryAtViewport(
  list: HTMLElement,
  scrollport: HTMLElement,
  queries: readonly RailQuery[],
): string | null {
  const first = queries[0]
  if (first === undefined) return null
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  const threshold = viewport.top + Math.max(72, (visibleBottom - viewport.top) * 0.55)
  let active = first.key
  for (const query of queries) {
    const row = anchorRow(list, query.key)
    if (row === null) continue
    if (row.getBoundingClientRect().top > threshold) break
    active = query.key
  }
  return active
}

/** The rendered flow row carrying this anchor key, without interpolating a selector. */
function anchorRow(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/**
 * Compact, independently scrollable navigation for a session's user queries.
 * @param props - the queries, the active key, the owner's list/column refs, the navigate callback, and the locale seat.
 * @returns the rail, or null when fewer than two queries exist or it does not fit.
 */
export function QueryRail({ queries, activeKey, listRef, columnRef, onNavigate, scrollerOf, t }: {
  /** Navigable queries in flow order. */
  queries: readonly RailQuery[]
  /** Key of the query owning the reading position, or null. */
  activeKey: string | null
  /** The owner's chat flow element. */
  listRef: React.RefObject<HTMLDivElement | null>
  /** The owner's message column, observed because its height drives the flow. */
  columnRef: React.RefObject<HTMLDivElement | null>
  /** Scroll the flow to a query. */
  onNavigate: (key: string) => void
  /** The owner's scrollport resolver, so both agree on which element scrolls. */
  scrollerOf: (from: HTMLElement) => HTMLElement
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}): React.ReactElement | null {
  const railRef = useRef<HTMLElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<RailLayout | null>(null)
  const [hovered, setHovered] = useState<HoveredQuery | null>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    const column = columnRef.current
    // One query is the whole conversation: there is nothing to navigate
    // between, so the rail would be chrome without a function.
    if (queries.length < 2 || list === null || column === null) {
      setLayout(null)
      return
    }
    const scrollport = scrollerOf(list)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const update = (): void => {
      const viewport = scrollport.getBoundingClientRect()
      const composerTop = composer?.getBoundingClientRect().top ?? viewport.bottom
      const bottom = Math.min(viewport.bottom, composerTop) - RAIL_MARGIN
      const top = viewport.top + RAIL_MARGIN
      const height = Math.floor(bottom - top)
      const next = height >= MIN_RAIL_HEIGHT
        ? { top: Math.round(top), left: Math.round(viewport.left + RAIL_MARGIN), height }
        : null
      // Identity-stable when nothing moved: this runs on every resize and
      // observer tick, and a fresh object each time would re-render the rail
      // continuously while the reader types into a growing composer.
      setLayout(current => current?.top === next?.top
        && current?.left === next?.left
        && current?.height === next?.height
        ? current
        : next)
    }
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(scrollport)
    observer?.observe(column)
    if (composer !== null) observer?.observe(composer)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [queries.length, listRef, columnRef, scrollerOf])

  // Keep the active tick inside the rail's own scroll window: a long
  // conversation's rail scrolls, and the mark is useless off-screen.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || activeKey === null) return
    const button = [...scroller.querySelectorAll<HTMLElement>('[data-query-key]')]
      .find(candidate => candidate.dataset.queryKey === activeKey)
    if (button === undefined) return
    const top = button.offsetTop
    const bottom = top + button.offsetHeight
    if (top < scroller.scrollTop + SCROLL_PADDING) {
      scroller.scrollTop = Math.max(0, top - SCROLL_PADDING)
    } else if (bottom > scroller.scrollTop + scroller.clientHeight - SCROLL_PADDING) {
      scroller.scrollTop = bottom - scroller.clientHeight + SCROLL_PADDING
    }
  }, [activeKey, layout?.height])

  if (layout === null) return null

  const showPreview = (query: RailQuery, button: HTMLElement): void => {
    const rail = railRef.current
    /* v8 ignore next -- ref-null guard: the handler fires from a child of this node. */
    if (rail === null) return
    const railBox = rail.getBoundingClientRect()
    const buttonBox = button.getBoundingClientRect()
    setHovered({
      query,
      top: Math.max(8, Math.min(layout.height - 88, buttonBox.top - railBox.top - 12)),
    })
  }

  const hoveredIndex = hovered === null
    ? -1
    : queries.findIndex(query => query.key === hovered.query.key)

  return (
    <nav
      ref={railRef}
      className={css.root}
      style={layout}
      data-query-rail=""
      aria-label={t('chat.queryRail')}
      onMouseLeave={() => { setHovered(null) }}
    >
      <div
        ref={scrollerRef}
        className={css.scroller}
        // The rail scrolls independently; without this a wheel over it would
        // also drive the transcript underneath.
        onWheel={(event) => { event.stopPropagation() }}
        onScroll={() => { setHovered(null) }}
      >
        {queries.map((query, index) => {
          const active = query.key === activeKey
          return (
            <button
              key={query.key}
              type="button"
              className={active ? `${css.item} ${css.itemActive}` : css.item}
              data-query-key={query.key}
              aria-label={t('chat.queryLabel', { index: index + 1, preview: query.preview })}
              aria-current={active ? 'step' : undefined}
              onClick={() => { onNavigate(query.key) }}
              onMouseEnter={(event) => { showPreview(query, event.currentTarget) }}
              onFocus={(event) => { showPreview(query, event.currentTarget) }}
              onBlur={() => { setHovered(null) }}
            />
          )
        })}
      </div>
      {hovered !== null && (
        <div className={css.tooltip} style={{ top: hovered.top }} role="tooltip">
          <div className={css.tooltipLabel}>{t('chat.queryIndex', { index: hoveredIndex + 1 })}</div>
          <div className={css.tooltipText}>{hovered.query.preview}</div>
        </div>
      )}
    </nav>
  )
}
