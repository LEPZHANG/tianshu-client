/**
 * Provider picker for the Models page's add card.
 *
 * The dormant directory runs to dozens of routes, which a native dropdown
 * turns into a scroll hunt with no way to search and no route id visible until
 * a name is already chosen. This is a searchable grid of cards instead: it
 * names both the display name and the route id, filters on either, and orders
 * the routes people actually reach for ahead of the specialized ones.
 *
 * Two postures, one component: the grid while choosing, and a one-line summary
 * of the chosen route once the editor below it is the thing being filled in.
 */

import { useState } from 'react'
import type { ProviderIdentity } from './ModelsSection.tsx'
import type { en } from './locales.ts'
import styles from './ProviderPicker.module.css'

/**
 * Routes ordered by how often they are the one being added, ahead of the
 * alphabetical tail. This is presentation ordering only — every route in the
 * directory stays addable, and an id absent here simply sorts alphabetically
 * after the listed ones, so the directory may grow without editing this list.
 */
const PROVIDER_PRIORITY = [
  'deepseek-official',
  'deepseek',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'xai',
  'moonshotai-cn',
  'moonshotai',
  'minimax-cn',
  'minimax',
  'zai-coding-cn',
  'zai',
  'mistral',
  'groq',
  'together',
]

const PROVIDER_RANK = new Map(PROVIDER_PRIORITY.map((provider, index) => [provider, index]))

/**
 * One selectable route: the identity shown on its card, plus the full target
 * the page adopts when it is chosen. The target stays a type parameter so the
 * page's own editor-target type — which carries settings addressing this
 * component has no use for — reaches `onChoose` unflattened.
 */
export interface ProviderChoice<Target = ProviderIdentity> extends ProviderIdentity {
  /** Full target the page adopts when this card is chosen. */
  readonly target: Target
}

/**
 * Order routes for display: listed routes in their listed order, then the rest
 * alphabetically by display name.
 * @param choices - the addable routes, in directory order.
 * @returns a new array in presentation order.
 */
export function orderProviders<Target>(
  choices: readonly ProviderChoice<Target>[],
): ProviderChoice<Target>[] {
  return [...choices].sort((left, right) => {
    const leftRank = PROVIDER_RANK.get(left.provider) ?? Number.MAX_SAFE_INTEGER
    const rightRank = PROVIDER_RANK.get(right.provider) ?? Number.MAX_SAFE_INTEGER
    return leftRank - rightRank || left.displayName.localeCompare(right.displayName)
  })
}

/**
 * Filter routes by a free-text query against display name and route id
 * together, so `kimi` and `moonshotai-cn` both find the same card.
 * @param choices - routes in presentation order.
 * @param query - the raw search box contents.
 * @returns the matching routes; all of them for a blank query.
 */
export function filterProviders<Target>(
  choices: readonly ProviderChoice<Target>[],
  query: string,
): readonly ProviderChoice<Target>[] {
  const normalized = query.trim().toLowerCase()
  if (normalized === '') return choices
  return choices.filter(choice =>
    `${choice.displayName} ${choice.provider}`.toLowerCase().includes(normalized))
}

/**
 * Render the provider picker in whichever posture the add card is in.
 * @param props - the addable routes, the current target, the choose callback, and the copy seat.
 * @returns the search-and-grid picker, or the chosen route's summary row.
 */
export function ProviderPicker<Target>({ choices, current, onChoose, t }: {
  /** Every route that can still be added, in directory order. */
  choices: readonly ProviderChoice<Target>[]
  /** The route the add card currently targets. */
  current: ProviderIdentity
  /** Adopt a route; the page swaps the editor beneath. */
  onChoose: (target: Target) => void
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}): React.ReactElement {
  // Opens closed: the page already chose a first target, so the common path is
  // to fill in that route's key rather than to pick a different one.
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  if (!open) {
    return (
      // Labeled like the grid it collapses from: this is the provider field in
      // either posture, so a reader (or a test) finds it under one name.
      <div className={styles['summary']} role="group" aria-label={t('provider')}>
        <span className={styles['summaryText']}>
          <span className={styles['name']}>{current.displayName}</span>
          <span className={styles['route']}>{current.provider}</span>
        </span>
        <button
          type="button"
          className={styles['change']}
          onClick={() => { setOpen(true); setQuery('') }}
        >
          {t('changeProvider')}
        </button>
      </div>
    )
  }

  const visible = filterProviders(orderProviders(choices), query)
  return (
    <div className={styles['picker']}>
      <input
        className={styles['search']}
        type="search"
        value={query}
        placeholder={t('providerSearch')}
        aria-label={t('providerSearch')}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      <div className={styles['grid']} role="group" aria-label={t('provider')}>
        {visible.map(choice => (
          <button
            key={choice.provider}
            type="button"
            className={styles['card']}
            aria-pressed={choice.provider === current.provider}
            onClick={() => {
              onChoose(choice.target)
              setOpen(false)
              setQuery('')
            }}
          >
            <span className={styles['name']}>{choice.displayName}</span>
            <span className={styles['route']}>{choice.provider}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 && <p className={styles['empty']}>{t('providerSearchEmpty')}</p>}
    </div>
  )
}
