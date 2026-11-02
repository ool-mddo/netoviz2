import { countCrossings, overlapDepth, type Segment } from '../../domain/layoutScore'
import type { LayoutLink, Position } from './types'

/** Quality of a layout of nodes: crossings of links and overlaps of nodes (the lower, the better) */
export function layoutQuality(
  nodes: ReadonlyArray<Position & { id: string; radius: number }>,
  links: readonly LayoutLink[],
): { crossings: number; overlap: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const segments: Segment[] = links.flatMap((link) => {
    const [a, b] = [byId.get(link.source), byId.get(link.target)]
    return a && b ? [{ u: a.id, v: b.id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }] : []
  })
  const circles = nodes.map((node) => ({ x: node.x, y: node.y, r: node.radius }))
  return { crossings: countCrossings(segments), overlap: overlapDepth(circles) }
}
