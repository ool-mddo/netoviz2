import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { traceSupports, type TraceDirection, type TraceResult } from '../domain/tracer'
import { useTopologyStore } from './topology'

export type TraceMode = TraceDirection | 'off'

const EMPTY_TRACE: TraceResult = { ids: new Set(), edges: [] }

/** Selected object and the trace of its supports (common to all viewers) */
export const useSelectionStore = defineStore('selection', () => {
  const topology = useTopologyStore()
  const selectedId = ref<string | null>(null)
  const traceMode = ref<TraceMode>('both')

  const selected = computed(() => (selectedId.value ? topology.objects.get(selectedId.value) : undefined))

  /** Objects to start the trace: a node is traced together with its term-points */
  const traceStartIds = computed<string[]>(() => {
    const entry = selected.value
    if (!entry) return []
    if (entry.type === 'node')
      return [entry.data.id, ...(topology.tpsOfNode.get(entry.data.id) ?? []).map((tp) => tp.id)]
    return [entry.data.id]
  })

  const trace = computed<TraceResult>(() => {
    if (traceMode.value === 'off' || traceStartIds.value.length === 0) return EMPTY_TRACE
    return traceSupports(topology.supportIndex, traceStartIds.value, traceMode.value)
  })

  function select(id: string | null): void {
    selectedId.value = id
  }

  return { selectedId, traceMode, selected, traceStartIds, trace, select }
})
