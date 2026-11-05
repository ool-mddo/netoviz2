import { layoutWithStress } from '../stress'
import type { Positions } from '../types'
import { annotate } from './annotate'
import { solvePositions } from './solve'
import { assignSlots } from './slots'
import type { SchematicLayerInput } from './types'

/**
 * Layout of a layer for network diagrams (the schematic engine):
 * annotate (meaning from the profile) -> slots (group / row / order) -> solve (coordinates).
 * Without a profile, or when the profile gives no tier to any node (it does not fit the layer), the nodes are
 * arranged by the stress layout.
 */
export function layoutSchematic(input: SchematicLayerInput): Promise<Positions> {
  const { profile, nodes, links } = input
  if (profile) {
    const annotated = annotate(nodes, profile)
    if (annotated.unclassified.length < nodes.length) {
      const slots = assignSlots(nodes, annotated, links, profile)
      return Promise.resolve(solvePositions(nodes, slots, links))
    }
  }
  return Promise.resolve(
    layoutWithStress(
      nodes.map((node) => ({ id: node.id, radius: node.radius })),
      links,
    ),
  )
}
