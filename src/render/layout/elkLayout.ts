import type { ElkAlgorithm, ElkLayoutFn, Position, Positions } from './types'

/** Space around a node in the layout of ELK (for the names and the links) */
const NODE_MARGIN = 14

const COMMON_OPTIONS = { 'elk.spacing.nodeNode': '40' }

/** Options of ELK for each algorithm */
const OPTIONS: Record<ElkAlgorithm, Record<string, string>> = {
  // hierarchical: from the top to the bottom
  layered: {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '70',
    'elk.edgeRouting': 'POLYLINE',
  },
  stress: { 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': '140' },
  force: { 'elk.algorithm': 'force' },
}

interface ElkSection {
  bendPoints?: Array<{ x: number; y: number }>
}
interface ElkEdge {
  id: string
  sections?: ElkSection[]
}
interface ElkChild {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
}
interface ElkResult {
  children?: ElkChild[]
  edges?: ElkEdge[]
}
type ElkConstructor = new () => { layout: (graph: object) => Promise<ElkResult> }

let elkPromise: Promise<InstanceType<ElkConstructor>> | null = null

/** ELK is large (about 1.5MB), so it is loaded when it is used for the first time */
function loadElk(): Promise<InstanceType<ElkConstructor>> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then((module) => {
    const Elk = module.default as unknown as ElkConstructor
    return new Elk()
  })
  return elkPromise
}

/**
 * Arrange the nodes of a layer with ELK.
 * @returns the centers of the nodes (the top-left corner of the whole layout is about (0, 0)) and the routes of the links
 */
export const layoutWithElk: ElkLayoutFn = async (algorithm, nodes, links) => {
  if (nodes.length === 0) return { positions: new Map(), routes: new Map() }
  const ids = new Set(nodes.map((node) => node.id))
  const graph = {
    id: 'root',
    layoutOptions: { ...COMMON_OPTIONS, ...OPTIONS[algorithm] },
    children: nodes.map((node) => ({
      id: node.id,
      width: (node.radius + NODE_MARGIN) * 2,
      height: (node.radius + NODE_MARGIN) * 2,
    })),
    // the ID of an edge is the index in `links`
    edges: links.flatMap((link, i) =>
      link.source !== link.target && ids.has(link.source) && ids.has(link.target)
        ? [{ id: String(i), sources: [link.source], targets: [link.target] }]
        : [],
    ),
  }
  const result = await (await loadElk()).layout(graph)
  return { positions: toPositions(result.children ?? []), routes: toRoutes(result.edges ?? []) }
}

function toPositions(children: readonly ElkChild[]): Positions {
  return new Map(
    children.map((child) => [
      child.id,
      { x: (child.x ?? 0) + (child.width ?? 0) / 2, y: (child.y ?? 0) + (child.height ?? 0) / 2 },
    ]),
  )
}

/** Bend points of the edges (edges without a bend point are drawn straight) */
function toRoutes(edges: readonly ElkEdge[]): Map<number, Position[]> {
  const routes = new Map<number, Position[]>()
  for (const edge of edges) {
    const bends = edge.sections?.[0]?.bendPoints ?? []
    if (bends.length > 0)
      routes.set(
        Number(edge.id),
        bends.map((p) => ({ x: p.x, y: p.y })),
      )
  }
  return routes
}
