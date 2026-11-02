import { describe, expect, it } from 'vitest'
import { layoutQuality } from './quality'
import { layoutWithStress } from './stress'
import type { LayoutLink, LayoutNode } from './types'

/** reproducible random numbers (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}
const node = (id: string, radius = 11): LayoutNode => ({ id, radius })
const link = (source: string, target: string): LayoutLink => ({ source, target })
const run = (nodes: LayoutNode[], links: LayoutLink[], seed = 1) =>
  layoutWithStress(nodes, links, { random: seeded(seed) }).positions
const placed = (nodes: LayoutNode[], positions: Map<string, { x: number; y: number }>) =>
  nodes.map((n) => ({ ...n, ...(positions.get(n.id) ?? { x: NaN, y: NaN }) }))
const distance = (positions: Map<string, { x: number; y: number }>, a: string, b: string) => {
  const [p, q] = [positions.get(a), positions.get(b)]
  return Math.hypot((p?.x ?? NaN) - (q?.x ?? NaN), (p?.y ?? NaN) - (q?.y ?? NaN))
}

describe('layoutWithStress', () => {
  it('returns nothing for no node, and a position for a single node', () => {
    expect(run([], []).size).toBe(0)
    const one = run([node('a')], [])
    expect(one.get('a')).toEqual({ x: 11, y: 11 })
  })

  it('gives a finite position to each node and has no route (links are straight)', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => node(id))
    const result = layoutWithStress(nodes, [link('a', 'b'), link('b', 'c'), link('c', 'd')], {
      random: seeded(3),
    })
    expect(result.routes.size).toBe(0)
    for (const n of nodes) {
      const p = result.positions.get(n.id)
      expect(Number.isFinite(p?.x) && Number.isFinite(p?.y)).toBe(true)
    }
  })

  it('makes the distance between linked nodes about the length of the link', () => {
    // a - b - c: |ab| and |bc| are the length of the link (edgeGap 50 + radii 11 + 11 = 72), |ac| is twice
    const nodes = ['a', 'b', 'c'].map((id) => node(id))
    const positions = run(nodes, [link('a', 'b'), link('b', 'c')])
    expect(Math.abs(distance(positions, 'a', 'b') - 72)).toBeLessThan(2)
    expect(Math.abs(distance(positions, 'b', 'c') - 72)).toBeLessThan(2)
    expect(Math.abs(distance(positions, 'a', 'c') - 144)).toBeLessThan(4)
  })

  it('keeps larger nodes farther from their neighbors', () => {
    const nodes = [node('big', 100), node('x', 11), node('y', 11)]
    const positions = run(nodes, [link('big', 'x'), link('big', 'y')])
    // length of the link = 50 + 100 + 11
    expect(distance(positions, 'big', 'x')).toBeGreaterThanOrEqual(100 + 11)
    expect(layoutQuality(placed(nodes, positions), []).overlap).toBe(0)
  })

  it('draws a cycle without crossings or overlaps', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id))
    const links = nodes.map((n, i) => link(n.id, nodes[(i + 1) % nodes.length]?.id ?? ''))
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(layoutQuality(placed(nodes, run(nodes, links, seed)), links)).toEqual({
        crossings: 0,
        overlap: 0,
      })
    }
  })

  it('draws a planar graph (a grid) without crossings or overlaps', () => {
    const ids = Array.from({ length: 36 }, (_, i) => `n${i}`)
    const nodes = ids.map((id) => node(id))
    const links: LayoutLink[] = []
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (c < 5) links.push(link(`n${r * 6 + c}`, `n${r * 6 + c + 1}`))
        if (r < 5) links.push(link(`n${r * 6 + c}`, `n${(r + 1) * 6 + c}`))
      }
    }
    expect(layoutQuality(placed(nodes, run(nodes, links)), links)).toEqual({ crossings: 0, overlap: 0 })
  })

  it('puts separate components apart from each other (no overlap)', () => {
    const nodes = ['a', 'b', 'c', 'x', 'y', 'z', 'lonely'].map((id) => node(id))
    const links = [link('a', 'b'), link('b', 'c'), link('x', 'y'), link('y', 'z'), link('z', 'x')]
    const positions = run(nodes, links)
    expect(layoutQuality(placed(nodes, positions), links)).toEqual({ crossings: 0, overlap: 0 })
    // the nodes of a component are near each other, the components are farther
    expect(distance(positions, 'a', 'b')).toBeLessThan(distance(positions, 'a', 'x'))
  })

  it('ignores loops, duplicated links and links to unknown nodes', () => {
    const nodes = ['a', 'b'].map((id) => node(id))
    const positions = run(nodes, [link('a', 'a'), link('a', 'b'), link('b', 'a'), link('a', 'zzz')])
    expect(positions.size).toBe(2)
    expect(Math.abs(distance(positions, 'a', 'b') - 72)).toBeLessThan(2)
  })

  it('is reproducible with the same random numbers', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => node(id))
    const links = [link('a', 'b'), link('b', 'c'), link('c', 'd'), link('d', 'a'), link('a', 'c')]
    expect([...run(nodes, links, 9)]).toEqual([...run(nodes, links, 9)])
  })

  it('arranges a graph of a few hundred nodes in a short time', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `n${i}`)
    const nodes = ids.map((id) => node(id))
    // a tree with some extra links
    const links = ids.slice(1).map((id, i) => link(id, `n${Math.floor(i / 3)}`))
    const started = performance.now()
    const positions = run(nodes, links)
    expect(performance.now() - started).toBeLessThan(5000)
    expect(layoutQuality(placed(nodes, positions), links).overlap).toBe(0)
  })
})
