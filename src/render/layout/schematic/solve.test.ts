import { describe, expect, it } from 'vitest'
import { solvePositions } from './solve'
import { linkOf, node, slotsOf } from './testing'

const solve = (names: string[], links: Array<[string, string]> = [], radius?: Record<string, number>) => {
  const nodes = names.map((n) => ({ ...node(n), radius: radius?.[n] ?? 11 }))
  const positions = solvePositions(
    nodes,
    slotsOf(
      nodes,
      links.map(([a, b]) => linkOf(a, b)),
    ),
    links.map(([a, b]) => linkOf(a, b)),
  )
  return (name: string) => positions.get(`l/${name}`)!
}

describe('solvePositions', () => {
  it('puts the nodes of a tier at the same height, the tiers from the top apart by the radius and the gap', () => {
    const at = solve(['a-top-1', 'b-top-1', 'a-mid-1'], [], { 'a-mid-1': 30 })
    expect(at('a-top-1').y).toBe(at('b-top-1').y)
    // the top row has radius 11, the next row radius 30: 11 + rowGap (90) + 30
    expect(at('a-mid-1').y - at('a-top-1').y).toBeCloseTo(11 + 90 + 30, 6)
  })

  it('keeps the minimum gaps: pair < node < group (between the circles)', () => {
    const at = solve(['a-mid-1', 'a-mid-2', 'a-mid-5', 'b-mid-1'])
    const gap = (p: string, q: string) => at(q).x - at(p).x - 22
    expect(gap('a-mid-1', 'a-mid-2')).toBeCloseTo(40, 6)
    expect(gap('a-mid-2', 'a-mid-5')).toBeGreaterThanOrEqual(40 - 1e-6)
    expect(gap('a-mid-5', 'b-mid-1')).toBeGreaterThanOrEqual(120 - 1e-6)
  })

  it('centers a pair on the nodes it is linked to', () => {
    const at = solve(
      ['a-top-1', 'a-mid-1', 'a-mid-2'],
      [
        ['a-top-1', 'a-mid-1'],
        ['a-top-1', 'a-mid-2'],
      ],
    )
    expect((at('a-mid-1').x + at('a-mid-2').x) / 2).toBeCloseTo(at('a-top-1').x, 3)
  })

  it('makes the links between rows straight when possible', () => {
    const at = solve(
      ['a-top-1', 'a-mid-1', 'a-low-1'],
      [
        ['a-top-1', 'a-mid-1'],
        ['a-mid-1', 'a-low-1'],
      ],
    )
    expect(at('a-mid-1').x).toBeCloseTo(at('a-top-1').x, 3)
    expect(at('a-low-1').x).toBeCloseTo(at('a-mid-1').x, 3)
  })

  it('keeps the groups in the order through all the rows even if the rows have different numbers of nodes', () => {
    // site a has many nodes in the top row, site b has nodes only in the low row (linked to the first of a)
    const aNodes = Array.from({ length: 8 }, (_, i) => `a-top-${i * 2 + 1}`)
    const bNodes = ['b-low-1', 'b-low-3']
    const at = solve([...aNodes, ...bNodes], [['a-top-1', 'b-low-1']])
    const maxA = Math.max(...aNodes.map((n) => at(n).x))
    const minB = Math.min(...bNodes.map((n) => at(n).x))
    expect(minB - maxA).toBeGreaterThanOrEqual(120 + 22 - 1e-6)
  })

  it('handles a single node, no node, and links to unknown nodes', () => {
    expect(solve(['a-top-1'])('a-top-1')).toEqual({ x: 0, y: 11 })
    expect(solvePositions([], { groups: [], rows: [] }, []).size).toBe(0)
    expect(() => solve(['a-top-1'], [['a-top-1', 'nothing']])).not.toThrow()
  })

  it('is finite and has no overlap for a larger input', () => {
    const names = ['a', 'b', 'c'].flatMap((s) =>
      ['top', 'mid', 'low'].flatMap((r) => Array.from({ length: 6 }, (_, i) => `${s}-${r}-${i + 1}`)),
    )
    const links: Array<[string, string]> = names
      .filter((n) => n.includes('-top-'))
      .map((n) => [n, n.replace('-top-', '-mid-')])
    const at = solve(names, links)
    for (const n of names) {
      expect(Number.isFinite(at(n).x) && Number.isFinite(at(n).y)).toBe(true)
    }
    const row = names
      .filter((n) => n.startsWith('b-mid-'))
      .map((n) => at(n).x)
      .sort((p, q) => p - q)
    for (let i = 1; i < row.length; i++) expect(row[i]! - row[i - 1]!).toBeGreaterThanOrEqual(22 + 40 - 1e-6)
  })

  it('starts a node without a position from the one before it in the row', () => {
    const nodes = ['a-top-1', 'a-top-3'].map((n) => node(n))
    const initialX = new Map([['l/a-top-1', 100]])
    const positions = solvePositions(nodes, slotsOf(nodes), [], { initialX, iterations: 0 })
    const [first, second] = ['l/a-top-1', 'l/a-top-3'].map((id) => positions.get(id)!.x)
    expect(second! - first!).toBeGreaterThanOrEqual(22 + 40 - 1e-6)
    expect(Number.isFinite(first!) && Number.isFinite(second!)).toBe(true)
  })

  it('starts from the given positions (initialX): the order and the gaps are kept, the links are not made straight', () => {
    const nodes = ['a-top-1', 'a-top-3', 'a-mid-1'].map((n) => node(n))
    const slots = slotsOf(nodes, [linkOf('a-top-1', 'a-mid-1')])
    const initialX = new Map([
      ['l/a-top-1', -300],
      ['l/a-top-3', 200],
      ['l/a-mid-1', 100],
    ])
    const positions = solvePositions(nodes, slots, [linkOf('a-top-1', 'a-mid-1')], {
      initialX,
      iterations: 0,
    })
    // the hint is the position up to the shift to center the diagram
    const shift = positions.get('l/a-top-1')!.x - -300
    expect(positions.get('l/a-top-3')!.x - shift).toBeCloseTo(200, 6)
    expect(positions.get('l/a-mid-1')!.x - shift).toBeCloseTo(100, 6)
    // the nodes which are too close are spaced out, in the order
    const close = new Map([
      ['l/a-top-1', 0],
      ['l/a-top-3', 1],
      ['l/a-mid-1', 0],
    ])
    const spaced = solvePositions(nodes, slots, [], { initialX: close, iterations: 0 })
    expect(spaced.get('l/a-top-3')!.x - spaced.get('l/a-top-1')!.x).toBeGreaterThanOrEqual(22 + 40 - 1e-6)
  })
})
