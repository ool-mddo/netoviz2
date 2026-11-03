import { layerOfId } from '../domain/layers'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'

/**
 * Select an object (common to all viewers and panels).
 * Supports and attributes are loaded when they are needed, and so are the layers of the objects
 * reached through supports (to show their names in the panel).
 */
export function useSelect(): (id: string | null) => Promise<void> {
  const selection = useSelectionStore()
  const topology = useTopologyStore()
  return async (id) => {
    selection.select(id)
    if (!id) return
    await Promise.all([topology.ensureSupports(), topology.loadAttributes([id])])
    // the trace is not changed by loading layers, so the layers can be decided here
    const layers = topology.summary?.layers ?? []
    const needed = new Set<string>()
    for (const tracedId of selection.trace.ids) {
      const layer = layerOfId(tracedId, layers)
      if (layer && !topology.layerData[layer]) needed.add(layer)
    }
    await Promise.all([...needed].map((layer) => topology.loadLayer(layer)))
  }
}
