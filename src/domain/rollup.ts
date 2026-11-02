import type { DiffLabel, LayerData } from '../api/types'

/** Links between nodes: links between the term-points are bundled (both directions are one) */
export interface NodeLink {
  /** ID made from the node IDs (not an ID of the server) */
  id: string
  source: string
  target: string
  /** IDs of the bundled links */
  linkIds: string[]
  /** 'changed' if the bundled links have both of changed/added/deleted and others, otherwise the common label */
  diff?: DiffLabel
}

/**
 * Bundle the links between term-points to the links between nodes (to show node-level topology).
 * Links with an unknown endpoint are skipped. Links in the same node (loopback) are skipped.
 */
export function rollupLinks(layer: Pick<LayerData, 'tps' | 'links'>): NodeLink[] {
  const nodeOf = new Map(layer.tps.map((tp) => [tp.id, tp.node]))
  const bundles = new Map<string, NodeLink>()
  const diffs = new Map<string, Set<DiffLabel | 'kept'>>()
  for (const link of layer.links) {
    const source = link.src ? nodeOf.get(link.src) : undefined
    const target = link.dst ? nodeOf.get(link.dst) : undefined
    if (source === undefined || target === undefined || source === target) continue

    const [a, b] = source < target ? [source, target] : [target, source]
    const key = JSON.stringify([a, b])
    let bundle = bundles.get(key)
    if (!bundle) {
      bundle = { id: key, source: a, target: b, linkIds: [] }
      bundles.set(key, bundle)
      diffs.set(key, new Set())
    }
    bundle.linkIds.push(link.id)
    diffs.get(key)?.add(link.diff ?? 'kept')
  }
  for (const [key, bundle] of bundles) {
    const labels = diffs.get(key) ?? new Set()
    if (labels.size === 1) {
      const only = [...labels][0]
      if (only && only !== 'kept') bundle.diff = only
    } else if (labels.size > 1) {
      bundle.diff = 'changed'
    }
  }
  return [...bundles.values()]
}
