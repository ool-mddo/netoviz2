import { layoutWithStress } from '../stress'
import type { Positions } from '../types'
import { annotate, type Annotated } from './annotate'
import { inferProfile } from './infer'
import { placeConnectors } from './connectors'
import { inheritAnnotations } from './inherit'
import { solvePositions } from './solve'
import { assignSlots } from './slots'
import type {
  DiagramProfile,
  SchematicBase,
  SchematicLayerInput,
  SchematicNode,
  SchematicReport,
  SchematicViolation,
} from './types'

type Link = { source: string; target: string }

function violationsOf(
  nodes: readonly SchematicNode[],
  { unclassified, unpaired }: Annotated,
  source: SchematicReport['source'],
): SchematicViolation[] {
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]))
  const message = (id: string, text: string) => `${nameOf.get(id) ?? id}: ${text}`
  return [
    ...unclassified.map((id) => ({
      id,
      code: 'unclassified' as const,
      message: message(
        id,
        source === 'inherited'
          ? 'is not supported by any classified node of the lower layer'
          : 'no tier is given (the name does not fit the profile, or no rule gives a tier)',
      ),
    })),
    ...unpaired.map((id) => ({
      id,
      code: 'unpaired' as const,
      message: message(id, 'has no partner of the redundant pair'),
    })),
  ]
}

interface Arranged {
  positions: Positions
  annotated: Annotated
  source: SchematicReport['source']
  base?: string
  draft?: string
}

/** Radius of the node of the ID (0 for an unknown one) */
const radiusOf = (nodes: readonly SchematicNode[]) => {
  const radius = new Map(nodes.map((node) => [node.id, node.radius]))
  return (id: string) => radius.get(id) ?? 0
}

/**
 * The nodes which the profile gives no tier to but which are linked to two or more of the nodes it classifies (e.g. the
 * segments between the devices): they join the devices, so they are connection points, put between the devices after
 * the devices are arranged (as when the arrangement is inherited), not arranged in a row of their own.
 */
function connectionPointsOf(
  unclassified: readonly string[],
  links: readonly Link[],
  classified: ReadonlySet<string>,
): Set<string> {
  const neighbors = new Map<string, Set<string>>(unclassified.map((id) => [id, new Set()]))
  for (const { source, target } of links) {
    if (classified.has(target)) neighbors.get(source)?.add(target)
    if (classified.has(source)) neighbors.get(target)?.add(source)
  }
  return new Set(unclassified.filter((id) => (neighbors.get(id)?.size ?? 0) >= 2))
}

/**
 * Put the connection points between the devices (the devices are not moved). The connection points which are not
 * linked to any device are in a row under the diagram, centered.
 */
function addConnectionPoints(
  placed: Positions,
  connectors: readonly SchematicNode[],
  links: readonly Link[],
  radiusOf: (id: string) => number,
): Positions {
  const between = placeConnectors(
    connectors.map((node) => ({ id: node.id, radius: node.radius })),
    links,
    placed,
    radiusOf,
  )
  const positions: Positions = new Map([...placed, ...between])
  const alone = connectors.filter((node) => !between.has(node.id))
  if (alone.length > 0) {
    const bottom = [...positions.entries()].reduce((max, [id, p]) => Math.max(max, p.y + radiusOf(id)), 0)
    const width = alone.reduce((sum, node) => sum + 2 * node.radius + 20, -20)
    const xs = [...positions.values()].map((p) => p.x)
    let x = (xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0) - width / 2
    for (const node of alone) {
      positions.set(node.id, { x: x + node.radius, y: bottom + 90 })
      x += 2 * node.radius + 20
    }
  }
  return positions
}

/**
 * Arrange by a profile; undefined if the profile gives no tier to any node (it does not fit).
 * @param withConnectionPoints the nodes without a tier which join two or more classified nodes are connection points
 *   (see connectionPointsOf): only when the arrangement cannot be inherited from a lower layer. Otherwise they are
 *   exceptions: a node which a profile or an inference missed is not hidden by it.
 */
function arrangeByProfile(
  nodes: readonly SchematicNode[],
  links: readonly Link[],
  profile: DiagramProfile,
  withConnectionPoints = false,
): (Pick<Arranged, 'positions' | 'annotated'> & { connectors: ReadonlySet<string> }) | undefined {
  const annotated = annotate(nodes, profile)
  if (annotated.unclassified.length >= nodes.length) return undefined
  const unclassified = new Set(annotated.unclassified)
  const classified = new Set(nodes.filter((node) => !unclassified.has(node.id)).map((node) => node.id))
  const connectorIds = withConnectionPoints
    ? connectionPointsOf(annotated.unclassified, links, classified)
    : new Set<string>()
  const devices = nodes.filter((node) => !connectorIds.has(node.id))
  const deviceLinks = links.filter((l) => !connectorIds.has(l.source) && !connectorIds.has(l.target))
  const slots = assignSlots(devices, annotated, deviceLinks, { unclassifiedRow: profile.tiers.length })
  const placed = solvePositions(devices, slots, deviceLinks)
  const positions =
    connectorIds.size === 0
      ? placed
      : addConnectionPoints(
          placed,
          nodes.filter((node) => connectorIds.has(node.id)),
          links,
          radiusOf(nodes),
        )
  // the connection points are not exceptions: only the other nodes without a tier are told
  return {
    annotated: { ...annotated, unclassified: annotated.unclassified.filter((id) => !connectorIds.has(id)) },
    positions,
    connectors: connectorIds,
  }
}

type BaseArrangement =
  (Pick<Arranged, 'positions' | 'annotated'> & { connectors?: ReadonlySet<string> }) | undefined
/** Arrangements of the base layers (the array of the nodes of a base layer is not changed until it is loaded again) */
const baseCache = new WeakMap<
  object,
  { links: object; profile?: DiagramProfile; arranged: BaseArrangement }
>()

/**
 * Arrange the base layer by its profile, or by the profile inferred from its names and links. (It is not arranged by
 * inheritance from the layer below it, so it can be different from the arrangement shown for the base layer.)
 */
function arrangeBase(base: SchematicBase): BaseArrangement {
  const cached = baseCache.get(base.nodes)
  if (cached && cached.links === base.links && cached.profile === base.profile) return cached.arranged
  const profile = base.profile ?? inferProfile(base.nodes, base.links)?.profile
  // With a given profile, the nodes it leaves without a tier but which join devices (e.g. L3 segments) are connection
  // points, as when the layer is arranged by the profile itself: the layers above inherit that (see inheritAnnotations).
  const arranged = profile && arrangeByProfile(base.nodes, base.links, profile, base.profile !== undefined)
  baseCache.set(base.nodes, {
    links: base.links,
    ...(base.profile ? { profile: base.profile } : {}),
    arranged,
  })
  return arranged
}

/** Gap between the devices in a row (a connection point is put between them) */
const DEVICE_GAP = 70

/**
 * The layer inherits the arrangement of the base layer (through the supports): the devices (the nodes supported by one
 * node of the base layer) are at the positions of the base layer, and the connection points (the nodes supported by
 * two or more of them, e.g. the segments) are put between the devices they are linked to.
 * @returns undefined if the base layer does not fit the layer (it classifies few nodes)
 */
function arrangeByInheritance(
  nodes: readonly SchematicNode[],
  links: readonly Link[],
  base: SchematicBase,
): Arranged | undefined {
  const arranged = arrangeBase(base)
  if (!arranged) return undefined
  const { annotated, devices, connectors, hints, unclassifiedRow } = inheritAnnotations(nodes, base.lowerOf, {
    annotations: arranged.annotated.annotations,
    positions: arranged.positions,
    ...(arranged.connectors ? { connectors: arranged.connectors } : {}),
  })
  // the base layer does not fit this layer: it classifies few devices (or all the nodes are connection points)
  if (devices.length === 0 || annotated.unclassified.length * 2 > devices.length) return undefined
  // the order of the devices is the one of the base layer (the hints; no links are given: it is not changed)
  const slots = assignSlots(devices, annotated, [], { unclassifiedRow, hints })
  const placed = solvePositions(devices, slots, [], {
    initialX: hints,
    iterations: 0,
    nodeGap: DEVICE_GAP,
    pairGap: DEVICE_GAP,
  })
  const positions = addConnectionPoints(placed, connectors, links, radiusOf(nodes))
  return { positions, annotated, source: 'inherited', base: base.layer }
}

/**
 * Layout of a layer for network diagrams (the schematic engine):
 * annotate (meaning from the profile) -> slots (group / row / order) -> solve (coordinates).
 * The ways to give the meaning are tried in this order, and the first which fits the layer is used:
 * 1. the given profile (a profile which has `inherit` means the arrangement of that lower layer, see 2.),
 * 2. the arrangement of a lower layer through the supports (group / tier / order are inherited),
 * 3. the profile inferred from the names and the links of the layer,
 * 4. the stress layout.
 * What the layout was made from, and the exceptions, are reported.
 */
export function layoutSchematic(input: SchematicLayerInput): Promise<Positions> {
  const { layer, profile, nodes, links, report } = input
  const bases = input.bases ?? []
  const inheritFrom = profile?.inherit?.from
  const attempts: Array<() => Arranged | undefined> = []

  if (profile && inheritFrom === undefined) {
    attempts.push(() => {
      const arranged = arrangeByProfile(nodes, links, profile, bases.length === 0)
      return arranged && { ...arranged, source: 'profile' }
    })
  }
  // the lower layer which the profile names comes first; the others in the given order (the lowest layer first)
  const orderedBases = [
    ...bases.filter((b) => b.layer === inheritFrom),
    ...bases.filter((b) => b.layer !== inheritFrom),
  ]
  for (const base of orderedBases) attempts.push(() => arrangeByInheritance(nodes, links, base))
  if (profile && inheritFrom !== undefined) {
    attempts.push(() => {
      const arranged = arrangeByProfile(nodes, links, profile, bases.length === 0)
      return arranged && { ...arranged, source: 'profile' }
    })
  }
  attempts.push(() => {
    const inferred = inferProfile(nodes, links)
    const arranged = inferred && arrangeByProfile(nodes, links, inferred.profile)
    return arranged && inferred && { ...arranged, source: 'inferred', draft: inferred.yaml }
  })

  for (const attempt of attempts) {
    const arranged = attempt()
    if (!arranged) continue
    report?.({
      layer,
      source: arranged.source,
      violations: violationsOf(nodes, arranged.annotated, arranged.source),
      ...(arranged.base === undefined ? {} : { base: arranged.base }),
      ...(arranged.draft === undefined ? {} : { draft: arranged.draft }),
    })
    return Promise.resolve(arranged.positions)
  }

  report?.({ layer, source: 'none', violations: [] })
  return Promise.resolve(
    layoutWithStress(
      nodes.map((node) => ({ id: node.id, radius: node.radius })),
      links,
    ),
  )
}
