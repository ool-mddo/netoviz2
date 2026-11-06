import { describe, expect, it } from 'vitest'
import type { Position } from '../types'
import { layoutQuality } from '../quality'
import { mddoFwLayer1 } from '../../../test/mddoFwLayer1'
import { mddoMregnwLayer1, mddoBgpLayer1, mddoNetworkLayer1 } from '../../../test/sampleLayers'
import { mddoFwLayer } from '../../../test/mddoFwStack'
import { layoutSchematic } from './index'
import { mddoFwBasesOf } from './testing'
import { parseProfiles } from '../../../test/profileYaml'
import type { SchematicReport } from './types'
import { mddoFwProfiles } from '../../../test/mddoFwProfile'

const SITES = ['a', 'b', 'c']
const ROLES = ['br', 'fw', 'cr', 'seg', 'host']

async function arrange() {
  const input = mddoFwLayer1()
  const { profiles } = await mddoFwProfiles()
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
    const { profiles } = await mddoFwProfiles()
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

/** Names by the rows (from the top) and the columns (from the left) of a layout: the relative order of the nodes */
function rowsOf(positions: Map<string, { x: number; y: number }>): string[][] {
  const byY = new Map<number, Array<[string, number]>>()
  for (const [id, p] of positions) byY.set(p.y, [...(byY.get(p.y) ?? []), [id.replace('layer1/', ''), p.x]])
  return [...byY]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row.sort((a, b) => a[1] - b[1]).map(([name]) => name))
}

describe('layoutSchematic without a profile (inferred)', () => {
  it('mddo-fw: the same relative order of the nodes as the hand-written profile', async () => {
    const input = mddoFwLayer1()
    const { profiles } = await mddoFwProfiles()
    const written = await layoutSchematic({ ...input, profile: profiles[0]! })
    const inferred = await layoutSchematic(input)
    expect(rowsOf(inferred)).toEqual(rowsOf(written))
  })

  it('mddo-mregnw and mddo_network: the upstream (pe) is on the top and the servers at the bottom, by site', async () => {
    for (const input of [mddoMregnwLayer1(), mddoNetworkLayer1()]) {
      const rows = rowsOf(await layoutSchematic(input))
      expect(rows.map((row) => row[0]?.replace(/^region[a-z]-/, '').replace(/\d+$/, ''))).toEqual([
        'pe',
        'ce',
        'acc',
        'svr',
      ])
      expect(rows[0]?.[0]?.startsWith('regiona-')).toBe(true) // sites from the left (by the names)
      expect(rows[0]?.at(-1)?.startsWith('regione-') || rows[0]?.at(-1)?.startsWith('regionb-')).toBe(true)
    }
  })

  it('reports the profile is inferred with the draft, and no exceptions for the regular layer', async () => {
    const reports: SchematicReport[] = []
    await layoutSchematic({ ...mddoFwLayer1(), report: (r) => reports.push(r) })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ layer: 'layer1', source: 'inferred', violations: [] })
    expect(reports[0]?.draft).toContain('view: inferred')
  })

  it('reports the nodes which do not fit the inferred shape as exceptions', async () => {
    const input = mddoFwLayer1()
    const odd = { id: 'layer1/odd', name: 'odd.name', radius: 11 }
    const reports: SchematicReport[] = []
    const positions = await layoutSchematic({
      ...input,
      nodes: [...input.nodes, odd],
      report: (r) => reports.push(r),
    })
    expect(reports[0]?.violations.map((v) => [v.id, v.code])).toEqual([['layer1/odd', 'unclassified']])
    expect(positions.has('layer1/odd')).toBe(true) // the node is still put (in the row after the last tier)
  })

  it('arranges by stress and reports "none" when nothing can be inferred (a star: mddo-bgp layer1)', async () => {
    const reports: SchematicReport[] = []
    const input = mddoBgpLayer1()
    const positions = await layoutSchematic({ ...input, report: (r) => reports.push(r) })
    expect(reports).toEqual([{ layer: 'layer1', source: 'none', violations: [] }])
    expect(positions.size).toBe(input.nodes.length)
  })
})

describe('layoutSchematic with a given profile', () => {
  it('uses the given profile (not the inferred one) and reports the unpaired nodes', async () => {
    const input = mddoFwLayer1()
    const { profiles } = await mddoFwProfiles()
    const nodes = input.nodes.filter((n) => n.name !== 'site-a-br-2') // site-a-br-1 has no partner
    const reports: SchematicReport[] = []
    await layoutSchematic({ ...input, nodes, profile: profiles[0]!, report: (r) => reports.push(r) })
    expect(reports[0]).toMatchObject({ source: 'profile' })
    expect(reports[0]?.draft).toBeUndefined()
    expect(reports[0]?.violations.map((v) => [v.id, v.code])).toEqual([['layer1/site-a-br-1', 'unpaired']])
  })

  it('reports "none" when the given profile does not fit and nothing can be inferred', async () => {
    const unrelated = parseProfiles(
      "view: v\ntiers: [x]\nname: '^zzz$'\nrules:\n  - { select: '[role=x]', tier: x }\n",
    ).profiles[0]!
    const reports: SchematicReport[] = []
    const input = mddoBgpLayer1()
    const positions = await layoutSchematic({ ...input, profile: unrelated, report: (r) => reports.push(r) })
    expect(reports).toEqual([{ layer: 'layer1', source: 'none', violations: [] }])
    expect(positions.size).toBe(input.nodes.length)
  })

  it('infers the profile when the given one gives no tier to any node (it does not fit the layer)', async () => {
    const reports: SchematicReport[] = []
    const unrelated = parseProfiles(
      "view: v\ntiers: [x]\nname: '^zzz$'\nrules:\n  - { select: '[role=x]', tier: x }\n",
    ).profiles[0]!
    await layoutSchematic({ ...mddoFwLayer1(), profile: unrelated, report: (r) => reports.push(r) })
    expect(reports[0]).toMatchObject({ source: 'inferred' })
  })
})

describe('layoutSchematic by inheritance (mddo-fw layer3 and layer2 from layer1)', () => {
  const arrangeLayer = async (
    layer: 'layer2' | 'layer3',
    extra: Partial<Parameters<typeof layoutSchematic>[0]> = {},
  ) => {
    const input = mddoFwLayer(layer)
    const reports: SchematicReport[] = []
    const positions = await layoutSchematic({
      ...input,
      bases: mddoFwBasesOf(layer),
      report: (r) => reports.push(r),
      ...extra,
    })
    const at = (name: string) => positions.get(input.nodes.find((n) => n.name === name)!.id)!
    return { input, positions, reports, at }
  }
  const DEVICES = ['br', 'fw', 'cr', 'host']

  it('layer3 is arranged from layer1 (the names of layer3 give nothing: segments are most of them)', async () => {
    const { reports } = await arrangeLayer('layer3')
    expect(reports).toEqual([{ layer: 'layer3', source: 'inherited', base: 'layer1', violations: [] }])
  })

  it('without the base, layer3 cannot be inferred and is arranged by stress (reported as none)', async () => {
    const { reports } = await arrangeLayer('layer3', { bases: undefined })
    expect(reports[0]).toMatchObject({ source: 'none' })
  })

  it('puts the devices in the same sites and tiers as layer1, in the same order', async () => {
    const layer1 = mddoFwLayer('layer1')
    const written = await layoutSchematic(layer1)
    const base = (name: string) => written.get(layer1.nodes.find((n) => n.name === name)!.id)!
    const { at } = await arrangeLayer('layer3')
    for (const role of DEVICES) {
      const names = ['a', 'b', 'c'].flatMap((site) => [1, 2].map((i) => `site-${site}-${role}-${i}`))
      const order = (f: (name: string) => { x: number }) => [...names].sort((p, q) => f(p).x - f(q).x)
      expect(order(at)).toEqual(order(base))
    }
    const ys = DEVICES.map((role) => at(`site-a-${role}-1`).y)
    expect([...ys].sort((p, q) => p - q)).toEqual(ys) // br, fw, cr, host from the top
    expect(at('site-a-br-1').y).toBe(at('site-c-br-2').y)
  })

  it('puts every segment clear of the other nodes, and its links do not pass through the other nodes', async () => {
    const { input, at } = await arrangeLayer('layer3')
    const nameOf = new Map(input.nodes.map((n) => [n.id, n.name]))
    const segments = input.nodes.filter((n) => n.name.startsWith('Seg_'))
    const distance = (
      p: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      const [dx, dy] = [b.x - a.x, b.y - a.y]
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }
    for (const segment of segments) {
      for (const link of input.links.filter((l) => l.source === segment.id || l.target === segment.id)) {
        const device = nameOf.get(link.source === segment.id ? link.target : link.source)!
        for (const other of input.nodes) {
          if (other.id === segment.id || other.name === device) continue
          // (the radius 11 and the margin which the placement keeps is 10: it is checked with the radius only here)
          expect(distance(at(other.name), at(segment.name), at(device))).toBeGreaterThanOrEqual(11)
        }
      }
    }
  })

  it('puts a segment between the devices it joins: in the middle of a link between two rows', async () => {
    const { at } = await arrangeLayer('layer3')
    // Seg_192.168.1.0/30 joins site-a-fw-1 and site-a-cr-1: it is between the rows of the devices
    const devices = ['site-a-fw-1', 'site-a-cr-1'].map((name) => at(name).y)
    const segment = at('Seg_192.168.1.0/30').y
    expect(segment).toBeGreaterThan(Math.min(...devices))
    expect(segment).toBeLessThan(Math.max(...devices))
  })

  it('puts a link between sites over the row of the devices (not through the devices between them)', async () => {
    const { at } = await arrangeLayer('layer3')
    // Seg_172.32.0.0/30 joins site-a-br-1 and site-c-br-1, and site-b is between them
    expect(at('Seg_172.32.0.0/30').y).toBeLessThan(at('site-a-br-1').y)
  })

  it('has no overlap, and the crossings are recorded (12 at the time of writing; stress has 7)', async () => {
    const { input, positions } = await arrangeLayer('layer3')
    const quality = layoutQuality(
      input.nodes.map((n) => ({ ...n, ...positions.get(n.id)! })),
      input.links,
    )
    expect(quality.overlap).toBe(0)
    expect(quality.crossings).toBeLessThanOrEqual(12)
  })

  it('layer2 is arranged from layer1: the interfaces of a device are in the row of the device, side by side', async () => {
    const { input, at, reports } = await arrangeLayer('layer2')
    expect(reports[0]).toMatchObject({ source: 'inherited', base: 'layer1', violations: [] })
    const interfaces = input.nodes.filter((n) => n.name.startsWith('site-a-br-1_')).map((n) => n.name)
    expect(interfaces.length).toBeGreaterThan(1)
    const ys = new Set(interfaces.map((n) => at(n).y))
    expect(ys.size).toBe(1)
    expect(at('site-a-br-1_ge-0/0/0.0').y).toBeLessThan(at('site-a-fw-1_ge-0/0/1.0').y)
  })

  it('uses the given profile which fits the layer before the inheritance', async () => {
    const own = parseProfiles(
      "view: v\ntiers: [x]\nname: '^(?<site>site)-(?<r>[a-z]+)-.*$'\nrules:\n  - { select: '[site=site]', tier: x }\n",
    ).profiles[0]!
    const { reports } = await arrangeLayer('layer3', { profile: own })
    expect(reports[0]).toMatchObject({ source: 'profile' })
    expect(reports[0]?.base).toBeUndefined()
  })

  it('falls back to the inference when the base does not fit the layer (it supports few nodes)', async () => {
    const [base] = mddoFwBasesOf('layer2')
    const emptyBase = { ...base!, lowerOf: new Map<string, string[]>() }
    const { reports } = await arrangeLayer('layer2', { bases: [emptyBase] })
    // the names of the interfaces (`site-a-br-1_ge-0/0/0.0`) give a profile: it is not none
    expect(reports[0]?.source).not.toBe('inherited')
  })

  it('reports the nodes which no classified node supports, in the words of the inheritance', async () => {
    const [base] = mddoFwBasesOf('layer2')
    const lowerOf = new Map(base!.lowerOf)
    const dropped = mddoFwLayer('layer2').nodes[0]!.id
    lowerOf.delete(dropped)
    const { reports } = await arrangeLayer('layer2', { bases: [{ ...base!, lowerOf }] })
    expect(reports[0]).toMatchObject({ source: 'inherited' })
    expect(reports[0]?.violations).toEqual([
      expect.objectContaining({
        id: dropped,
        code: 'unclassified',
        message: expect.stringContaining('lower layer'),
      }),
    ])
  })

  it('does not inherit when all the nodes are connection points (nothing is arranged): it falls back', async () => {
    const [base] = mddoFwBasesOf('layer3').filter((b) => b.layer === 'layer1')
    const [br1, br2] = ['site-a-br-1', 'site-a-br-2'].map((n) => base!.nodes.find((x) => x.name === n)!.id)
    const nodes = ['x', 'y', 'z'].map((n) => ({ id: `l/${n}`, name: n, radius: 11 }))
    const lowerOf = new Map(nodes.map((n) => [n.id, [br1!, br2!]]))
    const links = [
      { source: 'l/x', target: 'l/y' },
      { source: 'l/y', target: 'l/z' },
    ]
    const reports: SchematicReport[] = []
    const positions = await layoutSchematic({
      layer: 'l',
      nodes,
      links,
      bases: [{ ...base!, lowerOf }],
      report: (r) => reports.push(r),
    })
    expect(reports[0]?.source).toBe('none')
    expect(positions.size).toBe(3)
  })

  it('uses the base which the profile names (inherit.from), the others after it', async () => {
    const named = parseProfiles('view: v\ninherit: { from: layer2 }\n').profiles[0]!
    const first = await arrangeLayer('layer3', { profile: named })
    // layer2 as the base is arranged by the inference (interface names): if it does not fit, layer1 is used
    expect(['layer1', 'layer2']).toContain(first.reports[0]?.base)
    const layer1 = parseProfiles('view: v\ninherit: { from: layer1 }\n').profiles[0]!
    expect((await arrangeLayer('layer3', { profile: layer1 })).reports[0]).toMatchObject({ base: 'layer1' })
  })
})

describe('layoutSchematic with a profile of a layer without a lower layer (connection points)', () => {
  const YAML = `
view: logical
target: { layer: layer3 }
tiers: [wan, fw, core, segment, host]
name: '^site-(?<site>[a-z])-(?<role>[a-z]+)-?(?<index>\\d+)$'
rules:
  - { select: '*', group: site, pair: { by: index, primary: '1' } }
  - { select: '[role=br]', tier: wan }
  - { select: '[role=fw]', tier: fw }
  - { select: '[role=cr]', tier: core }
  - { select: '[role=host]', tier: host }
  - { select: '[site=a]', order: 1 }
  - { select: '[site=b]', order: 2 }
  - { select: '[site=c]', order: 3 }
`
  async function arrangeLayer3() {
    const input = mddoFwLayer('layer3')
    const reports: SchematicReport[] = []
    const positions = await layoutSchematic({
      ...input,
      profile: parseProfiles(YAML).profiles[0]!,
      report: (r) => reports.push(r),
    })
    return { input, positions, report: reports[0]! }
  }

  it('puts the segments (no tier, linked to two or more devices) between the devices, not in a row of their own', async () => {
    const { input, positions, report } = await arrangeLayer3()
    const segments = input.nodes.filter((n) => n.name.startsWith('Seg_'))
    expect(segments).toHaveLength(30)
    expect(report.source).toBe('profile')
    expect(report.violations).toEqual([]) // the connection points are not exceptions
    const rows = new Set(
      input.nodes.filter((n) => !n.name.startsWith('Seg_')).map((n) => Math.round(positions.get(n.id)!.y)),
    )
    expect(rows.size).toBe(4) // br, fw, cr, host
    const bottom = Math.max(...rows)
    // a segment between the rows is between the devices it is linked to; no segment is at the bottom
    for (const seg of segments) {
      const ys = input.links
        .filter((l) => l.source === seg.id || l.target === seg.id)
        .map((l) => positions.get(l.source === seg.id ? l.target : l.source)!.y)
      const y = positions.get(seg.id)!.y
      if (Math.max(...ys) - Math.min(...ys) > 1) {
        expect(y).toBeGreaterThanOrEqual(Math.min(...ys))
        expect(y).toBeLessThanOrEqual(Math.max(...ys))
      }
      expect(y).toBeLessThan(bottom)
    }
  })

  it('does not put the segments between the sites far over the top row (a link through a node is left to the router)', async () => {
    const { input, positions } = await arrangeLayer3()
    const deviceTop = Math.min(
      ...input.nodes.filter((n) => !n.name.startsWith('Seg_')).map((n) => positions.get(n.id)!.y),
    )
    const top = Math.min(...input.nodes.map((n) => positions.get(n.id)!.y))
    expect(deviceTop - top).toBeLessThan(200) // it was 576 when no link might pass through a node
  })

  it('keeps the nodes apart, with far fewer crossings than the segments in a row at the bottom', async () => {
    const { input, positions } = await arrangeLayer3()
    const quality = layoutQuality(
      input.nodes.map((n) => ({ id: n.id, ...positions.get(n.id)!, radius: n.radius })),
      input.links,
    )
    expect(quality.overlap).toBe(0)
    expect(quality.crossings).toBeLessThan(50) // 656 when the segments are put in a row at the bottom
  })

  it('tells a node without a tier which is linked to fewer than two classified nodes', async () => {
    const nodes = [
      { id: 'site-a-br-1', name: 'site-a-br-1', radius: 11 },
      { id: 'site-a-fw-1', name: 'site-a-fw-1', radius: 11 },
      { id: 'dangling', name: 'dangling', radius: 11 },
      { id: 'joint', name: 'joint', radius: 11 },
    ]
    const links = [
      { source: 'site-a-br-1', target: 'site-a-fw-1' },
      { source: 'site-a-br-1', target: 'dangling' },
      { source: 'site-a-br-1', target: 'joint' },
      { source: 'site-a-fw-1', target: 'joint' },
    ]
    const reports: SchematicReport[] = []
    const positions = await layoutSchematic({
      layer: 'l',
      nodes,
      links,
      profile: parseProfiles(YAML).profiles[0]!,
      report: (r) => reports.push(r),
    })
    expect(reports[0]!.violations.filter((v) => v.code === 'unclassified').map((v) => v.id)).toEqual([
      'dangling',
    ])
    const [br, fw, joint] = ['site-a-br-1', 'site-a-fw-1', 'joint'].map((id) => positions.get(id)!)
    expect(joint!.y).toBeGreaterThan(br!.y - 1)
    expect(joint!.y).toBeLessThan(fw!.y + 1)
  })

  it('does not take the nodes without a tier for connection points when the arrangement can be inherited (they are exceptions)', async () => {
    const nodes = [
      { id: 'site-a-br-1', name: 'site-a-br-1', radius: 11 },
      { id: 'site-a-fw-1', name: 'site-a-fw-1', radius: 11 },
      { id: 'missed', name: 'missed', radius: 11 }, // a device which the profile missed
    ]
    const links = [
      { source: 'site-a-br-1', target: 'site-a-fw-1' },
      { source: 'site-a-br-1', target: 'missed' },
      { source: 'site-a-fw-1', target: 'missed' },
    ]
    const unfit = { layer: 'lower', nodes: [], links: [], lowerOf: new Map<string, readonly string[]>() }
    const reportsOf = async (bases: Array<typeof unfit>) => {
      const reports: SchematicReport[] = []
      await layoutSchematic({
        layer: 'l',
        nodes,
        links,
        profile: parseProfiles(YAML).profiles[0]!,
        bases,
        report: (r) => reports.push(r),
      })
      return reports[0]!.violations.filter((v) => v.code === 'unclassified').map((v) => v.id)
    }
    expect(await reportsOf([])).toEqual([]) // no lower layer: a connection point
    expect(await reportsOf([unfit])).toEqual(['missed']) // a lower layer is given: an exception
  })

  it('reports a node which the inferred profile misses even if it is linked to two classified nodes', async () => {
    const reports: SchematicReport[] = []
    await layoutSchematic({
      ...mddoFwLayer('layer1'),
      nodes: [...mddoFwLayer('layer1').nodes, { id: 'layer1/odd', name: 'odd', radius: 11 }],
      links: [
        ...mddoFwLayer('layer1').links,
        { source: 'layer1/odd', target: 'layer1/site-a-br-1' },
        { source: 'layer1/odd', target: 'layer1/site-a-fw-1' },
      ],
      report: (r) => reports.push(r),
    })
    expect(reports[0]!.source).toBe('inferred')
    expect(reports[0]!.violations.map((v) => v.id)).toContain('layer1/odd')
  })
})

describe('layoutSchematic inheriting from a layer arranged by its profile (no layer below it)', () => {
  const YAML = `
view: v
target: { layer: base }
tiers: [up, down]
name: '^(?<role>[a-z]+)-\\d+$'
rules:
  - { select: "[role=r]", tier: up }
  - { select: "[role=h]", tier: down }
`
  const sn = (layer: string, name: string) => ({ id: `${layer}/${name}`, name, radius: 11 })
  const names = ['r-1', 'h-1', 'seg', 'r-2', 'h-2', 'seg2']
  const baseNodes = names.map((n) => sn('base', n))
  // segments join two devices each (a connection point, not a device without a tier)
  const link = (layer: string, a: string, b: string) => ({ source: `${layer}/${a}`, target: `${layer}/${b}` })
  const baseLinks = [
    link('base', 'r-1', 'seg'),
    link('base', 'seg', 'h-1'),
    link('base', 'r-2', 'seg2'),
    link('base', 'seg2', 'h-2'),
  ]
  const upNodes = names.map((n) => sn('up', n))
  const upLinks = baseLinks.map((l) => ({
    source: l.source.replace('base', 'up'),
    target: l.target.replace('base', 'up'),
  }))

  it('makes the nodes supported only by connection points of the base connection points', async () => {
    const lowerOf = new Map(names.map((n) => [`up/${n}`, [`base/${n}`]]))
    const reports: SchematicReport[] = []
    const profile = parseProfiles(YAML).profiles[0]!
    const positions = await layoutSchematic({
      layer: 'up',
      nodes: upNodes,
      links: upLinks,
      bases: [{ layer: 'base', nodes: baseNodes, links: baseLinks, lowerOf, profile }],
      report: (r) => reports.push(r),
    })
    expect(reports[0]).toMatchObject({ source: 'inherited', base: 'base' })
    expect(reports[0]!.violations).toEqual([])
    // the segment is between the devices it joins
    const [r1, h1, seg] = ['r-1', 'h-1', 'seg'].map((n) => positions.get(`up/${n}`)!) as [
      Position,
      Position,
      Position,
    ]
    expect(seg.y).toBeGreaterThan(r1.y)
    expect(seg.y).toBeLessThan(h1.y)
  })
})
