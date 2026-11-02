import { describe, expect, it } from 'vitest'
import { layoutQuality } from './quality'

const node = (id: string, x: number, y: number, radius = 10) => ({ id, x, y, radius })

describe('layoutQuality', () => {
  it('counts crossings of links and overlaps of nodes', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 100), node('c', 0, 100), node('d', 100, 0)]
    const crossed = layoutQuality(nodes, [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ])
    expect(crossed).toEqual({ crossings: 1, overlap: 0 })
    const uncrossed = layoutQuality(nodes, [
      { source: 'a', target: 'd' },
      { source: 'c', target: 'b' },
    ])
    expect(uncrossed.crossings).toBe(0)
  })

  it('has the depth of overlap', () => {
    const result = layoutQuality([node('a', 0, 0), node('b', 15, 0)], [])
    expect(result.overlap).toBeCloseTo(5, 6)
  })

  it('ignores links to unknown nodes', () => {
    expect(layoutQuality([node('a', 0, 0)], [{ source: 'a', target: 'x' }])).toEqual({
      crossings: 0,
      overlap: 0,
    })
  })

  it('counts the crossings of a link with bend points as a polyline', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 0), node('c', 50, -50), node('d', 50, 50)]
    // c-d is a vertical line at x=50 (y: -50..50). The straight link a-b crosses it
    const straight = layoutQuality(nodes, [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ])
    expect(straight.crossings).toBe(1)
    // a-b through (50, 80) goes around the end of c-d
    const bent = layoutQuality(nodes, [
      { source: 'a', target: 'b', via: [{ x: 50, y: 80 }] },
      { source: 'c', target: 'd' },
    ])
    expect(bent.crossings).toBe(0)
  })
})
