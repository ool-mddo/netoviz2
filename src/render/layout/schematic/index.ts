import { layoutWithStress } from '../stress'
import type { Positions } from '../types'
import { annotate, type Annotated } from './annotate'
import { inferProfile } from './infer'
import { solvePositions } from './solve'
import { assignSlots } from './slots'
import type { DiagramProfile, SchematicLayerInput, SchematicNode, SchematicViolation } from './types'

function violationsOf(
  nodes: readonly SchematicNode[],
  { unclassified, unpaired }: Annotated,
): SchematicViolation[] {
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]))
  const message = (id: string, text: string) => `${nameOf.get(id) ?? id}: ${text}`
  return [
    ...unclassified.map((id) => ({
      id,
      code: 'unclassified' as const,
      message: message(id, 'no tier is given (the name does not fit the profile, or no rule gives a tier)'),
    })),
    ...unpaired.map((id) => ({
      id,
      code: 'unpaired' as const,
      message: message(id, 'has no partner of the redundant pair'),
    })),
  ]
}

/**
 * Layout of a layer for network diagrams (the schematic engine):
 * annotate (meaning from the profile) -> slots (group / row / order) -> solve (coordinates).
 * The given profile is used first. If there is none, or it gives no tier to any node (it does not fit the layer), the
 * profile is inferred from the names and the links of the layer. If that gives nothing either, the nodes are
 * arranged by the stress layout. What the layout was made from, and the exceptions, are reported.
 */
export function layoutSchematic(input: SchematicLayerInput): Promise<Positions> {
  const { layer, profile, nodes, links, report } = input
  const attempts: Array<() => { profile: DiagramProfile; draft?: string } | undefined> = []
  if (profile) attempts.push(() => ({ profile }))
  attempts.push(() => {
    const inferred = inferProfile(nodes, links)
    return inferred && { profile: inferred.profile, draft: inferred.yaml }
  })

  for (const attempt of attempts) {
    const found = attempt()
    if (!found) continue
    const annotated = annotate(nodes, found.profile)
    if (annotated.unclassified.length >= nodes.length) continue
    report?.({
      layer,
      source: found.draft === undefined ? 'profile' : 'inferred',
      violations: violationsOf(nodes, annotated),
      ...(found.draft === undefined ? {} : { draft: found.draft }),
    })
    const slots = assignSlots(nodes, annotated, links, found.profile)
    return Promise.resolve(solvePositions(nodes, slots, links))
  }

  report?.({ layer, source: 'none', violations: [] })
  return Promise.resolve(
    layoutWithStress(
      nodes.map((node) => ({ id: node.id, radius: node.radius })),
      links,
    ),
  )
}
