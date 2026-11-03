import { describe, expect, it } from 'vitest'
import { layoutBands, spaceOut, spaceOutNodes, type BandLayer } from './bands'

const node = (id: string) => ({ id, name: id })
const OPTS = { gap: 10, bandSpacing: 100 }

describe('spaceOut', () => {
  it('keeps positions which are apart enough', () => {
    expect(spaceOut([0, 20, 50], 10)).toEqual([0, 20, 50])
  })

  it('spreads overlapping positions around their center, keeping the order', () => {
    const result = spaceOut([0, 0, 0], 10)
    expect(result).toEqual([-10, 0, 10])
  })

  it('keeps the gap and the order for mixed input', () => {
    const result = spaceOut([0, 3, 4, 50], 10)
    for (let i = 1; i < result.length; i++)
      expect((result[i] ?? 0) - (result[i - 1] ?? 0)).toBeGreaterThanOrEqual(10 - 1e-9)
    expect(result[3]).toBe(50)
  })

  it('returns an empty list for no positions', () => {
    expect(spaceOut([], 10)).toEqual([])
  })
})

describe('spaceOutNodes', () => {
  it('keeps the space between the edges of nodes of different widths', () => {
    const xs = spaceOutNodes([0, 0], [40, 20], 10)
    // the centers are (40 + 20) / 2 + 10 = 40 apart
    expect((xs[1] ?? 0) - (xs[0] ?? 0)).toBeCloseTo(40)
    expect(((xs[0] ?? 0) + (xs[1] ?? 0)) / 2).toBeCloseTo(0)
  })

  it('is the same as spaceOut for nodes without width', () => {
    expect(spaceOutNodes([0, 3, 4, 50], [0, 0, 0, 0], 10)).toEqual(spaceOut([0, 3, 4, 50], 10))
  })
})

describe('layoutBands', () => {
  it('keeps wide nodes apart (by their widths)', () => {
    const wide: BandLayer[] = [
      {
        id: 'l',
        nodes: [
          { id: 'a', name: 'a', width: 100 },
          { id: 'b', name: 'b', width: 100 },
        ],
      },
    ]
    const { positions } = layoutBands(wide, [], OPTS)
    expect((positions.get('b')?.x ?? 0) - (positions.get('a')?.x ?? 0)).toBeGreaterThanOrEqual(110 - 1e-9)
  })

  it('puts a node without a supporting node below the upper node which it supports', () => {
    // t is supported by m only; m supports nothing below, but m is supported-by-nothing: m is below t
    const three: BandLayer[] = [
      { id: 'top', nodes: [node('t')] },
      { id: 'mid', nodes: [node('m'), node('n')] },
      { id: 'bot', nodes: [node('z'), node('y')] },
    ]
    const edges = [
      { from: 't', to: 'm' },
      { from: 'n', to: 'y' },
    ]
    const { positions, floating } = layoutBands(three, edges, OPTS)
    expect(floating.has('m')).toBe(true)
    // t has no lower node placed (m is loose): t is also at the right end, m is under t
    expect(positions.get('m')?.x).toBe(positions.get('t')?.x)
  })

  const layers: BandLayer[] = [
    { id: 'l3', nodes: [node('a'), node('b'), node('c')] },
    { id: 'l2', nodes: [node('x'), node('y'), node('z')] },
  ]

  it('puts the top layer at y = 0 and the lower layers below, the lowest layer in the order of the names', () => {
    const { positions, bandY } = layoutBands(layers, [], OPTS)
    expect(bandY.get('l3')).toBe(0)
    expect(bandY.get('l2')).toBe(100)
    expect(positions.get('x')?.x).toBeLessThan(positions.get('y')?.x ?? 0)
    expect(positions.get('y')?.x).toBeLessThan(positions.get('z')?.x ?? 0)
  })

  it('compares numbers in names as numbers', () => {
    const { positions } = layoutBands([{ id: 'l', nodes: [node('r10'), node('r2')] }], [], OPTS)
    expect(positions.get('r2')?.x).toBeLessThan(positions.get('r10')?.x ?? 0)
  })

  it('aligns an upper node with its supporting nodes (the average)', () => {
    const edges = [
      { from: 'a', to: 'x' },
      { from: 'a', to: 'z' },
      { from: 'b', to: 'y' },
    ]
    const { positions } = layoutBands(layers, edges, OPTS)
    const x = positions.get('x')?.x ?? 0
    const z = positions.get('z')?.x ?? 0
    // a is supported by x and z: a is between them; b is above y (but moved apart from a if they overlap)
    expect(positions.get('a')?.x).toBeGreaterThan(x - 1)
    expect(positions.get('a')?.x).toBeLessThan(z + 1)
  })

  it('orders the upper nodes by the positions of the supports (no crossing for one-to-one supports)', () => {
    const edges = [
      { from: 'a', to: 'z' },
      { from: 'b', to: 'y' },
      { from: 'c', to: 'x' },
    ]
    const { positions } = layoutBands(layers, edges, OPTS)
    expect(positions.get('c')?.x).toBeLessThan(positions.get('b')?.x ?? 0)
    expect(positions.get('b')?.x).toBeLessThan(positions.get('a')?.x ?? 0)
  })

  it('keeps the nodes in a band apart', () => {
    const edges = layers[0]?.nodes.map((n) => ({ from: n.id, to: 'y' })) ?? []
    const { positions } = layoutBands(layers, edges, OPTS)
    const xs = ['a', 'b', 'c'].map((id) => positions.get(id)?.x ?? 0).sort((p, q) => p - q)
    expect((xs[1] ?? 0) - (xs[0] ?? 0)).toBeGreaterThanOrEqual(10 - 1e-9)
    expect((xs[2] ?? 0) - (xs[1] ?? 0)).toBeGreaterThanOrEqual(10 - 1e-9)
  })

  it('puts the nodes without a supporting node at the right end and reports them as floating', () => {
    const { positions, floating } = layoutBands(layers, [{ from: 'a', to: 'x' }], OPTS)
    expect([...floating].sort()).toEqual(['b', 'c'])
    const placed = positions.get('a')?.x ?? 0
    expect(positions.get('b')?.x).toBeGreaterThan(placed)
    expect(positions.get('c')?.x).toBeGreaterThan(positions.get('b')?.x ?? 0)
  })

  it('does not report the lowest layer as floating', () => {
    expect(layoutBands(layers, [], OPTS).floating.has('x')).toBe(false)
  })

  it('handles supports which skip a layer', () => {
    const three: BandLayer[] = [{ id: 'top', nodes: [node('t')] }, ...layers]
    const { positions } = layoutBands(three, [{ from: 't', to: 'z' }], OPTS)
    expect(positions.get('t')?.x).toBe(positions.get('z')?.x)
  })

  it('handles no layers', () => {
    const result = layoutBands([], [], OPTS)
    expect(result.positions.size).toBe(0)
    expect(result.minX).toBe(0)
  })
})
