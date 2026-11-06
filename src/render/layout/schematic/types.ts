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
 * `docs/design/schematic_layout.md`.
 */
export interface DiagramProfile {
  view: string
  /** Where the profile is applied (an omitted item accepts anything): `snapshot` is matched as a whole name */
  target: { network?: string; snapshot?: RegExp; layer?: string }
  /** Names of the tiers from the top (upstream) to the bottom */
  tiers: string[]
  /** Regular expression with named groups to split the name of a node (matched against `name`, not the ID) */
  name?: RegExp
  /** The layer whose group / tier / order are inherited through the supports (default: found automatically) */
  inherit?: { from: string }
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

/** Exception from the pattern which the profile expresses (it is told to the user: "emphasize the exceptions") */
export interface SchematicViolation {
  id: string
  /** unclassified: no tier is given to the node. unpaired: the node has no partner of the redundant pair. */
  code: 'unclassified' | 'unpaired'
  message: string
}

/**
 * A lower layer whose arrangement (group / tier / order) is inherited through the supports: its nodes and links, and
 * which of its nodes support each node of the layer (through the chain of node supports).
 */
export interface SchematicBase {
  layer: string
  nodes: readonly SchematicNode[]
  links: ReadonlyArray<{ source: string; target: string }>
  /** For each node of the layer, the nodes of this base layer which support it */
  lowerOf: ReadonlyMap<string, readonly string[]>
  /** Profile for the base layer (none: it is inferred) */
  profile?: DiagramProfile
}

/** What the schematic layout of a layer was made from, and the exceptions */
export interface SchematicReport {
  layer: string
  /**
   * profile: the given profile. inferred: the profile inferred from the names and the links. inherited: the arrangement
   * of the lower layer `base`. none: no profile (stress).
   */
  source: 'profile' | 'inferred' | 'inherited' | 'none'
  /** The layer which the arrangement is inherited from (source is inherited) */
  base?: string
  violations: SchematicViolation[]
  /** The inferred profile as YAML (the draft which a person can correct and keep) */
  draft?: string
}

export interface SchematicLayerInput {
  layer: string
  nodes: readonly SchematicNode[]
  links: ReadonlyArray<{ source: string; target: string }>
  /** Profile for this layer (none: the profile is inferred from the names and the links) */
  profile?: DiagramProfile
  /** Lower layers to inherit the arrangement from, in the order to try (the lowest layer first) */
  bases?: readonly SchematicBase[]
  /** Called with what the layout was made from and the exceptions */
  report?: (report: SchematicReport) => void
}

/** Function to arrange the nodes of a layer by the schematic engine (centers of the nodes) */
export type SchematicLayerFn = (input: SchematicLayerInput) => Promise<Positions>
