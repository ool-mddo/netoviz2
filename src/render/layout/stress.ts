import { countCrossings, overlapDepth, type Segment } from '../../domain/layoutScore'
import { packBoxes } from './pack'
import type { LayoutLink, LayoutNode, Position, Positions } from './types'

/**
 * Stress majorization layout (Gansner, Koren, North: "Graph Drawing by Stress Majorization", 2004).
 *
 * The distance between two nodes in the picture is made close to the shortest-path distance in the graph,
 * where the length of a link is `edgeGap + radius of the nodes at both ends` (so large nodes are kept apart).
 * It makes nodes spread evenly and links short, with few crossings of links.
 * Connected components are arranged separately (several random starts, the best one is used) and put in a grid.
 */
export interface StressOptions {
  /** Number of the random starts for each component (it is tried more while the time is within the budget) */
  starts?: number
  /** Time to try more random starts when a layout without crossings and overlaps is not found (ms) */
  budgetMs?: number
  /** Gap between the circles of linked nodes */
  edgeGap?: number
  /** Minimum gap between the circles of any two nodes */
  nodeGap?: number
  /** Random number generator in [0, 1) (to make the result reproducible) */
  random?: () => number
}

const DEFAULTS = { starts: 6, budgetMs: 400, edgeGap: 50, nodeGap: 8 }
const MAX_ITERATIONS = 200
/** Stop the iteration when the nodes move less than this (a part of the length of a link) */
const CONVERGENCE = 0.002
/** Components are tried from several starts only up to this number of nodes */
const MULTISTART_MAX_NODES = 400
const MAX_TRIES = 12
const COMPONENT_GAP = 60
const CROSSING_WEIGHT = 100
const OVERLAP_WEIGHT = 10

export function layoutWithStress(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  options: StressOptions = {},
): Positions {
  const opt = { ...DEFAULTS, random: Math.random, ...options }
  const deadline = performance.now() + opt.budgetMs
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges = uniqueEdges(links, byId)
  const components = findComponents(nodes, edges)

  const layouts = components.map((component) => arrange(component, edges, opt, deadline))
  const boxes = layouts.map((layout, i) => ({ key: String(i), width: layout.width, height: layout.height }))
  const offsets = packBoxes(boxes, COMPONENT_GAP)
  const positions: Positions = new Map()
  layouts.forEach((layout, i) => {
    const offset = offsets.get(String(i)) ?? { x: 0, y: 0 }
    for (const [id, p] of layout.positions) positions.set(id, { x: p.x + offset.x, y: p.y + offset.y })
  })
  return positions
}

interface Edge {
  a: string
  b: string
}

/** Links between two existing nodes, without loops and duplicates (the direction is ignored) */
function uniqueEdges(links: readonly LayoutLink[], byId: ReadonlyMap<string, LayoutNode>): Edge[] {
  const seen = new Set<string>()
  const edges: Edge[] = []
  for (const { source, target } of links) {
    if (source === target || !byId.has(source) || !byId.has(target)) continue
    const key = source < target ? `${source}\n${target}` : `${target}\n${source}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ a: source, b: target })
  }
  return edges
}

function findComponents(nodes: readonly LayoutNode[], edges: readonly Edge[]): LayoutNode[][] {
  const adjacent = new Map<string, string[]>(nodes.map((node) => [node.id, []]))
  for (const { a, b } of edges) {
    adjacent.get(a)?.push(b)
    adjacent.get(b)?.push(a)
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  const components: LayoutNode[][] = []
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    const component: LayoutNode[] = []
    const stack = [node.id]
    seen.add(node.id)
    while (stack.length > 0) {
      const id = stack.pop() as string
      const found = byId.get(id)
      if (found) component.push(found)
      for (const next of adjacent.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }
    components.push(component)
  }
  return components
}

interface ComponentLayout {
  /** Centers of the nodes. The top-left corner of the circles is (0, 0). */
  positions: Positions
  width: number
  height: number
}

/** Arrange a connected component: the best of the random starts */
function arrange(
  component: readonly LayoutNode[],
  allEdges: readonly Edge[],
  opt: Required<StressOptions>,
  deadline: number,
): ComponentLayout {
  const first = component[0]
  if (component.length === 1 && first) {
    return {
      positions: new Map([[first.id, { x: first.radius, y: first.radius }]]),
      width: first.radius * 2,
      height: first.radius * 2,
    }
  }
  const ids = new Set(component.map((node) => node.id))
  const edges = allEdges.filter((edge) => ids.has(edge.a))
  const distances = shortestPaths(component, edges, opt.edgeGap)

  const minTries = component.length <= MULTISTART_MAX_NODES ? Math.max(1, opt.starts) : 1
  let best: { score: number; xs: Float64Array; ys: Float64Array } | null = null
  for (let k = 0; k < Math.max(minTries * 3, MAX_TRIES); k++) {
    if (best?.score === 0) break
    if (k >= minTries && performance.now() > deadline) break
    const { xs, ys } = stress(component, distances, opt.random)
    separate(component, xs, ys, opt.nodeGap)
    const score = scoreOf(component, edges, xs, ys)
    if (!best || score < best.score) best = { score, xs, ys }
  }
  return toLayout(
    component,
    best?.xs ?? new Float64Array(component.length),
    best?.ys ?? new Float64Array(component.length),
  )
}

/** Shortest-path distances between the nodes of a component (a link is as long as `edgeGap` + the radii) */
function shortestPaths(
  component: readonly LayoutNode[],
  edges: readonly Edge[],
  edgeGap: number,
): Float64Array {
  const n = component.length
  const index = new Map(component.map((node, i) => [node.id, i]))
  const neighbors: Array<Array<[number, number]>> = Array.from({ length: n }, () => [])
  for (const { a, b } of edges) {
    const [i, j] = [index.get(a), index.get(b)]
    if (i === undefined || j === undefined) continue
    const [na, nb] = [component[i], component[j]]
    if (!na || !nb) continue
    const length = edgeGap + na.radius + nb.radius
    neighbors[i]?.push([j, length])
    neighbors[j]?.push([i, length])
  }
  const distances = new Float64Array(n * n).fill(Infinity)
  for (let source = 0; source < n; source++)
    dijkstra(source, neighbors, distances.subarray(source * n, (source + 1) * n))
  return distances
}

function dijkstra(
  source: number,
  neighbors: ReadonlyArray<ReadonlyArray<[number, number]>>,
  out: Float64Array,
): void {
  out[source] = 0
  // a binary heap of [distance, node]
  const heap: Array<[number, number]> = [[0, source]]
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((heap[parent]?.[0] ?? 0) <= item[0]) break
      heap[i] = heap[parent] as [number, number]
      i = parent
    }
    heap[i] = item
  }
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number]
    const last = heap.pop() as [number, number]
    if (heap.length > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= heap.length) break
        if (child + 1 < heap.length && (heap[child + 1]?.[0] ?? 0) < (heap[child]?.[0] ?? 0)) child++
        if ((heap[child]?.[0] ?? 0) >= last[0]) break
        heap[i] = heap[child] as [number, number]
        i = child
      }
      heap[i] = last
    }
    return top
  }
  while (heap.length > 0) {
    const [distance, node] = pop()
    if (distance > (out[node] ?? Infinity)) continue
    for (const [next, length] of neighbors[node] ?? []) {
      const candidate = distance + length
      if (candidate < (out[next] ?? Infinity)) {
        out[next] = candidate
        push([candidate, next])
      }
    }
  }
}

/** Stress majorization from a random start (localized: the nodes are moved one by one) */
function stress(
  component: readonly LayoutNode[],
  distances: Float64Array,
  random: () => number,
): { xs: Float64Array; ys: Float64Array } {
  const n = component.length
  const size = Math.sqrt(n) * 100
  const xs = Float64Array.from({ length: n }, () => (random() - 0.5) * size)
  const ys = Float64Array.from({ length: n }, () => (random() - 0.5) * size)
  const unit = (distances.find((d) => d > 0 && Number.isFinite(d)) ?? 100) * CONVERGENCE
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      let sx = 0
      let sy = 0
      let sw = 0
      const [xi, yi] = [xs[i] ?? 0, ys[i] ?? 0]
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const d = distances[i * n + j] ?? Infinity
        const w = 1 / (d * d)
        const [dx, dy] = [xi - (xs[j] ?? 0), yi - (ys[j] ?? 0)]
        const length = Math.hypot(dx, dy) || 1e-6
        sx += w * ((xs[j] ?? 0) + (d * dx) / length)
        sy += w * ((ys[j] ?? 0) + (d * dy) / length)
        sw += w
      }
      if (sw > 0) {
        const [nx, ny] = [sx / sw, sy / sw]
        moved += Math.abs(nx - xi) + Math.abs(ny - yi)
        xs[i] = nx
        ys[i] = ny
      }
    }
    if (moved < unit * n) break
  }
  return { xs, ys }
}

/** Push apart the nodes which are too near each other (the circles of the radii and the gap must not overlap) */
function separate(component: readonly LayoutNode[], xs: Float64Array, ys: Float64Array, gap: number): void {
  const n = component.length
  for (let pass = 0; pass < 50; pass++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const need = (component[i]?.radius ?? 0) + (component[j]?.radius ?? 0) + gap
        const [dx, dy] = [(xs[j] ?? 0) - (xs[i] ?? 0), (ys[j] ?? 0) - (ys[i] ?? 0)]
        const length = Math.hypot(dx, dy)
        if (length >= need) continue
        const [ux, uy] = length > 1e-9 ? [dx / length, dy / length] : [1, 0]
        const push = (need - length) / 2
        xs[i] = (xs[i] ?? 0) - ux * push
        ys[i] = (ys[i] ?? 0) - uy * push
        xs[j] = (xs[j] ?? 0) + ux * push
        ys[j] = (ys[j] ?? 0) + uy * push
        moved = true
      }
    }
    if (!moved) break
  }
}

/** Quality of a layout of a component (the lower, the better): crossings of links and overlaps of nodes */
function scoreOf(
  component: readonly LayoutNode[],
  edges: readonly Edge[],
  xs: Float64Array,
  ys: Float64Array,
): number {
  const index = new Map(component.map((node, i) => [node.id, i]))
  const point = (id: string): Position => ({ x: xs[index.get(id) ?? 0] ?? 0, y: ys[index.get(id) ?? 0] ?? 0 })
  const segments: Segment[] = edges.map((edge) => ({
    u: edge.a,
    v: edge.b,
    a: point(edge.a),
    b: point(edge.b),
  }))
  const circles = component.map((node, i) => ({ x: xs[i] ?? 0, y: ys[i] ?? 0, r: node.radius }))
  return countCrossings(segments) * CROSSING_WEIGHT + overlapDepth(circles) * OVERLAP_WEIGHT
}

/** Move the layout so that the top-left corner of the circles is (0, 0) */
function toLayout(component: readonly LayoutNode[], xs: Float64Array, ys: Float64Array): ComponentLayout {
  const left = Math.min(...component.map((node, i) => (xs[i] ?? 0) - node.radius))
  const top = Math.min(...component.map((node, i) => (ys[i] ?? 0) - node.radius))
  const right = Math.max(...component.map((node, i) => (xs[i] ?? 0) + node.radius))
  const bottom = Math.max(...component.map((node, i) => (ys[i] ?? 0) + node.radius))
  const positions: Positions = new Map(
    component.map((node, i) => [node.id, { x: (xs[i] ?? 0) - left, y: (ys[i] ?? 0) - top }]),
  )
  return { positions, width: right - left, height: bottom - top }
}
