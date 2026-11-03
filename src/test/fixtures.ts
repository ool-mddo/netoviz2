import type { AttributesData, LayerData, LayerInfo, Summary, SupportsData } from '../api/types'

const layerInfo = (id: string, rank: number, supports: string[], nodes: number, tps: number): LayerInfo => ({
  id,
  name: id,
  kind: `mddo-topology:${id}-network`,
  supports,
  rank,
  counts: { nodes, tps, links: 0 },
})

export function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    schema_version: '1',
    network: 'nw',
    snapshot: 'ss',
    etag: 'v1-1',
    flags: [],
    has_diff: false,
    layers: [layerInfo('layer1', 0, [], 2, 3), layerInfo('layer2', 1, ['layer1'], 1, 1)],
    warnings: [],
    warnings_total: 0,
    ...overrides,
  }
}

export const layer1Data: LayerData = {
  layer: 'layer1',
  etag: 'v1-1',
  nodes: [
    { id: 'layer1/sw1', name: 'sw1', tp_count: 2 },
    { id: 'layer1/sw2', name: 'sw2', tp_count: 1 },
  ],
  tps: [
    { id: 'layer1/sw1/p1', node: 'layer1/sw1', name: 'p1' },
    { id: 'layer1/sw1/p2', node: 'layer1/sw1', name: 'p2' },
    { id: 'layer1/sw2/p1', node: 'layer1/sw2', name: 'p1' },
  ],
  links: [
    { id: 'layer1/~link/a', name: 'a', src: 'layer1/sw1/p1', dst: 'layer1/sw2/p1' },
    { id: 'layer1/~link/b', name: 'b', src: 'layer1/sw2/p1', dst: 'layer1/sw1/p1' },
  ],
}

export const layer2Data: LayerData = {
  layer: 'layer2',
  etag: 'v1-1',
  nodes: [{ id: 'layer2/r1', name: 'r1', kind: 'node', tp_count: 1 }],
  tps: [{ id: 'layer2/r1/e1', node: 'layer2/r1', name: 'e1' }],
  links: [],
}

export const supportsData: SupportsData = {
  etag: 'v1-1',
  supports: [
    { kind: 'node', from: 'layer2/r1', to: 'layer1/sw1' },
    { kind: 'tp', from: 'layer2/r1/e1', to: 'layer1/sw1/p1' },
  ],
}

export const attributesData: AttributesData = {
  etag: 'v1-1',
  objects: { 'layer2/r1': { type: 'node', attributes: { 'x:attr': { a: 1 } } } },
  not_found: [],
}
