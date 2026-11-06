import { describe, expect, it } from 'vitest'
import { roundedPolyline } from './path'

describe('roundedPolyline', () => {
  it('is a straight line for two points', () => {
    expect(
      roundedPolyline(
        [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
        ],
        4,
      ),
    ).toBe('M0,0 L10,5')
  })

  it('cuts a corner at the radius and joins with a curve whose control point is the corner', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      10,
    )
    expect(d).toBe('M0,0 L90,0 Q100,0 100,10 L100,100')
  })

  it('does not round more than half of the shorter segment', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 8 },
      ],
      10,
    )
    expect(d).toBe('M0,0 L96,0 Q100,0 100,4 L100,8')
  })

  it('ignores the points which are the same as the one before, and gives nothing for no points', () => {
    expect(
      roundedPolyline(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        4,
      ),
    ).toBe('M0,0 L5,0')
    expect(roundedPolyline([], 4)).toBe('')
  })

  it('rounds each corner of a route with four waypoints', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: -30 },
        { x: 100, y: -30 },
        { x: 100, y: 0 },
      ],
      6,
    )
    expect(d).toBe('M0,0 L0,-24 Q0,-30 6,-30 L94,-30 Q100,-30 100,-24 L100,0')
  })
})
