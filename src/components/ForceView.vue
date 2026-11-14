<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSelect } from '../composables/useSelect'
import { buildDisplayGraph, displayIdOf } from '../domain/graph'
import { layersTopDown } from '../domain/layers'
import { ForceRenderer, type Highlight } from '../render/forceRenderer'
import { getProfiles } from '../api/client'
import type { ProfileFile } from '../api/types'
import { selectProfile } from '../render/layout/schematic/profile'
import {
  loadProfiles,
  type LoadedProfile,
  type LoadedProfiles,
  type ProfileChoice,
  type ProfileSource,
  profileChoices,
} from '../render/layout/schematic/profileSource'
import type { SchematicBase, SchematicReport } from '../render/layout/schematic/types'
import { lowerLayerIdsOf, schematicBasesOf } from '../domain/schematicBases'
import SchematicReportPanel from './SchematicReportPanel.vue'
import {
  DEFAULT_LAYER_ARRANGEMENT,
  LAYER_ARRANGEMENTS,
  LAYOUT_ENGINES,
  parseLayerArrangement,
  parseLayoutEngine,
  type LayerArrangement,
  type LayoutEngine,
  type LayoutStats,
} from '../render/layout/types'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'

const props = defineProps<{
  visibleLayers: string[]
  engine: LayoutEngine
  /** Arrangement of the layers (default: column) */
  layerArrangement?: LayerArrangement
  /** Counted up when the size of the view is changed from outside: the figure is fitted to the new size */
  fitSignal?: number
  /** Name of the diagram profile for the schematic layout */
  profile?: string
  /** Source of the profiles (default: the API of the backend) */
  profileSource?: ProfileSource
}>()
const emit = defineEmits<{
  'update:engine': [engine: LayoutEngine]
  'update:layerArrangement': [arrangement: LayerArrangement]
  /** The profile is chosen by the user (the name of the file, or undefined: select by the target) */
  'update:profile': [name: string | undefined]
}>()

const topology = useTopologyStore()
const selection = useSelectionStore()
const view = useViewStore()
const svgEl = ref<SVGSVGElement | null>(null)
/** Result of the last layout (to compare the engines) and whether a layout is in progress */
const stats = ref<LayoutStats | null>(null)
const arranging = ref(false)
/** What the schematic layout was made from and the exceptions, for each layer (of the latest layout) */
const reports = ref<SchematicReport[]>([])
/** Problem of loading the profile (the schematic layout is made without a profile then) */
const profileError = ref('')
/** The profiles are loaded (or failed): the schematic layout waits for them, not to arrange twice */
const profileSettled = ref(!(props.engine === 'schematic' || props.profile))
/** The profiles in use: where they are from, and whether the file was named (`?profile=`) or selected by the target */
const profileInfo = ref<{ how: 'explicit' | 'auto'; entries: LoadedProfile[] } | null>(null)
/** The lower layers which the schematic layout inherits from are loaded (the layout waits for them, too) */
const basesReady = ref(props.engine !== 'schematic')
let bases: ReadonlyMap<string, readonly SchematicBase[]> = new Map()
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
      layerArrangement: props.layerArrangement ?? DEFAULT_LAYER_ARRANGEMENT,
      schematicBases: bases,
      onLayout: (result) => {
        arranging.value = result === null
        if (result) stats.value = result
        else reports.value = [] // a new layout is started: the reports come with its result
      },
      onSchematicReport: (report) => {
        reports.value = [...reports.value.filter((r) => r.layer !== report.layer), report].sort((a, b) =>
          a.layer.localeCompare(b.layer, 'en', { numeric: true }),
        )
      },
    },
  )
  if (loaded.value) showGraph()
  else renderer.setHighlight(highlight.value)
  if (props.profile || props.engine === 'schematic') void applyProfile()
})
onBeforeUnmount(() => {
  profileToken++
  basesToken++
  renderer?.destroy()
})

/**
 * The profile files of the network, kept after the first successful fetch (the loading of the profiles and the choices
 * share them: the backend is asked once for the view, which is made again for another network / snapshot).
 */
let filesCache: ProfileFile[] | undefined
const cachedSource: ProfileSource = async (network) => {
  if (filesCache) return filesCache
  const files = await (props.profileSource ?? getProfiles)(network)
  filesCache = files
  return files
}
/** The profile files which can be chosen in the toolbar (loaded when the schematic layout is used) */
const choices = ref<ProfileChoice[]>([])
let choicesLoaded = false
async function loadChoices(): Promise<void> {
  if (choicesLoaded) return
  choicesLoaded = true
  try {
    choices.value = await profileChoices(topology.network, cachedSource, topology.snapshot || undefined)
  } catch {
    choices.value = [] // the error is told by the loading of the profiles
    choicesLoaded = false
  }
}
/**
 * Items of the profile select: the files which apply to this snapshot (the others are hidden, except the one which
 * is named in the URL: it is shown with the reason so that the user sees why it is not used)
 */
const profileItems = computed(() =>
  choices.value
    .filter((choice) => choice.applies || choice.name === props.profile)
    .map((choice) => ({
      name: choice.name,
      label: choice.applies
        ? choice.name
        : `${choice.name} (${choice.error ?? 'does not apply to this snapshot'})`,
    })),
)
function onProfileChange(event: Event): void {
  const name = (event.target as HTMLSelectElement).value
  emit('update:profile', name === '' ? undefined : name)
}

/** To ignore the result of an old (asynchronous) loading of a profile */
let profileToken = 0
/**
 * Loaded profiles by the name of the file ('' for all): a loading is not repeated (and the same profiles are not
 * given to the renderer again, which would arrange again) when the engine is changed back and forth. The view is
 * made again for another network / snapshot, so they are for this one.
 */
const loadedProfiles = new Map<string, LoadedProfiles>()
/**
 * Load the profiles of the network for the schematic layout: only the file of the name (`?profile=`) or, without a
 * name, all the files (the profile of a layer is selected by its target). They are not loaded for the other engines
 * unless a name is given.
 */
async function applyProfile(): Promise<void> {
  const token = ++profileToken
  const name = props.profile || undefined
  profileError.value = ''
  const wanted = props.engine === 'schematic' || name !== undefined
  profileSettled.value = !wanted
  if (!wanted) {
    // (the profiles in the renderer are not used by the other engines: not changed, not to arrange for nothing)
    profileInfo.value = null
    return
  }
  const label = name === undefined ? 'profiles' : `profile '${name}'`
  const how = name === undefined ? 'auto' : 'explicit'
  try {
    let loaded = loadedProfiles.get(name ?? '')
    if (!loaded) {
      loaded = await loadProfiles(topology.network, cachedSource, {
        ...(name === undefined ? {} : { name }),
        ...(topology.snapshot ? { snapshot: topology.snapshot } : {}),
      })
      if (token !== profileToken) return
      loadedProfiles.set(name ?? '', loaded)
    }
    if (loaded.warnings.length > 0) profileError.value = `${label}: ${loaded.warnings.join('; ')}`
    profileInfo.value = { how, entries: loaded.entries }
    renderer?.setProfiles(loaded.profiles)
  } catch (error) {
    if (token !== profileToken) return
    profileError.value = `${label}: ${error instanceof Error ? error.message : String(error)}`
    profileInfo.value = null
    renderer?.setProfiles([])
  }
  profileSettled.value = true
  arrangeWhenReady()
  void loadChoices() // after the profiles are loaded (the choices are fetched once, apart from the loading)
}
watch([() => props.profile, () => props.engine === 'schematic'], () => void applyProfile())

/** Told in the report when no profile applies to the network / snapshot (the layers are arranged without profiles) */
const profileNote = computed(() =>
  profileInfo.value && profileInfo.value.entries.length === 0
    ? 'no profile applies to this network / snapshot'
    : '',
)

/** Which profile (file, document) each layer is arranged by, for the report: the target selects it as the renderer does */
const profileLabels = computed(() => {
  const info = profileInfo.value
  const labels: Record<string, string> = {}
  if (!info) return labels
  for (const layer of layerOrder.value) {
    const profile = selectProfile(
      info.entries.map((entry) => entry.profile),
      layer,
    )
    const entry = info.entries.find((e) => e.profile === profile)
    if (entry)
      labels[layer] = `${entry.file} #${entry.index} (${info.how === 'auto' ? 'by target' : 'named'})`
  }
  return labels
})

/** All the visible layers are loaded (the layout is made after that, not for each layer) */
let graphShown = false
function showGraph(): void {
  graphShown = true
  renderer?.setGraph(graph.value, layerOrder.value)
  renderer?.setHighlight(highlight.value)
}

const visibleLoaded = computed(() => props.visibleLayers.every((id) => topology.layerData[id]))
const loaded = computed(
  () => visibleLoaded.value && (props.engine !== 'schematic' || (profileSettled.value && basesReady.value)),
)

/** To ignore the result of an old (asynchronous) loading of the lower layers */
let basesToken = 0
/** The engine is changed to schematic: the renderer is told after the lower layers are loaded */
let pendingEngine = false
/**
 * Load the lower layers which the visible layers reach by the supports (the candidates to inherit the arrangement
 * from) and give them to the schematic layout.
 */
async function prepareBases(): Promise<void> {
  const token = ++basesToken
  if (props.engine !== 'schematic') {
    basesReady.value = true
    return
  }
  basesReady.value = false
  if (!visibleLoaded.value) return // it is prepared again when the layers are loaded
  try {
    await topology.ensureSupports()
    const layers = topology.summary?.layers ?? []
    const needed = new Set(
      props.visibleLayers.flatMap((id) => {
        const data = topology.layerData[id]
        return data ? lowerLayerIdsOf(data, layers, topology.supportIndex) : []
      }),
    )
    await Promise.all([...needed].map((id) => topology.loadLayer(id)))
    if (token !== basesToken) return
    bases = new Map(
      props.visibleLayers.map((id) => [
        id,
        schematicBasesOf(id, topology.layerData, layers, topology.supportIndex),
      ]),
    )
    renderer?.setSchematicBases(bases)
  } catch (error) {
    // the layout is made without the lower layers
    console.warn('netoviz2: cannot load the lower layers of the schematic layout', error)
  }
  if (token !== basesToken) return
  basesReady.value = true
  if (pendingEngine) arrangeWhenReady()
  else if (loaded.value) showGraph()
}
/**
 * The engine was changed to schematic: arrange once, after both the lower layers and the profiles are loaded
 * (called when either of them is done)
 */
function arrangeWhenReady(): void {
  if (!pendingEngine || !basesReady.value || !profileSettled.value) return
  pendingEngine = false
  renderer?.setEngine('schematic')
}
watch([() => props.engine, () => props.visibleLayers.join(','), visibleLoaded], () => void prepareBases(), {
  immediate: true,
})
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
  (engine) => {
    // (prepareBases is called before this: basesReady is false while the lower layers are loaded)
    pendingEngine = engine === 'schematic' && !(basesReady.value && profileSettled.value)
    if (!pendingEngine) renderer?.setEngine(engine)
  },
)

watch(
  () => props.layerArrangement,
  (arrangement) => {
    // (while the schematic layout waits for the profiles/bases, the layout which comes next uses the arrangement)
    renderer?.setLayerArrangement(arrangement ?? DEFAULT_LAYER_ARRANGEMENT)
  },
)

watch(
  () => props.fitSignal,
  () => renderer?.fit(),
)

const statsText = computed(() => {
  const s = stats.value
  if (!s) return ''
  return `${s.ms} ms / crossings ${s.crossings} / overlap ${s.overlap.toFixed(1)} / ${s.nodes} nodes, ${s.links} links`
})

function onLayerArrangementChange(event: Event): void {
  const arrangement = parseLayerArrangement((event.target as HTMLSelectElement).value)
  if (arrangement) emit('update:layerArrangement', arrangement)
}

function onEngineChange(event: Event): void {
  const engine = parseLayoutEngine((event.target as HTMLSelectElement).value)
  if (engine) emit('update:engine', engine)
}
</script>

<template>
  <div class="force-view" :data-engine="engine">
    <div class="view-main">
      <div class="toolbar">
        <label>
          Layout
          <select :value="engine" data-testid="layout-select" @change="onEngineChange">
            <option v-for="item in LAYOUT_ENGINES" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
        <label v-if="engine === 'schematic' && (profileItems.length > 0 || profile)">
          Profile
          <select :value="profile ?? ''" data-testid="profile-select" @change="onProfileChange">
            <option value="">Auto (by target)</option>
            <option v-for="item in profileItems" :key="item.name" :value="item.name">{{ item.label }}</option>
          </select>
        </label>
        <label>
          Layers
          <select
            :value="layerArrangement ?? DEFAULT_LAYER_ARRANGEMENT"
            data-testid="layer-arrangement-select"
            @change="onLayerArrangementChange"
          >
            <option v-for="item in LAYER_ARRANGEMENTS" :key="item.id" :value="item.id">
              {{ item.label }}
            </option>
          </select>
        </label>
        <button type="button" data-testid="fit" @click="renderer?.fit()">Fit</button>
      </div>
      <svg ref="svgEl" class="force-svg" data-testid="force-svg" />
    </div>
    <!-- information of the layout is under the svg (the viewer comes first) -->
    <div class="info" data-testid="layout-info">
      <div class="toolbar">
        <span class="stats" data-testid="layout-stats" :data-engine="stats?.engine">{{
          arranging ? 'arranging...' : statsText
        }}</span>
        <span v-if="engine === 'schematic'" class="hint" data-testid="drag-hint"
          >Drag: move a node (20px grid) · Shift+drag: its row (vertically) · Ctrl/⌘+drag: its column
          (horizontally)</span
        >
        <span v-if="profileError" class="error" data-testid="profile-error">{{ profileError }}</span>
      </div>
      <SchematicReportPanel
        v-if="engine === 'schematic' && reports.length > 0"
        :reports="reports"
        :profiles="profileLabels"
        :note="profileNote"
      />
    </div>
  </div>
</template>

<style>
/* the toolbar and the svg have a fixed height (the svg keeps its size): the information is added under them */
.force-view .view-main {
  display: flex;
  flex-direction: column;
  height: var(--viewer-height, 72vh);
  min-height: 0;
}
.force-view .toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}
.force-view .info {
  margin-top: 0.25rem;
}
.force-view .info .toolbar {
  margin-bottom: 0;
}
.force-view .stats {
  opacity: 0.7;
  font-size: 0.8em;
}
.force-view .hint {
  opacity: 0.7;
  font-size: 0.8em;
}
.force-view .toolbar .error {
  font-size: 0.8em;
}
.force-svg {
  width: 100%;
  flex: 1 1 0;
  min-height: 0;
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
/* (schematic layout) the nodes a drag with Shift / Ctrl moves: in the layer, and in the other layers */
.force-svg .node.will-move circle {
  stroke: var(--changed);
  stroke-width: 4;
  filter: drop-shadow(0 0 4px var(--changed));
}
.force-svg .node.will-follow circle {
  stroke: var(--changed);
  stroke-width: 3;
  stroke-dasharray: 3 2;
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
