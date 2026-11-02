import type { DiffLabel, LayerData } from '../api/types'
import { rollupLinks } from './rollup'

/** Node of the force graph: a node of the topology or a term-point of an expanded node */
export interface DisplayNode {
  /** ID of the node/term-point */
  id: string
  type: 'node' | 'tp'
  name: string
  layer: string
  /** `node-type` etc. (for display) */
  kind?: string
  diff?: DiffLabel
  /** ID of the node (term-points only) */
  parent?: string
  /** Number of term-points (nodes only) */
  tpCount?: number
  expanded?: boolean
}

export interface DisplayLink {
  id: string
  source: string
  target: string
  /** `link`: link of the topology (bundled), `member`: term-point belongs to the node */
  type: 'link' | 'member'
  /** Number of the bundled links */
  count: number
  diff?: DiffLabel
}

export interface DisplayGraph {
  nodes: DisplayNode[]
  links: DisplayLink[]
}

/**
 * Make the graph to show from the structure of layers.
 * Nodes are shown without their term-points, except the nodes in `expanded`.
 */
export function buildDisplayGraph(layers: readonly LayerData[], expanded: ReadonlySet<string>): DisplayGraph {
  const nodes: DisplayNode[] = []
  const links: DisplayLink[] = []
  for (const layer of layers) {
    for (const node of layer.nodes) {
      const isExpanded = expanded.has(node.id)
      nodes.push({
        id: node.id,
        type: 'node',
        name: node.name,
        layer: layer.layer,
        ...(node.kind ? { kind: node.kind } : {}),
        ...(node.diff ? { diff: node.diff } : {}),
        tpCount: node.tp_count,
        expanded: isExpanded,
      })
    }
    for (const tp of layer.tps) {
      if (!expanded.has(tp.node)) continue
      nodes.push({
        id: tp.id,
        type: 'tp',
        name: tp.name,
        layer: layer.layer,
        ...(tp.diff ? { diff: tp.diff } : {}),
        parent: tp.node,
      })
      links.push({ id: `member:${tp.id}`, source: tp.node, target: tp.id, type: 'member', count: 1 })
    }
    for (const link of rollupLinks(layer, expanded)) {
      links.push({
        id: link.id,
        source: link.source,
        target: link.target,
        type: 'link',
        count: link.linkIds.length,
        ...(link.diff ? { diff: link.diff } : {}),
      })
    }
  }
  return { nodes, links }
}

/**
 * ID of the shown element for an object: a term-point of a collapsed node is shown as the node.
 * @returns undefined if the object is not shown (e.g. links, layers which are not visible)
 */
export function displayIdOf(
  entry: { type: 'node' | 'tp' | 'link'; data: { id: string; node?: string } } | undefined,
  expanded: ReadonlySet<string>,
  shown: ReadonlySet<string>,
): string | undefined {
  if (!entry || entry.type === 'link') return undefined
  const id = entry.type === 'tp' && !expanded.has(entry.data.node ?? '') ? entry.data.node : entry.data.id
  return id !== undefined && shown.has(id) ? id : undefined
}
