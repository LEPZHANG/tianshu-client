// Chrome shared by every sidebar column shell: the column element itself and
// the three controls above the browsing region. Both columns (the shipped
// sidebar and a branded replacement) compose the same elements with the same
// collapse behavior and differ only in their stylesheet, their wordmark, and
// what they hang between the controls and the foot.
//
// Class names arrive as the caller's whole CSS module, which this repo types as
// `Record<string, string>`; each component documents the keys it reads.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconNewChatOutline16, IconPanelLeftOutline16 } from './icons/index.tsx'
import { Tooltip } from './Tooltip.tsx'
import type { SidebarCollapseState, SidebarScrollbars } from './sidebar-column.ts'

/** How long a control's tooltip waits before it opens. */
const TOOLTIP_DELAY_MS = 500

/** The column element's own props. */
export interface SidebarColumnProps {
  /** Stylesheet supplying `root`, `collapsed`, `railIn`, `fading`, and `quietBars`. */
  classes: Record<string, string>
  /** Whether the column is collapsed, including while the crossfade still runs. */
  collapsed: boolean
  /** The column's expanded width in pixels. */
  width: number
  /** This render's collapse state, from `useSidebarCollapse`. */
  collapse: SidebarCollapseState
  /** This column's scrollbar state, from `useSidebarScrollbars`. */
  bars: SidebarScrollbars
  children: ReactNode
}

/**
 * Render a sidebar column's outer element.
 *
 * Rail layout applies only once the fade settles, `railIn` crossfades the icons
 * in for a live collapse alone, and the expanded width is held inline while wide
 * content fades out so the sliding column clips it instead of reflowing it.
 *
 * The column also publishes the two layout anchors an embedding shell finds it
 * by: the desktop client's Windows titlebar measures the column through
 * `data-dsh-sidebar-root` and pads it while `data-dsh-sidebar-wide` is true. It
 * looks them up by attribute and returns silently when absent, so they are part
 * of what any column owes a host rather than one column's decoration.
 *
 * @param props - the column's stylesheet, geometry, and hook state.
 * @returns the column element wrapping `children`.
 */
export function SidebarColumn({ classes, collapsed, width, collapse, bars, children }: SidebarColumnProps) {
  const { wide, wideWidth, everWide } = collapse
  return (
    <div
      ref={bars.column}
      data-dsh-sidebar-root=""
      data-dsh-sidebar-wide={wide ? 'true' : 'false'}
      className={clsx(
        classes.root, !wide && classes.collapsed, !wide && everWide && classes.railIn,
        collapsed && wide && classes.fading, !bars.pointerInside && classes.quietBars,
      )}
      style={wide ? { width: collapsed ? wideWidth : width } : undefined}
      onPointerEnter={bars.enter}
      onPointerLeave={bars.leave}
    >
      {children}
    </div>
  )
}

/** The wordmark button's props. */
export interface SidebarBrandButtonProps {
  /** Stylesheet supplying `brand` and `wide`. */
  classes: Record<string, string>
  /** Accessible name; the button starts a session, so it is the New Session label. */
  label: string
  onActivate: () => void
  /** The column's wordmark. */
  children: ReactNode
}

/**
 * Render the expanded column's wordmark, which doubles as a New Session shortcut.
 * @param props - the button's stylesheet, accessible name, handler, and wordmark.
 * @returns the wordmark button.
 */
export function SidebarBrandButton({ classes, label, onActivate, children }: SidebarBrandButtonProps) {
  return (
    <button
      type="button"
      className={clsx(classes.brand, classes.wide)}
      aria-label={label}
      onClick={() => { onActivate() }}
    >
      {children}
    </button>
  )
}

/** The collapse toggle's props. */
export interface SidebarToggleButtonProps {
  /** Stylesheet supplying `iconButton`, `toggle`, and `panelIcon`. */
  classes: Record<string, string>
  /** Accessible name and tooltip, which name the direction the click moves the column. */
  label: string
  /** Whether wide content is mounted. */
  wide: boolean
  onToggle: () => void
  /** The rail's resting mark; the panel icon replaces it on hover. Omitted by a column with no rail mark. */
  railMark?: ReactNode
}

/**
 * Render the column's collapse toggle.
 * @param props - the toggle's stylesheet, accessible name, width state, handler, and rail mark.
 * @returns the toggle button inside its tooltip.
 */
export function SidebarToggleButton({ classes, label, wide, onToggle, railMark }: SidebarToggleButtonProps) {
  return (
    <Tooltip label={label} delayMs={TOOLTIP_DELAY_MS}>
      <button
        type="button"
        className={clsx(classes.iconButton, classes.toggle)}
        aria-label={label}
        onClick={() => { onToggle() }}
      >
        {!wide && railMark}
        {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
        <IconPanelLeftOutline16 className={classes.panelIcon} size={wide ? 16 : 18} />
      </button>
    </Tooltip>
  )
}

/** The New Session button's props. */
export interface SidebarNewSessionButtonProps {
  /** Stylesheet supplying `newSession`, `newSessionLabel`, and `wide`. */
  classes: Record<string, string>
  /** Accessible name, and the tooltip the rail shows in place of the visible label. */
  label: string
  /** The visible label, drawn only while the column is wide. */
  text: string
  /** Whether wide content is mounted. */
  wide: boolean
  /** Glyph size while wide; the rail always draws 18. */
  wideIconSize: number
  onStart: () => void
}

/**
 * Render the column's New Session button.
 * @param props - the button's stylesheet, labels, width state, glyph size, and handler.
 * @returns the button inside its tooltip.
 */
export function SidebarNewSessionButton({
  classes,
  label,
  text,
  wide,
  wideIconSize,
  onStart,
}: SidebarNewSessionButtonProps) {
  return (
    // Expanded, the button carries its own label — tooltip only on the rail.
    <Tooltip label={label} delayMs={TOOLTIP_DELAY_MS} disabled={wide}>
      <button
        type="button"
        className={classes.newSession}
        aria-label={label}
        onClick={() => { onStart() }}
      >
        <IconNewChatOutline16 size={wide ? wideIconSize : 18} />
        {wide && <span className={clsx(classes.newSessionLabel, classes.wide)}>{text}</span>}
      </button>
    </Tooltip>
  )
}

/** The column foot's props. */
export interface SidebarFootProps {
  /** Stylesheet supplying `footArea`, `footerActions`, and `settingsArea`. */
  classes: Record<string, string>
  /** The footer action seat's content. */
  actions: ReactNode
  /** The settings seat's content. */
  settings: ReactNode
}

/**
 * Render the column's foot: footer actions stacked above settings, in both widths.
 * @param props - the foot's stylesheet and the two seats' content.
 * @returns the foot element.
 */
export function SidebarFoot({ classes, actions, settings }: SidebarFootProps) {
  return (
    <div className={classes.footArea}>
      <div className={classes.footerActions}>{actions}</div>
      <div className={classes.settingsArea}>{settings}</div>
    </div>
  )
}
