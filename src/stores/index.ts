import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getIndex } from '../api/client'
import type { IndexEntry } from '../api/types'

/** List of networks and snapshots (`/topologies/index`) */
export const useIndexStore = defineStore('index', () => {
  const entries = ref<IndexEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** networks (in the order of the index) with their snapshots */
  const networks = computed(() => {
    const map = new Map<string, IndexEntry[]>()
    for (const entry of entries.value) {
      const list = map.get(entry.network)
      if (list) list.push(entry)
      else map.set(entry.network, [entry])
    }
    return [...map.entries()].map(([network, snapshots]) => ({ network, snapshots }))
  })

  /** Load the index. It is loaded again when `force` is true (or not loaded yet). */
  async function load(force = false): Promise<void> {
    if (loading.value || (loaded.value && !force)) return
    loading.value = true
    try {
      entries.value = await getIndex()
      error.value = null
      loaded.value = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function snapshotsOf(network: string): IndexEntry[] {
    return entries.value.filter((entry) => entry.network === network)
  }

  return { entries, loading, loaded, error, networks, load, snapshotsOf }
})
