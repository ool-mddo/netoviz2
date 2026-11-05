import { annotate } from './annotate'
import { parseProfiles } from './profile'
import { assignSlots, type SlotLayout } from './slots'
import type { DiagramProfile, SchematicNode } from './types'

/** Helpers for the tests of the schematic layout */

export const node = (name: string, kind?: string): SchematicNode => ({
  id: `l/${name}`,
  name,
  radius: 11,
  ...(kind ? { kind } : {}),
})

export const linkOf = (a: string, b: string) => ({ source: `l/${a}`, target: `l/${b}` })

/** Profile for names like `s1-r2-3`: site (group), role (tier: top < mid < low) and index (pair by the index) */
export const SITE_ROLE_PROFILE: DiagramProfile = parseProfiles(`
view: v
tiers: [top, mid, low]
name: '^(?<site>[a-z]+)-(?<role>[a-z]+)-(?<index>\\d+)$'
rules:
  - { select: '*', group: site, pair: { by: index, primary: '1' } }
  - { select: '[role=top]', tier: top }
  - { select: '[role=mid]', tier: mid }
  - { select: '[role=low]', tier: low }
  - { select: '[site=a]', order: 1 }
  - { select: '[site=b]', order: 2 }
  - { select: '[site=c]', order: 3 }
`).profiles[0]!

/** The same as SITE_ROLE_PROFILE without pairs */
export const NO_PAIR_PROFILE: DiagramProfile = {
  ...SITE_ROLE_PROFILE,
  rules: SITE_ROLE_PROFILE.rules.map((rule) => ({ ...rule, pair: undefined })),
}

export function slotsOf(
  nodes: readonly SchematicNode[],
  links: ReadonlyArray<{ source: string; target: string }> = [],
  profile: DiagramProfile = SITE_ROLE_PROFILE,
): SlotLayout {
  return assignSlots(nodes, annotate(nodes, profile), links, profile)
}

/** Names in each group and row, e.g. `{ a: { 0: ['a-top-1'] } }` (a pair is joined by '+') */
export function namesOf(
  layout: SlotLayout,
  nodes: readonly SchematicNode[],
): Record<string, Record<number, string[]>> {
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]))
  return Object.fromEntries(
    layout.groups.map((group) => [
      group.key,
      Object.fromEntries(
        [...group.cells].map(([row, units]) => [
          row,
          units.map((u) => u.ids.map((id) => nameOf.get(id)).join('+')),
        ]),
      ),
    ]),
  )
}
