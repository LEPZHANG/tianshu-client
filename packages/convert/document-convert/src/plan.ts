/**
 * Route planning: turn the registered providers' declared edges into one ordered conversion plan from a
 * source format to a target format. Pure functions over explicit inputs — no service, no I/O — so the
 * whole selection policy is unit-testable and cannot depend on registration order.
 *
 * Planning allows more than one step because that is the only way most cross-family targets exist at
 * all: no converter turns a PDF into a spreadsheet, but `pdf → txt → xlsx` does, and reporting it as
 * `lossy` says so honestly rather than pretending a direct route exists.
 * @module @deepseek-ai/dsh-document-convert/plan
 */

import { DOCUMENT_FORMATS } from './format.ts'
import type {
  ConvertFidelity,
  ConvertPlan,
  ConvertPlanStep,
  DocumentConvertProvider,
  DocumentFormat,
} from './types.ts'
import { ConvertError } from './types.ts'

/** Order in which fidelities are preferred; lower is better. */
const FIDELITY_RANK: Readonly<Record<ConvertFidelity, number>> = { faithful: 0, lossy: 1 }

/**
 * The `<from>-><to>` key naming one directed edge, the spelling the seam's `routes` config uses.
 * @param from - the source format.
 * @param to - the target format.
 * @returns the edge key.
 */
export function routeKey(from: DocumentFormat, to: DocumentFormat): string {
  return `${from}->${to}`
}

/**
 * Parse one `routes` config key into its two formats. Rejects a malformed key or an unknown format name
 * so a typo fails at load rather than silently pinning nothing.
 * @param key - the configured key, expected as `<from>-><to>`.
 * @returns the two formats the key names.
 */
export function parseRouteKey(key: string): { from: DocumentFormat; to: DocumentFormat } {
  const parts = key.split('->')
  const [from, to] = parts
  if (parts.length !== 2 || from === undefined || to === undefined) {
    throw new ConvertError(`route key "${key}" must be spelled "<from>-><to>"`, 'CONVERT_ROUTE_KEY_INVALID')
  }
  if (!isDocumentFormat(from) || !isDocumentFormat(to)) {
    const known = DOCUMENT_FORMATS.join(', ')
    throw new ConvertError(`route key "${key}" names a format this seam does not convert; known formats: ${known}`, 'CONVERT_ROUTE_KEY_INVALID')
  }
  return { from, to }
}

/** Whether a string is one of the closed set of format ids. */
function isDocumentFormat(value: string): value is DocumentFormat {
  return (DOCUMENT_FORMATS as readonly string[]).includes(value)
}

/** One provider's offer for a single edge, as planning sees it. */
interface EdgeCandidate {
  readonly providerId: string
  readonly fidelity: ConvertFidelity
  readonly priority: number
}

/** Everything planning needs, supplied explicitly by the runtime. */
export interface PlanInputs {
  /** Every registered provider; planning itself filters to the usable ones. */
  readonly providers: readonly DocumentConvertProvider[]
  /** Maximum steps a plan may take. */
  readonly maxSteps: number
  /** Edge key to the provider id pinned for it, from config. */
  readonly pinned: ReadonlyMap<string, string>
}

/**
 * Group every usable provider's declared routes by edge. Unusable providers are excluded here rather
 * than during search, so a machine without a binary plans around it instead of planning a route that
 * cannot run.
 */
function collectEdges(providers: readonly DocumentConvertProvider[]): Map<string, EdgeCandidate[]> {
  const edges = new Map<string, EdgeCandidate[]>()
  for (const provider of providers) {
    if (!provider.available()) continue
    for (const route of provider.routes) {
      const key = routeKey(route.from, route.to)
      const candidates = edges.get(key) ?? []
      candidates.push({ providerId: provider.id, fidelity: route.fidelity, priority: route.priority })
      edges.set(key, candidates)
    }
  }
  return edges
}

/**
 * Apply the configured pins to the collected edges: a pinned edge keeps only its named provider's offer.
 * A pin naming a provider that is absent, unusable, or that does not declare the edge fails loud —
 * silently falling back to another provider would make the pin a suggestion rather than a decision.
 */
function applyPins(edges: Map<string, EdgeCandidate[]>, pinned: ReadonlyMap<string, string>): void {
  for (const [key, providerId] of pinned) {
    const kept = edges.get(key)?.filter(candidate => candidate.providerId === providerId) ?? []
    if (kept.length === 0) {
      throw new ConvertError(
        `route "${key}" is pinned to provider "${providerId}", which is not registered, not usable, or does not convert that pair`,
        'CONVERT_ROUTE_CONFIGURED_MISSING',
      )
    }
    edges.set(key, kept)
  }
}

/**
 * The winning candidate for one edge: best fidelity first, then highest priority. Returns the winner
 * alongside the runners-up that match it on both keys, so the caller can refuse an unbreakable tie on an
 * edge it actually intends to use.
 */
function rankEdge(candidates: readonly EdgeCandidate[]): { winner: EdgeCandidate; tied: readonly EdgeCandidate[] } {
  const ordered = [...candidates].sort((left, right) =>
    FIDELITY_RANK[left.fidelity] - FIDELITY_RANK[right.fidelity] || right.priority - left.priority)
  // A non-empty candidate list is the collection invariant: an edge key exists only because some
  // provider declared it, and pinning either keeps at least one offer or throws.
  const winner = ordered[0] as EdgeCandidate
  const tied = ordered.filter(candidate =>
    candidate !== winner
    && candidate.fidelity === winner.fidelity
    && candidate.priority === winner.priority)
  return { winner, tied }
}

/**
 * Every simple format path from `from` to `to` within `maxSteps` hops, in a deterministic order:
 * successors are visited in {@link DOCUMENT_FORMATS} declaration order, so the enumeration depends on
 * this package's own vocabulary rather than on which provider registered first. A path stops at the
 * target instead of passing through it, and never revisits a format.
 */
function enumeratePaths(
  from: DocumentFormat,
  to: DocumentFormat,
  edges: ReadonlyMap<string, EdgeCandidate[]>,
  maxSteps: number,
): DocumentFormat[][] {
  const found: DocumentFormat[][] = []
  const walk = (node: DocumentFormat, trail: readonly DocumentFormat[]): void => {
    if (trail.length > maxSteps) return
    for (const next of DOCUMENT_FORMATS) {
      if (trail.includes(next)) continue
      if (!edges.has(routeKey(node, next))) continue
      const extended = [...trail, next]
      if (next === to) {
        found.push(extended)
        continue
      }
      walk(next, extended)
    }
  }
  walk(from, [from])
  return found
}

/** A planned candidate and the ranking keys that order it against its rivals. */
interface RankedPlan {
  readonly plan: ConvertPlan
  /** The lowest step priority, so a plan of strong edges beats one with a weak link. */
  readonly minPriority: number
}

/** Build the plan for one enumerated format path by taking each edge's winning provider. */
function buildPlan(path: readonly DocumentFormat[], edges: ReadonlyMap<string, EdgeCandidate[]>): RankedPlan {
  const steps: ConvertPlanStep[] = []
  let worst: ConvertFidelity = 'faithful'
  let minPriority = Number.POSITIVE_INFINITY
  for (let index = 0; index + 1 < path.length; index += 1) {
    const from = path[index] as DocumentFormat
    const to = path[index + 1] as DocumentFormat
    // Enumeration only follows keys present in `edges`, so the lookup always hits.
    const { winner } = rankEdge(edges.get(routeKey(from, to)) as EdgeCandidate[])
    steps.push({ providerId: winner.providerId, from, to, fidelity: winner.fidelity })
    if (FIDELITY_RANK[winner.fidelity] > FIDELITY_RANK[worst]) worst = winner.fidelity
    minPriority = Math.min(minPriority, winner.priority)
  }
  return { plan: { steps, fidelity: worst }, minPriority }
}

/**
 * Whether `candidate` beats `incumbent`: fewer steps, then better worst-case fidelity, then a higher
 * weakest-edge priority. Ties keep the incumbent, so the deterministic enumeration order decides.
 */
function isBetter(candidate: RankedPlan, incumbent: RankedPlan): boolean {
  if (candidate.plan.steps.length !== incumbent.plan.steps.length) {
    return candidate.plan.steps.length < incumbent.plan.steps.length
  }
  if (candidate.plan.fidelity !== incumbent.plan.fidelity) {
    return FIDELITY_RANK[candidate.plan.fidelity] < FIDELITY_RANK[incumbent.plan.fidelity]
  }
  return candidate.minPriority > incumbent.minPriority
}

/**
 * Refuse a plan whose steps rest on an unbreakable provider tie. Only the selected plan's edges are
 * checked: a tie on an edge this conversion does not use is not this caller's problem, and the remedy
 * named here — pinning the edge in `routes` — is exactly the knob that resolves it.
 */
function assertUnambiguous(plan: ConvertPlan, edges: ReadonlyMap<string, EdgeCandidate[]>): void {
  for (const step of plan.steps) {
    const key = routeKey(step.from, step.to)
    const { winner, tied } = rankEdge(edges.get(key) as EdgeCandidate[])
    if (tied.length === 0) continue
    const ids = [winner, ...tied].map(candidate => candidate.providerId).join(', ')
    throw new ConvertError(
      `route "${key}" is offered at equal fidelity and priority by several providers (${ids}); pin one with the routes config`,
      'CONVERT_ROUTE_AMBIGUOUS',
    )
  }
}

/**
 * Plan the conversion from one format to another.
 *
 * @param from - the source format.
 * @param to - the target format.
 * @param inputs - the registered providers, the step ceiling, and the configured pins.
 * @returns the ordered plan and its worst-case fidelity.
 * @throws {@link ConvertError} `CONVERT_SAME_FORMAT` when both ends are the same format,
 *   `CONVERT_ROUTE_CONFIGURED_MISSING` when a pin cannot be honored, `CONVERT_ROUTE_UNSUPPORTED` when no
 *   usable provider chain reaches the target within the step ceiling, or `CONVERT_ROUTE_AMBIGUOUS` when
 *   the selected plan rests on an unbreakable provider tie.
 */
export function planRoute(from: DocumentFormat, to: DocumentFormat, inputs: PlanInputs): ConvertPlan {
  if (from === to) {
    throw new ConvertError(`source and target are both ${from}; no conversion is needed`, 'CONVERT_SAME_FORMAT')
  }
  const edges = collectEdges(inputs.providers)
  applyPins(edges, inputs.pinned)
  const paths = enumeratePaths(from, to, edges, inputs.maxSteps)
  let best: RankedPlan | undefined
  for (const path of paths) {
    const candidate = buildPlan(path, edges)
    if (best === undefined || isBetter(candidate, best)) best = candidate
  }
  if (best === undefined) {
    throw new ConvertError(
      `no usable converter chain turns ${from} into ${to} within ${inputs.maxSteps} step(s)`,
      'CONVERT_ROUTE_UNSUPPORTED',
    )
  }
  assertUnambiguous(best.plan, edges)
  return best.plan
}
