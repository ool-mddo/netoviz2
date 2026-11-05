import { describe, expect, it } from 'vitest'
import type { SupportEdge } from '../../../api/types'
import { SupportIndex } from '../../../domain/supportIndex'
import { mddoFwLayer, mddoFwSupports } from '../../../test/mddoFwStack'
import { annotate } from './annotate'
import { inferProfile } from './infer'
import { inheritAnnotations, lowerClosure, lowerLayersOf, lowerNodesIn } from './inherit'
import { solvePositions } from './solve'
import { assignSlots } from './slots'
import { mddoFwBasesOf, node } from './testing'

const LAYERS = ['layer1', 'layer2', 'layer3']
const idOf = (layer: string, name: string) => `${layer}/${encodeURIComponent(name)}`
const closureOf = (layer: 'layer2' | 'layer3') =>
  lowerClosure(
    new SupportIndex(mddoFwSupports()),
    mddoFwLayer(layer).nodes.map((n) => n.id),
  )

describe('lowerClosure and friends (the chain of node supports)', () => {
  it('reaches layer1 from layer3 through layer2, and tells the layers which are reached', () => {
    expect(lowerLayersOf(closureOf('layer3'), LAYERS).sort()).toEqual(['layer1', 'layer2'])
    expect(lowerLayersOf(closureOf('layer2'), LAYERS)).toEqual(['layer1'])
  })

  it('a device reaches one node of layer1, a segment (a connection point of devices) reaches two or more', () => {
    const toLayer1 = lowerNodesIn(closureOf('layer3'), 'layer1', LAYERS)
    expect(toLayer1.get(idOf('layer3', 'site-a-br-1'))).toEqual([idOf('layer1', 'site-a-br-1')])
    expect(toLayer1.get(idOf('layer3', 'site-a-host-1'))).toEqual([idOf('layer1', 'site-a-host-1')])
    expect(toLayer1.get(idOf('layer3', 'Seg_172.32.0.0/30'))?.sort()).toEqual(
      [idOf('layer1', 'site-a-br-1'), idOf('layer1', 'site-c-br-1')].sort(),
    )
    // all the nodes of layer3 reach layer1
    expect(toLayer1.size).toBe(mddoFwLayer('layer3').nodes.length)
    const segments = mddoFwLayer('layer3').nodes.filter((n) => n.name.startsWith('Seg_'))
    expect(segments.every((n) => (toLayer1.get(n.id)?.length ?? 0) >= 2)).toBe(true)
  })

  it('terminates for a cycle of supports and ignores the supports other than node supports', () => {
    const edges: SupportEdge[] = [
      { kind: 'node', from: 'a/x', to: 'b/y' },
      { kind: 'node', from: 'b/y', to: 'a/x' },
      { kind: 'tp', from: 'a/x', to: 'c/z' },
    ]
    const closure = lowerClosure(new SupportIndex(edges), ['a/x'])
    expect([...(closure.get('a/x') ?? [])].sort()).toEqual(['b/y']) // not a/x itself
  })

  it('has no entry for a node without supports', () => {
    const closure = lowerClosure(new SupportIndex([]), ['a/x'])
    expect(lowerNodesIn(closure, 'b', ['a', 'b']).size).toBe(0)
  })
})

describe('inheritAnnotations (mddo-fw layer3 from layer1)', () => {
  const inherit = () => {
    const base = mddoFwBasesOf('layer3').find((b) => b.layer === 'layer1')!
    const profile = inferProfile(base.nodes, base.links)!.profile
    const annotated = annotate(base.nodes, profile)
    const positions = solvePositions(
      base.nodes,
      assignSlots(base.nodes, annotated, base.links, { unclassifiedRow: profile.tiers.length }),
      base.links,
    )
    return inheritAnnotations(mddoFwLayer('layer3').nodes, base.lowerOf, {
      annotations: annotated.annotations,
      positions,
    })
  }
  const at = (inherited: ReturnType<typeof inherit>, name: string) =>
    inherited.annotated.annotations.get(idOf('layer3', name))!

  it('gives the group and tier of the supporting node to a device (and its pair)', () => {
    const inherited = inherit()
    expect(inherited.annotated.unclassified).toEqual([])
    expect(at(inherited, 'site-b-cr-2')).toMatchObject({ tier: 'cr', tierIndex: 2, group: 'b' })
    expect(at(inherited, 'site-a-br-1').pair?.primary).toBe(true)
    expect(at(inherited, 'site-a-br-2').pair?.primary).toBe(false)
    expect(at(inherited, 'site-a-br-1').pair?.key).toBe(at(inherited, 'site-a-br-2').pair?.key)
  })

  it('separates the connection points (supported by two or more nodes) from the devices, without looking at the kind', () => {
    const inherited = inherit()
    const nodes = mddoFwLayer('layer3').nodes
    // the segments are the connection points; the devices (and endpoints) are the subjects of the layout
    expect(inherited.connectors.map((n) => n.name).every((name) => name.startsWith('Seg_'))).toBe(true)
    expect(inherited.connectors).toHaveLength(nodes.filter((n) => n.name.startsWith('Seg_')).length)
    expect(inherited.devices).toHaveLength(nodes.length - inherited.connectors.length)
    expect(inherited.devices.every((n) => !n.name.startsWith('Seg_'))).toBe(true)
    // the connection points are not annotated (they are not arranged by the profile)
    expect(inherited.annotated.annotations.has(idOf('layer3', 'Seg_172.32.0.0/30'))).toBe(false)
  })

  it('does not inherit the pair for the nodes which are supported by the same node (the interfaces of a device)', async () => {
    const base = mddoFwBasesOf('layer2').find((b) => b.layer === 'layer1')!
    const profile = inferProfile(base.nodes, base.links)!.profile
    const annotated = annotate(base.nodes, profile)
    const inherited = inheritAnnotations(mddoFwLayer('layer2').nodes, base.lowerOf, {
      annotations: annotated.annotations,
      positions: new Map(),
    })
    const first = inherited.annotated.annotations.get(idOf('layer2', 'site-a-br-1_ge-0/0/0.0'))!
    expect(first).toMatchObject({ tier: 'br', group: 'a' })
    expect(first.pair).toBeUndefined()
  })

  it('has the position (x) of the supporting node of the base layer for a device', () => {
    const inherited = inherit()
    expect(inherited.hints.size).toBe(inherited.devices.length)
    const x = (name: string) => inherited.hints.get(idOf('layer3', name))!
    expect(x('site-a-br-1')).toBeLessThan(x('site-b-br-1'))
    expect(x('site-b-br-1')).toBeLessThan(x('site-c-br-1'))
  })

  it('leaves a node unclassified which no classified node supports, and gives the row after the last tier', () => {
    const base = mddoFwBasesOf('layer3').find((b) => b.layer === 'layer1')!
    const profile = inferProfile(base.nodes, base.links)!.profile
    const annotated = annotate(base.nodes, profile)
    const inherited = inheritAnnotations(
      [node('orphan'), node('mapped')],
      new Map([['l/mapped', [base.nodes[0]!.id]]]),
      {
        annotations: annotated.annotations,
        positions: new Map(),
      },
    )
    expect(inherited.annotated.unclassified).toEqual(['l/orphan'])
    expect(inherited.unclassifiedRow).toBeGreaterThan(0)
  })
})
