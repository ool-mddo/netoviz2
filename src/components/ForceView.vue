<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSelect } from '../composables/useSelect'
import { buildDisplayGraph, displayIdOf } from '../domain/graph'
import { layersTopDown } from '../domain/layers'
import { ForceRenderer, type Highlight } from '../render/forceRenderer'
import { loadProfiles, type ProfileSource } from '../render/layout/schematic/profileSource'
import {
  LAYOUT_ENGINES,
  parseLayoutEngine,
  type LayoutEngine,
  type LayoutStats,
} from '../render/layout/types'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'

const props = defineProps<{
  visibleLayers: string[]
  engine: LayoutEngine
  /** Name of the diagram profile for the schematic layout */
  profile?: string
  /** Source of the profiles (default: the profiles bundled in the app) */
  profileSource?: ProfileSource
}>()
const emit = defineEmits<{ 'update:engine': [engine: LayoutEngine] }>()

const topology = useTopologyStore()
const selection = useSelectionStore()
const view = useViewStore()
const svgEl = ref<SVGSVGElement | null>(null)
/** Result of the last layout (to compare the engines) and whether a layout is in progress */
const stats = ref<LayoutStats | null>(null)
const arranging = ref(false)
/** Problem of loading the profile (the schematic layout is made without a profile then) */
const profileError = ref('')
/** The profile of the URL is loaded (or failed): the schematic layout waits for it, not to arrange twice */
const profileSettled = ref(!props.profile)
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
  if (loaded.value) showGraph()
  else renderer.setHighlight(highlight.value)
  if (props.profile) void applyProfile(props.profile)
})
onBeforeUnmount(() => {
  profileToken++
  renderer?.destroy()
})

/** To ignore the result of an old (asynchronous) loading of a profile */
let profileToken = 0
async function applyProfile(name: string | undefined): Promise<void> {
  const token = ++profileToken
  profileError.value = ''
  profileSettled.value = !name
  if (!name) {
    renderer?.setProfiles([])
    return
  }
  try {
    const { profiles, warnings } = await loadProfiles(name, props.profileSource)
    if (token !== profileToken) return
    if (warnings.length > 0) profileError.value = `profile '${name}': ${warnings.join('; ')}`
    renderer?.setProfiles(profiles)
  } catch (error) {
    if (token !== profileToken) return
    profileError.value = `profile '${name}': ${error instanceof Error ? error.message : String(error)}`
    renderer?.setProfiles([])
  }
  profileSettled.value = true
}
watch(
  () => props.profile,
  (name) => void applyProfile(name),
)

/** All the visible layers are loaded (the layout is made after that, not for each layer) */
let graphShown = false
function showGraph(): void {
  graphShown = true
  renderer?.setGraph(graph.value, layerOrder.value)
  renderer?.setHighlight(highlight.value)
}

const loaded = computed(
  () =>
    props.visibleLayers.every((id) => topology.layerData[id]) &&
    (props.engine !== 'schematic' || profileSettled.value),
)
// the first layout which waited for the profile (a profile changed later is arranged by setProfiles)
watch(profileSettled, (settled) => {
  if (!settled || graphShown || !loaded.value) return
  showGraph()
})

watch(graph, () => {
  if (!loaded.value) return
  showGraph()
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

function onEngineChange(event: Event): void {
  const engine = parseLayoutEngine((event.target as HTMLSelectElement).value)
  if (engine) emit('update:engine', engine)
}
</script>

<template>
  <div class="force-view" :data-engine="engine">
    <div class="toolbar">
      <label>
        Layout
        <select :value="engine" data-testid="layout-select" @change="onEngineChange">
          <option v-for="item in LAYOUT_ENGINES" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <button type="button" data-testid="fit" @click="renderer?.fit()">Fit</button>
      <span class="stats" data-testid="layout-stats" :data-engine="stats?.engine">{{
        arranging ? 'arranging...' : statsText
      }}</span>
      <span v-if="profileError" class="error" data-testid="profile-error">{{ profileError }}</span>
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
.force-view .toolbar .error {
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
.force-svg:not(.zoomed-in) .node.tp:not(.selected):not(.traced):not(.hover):not(.peer) text {
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
/* the other end of the links of the hovered term-point */
.force-svg .node.peer circle {
  stroke: currentColor;
  stroke-width: 3;
  filter: drop-shadow(0 0 3px var(--layer-color));
}
.force-svg .node.peer text {
  font-weight: bold;
}
.force-svg .node.hover.dim,
.force-svg .node.hover,
.force-svg .node.peer.dim,
.force-svg .node.peer {
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
