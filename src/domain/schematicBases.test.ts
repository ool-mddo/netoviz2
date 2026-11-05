import { describe, expect, it } from 'vitest'
import type { LayerData, LayerInfo } from '../api/types'
import { layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import { lowerLayerIdsOf, nodeLinksOf, schematicBasesOf } from './schematicBases'
import { SupportIndex } from './supportIndex'

const layers: LayerInfo[] = makeSummary().layers
const index = new SupportIndex(supportsData.supports)
const data: Record<string, LayerData> = { layer1: layer1Data, layer2: layer2Data }

describe('nodeLinksOf', () => {
  it('makes the links between the nodes of the links between the term-points (no duplicates, no self links)', () => {
    const tps = [
      { id: 'a/1', node: 'a', name: '1' },
      { id: 'a/2', node: 'a', name: '2' },
      { id: 'b/1', node: 'b', name: '1' },
      { id: 'b/2', node: 'b', name: '2' },
    ]
    const links = [
      { id: 'l1', name: 'l1', src: 'a/1', dst: 'b/1' },
      { id: 'l2', name: 'l2', src: 'b/2', dst: 'a/2' }, // the same nodes in the reverse direction
      { id: 'l3', name: 'l3', src: 'a/1', dst: 'a/2' }, // a link in a node
      { id: 'l4', name: 'l4', src: 'a/1', dst: null }, // the end is not found
    ]
    expect(nodeLinksOf({ layer: 'x', etag: '', nodes: [], tps, links })).toEqual([
      { source: 'a', target: 'b' },
    ])
  })
})

describe('lowerLayerIdsOf and schematicBasesOf', () => {
  it('finds the lower layers which the layer reaches by the node supports', () => {
    expect(lowerLayerIdsOf(layer2Data, layers, index)).toEqual(['layer1'])
    expect(lowerLayerIdsOf(layer1Data, layers, index)).toEqual([])
  })

  it('makes the base with the nodes, the links and which nodes support the nodes of the layer', () => {
    const [base, ...rest] = schematicBasesOf('layer2', data, layers, index)
    expect(rest).toEqual([])
    expect(base?.layer).toBe('layer1')
    expect(base?.nodes.map((n) => n.id)).toEqual(['layer1/sw1', 'layer1/sw2'])
    expect(base?.nodes.map((n) => n.name)).toEqual(['sw1', 'sw2'])
    expect([...(base?.lowerOf ?? [])]).toEqual([['layer2/r1', ['layer1/sw1']]])
  })

  it('has no base for a layer without supports, a layer which is not loaded, or a lower layer which is not loaded', () => {
    expect(schematicBasesOf('layer1', data, layers, index)).toEqual([])
    expect(schematicBasesOf('layer9', data, layers, index)).toEqual([])
    expect(schematicBasesOf('layer2', { layer2: layer2Data }, layers, index)).toEqual([])
  })
})
