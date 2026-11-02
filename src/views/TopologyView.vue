<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AttributePanel from '../components/AttributePanel.vue'
import ForceView from '../components/ForceView.vue'
import LayerList from '../components/LayerList.vue'
import SummaryBar from '../components/SummaryBar.vue'
import { useSelect } from '../composables/useSelect'
import { defaultVisibleLayers } from '../domain/layers'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'

const props = defineProps<{ network: string; snapshot: string }>()
const route = useRoute()
const router = useRouter()
const topology = useTopologyStore()
const selection = useSelectionStore()
const selectObject = useSelect()

/** Visible layers are kept in the URL (`?layers=a,b`) so that the view can be shared */
const visibleLayers = computed<string[]>(() => {
  const summary = topology.summary
  if (!summary) return []
  const query = route.query.layers
  if (typeof query === 'string') {
    const known = new Set(summary.layers.map((layer) => layer.id))
    return query.split(',').filter((id) => known.has(id))
  }
  return defaultVisibleLayers(summary.layers)
})

watch(
  () => [props.network, props.snapshot] as const,
  async ([network, snapshot]) => {
    selection.select(null)
    await topology.open(network, snapshot)
  },
  { immediate: true },
)

watch(
  visibleLayers,
  (ids) => {
    void Promise.all(ids.map((id) => topology.loadLayer(id)))
  },
  { immediate: true },
)

/** The selected object is kept in the URL (`?sel=<id>`) so that the view can be shared */
watch(
  () => [topology.summary, route.query.sel] as const,
  ([summary, sel]) => {
    if (!summary) return
    const id = typeof sel === 'string' ? sel : null
    if (id !== selection.selectedId) void selectObject(id)
  },
  { immediate: true },
)
watch(
  () => selection.selectedId,
  (id) => {
    const current = typeof route.query.sel === 'string' ? route.query.sel : null
    if (id === current) return
    const query = { ...route.query }
    if (id) query.sel = id
    else delete query.sel
    void router.replace({ query })
  },
)

function toggleLayer(layerId: string): void {
  const current = visibleLayers.value
  const next = current.includes(layerId) ? current.filter((id) => id !== layerId) : [...current, layerId]
  void router.replace({ query: { ...route.query, layers: next.join(',') } })
}

onBeforeUnmount(() => selection.select(null))
</script>

<template>
  <p v-if="topology.loading">Loading...</p>
  <p v-else-if="topology.error && !topology.summary" class="error">
    Failed to load {{ props.network }} / {{ props.snapshot }}: {{ topology.error }}
  </p>
  <template v-else-if="topology.summary">
    <SummaryBar :summary="topology.summary" />
    <p v-if="topology.error" class="error">{{ topology.error }}</p>
    <div class="layout">
      <aside class="side">
        <LayerList :layers="topology.summary.layers" :visible="visibleLayers" @toggle="toggleLayer" />
      </aside>
      <section class="viewer" data-testid="viewer">
        <ForceView :visible-layers="visibleLayers" />
      </section>
      <AttributePanel />
    </div>
  </template>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 16rem minmax(0, 1fr) 24rem;
  gap: 1rem;
  margin-top: 0.5rem;
}
.error {
  color: #c62828;
}
</style>
