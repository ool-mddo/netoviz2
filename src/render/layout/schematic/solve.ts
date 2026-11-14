import { spaceOutWith } from '../bands'
import type { Positions } from '../types'
import type { SlotLayout } from './slots'
import type { SchematicNode } from './types'

export interface SolveOptions {
  /** Gap between the circles of nodes in a group */
  nodeGap?: number
  /** Gap between the circles of a redundant pair */
  pairGap?: number
  /** Gap between the circles of nodes of different groups */
  groupGap?: number
  /** Gap between the circles of rows */
  rowGap?: number
  iterations?: number
  /**
   * Positions (x) to start from, e.g. of the lower layer which the arrangement is inherited from. With `iterations: 0`
   * the positions are kept as far as the order and the gaps allow (the links are not made straight).
   */
  initialX?: ReadonlyMap<string, number>
  /**
   * Mirror symmetry of the groups: each pair of `mirror` is put at the same distance on both sides of the center of
   * the `axis` group (see `DiagramProfile.symmetry`). Groups which do not exist are ignored.
   */
  symmetry?: { axis: string; mirror: ReadonlyArray<readonly [string, string]> }
}

const DEFAULTS = { nodeGap: 60, pairGap: 60, groupGap: 160, rowGap: 120, iterations: 40 }
/** Part of the distance to the wanted position which is moved in an iteration */
const STEP = 0.6

/** Nodes of a row from the left. `distances[i]` is the minimum distance between the centers of i and i + 1. */
interface Row {
  ids: string[]
  distances: number[]
  /** The nodes are a pair with the next one (the first of a pair of two) */
  firstOfPair: boolean[]
}

/**
 * Convert the slots to coordinates.
 * - y: all the nodes of a row are at the same height.
 * - x: each row is solved by the least squares with the order and the minimum gaps (`spaceOutWith`: PAV). The wanted
 *   position of a node is the mean of the positions of its neighbors in the other rows (the links are made straight).
 *   A pair is centered on the wanted position of both nodes.
 *   The groups are kept apart through all the rows: the nodes of a group (in all the rows) are a block, and the blocks
 *   are solved in the same way (so a group is a column even if the rows have different numbers of nodes).
 */
export function solvePositions(
  nodes: readonly SchematicNode[],
  layout: SlotLayout,
  links: ReadonlyArray<{ source: string; target: string }>,
  options: SolveOptions = {},
): Positions {
  const opt = { ...DEFAULTS, ...options }
  const radiusOf = new Map(nodes.map((node) => [node.id, node.radius]))
  const radius = (id: string) => radiusOf.get(id) ?? 0

  const rows = layout.rows.map((rowIndex): Row => {
    const row: Row = { ids: [], distances: [], firstOfPair: [] }
    let previous: { id: string; group: number; unit: object } | null = null
    layout.groups.forEach((group, groupIndex) => {
      for (const unit of group.cells.get(rowIndex) ?? []) {
        for (const id of unit.ids) {
          if (previous) {
            const gap =
              previous.group !== groupIndex
                ? opt.groupGap
                : previous.unit !== unit
                  ? opt.nodeGap
                  : opt.pairGap
            row.distances.push(radius(previous.id) + radius(id) + gap)
          }
          row.firstOfPair.push(unit.ids.length === 2 && unit.ids[0] === id)
          row.ids.push(id)
          previous = { id, group: groupIndex, unit }
        }
      }
    })
    return row
  })

  // y: the rows from the top
  const y = new Map<string, number>()
  let top = 0
  const emptyHalf = Math.max(0, ...nodes.map((node) => node.radius)) // an empty row (`keepEmptyTiers`) is as high as the largest
  for (const row of rows) {
    const half = row.ids.length === 0 ? emptyHalf : Math.max(0, ...row.ids.map(radius))
    const center = top + half
    for (const id of row.ids) y.set(id, center)
    top = center + half + opt.rowGap
  }

  // x: start with the given positions, or with the rows packed to the left and centered on 0 (the iterations make the
  // links straight)
  const x = new Map<string, number>()
  for (const row of rows) {
    if (opt.initialX) {
      // a node without a position follows the node before it in the row
      let previous = 0
      const wanted = row.ids.map((id) => (previous = opt.initialX?.get(id) ?? previous))
      const start = spaceOutWith(wanted, row.distances)
      row.ids.forEach((id, i) => x.set(id, start[i] ?? 0))
      continue
    }
    const start = spaceOutWith(
      row.ids.map(() => 0),
      row.distances,
    )
    const mid = ((start[0] ?? 0) + (start[start.length - 1] ?? 0)) / 2
    row.ids.forEach((id, i) => x.set(id, (start[i] ?? 0) - mid))
  }

  const rowOfNode = new Map<string, number>()
  rows.forEach((row, ri) => row.ids.forEach((id) => rowOfNode.set(id, ri)))
  const neighbors = new Map<string, string[]>()
  for (const { source, target } of links) {
    const [rs, rt] = [rowOfNode.get(source), rowOfNode.get(target)]
    if (rs === undefined || rt === undefined || rs === rt) continue // only the links between rows are made straight
    neighbors.set(source, [...(neighbors.get(source) ?? []), target])
    neighbors.set(target, [...(neighbors.get(target) ?? []), source])
  }
  const targetOf = (id: string): number | undefined => {
    const xs = (neighbors.get(id) ?? []).map((n) => x.get(n) ?? 0)
    return xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : undefined
  }

  // blocks: the nodes of each group in all the rows, from the left
  const blocks = layout.groups
    .map((group) => [...group.cells.values()].flatMap((cell) => cell.flatMap((unit) => unit.ids)))
    .filter((ids) => ids.length > 0)
  // align: center: the rows of the group are centered on the axis of the group (the center of its extent). A row
  // stays inside the extent, so it does not overlap the other groups; the extent may grow (the widest row is
  // centered, too), which `spaceOutBlocks` solves by moving the blocks as a whole (it keeps the symmetry).
  const centerAlignedRows = () => {
    layout.groups.forEach((group) => {
      if (group.align !== 'center') return
      const ids = [...group.cells.values()].flatMap((cell) => cell.flatMap((unit) => unit.ids))
      if (ids.length === 0) return
      const axis =
        (Math.min(...ids.map((id) => (x.get(id) ?? 0) - radius(id))) +
          Math.max(...ids.map((id) => (x.get(id) ?? 0) + radius(id)))) /
        2
      for (const cell of group.cells.values()) {
        const rowIds = cell.flatMap((unit) => unit.ids)
        const center =
          (Math.min(...rowIds.map((id) => (x.get(id) ?? 0) - radius(id))) +
            Math.max(...rowIds.map((id) => (x.get(id) ?? 0) + radius(id)))) /
          2
        for (const id of rowIds) x.set(id, (x.get(id) ?? 0) + axis - center)
      }
    })
  }
  // symmetry: each pair of groups is put at the same distance on both sides of the center of the axis group: the
  // farther one stays, the nearer one moves outward (so that the blocks do not come closer than `spaceOutBlocks`
  // made them). The blocks are moved as a whole, so `spaceOutBlocks` has to run after this (it moves them only if
  // they overlap another block: then the symmetry may not hold).
  const blockOf = (key: string): string[] | undefined => {
    const group = layout.groups.find((g) => g.key === key)
    const ids = group ? [...group.cells.values()].flatMap((cell) => cell.flatMap((unit) => unit.ids)) : []
    return ids.length > 0 ? ids : undefined
  }
  const extentOf = (ids: readonly string[]) => ({
    min: Math.min(...ids.map((id) => (x.get(id) ?? 0) - radius(id))),
    max: Math.max(...ids.map((id) => (x.get(id) ?? 0) + radius(id))),
  })
  const mirrorBlocks = () => {
    if (!opt.symmetry) return
    const axisIds = blockOf(opt.symmetry.axis)
    if (!axisIds) return
    const axisExtent = extentOf(axisIds)
    const axis = (axisExtent.min + axisExtent.max) / 2
    for (const [a, b] of opt.symmetry.mirror) {
      const [idsA, idsB] = [blockOf(a), blockOf(b)]
      if (!idsA || !idsB) continue
      const centers = [idsA, idsB].map((ids) => {
        const e = extentOf(ids)
        return (e.min + e.max) / 2
      }) as [number, number]
      // the one on the left (the smaller center) goes to the left
      const [left, right] = centers[0] <= centers[1] ? [idsA, idsB] : [idsB, idsA]
      const [cl, cr] = centers[0] <= centers[1] ? centers : [centers[1], centers[0]]
      const distance = Math.max(axis - cl, cr - axis, 0)
      for (const id of left) x.set(id, (x.get(id) ?? 0) + (axis - distance - cl))
      for (const id of right) x.set(id, (x.get(id) ?? 0) + (axis + distance - cr))
    }
  }
  const spaceOutBlocks = () => {
    if (blocks.length < 2) return
    const extents = blocks.map((ids) => ({
      min: Math.min(...ids.map((id) => (x.get(id) ?? 0) - radius(id))),
      max: Math.max(...ids.map((id) => (x.get(id) ?? 0) + radius(id))),
    }))
    const half = extents.map((e) => (e.max - e.min) / 2)
    const solved = spaceOutWith(
      extents.map((e) => (e.min + e.max) / 2),
      half.slice(1).map((h, i) => (half[i] ?? 0) + h + opt.groupGap),
    )
    blocks.forEach((ids, i) => {
      const extent = extents[i]
      if (!extent) return
      const delta = (solved[i] ?? 0) - (extent.min + extent.max) / 2
      for (const id of ids) x.set(id, (x.get(id) ?? 0) + delta)
    })
  }

  for (let iteration = 0; iteration < opt.iterations; iteration++) {
    for (const row of rows) {
      const wanted = row.ids.map((id) => {
        const current = x.get(id) ?? 0
        const target = targetOf(id)
        return target === undefined ? current : current + STEP * (target - current)
      })
      // a pair is centered on the mean of the wanted positions of both (the distance between them is kept)
      row.ids.forEach((_, i) => {
        if (!row.firstOfPair[i]) return
        const [a, b] = [row.ids[i] ?? '', row.ids[i + 1] ?? '']
        const [ta, tb] = [targetOf(a), targetOf(b)]
        if (ta === undefined && tb === undefined) return
        const [xa, xb] = [x.get(a) ?? 0, x.get(b) ?? 0]
        const half = (row.distances[i] ?? 0) / 2
        const center = (xa + xb) / 2
        const wantedCenter = center + STEP * (((ta ?? xa) + (tb ?? xb)) / 2 - center)
        wanted[i] = wantedCenter - half
        wanted[i + 1] = wantedCenter + half
      })
      const solved = spaceOutWith(wanted, row.distances)
      row.ids.forEach((id, i) => x.set(id, solved[i] ?? 0))
    }
    spaceOutBlocks()
    centerAlignedRows()
    mirrorBlocks()
  }

  if (opt.initialX) spaceOutBlocks() // the groups are kept apart through all the rows
  if (layout.groups.some((group) => group.align === 'center') || opt.symmetry) {
    centerAlignedRows()
    mirrorBlocks()
    spaceOutBlocks()
  }

  // center the diagram on 0
  const xs = [...x.values()]
  const shift = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0
  const positions: Positions = new Map()
  for (const [id, px] of x) positions.set(id, { x: px - shift, y: y.get(id) ?? 0 })
  return positions
}
