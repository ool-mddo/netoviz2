import type { Position, Positions } from './types'

/** A layer of the bands. The layers are given from the top to the bottom */
export interface BandLayer {
  id: string
  /** `width` is the width of the node (a group with term-points is wider than a point). Default 0 */
  nodes: ReadonlyArray<{ id: string; name: string; width?: number }>
}

/** Support between nodes: `from` (upper) is supported by `to` (lower) */
export interface BandEdge {
  from: string
  to: string
}

export interface BandOptions {
  /** Minimum space between the nodes in a band (the distance between the centers of the nodes of width 0) */
  gap: number
  /** Distance between the centers of the bands (vertical) */
  bandSpacing: number
}

export const DEFAULT_BAND_OPTIONS: BandOptions = { gap: 40, bandSpacing: 140 }

export interface BandLayout {
  positions: Positions
  /** Vertical center of each layer (the top layer is 0, the lower layers have larger values) */
  bandY: Map<string, number>
  /** Horizontal extent of the nodes (for the width of the bands) */
  minX: number
  maxX: number
  /**
   * Nodes which have no supporting node placed below (in the layers other than the lowest one):
   * they are put at the right end of the band, apart from the others.
   */
  floating: Set<string>
}

/**
 * Arrange the layers as horizontal bands: the lowest layer first (in the order of the names), then each upper layer
 * is put around the average position of the nodes which support it (so the support lines are nearly vertical
 * and crossing lines show unexpected supports). Nodes in a band do not overlap and keep the order of the wanted positions.
 */
export function layoutBands(
  layers: readonly BandLayer[],
  edges: readonly BandEdge[],
  options: BandOptions = DEFAULT_BAND_OPTIONS,
): BandLayout {
  const lowerOf = new Map<string, string[]>()
  const upperOf = new Map<string, string[]>()
  for (const edge of edges) {
    const lower = lowerOf.get(edge.from)
    if (lower) lower.push(edge.to)
    else lowerOf.set(edge.from, [edge.to])
    const upper = upperOf.get(edge.to)
    if (upper) upper.push(edge.from)
    else upperOf.set(edge.to, [edge.from])
  }

  const positions: Positions = new Map()
  const bandY = new Map<string, number>()
  const floating = new Set<string>()
  const bottomUp = [...layers].reverse()

  bottomUp.forEach((layer, row) => {
    // the top layer is at y = 0 and the lower layers are below (y grows downward)
    const y = (layers.length - 1 - row) * options.bandSpacing
    bandY.set(layer.id, y)
    const wanted = layer.nodes.map((node) => ({ node, x: wantedX(lowerOf.get(node.id), positions) }))
    const placed = wanted.filter((item) => item.x !== undefined)
    const loose = wanted.filter((item) => item.x === undefined)
    const sortedPlaced = placed
      .map((item) => ({ ...item, x: item.x as number }))
      .sort((a, b) => a.x - b.x || compareNames(a.node.name, b.node.name))
    const sortedLoose = [...loose].sort((a, b) => compareNames(a.node.name, b.node.name))

    if (row === 0) {
      // the lowest layer: nothing to align with, in the order of the names
      const xs = spaceOutNodes(
        sortedLoose.map((_, i) => i * options.gap),
        sortedLoose.map((item) => item.node.width ?? 0),
        options.gap,
      )
      sortedLoose.forEach((item, i) => positions.set(item.node.id, { x: xs[i] ?? 0, y }))
      return
    }

    const xs = spaceOutNodes(
      sortedPlaced.map((item) => item.x),
      sortedPlaced.map((item) => item.node.width ?? 0),
      options.gap,
    )
    sortedPlaced.forEach((item, i) => positions.set(item.node.id, { x: xs[i] ?? 0, y }))
    // nodes without supporting nodes below: put at the right end for now (see below)
    const lastPlaced = sortedPlaced[sortedPlaced.length - 1]
    let next = lastPlaced ? (xs[xs.length - 1] ?? 0) + (lastPlaced.node.width ?? 0) / 2 + options.gap * 2 : 0
    for (const item of sortedLoose) {
      const width = item.node.width ?? 0
      positions.set(item.node.id, { x: next + width / 2, y })
      floating.add(item.node.id)
      next += width + options.gap
    }
  })

  // the nodes without supporting nodes which support some upper node: put them below the upper nodes
  for (const layer of bottomUp.slice(1)) {
    const attached = layer.nodes.filter(
      (node) => floating.has(node.id) && wantedX(upperOf.get(node.id), positions) !== undefined,
    )
    if (attached.length === 0) continue
    const attachedIds = new Set(attached.map((node) => node.id))
    const items = layer.nodes
      .map((node) => ({
        node,
        x: attachedIds.has(node.id)
          ? (wantedX(upperOf.get(node.id), positions) as number)
          : (positions.get(node.id)?.x ?? 0),
      }))
      // the nodes which are still floating (no upper node either) stay at the right end of the band
      .filter((item) => attachedIds.has(item.node.id) || !floating.has(item.node.id))
      .sort((a, b) => a.x - b.x || compareNames(a.node.name, b.node.name))
    const xs = spaceOutNodes(
      items.map((item) => item.x),
      items.map((item) => item.node.width ?? 0),
      options.gap,
    )
    const y = bandY.get(layer.id) ?? 0
    items.forEach((item, i) => positions.set(item.node.id, { x: xs[i] ?? 0, y }))
    // the others (no upper node either) are put at the right end of the band, apart from the others
    const lastItem = items[items.length - 1]
    let next = (xs[xs.length - 1] ?? 0) + (lastItem?.node.width ?? 0) / 2 + options.gap * 2
    for (const node of layer.nodes.filter((n) => floating.has(n.id) && !attachedIds.has(n.id))) {
      const width = node.width ?? 0
      positions.set(node.id, { x: next + width / 2, y })
      next += width + options.gap
    }
  }

  const xs = [...positions.values()].map((p: Position) => p.x)
  return {
    positions,
    bandY,
    minX: xs.length > 0 ? Math.min(...xs) : 0,
    maxX: xs.length > 0 ? Math.max(...xs) : 0,
    floating,
  }
}

/** Average x of the supporting nodes which are already placed (undefined if none) */
function wantedX(lowerIds: readonly string[] | undefined, positions: Positions): number | undefined {
  const xs = (lowerIds ?? []).flatMap((id) => {
    const p = positions.get(id)
    return p ? [p.x] : []
  })
  return xs.length > 0 ? xs.reduce((sum, x) => sum + x, 0) / xs.length : undefined
}

/** Natural order of names (numbers in names are compared as numbers: r2 < r10) */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true })
}

/**
 * Move the positions (sorted ascending) as little as possible so that neighbors are at least `gap` apart
 * (least squares; the order is kept).
 */
export function spaceOut(wanted: readonly number[], gap: number): number[] {
  return spaceOutWith(
    wanted,
    wanted.slice(1).map(() => gap),
  )
}

/** `spaceOut` for nodes with widths: the space between the edges of the neighbors is at least `gap` */
export function spaceOutNodes(wanted: readonly number[], widths: readonly number[], gap: number): number[] {
  return spaceOutWith(
    wanted,
    wanted.slice(1).map((_, i) => ((widths[i] ?? 0) + (widths[i + 1] ?? 0)) / 2 + gap),
  )
}

/**
 * Least squares with the minimum distances between neighbors (`distances[i]` is between i and i + 1).
 * Pool-adjacent-violators on the positions with the offsets (the sums of the distances) removed.
 */
export function spaceOutWith(wanted: readonly number[], distances: readonly number[]): number[] {
  const offsets: number[] = []
  wanted.forEach((_, i) => offsets.push(i === 0 ? 0 : (offsets[i - 1] ?? 0) + (distances[i - 1] ?? 0)))
  const blocks: { sum: number; count: number }[] = []
  wanted.forEach((x, i) => {
    blocks.push({ sum: x - (offsets[i] ?? 0), count: 1 })
    // merge while the mean of the previous block is larger than the mean of the last one
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]
      const prev = blocks[blocks.length - 2]
      if (!last || !prev || prev.sum / prev.count <= last.sum / last.count) break
      blocks.splice(blocks.length - 2, 2, { sum: prev.sum + last.sum, count: prev.count + last.count })
    }
  })
  const result: number[] = []
  for (const block of blocks) {
    for (let k = 0; k < block.count; k++) result.push(block.sum / block.count + (offsets[result.length] ?? 0))
  }
  return result
}

/**
 * Path of a line from `a` to `b` bent to the side by `offset` (cubic Bezier curve), so that it does not overlap
 * the straight lines between the same positions (e.g. a support which skips a layer is on the same line as the
 * support to the node of the layer between when the nodes are aligned vertically).
 */
export function detourPath(a: Position, b: Position, offset: number): string {
  const cx = (a.x + b.x) / 2 + offset
  const [y1, y2] = [a.y + (b.y - a.y) / 3, a.y + ((b.y - a.y) * 2) / 3]
  return `M${a.x},${a.y} C${cx},${y1} ${cx},${y2} ${b.x},${b.y}`
}
