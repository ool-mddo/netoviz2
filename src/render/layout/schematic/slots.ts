import { compareNames } from '../bands'
import type { Annotated } from './annotate'
import type { DiagramProfile, SchematicNode } from './types'

/** Nodes which are put side by side: a redundant pair (the primary first) or a single node */
export interface SlotUnit {
  ids: string[]
}

/** Nodes of a group (e.g. a site): the units in each row from the left */
export interface SlotGroup {
  /** Value of the group ('' for the nodes which belong to no group) */
  key: string
  cells: Map<number, SlotUnit[]>
}

/**
 * Discrete layout: which group, which row (tier) and what position in the row each node is in.
 * Rows are shared by all the groups (the same tier is at the same height in every site).
 */
export interface SlotLayout {
  /** Groups from the left */
  groups: SlotGroup[]
  /** Rows which have nodes, from the top. A row is the index of the tier in the profile (nodes without a tier: tiers.length). */
  rows: number[]
}

const SWEEPS = 6

/**
 * Assign the nodes to the groups (by `order`), rows (by tier) and positions in the row. The order in a row is
 * improved by the barycenter method (the order of the groups and the pairs are kept: a pair is moved as one unit).
 */
export function assignSlots(
  nodes: readonly SchematicNode[],
  { annotations }: Annotated,
  links: ReadonlyArray<{ source: string; target: string }>,
  profile: DiagramProfile,
): SlotLayout {
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]))
  const rowOf = (id: string) => annotations.get(id)?.tierIndex ?? profile.tiers.length
  const groupOf = (id: string) => annotations.get(id)?.group ?? ''

  // groups: by the smallest order of the members (groups without order are after them, by name); no group is the last
  const groupKeys = [...new Set(nodes.map((node) => groupOf(node.id)))]
  const orders = new Map<string, number>()
  for (const node of nodes) {
    const key = groupOf(node.id)
    const order = annotations.get(node.id)?.order ?? Number.POSITIVE_INFINITY
    orders.set(key, Math.min(orders.get(key) ?? Number.POSITIVE_INFINITY, order))
  }
  const groupOrder = (key: string) => orders.get(key) ?? Number.POSITIVE_INFINITY
  groupKeys.sort((a, b) => {
    if ((a === '') !== (b === '')) return a === '' ? 1 : -1
    const [oa, ob] = [groupOrder(a), groupOrder(b)]
    return oa === ob ? compareNames(a, b) : oa < ob ? -1 : 1
  })

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

  const rows = [...new Set(units.map((u) => u.row))].sort((a, b) => a - b)
  const groups: SlotGroup[] = groupKeys.map((key) => ({ key, cells: new Map() }))
  for (const { unit, group, row } of units) {
    const cells = groups[group]?.cells
    cells?.set(row, [...(cells.get(row) ?? []), unit])
  }
  for (const group of groups) {
    for (const cell of group.cells.values()) {
      cell.sort((a, b) => compareNames(nameOf.get(a.ids[0] ?? '') ?? '', nameOf.get(b.ids[0] ?? '') ?? ''))
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
