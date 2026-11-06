import { describe, expect, it } from 'vitest'
import { mddoFwLayer1 } from '../../../test/mddoFwLayer1'
import {
  mddoBgpLayer1,
  mddoMregnwLayer1,
  mddoNetworkLayer1,
  mddoOspfLayer1,
} from '../../../test/sampleLayers'
import { annotate } from './annotate'
import { inferProfile } from './infer'
import { parseProfiles } from '../../../test/profileYaml'

const inferOf = (layer: ReturnType<typeof mddoFwLayer1>) => inferProfile(layer.nodes, layer.links)

describe('inferProfile (without any profile)', () => {
  it('mddo-fw: the roles from the upstream (br, fw, cr, seg, host), the site as the group, and the pairs', () => {
    const inferred = inferOf(mddoFwLayer1())!
    expect(inferred.profile.tiers).toEqual(['br', 'fw', 'cr', 'seg', 'host'])
    expect(inferred.profile.rules[0]).toMatchObject({ group: 'site' })
    const pairRoles = inferred.profile.rules.filter((r) => r.pair).map((r) => r.tier)
    expect(pairRoles).toEqual(['br', 'fw', 'cr', 'seg']) // hosts are not linked to each other nor share neighbors
    expect(inferred.profile.rules.find((r) => r.tier === 'br')?.pair).toEqual({ by: 'index', primary: '1' })
  })

  it('mddo-mregnw and mddo_network: pe, ce, acc, svr (the primary of a pair is the smallest index)', () => {
    for (const layer of [mddoMregnwLayer1(), mddoNetworkLayer1()]) {
      const inferred = inferOf(layer)!
      expect(inferred.profile.tiers).toEqual(['pe', 'ce', 'acc', 'svr'])
      expect(inferred.profile.rules.find((r) => r.tier === 'pe')?.pair).toEqual({
        by: 'index',
        primary: '01',
      })
    }
  })

  it('mddo-ospf: the routers are upstream of the servers (rt1 and rt2 are the same role: a limit of the role by name)', () => {
    const tiers = inferOf(mddoOspfLayer1())!.profile.tiers
    expect(tiers).toEqual(['rt', 'svr'])
  })

  it('captures only the site, role and index (the other tokens are not captured, so the pair key is site and role)', () => {
    const { name } = inferOf(mddoFwLayer1())!.profile
    expect(Object.keys(name?.exec('site-a-br-1')?.groups ?? {})).toEqual(['site', 'role', 'index'])
  })

  it('gives nothing when the tokens which are almost unique would be the roles (too many tiers)', () => {
    // two sites with 20 "roles" each, which are different for every node: not roles but names
    const codes = Array.from({ length: 20 }, (_, i) =>
      String.fromCharCode(97 + (i % 26), 97 + Math.floor(i / 26)),
    )
    const nodes = ['a', 'b'].flatMap((site) =>
      codes.map((code) => ({ id: `${site}-${code}`, name: `site-${site}-${code}-1`, radius: 11 })),
    )
    const links = ['a', 'b'].flatMap((site) =>
      codes.slice(1).map((c, i) => ({ source: `${site}-${codes[i]}`, target: `${site}-${c}` })),
    )
    links.push({ source: 'a-aa', target: 'b-aa' })
    expect(inferProfile(nodes, links)).toBeUndefined()
  })

  it('gives nothing for a star without sites (mddo-bgp layer1: all the nodes are on one switch)', () => {
    expect(inferOf(mddoBgpLayer1())).toBeUndefined()
  })

  it('gives nothing without links, or with less than 2 nodes, or without names', () => {
    const { nodes } = mddoFwLayer1()
    expect(inferProfile(nodes, [])).toBeUndefined()
    expect(inferProfile(nodes.slice(0, 1), [])).toBeUndefined()
    expect(inferProfile([], [])).toBeUndefined()
  })

  it('gives nothing for a layer with only one site (no anchors)', () => {
    const { nodes, links } = mddoFwLayer1()
    const inSiteA = new Set(nodes.filter((n) => n.name.startsWith('site-a-')).map((n) => n.id))
    expect(
      inferProfile(
        nodes.filter((n) => inSiteA.has(n.id)),
        links.filter((l) => inSiteA.has(l.source) && inSiteA.has(l.target)),
      ),
    ).toBeUndefined()
  })

  it('is deterministic, and independent of the order of the nodes', () => {
    const layer = mddoMregnwLayer1()
    const first = inferProfile(layer.nodes, layer.links)!
    expect(inferProfile(layer.nodes, layer.links)!.yaml).toBe(first.yaml)
    expect(inferProfile([...layer.nodes].reverse(), [...layer.links].reverse())!.yaml).toBe(first.yaml)
  })

  it('writes a draft which is read back as the same profile (a person can correct it and keep it)', () => {
    const inferred = inferOf(mddoFwLayer1())!
    const [again, ...rest] = parseProfiles(inferred.yaml).profiles
    expect(rest).toEqual([])
    expect(again).toEqual(inferred.profile)
    expect(inferred.yaml).toContain('# Draft')
  })

  it('gives the tier, site and pair to every node by the inferred profile', () => {
    const layer = mddoFwLayer1()
    const { annotations, unclassified } = annotate(layer.nodes, inferOf(layer)!.profile)
    expect(unclassified).toEqual([])
    expect(annotations.get('layer1/site-b-cr-2')).toMatchObject({ tier: 'cr', tierIndex: 2, group: 'b' })
    expect(annotations.get('layer1/site-a-br-1')?.pair?.primary).toBe(true)
    expect(annotations.get('layer1/site-a-br-2')?.pair?.primary).toBe(false)
  })

  it('leaves the names which do not fit the shape unclassified', () => {
    const layer = mddoFwLayer1()
    const nodes = [...layer.nodes, { id: 'layer1/odd', name: 'odd.name', radius: 11 }]
    const { annotations, unclassified } = annotate(nodes, inferProfile(nodes, layer.links)!.profile)
    expect(unclassified).toEqual(['layer1/odd'])
    expect(annotations.get('layer1/odd')?.captures).toEqual({})
  })
})
