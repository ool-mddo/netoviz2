export interface Point {
  x: number
  y: number
}

/** Link between the nodes `u` and `v` as a segment */
export interface Segment {
  u: string
  v: string
  a: Point
  b: Point
}

function orientation(p: Point, q: Point, r: Point): number {
  return Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
}

/** Segments cross each other (touching at an end is not a crossing) */
function crosses(s: Segment, t: Segment): boolean {
  const d1 = orientation(s.a, s.b, t.a)
  const d2 = orientation(s.a, s.b, t.b)
  const d3 = orientation(t.a, t.b, s.a)
  const d4 = orientation(t.a, t.b, s.b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Number of the pairs of links which cross each other. Links of the same node are not counted. */
export function countCrossings(segments: readonly Segment[]): number {
  let count = 0
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (!s) continue
    for (let j = i + 1; j < segments.length; j++) {
      const t = segments[j]
      if (!t || s.u === t.u || s.u === t.v || s.v === t.u || s.v === t.v) continue
      if (crosses(s, t)) count++
    }
  }
  return count
}

export interface Circle extends Point {
  r: number
}

/** Sum of the depth of overlap between the circles (0 if no circle overlaps) */
export function overlapDepth(circles: readonly Circle[]): number {
  let sum = 0
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i]
    if (!c) continue
    for (let j = i + 1; j < circles.length; j++) {
      const d = circles[j]
      if (!d) continue
      const depth = c.r + d.r - Math.hypot(c.x - d.x, c.y - d.y)
      if (depth > 0) sum += depth
    }
  }
  return sum
}
