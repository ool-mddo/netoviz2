import type { SupportEdge } from '../api/types'

/**
 * Index of supports in both directions.
 * "upper" objects are supported by "lower" objects (`from` is upper, `to` is lower in SupportEdge).
 */
export class SupportIndex {
  private readonly lowerMap = new Map<string, SupportEdge[]>()
  private readonly upperMap = new Map<string, SupportEdge[]>()

  constructor(edges: readonly SupportEdge[] = []) {
    for (const edge of edges) {
      this.push(this.lowerMap, edge.from, edge)
      this.push(this.upperMap, edge.to, edge)
    }
  }

  /** Edges to the objects that support the object (to lower layers) */
  lowerEdges(id: string): readonly SupportEdge[] {
    return this.lowerMap.get(id) ?? []
  }

  /** Edges from the objects that are supported by the object (to upper layers) */
  upperEdges(id: string): readonly SupportEdge[] {
    return this.upperMap.get(id) ?? []
  }

  private push(map: Map<string, SupportEdge[]>, key: string, edge: SupportEdge): void {
    const list = map.get(key)
    if (list) list.push(edge)
    else map.set(key, [edge])
  }
}
