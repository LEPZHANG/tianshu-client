// Behavior shared by every sidebar column shell: the collapse crossfade and
// the pointer-following scrollbars. Both columns (the shipped sidebar and a
// branded replacement) animate and reveal identically; only their class names,
// marks, and the rows between the controls differ, so the timing, the frozen
// width, and the containment test live here rather than in each column.

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
export const SIDEBAR_COLLAPSE_SETTLE_MS = 150

/**
 * How long a column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance there, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
export const SIDEBAR_SCROLLBAR_LINGER_MS = 2000

/** What a column needs to render mid-collapse. */
export interface SidebarCollapseState {
  /** Whether wide content is mounted: expanded, or collapsing before settle. */
  wide: boolean
  /** The expanded width to hold while wide content fades out. */
  wideWidth: number
  /** Whether the column has been expanded at any point in this mount. */
  everWide: boolean
}

/**
 * Drive a sidebar column's collapse crossfade.
 *
 * Wide content stays mounted while the collapse animates (fading in place),
 * unmounts at settle, and remounts right away on expand. It is frozen at its
 * expanded width for that fade so the sliding column clips it instead of
 * reflowing it, and `everWide` keeps a refresh straight into the collapsed
 * state from animating icons that were never on screen.
 *
 * @param collapsed Whether the column is collapsed.
 * @param width The column's expanded width in pixels.
 * @returns The {@link SidebarCollapseState} for this render.
 */
export function useSidebarCollapse(collapsed: boolean, width: number): SidebarCollapseState {
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, SIDEBAR_COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])

  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  return { wide: !collapsed || !settled, wideWidth: lastWideWidth.current, everWide: everWide.current }
}

/** A column's pointer-following scrollbar state and the handlers that feed it. */
export interface SidebarScrollbars {
  /** Attach to the column element; its box decides containment. */
  column: RefObject<HTMLDivElement>
  /** Whether the nested scroll regions should draw a bar. */
  pointerInside: boolean
  /** The column's `onPointerEnter`. */
  enter: () => void
  /** The column's `onPointerLeave`. */
  leave: () => void
}

/**
 * Draw a column's scrollbars only while the pointer is on it.
 *
 * Bars are drawn while the pointer is inside and for {@link
 * SIDEBAR_SCROLLBAR_LINGER_MS} after it leaves; a pointer that returns within
 * that window cancels the pending hide rather than restarting from a hidden
 * bar.
 *
 * Leaving is decided by the column's BOX, not by DOM containment, and only
 * while the bars are drawn. A settings panel renders its full-viewport surface
 * as a fixed-position DESCENDANT of the column, so a pointer moved onto that
 * panel — or onto the conversation once it closes — fires no `pointerleave`
 * there, and the bars would stay drawn over a column nobody is pointing at.
 * The element's own leave stays as the one signal geometry cannot give: a
 * pointer that leaves the window emits no further moves.
 *
 * @returns The {@link SidebarScrollbars} handle.
 */
export function useSidebarScrollbars(): SidebarScrollbars {
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SIDEBAR_SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
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

  return {
    column,
    pointerInside,
    enter: () => {
      cancelLinger()
      setPointerInside(true)
    },
    leave: armLinger,
  }
}
