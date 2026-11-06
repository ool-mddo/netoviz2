import { describe, expect, it } from 'vitest'
import type { Position } from './layout/types'
import { routeAround, type Obstacle, type RouteEnd, type RouteRequest } from './linkRouter'

const R = 11
const PORT = 4.5
const circle = (id: string, x: number, y: number, radius = R): Obstacle => ({ id, x, y, radius })
const nodeEnd = (o: Obstacle): RouteEnd => ({ x: o.x, y: o.y, node: o.id, radius: o.radius })
const request = (id: string, a: Obstacle, b: Obstacle): RouteRequest => ({
  id,
  from: nodeEnd(a),
  to: nodeEnd(b),
})
const distance = (p: Position, a: Position, b: Position) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
/** Every part of the polyline is horizontal or vertical */
const orthogonal = (line: Position[]) =>
  line.slice(1).every((p, i) => Math.abs(p.x - line[i]!.x) < 1e-9 || Math.abs(p.y - line[i]!.y) < 1e-9)
/** The nearest distance (beyond the radius) of the polyline to the circles except the ends */
const clearance = (line: Position[], obstacles: Obstacle[], skip: string[]) =>
  Math.min(
    ...obstacles
      .filter((o) => !skip.includes(o.id))
      .map((o) => Math.min(...line.slice(1).map((p, i) => distance(o, line[i]!, p))) - o.radius),
  )

describe('routeAround (nodes: the ends are the centers of the nodes)', () => {
  const [a, b, c, d] = [circle('a', 0, 0), circle('b', 100, 0), circle('c', 200, 0), circle('d', 300, 0)]
  const all = [a, b, c, d]
  const route = (requests: RouteRequest[], obstacles = all, options = {}) =>
    routeAround(requests, obstacles, options)

  it('gives no route to a link which a straight line does not pass through a circle', () => {
    expect(route([request('ab', a, b), request('bc', b, c)]).size).toBe(0)
  })

  it('goes over the row for a link in a row with a node between (the upper side first)', () => {
    const routes = route([request('ac', a, c)])
    const points = routes.get('ac')!
    expect(points).toHaveLength(4)
    expect(points[1]!.y).toBeLessThan(0)
    expect(points[1]!.y).toBe(points[2]!.y)
    expect(clearance([a, ...points, c], all, ['a', 'c'])).toBeGreaterThanOrEqual(6)
    expect(orthogonal([a, ...points, c])).toBe(true)
  })

  it('goes around a node for a link which is not in a row: horizontal and vertical lines only (any direction of the link)', () => {
    const p = circle('p', 0, 0)
    const q = circle('q', 200, 200)
    const mid = circle('m', 100, 100)
    const routes = route([request('pq', p, q)], [p, q, mid])
    const points = routes.get('pq')!
    expect(clearance([p, ...points, q], [p, q, mid], ['p', 'q'])).toBeGreaterThanOrEqual(6)
    expect(orthogonal([p, ...points, q])).toBe(true)
    // one corner is enough: an L, not a detour through a lane
    expect(points).toHaveLength(3)
  })

  it('has only horizontal and vertical lines also when the ends are not in a row nor a column, with several nodes between', () => {
    const p = circle('p', 0, 0)
    const q = circle('q', 300, 130)
    const between = [circle('m1', 100, 40), circle('m2', 200, 90), circle('m3', 150, 65)]
    const obstacles = [p, q, ...between]
    const points = route([request('pq', p, q)], obstacles).get('pq')!
    expect(orthogonal([p, ...points, q])).toBe(true)
    expect(clearance([p, ...points, q], obstacles, ['p', 'q'])).toBeGreaterThanOrEqual(6)
  })

  it('leaves the link straight when the circle only comes near the line (no overlap)', () => {
    // b is 6 off the line a - c: the circle (11) overlaps it, but at 20 (a gap of 9 from the circle) it is only near
    const near = circle('n', 100, 20)
    expect(route([request('ac', a, c)], [a, near, c]).size).toBe(0)
    const over = circle('o', 100, 6)
    expect(route([request('ac', a, c)], [a, over, c]).size).toBe(1)
  })

  it('has the same route for the link in the reverse direction', () => {
    const forward = route([request('ac', a, c)]).get('ac')!
    const reverse = route([request('ca', c, a)]).get('ca')!
    expect(reverse).toEqual([...forward].reverse())
  })

  it('puts the longer link outside (nested) when the links share a node and overlap, on the same side', () => {
    const below = circle('w', 150, 30) // the lanes of the lower side are on it
    const routes = route([request('ac', a, c), request('ad', a, d)], [...all, below])
    const [ac, ad] = [routes.get('ac')!, routes.get('ad')!]
    expect(Math.sign(ac[1]!.y)).toBe(Math.sign(ad[1]!.y))
    expect(Math.abs(ad[1]!.y)).toBeGreaterThan(Math.abs(ac[1]!.y))
  })

  it('uses the lower side when the upper lane is taken and the lower side is free', () => {
    const routes = route([request('ac', a, c), request('ad', a, d)])
    expect(Math.sign(routes.get('ac')![1]!.y)).not.toBe(Math.sign(routes.get('ad')![1]!.y))
  })

  it('puts the links which do not overlap in the same lane, and the ones which overlap in different lanes', () => {
    const row = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => circle(id, i * 100, 0))
    const by = (id: string) => row.find((o) => o.id === id)!
    const routes = route(
      [request('ac', by('a'), by('c')), request('df', by('d'), by('f')), request('be', by('b'), by('e'))],
      row,
    )
    const laneY = (id: string) => routes.get(id)![1]!.y
    expect(laneY('ac')).toBe(laneY('df'))
    expect(laneY('be')).not.toBe(laneY('ac'))
  })

  it('keeps the legs of the links which leave a node on the same side apart: the outer lane is nearer to the center', () => {
    const below = circle('w', 150, 30)
    const routes = route([request('ac', a, c), request('ad', a, d)], [...all, below])
    const [ac, ad] = [routes.get('ac')!, routes.get('ad')!]
    expect(ac[0]!.x).not.toBe(ad[0]!.x)
    expect(ad[0]!.x).toBeGreaterThan(0)
    expect(ad[0]!.x).toBeLessThan(ac[0]!.x)
    expect(Math.abs(ac[0]!.x)).toBeLessThan(R)
  })

  it('is deterministic and independent of the order of the requests', () => {
    const requests = [request('ac', a, c), request('ad', a, d), request('bd', b, d)]
    const first = route(requests)
    const second = route([...requests].reverse())
    expect([...second].sort()).toEqual([...first].sort())
  })

  it('does not route a link of a node to itself', () => {
    expect(route([request('aa', a, a)]).size).toBe(0)
  })
})

describe('routeAround (ports: the ends are the ports on the circles of the nodes)', () => {
  /** A port of the node at the angle (the radius of the node is 30) */
  const port = (node: Obstacle, angle: number, id: string): { obstacle: Obstacle; end: RouteEnd } => {
    const outward = { x: Math.cos(angle), y: Math.sin(angle) }
    const x = node.x + outward.x * node.radius
    const y = node.y + outward.y * node.radius
    return {
      obstacle: { id, x, y, radius: PORT },
      end: { x, y, node: node.id, port: id, radius: node.radius, outward },
    }
  }
  const [na, nb, nc] = [circle('na', 0, 0, 30), circle('nb', 200, 0, 30), circle('nc', 400, 0, 30)]

  it('leaves the port along the nearest axis first (horizontal or vertical), and goes around the node between', () => {
    const pa = port(na, -Math.PI / 3, 'pa') // mostly up (more up than right)
    const pc = port(nc, (-5 * Math.PI) / 6, 'pc') // mostly left (more left than up)
    const obstacles = [na, nb, nc, pa.obstacle, pc.obstacle]
    const points = routeAround([{ id: 'l', from: pa.end, to: pc.end }], obstacles).get('l')!
    // the first point is 8 straight up from the port a: the stub is vertical, not along the radius of the node
    expect(points[0]!.x).toBeCloseTo(pa.end.x, 6)
    expect(points[0]!.y).toBeCloseTo(pa.end.y - 8, 6)
    // the port c leaves horizontally, to the left (the side of its outward)
    expect(points.at(-1)!.y).toBeCloseTo(pc.end.y, 6)
    expect(points.at(-1)!.x).toBeCloseTo(pc.end.x - 8, 6)
    expect(orthogonal([pa.end, ...points, pc.end])).toBe(true)
    expect(clearance(points, obstacles, ['pa', 'pc'])).toBeGreaterThanOrEqual(6 - 1e-6)
  })

  it('leaves the link between ports straight when a straight line is clear (the node of the port is not in the way)', () => {
    // the ports face each other: the line between them is clear, although it starts on the circle of the node
    const pa = port(na, 0, 'pa')
    const pc = port(nb, Math.PI, 'pc')
    expect(
      routeAround([{ id: 'l', from: pa.end, to: pc.end }], [na, nb, pa.obstacle, pc.obstacle]).size,
    ).toBe(0)
  })

  it('does not pass under the other ports (the ports are obstacles)', () => {
    const pa = port(na, 0, 'pa')
    const pc = port(nc, Math.PI, 'pc')
    // the ports of nb: on the line between pa and pc
    const p1 = port(nb, Math.PI, 'p1')
    const p2 = port(nb, 0, 'p2')
    const obstacles = [na, nb, nc, pa.obstacle, pc.obstacle, p1.obstacle, p2.obstacle]
    const points = routeAround([{ id: 'l', from: pa.end, to: pc.end }], obstacles).get('l')!
    expect(clearance(points, obstacles, ['pa', 'pc'])).toBeGreaterThanOrEqual(6 - 1e-6)
    expect(orthogonal([pa.end, ...points, pc.end])).toBe(true)
  })

  it('avoids a port of the end node itself (the legs do not go through the ports near the port)', () => {
    const pa = port(na, -0.1, 'pa')
    const neighbor = port(na, -0.5, 'pn') // 12 from pa on the circle, up
    const pc = port(nc, Math.PI, 'pc')
    const obstacles = [na, nb, nc, pa.obstacle, neighbor.obstacle, pc.obstacle]
    const points = routeAround([{ id: 'l', from: pa.end, to: pc.end }], obstacles).get('l')!
    expect(clearance(points, obstacles, ['pa', 'pc'])).toBeGreaterThanOrEqual(6 - 1e-6)
  })
})

describe('routeAround (ports: the node of the port, and the ports near the route)', () => {
  const port = (node: Obstacle, angle: number, id: string): { obstacle: Obstacle; end: RouteEnd } => {
    const outward = { x: Math.cos(angle), y: Math.sin(angle) }
    const x = node.x + outward.x * node.radius
    const y = node.y + outward.y * node.radius
    return {
      obstacle: { id, x, y, radius: PORT },
      end: { x, y, node: node.id, port: id, radius: node.radius, outward },
    }
  }

  it('checks every part of a route against the circles (a circle near the first part is also checked for the others)', () => {
    // from a port at the bottom of n3 to a port at the right of n2: an L through the row of the ports of n2 is not clear
    const n3 = circle('n3', 260, 520, 20)
    const n2 = circle('n2', 780, 520, 20)
    const from = { x: 255, y: 539, node: 'n3', port: 'n3p1', radius: 20, outward: { x: -0.26, y: 0.97 } }
    const to = { x: 800, y: 524, node: 'n2', port: 'n2p0', radius: 20, outward: { x: 0.98, y: 0.18 } }
    const ports = [
      circle('n3p1', 255, 539, PORT),
      circle('n2p0', 800, 524, PORT),
      circle('n2p1', 775, 539, PORT),
      circle('n2p2', 760, 519, PORT),
      circle('n2p3', 787, 501, PORT),
    ]
    const obstacles = [n3, n2, ...ports]
    const points = routeAround([{ id: 'l', from, to }], obstacles).get('l')!
    expect(clearance(points, obstacles, ['n3p1', 'n2p0', 'n3', 'n2'])).toBeGreaterThanOrEqual(6 - 1e-6)
    expect(orthogonal([from, ...points, to])).toBe(true)
  })

  it('finds a route without a circle for a large node whose port is at 45 degrees (the stub is not in the margin)', () => {
    const big = circle('big', 0, 0, 100)
    const target = circle('t', 500, -70)
    const blocker = circle('m', 250, -70)
    const from = port(big, -0.75, 'p') // up and right
    const obstacles = [big, target, blocker, from.obstacle]
    const points = routeAround([{ id: 'l', from: from.end, to: nodeEnd(target) }], obstacles).get('l')!
    expect(clearance(points, obstacles, ['p', 't', 'big'])).toBeGreaterThanOrEqual(6 - 1e-6)
    // it does not go into the circle of the large node (the route may touch the margin of it)
    expect(clearance(points, [big], [])).toBeGreaterThanOrEqual(-1 - 1e-6)
    // and it is an L, or a short detour, not around the outermost lane of the node
    expect(points.length).toBeLessThanOrEqual(4)
  })

  it('goes around the own node when a straight line from the port passes through it (the port faces away)', () => {
    const [na, nb] = [circle('na', 0, 0, 30), circle('nb', 300, 0, 30)]
    const pa = port(na, Math.PI, 'pa') // the left side of na, but nb is at the right
    const pb = port(nb, 0, 'pb') // the right side of nb
    const obstacles = [na, nb, pa.obstacle, pb.obstacle]
    const routes = routeAround([{ id: 'l', from: pa.end, to: pb.end }], obstacles)
    const points = routes.get('l')!
    expect(points).toBeDefined()
    // the route does not go into either node
    expect(clearance(points, [na, nb], [])).toBeGreaterThanOrEqual(-1 - 1e-6)
    expect(orthogonal([pa.end, ...points, pb.end])).toBe(true)
  })

  it('moves a leg only when several links leave a node on the same side (a leg of its own stays at the center)', () => {
    const [a, b, c] = [circle('a', 0, 0), circle('b', 100, 0), circle('c', 200, 0)]
    const routes = routeAround([{ id: 'ac', from: nodeEnd(a), to: nodeEnd(c) }], [a, b, c])
    const points = routes.get('ac')!
    expect(points[0]!.x).toBe(0)
    expect(points.at(-1)!.x).toBe(200)
  })
})

describe('routeAround (many arrangements: a seeded random)', () => {
  const random = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  /**
   * Arrangements of nodes on a grid with ports; the routes of 6 links. For every route: it is horizontal and vertical
   * only, and it is clear of the circles (the ends excepted) or the circles it is not clear of are counted.
   */
  function run(seeds: number, spacing: number, columns: number) {
    let clear = 0
    let hit = 0
    for (let seed = 1; seed <= seeds; seed++) {
      const next = random(seed)
      const nodes: Obstacle[] = []
      const obstacles: Obstacle[] = []
      const ends = new Map<string, RouteEnd[]>()
      for (let i = 0; i < 4 + Math.floor(next() * 5); i++) {
        const radius = [11, 20, 30, 40][Math.floor(next() * 4)]!
        const node = circle(
          `n${i}`,
          Math.round(next() * columns) * spacing,
          Math.round(next() * 2) * spacing,
          radius,
        )
        if (nodes.some((o) => Math.hypot(o.x - node.x, o.y - node.y) < 70)) continue
        nodes.push(node)
        obstacles.push(node)
        // (a node is collapsed (the links end at the node) or expanded (they end at the ports), not both)
        const list: RouteEnd[] = radius > 11 ? [] : [nodeEnd(node)]
        if (radius > 11) {
          for (let k = 0; k < 4; k++) {
            const angle = (k * Math.PI) / 2 + next() * 0.5 // (the ports of a node are apart from each other: 14px or more)
            const outward = { x: Math.cos(angle), y: Math.sin(angle) }
            const p = {
              id: `${node.id}p${k}`,
              x: node.x + outward.x * radius,
              y: node.y + outward.y * radius,
              radius: PORT,
            }
            obstacles.push(p)
            list.push({ x: p.x, y: p.y, node: node.id, port: p.id, radius, outward })
          }
        }
        ends.set(node.id, list)
      }
      const requests: RouteRequest[] = []
      for (let k = 0; k < 6; k++) {
        const [a, b] = [nodes[Math.floor(next() * nodes.length)], nodes[Math.floor(next() * nodes.length)]]
        if (!a || !b || a === b) continue
        const pick = (id: string) => ends.get(id)![Math.floor(next() * ends.get(id)!.length)]!
        requests.push({ id: `r${k}`, from: pick(a.id), to: pick(b.id) })
      }
      for (const [id, points] of routeAround(requests, obstacles)) {
        const req = requests.find((r) => r.id === id)!
        expect(
          orthogonal([req.from, ...points, req.to]),
          `seed ${seed}: ${id} is horizontal and vertical only`,
        ).toBe(true)
        const skip = [req.from.port ?? req.from.node, req.to.port ?? req.to.node]
        // (the node of a port at an end: the route may touch its margin but must not go into the circle)
        const own = [req.from, req.to].flatMap((end) => (end.port ? [end.node] : []))
        const worst = clearance(points, obstacles, [...skip, ...own])
        const inside = own.every(
          (node) =>
            clearance(
              points,
              obstacles.filter((o) => o.id === node),
              [],
            ) >=
            -1 - 1e-6,
        )
        if (worst >= 6 - 1e-6 && inside) clear++
        else hit++
      }
    }
    return { clear, hit }
  }

  it('the routes are clear of the nodes and the ports (a margin of 6) in a sparse arrangement: nearly all of them', () => {
    const { clear, hit } = run(200, 260, 6)
    expect(clear).toBeGreaterThan(100)
    // (a route which is not clear: its candidates are all blocked, e.g. a port on the lower left of a node whose leg
    // must go up through the node. One route of the seeds at the time of writing)
    expect(hit).toBeLessThanOrEqual(clear / 50)
  })

  it('in a crowded arrangement most of the routes are clear (the ones which are not use the lane with the fewest circles)', () => {
    const { clear, hit } = run(200, 110, 6)
    expect(clear).toBeGreaterThan(hit * 4)
    // (the number for the seeds at the time of writing: the number of the routes which are not clear must not grow)
    expect(hit).toBeLessThanOrEqual(Math.ceil(clear / 6))
  })

  it('makes the routes of a large arrangement in a short time (100 nodes, 300 ports, 200 links)', () => {
    const next = random(7)
    const obstacles: Obstacle[] = []
    const ends = new Map<string, RouteEnd[]>()
    for (let i = 0; i < 100; i++) {
      const radius = 20 + Math.floor(next() * 20)
      const node = circle(`n${i}`, (i % 10) * 150, Math.floor(i / 10) * 150, radius)
      obstacles.push(node)
      const list: RouteEnd[] = []
      for (let k = 0; k < 3; k++) {
        const angle = (k * Math.PI) / 2 + next() * 0.5
        const outward = { x: Math.cos(angle), y: Math.sin(angle) }
        const p = {
          id: `${node.id}p${k}`,
          x: node.x + outward.x * radius,
          y: node.y + outward.y * radius,
          radius: PORT,
        }
        obstacles.push(p)
        list.push({ x: p.x, y: p.y, node: node.id, port: p.id, radius, outward })
      }
      ends.set(node.id, list)
    }
    const requests: RouteRequest[] = []
    for (let k = 0; k < 200; k++) {
      const [a, b] = [`n${Math.floor(next() * 100)}`, `n${Math.floor(next() * 100)}`]
      if (a !== b) requests.push({ id: `r${k}`, from: ends.get(a)![k % 3]!, to: ends.get(b)![(k + 1) % 3]! })
    }
    routeAround(requests, obstacles) // (warm up)
    const started = performance.now()
    const routes = routeAround(requests, obstacles)
    // (47 ms at the time of writing, with almost all the links routed: the limit is loose, for slow machines)
    expect(performance.now() - started).toBeLessThan(600)
    expect(routes.size).toBeGreaterThan(100)
  })
})
