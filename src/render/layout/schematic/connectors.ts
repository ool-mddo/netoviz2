import type { Position, Positions } from '../types'

export interface Connector {
  id: string
  radius: number
}

export interface PlaceOptions {
  /** Space kept between the circles of nodes, and between a link and a node */
  margin?: number
  /** Step of moving a connection point away from the centroid */
  step?: number
  /** How many steps it is moved at most */
  maxSteps?: number
}

const DEFAULTS = { margin: 10, step: 24, maxSteps: 40 }

/** Distance from the point to the segment */
function distanceToSegment(p: Position, a: Position, b: Position): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** The direction with y < 0 (x > 0 for a horizontal one): the same line gets the same direction */
function upward(d: Position): Position {
  return d.y > 0 || (d.y === 0 && d.x < 0) ? { x: -d.x, y: -d.y } : d
}

/**
 * Put the connection points (nodes which join the devices, e.g. L3 segments) between the devices they are linked to.
 * The devices are arranged first and not moved: a connection point is not a subject of the layout.
 *
 * A connection point is put at the centroid of the devices it is linked to. If it overlaps a node, if a link to a
 * device passes through another node, or if it is on a link which is already drawn, it is moved away from the
 * centroid, perpendicular to the line between two devices (upward first: a link between devices in a row goes over
 * the row), or vertically for three or more devices. The nearest position which breaks nothing is used. If there is
 * none within `maxSteps`, the position which breaks the least (the nearest of them) is used.
 * The ones which join closer devices are put first, so the longer links which go over them are nested outside.
 *
 * @param links links of the layer (the ones with a connection point, and between the devices, are used)
 * @param placed positions of the devices (the nodes which are already placed)
 * @returns positions of the connection points which are linked to a placed node (the others are not in the result)
 */
export function placeConnectors(
  connectors: readonly Connector[],
  links: ReadonlyArray<{ source: string; target: string }>,
  placed: Positions,
  radiusOf: (id: string) => number,
  options: PlaceOptions = {},
): Positions {
  const { margin, step, maxSteps } = { ...DEFAULTS, ...options }
  const result: Positions = new Map()
  const all = new Map(placed)
  const connectorRadius = new Map(connectors.map((c) => [c.id, c.radius]))
  const radius = (id: string) => connectorRadius.get(id) ?? radiusOf(id)

  // lines which are already drawn: the links between the devices, and then the links of the connection points placed
  const drawn: Array<[Position, Position]> = []
  const neighbors = new Map<string, Set<string>>()
  for (const { source, target } of links) {
    if (source === target) continue
    const [a, b] = [placed.get(source), placed.get(target)]
    if (a && b) drawn.push([a, b])
    for (const [x, y] of [
      [source, target],
      [target, source],
    ] as const) {
      if (!connectorRadius.has(x)) continue
      const set = neighbors.get(x) ?? new Set<string>()
      set.add(y)
      neighbors.set(x, set)
    }
  }
  // the devices a connection point is linked to (connection points linked to each other are not used)
  const targetsOf = new Map(
    connectors.map((c) => [c.id, [...(neighbors.get(c.id) ?? [])].filter((id) => placed.has(id)).sort()]),
  )

  const spanOf = new Map<string, number>()
  for (const [id, targets] of targetsOf) {
    let span = 0
    for (const a of targets) {
      for (const b of targets) {
        const [p, q] = [placed.get(a)!, placed.get(b)!]
        span = Math.max(span, Math.hypot(p.x - q.x, p.y - q.y))
      }
    }
    spanOf.set(id, span)
  }
  const order = [...connectors].sort(
    (a, b) =>
      (spanOf.get(a.id) ?? 0) - (spanOf.get(b.id) ?? 0) ||
      (targetsOf.get(a.id)?.length ?? 0) - (targetsOf.get(b.id)?.length ?? 0) ||
      (a.id < b.id ? -1 : 1),
  )

  for (const connector of order) {
    const targets = targetsOf.get(connector.id) ?? []
    if (targets.length === 0) continue
    const points = targets.map((id) => placed.get(id)!)
    const centroid = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    }

    /** How many things the position breaks (stops counting at `limit`) */
    const violations = (p: Position, limit: number): number => {
      let count = 0
      for (const [id, q] of all) {
        if (Math.hypot(p.x - q.x, p.y - q.y) < connector.radius + radius(id) + margin && ++count >= limit)
          return count
      }
      for (const [a, b] of drawn) {
        if (distanceToSegment(p, a, b) < connector.radius + margin && ++count >= limit) return count
      }
      for (const target of points) {
        for (const [id, q] of all) {
          if (q === target) continue
          if (distanceToSegment(q, p, target) < radius(id) + margin && ++count >= limit) return count
        }
      }
      return count
    }

    // the directions to move: perpendicular to the line (upward first) and then along it, or vertical for 3 or more
    let normal: Position = { x: 0, y: -1 }
    let tangent: Position = { x: 1, y: 0 }
    if (points.length === 2) {
      const [a, b] = points as [Position, Position]
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length > 0) {
        tangent = upward({ x: (b.x - a.x) / length, y: (b.y - a.y) / length })
        normal = upward({ x: tangent.y, y: -tangent.x })
      }
    }
    const directions = [normal, { x: -normal.x, y: -normal.y }, tangent, { x: -tangent.x, y: -tangent.y }]

    let best = { position: centroid, count: violations(centroid, Number.POSITIVE_INFINITY) }
    for (let n = 1; best.count > 0 && n <= maxSteps; n++) {
      for (const d of directions) {
        const p = { x: centroid.x + d.x * step * n, y: centroid.y + d.y * step * n }
        const count = violations(p, best.count) // not better than the best: it stops counting
        if (count < best.count) best = { position: p, count }
        if (best.count === 0) break
      }
    }
    result.set(connector.id, best.position)
    all.set(connector.id, best.position)
    for (const point of points) drawn.push([best.position, point])
  }
  return result
}
