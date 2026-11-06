import { compareNames } from '../bands'
import { layerOfId } from '../../../domain/layers'
import type { SupportIndex } from '../../../domain/supportIndex'
import type { Positions } from '../types'
import type { Annotated, NodeAnnotation } from './annotate'
import type { SchematicNode } from './types'

/**
 * All the nodes which support each node through the chain of node supports (layer3 -> layer2 -> layer1).
 * Cycles of supports do not stop it from ending.
 */
export function lowerClosure(index: SupportIndex, nodeIds: Iterable<string>): Map<string, Set<string>> {
  const memo = new Map<string, Set<string>>()
  const visiting = new Set<string>()
  const visit = (id: string): Set<string> => {
    const known = memo.get(id)
    if (known) return known
    const reached = new Set<string>()
    if (visiting.has(id)) return reached // a cycle: the nodes are reached by the other route
    visiting.add(id)
    for (const edge of index.lowerEdges(id)) {
      if (edge.kind !== 'node') continue
      reached.add(edge.to)
      for (const lower of visit(edge.to)) reached.add(lower)
    }
    visiting.delete(id)
    memo.set(id, reached)
    return reached
  }
  const result = new Map<string, Set<string>>()
  // (a node is not its own supporter even if the supports make a cycle)
  for (const id of nodeIds) result.set(id, new Set([...visit(id)].filter((lower) => lower !== id)))
  return result
}

/** The layers which the nodes reach by the supports (the candidates of the base layer) */
export function lowerLayersOf(
  closure: ReadonlyMap<string, ReadonlySet<string>>,
  layerIds: readonly string[],
): string[] {
  const layers = layerIds.map((id) => ({ id }))
  const reached = new Set<string>()
  for (const lowers of closure.values()) {
    for (const id of lowers) {
      const layer = layerOfId(id, layers)
      if (layer) reached.add(layer)
    }
  }
  return [...reached]
}

/** For each node, the nodes of the base layer which support it (a node which no node of the layer supports is absent) */
export function lowerNodesIn(
  closure: ReadonlyMap<string, ReadonlySet<string>>,
  baseLayer: string,
  layerIds: readonly string[],
): Map<string, string[]> {
  const layers = layerIds.map((id) => ({ id }))
  const result = new Map<string, string[]>()
  for (const [id, lowers] of closure) {
    const inBase = [...lowers].filter((lower) => layerOfId(lower, layers) === baseLayer).sort(compareNames)
    if (inBase.length > 0) result.set(id, inBase)
  }
  return result
}

export interface BaseArrangement {
  annotations: ReadonlyMap<string, NodeAnnotation>
  positions: Positions
  /** Nodes of the base layer which are connection points (not devices): the nodes they support are connection points */
  connectors?: ReadonlySet<string>
}

export interface Inherited {
  /** Group / tier / pair of the devices (the nodes which are not connection points) */
  annotated: Annotated
  /** The nodes which are arranged (devices), and the connection points which are put between them afterward */
  devices: SchematicNode[]
  connectors: SchematicNode[]
  /** Position (x) of a device: the mean of the x of the supporting nodes of the base layer */
  hints: Map<string, number>
  /** Row for the devices which got no tier (after the last row) */
  unclassifiedRow: number
}

/**
 * Give group / tier / pair to the nodes of a layer from the nodes of the base layer which support them.
 * - A node supported by one node of the base layer is a device: it is in its group and tier (and its pair), and at its
 *   position (hints). Only the devices are subjects of the layout.
 * - A node supported by two or more nodes (a connection point of devices, e.g. an L3 segment) is not a subject of the
 *   layout: it is put between the devices it is linked to afterward (see connectors.ts). It does not depend on the
 *   kind of the node.
 * - A node which no classified node supports is unclassified.
 */
export function inheritAnnotations(
  nodes: readonly SchematicNode[],
  lowerOf: ReadonlyMap<string, readonly string[]>,
  base: BaseArrangement,
): Inherited {
  const annotations = new Map<string, NodeAnnotation>()
  const hints = new Map<string, number>()
  const devices: SchematicNode[] = []
  const connectors: SchematicNode[] = []
  const unclassified: string[] = []
  // how many nodes of the layer are supported by only the same node of the base layer (e.g. the interfaces of a device)
  const sameSupporter = new Map<string, number>()
  for (const node of nodes) {
    const sole = new Set(lowerOf.get(node.id) ?? [])
    if (sole.size !== 1) continue
    const [id] = [...sole]
    if (id !== undefined) sameSupporter.set(id, (sameSupporter.get(id) ?? 0) + 1)
  }

  for (const node of nodes) {
    // a node supported only by connection points of the base layer (e.g. an L3 segment) is a connection point as well
    const lowers = lowerOf.get(node.id) ?? []
    if (lowers.length > 0 && base.connectors && lowers.every((id) => base.connectors?.has(id))) {
      connectors.push(node)
      continue
    }
    const supporters = [...new Set(lowerOf.get(node.id) ?? [])].filter(
      (id) => base.annotations.get(id)?.tierIndex !== undefined,
    )
    if (supporters.length >= 2) {
      connectors.push(node)
      continue
    }
    devices.push(node)
    const annotation: NodeAnnotation = { id: node.id, captures: {} }
    annotations.set(node.id, annotation)
    const info = supporters[0] === undefined ? undefined : base.annotations.get(supporters[0])
    if (!info) {
      unclassified.push(node.id)
      continue
    }
    annotation.tier = info.tier
    annotation.tierIndex = info.tierIndex
    if (info.group !== undefined) annotation.group = info.group
    if (info.order !== undefined) annotation.order = info.order
    // a pair is inherited only by the node which is the only one supported by the node of the pair (the interfaces of
    // the devices of a pair are not a pair: they are in a row of the device, by the positions)
    if (info.pair && sameSupporter.get(supporters[0] ?? '') === 1) {
      annotation.pair = { key: `base:${info.pair.key}`, primary: info.pair.primary }
    }
    const p = base.positions.get(supporters[0] ?? '')
    if (p) hints.set(node.id, p.x)
  }

  const tierIndexes = [...annotations.values()].flatMap((a) =>
    a.tierIndex === undefined ? [] : [a.tierIndex],
  )
  const unclassifiedRow = tierIndexes.length > 0 ? Math.floor(Math.max(...tierIndexes)) + 1 : 0
  return {
    annotated: { annotations, unclassified, unpaired: [] },
    devices,
    connectors,
    hints,
    unclassifiedRow,
  }
}
