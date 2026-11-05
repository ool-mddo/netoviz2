import { describe, expect, it } from 'vitest'
import { parseProfiles } from './profile'
import { NO_PAIR_PROFILE, linkOf, namesOf, node, slotsOf } from './testing'

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
