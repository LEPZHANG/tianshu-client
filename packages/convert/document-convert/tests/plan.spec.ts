import { describe, expect, it } from 'vitest'
import {
  ConvertError,
  parseRouteKey,
  routeKey,
  type ConvertRoute,
  type ConvertStepSpec,
  type DocumentConvertProvider,
  type DocumentFormat,
} from '@deepseek-ai/dsh-document-convert'
import { planRoute } from '@deepseek-ai/dsh-document-convert/src/plan.ts'

/** A provider that declares routes and never runs, so planning is tested apart from execution. */
function provider(
  id: string,
  routes: readonly ConvertRoute[],
  available = true,
): DocumentConvertProvider {
  return {
    id,
    routes,
    available: () => available,
    convert: (_step: ConvertStepSpec) => Promise.resolve([]),
  }
}

function route(
  from: DocumentFormat,
  to: DocumentFormat,
  fidelity: ConvertRoute['fidelity'] = 'faithful',
  priority = 10,
): ConvertRoute {
  return { from, to, fidelity, priority }
}

/** Plan with the given providers, a two-step ceiling, and no pins unless stated. */
function plan(
  providers: readonly DocumentConvertProvider[],
  from: DocumentFormat,
  to: DocumentFormat,
  overrides: { maxSteps?: number; pinned?: ReadonlyMap<string, string> } = {},
): ReturnType<typeof planRoute> {
  return planRoute(from, to, {
    providers,
    maxSteps: overrides.maxSteps ?? 2,
    pinned: overrides.pinned ?? new Map(),
  })
}

/** The provider ids a plan's steps run through, in order. */
function providerIds(steps: readonly { providerId: string }[]): string[] {
  return steps.map(step => step.providerId)
}

describe('routeKey', () => {
  it('spells an edge as from->to', () => {
    expect(routeKey('docx', 'pdf')).toBe('docx->pdf')
  })
})

describe('parseRouteKey', () => {
  it('reads both formats out of a key', () => {
    expect(parseRouteKey('docx->pdf')).toEqual({ from: 'docx', to: 'pdf' })
  })

  it('rejects a key that is not two arrow-separated parts', () => {
    expect(() => parseRouteKey('docx')).toThrow(ConvertError)
    expect(() => parseRouteKey('docx->pdf->odt')).toThrow(/must be spelled/)
  })

  it('rejects a key naming a format the seam does not convert', () => {
    expect(() => parseRouteKey('docx->zip')).toThrow(/does not convert/)
  })
})

describe('planRoute direct routes', () => {
  it('plans a single step through the only provider offering the edge', () => {
    const result = plan([provider('lo', [route('docx', 'pdf')])], 'docx', 'pdf')
    expect(result.steps).toEqual([{ providerId: 'lo', from: 'docx', to: 'pdf', fidelity: 'faithful' }])
    expect(result.fidelity).toBe('faithful')
  })

  it('refuses a conversion whose source and target are the same format', () => {
    expect(() => plan([provider('lo', [route('docx', 'pdf')])], 'docx', 'docx'))
      .toThrow(expect.objectContaining({ code: 'CONVERT_SAME_FORMAT' }))
  })

  it('refuses when no provider reaches the target', () => {
    expect(() => plan([provider('lo', [route('docx', 'pdf')])], 'docx', 'odp'))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })

  it('refuses when the only provider offering the edge is unusable', () => {
    expect(() => plan([provider('lo', [route('docx', 'pdf')], false)], 'docx', 'pdf'))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
  })
})

describe('planRoute provider selection', () => {
  it('prefers the faithful offer over the lossy one regardless of priority', () => {
    const result = plan([
      provider('lossy-but-high', [route('docx', 'pdf', 'lossy', 99)]),
      provider('faithful', [route('docx', 'pdf', 'faithful', 1)]),
    ], 'docx', 'pdf')
    expect(providerIds(result.steps)).toEqual(['faithful'])
  })

  it('prefers the higher priority when fidelity ties', () => {
    const result = plan([
      provider('low', [route('docx', 'pdf', 'faithful', 10)]),
      provider('high', [route('docx', 'pdf', 'faithful', 20)]),
    ], 'docx', 'pdf')
    expect(providerIds(result.steps)).toEqual(['high'])
  })

  it('does not depend on registration order', () => {
    const low = provider('low', [route('docx', 'pdf', 'faithful', 10)])
    const high = provider('high', [route('docx', 'pdf', 'faithful', 20)])
    expect(providerIds(plan([low, high], 'docx', 'pdf').steps))
      .toEqual(providerIds(plan([high, low], 'docx', 'pdf').steps))
  })

  it('refuses an unbreakable tie on an edge the plan uses', () => {
    expect(() => plan([
      provider('one', [route('docx', 'pdf', 'faithful', 10)]),
      provider('two', [route('docx', 'pdf', 'faithful', 10)]),
    ], 'docx', 'pdf')).toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_AMBIGUOUS' }))
  })

  it('ignores a tie on an edge the selected plan does not use', () => {
    const result = plan([
      provider('one', [route('docx', 'pdf'), route('odt', 'rtf', 'faithful', 10)]),
      provider('two', [route('odt', 'rtf', 'faithful', 10)]),
    ], 'docx', 'pdf')
    expect(providerIds(result.steps)).toEqual(['one'])
  })
})

describe('planRoute multi-step routes', () => {
  it('chains two providers to reach a target neither serves directly', () => {
    const result = plan([
      provider('extract', [route('pdf', 'txt', 'lossy', 20)]),
      provider('office', [route('txt', 'xlsx', 'lossy', 10)]),
    ], 'pdf', 'xlsx')
    expect(providerIds(result.steps)).toEqual(['extract', 'office'])
    expect(result.steps.map(step => step.to)).toEqual(['txt', 'xlsx'])
  })

  it('reports the worst step fidelity for the whole plan', () => {
    const result = plan([
      provider('extract', [route('pdf', 'txt', 'lossy')]),
      provider('office', [route('txt', 'docx', 'faithful')]),
    ], 'pdf', 'docx')
    expect(result.fidelity).toBe('lossy')
  })

  it('prefers one step over two even when the two-step route is more faithful', () => {
    const result = plan([
      provider('direct', [route('docx', 'pdf', 'lossy')]),
      provider('a', [route('docx', 'odt', 'faithful')]),
      provider('b', [route('odt', 'pdf', 'faithful')]),
    ], 'docx', 'pdf')
    expect(result.steps).toHaveLength(1)
    expect(providerIds(result.steps)).toEqual(['direct'])
  })

  it('prefers the more faithful route when both take the same number of steps', () => {
    const result = plan([
      provider('viaTxt', [route('docx', 'txt', 'lossy'), route('txt', 'odp', 'lossy')]),
      provider('viaOdt', [route('docx', 'odt', 'faithful'), route('odt', 'odp', 'faithful')]),
    ], 'docx', 'odp')
    expect(providerIds(result.steps)).toEqual(['viaOdt', 'viaOdt'])
  })

  it('prefers the route whose weakest step ranks highest when steps and fidelity tie', () => {
    const result = plan([
      provider('weak', [route('docx', 'txt', 'faithful', 1), route('txt', 'odp', 'faithful', 50)]),
      provider('strong', [route('docx', 'odt', 'faithful', 40), route('odt', 'odp', 'faithful', 40)]),
    ], 'docx', 'odp')
    expect(providerIds(result.steps)).toEqual(['strong', 'strong'])
  })

  it('refuses a chain that needs more steps than the ceiling allows', () => {
    const providers = [
      provider('a', [route('pdf', 'txt', 'lossy')]),
      provider('b', [route('txt', 'odt')]),
      provider('c', [route('odt', 'odp')]),
    ]
    expect(() => plan(providers, 'pdf', 'odp', { maxSteps: 2 }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_UNSUPPORTED' }))
    expect(plan(providers, 'pdf', 'odp', { maxSteps: 3 }).steps).toHaveLength(3)
  })

  it('never revisits a format within one plan', () => {
    const result = plan([
      provider('loop', [route('docx', 'odt'), route('odt', 'docx'), route('odt', 'pdf')]),
    ], 'docx', 'pdf')
    expect(result.steps.map(step => step.to)).toEqual(['odt', 'pdf'])
  })
})

describe('planRoute pinning', () => {
  it('forces a pinned edge onto its named provider', () => {
    const result = plan([
      provider('best', [route('docx', 'html', 'faithful', 99)]),
      provider('chosen', [route('docx', 'html', 'faithful', 1)]),
    ], 'docx', 'html', { pinned: new Map([['docx->html', 'chosen']]) })
    expect(providerIds(result.steps)).toEqual(['chosen'])
  })

  it('resolves an otherwise unbreakable tie', () => {
    const result = plan([
      provider('one', [route('docx', 'pdf', 'faithful', 10)]),
      provider('two', [route('docx', 'pdf', 'faithful', 10)]),
    ], 'docx', 'pdf', { pinned: new Map([['docx->pdf', 'two']]) })
    expect(providerIds(result.steps)).toEqual(['two'])
  })

  it('refuses a pin naming a provider that is not registered', () => {
    expect(() => plan([provider('lo', [route('docx', 'pdf')])], 'docx', 'pdf', {
      pinned: new Map([['docx->pdf', 'absent']]),
    })).toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_CONFIGURED_MISSING' }))
  })

  it('refuses a pin naming a provider that does not serve that edge', () => {
    expect(() => plan([
      provider('lo', [route('docx', 'pdf')]),
      provider('other', [route('odt', 'pdf')]),
    ], 'docx', 'pdf', { pinned: new Map([['docx->pdf', 'other']]) }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_CONFIGURED_MISSING' }))
  })

  it('refuses a pin naming a provider that is registered but unusable', () => {
    expect(() => plan([
      provider('lo', [route('docx', 'pdf')]),
      provider('off', [route('docx', 'pdf')], false),
    ], 'docx', 'pdf', { pinned: new Map([['docx->pdf', 'off']]) }))
      .toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_CONFIGURED_MISSING' }))
  })

  it('refuses a pin for an edge no registered provider offers at all', () => {
    expect(() => plan([provider('lo', [route('docx', 'pdf')])], 'docx', 'pdf', {
      pinned: new Map([['odt->ods', 'lo']]),
    })).toThrow(expect.objectContaining({ code: 'CONVERT_ROUTE_CONFIGURED_MISSING' }))
  })
})
