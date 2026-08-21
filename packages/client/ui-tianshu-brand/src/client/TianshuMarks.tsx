/**
 * Tianshu platform marks. Both ride `currentColor` so one `color` on the
 * container flips them, matching how the shipped dsh marks behave.
 */
import type { CSSProperties } from 'react'

/** Shared props for the two marks. */
export interface MarkProps {
  /** Rendered height in px; width follows the mark's own ratio. */
  size?: number | undefined
  /** Extra class for layout placement.
   * (`| undefined` for exactOptionalPropertyTypes: callers forward their own optional prop.) */
  className?: string | undefined
}

/**
 * The platform emblem: a ringed globe. Square, native 32x32.
 * @param props - see {@link MarkProps} (default size 32).
 * @returns the emblem svg (decorative).
 */
export function TianshuEmblem({ size = 32, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="9" fill="currentColor" fillOpacity="0.18" />
      <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="1.6" />
      {/* Meridian + equator: the globe reading. */}
      <ellipse cx="16" cy="16" rx="4" ry="9" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 16H25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* Orbit ring, tilted — the "探" sweep in the source mark. */}
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.75"
        transform="rotate(-30 16 16)"
      />
    </svg>
  )
}

/** Locale-independent brand string; the platform name is a proper noun. */
export const TIANSHU_WORDMARK_TEXT = '天枢平台'

/** Inline layout for the wordmark row (kept local to the mark, not themed). */
const ROW_STYLE: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8 }

/**
 * Emblem + platform name lockup, as the sidebar header renders it.
 * @param props - see {@link MarkProps} (default emblem size 28).
 * @returns the lockup element.
 */
export function TianshuWordmark({ size = 28, className }: MarkProps) {
  return (
    <span className={className} style={ROW_STYLE}>
      <TianshuEmblem size={size} />
      <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        {TIANSHU_WORDMARK_TEXT}
      </span>
    </span>
  )
}
