import { stringify } from 'yaml'
import { compareNames } from '../bands'
import { dominantShape, regexSourceOf, type Token } from './nameShape'
import { ProfileError, parseProfile } from './profile'
import type { DiagramProfile, SchematicNode } from './types'

export interface Inferred {
  profile: DiagramProfile
  /** The profile as a YAML text: the draft which a person can correct and keep */
  yaml: string
}

type Link = { source: string; target: string }

/** A token position is the site if links join the nodes with the same value at least at this rate (the role is the lowest of the rest) */
const SITE_MIN_HOMOPHILY = 0.6
/** The most tiers (roles) which are taken as a diagram: more is a token which is almost unique, not a role */
const MAX_TIERS = 12
/** Nodes are a pair if their neighbors (except themselves) overlap at least at this rate */
const PAIR_MIN_OVERLAP = 0.5
/** A role is made of pairs if at least this part of its nodes has a partner */
const PAIR_MIN_RATE = 0.5

const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.POSITIVE_INFINITY
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/**
 * Infer a diagram profile from the names and the links of a layer, without any knowledge of a use case:
 * - the shape of the names (see nameShape.ts) gives the token positions; the position where the nodes of a link
 *   mostly have the same value is the site (group), the one where they differ is the role, and the number at the
 *   end is the index;
 * - the nodes which have a link to another site are the anchors (upstream): the tiers are the roles ordered by the
 *   number of hops from the anchors;
 * - the nodes of the same site and role with different indexes, which are linked or have the same neighbors, are
 *   a redundant pair (the smallest index is the primary).
 * The result is a profile (the same as a hand-written one), so it is arranged by the same steps.
 * @returns undefined if the names or the links give no clue (e.g. a star, or a layer with only one site)
 */
export function inferProfile(nodes: readonly SchematicNode[], links: readonly Link[]): Inferred | undefined {
  const shaped = dominantShape(nodes.map((node) => node.name))
  if (!shaped) return undefined
  const tokensOf = new Map<string, Token[]>()
  for (const node of nodes) {
    const tokens = shaped.tokens.get(node.name)
    if (tokens) tokensOf.set(node.id, tokens)
  }
  const ids = [...tokensOf.keys()]
  if (ids.length < 2) return undefined
  const { kinds } = shaped.shape
  const last = kinds.length - 1
  const indexPos = kinds[last] === 'digits' ? last : undefined
  const valueAt = (id: string, position: number) => tokensOf.get(id)?.[position]?.text ?? ''

  const shapedLinks = links.filter(
    (l) => tokensOf.has(l.source) && tokensOf.has(l.target) && l.source !== l.target,
  )
  if (shapedLinks.length === 0) return undefined

  // site and role: by the rate of the links between the nodes with the same value at the token position
  const candidates = kinds
    .map((_, position) => position)
    .filter((position) => {
      // not the index; not a token of the other characters (a value of it could break a selector)
      if (position === indexPos || kinds[position] === 'other') return false
      const cardinality = new Set(ids.map((id) => valueAt(id, position))).size
      return cardinality >= 2 && cardinality < ids.length
    })
    .map((position) => ({
      position,
      homophily:
        shapedLinks.filter((l) => valueAt(l.source, position) === valueAt(l.target, position)).length /
        shapedLinks.length,
    }))
  const site = candidates
    .filter((c) => c.homophily >= SITE_MIN_HOMOPHILY)
    .sort((a, b) => b.homophily - a.homophily || a.position - b.position)
    .at(0)
  const role = candidates
    .filter((c) => c.position !== site?.position)
    .sort((a, b) => a.homophily - b.homophily || a.position - b.position)
    .at(0)
  if (!site || !role) return undefined
  const [sitePos, rolePos] = [site.position, role.position]
  const siteOf = (id: string) => valueAt(id, sitePos)
  const roleOf = (id: string) => valueAt(id, rolePos)

  // tiers: the roles by the hops from the anchors (the nodes which have a link to another site)
  const neighbors = new Map<string, Set<string>>()
  for (const { source, target } of links) {
    if (source === target) continue
    for (const [a, b] of [
      [source, target],
      [target, source],
    ] as const) {
      const set = neighbors.get(a) ?? new Set<string>()
      set.add(b)
      neighbors.set(a, set)
    }
  }
  const anchors = ids.filter((id) =>
    [...(neighbors.get(id) ?? [])].some((n) => tokensOf.has(n) && siteOf(n) !== siteOf(id)),
  )
  if (anchors.length === 0) return undefined
  const hops = new Map<string, number>(anchors.map((id) => [id, 0]))
  for (let frontier = [...anchors]; frontier.length > 0;) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of neighbors.get(id) ?? []) {
        if (hops.has(n)) continue
        hops.set(n, (hops.get(id) ?? 0) + 1)
        next.push(n)
      }
    }
    frontier = next
  }
  const roleHops = new Map<string, number[]>()
  for (const id of ids) {
    const list = roleHops.get(roleOf(id)) ?? []
    const hop = hops.get(id)
    if (hop !== undefined) list.push(hop)
    roleHops.set(roleOf(id), list)
  }
  const medians = new Map([...roleHops].map(([r, list]) => [r, median(list)]))
  const tiers = [...roleHops.keys()].sort(
    (a, b) => (medians.get(a) ?? 0) - (medians.get(b) ?? 0) || compareNames(a, b),
  )
  if (tiers.length > MAX_TIERS || tiers.length > ids.length / 2) return undefined

  // pairs: the same site and role, different indexes, linked or with the same neighbors
  const primaries = new Map<string, string>()
  if (indexPos !== undefined) {
    const groups = new Map<string, string[]>()
    for (const id of ids) {
      const key = `${siteOf(id)}|${roleOf(id)}`
      const group = groups.get(key)
      if (group) group.push(id)
      else groups.set(key, [id])
    }
    /** Rate of the common neighbors of the two nodes (they are not counted as the neighbors of each other) */
    const overlap = (a: string, b: string) => {
      const [na, nb] = [neighbors.get(a), neighbors.get(b)]
      if (!na || !nb) return 0
      let common = 0
      for (const n of na) if (n !== b && nb.has(n)) common++
      const union = na.size - (na.has(b) ? 1 : 0) + (nb.size - (nb.has(a) ? 1 : 0)) - common
      return union === 0 ? 0 : common / union
    }
    const partnered = (id: string, group: readonly string[]) =>
      group.some(
        (other) =>
          other !== id &&
          valueAt(other, indexPos) !== valueAt(id, indexPos) &&
          (neighbors.get(id)?.has(other) || overlap(id, other) >= PAIR_MIN_OVERLAP),
      )
    const stats = new Map<string, { total: number; partnered: number; minimums: string[] }>()
    for (const group of groups.values()) {
      const r = roleOf(group[0] ?? '')
      const stat = stats.get(r) ?? { total: 0, partnered: 0, minimums: [] }
      stat.total += group.length
      const members = group.filter((id) => partnered(id, group))
      stat.partnered += members.length
      if (members.length > 0) {
        stat.minimums.push(members.map((id) => valueAt(id, indexPos)).sort(compareNames)[0] ?? '')
      }
      stats.set(r, stat)
    }
    for (const [r, stat] of stats) {
      if (stat.partnered === 0 || stat.partnered / stat.total < PAIR_MIN_RATE) continue
      const counts = new Map<string, number>()
      for (const m of stat.minimums) counts.set(m, (counts.get(m) ?? 0) + 1)
      const [primary] = [...counts].sort((a, b) => b[1] - a[1] || compareNames(a[0], b[0]))[0] ?? []
      if (primary !== undefined) primaries.set(r, primary)
    }
  }

  // the draft: the same form as a hand-written profile (the tests read the YAML back, so the two are the same)
  // The other tokens are not captured: annotate makes the pair key of the captures, which must be the same as the
  // grouping above (the same site and role).
  const groupName = (position: number) =>
    position === sitePos
      ? 'site'
      : position === rolePos
        ? 'role'
        : position === indexPos
          ? 'index'
          : undefined
  const draft = {
    view: 'inferred',
    tiers,
    name: regexSourceOf(shaped.shape, groupName),
    rules: [
      { select: '*', group: 'site' },
      ...tiers.map((r) => ({
        select: `[role=${r}]`,
        tier: r,
        ...(primaries.has(r) ? { pair: { by: 'index', primary: primaries.get(r) } } : {}),
      })),
    ],
  }
  const yaml = `# Draft of the diagram profile inferred from the names and the links. Correct it and keep it as a profile.\n${stringify(draft)}`
  try {
    return { profile: parseProfile(draft, []), yaml }
  } catch (error) {
    if (error instanceof ProfileError) return undefined
    throw error
  }
}
