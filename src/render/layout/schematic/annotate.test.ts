import { describe, expect, it } from 'vitest'
import { mddoFwLayer1 } from '../../../test/mddoFwLayer1'
import { annotate } from './annotate'
import { parseProfiles } from './profile'
import { loadProfiles } from './profileSource'

const { nodes } = mddoFwLayer1()

async function mddoFwProfile() {
  const { profiles, warnings } = await loadProfiles('mddo-fw')
  expect(warnings).toEqual([])
  return profiles[0]!
}

describe('annotate (mddo-fw layer1 with the bundled profile)', () => {
  it('gives the tier, group (site) and order to every node', async () => {
    const { annotations, unclassified } = annotate(nodes, await mddoFwProfile())
    expect(unclassified).toEqual([])
    const a = annotations.get('layer1/site-b-cr-2')
    expect(a).toMatchObject({ tier: 'core', tierIndex: 2, group: 'b', order: 2 })
    expect(a?.captures).toEqual({ site: 'b', role: 'cr', index: '2' })
    // seg and host are split in the same way (the number is directly after the role, or after '-')
    expect(annotations.get('layer1/site-a-seg1')?.captures).toEqual({ site: 'a', role: 'seg', index: '1' })
    expect(annotations.get('layer1/site-c-host-2')).toMatchObject({ tier: 'host', group: 'c', order: 3 })
  })

  it('has the tiers in the order br < fw < cr < seg < host', async () => {
    const { annotations } = annotate(nodes, await mddoFwProfile())
    const tierOf = (name: string) => annotations.get(`layer1/${name}`)?.tierIndex
    expect([
      tierOf('site-a-br-1'),
      tierOf('site-a-fw-1'),
      tierOf('site-a-cr-1'),
      tierOf('site-a-seg1'),
      tierOf('site-a-host-1'),
    ]).toEqual([0, 1, 2, 3, 4])
  })

  it('makes pairs of the nodes of the same site and role (index 1 is the primary)', async () => {
    const { annotations } = annotate(nodes, await mddoFwProfile())
    const [br1, br2, fw1] = ['site-a-br-1', 'site-a-br-2', 'site-a-fw-1'].map(
      (n) => annotations.get(`layer1/${n}`)?.pair,
    )
    expect(br1?.key).toBe(br2?.key)
    expect(br1?.key).not.toBe(fw1?.key)
    expect([br1?.primary, br2?.primary]).toEqual([true, false])
    // the same role of another site is another pair
    expect(annotations.get('layer1/site-b-br-1')?.pair?.key).not.toBe(br1?.key)
    // seg1 and seg2 are a pair, too (the profile says so for all the nodes)
    expect(annotations.get('layer1/site-a-seg1')?.pair?.key).toBe(
      annotations.get('layer1/site-a-seg2')?.pair?.key,
    )
  })
})

describe('annotate (rules)', () => {
  const node = (name: string, kind?: string) => ({
    id: `l/${name}`,
    name,
    radius: 11,
    ...(kind ? { kind } : {}),
  })
  const profileOf = (text: string) => parseProfiles(text).profiles[0]!

  it('applies the later rule when rules conflict, for each property', () => {
    const profile = profileOf(`
view: v
tiers: [x, y]
name: '^(?<role>[a-z]+)\\d$'
rules:
  - { select: '*', tier: x, order: 5 }
  - { select: '[role=b]', tier: y }
`)
    const { annotations } = annotate([node('a1'), node('b1')], profile)
    expect(annotations.get('l/a1')).toMatchObject({ tier: 'x', tierIndex: 0, order: 5 })
    expect(annotations.get('l/b1')).toMatchObject({ tier: 'y', tierIndex: 1, order: 5 })
  })

  it('selects by ID, name and kind, and reports the nodes without a tier', () => {
    const profile = profileOf(`
view: v
tiers: [x]
rules:
  - { select: '#l/a', tier: x }
  - { select: '#b', tier: x }
  - { select: '[kind=segment]', tier: x }
`)
    const { annotations, unclassified } = annotate(
      [node('a'), node('b'), node('c', 'segment'), node('d')],
      profile,
    )
    expect([...annotations.values()].filter((a) => a.tier).map((a) => a.id)).toEqual(['l/a', 'l/b', 'l/c'])
    expect(unclassified).toEqual(['l/d'])
  })

  it('does not match attribute selectors for a name which the regular expression does not match', () => {
    const profile = profileOf(`
view: v
tiers: [x]
name: '^n(?<i>\\d)$'
rules:
  - { select: '[i=1]', tier: x }
`)
    const { annotations } = annotate([node('n1'), node('other')], profile)
    expect(annotations.get('l/n1')?.tier).toBe('x')
    expect(annotations.get('l/other')).toMatchObject({ captures: {} })
    expect(annotations.get('l/other')?.tier).toBeUndefined()
  })

  it('reports a node without a tier as unclassified only (not as unpaired, too)', () => {
    const profile = profileOf(`
view: v
name: '^(?<role>[a-z]+)-(?<n>\\d)$'
rules:
  - { select: '*', pair: { by: n, primary: '1' } }
`)
    const { unclassified, unpaired } = annotate([node('r-1')], profile)
    expect(unclassified).toEqual(['l/r-1'])
    expect(unpaired).toEqual([])
  })

  it('reports a node with a tier and a pair rule but without a partner as unpaired', () => {
    const profile = profileOf(`
view: v
tiers: [t]
name: '^(?<role>[a-z]+)-(?<n>\\d)$'
rules:
  - { select: '*', tier: t, pair: { by: n, primary: '1' } }
`)
    expect(annotate([node('r-1'), node('s-1'), node('s-2')], profile).unpaired).toEqual(['l/r-1'])
  })

  it('does not make a pair of a node without a partner', () => {
    const profile = profileOf(`
view: v
name: '^(?<role>[a-z]+)-(?<n>\\d)$'
rules:
  - { select: '*', pair: { by: n, primary: '1' } }
`)
    const { annotations } = annotate([node('r-1'), node('r-2'), node('s-1')], profile)
    expect(annotations.get('l/r-1')?.pair?.primary).toBe(true)
    expect(annotations.get('l/r-2')?.pair?.primary).toBe(false)
    expect(annotations.get('l/s-1')?.pair).toBeUndefined()
  })
})
