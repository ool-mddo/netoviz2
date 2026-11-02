import { describe, expect, it } from 'vitest'
import type { LayerInfo } from '../api/types'
import { defaultVisibleLayers, layerOfId, layersTopDown } from './layers'

const layer = (id: string, rank: number | null): LayerInfo => ({
  id,
  name: id,
  kind: null,
  supports: [],
  rank,
  counts: { nodes: 0, tps: 0, links: 0 },
})

describe('layersTopDown', () => {
  it('orders layers from the highest rank, layers without rank are the last', () => {
    const layers = [layer('l1', 0), layer('cyc', null), layer('l3', 2), layer('l2', 1), layer('l3b', 2)]
    expect(layersTopDown(layers).map((l) => l.id)).toEqual(['l3', 'l3b', 'l2', 'l1', 'cyc'])
  })
})

describe('defaultVisibleLayers', () => {
  const sized = (id: string, rank: number, nodes: number): LayerInfo => ({
    ...layer(id, rank),
    counts: { nodes, tps: 0, links: 0 },
  })

  it('shows all layers (top first) if the topology is small', () => {
    expect(defaultVisibleLayers([sized('a', 0, 10), sized('b', 1, 20)])).toEqual(['b', 'a'])
  })

  it('shows only the top layer if the topology is large', () => {
    expect(defaultVisibleLayers([sized('a', 0, 200), sized('b', 1, 200)])).toEqual(['b'])
  })

  it('returns an empty list without layers', () => {
    expect(defaultVisibleLayers([])).toEqual([])
  })
})

describe('layerOfId', () => {
  const layers = [{ id: 'layer1' }, { id: 'layer10' }, { id: 'a%2Fb' }]

  it('finds the layer by the first segment of the ID', () => {
    expect(layerOfId('layer1/sw1/p1', layers)).toBe('layer1')
    expect(layerOfId('layer10/r1', layers)).toBe('layer10')
    expect(layerOfId('a%2Fb/~link/x', layers)).toBe('a%2Fb')
    expect(layerOfId('layer1', layers)).toBe('layer1')
  })

  it('does not confuse layers whose names start with the same string', () => {
    expect(layerOfId('layer100/x', layers)).toBeUndefined()
  })

  it('returns undefined for unknown objects', () => {
    expect(layerOfId('unknown/x', layers)).toBeUndefined()
  })
})
