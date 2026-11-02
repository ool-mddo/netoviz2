import { countCrossings, overlapDepth, type Segment } from '../../domain/layoutScore'
import type { LayoutLink, Position } from './types'

/** Quality of a layout of nodes: crossings of links and overlaps of nodes (the lower, the better) */
export function layoutQuality(
  nodes: ReadonlyArray<Position & { id: string; radius: number }>,
  links: ReadonlyArray<LayoutLink & { via?: readonly Position[] }>,
): { crossings: number; overlap: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const segments: Segment[] = links.flatMap((link) => {
    const [a, b] = [byId.get(link.source), byId.get(link.target)]
    if (!a || !b) return []
    // a link with bend points is a polyline: each part is a segment (the parts of a link do not cross each other)
    const points = [{ x: a.x, y: a.y }, ...(link.via ?? []), { x: b.x, y: b.y }]
    return points.slice(1).map((end, i) => ({ u: a.id, v: b.id, a: points[i] ?? end, b: end }))
  })
  const circles = nodes.map((node) => ({ x: node.x, y: node.y, r: node.radius }))
  return { crossings: countCrossings(segments), overlap: overlapDepth(circles) }
}
