/**
 * Layout engines:
 * - force: d3-force (a simulation; the layout is made several times from random starts and the best one is used)
 * - stress: stress majorization (own implementation, see stress.ts)
 */
export type LayoutEngine = 'force' | 'stress'

export const LAYOUT_ENGINES: ReadonlyArray<{ id: LayoutEngine; label: string }> = [
  { id: 'force', label: 'force (d3-force)' },
  { id: 'stress', label: 'stress' },
]

/** Layout engine used when it is not specified */
export const DEFAULT_LAYOUT_ENGINE: LayoutEngine = 'stress'

/** @returns the engine if the value is a valid one (e.g. a value of the URL query), otherwise undefined */
export function parseLayoutEngine(value: unknown): LayoutEngine | undefined {
  return LAYOUT_ENGINES.find((engine) => engine.id === value)?.id
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

/** Function to arrange the nodes of a layer (the engines other than force) */
export type LayerLayoutFn = (nodes: readonly LayoutNode[], links: readonly LayoutLink[]) => Promise<Positions>

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
