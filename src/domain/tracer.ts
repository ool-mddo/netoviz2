import type { SupportEdge } from '../api/types'
import type { SupportIndex } from './supportIndex'

export type TraceDirection = 'lower' | 'upper' | 'both'

export interface TraceResult {
  /** Start objects and all objects reached through supports */
  ids: Set<string>
  /** Traced supports */
  edges: SupportEdge[]
}

/**
 * Trace supports from the objects (kind-agnostic: node, tp and link are the same).
 * Safe for cyclic data: each object is visited only once.
 */
export function traceSupports(
  index: SupportIndex,
  startIds: readonly string[],
  direction: TraceDirection,
  maxDepth = Number.POSITIVE_INFINITY,
): TraceResult {
  const ids = new Set<string>(startIds)
  const edges = new Map<SupportEdge, true>()
  if (direction !== 'upper')
    walk(
      startIds,
      (id) => index.lowerEdges(id),
      (edge) => edge.to,
      ids,
      edges,
      maxDepth,
    )
  if (direction !== 'lower')
    walk(
      startIds,
      (id) => index.upperEdges(id),
      (edge) => edge.from,
      ids,
      edges,
      maxDepth,
    )
  return { ids, edges: [...edges.keys()] }
}

function walk(
  startIds: readonly string[],
  edgesOf: (id: string) => readonly SupportEdge[],
  nextOf: (edge: SupportEdge) => string,
  ids: Set<string>,
  edges: Map<SupportEdge, true>,
  maxDepth: number,
): void {
  const visited = new Set<string>(startIds)
  let frontier = [...startIds]
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of edgesOf(id)) {
        edges.set(edge, true)
        const nextId = nextOf(edge)
        ids.add(nextId)
        if (!visited.has(nextId)) {
          visited.add(nextId)
          next.push(nextId)
        }
      }
    }
    frontier = next
  }
}
