import { describe, expect, it } from 'vitest'
import { countCrossings, overlapDepth, type Segment } from './layoutScore'

const seg = (u: string, v: string, ax: number, ay: number, bx: number, by: number): Segment => ({
  u,
  v,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
})

describe('countCrossings', () => {
  it('counts crossing links', () => {
    expect(countCrossings([seg('a', 'b', 0, 0, 10, 10), seg('c', 'd', 0, 10, 10, 0)])).toBe(1)
  })

  it('does not count links which do not cross', () => {
    expect(countCrossings([seg('a', 'b', 0, 0, 10, 0), seg('c', 'd', 0, 5, 10, 5)])).toBe(0)
  })

  it('does not count links sharing a node (they meet at the node)', () => {
    expect(countCrossings([seg('a', 'b', 0, 0, 10, 10), seg('a', 'c', 0, 0, 10, 0)])).toBe(0)
  })

  it('counts each pair once', () => {
    const segments = [seg('a', 'b', 0, 0, 10, 10), seg('c', 'd', 0, 10, 10, 0), seg('e', 'f', 5, -5, 5, 15)]
    expect(countCrossings(segments)).toBe(3)
  })

  it('returns 0 for no or one link', () => {
    expect(countCrossings([])).toBe(0)
    expect(countCrossings([seg('a', 'b', 0, 0, 1, 1)])).toBe(0)
  })
})

describe('overlapDepth', () => {
  it('is the sum of the depth of overlaps', () => {
    expect(
      overlapDepth([
        { x: 0, y: 0, r: 5 },
        { x: 8, y: 0, r: 5 },
      ]),
    ).toBeCloseTo(2, 6)
  })

  it('is 0 when circles are apart or just touching', () => {
    expect(
      overlapDepth([
        { x: 0, y: 0, r: 5 },
        { x: 10, y: 0, r: 5 },
      ]),
    ).toBe(0)
    expect(
      overlapDepth([
        { x: 0, y: 0, r: 5 },
        { x: 30, y: 0, r: 5 },
      ]),
    ).toBe(0)
  })
})
