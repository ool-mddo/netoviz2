<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ForceView from '../components/ForceView.vue'
import LayerList from '../components/LayerList.vue'
import SummaryBar from '../components/SummaryBar.vue'
import { defaultVisibleLayers } from '../domain/layers'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'

const props = defineProps<{ network: string; snapshot: string }>()
const route = useRoute()
const router = useRouter()
const topology = useTopologyStore()
const selection = useSelectionStore()

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
    </div>
  </template>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 16rem 1fr;
  gap: 1rem;
  margin-top: 0.5rem;
}
.error {
  color: #c62828;
}
</style>
