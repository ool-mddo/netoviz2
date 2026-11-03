import { describe, expect, it } from 'vitest'
import type { SupportEdge } from '../api/types'
import { SupportIndex } from './supportIndex'
import { traceSupports } from './tracer'

const edge = (from: string, to: string, kind: SupportEdge['kind'] = 'node'): SupportEdge => ({
  kind,
  from,
  to,
})

// l3 -> l2 -> l1 (from is the upper object)
const edges = [edge('l3/a', 'l2/a'), edge('l2/a', 'l1/a'), edge('l2/a', 'l1/b'), edge('l3/b', 'l2/a')]

describe('SupportIndex', () => {
  const index = new SupportIndex(edges)

  it('has lower and upper edges of an object', () => {
    expect(index.lowerEdges('l2/a').map((e) => e.to)).toEqual(['l1/a', 'l1/b'])
    expect(index.upperEdges('l2/a').map((e) => e.from)).toEqual(['l3/a', 'l3/b'])
  })

  it('returns an empty list for unknown objects', () => {
    expect(index.lowerEdges('x')).toEqual([])
    expect(index.upperEdges('x')).toEqual([])
  })
})

describe('traceSupports', () => {
  const index = new SupportIndex(edges)

  it('traces lower layers recursively', () => {
    const result = traceSupports(index, ['l3/a'], 'lower')
    expect([...result.ids].sort()).toEqual(['l1/a', 'l1/b', 'l2/a', 'l3/a'])
    expect(result.edges).toHaveLength(3)
  })

  it('traces upper layers recursively', () => {
    const result = traceSupports(index, ['l1/a'], 'upper')
    expect([...result.ids].sort()).toEqual(['l1/a', 'l2/a', 'l3/a', 'l3/b'])
  })

  it('traces both directions', () => {
    const result = traceSupports(index, ['l2/a'], 'both')
    expect(result.ids.size).toBe(5)
    expect(result.edges).toHaveLength(4)
  })

  it('traces from multiple start objects without duplicated edges', () => {
    const result = traceSupports(index, ['l3/a', 'l3/b'], 'lower')
    expect(result.edges).toHaveLength(4)
  })

  it('limits the depth', () => {
    const result = traceSupports(index, ['l3/a'], 'lower', 1)
    expect([...result.ids].sort()).toEqual(['l2/a', 'l3/a'])
  })

  it('does not loop with cyclic supports', () => {
    const cyclic = new SupportIndex([edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    const result = traceSupports(cyclic, ['a'], 'both')
    expect([...result.ids].sort()).toEqual(['a', 'b', 'c'])
    expect(result.edges).toHaveLength(3)
  })

  it('does not depend on the kind of supports', () => {
    const mixed = new SupportIndex([
      edge('l2/a/tp', 'l1/a/tp', 'tp'),
      edge('l2/~link/x', 'l1/~link/y', 'link'),
    ])
    expect(traceSupports(mixed, ['l2/a/tp'], 'lower').ids.has('l1/a/tp')).toBe(true)
    expect(traceSupports(mixed, ['l2/~link/x'], 'lower').ids.has('l1/~link/y')).toBe(true)
  })

  it('returns only the start objects if no support', () => {
    expect([...traceSupports(index, ['unknown'], 'both').ids]).toEqual(['unknown'])
  })
})
