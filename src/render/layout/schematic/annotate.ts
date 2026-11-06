import type { DiagramProfile, SchematicNode, Selector } from './types'

/** Meaning given to a node by the profile (step 1 of the schematic layout) */
export interface NodeAnnotation {
  id: string
  /** Values captured from the name by the regular expression of the profile (empty if the name does not match) */
  captures: Readonly<Record<string, string>>
  /** Name of the tier and its index in `DiagramProfile.tiers` (smaller = upstream) */
  tier?: string
  tierIndex?: number
  /** Group (e.g. site) the node belongs to */
  group?: string
  /** Order of the node among the siblings (smaller = left) */
  order?: number
  /** Redundant pair: nodes with the same `key` are the pair, the primary one is put on the left */
  pair?: { key: string; primary: boolean }
}

export interface Annotated {
  annotations: Map<string, NodeAnnotation>
  /** Nodes which no rule gave a tier to (they cannot be put in a row) */
  unclassified: string[]
  /** Nodes which a rule made to be a pair but which have no partner */
  unpaired: string[]
}

function matches(
  selector: Selector,
  node: SchematicNode,
  captures: Readonly<Record<string, string>>,
): boolean {
  if (selector.id !== undefined && selector.id !== node.id && selector.id !== node.name) return false
  return selector.attrs.every(({ key, value }) => {
    // a captured value is preferred to the built-in attributes (`kind`, `name`) of the same name
    const actual = captures[key] ?? (key === 'kind' ? node.kind : key === 'name' ? node.name : undefined)
    return actual === value
  })
}

/**
 * Give tier / group / order / pair to the nodes by the rules of the profile: the name of the node is split by
 * the regular expression of the profile, and the rules are applied in the order (the later rule wins for each
 * property). It does not branch by the kind of nodes or by the naming of a use case: it is all in the profile.
 * `#id` of a selector matches the ID or the name of a node.
 */
export function annotate(nodes: readonly SchematicNode[], profile: DiagramProfile): Annotated {
  const annotations = new Map<string, NodeAnnotation>()
  const pairBy = new Map<string, { by: string; primary: string }>()
  for (const node of nodes) {
    // optional named groups which did not match are undefined: they are not captured
    const captures = Object.fromEntries(
      Object.entries(profile.name?.exec(node.name)?.groups ?? {}).filter(([, value]) => value !== undefined),
    ) as Record<string, string>
    const annotation: NodeAnnotation = { id: node.id, captures }
    for (const rule of profile.rules) {
      if (!matches(rule.select, node, captures)) continue
      if (rule.tier !== undefined) {
        annotation.tier = rule.tier
        annotation.tierIndex = profile.tiers.indexOf(rule.tier)
      }
      if (rule.group !== undefined) {
        const group = captures[rule.group]
        if (group === undefined) delete annotation.group
        else annotation.group = group
      }
      if (rule.order !== undefined) annotation.order = rule.order
      if (rule.pair !== undefined) pairBy.set(node.id, rule.pair)
    }
    annotations.set(node.id, annotation)
  }

  // Pair: the nodes which have the same values except the one of `by` (e.g. the same site and role, different index).
  // A node without a partner is not a pair. Three or more nodes are one pair-like unit (placed side by side, the
  // primary first, but not centered as a pair).
  const pairs = new Map<string, NodeAnnotation[]>()
  for (const [id, { by }] of pairBy) {
    const annotation = annotations.get(id)
    if (!annotation || annotation.captures[by] === undefined) continue
    const key = `${by}|${annotation.group ?? ''}|${Object.entries(annotation.captures)
      .filter(([name]) => name !== by)
      .map(([name, value]) => `${name}=${value}`)
      .join(',')}`
    pairs.set(key, [...(pairs.get(key) ?? []), annotation])
  }
  for (const [key, members] of pairs) {
    if (members.length < 2) continue
    for (const member of members) {
      const rule = pairBy.get(member.id)
      if (rule) member.pair = { key, primary: member.captures[rule.by] === rule.primary }
    }
  }

  const unclassified = [...annotations.values()].filter((a) => a.tier === undefined).map((a) => a.id)
  // (a node without a tier is reported as unclassified only)
  const unpaired = [...pairBy.keys()].filter((id) => {
    const annotation = annotations.get(id)
    return annotation?.pair === undefined && annotation?.tier !== undefined
  })
  return { annotations, unclassified, unpaired }
}
