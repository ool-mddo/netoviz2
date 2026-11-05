import { describe, expect, it } from 'vitest'
import { layoutQuality } from '../quality'
import { mddoFwLayer1 } from '../../../test/mddoFwLayer1'
import { layoutSchematic } from './index'
import { loadProfiles } from './profileSource'

const SITES = ['a', 'b', 'c']
const ROLES = ['br', 'fw', 'cr', 'seg', 'host']

async function arrange() {
  const input = mddoFwLayer1()
  const { profiles } = await loadProfiles('mddo-fw')
  const positions = await layoutSchematic({ ...input, profile: profiles[0]! })
  const at = (name: string) => positions.get(`layer1/${name}`)!
  return { input, positions, at }
}

describe('layoutSchematic without a usable profile', () => {
  it('arranges the nodes by the stress layout: every node has a position, apart from each other', async () => {
    const nodes = ['a', 'b', 'c'].map((id) => ({ id, name: id, radius: 11 }))
    const links = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const positions = await layoutSchematic({ layer: 'l', nodes, links })
    expect([...positions.keys()].sort()).toEqual(['a', 'b', 'c'])
    const [a, b] = [positions.get('a')!, positions.get('b')!]
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(22)
  })

  it('falls back to the stress layout when the profile gives no tier to any node', async () => {
    const { profiles } = await loadProfiles('mddo-fw')
    const nodes = [{ id: 'x', name: 'unrelated', radius: 11 }]
    const positions = await layoutSchematic({ layer: 'l', nodes, links: [], profile: profiles[0]! })
    expect(positions.has('x')).toBe(true)
  })
})

describe('layoutSchematic (mddo-fw layer1 with the profile)', () => {
  it('puts the tiers from the top: br, fw, cr, seg, host (the nodes of a tier are at the same height)', async () => {
    const { at } = await arrange()
    const rowY = ROLES.map((role) => {
      const ys = SITES.flatMap((s) =>
        [1, 2].map((i) => at(role === 'seg' ? `site-${s}-seg${i}` : `site-${s}-${role}-${i}`).y),
      )
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0, 6)
      return ys[0]!
    })
    for (let i = 1; i < rowY.length; i++) expect(rowY[i]!).toBeGreaterThan(rowY[i - 1]!)
  })

  it('puts the sites from the left: a, b, c (no node of a site is beyond a node of the next site)', async () => {
    const { input, at } = await arrange()
    const xs = (site: string) =>
      input.nodes.filter((n) => n.name.startsWith(`site-${site}-`)).map((n) => at(n.name).x)
    expect(Math.max(...xs('a'))).toBeLessThan(Math.min(...xs('b')))
    expect(Math.max(...xs('b'))).toBeLessThan(Math.min(...xs('c')))
  })

  it('puts the redundant pairs side by side, the primary (1) on the left', async () => {
    const { at } = await arrange()
    for (const site of SITES) {
      for (const role of ['br', 'fw', 'cr', 'host']) {
        const [one, two] = [at(`site-${site}-${role}-1`), at(`site-${site}-${role}-2`)]
        expect(one.x).toBeLessThan(two.x)
        expect(one.y).toBeCloseTo(two.y, 6)
      }
      expect(at(`site-${site}-seg1`).x).toBeLessThan(at(`site-${site}-seg2`).x)
    }
  })

  it('has no overlap of nodes', async () => {
    const { input, positions } = await arrange()
    const quality = layoutQuality(
      input.nodes.map((n) => ({ ...n, ...positions.get(n.id)! })),
      input.links.map((l) => ({ source: l.source, target: l.target })),
    )
    expect(quality.overlap).toBe(0)
  })

  it('does not have more crossings than before (3)', async () => {
    const { input, positions } = await arrange()
    const quality = layoutQuality(
      input.nodes.map((n) => ({ ...n, ...positions.get(n.id)! })),
      input.links,
    )
    expect(quality.crossings).toBeLessThanOrEqual(3)
  })
})
