import { compareNames } from '../bands'
import type { Annotated, NodeAnnotation } from './annotate'
import type { SchematicNode } from './types'

/** Nodes which are put side by side: a redundant pair (the primary first) or a single node */
export interface SlotUnit {
  ids: string[]
}

/** Nodes of a group (e.g. a site): the units in each row from the left */
export interface SlotGroup {
  /** Value of the group ('' for the nodes which belong to no group) */
  key: string
  cells: Map<number, SlotUnit[]>
  /** The rows of the group are centered on the axis of the group (on when any node of the group has `align: center`) */
  align?: 'center'
}

/**
 * Discrete layout: which group, which row (tier) and what position in the row each node is in.
 * Rows are shared by all the groups (the same tier is at the same height in every site).
 */
export interface SlotLayout {
  /** Groups from the left */
  groups: SlotGroup[]
  /** Rows which have nodes, from the top. A row is the index of the tier; the nodes without a tier are in `unclassifiedRow`. */
  rows: number[]
}

export interface SlotOptions {
  /** Row for the nodes without a tier (after the last tier) */
  unclassifiedRow: number
  /**
   * Initial order of the nodes in a row (e.g. the x of the lower layer which they are inherited from). Without links
   * the barycenter method does not change it: the arrangement is the same as the one of the lower layer.
   */
  hints?: ReadonlyMap<string, number>
  /** Number of the tiers: the rows 0 .. keepTiers - 1 are kept even if no node is in them (`keepEmptyTiers`) */
  keepTiers?: number
}

const SWEEPS = 6

/**
 * Groups from the left: by the smallest order of the members (groups without order are after them, by name); the nodes
 * which belong to no group ('') are the last.
 */
function rankGroups(annotations: Iterable<Pick<NodeAnnotation, 'group' | 'order'>>): string[] {
  const orders = new Map<string, number>()
  for (const { group = '', order = Number.POSITIVE_INFINITY } of annotations) {
    orders.set(group, Math.min(orders.get(group) ?? Number.POSITIVE_INFINITY, order))
  }
  return [...orders.keys()].sort((a, b) => {
    if ((a === '') !== (b === '')) return a === '' ? 1 : -1
    const [oa, ob] = [orders.get(a) ?? Number.POSITIVE_INFINITY, orders.get(b) ?? Number.POSITIVE_INFINITY]
    return oa === ob ? compareNames(a, b) : oa < ob ? -1 : 1
  })
}

/**
 * Assign the nodes to the groups (by `order`), rows (by tier) and positions in the row. The order in a row is
 * improved by the barycenter method (the order of the groups and the pairs are kept: a pair is moved as one unit).
 */
export function assignSlots(
  nodes: readonly SchematicNode[],
  { annotations }: Annotated,
  links: ReadonlyArray<{ source: string; target: string }>,
  { unclassifiedRow, hints, keepTiers }: SlotOptions,
): SlotLayout {
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]))
  const rowOf = (id: string) => annotations.get(id)?.tierIndex ?? unclassifiedRow
  const groupOf = (id: string) => annotations.get(id)?.group ?? ''

  const groupKeys = rankGroups(
    nodes.map((node) => ({ group: annotations.get(node.id)?.group, order: annotations.get(node.id)?.order })),
  )

  // units: the pair members of the same group and row are one unit
  const unitOf = new Map<string, SlotUnit>()
  const units: Array<{ unit: SlotUnit; group: number; row: number }> = []
  for (const node of nodes) {
    const annotation = annotations.get(node.id)
    const [group, row] = [groupKeys.indexOf(groupOf(node.id)), rowOf(node.id)]
    const key = annotation?.pair ? `${annotation.pair.key}@${row}@${group}` : node.id
    let unit = unitOf.get(key)
    if (!unit) {
      unit = { ids: [] }
      unitOf.set(key, unit)
      units.push({ unit, group, row })
    }
    unit.ids.push(node.id)
  }
  for (const { unit } of units) {
    unit.ids.sort((a, b) => {
      const [pa, pb] = [annotations.get(a)?.pair?.primary ? 0 : 1, annotations.get(b)?.pair?.primary ? 0 : 1]
      return pa !== pb ? pa - pb : compareNames(nameOf.get(a) ?? a, nameOf.get(b) ?? b)
    })
  }

  const kept = Array.from({ length: keepTiers ?? 0 }, (_, i) => i)
  const rows = [...new Set([...kept, ...units.map((u) => u.row)])].sort((a, b) => a - b)
  const groups: SlotGroup[] = groupKeys.map((key) => ({ key, cells: new Map() }))
  for (const node of nodes) {
    if (annotations.get(node.id)?.align === 'center') {
      const group = groups[groupKeys.indexOf(groupOf(node.id))]
      if (group) group.align = 'center'
    }
  }
  for (const { unit, group, row } of units) {
    const cells = groups[group]?.cells
    cells?.set(row, [...(cells.get(row) ?? []), unit])
  }
  // initial order: the hints (the order of the lower layer) if given, otherwise the names
  const hintOf = (unit: SlotUnit): number => {
    if (!hints) return 0
    const values = unit.ids.flatMap((id) => (hints.has(id) ? [hints.get(id)!] : []))
    return values.length === 0 ? Number.POSITIVE_INFINITY : values.reduce((s, v) => s + v, 0) / values.length
  }
  for (const group of groups) {
    for (const cell of group.cells.values()) {
      cell.sort(
        (a, b) =>
          hintOf(a) - hintOf(b) ||
          compareNames(nameOf.get(a.ids[0] ?? '') ?? '', nameOf.get(b.ids[0] ?? '') ?? ''),
      )
    }
  }

  // barycenter sweeps: the position of a node is (index of its group) + (position in its cell, in [0, 1))
  const neighbors = new Map<string, string[]>()
  for (const { source, target } of links) {
    if (!nameOf.has(source) || !nameOf.has(target) || source === target) continue
    neighbors.set(source, [...(neighbors.get(source) ?? []), target])
    neighbors.set(target, [...(neighbors.get(target) ?? []), source])
  }
  const xkey = new Map<string, number>()
  const updateKeys = (group: SlotGroup, groupIndex: number, row: number) => {
    const cell = group.cells.get(row) ?? []
    cell.forEach((unit, i) => unit.ids.forEach((id) => xkey.set(id, groupIndex + (i + 0.5) / cell.length)))
  }
  groups.forEach((group, gi) => rows.forEach((row) => updateKeys(group, gi, row)))

  const sweep = (rowList: readonly number[], up: boolean) => {
    for (const row of rowList) {
      groups.forEach((group, gi) => {
        const cell = group.cells.get(row)
        if (!cell) return
        const bary = new Map<SlotUnit, number>()
        for (const unit of cell) {
          const xs = unit.ids.flatMap((id) =>
            (neighbors.get(id) ?? [])
              .filter((n) => (up ? rowOf(n) > row : rowOf(n) < row))
              .map((n) => xkey.get(n) ?? 0),
          )
          const own = unit.ids.map((id) => xkey.get(id) ?? 0)
          bary.set(
            unit,
            xs.length > 0
              ? xs.reduce((s, x) => s + x, 0) / xs.length
              : own.reduce((s, x) => s + x, 0) / own.length,
          )
        }
        // Array.prototype.sort is stable: units with the same value keep their order
        cell.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0))
        updateKeys(group, gi, row)
      })
    }
  }
  for (let i = 0; i < SWEEPS; i++) {
    if (i % 2 === 0) sweep(rows, false)
    else sweep([...rows].reverse(), true)
  }

  return { groups, rows }
}
