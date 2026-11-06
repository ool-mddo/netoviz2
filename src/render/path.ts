import type { Position } from './layout/types'

/**
 * SVG path of a polyline with rounded corners: at each corner the line is cut at `radius` (at most half of the
 * shorter segment) from the corner and joined by a quadratic curve whose control point is the corner.
 */
export function roundedPolyline(points: readonly Position[], radius: number): string {
  // consecutive equal points have no direction
  const ps = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y)
  const [first, ...rest] = ps
  if (!first) return ''
  let d = `M${first.x},${first.y}`
  rest.forEach((p, i) => {
    const prev = ps[i]!
    const next = ps[i + 2]
    if (!next) {
      d += ` L${p.x},${p.y}`
      return
    }
    const [d1, d2] = [Math.hypot(prev.x - p.x, prev.y - p.y), Math.hypot(next.x - p.x, next.y - p.y)]
    const r = Math.min(radius, d1 / 2, d2 / 2)
    const a = { x: p.x + ((prev.x - p.x) * r) / d1, y: p.y + ((prev.y - p.y) * r) / d1 }
    const b = { x: p.x + ((next.x - p.x) * r) / d2, y: p.y + ((next.y - p.y) * r) / d2 }
    d += ` L${a.x},${a.y} Q${p.x},${p.y} ${b.x},${b.y}`
  })
  return d
}
