<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AttributePanel from '../components/AttributePanel.vue'
import DependencyView from '../components/DependencyView.vue'
import ForceView from '../components/ForceView.vue'
import LayerList from '../components/LayerList.vue'
import SummaryBar from '../components/SummaryBar.vue'
import ViewToolbar from '../components/ViewToolbar.vue'
import { usePolling } from '../composables/usePolling'
import { useSelect } from '../composables/useSelect'
import { defaultVisibleLayers } from '../domain/layers'
import {
  DEFAULT_LAYER_ARRANGEMENT,
  DEFAULT_LAYOUT_ENGINE,
  parseLayerArrangement,
  parseLayoutEngine,
  type LayerArrangement,
  type LayoutEngine,
} from '../render/layout/types'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'

/** Interval to check the update of the topology */
const RELOAD_INTERVAL_MS = 5000

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

/** Auto reload: check the ETag of the summary and reload the data when the topology is updated */
async function reload(): Promise<void> {
  const updated = await topology.refresh()
  // attributes are cleared by the reload: load them again for the selected object
  if (updated && selection.selectedId) await selectObject(selection.selectedId)
}
usePolling(reload, RELOAD_INTERVAL_MS)

/**
 * The layout engine of the topology view is kept in the URL (`?layout=<engine>`).
 * The dependency view (the supports of the selected object) is the secondary view: `?dependency=1` shows it.
 */
const engine = computed<LayoutEngine>(() => parseLayoutEngine(route.query.layout) ?? DEFAULT_LAYOUT_ENGINE)
/** Diagram profile of the schematic layout (`?profile=<name>`) */
const profile = computed(() => (typeof route.query.profile === 'string' ? route.query.profile : undefined))
/** Arrangement of the layers (`?layerlayout=grid` for a grid, default: column) */
const layerArrangement = computed<LayerArrangement>(
  () => parseLayerArrangement(route.query.layerlayout) ?? DEFAULT_LAYER_ARRANGEMENT,
)
const dependencyOn = computed(() => route.query.dependency === '1')

function setEngine(next: LayoutEngine): void {
  const query = { ...route.query }
  if (next === DEFAULT_LAYOUT_ENGINE) delete query.layout
  else query.layout = next
  void router.replace({ query })
}
function setLayerArrangement(next: LayerArrangement): void {
  const query = { ...route.query }
  if (next === DEFAULT_LAYER_ARRANGEMENT) delete query.layerlayout
  else query.layerlayout = next
  void router.replace({ query })
}
function setDependency(on: boolean): void {
  const query = { ...route.query }
  if (on) query.dependency = '1'
  else delete query.dependency
  void router.replace({ query })
}

/** Show all the layers, or none of them (to pick up one layer, clear all and choose it) */
function setAllLayers(all: boolean): void {
  const layers = all ? (topology.summary?.layers ?? []).map((layer) => layer.id) : []
  void router.replace({ query: { ...route.query, layers: layers.join(',') } })
}

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
        <LayerList
          :layers="topology.summary.layers"
          :visible="visibleLayers"
          @toggle="toggleLayer"
          @select-all="setAllLayers(true)"
          @select-none="setAllLayers(false)"
        />
      </aside>
      <section class="viewer" data-testid="viewer">
        <ViewToolbar
          :visible-layers="visibleLayers"
          :dependency="dependencyOn"
          @update:dependency="setDependency"
        />
        <div class="panels" :class="{ dependency: dependencyOn }">
          <ForceView
            :visible-layers="visibleLayers"
            :engine="engine"
            :layer-arrangement="layerArrangement"
            :profile="profile"
            @update:engine="setEngine"
            @update:layer-arrangement="setLayerArrangement"
          />
          <DependencyView v-if="dependencyOn" :visible-layers="visibleLayers" />
        </div>
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
.panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.5rem;
}
.panels.dependency {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.error {
  color: var(--error);
}
</style>
