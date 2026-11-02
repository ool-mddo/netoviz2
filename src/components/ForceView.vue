<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSelect } from '../composables/useSelect'
import { buildDisplayGraph, displayIdOf } from '../domain/graph'
import { layersTopDown } from '../domain/layers'
import { ForceRenderer, type Highlight } from '../render/forceRenderer'
import { useSelectionStore, type TraceMode } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'

const props = defineProps<{ visibleLayers: string[] }>()

const topology = useTopologyStore()
const selection = useSelectionStore()
const view = useViewStore()
const svgEl = ref<SVGSVGElement | null>(null)
let renderer: ForceRenderer | null = null

/** Stable order of all layers (colors do not change by showing/hiding layers) */
const layerOrder = computed(() => layersTopDown(topology.summary?.layers ?? []).map((layer) => layer.id))

const visibleData = computed(() =>
  props.visibleLayers.flatMap((id) => {
    const data = topology.layerData[id]
    return data ? [data] : []
  }),
)
const tpCount = computed(() => visibleData.value.reduce((sum, data) => sum + data.tps.length, 0))
/** Nodes whose term-points are shown */
const expanded = computed(() =>
  view.expandedNodes(
    visibleData.value.flatMap((data) => data.nodes.map((node) => node.id)),
    tpCount.value,
  ),
)
const portsOn = computed(() => view.portsByDefault(tpCount.value))
const graph = computed(() => buildDisplayGraph(visibleData.value, expanded.value))
const shownIds = computed(() => new Set(graph.value.nodes.map((node) => node.id)))

const highlight = computed<Highlight>(() => {
  const toShown = (id: string) => displayIdOf(topology.objects.get(id), expanded.value, shownIds.value)
  const selectedId = selection.selectedId ? (toShown(selection.selectedId) ?? null) : null
  const tracedIds = new Set<string>()
  for (const id of selection.trace.ids) {
    const shown = toShown(id)
    if (shown) tracedIds.add(shown)
  }
  // node supports and term-point supports can be the same line between nodes (collapsed): draw it once
  const edges = new Map<string, { from: string; to: string }>()
  for (const edge of selection.trace.edges) {
    const from = toShown(edge.from)
    const to = toShown(edge.to)
    if (from && to) edges.set(`${from}>${to}`, { from, to })
  }
  const traceEdges = [...edges.values()]
  return { selectedId, tracedIds, traceEdges }
})

const selectObject = useSelect()

onMounted(() => {
  if (!svgEl.value) return
  renderer = new ForceRenderer(svgEl.value, {
    onSelect: (id) => void selectObject(id),
    onToggleExpand: (nodeId) => view.toggleExpand(nodeId),
  })
  renderer.setGraph(graph.value, layerOrder.value)
  renderer.setHighlight(highlight.value)
})
onBeforeUnmount(() => renderer?.destroy())

watch(graph, () => {
  renderer?.setGraph(graph.value, layerOrder.value)
  renderer?.setHighlight(highlight.value)
})
watch(highlight, () => renderer?.setHighlight(highlight.value))

const traceModes: TraceMode[] = ['both', 'lower', 'upper', 'off']
</script>

<template>
  <div class="force-view">
    <div class="toolbar">
      <button type="button" data-testid="fit" @click="renderer?.fit()">Fit</button>
      <label>
        <input
          type="checkbox"
          :checked="portsOn"
          data-testid="show-ports"
          @change="view.setShowPorts(($event.target as HTMLInputElement).checked)"
        />
        Term-points
      </label>
      <label>
        Trace
        <select v-model="selection.traceMode" data-testid="trace-mode">
          <option v-for="mode in traceModes" :key="mode" :value="mode">{{ mode }}</option>
        </select>
      </label>
      <span class="hint">click: select / double click: show or hide the term-points of the node</span>
    </div>
    <svg ref="svgEl" class="force-svg" data-testid="force-svg" />
  </div>
</template>

<style>
.force-view .toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}
.force-view .hint {
  opacity: 0.6;
  font-size: 0.85em;
}
.force-svg {
  width: 100%;
  height: 72vh;
  border: 1px solid #8884;
  cursor: grab;
}
.force-svg .link {
  stroke: #8888;
}
.force-svg .link.diff-added {
  stroke: #2e7d32;
}
.force-svg .link.diff-deleted {
  stroke: #c62828;
}
.force-svg .link.diff-changed {
  stroke: #f9a825;
}
.force-svg .node {
  cursor: pointer;
}
.force-svg .node circle {
  fill: var(--layer-color);
  stroke: #fff;
  stroke-width: 1.5;
}
.force-svg .node.tp circle {
  fill: #fff;
  stroke: var(--layer-color);
  stroke-width: 2;
}
/* names of term-points are shown when zoomed in, or when the term-point is selected/traced */
.force-svg:not(.zoomed-in) .node.tp:not(.selected):not(.traced) text {
  display: none;
}
.force-svg .node.expanded circle {
  stroke-dasharray: 3 2;
}
.force-svg .node text {
  font-size: 10px;
  fill: currentColor;
  pointer-events: none;
}
.force-svg .node.tp text {
  font-size: 7px;
}
.force-svg .node.diff-added circle {
  stroke: #2e7d32;
  stroke-width: 3;
}
.force-svg .node.diff-deleted circle {
  stroke: #c62828;
  stroke-width: 3;
}
.force-svg .node.diff-changed circle {
  stroke: #f9a825;
  stroke-width: 3;
}
.force-svg .node.traced circle {
  stroke: #d81b60;
  stroke-width: 3;
}
.force-svg .node.selected circle {
  stroke: currentColor;
  stroke-width: 4;
}
.force-svg .node.dim,
.force-svg .link.dim {
  opacity: 0.15;
}
.force-svg .trace-edge {
  stroke: #d81b60;
  stroke-width: 2;
  stroke-dasharray: 5 3;
  pointer-events: none;
}
</style>
