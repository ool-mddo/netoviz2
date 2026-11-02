import type { LayerInfo } from '../api/types'

/** Layers from the top (the highest rank) to the bottom. Layers without rank (in a cycle) are the last. */
export function layersTopDown(layers: readonly LayerInfo[]): LayerInfo[] {
  return [...layers].sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1) || a.id.localeCompare(b.id))
}
