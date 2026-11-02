import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import * as api from '../api/client'
import type { LayerData, LinkData, NodeData, ObjectAttributes, Summary, TpData } from '../api/types'
import { SupportIndex } from '../domain/supportIndex'

export type ObjectEntry =
  | { type: 'node'; layer: string; data: NodeData }
  | { type: 'tp'; layer: string; data: TpData }
  | { type: 'link'; layer: string; data: LinkData }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The topology (snapshot) being shown: summary, structure of loaded layers, supports and attributes */
export const useTopologyStore = defineStore('topology', () => {
  const network = ref('')
  const snapshot = ref('')
  const summary = shallowRef<Summary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Structure of layers loaded on demand (large; not deeply reactive) */
  const layerData = shallowRef<Record<string, LayerData>>({})
  const supportIndex = shallowRef(new SupportIndex())
  const supportsLoaded = ref(false)
  const attributes = shallowRef<Record<string, ObjectAttributes>>({})
  /** Incremented when the data is reloaded (the topology is updated on the server) */
  const revision = ref(0)
  /** To ignore the responses of requests for the snapshot that is not shown any more */
  let generation = 0

  const objects = computed(() => {
    const map = new Map<string, ObjectEntry>()
    for (const [layer, data] of Object.entries(layerData.value)) {
      for (const node of data.nodes) map.set(node.id, { type: 'node', layer, data: node })
      for (const tp of data.tps) map.set(tp.id, { type: 'tp', layer, data: tp })
      for (const link of data.links) map.set(link.id, { type: 'link', layer, data: link })
    }
    return map
  })
  /** node ID => term-points of the node */
  const tpsOfNode = computed(() => {
    const map = new Map<string, TpData[]>()
    for (const data of Object.values(layerData.value)) {
      for (const tp of data.tps) {
        const list = map.get(tp.node)
        if (list) list.push(tp)
        else map.set(tp.node, [tp])
      }
    }
    return map
  })

  function reset(): void {
    summary.value = null
    error.value = null
    layerData.value = {}
    supportIndex.value = new SupportIndex()
    supportsLoaded.value = false
    attributes.value = {}
  }

  /** Open a snapshot: get the summary (layers are loaded on demand) */
  async function open(nw: string, ss: string): Promise<void> {
    const current = ++generation
    network.value = nw
    snapshot.value = ss
    reset()
    loading.value = true
    try {
      const result = await api.getSummary(nw, ss)
      if (current === generation) summary.value = result
    } catch (e) {
      if (current === generation) error.value = messageOf(e)
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function loadLayer(layerId: string): Promise<void> {
    if (layerData.value[layerId]) return
    const current = generation
    try {
      const data = await api.getLayer(network.value, snapshot.value, layerId)
      if (current === generation) layerData.value = { ...layerData.value, [layerId]: data }
    } catch (e) {
      if (current === generation) error.value = messageOf(e)
    }
  }

  async function ensureSupports(): Promise<void> {
    if (supportsLoaded.value) return
    const current = generation
    try {
      const data = await api.getSupports(network.value, snapshot.value)
      if (current === generation) {
        supportIndex.value = new SupportIndex(data.supports)
        supportsLoaded.value = true
      }
    } catch (e) {
      if (current === generation) error.value = messageOf(e)
    }
  }

  /** Load attributes of the objects which are not loaded yet */
  async function loadAttributes(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !attributes.value[id])
    if (missing.length === 0) return
    const current = generation
    try {
      const data = await api.getAttributes(network.value, snapshot.value, missing)
      if (current === generation) attributes.value = { ...attributes.value, ...data.objects }
    } catch (e) {
      if (current === generation) error.value = messageOf(e)
    }
  }

  /**
   * Check the update of the topology on the server (ETag of the summary).
   * If updated, replace the summary and reload the loaded data.
   * @returns true if the data was updated
   */
  async function refresh(): Promise<boolean> {
    if (!summary.value) return false
    const current = generation
    try {
      const updated = await api.getSummary(network.value, snapshot.value, summary.value.etag)
      if (!updated || current !== generation) return false

      const loadedLayers = Object.keys(layerData.value)
      const hadSupports = supportsLoaded.value
      summary.value = updated
      error.value = null
      layerData.value = {}
      supportIndex.value = new SupportIndex()
      supportsLoaded.value = false
      attributes.value = {}
      await Promise.all([...loadedLayers.map(loadLayer), hadSupports ? ensureSupports() : Promise.resolve()])
      revision.value++
      return true
    } catch (e) {
      // keep showing the current data (the server may be restarting)
      if (current === generation) error.value = messageOf(e)
      return false
    }
  }

  return {
    network,
    snapshot,
    summary,
    loading,
    error,
    layerData,
    supportIndex,
    supportsLoaded,
    attributes,
    revision,
    objects,
    tpsOfNode,
    open,
    loadLayer,
    ensureSupports,
    loadAttributes,
    refresh,
  }
})
