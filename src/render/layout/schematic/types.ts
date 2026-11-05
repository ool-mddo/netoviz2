import type { Positions } from '../types'

/** Selector of a rule: all the parts must match (a part is `#id` or `[key=value]`; `*` is empty = matches all) */
export interface Selector {
  id?: string
  attrs: ReadonlyArray<{ key: string; value: string }>
}

export interface ProfileRule {
  select: Selector
  /** Source text of the selector (for messages) */
  selectText: string
  /** Name of the tier (one of `DiagramProfile.tiers`) */
  tier?: string
  /** Name of the captured value (see `DiagramProfile.name`) which is the group (e.g. site) of the node */
  group?: string
  /**
   * Order of the group the node belongs to among the groups (smaller = left). A group is ordered by the smallest
   * order of its nodes (groups without order follow, by name), so put it on the rule which selects the whole group.
   */
  order?: number
  /** Pair of the redundant nodes: the nodes which are the same except the value of `by` are a pair */
  pair?: { by: string; primary: string }
}

/**
 * Diagram profile: how to read the structure of a topology as a diagram (what the axes mean, which node is in
 * which group/tier). It is separated from the topology (data) as CSS is from HTML. See the design in
 * the playground `docs/work/plans/netoviz2_schematic_layout.md`.
 */
export interface DiagramProfile {
  view: string
  target: { network?: string; layer?: string }
  /** Names of the tiers from the top (upstream) to the bottom */
  tiers: string[]
  /** Regular expression with named groups to split the name of a node (matched against `name`, not the ID) */
  name?: RegExp
  /** Later rules win */
  rules: ProfileRule[]
}

/** A node given to the schematic layout (the information the other engines do not get) */
export interface SchematicNode {
  id: string
  name: string
  kind?: string
  radius: number
}

export interface SchematicLayerInput {
  layer: string
  nodes: readonly SchematicNode[]
  links: ReadonlyArray<{ source: string; target: string }>
  /** Profile for this layer (none: the layout is made without a profile) */
  profile?: DiagramProfile
}

/** Function to arrange the nodes of a layer by the schematic engine (centers of the nodes) */
export type SchematicLayerFn = (input: SchematicLayerInput) => Promise<Positions>
