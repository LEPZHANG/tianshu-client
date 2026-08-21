// @vitest-environment jsdom
// Provider picker: the search that made a card grid worth having, and the
// ordering that puts common routes ahead of specialized ones.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { filterProviders, orderProviders, ProviderPicker } from '../src/client/ProviderPicker.tsx'
import type { ProviderChoice } from '../src/client/ProviderPicker.tsx'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

/** Stands in for the page's own editor target, which carries settings addressing. */
interface TestTarget {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
}

function choice(provider: string, displayName: string): ProviderChoice<TestTarget> {
  return {
    provider,
    displayName,
    target: { provider, displayName, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] },
  }
}

const CHOICES = [
  choice('together', 'Together AI'),
  choice('anthropic', 'Anthropic'),
  choice('zzz-custom', 'Aardvark Cloud'),
  choice('moonshotai-cn', 'Moonshot / Kimi'),
  choice('deepseek-official', 'DeepSeek'),
]

describe('provider ordering', () => {
  it('puts the routes people reach for first, then the rest alphabetically', () => {
    expect(orderProviders(CHOICES).map(entry => entry.provider))
      .toEqual(['deepseek-official', 'anthropic', 'moonshotai-cn', 'together', 'zzz-custom'])
  })

  it('leaves the input array untouched', () => {
    const before = CHOICES.map(entry => entry.provider)
    orderProviders(CHOICES)
    expect(CHOICES.map(entry => entry.provider)).toEqual(before)
  })

  it('sorts unlisted routes among themselves by display name', () => {
    // A route absent from the priority list is not special-cased away; the
    // directory may grow without editing that list.
    const unlisted = [choice('b-route', 'Zebra'), choice('a-route', 'Alpaca')]
    expect(orderProviders(unlisted).map(entry => entry.displayName)).toEqual(['Alpaca', 'Zebra'])
  })
})

describe('provider search', () => {
  it('matches the display name and the route id alike', () => {
    // The two names diverge often enough that matching only one would hide
    // the card from whoever searched by the other.
    expect(filterProviders(CHOICES, 'kimi').map(entry => entry.provider)).toEqual(['moonshotai-cn'])
    expect(filterProviders(CHOICES, 'moonshotai').map(entry => entry.provider)).toEqual(['moonshotai-cn'])
  })

  it('ignores case and surrounding space', () => {
    expect(filterProviders(CHOICES, '  ANTHROPIC ').map(entry => entry.provider)).toEqual(['anthropic'])
  })

  it('returns everything for a blank query', () => {
    expect(filterProviders(CHOICES, '   ')).toHaveLength(CHOICES.length)
  })

  it('returns nothing rather than guessing when nothing matches', () => {
    expect(filterProviders(CHOICES, 'nonesuch')).toEqual([])
  })
})

describe('ProviderPicker', () => {
  const current = { provider: 'anthropic', displayName: 'Anthropic' }

  it('opens summarized and expands to the grid on request', () => {
    const onChoose = vi.fn()
    render(<ProviderPicker choices={CHOICES} current={current} onChoose={onChoose} t={t} />)
    // Summarized first: the common path is filling in the chosen route's key.
    const field = screen.getByLabelText(en.provider)
    expect(within(field).queryByLabelText(en.providerSearch)).toBeNull()
    fireEvent.click(within(field).getByText(en.changeProvider))
    expect(screen.getByLabelText(en.providerSearch)).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(CHOICES.length)
  })

  it('narrows the grid as the query is typed and reports an empty result', () => {
    render(<ProviderPicker choices={CHOICES} current={current} onChoose={vi.fn()} t={t} />)
    fireEvent.click(screen.getByText(en.changeProvider))
    const search = screen.getByLabelText<HTMLInputElement>(en.providerSearch)
    fireEvent.change(search, { target: { value: 'deep' } })
    expect(screen.getAllByRole('button').map(card => card.textContent))
      .toEqual(['DeepSeekdeepseek-official'])
    fireEvent.change(search, { target: { value: 'nonesuch' } })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText(en.providerSearchEmpty)).toBeTruthy()
  })

  it('marks the current route and collapses once another is chosen', () => {
    const onChoose = vi.fn()
    render(<ProviderPicker choices={CHOICES} current={current} onChoose={onChoose} t={t} />)
    fireEvent.click(screen.getByText(en.changeProvider))
    const cards = screen.getAllByRole('button')
    expect(cards.filter(card => card.getAttribute('aria-pressed') === 'true')
      .map(card => card.textContent)).toEqual(['Anthropicanthropic'])
    fireEvent.click(cards[0] as HTMLElement)
    expect(onChoose).toHaveBeenCalledWith(CHOICES[4]?.target)
    // Collapsed back to the summary: the choice is made, the key is next.
    expect(screen.queryByLabelText(en.providerSearch)).toBeNull()
  })

  it('discards a stale query when the grid is reopened', () => {
    render(<ProviderPicker choices={CHOICES} current={current} onChoose={vi.fn()} t={t} />)
    fireEvent.click(screen.getByText(en.changeProvider))
    fireEvent.change(screen.getByLabelText(en.providerSearch), { target: { value: 'deep' } })
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement)
    fireEvent.click(screen.getByText(en.changeProvider))
    expect(screen.getByLabelText<HTMLInputElement>(en.providerSearch).value).toBe('')
    expect(screen.getAllByRole('button')).toHaveLength(CHOICES.length)
  })
})
