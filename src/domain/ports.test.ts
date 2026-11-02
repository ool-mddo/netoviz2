import { describe, expect, it } from 'vitest'
import { radiusForPorts, spreadAngles } from './ports'

const TAU = Math.PI * 2
/** angular distance between two angles (0..PI) */
const distance = (a: number, b: number) => {
  const d = Math.abs((((a - b) % TAU) + TAU) % TAU)
  return Math.min(d, TAU - d)
}
/** the minimum gap between the neighbors around the circle */
const minGapOf = (angles: number[]) => {
  const sorted = angles.map((a) => ((a % TAU) + TAU) % TAU).sort((a, b) => a - b)
  return Math.min(
    ...sorted.map((a, i) => (sorted[(i + 1) % sorted.length] ?? 0) + (i === sorted.length - 1 ? TAU : 0) - a),
  )
}

describe('spreadAngles', () => {
  it('returns an empty array without ports and keeps a single port', () => {
    expect(spreadAngles([], 0.3)).toEqual([])
    expect(spreadAngles([1.2], 0.3)).toEqual([1.2])
  })

  it('keeps the angles when they are far enough from each other', () => {
    const result = spreadAngles([0, 1, 2, 3], 0.3)
    result.forEach((angle, i) => expect(angle).toBeCloseTo(i, 6))
  })

  it('separates ports which have the same desired angle', () => {
    const result = spreadAngles([1, 1, 1], 0.4)
    expect(minGapOf(result)).toBeGreaterThanOrEqual(0.4 - 1e-6)
    // the center of the ports stays at the desired angle
    expect(result.reduce((a, b) => a + b, 0) / 3).toBeCloseTo(1, 6)
  })

  it('separates the ports around the wrap-around point (just before and after 0)', () => {
    const result = spreadAngles([TAU - 0.05, 0.05], 0.5)
    expect(distance(result[0] ?? 0, result[1] ?? 0)).toBeGreaterThanOrEqual(0.5 - 1e-6)
  })

  it('keeps the order of the desired angles around the node (as a circle)', () => {
    const desired = [3, 0.1, 1.5, 0.12]
    const result = spreadAngles(desired, 0.3).map((a) => ((a % TAU) + TAU) % TAU)
    const angles = desired
      .map((d, i) => ({ d, a: result[i] ?? 0 }))
      .sort((x, y) => x.d - y.d)
      .map((x) => x.a)
    // ascending around the circle: at most one descent (the wrap-around point)
    const descents = angles.filter((a, i) => i > 0 && a < (angles[i - 1] ?? 0)).length
    expect(descents).toBeLessThanOrEqual(1)
  })

  it('puts the ports at regular intervals when there is no room', () => {
    const result = spreadAngles([0, 0.01, 0.02, 0.03], 2)
    expect(minGapOf(result)).toBeCloseTo(TAU / 4, 6)
  })

  it('returns the angles in the order of the input', () => {
    const result = spreadAngles([3, 0.5], 0.3)
    expect(result[0]).toBeCloseTo(3, 6)
    expect(result[1]).toBeCloseTo(0.5, 6)
  })
})

describe('radiusForPorts', () => {
  it('is the base radius when the ports fit, otherwise a radius for the arcs', () => {
    expect(radiusForPorts(11, 3, 13)).toBe(11)
    expect(radiusForPorts(11, 20, 13)).toBeCloseTo((20 * 13) / TAU, 6)
  })
})
