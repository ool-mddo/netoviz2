import { describe, expect, it } from 'vitest'
import type { LayerInfo } from '../api/types'
import { layersTopDown } from './layers'

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
