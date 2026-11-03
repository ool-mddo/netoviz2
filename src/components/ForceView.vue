<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSelect } from '../composables/useSelect'
import { buildDisplayGraph, displayIdOf } from '../domain/graph'
import { layersTopDown } from '../domain/layers'
import type { ViewKind } from '../domain/viewKind'
import ViewSelect from './ViewSelect.vue'
import { ForceRenderer, type Highlight } from '../render/forceRenderer'
import type { LayoutEngine, LayoutStats } from '../render/layout/types'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'

const props = defineProps<{ visibleLayers: string[]; engine: LayoutEngine }>()
const emit = defineEmits<{ 'update:view': [kind: ViewKind] }>()

const topology = useTopologyStore()
const selection = useSelectionStore()
const view = useViewStore()
const svgEl = ref<SVGSVGElement | null>(null)
/** Result of the last layout (to compare the engines) and whether a layout is in progress */
const stats = ref<LayoutStats | null>(null)
const arranging = ref(false)
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
  renderer = new ForceRenderer(
    svgEl.value,
    {
      onSelect: (id) => void selectObject(id),
      onToggleExpand: (nodeId) => view.toggleExpand(nodeId),
    },
    {
      engine: props.engine,
      onLayout: (result) => {
        arranging.value = result === null
        if (result) stats.value = result
      },
    },
  )
  if (loaded.value) renderer.setGraph(graph.value, layerOrder.value)
  renderer.setHighlight(highlight.value)
})
onBeforeUnmount(() => renderer?.destroy())

/** All the visible layers are loaded (the layout is made after that, not for each layer) */
const loaded = computed(() => props.visibleLayers.every((id) => topology.layerData[id]))

watch(graph, () => {
  if (!loaded.value) return
  renderer?.setGraph(graph.value, layerOrder.value)
  renderer?.setHighlight(highlight.value)
})
watch(highlight, () => renderer?.setHighlight(highlight.value))
watch(
  () => props.engine,
  (engine) => renderer?.setEngine(engine),
)

const statsText = computed(() => {
  const s = stats.value
  if (!s) return ''
  return `${s.ms} ms / crossings ${s.crossings} / overlap ${s.overlap.toFixed(1)} / ${s.nodes} nodes, ${s.links} links`
})
</script>

<template>
  <div class="force-view" :data-engine="engine">
    <div class="toolbar">
      <ViewSelect :kind="engine" @update:kind="(kind) => emit('update:view', kind)" />
      <button type="button" data-testid="fit" @click="renderer?.fit()">Fit</button>
      <span class="stats" data-testid="layout-stats" :data-engine="stats?.engine">{{
        arranging ? 'arranging...' : statsText
      }}</span>
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
.force-view .stats {
  opacity: 0.7;
  font-size: 0.8em;
}
.force-svg {
  width: 100%;
  height: 72vh;
  border: 1px solid var(--border);
  cursor: grab;
}
.force-svg .link {
  fill: none;
  stroke: #8888;
}
.force-svg .link.diff-added {
  stroke: var(--added);
}
.force-svg .link.diff-deleted {
  stroke: var(--deleted);
}
.force-svg .link.diff-changed {
  stroke: var(--changed);
}
.force-svg .node {
  cursor: pointer;
}
.force-svg .node circle {
  fill: var(--layer-color);
  stroke: Canvas;
  stroke-width: 1.5;
}
.force-svg .node.tp circle {
  fill: Canvas;
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
  /* the label is a part of the object: it can be clicked and hovered like the circle */
  cursor: pointer;
  paint-order: stroke;
  stroke: Canvas;
  stroke-width: 3px;
  stroke-linejoin: round;
}
.force-svg .node.tp text {
  font-size: 7px;
}
.force-svg .node.diff-added circle {
  stroke: var(--added);
  stroke-width: 3;
}
.force-svg .node.diff-deleted circle {
  stroke: var(--deleted);
  stroke-width: 3;
}
.force-svg .node.diff-changed circle {
  stroke: var(--changed);
  stroke-width: 3;
}
.force-svg .node.traced circle {
  stroke: var(--trace);
  stroke-width: 3;
}
.force-svg .node.selected circle {
  stroke: currentColor;
  stroke-width: 4;
}
/* the element under the pointer */
.force-svg .node.hover circle {
  stroke: currentColor;
  stroke-width: 3;
  filter: drop-shadow(0 0 3px var(--layer-color));
}
.force-svg .node.hover text {
  font-weight: bold;
  display: block;
}
.force-svg .node.hover.dim,
.force-svg .node.hover {
  opacity: 1;
}
.force-svg .link.hover {
  stroke: currentColor;
  opacity: 1;
}
.force-svg .node.dim,
.force-svg .link.dim {
  opacity: 0.15;
}
.force-svg .trace-edge {
  stroke: var(--trace);
  stroke-width: 2;
  stroke-dasharray: 5 3;
  pointer-events: none;
}
</style>
