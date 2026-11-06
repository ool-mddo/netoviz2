import { describe, expect, it } from 'vitest'
import type { Position, Positions } from '../types'
import { routeKey, routeLinks } from './routes'

const R = 11
const nodesOf = (positions: Record<string, [number, number]>) =>
  Object.keys(positions).map((id) => ({ id, radius: R }))
const placedOf = (positions: Record<string, [number, number]>): Positions =>
  new Map(Object.entries(positions).map(([id, [x, y]]) => [id, { x, y }]))
const route = (positions: Record<string, [number, number]>, links: Array<[string, string]>) =>
  routeLinks(
    nodesOf(positions),
    links.map(([source, target]) => ({ source, target })),
    placedOf(positions),
  )
const distance = (p: Position, a: Position, b: Position) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
/** Polyline of the link: the centers of the ends and the waypoints */
const polyline = (
  positions: Record<string, [number, number]>,
  a: string,
  b: string,
  routes: Map<string, Position[]>,
) => {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const points = routes.get(routeKey(lo, hi))!
  const at = (id: string) => ({ x: positions[id]![0], y: positions[id]![1] })
  return [at(lo), ...points, at(hi)]
}

describe('routeKey', () => {
  it('is the same for both directions', () => {
    expect(routeKey('a', 'b')).toBe(routeKey('b', 'a'))
    expect(routeKey('a', 'b')).not.toBe(routeKey('a', 'c'))
  })
})

describe('routeLinks', () => {
  const row = { a: [0, 0], b: [100, 0], c: [200, 0] } as Record<string, [number, number]>

  it('gives no route to a link which a straight line does not pass through a node', () => {
    expect(
      route(row, [
        ['a', 'b'],
        ['b', 'c'],
      ]).size,
    ).toBe(0)
    // different rows: not the object of this step
    expect(route({ a: [0, 0], b: [100, 100], c: [50, 50] }, [['a', 'b']]).size).toBe(0)
  })

  it('goes over the row for a link in a row with a node between (the upper side first)', () => {
    const routes = route(row, [['a', 'c']])
    const points = routes.get(routeKey('a', 'c'))!
    expect(points).toHaveLength(4)
    // a vertical leg from the top of a, the lane above the row, a vertical leg to the top of c
    expect(points[0]!.y).toBe(-R)
    expect(points[1]!.y).toBeLessThan(-R)
    expect(points[1]!.y).toBe(points[2]!.y)
    expect(points[3]!.y).toBe(-R)
    // the route does not pass through b
    const line = polyline(row, 'a', 'c', routes)
    for (let i = 0; i + 1 < line.length; i++) {
      expect(distance({ x: 100, y: 0 }, line[i]!, line[i + 1]!)).toBeGreaterThanOrEqual(R + 8 - 1e-6)
    }
  })

  /** A row with a node under it (the other row), where the lanes of the lower side are on the node */
  const withBelow = { a: [0, 0], b: [100, 0], c: [200, 0], d: [300, 0], w: [150, 30] } as Record<
    string,
    [number, number]
  >

  it('puts the longer link outside (nested) when the links share a node and overlap, on the same side', () => {
    const routes = route(withBelow, [
      ['a', 'c'],
      ['a', 'd'],
    ])
    const [ac, ad] = [routes.get(routeKey('a', 'c'))!, routes.get(routeKey('a', 'd'))!]
    expect(Math.sign(ac[1]!.y)).toBe(Math.sign(ad[1]!.y))
    expect(Math.abs(ad[1]!.y)).toBeGreaterThan(Math.abs(ac[1]!.y))
  })

  it('uses the lower side of the row when the upper lane is taken, if it is free', () => {
    const wide = { a: [0, 0], b: [100, 0], c: [200, 0], d: [300, 0] } as Record<string, [number, number]>
    const routes = route(wide, [
      ['a', 'c'],
      ['a', 'd'],
    ])
    const [ac, ad] = [routes.get(routeKey('a', 'c'))!, routes.get(routeKey('a', 'd'))!]
    expect(Math.sign(ac[1]!.y)).not.toBe(Math.sign(ad[1]!.y))
    expect(Math.abs(ac[1]!.y)).toBe(Math.abs(ad[1]!.y))
  })

  it('puts the links which do not overlap in the same lane, and the ones which overlap in different lanes', () => {
    const wide = { a: [0, 0], b: [100, 0], c: [200, 0], d: [300, 0], e: [400, 0], f: [500, 0] } as Record<
      string,
      [number, number]
    >
    const routes = route(wide, [
      ['a', 'c'],
      ['d', 'f'],
      ['b', 'e'],
    ])
    const laneY = (a: string, b: string) => routes.get(routeKey(a, b))![1]!.y
    expect(laneY('a', 'c')).toBe(laneY('d', 'f')) // apart: the same lane
    expect(laneY('b', 'e')).not.toBe(laneY('a', 'c')) // overlaps both
  })

  it('uses the other side of the row when the lane of the upper side is taken', () => {
    const routes = route(row, [['a', 'c']])
    const wide = { a: [0, 0], b: [100, 0], c: [200, 0], d: [300, 0] } as Record<string, [number, number]>
    const both = route(wide, [
      ['a', 'c'],
      ['b', 'd'],
    ])
    const [first, second] = [both.get(routeKey('a', 'c'))![1]!.y, both.get(routeKey('b', 'd'))![1]!.y]
    expect(Math.sign(first)).not.toBe(Math.sign(second)) // the lane 0 on both sides
    expect(Math.abs(first)).toBe(Math.abs(second))
    expect(routes.size).toBe(1)
  })

  it('does not use a lane where the route is on a node (the nodes first, the other links second)', () => {
    // a node of another row is just above the row, where the lane 0 of the upper side is
    const positions = { a: [0, 0], b: [100, 0], c: [200, 0], u: [100, -28] } as Record<
      string,
      [number, number]
    >
    const routes = route(positions, [['a', 'c']])
    const line = polyline(positions, 'a', 'c', routes)
    for (let i = 0; i + 1 < line.length; i++) {
      for (const id of ['b', 'u']) {
        const p = { x: positions[id]![0], y: positions[id]![1] }
        expect(distance(p, line[i]!, line[i + 1]!)).toBeGreaterThanOrEqual(R + 8 - 1e-6)
      }
    }
  })

  it('keeps the legs of the links which leave a node on the same side apart: the outer lane is nearer to the center', () => {
    const routes = route(withBelow, [
      ['a', 'c'],
      ['a', 'd'],
    ])
    const [ac, ad] = [routes.get(routeKey('a', 'c'))!, routes.get(routeKey('a', 'd'))!]
    expect(ac[0]!.x).not.toBe(ad[0]!.x)
    // to the right of a: the legs are at the right of the center; the farther link (outer lane) is nearer to it
    expect(ad[0]!.x).toBeGreaterThan(0)
    expect(ad[0]!.x).toBeLessThan(ac[0]!.x)
    // the legs stay in the circle of the node
    expect(Math.abs(ac[0]!.x)).toBeLessThan(R)
  })

  it('is deterministic and independent of the order of the links', () => {
    const wide = { a: [0, 0], b: [100, 0], c: [200, 0], d: [300, 0] } as Record<string, [number, number]>
    const links: Array<[string, string]> = [
      ['a', 'c'],
      ['a', 'd'],
      ['b', 'd'],
    ]
    const first = route(wide, links)
    const second = route(
      wide,
      [...links].reverse().map(([x, y]) => [y, x] as [string, string]),
    )
    expect([...second].sort()).toEqual([...first].sort())
  })

  it('ignores links to unknown nodes, links of a node to itself and duplicates', () => {
    const routes = route(row, [
      ['a', 'c'],
      ['c', 'a'],
      ['a', 'a'],
      ['a', 'nothing'],
    ])
    expect(routes.size).toBe(1)
  })

  it('leaves a link straight when there is no free lane (not a failure)', () => {
    const positions = { a: [0, 0], b: [100, 0], c: [200, 0] } as Record<string, [number, number]>
    const routes = routeLinks(nodesOf(positions), [{ source: 'a', target: 'c' }], placedOf(positions), {
      maxLanes: 0,
    })
    expect(routes.size).toBe(0)
  })

  it('keeps the legs at the centers when shifting them would hit a node (a large node with several links, and a node near)', () => {
    // the node a has the radius 40: four links leave it upward, and their legs would be shifted up to 24 to the right
    const positions: Record<string, [number, number]> = {
      a: [0, 0],
      d0: [120, 0],
      d1: [220, 0],
      d2: [320, 0],
      d3: [420, 0],
      d4: [520, 0],
      u: [20, -60], // 20 from the center of a: on the shifted legs, not on the legs at the center
      w0: [60, 50],
      w1: [150, 50],
      w2: [240, 50],
      w3: [330, 50],
      w4: [420, 50],
      w5: [510, 50],
    }
    const nodes = nodesOf(positions).map((n) => ({ ...n, radius: n.id === 'a' ? 40 : R }))
    const routes = routeLinks(
      nodes,
      ['d1', 'd2', 'd3', 'd4'].map((target) => ({ source: 'a', target })),
      placedOf(positions),
    )
    expect(routes.size).toBe(4)
    for (const [key, points] of routes) {
      const [lo, hi] = key.split('\n') as [string, string]
      const line = [
        { x: positions[lo]![0], y: positions[lo]![1] },
        ...points,
        { x: positions[hi]![0], y: positions[hi]![1] },
      ]
      for (let i = 0; i + 1 < line.length; i++) {
        expect(distance({ x: 20, y: -60 }, line[i]!, line[i + 1]!)).toBeGreaterThanOrEqual(R)
      }
    }
  })

  describe('properties for many arrangements (a seeded random)', () => {
    /** A simple deterministic random number generator in [0, 1) */
    const random = (seed: number) => () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    /** Rows of nodes with different radii (the rows are apart by the radii and 90), and links in the rows */
    function arrangement(seed: number) {
      const next = random(seed)
      const nodes: Array<{ id: string; radius: number }> = []
      const positions: Positions = new Map()
      const links: Array<{ source: string; target: string }> = []
      let y = 0
      let previousRadius = 0
      const rows = 1 + Math.floor(next() * 3)
      for (let row = 0; row < rows; row++) {
        const radius = [11, 11, 20, 40][Math.floor(next() * 4)]!
        y += row === 0 ? 0 : previousRadius + radius + 90
        previousRadius = radius
        const ids: string[] = []
        let x = 0
        for (let i = 0; i < 3 + Math.floor(next() * 5); i++) {
          const id = `r${row}n${i}`
          nodes.push({ id, radius })
          positions.set(id, { x, y })
          ids.push(id)
          x += 2 * radius + 40 + Math.floor(next() * 80)
        }
        for (let k = 0; k < 2 + Math.floor(next() * 8); k++) {
          const [a, b] = [ids[Math.floor(next() * ids.length)]!, ids[Math.floor(next() * ids.length)]!]
          links.push({ source: a, target: b })
        }
      }
      return { nodes, positions, links }
    }

    it('no route passes through a node (the legs are shifted, the radius of the nodes differs), and the horizontal parts do not overlap', () => {
      for (let seed = 1; seed <= 300; seed++) {
        const { nodes, positions, links } = arrangement(seed)
        const routes = routeLinks(nodes, links, positions)
        const sections: Array<[number, number, number, string]> = []
        for (const [key, points] of routes) {
          const [lo, hi] = key.split('\n') as [string, string]
          const line = [positions.get(lo)!, ...points, positions.get(hi)!]
          for (const node of nodes) {
            if (node.id === lo || node.id === hi) continue
            for (let i = 0; i + 1 < line.length; i++) {
              const d = distance(positions.get(node.id)!, line[i]!, line[i + 1]!)
              expect(d, `seed ${seed}: ${lo} - ${hi} passes ${node.id}`).toBeGreaterThanOrEqual(node.radius)
            }
          }
          sections.push([
            points[1]!.y,
            Math.min(points[1]!.x, points[2]!.x),
            Math.max(points[1]!.x, points[2]!.x),
            key,
          ])
        }
        for (let i = 0; i < sections.length; i++) {
          for (let j = i + 1; j < sections.length; j++) {
            const [p, q] = [sections[i]!, sections[j]!]
            const overlaps = Math.abs(p[0] - q[0]) < 1 && p[1] < q[2] && q[1] < p[2]
            expect(overlaps, `seed ${seed}: the parts of ${p[3]} and ${q[3]} overlap`).toBe(false)
          }
        }
      }
    })

    it('the lanes of two rows which are at the same y do not overlap (the lane of the lower side and the one of the next row)', () => {
      // the rows are 90 apart (radius 11): the lane 1 of the lower side of the row 0 and the lane 2 of the upper side of
      // the row 1 are at the same y when the lanes are counted by the rows only
      const positions: Record<string, [number, number]> = {
        a: [0, 0],
        b: [100, 0],
        c: [200, 0],
        d: [300, 0],
        e: [400, 0],
        u: [0, 90],
        v: [100, 90],
        w: [200, 90],
        x: [300, 90],
        y: [400, 90],
      }
      const links: Array<[string, string]> = [
        ['a', 'e'],
        ['b', 'd'],
        ['a', 'd'],
        ['b', 'e'],
        ['a', 'c'],
        ['u', 'y'],
        ['v', 'x'],
        ['u', 'x'],
        ['v', 'y'],
        ['u', 'w'],
      ]
      const routes = route(positions, links)
      const sections = [...routes.values()].map((p) => ({
        y: p[1]!.y,
        lo: Math.min(p[1]!.x, p[2]!.x),
        hi: Math.max(p[1]!.x, p[2]!.x),
      }))
      for (let i = 0; i < sections.length; i++) {
        for (let j = i + 1; j < sections.length; j++) {
          const [p, q] = [sections[i]!, sections[j]!]
          expect(Math.abs(p.y - q.y) < 1 && p.lo < q.hi && q.lo < p.hi).toBe(false)
        }
      }
    })
  })
})
