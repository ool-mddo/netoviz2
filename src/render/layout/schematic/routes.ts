import type { Position, Positions } from '../types'

export interface RouteNode {
  id: string
  radius: number
}

/** Waypoints of a link by the key of the pair of its nodes (see routeKey): from the node of the smaller ID */
export type Routes = Map<string, Position[]>

export interface RouteOptions {
  /** Space kept between a node and a link */
  margin?: number
  /** Distance from the circles of the row to the first lane */
  base?: number
  /** Distance between the lanes */
  laneGap?: number
  /** How many lanes it tries on each side of a row */
  maxLanes?: number
  /** Largest distance between the legs of the links which leave a node on the same side */
  legGap?: number
}

const DEFAULTS = { margin: 8, base: 16, laneGap: 12, maxLanes: 12, legGap: 6 }
/** The row of a y: the nodes with the same value are in the same row (the arrangement is on a grid) */
const rowOf = (y: number): number => Math.round(y)

/** Key of the pair of the nodes of a link (the same for both directions) */
export function routeKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`
}

/** Distance from the point to the segment */
function distanceToSegment(p: Position, a: Position, b: Position): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

interface Placed extends RouteNode {
  x: number
  y: number
}

interface Assigned {
  a: Placed
  b: Placed
  side: -1 | 1
  /** y of the lane */
  laneY: number
}

/**
 * Routes of the links which a straight line passes through another node: the links between the nodes in a row, with
 * a node between them. They go over (or under) the row, through a lane: a vertical leg from the node, a horizontal
 * part in the lane, and a vertical leg to the other node. Shorter links are in the inner lanes (the longer ones are
 * outside: nested), the links which overlap in x are in different lanes, and the links which leave a node on the same
 * side have the legs apart from each other.
 *
 * Not to pass through nodes is more important than not to cross the other links: a lane is used only if the route
 * is clear of all the nodes (and it is the nearest lane of the row, the upper side first, of the free ones).
 *
 * @returns the waypoints (not the ends, which are at the nodes) of the links which need a route
 */
export function routeLinks(
  nodes: readonly RouteNode[],
  links: ReadonlyArray<{ source: string; target: string }>,
  positions: Positions,
  options: RouteOptions = {},
): Routes {
  const { margin, base, laneGap, maxLanes, legGap } = { ...DEFAULTS, ...options }
  const placed = new Map<string, Placed>()
  for (const node of nodes) {
    const p = positions.get(node.id)
    if (p) placed.set(node.id, { ...node, x: p.x, y: p.y })
  }
  const all = [...placed.values()]

  /** Is a node (except the ends) within the margin of the segment? */
  const blocked = (p: Position, q: Position, ends: readonly string[]): boolean =>
    all.some((n) => !ends.includes(n.id) && distanceToSegment(n, p, q) < n.radius + margin)

  // the links to be routed: between nodes in a row, with a node on the straight line
  const seen = new Set<string>()
  const pairs: Array<[Placed, Placed]> = []
  for (const { source, target } of links) {
    const [a, b] = [placed.get(source), placed.get(target)]
    if (!a || !b || a === b || rowOf(a.y) !== rowOf(b.y)) continue
    const key = routeKey(a.id, b.id)
    if (seen.has(key) || !blocked(a, b, [a.id, b.id])) continue
    seen.add(key)
    pairs.push(a.id < b.id ? [a, b] : [b, a])
  }
  // the shorter first (the inner lanes), then by the key
  pairs.sort(
    (p, q) =>
      Math.abs(p[0].x - p[1].x) - Math.abs(q[0].x - q[1].x) ||
      (routeKey(p[0].id, p[1].id) < routeKey(q[0].id, q[1].id) ? -1 : 1),
  )

  // lanes: for each side of each row, the x ranges in the lanes. And all the horizontal parts which are drawn (the lane of
  // a row can be at the same y as one of the next row: the parts must not overlap)
  const lanes = new Map<string, Array<Array<[number, number]>>>()
  const sections: Array<{ y: number; lo: number; hi: number }> = []
  const radiusOfRow = new Map<number, number>()
  for (const n of all) radiusOfRow.set(rowOf(n.y), Math.max(radiusOfRow.get(rowOf(n.y)) ?? 0, n.radius))
  const assigned: Assigned[] = []
  for (const [a, b] of pairs) {
    const rowRadius = radiusOfRow.get(rowOf(a.y)) ?? a.radius
    const [lo, hi] = a.x < b.x ? [a.x, b.x] : [b.x, a.x]
    let found: (Assigned & { lane: number }) | undefined
    for (let lane = 0; lane < maxLanes && !found; lane++) {
      for (const side of [-1, 1] as const) {
        const rows = lanes.get(`${rowOf(a.y)}|${side}`)
        const laneY = a.y + side * (rowRadius + base + lane * laneGap)
        // the x range overlaps one in the lane (the ends of the links at a node are close: with the margin)
        if (rows?.[lane]?.some(([l, h]) => l <= hi + margin && lo <= h + margin)) continue
        // or a part which is drawn at the same y (the lane of the next row)
        if (
          sections.some(
            (o) => Math.abs(o.y - laneY) < laneGap / 2 && o.lo <= hi + margin && lo <= o.hi + margin,
          )
        )
          continue
        const [pa, pb] = [
          { x: a.x, y: laneY },
          { x: b.x, y: laneY },
        ]
        // the route is clear of all the nodes: the two legs and the part in the lane
        const ends = [a.id, b.id]
        if (blocked(a, pa, ends) || blocked(pa, pb, ends) || blocked(pb, b, ends)) continue
        found = { a, b, side, laneY, lane }
        break
      }
    }
    if (!found) continue // no free lane: the link stays straight
    const key = `${rowOf(a.y)}|${found.side}`
    const rows = lanes.get(key) ?? []
    const inLane = rows[found.lane] ?? []
    inLane.push([lo, hi])
    rows[found.lane] = inLane
    lanes.set(key, rows)
    sections.push({ y: found.laneY, lo, hi })
    assigned.push({ a, b, side: found.side, laneY: found.laneY })
  }

  // the legs: the links which leave a node on the same side are apart from each other. The ones to the left are at
  // the left of the center and the ones to the right at the right; the farther the other end is, the nearer to the
  // center the leg is (so the legs of the outer lanes do not cross the inner lanes).
  const legOffset = new Map<string, number>() // `${routeKey}|${node}` -> x offset
  const legGroups = new Map<string, Array<{ route: string; node: Placed; other: Placed }>>()
  for (const { a, b, side } of assigned) {
    const route = routeKey(a.id, b.id)
    for (const [node, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const key = `${node.id}|${side}|${other.x < node.x ? 'left' : 'right'}`
      const group = legGroups.get(key) ?? []
      group.push({ route, node, other })
      legGroups.set(key, group)
    }
  }
  for (const [key, group] of legGroups) {
    const direction = key.endsWith('|left') ? -1 : 1
    group.sort(
      (p, q) =>
        Math.abs(q.other.x - q.node.x) - Math.abs(p.other.x - p.node.x) || (p.route < q.route ? -1 : 1),
    )
    const node = group[0]!.node
    // (both groups at a node are the same distance: the legs stay inside the circle)
    const gap = Math.min(legGap, (0.8 * node.radius) / group.length)
    group.forEach(({ route }, i) => legOffset.set(`${route}|${node.id}`, direction * gap * (i + 1)))
  }

  const routes: Routes = new Map()
  for (const { a, b, side, laneY } of assigned) {
    const route = routeKey(a.id, b.id)
    const waypoints = (offsetA: number, offsetB: number): Position[] => [
      { x: a.x + offsetA, y: a.y + side * a.radius },
      { x: a.x + offsetA, y: laneY },
      { x: b.x + offsetB, y: laneY },
      { x: b.x + offsetB, y: b.y + side * b.radius },
    ]
    const shifted = waypoints(legOffset.get(`${route}|${a.id}`) ?? 0, legOffset.get(`${route}|${b.id}`) ?? 0)
    // the legs were checked at the centers: if the shifted ones are on a node, the legs stay at the centers
    const line = [a, ...shifted, b]
    const hits = line.some((p, i) => i + 1 < line.length && blocked(p, line[i + 1]!, [a.id, b.id]))
    routes.set(route, hits ? waypoints(0, 0) : shifted)
  }
  return routes
}
