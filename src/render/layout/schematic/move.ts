import type { Position, Positions } from '../types'
import { placeConnectors } from './connectors'
import type { SchematicStructure } from './types'

/** What is moved with the dragged node: itself, the nodes in a row (same y) or in a column (same x) of its layer */
export type MoveScope = 'node' | 'row' | 'column'

export interface MoveRequest {
  /** The node being dragged */
  id: string
  scope: MoveScope
  /** Positions of the nodes when the drag started */
  from: ReadonlyMap<string, Position>
  /** Movement from the start of the drag */
  delta: Position
  /** Arrangements of the layers shown (by the layer ID; a layer without one is moved as it is) */
  structures: ReadonlyMap<string, SchematicStructure>
  /** The layer of a node */
  layerOf: (id: string) => string | undefined
  radiusOf: (id: string) => number
  /** Connection points which the user placed by hand: they are not put between the devices again */
  pinned?: ReadonlySet<string>
}

/** Nodes of a row / column are the ones on the same line (a slack for the coordinates which are calculated) */
const SAME_LINE = 0.5

/** Round the movement to the grid (the movement, not the position: the nodes stay aligned as they were) */
export function snapDelta(delta: Position, grid: number): Position {
  if (grid <= 0) return delta
  return { x: Math.round(delta.x / grid) * grid, y: Math.round(delta.y / grid) * grid }
}

/**
 * The nodes which move with the dragged node: the devices in its row / column of the layer, and the devices of the
 * other layers which follow them (the arrangement is inherited) or which they follow when the device is the only one
 * which follows the node (the same node in the diagrams of the layers). A node which follows a node supporting many
 * others (e.g. an interface of a device) does not move the node it follows.
 */
export function movingNodes(request: MoveRequest): Set<string> {
  const { id, scope, from, structures, layerOf } = request
  const layer = layerOf(id)
  const isConnector = (node: string): boolean =>
    structures.get(layerOf(node) ?? '')?.connectors.some((c) => c.id === node) ?? false

  const moving = new Set<string>([id])
  const start = from.get(id)
  if (scope !== 'node' && start && !isConnector(id)) {
    for (const [node, p] of from) {
      if (layerOf(node) !== layer || isConnector(node)) continue
      if (Math.abs(scope === 'row' ? p.y - start.y : p.x - start.x) < SAME_LINE) moving.add(node)
    }
  }
  if (isConnector(id)) return moving // (a connection point is moved by itself)

  // who follows whom, over the layers: node => the nodes which follow it
  const followers = new Map<string, string[]>()
  for (const { follows } of structures.values()) {
    for (const [node, base] of follows) followers.set(base, [...(followers.get(base) ?? []), node])
  }
  const queue = [...moving]
  const add = (node: string) => {
    if (!from.has(node) || moving.has(node)) return
    moving.add(node)
    queue.push(node)
  }
  while (queue.length > 0) {
    const node = queue.pop()!
    for (const follower of followers.get(node) ?? []) add(follower)
    // the node it follows moves too if the node is the only one which follows it in the layer
    const base = structures.get(layerOf(node) ?? '')?.follows.get(node)
    if (base === undefined) continue
    const siblings = (followers.get(base) ?? []).filter((n) => layerOf(n) === layerOf(node))
    if (siblings.length === 1) add(base)
  }
  return moving
}

/**
 * Positions of the nodes whose position changes by the drag: the moving nodes are moved by the movement, and then the
 * connection points of the layers are put between the devices again (except the ones placed by hand).
 */
export function moveNodes(request: MoveRequest): Positions {
  const { from, delta, structures, layerOf, radiusOf, pinned } = request
  const moving = movingNodes(request)
  const result: Positions = new Map()
  for (const node of moving) {
    const p = from.get(node)
    if (p) result.set(node, { x: p.x + delta.x, y: p.y + delta.y })
  }
  const layers = new Set([...moving].flatMap((node) => layerOf(node) ?? []))
  for (const layer of layers) {
    const structure = structures.get(layer)
    if (!structure) continue
    const free = structure.connectors.filter((c) => !pinned?.has(c.id) && !moving.has(c.id))
    if (free.length === 0) continue
    const freeIds = new Set(free.map((c) => c.id))
    const placed: Positions = new Map()
    for (const [node, p] of from) {
      if (layerOf(node) === layer && !freeIds.has(node)) placed.set(node, result.get(node) ?? p)
    }
    for (const [node, p] of placeConnectors(free, structure.links, placed, radiusOf)) result.set(node, p)
  }
  return result
}
