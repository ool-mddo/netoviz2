import type { Position, Positions } from './types'

/** A layer of the bands. The layers are given from the top to the bottom */
export interface BandLayer {
  id: string
  nodes: ReadonlyArray<{ id: string; name: string }>
}

/** Support between nodes: `from` (upper) is supported by `to` (lower) */
export interface BandEdge {
  from: string
  to: string
}

export interface BandOptions {
  /** Minimum distance between the centers of the nodes in a band */
  gap: number
  /** Distance between the centers of the bands (vertical) */
  bandSpacing: number
}

export const DEFAULT_BAND_OPTIONS: BandOptions = { gap: 40, bandSpacing: 140 }

export interface BandLayout {
  positions: Positions
  /** Vertical center of each layer */
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
  for (const edge of edges) {
    const list = lowerOf.get(edge.from)
    if (list) list.push(edge.to)
    else lowerOf.set(edge.from, [edge.to])
  }

  const positions: Positions = new Map()
  const bandY = new Map<string, number>()
  const floating = new Set<string>()
  const bottomUp = [...layers].reverse()

  bottomUp.forEach((layer, row) => {
    const y = row * options.bandSpacing
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
      const xs = spaceOut(
        sortedLoose.map((_, i) => i * options.gap),
        options.gap,
      )
      sortedLoose.forEach((item, i) => positions.set(item.node.id, { x: xs[i] ?? 0, y }))
      return
    }

    const xs = spaceOut(
      sortedPlaced.map((item) => item.x),
      options.gap,
    )
    sortedPlaced.forEach((item, i) => positions.set(item.node.id, { x: xs[i] ?? 0, y }))
    // nodes without supporting nodes below: at the right end (apart from the others)
    let next = xs.length > 0 ? (xs[xs.length - 1] ?? 0) + options.gap * 2 : 0
    for (const item of sortedLoose) {
      positions.set(item.node.id, { x: next, y })
      floating.add(item.node.id)
      next += options.gap
    }
  })

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
 * (least squares; the order is kept). Pool-adjacent-violators on the positions with the offset `i * gap` removed.
 */
export function spaceOut(wanted: readonly number[], gap: number): number[] {
  const blocks: { sum: number; count: number }[] = []
  wanted.forEach((x, i) => {
    blocks.push({ sum: x - i * gap, count: 1 })
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
    for (let k = 0; k < block.count; k++) result.push(block.sum / block.count + result.length * gap)
  }
  return result
}
