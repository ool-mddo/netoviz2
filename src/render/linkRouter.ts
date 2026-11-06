import type { Position } from './layout/types'

/** A circle which a link must not pass through: a node, or a port (term-point) on the circle of a node */
export interface Obstacle {
  /** ID of the node, or of the port */
  id: string
  x: number
  y: number
  radius: number
}

export interface RouteEnd {
  x: number
  y: number
  /** ID of the node (the obstacle of the node is not an obstacle of the link when the end is the node itself) */
  node: string
  /** ID of the port when the end is a port of the node (the obstacle of the port is not an obstacle of the link) */
  port?: string
  /** Radius of the node (the legs start at the center and leave the circle) */
  radius: number
  /** Direction from the node to the port (a unit vector), for a port: the link leaves along the nearest axis */
  outward?: Position
}

export interface RouteRequest {
  id: string
  from: RouteEnd
  to: RouteEnd
}

export interface RouterOptions {
  /** Space kept between a route and a circle */
  margin?: number
  /** A straight line is replaced by a route only if it comes within this of a circle (0: it overlaps) */
  touch?: number
  /** Distance from the ends (or the circles of the nodes) to the first lane */
  base?: number
  /** Distance between the lanes */
  laneGap?: number
  /** How many lanes it tries on each side */
  maxLanes?: number
  /** Largest distance between the legs of the links which leave a node on the same side */
  legGap?: number
  /** Length of the line which leaves a port before the link turns */
  stub?: number
  /** Cost of a corner (in the length): a route with fewer corners is preferred */
  cornerCost?: number
}

const DEFAULTS = {
  margin: 6,
  touch: 2,
  base: 14,
  laneGap: 12,
  maxLanes: 12,
  legGap: 6,
  stub: 8,
  cornerCost: 30,
}

/** A route may touch the margin of the node of a port which the link leaves, but it must not go into the circle */
const INSIDE = -1

/** Distance from the point to the segment */
function distanceToSegment(p: Position, a: Position, b: Position): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** A uniform grid of the circles, to look at the ones near a segment only */
class Grid {
  private readonly cells = new Map<string, Obstacle[]>()
  constructor(
    obstacles: readonly Obstacle[],
    private readonly size = 64,
  ) {
    for (const o of obstacles) {
      for (let x = Math.floor((o.x - o.radius) / size); x <= Math.floor((o.x + o.radius) / size); x++) {
        for (let y = Math.floor((o.y - o.radius) / size); y <= Math.floor((o.y + o.radius) / size); y++) {
          const key = `${x},${y}`
          const list = this.cells.get(key)
          if (list) list.push(o)
          else this.cells.set(key, [o])
        }
      }
    }
  }

  /** The circles in the cells of the box of the segment (with `pad` around it), each once */
  near(a: Position, b: Position, pad: number): Obstacle[] {
    const found: Obstacle[] = []
    const seen = new Set<Obstacle>()
    const x1 = Math.floor((Math.min(a.x, b.x) - pad) / this.size)
    const x2 = Math.floor((Math.max(a.x, b.x) + pad) / this.size)
    const y1 = Math.floor((Math.min(a.y, b.y) - pad) / this.size)
    const y2 = Math.floor((Math.max(a.y, b.y) + pad) / this.size)
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        for (const o of this.cells.get(`${x},${y}`) ?? []) {
          if (seen.has(o)) continue
          seen.add(o)
          found.push(o)
        }
      }
    }
    return found
  }
}

type Kind = 'L1' | 'L2' | 'H' | 'V'

/** A route of horizontal and vertical lines, from the point `a` to the point `b` (the offsets move the legs) */
function build(kind: Kind, lane: number, a: Position, b: Position, offsetA = 0, offsetB = 0): Position[] {
  switch (kind) {
    case 'L1': {
      // horizontal from a, then vertical to b
      const start = { x: a.x, y: a.y + offsetA }
      const end = { x: b.x + offsetB, y: b.y }
      return [start, { x: end.x, y: start.y }, end]
    }
    case 'L2': {
      // vertical from a, then horizontal to b
      const start = { x: a.x + offsetA, y: a.y }
      const end = { x: b.x, y: b.y + offsetB }
      return [start, { x: start.x, y: end.y }, end]
    }
    case 'H': {
      // vertical legs, and the part in the horizontal lane at y = lane
      const start = { x: a.x + offsetA, y: a.y }
      const end = { x: b.x + offsetB, y: b.y }
      return [start, { x: start.x, y: lane }, { x: end.x, y: lane }, end]
    }
    case 'V': {
      // horizontal legs, and the part in the vertical lane at x = lane
      const start = { x: a.x, y: a.y + offsetA }
      const end = { x: b.x, y: b.y + offsetB }
      return [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end]
    }
  }
}

/** Is the leg out of the end (a: the first point, b: the last point) of the route vertical? (the offset is in x then) */
const verticalLeg = (kind: Kind, end: 'a' | 'b'): boolean =>
  kind === 'H' || (kind === 'L2' && end === 'a') || (kind === 'L1' && end === 'b')

const lengthOf = (points: readonly Position[]) =>
  points.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y)),
    0,
  )

interface Candidate {
  kind: Kind
  lane: number
  points: Position[]
  cost: number
}

interface Section {
  horizontal: boolean
  /** y of a horizontal part, x of a vertical one */
  at: number
  lo: number
  hi: number
}

/** The part in the lane of a route (the middle part of the four points): the legs are apart by their own offsets */
function sectionOf(c: Candidate): Section | undefined {
  if (c.kind !== 'H' && c.kind !== 'V') return undefined
  const [p, q] = [c.points[1]!, c.points[2]!]
  return c.kind === 'H'
    ? { horizontal: true, at: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) }
    : { horizontal: false, at: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) }
}

/**
 * Routes of the links which a straight line passes through a node or a port: horizontal and vertical lines only (an
 * L, or a U/Z shape through a lane) for any positions of the ends. A port leaves the node along the nearest axis first.
 * A link which a straight line is clear for has no route (it stays straight).
 *
 * - the shorter links first (the inner lanes; the longer ones are nested outside), the upper/left side first;
 * - of the candidates the cheapest (the length and the corners) which is clear of all the nodes and ports (the ends
 *   themselves excepted) and whose part in the lane is apart from the parts in the lanes of the other links is used.
 *   Not to pass through nodes is more important than not to cross other links; if there is none, the one with the
 *   fewest circles on it is used;
 * - the node of a port at an end is not an obstacle for the margin, only for going into the circle (the port is on it);
 * - the legs of the links which leave a node (not a port) on the same side are apart from each other.
 *
 * @returns the points of the route by the ID of the request, from the first end to the second end, not including the
 *   two ends themselves: the first and the last are the starts of the legs (a point 8 from a port along an axis, or
 *   the center of a node moved by the offset of the leg)
 */
export function routeAround(
  requests: readonly RouteRequest[],
  obstacles: readonly Obstacle[],
  options: RouterOptions = {},
): Map<string, Position[]> {
  const { margin, touch, base, laneGap, maxLanes, legGap, stub, cornerCost } = { ...DEFAULTS, ...options }
  const grid = new Grid(obstacles)

  /**
   * How many circles (except the skipped ones) the polyline is within `clear` of (stops at `limit`). The circles of
   * `own` (the nodes of the ports at the ends) are only checked for going into them.
   */
  const hitsOf = (
    points: readonly Position[],
    skip: ReadonlySet<string>,
    own: ReadonlySet<string>,
    clear: number,
    limit = Number.POSITIVE_INFINITY,
  ): number => {
    let count = 0
    const hit = new Set<Obstacle>()
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, b] = [points[i]!, points[i + 1]!]
      for (const o of grid.near(a, b, Math.max(clear, 0) + 1)) {
        if (skip.has(o.id)) continue
        if (distanceToSegment(o, a, b) < o.radius + (own.has(o.id) ? INSIDE : clear) && !hit.has(o)) {
          hit.add(o)
          if (++count >= limit) return count
        }
      }
    }
    return count
  }
  const keyOf = (end: RouteEnd) => end.port ?? end.node
  /** The circles which are not obstacles of the link (the ends), and the nodes of the ports at the ends */
  const skipOf = (from: RouteEnd, to: RouteEnd) => new Set([keyOf(from), keyOf(to)])
  const ownOf = (from: RouteEnd, to: RouteEnd) =>
    new Set([from, to].flatMap((end) => (end.port ? [end.node] : [])))

  // The links to be routed: a straight line overlaps a circle.
  const blocked: Array<{
    request: RouteRequest
    swapped: boolean
    from: RouteEnd
    to: RouteEnd
    span: number
  }> = []
  for (const request of requests) {
    if (request.from.node === request.to.node) continue
    const swapped = keyOf(request.from) > keyOf(request.to)
    const [from, to] = swapped ? [request.to, request.from] : [request.from, request.to]
    if (hitsOf([from, to], skipOf(from, to), ownOf(from, to), touch, 1) === 0) continue
    blocked.push({ request, swapped, from, to, span: Math.hypot(to.x - from.x, to.y - from.y) })
  }
  blocked.sort((p, q) => p.span - q.span || (p.request.id < q.request.id ? -1 : 1))

  /** Where the legs start: a port leaves along the nearest axis; a node (not a port) from the center */
  const anchorOf = (end: RouteEnd): { point: Position; reach: number } => {
    if (!end.port || !end.outward) return { point: { x: end.x, y: end.y }, reach: end.radius }
    const horizontal = Math.abs(end.outward.x) >= Math.abs(end.outward.y)
    const direction = horizontal
      ? { x: Math.sign(end.outward.x) || 1, y: 0 }
      : { x: 0, y: Math.sign(end.outward.y) || 1 }
    return { point: { x: end.x + direction.x * stub, y: end.y + direction.y * stub }, reach: 0 }
  }

  const sections: Section[] = []
  interface Chosen {
    request: RouteRequest
    swapped: boolean
    from: RouteEnd
    to: RouteEnd
    candidate: Candidate
    hits: number
  }
  const chosen: Chosen[] = []
  for (const { request, swapped, from, to } of blocked) {
    const [skip, own] = [skipOf(from, to), ownOf(from, to)]
    const [ea, eb] = [anchorOf(from), anchorOf(to)]
    const [a, b] = [ea.point, eb.point]
    const candidates: Candidate[] = []
    const add = (kind: Kind, lane: number) => {
      const points = build(kind, lane, a, b)
      candidates.push({ kind, lane, points, cost: lengthOf(points) + cornerCost * (points.length - 2) })
    }
    add('L1', 0)
    add('L2', 0)
    for (let k = 0; k < maxLanes; k++) {
      add('H', Math.min(a.y - ea.reach, b.y - eb.reach) - base - k * laneGap) // over
      add('H', Math.max(a.y + ea.reach, b.y + eb.reach) + base + k * laneGap) // under
      add('V', Math.min(a.x - ea.reach, b.x - eb.reach) - base - k * laneGap) // left
      add('V', Math.max(a.x + ea.reach, b.x + eb.reach) + base + k * laneGap) // right
    }
    add('H', (a.y + b.y) / 2)
    add('V', (a.x + b.x) / 2)
    candidates.sort((p, q) => p.cost - q.cost) // (a stable sort: the upper/left first for the same cost)

    // The first candidate with no circle and no conflict; otherwise the fewest circles, then no conflict
    let best: { candidate: Candidate; hits: number; conflict: boolean } | undefined
    for (const candidate of candidates) {
      const section = sectionOf(candidate)
      const conflict =
        !!section &&
        sections.some(
          (o) =>
            o.horizontal === section.horizontal &&
            Math.abs(o.at - section.at) < laneGap * 0.9 &&
            o.lo <= section.hi &&
            section.lo <= o.hi,
        )
      const hits = hitsOf(
        candidate.points,
        skip,
        own,
        margin,
        best ? best.hits + 1 : Number.POSITIVE_INFINITY,
      )
      if (!best || hits < best.hits || (hits === best.hits && best.conflict && !conflict)) {
        best = { candidate, hits, conflict }
      }
      if (hits === 0 && !conflict) break
    }
    if (!best) continue
    const section = sectionOf(best.candidate)
    if (section) sections.push(section)
    chosen.push({ request, swapped, from, to, candidate: best.candidate, hits: best.hits })
  }

  // The legs: the links which leave a node (not a port) on the same side are apart from each other. The ones which go
  // to one side are at that side of the center, and the farther the other end is, the nearer to the center the leg is
  // (so the legs of the outer lanes do not cross the inner lanes).
  const legOffsets = new Map<string, number>() // `${request}|a or b` -> offset (along x for a vertical leg, y for a horizontal)
  const groups = new Map<string, Array<{ id: string; distance: number; radius: number; sign: number }>>()
  for (const { request, from, to, candidate } of chosen) {
    const [first, second] = [candidate.points[0]!, candidate.points[1]!]
    const [last, previous] = [candidate.points.at(-1)!, candidate.points.at(-2)!]
    for (const [end, other, point, next, id] of [
      [from, to, first, second, 'a'],
      [to, from, last, previous, 'b'],
    ] as const) {
      if (end.port) continue
      const vertical = verticalLeg(candidate.kind, id)
      const direction = (vertical ? next.y - point.y : next.x - point.x) >= 0 ? 1 : -1
      const sign = (vertical ? other.x - end.x : other.y - end.y) >= 0 ? 1 : -1
      const key = `${end.node}|${vertical ? 'v' : 'h'}${direction}|${sign}`
      const group = groups.get(key) ?? []
      group.push({
        id: `${request.id}|${id}`,
        distance: Math.hypot(other.x - end.x, other.y - end.y),
        radius: end.radius,
        sign,
      })
      groups.set(key, group)
    }
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue // a leg of its own stays at the center
    group.sort((p, q) => q.distance - p.distance || (p.id < q.id ? -1 : 1))
    const gap = Math.min(legGap, (0.8 * group[0]!.radius) / group.length)
    group.forEach(({ id, sign }, i) => legOffsets.set(id, sign * gap * (i + 1)))
  }

  const routes = new Map<string, Position[]>()
  for (const { request, swapped, from, to, candidate, hits } of chosen) {
    const [skip, own] = [skipOf(from, to), ownOf(from, to)]
    const [ea, eb] = [anchorOf(from), anchorOf(to)]
    const shifted = build(
      candidate.kind,
      candidate.lane,
      ea.point,
      eb.point,
      legOffsets.get(`${request.id}|a`) ?? 0,
      legOffsets.get(`${request.id}|b`) ?? 0,
    )
    // (the legs were checked at the centers: if the shifted ones are on a circle, the legs stay at the centers)
    const points = hits > 0 || hitsOf(shifted, skip, own, margin, 1) === 0 ? shifted : candidate.points
    routes.set(request.id, swapped ? [...points].reverse() : points)
  }
  return routes
}
