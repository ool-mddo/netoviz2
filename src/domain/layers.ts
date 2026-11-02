import type { LayerInfo } from '../api/types'

/** Layers from the top (the highest rank) to the bottom. Layers without rank (in a cycle) are the last. */
export function layersTopDown(layers: readonly LayerInfo[]): LayerInfo[] {
  return [...layers].sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1) || a.id.localeCompare(b.id))
}

/** If the total number of nodes is over this, only the top layer is shown by default */
export const DEFAULT_ALL_LAYERS_NODE_LIMIT = 300

/**
 * Layers to show when the user did not choose.
 * All layers if the topology is small, otherwise only the top layer (to avoid loading and drawing too much).
 */
export function defaultVisibleLayers(layers: readonly LayerInfo[]): string[] {
  const top = layersTopDown(layers)
  const total = layers.reduce((sum, layer) => sum + layer.counts.nodes, 0)
  if (total <= DEFAULT_ALL_LAYERS_NODE_LIMIT) return top.map((layer) => layer.id)
  return top.slice(0, 1).map((layer) => layer.id)
}

/**
 * Layer that an object belongs to. The first segment of the ID of a node/term-point/link is the layer ID
 * (see the specification of IDs), so the layer is found without parsing the rest of the ID.
 * @returns undefined if no layer matches
 */
export function layerOfId(id: string, layers: readonly Pick<LayerInfo, 'id'>[]): string | undefined {
  return layers.find((layer) => id === layer.id || id.startsWith(`${layer.id}/`))?.id
}
