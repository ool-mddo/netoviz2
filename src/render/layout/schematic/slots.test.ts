import { describe, expect, it } from 'vitest'
import { parseProfiles } from '../../../test/profileYaml'
import { assignSlots } from './slots'
import { NO_PAIR_PROFILE, SITE_ROLE_PROFILE, linkOf, namesOf, node, slotsOf } from './testing'
import { annotate } from './annotate'

describe('assignSlots', () => {
  it('orders the groups by order, then the groups without order by name, and the nodes without group last', () => {
    const profile = parseProfiles(`
view: v
tiers: [t]
name: '^(?<site>[a-z]+)-(?<n>\\d+)$'
rules:
  - { select: '*', tier: t }
  - { select: '[site=b]', group: site, order: 1 }
  - { select: '[site=z]', group: site }
  - { select: '[site=m]', group: site }
`).profiles[0]!
    const nodes = ['z-1', 'm-1', 'b-1', 'nogroup'].map((n) => node(n))
    expect(slotsOf(nodes, [], profile).groups.map((g) => g.key)).toEqual(['b', 'm', 'z', ''])
  })

  it('puts the groups of a literal value (`group: { value }`) in one column between the groups by order (Y shape)', () => {
    const profile = parseProfiles(`
view: v
tiers: [up, own, down]
name: '^(?:(?<site>as\\d+)-)?(?<role>[a-z]+)(?:-(?<tk>tk))?(?<n>\\d+)$'
rules:
  - { select: '*', group: site }
  - { select: '[tk=tk]', group: { value: center }, tier: own, order: 2 }
  - { select: '[site=as9]', group: { value: center }, tier: down }
  - { select: '[site=as1]', tier: up, order: 1 }
  - { select: '[site=as3]', tier: up, order: 3 }
`).profiles[0]!
    const nodes = ['as1-edge01', 'as3-edge01', 'edge-tk01', 'as9-edge01'].map((n) => node(n))
    const layout = slotsOf(nodes, [], profile)
    expect(layout.groups.map((g) => g.key)).toEqual(['as1', 'center', 'as3'])
    expect(namesOf(layout, nodes)['center']).toEqual({ 1: ['edge-tk01'], 2: ['as9-edge01'] })
  })

  it('marks the group with `align: center` on any node of the group', () => {
    const profile = parseProfiles(`
view: v
tiers: [t]
name: '^(?<site>[a-z]+)-(?<n>\\d+)$'
rules:
  - { select: '*', tier: t, group: site }
  - { select: '#a-2', align: center }
`).profiles[0]!
    const nodes = ['a-1', 'a-2', 'b-1'].map((n) => node(n))
    expect(slotsOf(nodes, [], profile).groups.map((g) => [g.key, g.align])).toEqual([
      ['a', 'center'],
      ['b', undefined],
    ])
  })

  it('keeps the rows of the tiers without nodes with keepTiers (rows 0 .. keepTiers - 1)', () => {
    const nodes = [node('a-top-1'), node('a-low-1')]
    const profile = SITE_ROLE_PROFILE
    const annotated = annotate(nodes, profile)
    const options = { unclassifiedRow: profile.tiers.length }
    expect(assignSlots(nodes, annotated, [], options).rows).toEqual([0, 2])
    expect(assignSlots(nodes, annotated, [], { ...options, keepTiers: 3 }).rows).toEqual([0, 1, 2])
    // the row for the nodes without a tier is added only when it is used
    expect(
      assignSlots([...nodes, node('stray')], annotate([...nodes, node('stray')], profile), [], {
        ...options,
        keepTiers: 3,
      }).rows,
    ).toEqual([0, 1, 2, 3])
  })

  it('puts the rows by the tier, and the nodes without a tier in the row after the last tier', () => {
    const nodes = [node('a-low-1'), node('a-top-1'), node('stray')]
    const layout = slotsOf(nodes)
    expect(layout.rows).toEqual([0, 2, 3])
    expect(namesOf(layout, nodes)['']).toEqual({ 3: ['stray'] })
  })

  it('puts a pair in one unit with the primary first, and a node without a partner in its own unit', () => {
    const nodes = [node('a-mid-2'), node('a-mid-1'), node('a-top-1')]
    expect(namesOf(slotsOf(nodes), nodes)['a']).toEqual({ 0: ['a-top-1'], 1: ['a-mid-1+a-mid-2'] })
  })

  it('orders the nodes of a row by the barycenter of the neighbors (crossings are removed)', () => {
    // by name x-1 < x-2 in the row mid, but the neighbors above are in the reverse order
    const nodes = [node('a-top-1'), node('a-top-3'), node('a-mid-2'), node('a-mid-4')]
    const links = [linkOf('a-top-1', 'a-mid-4'), linkOf('a-top-3', 'a-mid-2')]
    const layout = slotsOf(nodes, links, NO_PAIR_PROFILE)
    expect(namesOf(layout, nodes)['a']?.[1]).toEqual(['a-mid-4', 'a-mid-2'])
  })

  it('keeps the order of the nodes which have the same barycenter or no link', () => {
    const nodes = [node('a-mid-1'), node('a-mid-3'), node('a-mid-5')]
    const first = namesOf(slotsOf(nodes, [], NO_PAIR_PROFILE), nodes)['a']?.[1]
    expect(first).toEqual(['a-mid-1', 'a-mid-3', 'a-mid-5'])
  })

  it('handles an empty input and links to unknown nodes', () => {
    expect(slotsOf([]).rows).toEqual([])
    const nodes = [node('a-top-1')]
    expect(() => slotsOf(nodes, [linkOf('a-top-1', 'nothing')])).not.toThrow()
  })

  it('puts three or more nodes of a pair key in one unit', () => {
    const nodes = ['a-mid-1', 'a-mid-2', 'a-mid-3'].map((n) => node(n))
    expect(namesOf(slotsOf(nodes), nodes)['a']?.[1]).toEqual(['a-mid-1+a-mid-2+a-mid-3'])
  })
})

describe('assignSlots with the hints and the numeric rows (inheritance)', () => {
  const annotated = (rows: Record<string, number>) => ({
    annotations: new Map(
      Object.entries(rows).map(([name, tierIndex]) => [
        `l/${name}`,
        { id: `l/${name}`, captures: {}, group: 'g', tierIndex },
      ]),
    ),
    unclassified: [],
    unpaired: [],
  })
  const names = (layout: ReturnType<typeof assignSlots>, row: number) =>
    layout.groups[0]?.cells.get(row)?.map((u) => u.ids.join('+').replaceAll('l/', ''))

  it('puts the rows in the numeric order, including the fractions and the negative ones', () => {
    const nodes = ['a', 'b', 'c'].map((n) => node(n))
    const layout = assignSlots(nodes, annotated({ a: 0, b: 0.5, c: -0.5 }), [], { unclassifiedRow: 1 })
    expect(layout.rows).toEqual([-0.5, 0, 0.5])
  })

  it('puts the nodes in the order of the hints (not by the names)', () => {
    const nodes = ['x', 'y', 'z'].map((n) => node(n))
    const hints = new Map([
      ['l/x', 3],
      ['l/y', 1],
      ['l/z', 2],
    ])
    const layout = assignSlots(nodes, annotated({ x: 0, y: 0, z: 0 }), [], { unclassifiedRow: 1, hints })
    expect(names(layout, 0)).toEqual(['y', 'z', 'x'])
  })

  it('keeps the order of the hints when there are no links (the barycenter method does not change it)', () => {
    const nodes = ['m1', 'm2', 'm3'].map((n) => node(n))
    const hints = new Map([
      ['l/m1', 3],
      ['l/m2', 1],
      ['l/m3', 2],
    ])
    const layout = assignSlots(nodes, annotated({ m1: 1, m2: 1, m3: 1 }), [], { unclassifiedRow: 2, hints })
    expect(names(layout, 1)).toEqual(['m2', 'm3', 'm1'])
  })
})
