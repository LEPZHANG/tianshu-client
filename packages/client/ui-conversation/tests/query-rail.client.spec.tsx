// @vitest-environment jsdom
// QueryRail behavior: which queries become ticks, which tick is marked as the
// reader moves, and what clicking one does. jsdom reports zero-size boxes, so
// every case installs the geometry the rail measures.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { queryAtViewport } from '../src/client/chat/QueryRail.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Give an element a fixed viewport box, the only geometry the rail reads. */
function boxOf(element: Element, box: { top: number; bottom: number; left?: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: box.top, bottom: box.bottom, left: box.left ?? 0, right: 800,
    width: 800, height: box.bottom - box.top, x: box.left ?? 0, y: box.top,
    toJSON: () => ({}),
  })
}

describe('queryAtViewport', () => {
  /** A flow of anchored rows at the given viewport tops, inside a scrollport. */
  function flow(tops: readonly (number | null)[]) {
    const scrollport = document.createElement('div')
    const list = document.createElement('div')
    scrollport.append(list)
    document.body.append(scrollport)
    boxOf(scrollport, { top: 0, bottom: 1000 })
    const queries = tops.map((top, index) => {
      // A null top stands for a query whose row is not currently rendered.
      if (top === null) return { key: `q${index}`, preview: `query ${index}` }
      const row = document.createElement('div')
      row.dataset.chatAnchorKey = `q${index}`
      list.append(row)
      boxOf(row, { top, bottom: top + 40 })
      return { key: `q${index}`, preview: `query ${index}` }
    })
    return { list, scrollport, queries }
  }

  it('marks no query when there are none', () => {
    const { list, scrollport } = flow([])
    expect(queryAtViewport(list, scrollport, [])).toBeNull()
  })

  it('marks the last query that starts above the reading threshold', () => {
    // Threshold is 55% of 1000 = 550. Rows at 100 and 400 are above it; the
    // row at 700 is not, so the reader still owns the second query.
    const { list, scrollport, queries } = flow([100, 400, 700])
    expect(queryAtViewport(list, scrollport, queries)).toBe('q1')
  })

  it('keeps the first query marked while the reader is above all of them', () => {
    // Every row starts below the threshold — the reader is at the very top.
    const { list, scrollport, queries } = flow([600, 700, 800])
    expect(queryAtViewport(list, scrollport, queries)).toBe('q0')
  })

  it('does not let a query scrolled just into view steal the mark', () => {
    // A row at 540 is visible but above the 550 threshold; one at 560 is not.
    const { list, scrollport, queries } = flow([100, 560])
    expect(queryAtViewport(list, scrollport, queries)).toBe('q0')
  })

  it('skips queries whose rows are not rendered', () => {
    // Paged-out history: the query exists in order but has no row to measure,
    // so it cannot claim the mark from the one that does.
    const { list, scrollport, queries } = flow([null, 100])
    expect(queryAtViewport(list, scrollport, queries)).toBe('q1')
  })

  it('measures against the composer top rather than the scrollport floor', () => {
    // The composer covers the lower half, so the reading area — and with it
    // the threshold — is the space above it, not the full scrollport.
    const { list, scrollport, queries } = flow([100, 300])
    const composer = document.createElement('div')
    composer.dataset.composerSeat = ''
    scrollport.append(composer)
    boxOf(composer, { top: 400, bottom: 1000 })
    // Threshold is now 55% of 400 = 220, so the row at 300 stays below it.
    expect(queryAtViewport(list, scrollport, queries)).toBe('q0')
  })

  it('floors the reading threshold so a short viewport still has one', () => {
    // 55% of a 100px area is 55px, below the 72px floor. The row at 70 sits
    // under the percentage but over the floor, so the floor is what decides.
    const { list, scrollport, queries } = flow([70, 90])
    boxOf(scrollport, { top: 0, bottom: 100 })
    expect(queryAtViewport(list, scrollport, queries)).toBe('q0')
  })
})
