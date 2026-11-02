import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'

/** Select an object (common to all viewers and panels). Supports and attributes are loaded when they are needed. */
export function useSelect(): (id: string | null) => Promise<void> {
  const selection = useSelectionStore()
  const topology = useTopologyStore()
  return async (id) => {
    selection.select(id)
    if (id) await Promise.all([topology.ensureSupports(), topology.loadAttributes([id])])
  }
}
