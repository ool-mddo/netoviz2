/** Layout engines to compare */
export type LayoutEngine = 'force' | 'elk-layered' | 'elk-stress' | 'elk-force'

export const LAYOUT_ENGINES: ReadonlyArray<{ id: LayoutEngine; label: string }> = [
  { id: 'force', label: 'force (d3-force)' },
  { id: 'elk-layered', label: 'ELK layered' },
  { id: 'elk-stress', label: 'ELK stress' },
  { id: 'elk-force', label: 'ELK force' },
]

export const DEFAULT_LAYOUT_ENGINE: LayoutEngine = 'force'

/** @returns the engine if the value is a valid one (e.g. a value of the URL query), otherwise undefined */
export function parseLayoutEngine(value: unknown): LayoutEngine | undefined {
  return LAYOUT_ENGINES.find((engine) => engine.id === value)?.id
}

export type ElkAlgorithm = 'layered' | 'stress' | 'force'

/** @returns the algorithm of ELK for the engine (undefined for the engines which are not ELK) */
export function elkAlgorithmOf(engine: LayoutEngine): ElkAlgorithm | undefined {
  switch (engine) {
    case 'elk-layered':
      return 'layered'
    case 'elk-stress':
      return 'stress'
    case 'elk-force':
      return 'force'
    default:
      return undefined
  }
}

export interface Position {
  x: number
  y: number
}

/** Centers of the nodes by their IDs */
export type Positions = Map<string, Position>

export interface LayoutNode {
  id: string
  /** Radius of the circle of the node (the node must not overlap others) */
  radius: number
}

export interface LayoutLink {
  source: string
  target: string
}

/** Result of ELK for a layer */
export interface ElkLayoutResult {
  positions: Positions
  /** Bend points of the links (by the index in the links given to ELK), from the source to the target.
   * Links drawn straight are not in it. */
  routes: Map<number, Position[]>
}

/** Function to arrange the nodes of a layer with ELK */
export type ElkLayoutFn = (
  algorithm: ElkAlgorithm,
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
) => Promise<ElkLayoutResult>

/** Result of a layout (for comparison of the engines) */
export interface LayoutStats {
  engine: LayoutEngine
  /** Time to arrange (ms) */
  ms: number
  nodes: number
  links: number
  /** Number of the pairs of links which cross each other */
  crossings: number
  /** Sum of the depth of the overlaps between nodes */
  overlap: number
}
