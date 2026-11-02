import { describe, expect, it } from 'vitest'
import { layoutWithElk } from './elkLayout'
import { layoutQuality } from './quality'
import type { LayoutLink, LayoutNode } from './types'

// the real ELK is used (it works in node)
const nodes: LayoutNode[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, radius: 12 }))
const links: LayoutLink[] = [
  ['a', 'b'],
  ['a', 'c'],
  ['b', 'd'],
  ['c', 'd'],
  ['d', 'e'],
  ['d', 'f'],
].map(([source, target]) => ({ source: source ?? '', target: target ?? '' }))

describe('layoutWithElk', () => {
  it('returns no position without nodes', async () => {
    const result = await layoutWithElk('layered', [], [])
    expect(result.positions.size).toBe(0)
    expect(result.routes.size).toBe(0)
  })

  it.each(['layered', 'stress', 'force'] as const)(
    'gives a position to each node (%s)',
    async (algorithm) => {
      const { positions } = await layoutWithElk(algorithm, nodes, links)
      expect([...positions.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
      for (const p of positions.values()) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      }
    },
  )

  it('layered: nodes are in layers from the top to the bottom, without overlap or crossing', async () => {
    const { positions } = await layoutWithElk('layered', nodes, links)
    const y = (id: string) => positions.get(id)?.y ?? 0
    expect(y('a')).toBeLessThan(y('b'))
    expect(y('b')).toBeLessThan(y('d'))
    expect(y('d')).toBeLessThan(y('e'))
    const placed = nodes.map((n) => ({ ...n, ...(positions.get(n.id) ?? { x: 0, y: 0 }) }))
    expect(layoutQuality(placed, links)).toEqual({ crossings: 0, overlap: 0 })
  })

  it('layered: separate components do not overlap', async () => {
    const two = [...nodes, { id: 'x', radius: 12 }, { id: 'y', radius: 12 }]
    const { positions } = await layoutWithElk('layered', two, [...links, { source: 'x', target: 'y' }])
    const placed = two.map((n) => ({ ...n, ...(positions.get(n.id) ?? { x: 0, y: 0 }) }))
    expect(layoutQuality(placed, links).overlap).toBe(0)
  })

  it('ignores links to unknown nodes and loops', async () => {
    const { positions } = await layoutWithElk('layered', nodes.slice(0, 2), [
      { source: 'a', target: 'zzz' },
      { source: 'a', target: 'a' },
      { source: 'a', target: 'b' },
    ])
    expect(positions.size).toBe(2)
  })

  describe('routes of the links', () => {
    // a -> b -> c and a -> c: the link a -> c spans two layers, so that it is routed around b with bend points
    const chain: LayoutNode[] = ['a', 'b', 'c'].map((id) => ({ id, radius: 12 }))
    const chainLinks: LayoutLink[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'a', target: 'c' },
    ]

    it('layered: has the bend points of the links which span layers, by the index of the link', async () => {
      const { routes } = await layoutWithElk('layered', chain, chainLinks)
      expect([...routes.keys()]).toContain(2)
      for (const points of routes.values()) {
        expect(points.length).toBeGreaterThan(0)
        for (const p of points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      }
    })

    it('layered: the routes do not cross the nodes (a link spanning layers goes around the node between)', async () => {
      const { positions, routes } = await layoutWithElk('layered', chain, chainLinks)
      const via = routes.get(2) ?? []
      const b = positions.get('b') ?? { x: 0, y: 0 }
      for (const p of via) expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeGreaterThan(12)
    })

    it('stress and force: links are straight (no bend point)', async () => {
      expect((await layoutWithElk('stress', chain, chainLinks)).routes.size).toBe(0)
      expect((await layoutWithElk('force', chain, chainLinks)).routes.size).toBe(0)
    })
  })
})
