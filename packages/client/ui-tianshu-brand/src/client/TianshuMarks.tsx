/**
 * Tianshu platform wordmark: the platform name as a pure-type bilingual
 * lockup — the Chinese name over a small tracked Latin subtitle. The glyphs
 * come from an inlined woff2 subset of Source Han Serif CN Heavy (SIL OFL)
 * declared in TianshuMarks.module.css — the package is a library
 * (tsdown/rolldown) that bundles no asset handling, so importing an
 * .svg/.png/.woff2 file cannot resolve; inlining keeps the build
 * dependency-free and renders identically everywhere.
 */
import clsx from 'clsx'
import css from './TianshuMarks.module.css'

/** Locale-independent brand strings; the platform name is a proper noun. */
export const TIANSHU_WORDMARK_TEXT = '天枢平台'
export const TIANSHU_WORDMARK_SUBTEXT = 'TIANSHU PLATFORM'

/**
 * Platform name lockup, as the sidebar header renders it.
 * @param props - className for layout placement.
 * @returns the wordmark element.
 */
export function TianshuWordmark({ className }: { className?: string | undefined }) {
  return (
    <span className={clsx(css.wordmark, className)}>
      <span className={css.wordmarkMain}>{TIANSHU_WORDMARK_TEXT}</span>
      <span className={css.wordmarkSubRow}>
        <span className={css.wordmarkSub}>{TIANSHU_WORDMARK_SUBTEXT}</span>
        {/* The full-row hairline strikes through the subtitle (G2 lockup);
            decorative, and clipped by the shell's logo row at the column edge. */}
        <span className={css.wordmarkRule} aria-hidden="true" />
      </span>
    </span>
  )
}
