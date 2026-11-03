<script setup lang="ts">
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSelect } from '../composables/useSelect'
import { layerOfId, layersTopDown } from '../domain/layers'
import { checkSupports, pairKey, type Issue } from '../domain/supportCheck'
import { traceSupports } from '../domain/tracer'
import { layerColor } from '../render/forceRenderer'
import { DEFAULT_BAND_OPTIONS, layoutBands } from '../render/layout/bands'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'

/**
 * Dependency (support) tree of the object selected in the topology view:
 * the objects it is supported by (lower layers) and the objects it supports (upper layers), in layer bands.
 * Shows nodes, or term-points if a term-point is selected (or "Term-points" is checked for a node).
 */
const props = defineProps<{ visibleLayers: string[] }>()

const topology = useTopologyStore()
const selection = useSelectionStore()
const selectObject = useSelect()
const svgEl = ref<SVGSVGElement | null>(null)
const transform = ref<ZoomTransform>(zoomIdentity)
const showIssues = ref(true)
const withTps = ref(false)
const showList = ref(false)
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null
let userMoved = false

const BAND_HEIGHT = 80
const NODE_RADIUS = 9
const TP_RADIUS = 6
const LABEL_CHAR_WIDTH = 5.5
const BAND_PADDING = 60

onMounted(() => {
  void topology.ensureSupports()
  if (!svgEl.value) return
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.05, 8])
    .on('zoom', (event) => {
      transform.value = event.transform
      // a zoom caused by the user's operation (not by fit)
      if (event.sourceEvent) userMoved = true
    })
  select(svgEl.value).call(zoomBehavior).on('dblclick.zoom', null)
})
onBeforeUnmount(() => {
  if (svgEl.value) select(svgEl.value).on('.zoom', null)
})

const layerOrder = computed(() => layersTopDown(topology.summary?.layers ?? []).map((layer) => layer.id))

/** The selected object: a node or a term-point (the others have no dependency tree) */
const target = computed(() => {
  const entry = selection.selected
  return entry && entry.type !== 'link' ? entry : undefined
})

/** Objects to start the trace: the selected one (and the term-points of a node if "Term-points" is checked) */
const startIds = computed<string[]>(() => {
  const entry = target.value
  if (!entry) return []
  if (entry.type === 'node' && withTps.value) return selection.traceStartIds
  return [entry.data.id]
})
const trace = computed(() =>
  startIds.value.length > 0 && topology.supportsLoaded
    ? traceSupports(topology.supportIndex, startIds.value, 'both')
    : null,
)

// the layers of the traced objects are needed to show them (the trace mode of the topology view may be off)
watch(
  trace,
  (result) => {
    if (!result) return
    const layers = topology.summary?.layers ?? []
    const needed = new Set<string>()
    for (const id of result.ids) {
      const layer = layerOfId(id, layers)
      if (layer) needed.add(layer)
    }
    void Promise.all([...needed].map((layer) => topology.loadLayer(layer)))
  },
  { immediate: true },
)

interface Item {
  id: string
  /** node name, or "node:term-point" for a term-point */
  name: string
  layer: string
  type: 'node' | 'tp'
  diff?: string
}
/** The traced objects (nodes and term-points). Not ready (null) until their layers are loaded */
const items = computed<Item[] | null>(() => {
  const result = trace.value
  if (!result) return null
  const list: Item[] = []
  for (const id of result.ids) {
    const entry = topology.objects.get(id)
    if (!entry) return null
    if (entry.type === 'node')
      list.push({ id, name: entry.data.name, layer: entry.layer, type: 'node', diff: entry.data.diff })
    else if (entry.type === 'tp') {
      const parent = topology.objects.get(entry.data.node)
      const nodeName = parent?.type === 'node' ? parent.data.name : entry.data.node
      list.push({
        id,
        name: `${nodeName}:${entry.data.name}`,
        layer: entry.layer,
        type: 'tp',
        diff: entry.data.diff,
      })
    }
  }
  return list
})
const itemById = computed(() => new Map((items.value ?? []).map((item) => [item.id, item])))

/** Supports between the shown objects (from: upper, to: lower) */
const edges = computed(() =>
  (trace.value?.edges ?? []).filter((edge) => itemById.value.has(edge.from) && itemById.value.has(edge.to)),
)

/** Layers of the shown objects from the top to the bottom */
const bandLayers = computed(() => {
  const present = new Set((items.value ?? []).map((item) => item.layer))
  return layersTopDown(topology.summary?.layers ?? []).filter((layer) => present.has(layer.id))
})

const layout = computed(() => {
  if (!items.value) return null
  const longest = Math.max(1, ...items.value.map((item) => item.name.length))
  // labels are put in 2 rows alternately, so a label may be as wide as 2 gaps
  const gap = Math.min(110, Math.max(DEFAULT_BAND_OPTIONS.gap, (longest * LABEL_CHAR_WIDTH) / 2 + 8))
  return layoutBands(
    bandLayers.value.map((layer) => ({
      id: layer.id,
      nodes: (items.value ?? []).filter((item) => item.layer === layer.id),
    })),
    edges.value.map((edge) => ({ from: edge.from, to: edge.to })),
    { gap, bandSpacing: BAND_HEIGHT * 1.4 },
  )
})

/** Problems of the supports (checked in the shown layers of the topology view) */
const report = computed(() => {
  const layers = layersTopDown(topology.summary?.layers ?? []).filter((layer) =>
    props.visibleLayers.includes(layer.id),
  )
  if (
    !topology.supportsLoaded ||
    layers.length === 0 ||
    !layers.every((layer) => topology.layerData[layer.id])
  )
    return null
  return checkSupports({
    layers,
    nodes: Object.fromEntries(layers.map((layer) => [layer.id, topology.layerData[layer.id]?.nodes ?? []])),
    edges: topology.supportIndex.edges,
    nodeOfTp: (tpId) => {
      const entry = topology.objects.get(tpId)
      return entry?.type === 'tp' ? entry.data.node : undefined
    },
  })
})

interface DrawnItem extends Item {
  x: number
  y: number
  issues: Issue<string>[]
  /** Row of the label (neighbors in a band have labels in different rows) */
  labelRow: number
  floating: boolean
}
const drawnItems = computed<DrawnItem[]>(() => {
  const l = layout.value
  if (!l || !items.value) return []
  const list = items.value.flatMap((item) => {
    const p = l.positions.get(item.id)
    if (!p) return []
    const issues = item.type === 'node' ? (report.value?.nodeIssues.get(item.id) ?? []) : []
    return [{ ...item, x: p.x, y: p.y, issues, labelRow: 0, floating: l.floating.has(item.id) }]
  })
  // alternate the rows of the labels in each band (from left to right)
  const count = new Map<string, number>()
  for (const item of [...list].sort((a, b) => a.x - b.x)) {
    const n = count.get(item.layer) ?? 0
    item.labelRow = n % 2
    count.set(item.layer, n + 1)
  }
  return list
})
const bands = computed(() => {
  const l = layout.value
  if (!l) return []
  return bandLayers.value.map((layer) => ({
    id: layer.id,
    name: layer.name,
    y: l.bandY.get(layer.id) ?? 0,
    x: l.minX - BAND_PADDING,
    width: l.maxX - l.minX + BAND_PADDING * 2,
    color: layerColor(layer.id, layerOrder.value),
  }))
})

interface DrawnEdge {
  key: string
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
  issues: Issue<string>[]
}
const drawnEdges = computed<DrawnEdge[]>(() => {
  const l = layout.value
  if (!l) return []
  return edges.value.flatMap((edge) => {
    const [a, b] = [l.positions.get(edge.from), l.positions.get(edge.to)]
    if (!a || !b) return []
    const key = pairKey(edge.from, edge.to)
    const issues = edge.kind === 'node' ? (report.value?.edgeIssues.get(key) ?? []) : []
    return [{ key, from: edge.from, to: edge.to, x1: a.x, y1: a.y, x2: b.x, y2: b.y, issues }]
  })
})

function itemClass(item: DrawnItem): Record<string, boolean> {
  return {
    selected: item.id === target.value?.data.id,
    tp: item.type === 'tp',
    [`diff-${item.diff}`]: Boolean(item.diff),
    warn: showIssues.value && item.issues.some((i) => i.severity === 'warn'),
    info: showIssues.value && item.issues.length > 0 && item.issues.every((i) => i.severity === 'info'),
    // the chain ends here: nothing supports the object in the lower layers
    floating: showIssues.value && item.floating,
  }
}
function titleOf(item: DrawnItem): string {
  const notes = item.issues.map((i) => `! ${i.message}`)
  if (item.floating) notes.push('! no supporting object in the lower layers (the chain ends here)')
  return [item.name, ...notes].join('\n')
}

/** Problems of the shown objects (counts and the list) */
const issueList = computed(() => {
  const r = report.value
  if (!r) return []
  const list: { key: string; severity: string; code: string; text: string; select?: string }[] = []
  const shownLayers = new Set(bandLayers.value.map((layer) => layer.id))
  const layerName = (id: string) => bandLayers.value.find((layer) => layer.id === id)?.name ?? id
  for (const issue of r.layerIssues) {
    if (!shownLayers.has(issue.from) || !shownLayers.has(issue.to)) continue
    list.push({
      key: `layer:${issue.code}:${issue.from}:${issue.to}`,
      severity: issue.severity,
      code: issue.code,
      text: `${layerName(issue.from)} → ${layerName(issue.to)}: ${issue.message}`,
    })
  }
  for (const item of drawnItems.value)
    for (const issue of item.issues)
      list.push({
        key: `node:${issue.code}:${item.id}`,
        severity: issue.severity,
        code: issue.code,
        text: `${item.name}: ${issue.message}`,
        select: item.id,
      })
  for (const edge of drawnEdges.value)
    for (const issue of edge.issues)
      list.push({
        key: `edge:${issue.code}:${edge.key}`,
        severity: issue.severity,
        code: issue.code,
        text: `${itemById.value.get(edge.from)?.name} → ${itemById.value.get(edge.to)?.name}: ${issue.message}`,
        select: edge.from,
      })
  return list.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1))
})
const counts = computed(() => ({
  warn: issueList.value.filter((i) => i.severity === 'warn').length,
  info: issueList.value.filter((i) => i.severity === 'info').length,
}))

function fit(): void {
  const svg = svgEl.value
  const l = layout.value
  if (!svg || !zoomBehavior || !l) return
  const [minX, maxX] = [l.minX - BAND_PADDING, l.maxX + BAND_PADDING]
  const ys = [...l.bandY.values()]
  const [minY, maxY] = [Math.min(...ys) - BAND_HEIGHT / 2, Math.max(...ys) + BAND_HEIGHT / 2]
  const width = svg.clientWidth || 800
  const height = svg.clientHeight || 600
  const scale = Math.min(
    1.2,
    (width - 40) / Math.max(1, maxX - minX),
    (height - 40) / Math.max(1, maxY - minY),
  )
  const t = zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
  select(svg).call(zoomBehavior.transform, t)
}
// fit when the tree changes, unless the user has moved the view since the last fit
watch(
  layout,
  () => {
    if (!userMoved) fit()
  },
  { flush: 'post' },
)
// another object is selected: the new tree is shown whole
watch(
  () => target.value?.data.id,
  () => {
    userMoved = false
  },
)
function onFit(): void {
  userMoved = false
  fit()
}
</script>

<template>
  <div class="dependency-view" data-testid="dependency-view">
    <div class="toolbar">
      <strong>Dependency</strong>
      <span v-if="target" class="target" data-testid="dependency-target">{{ target.data.name }}</span>
      <label v-if="target?.type === 'node'">
        <input v-model="withTps" type="checkbox" data-testid="with-tps" />
        Term-points
      </label>
      <button type="button" data-testid="dependency-fit" @click="onFit">Fit</button>
      <label>
        <input v-model="showIssues" type="checkbox" data-testid="show-issues" />
        Mark problems
      </label>
      <button
        v-if="items"
        type="button"
        class="issue-count"
        data-testid="issue-count"
        :aria-expanded="showList"
        @click="showList = !showList"
      >
        problems: {{ counts.warn }} warn / {{ counts.info }} info
      </button>
    </div>
    <ul v-if="showList && items" class="issue-list" data-testid="issue-list">
      <li v-if="issueList.length === 0">No problems found.</li>
      <li v-for="item in issueList" :key="item.key" :class="item.severity">
        <button v-if="item.select" type="button" class="link" @click="void selectObject(item.select)">
          <code>{{ item.code }}</code> {{ item.text }}
        </button>
        <template v-else>
          <code>{{ item.code }}</code> {{ item.text }}
        </template>
      </li>
    </ul>
    <p v-if="!selection.selectedId" class="note" data-testid="dependency-hint">
      Select a node or a term-point in the topology view to see what supports it and what it supports.
    </p>
    <p v-else-if="!target" class="note">Links have no dependency tree: select a node or a term-point.</p>
    <p v-else-if="!items" class="note">Loading...</p>
    <svg ref="svgEl" class="dependency-svg" data-testid="dependency-svg">
      <g :transform="transform.toString()">
        <g
          v-for="band in bands"
          :key="band.id"
          class="band"
          :data-layer="band.id"
          :style="{ '--layer-color': band.color }"
        >
          <rect :x="band.x" :y="band.y - BAND_HEIGHT / 2" :width="band.width" :height="BAND_HEIGHT" />
          <text :x="band.x + 6" :y="band.y - BAND_HEIGHT / 2 + 14" class="band-label">{{ band.name }}</text>
        </g>
        <g class="edges">
          <line
            v-for="edge in drawnEdges"
            :key="edge.key"
            :x1="edge.x1"
            :y1="edge.y1"
            :x2="edge.x2"
            :y2="edge.y2"
            class="support"
            :class="{ warn: showIssues && edge.issues.length > 0 }"
            :data-from="edge.from"
            :data-to="edge.to"
          >
            <title v-if="edge.issues.length > 0">
              {{ edge.issues.map((i) => `! ${i.message}`).join('\n') }}
            </title>
          </line>
        </g>
        <g
          v-for="item in drawnItems"
          :key="item.id"
          class="node"
          :class="itemClass(item)"
          :data-id="item.id"
          :transform="`translate(${item.x},${item.y})`"
          :style="{ '--layer-color': layerColor(item.layer, layerOrder) }"
          @click.stop="void selectObject(item.id)"
        >
          <title>{{ titleOf(item) }}</title>
          <circle :r="item.type === 'tp' ? TP_RADIUS : NODE_RADIUS" />
          <text :y="NODE_RADIUS + 11 + item.labelRow * 11" text-anchor="middle">{{ item.name }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>

<style>
.dependency-view .toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}
.dependency-view .note {
  opacity: 0.7;
}
.dependency-view .issue-list {
  max-height: 10rem;
  overflow: auto;
  margin: 0 0 0.25rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  font-size: 0.85em;
  list-style: none;
}
.dependency-view .issue-list li.warn {
  color: var(--changed-text);
}
.dependency-view .issue-list li.info {
  opacity: 0.75;
}
.dependency-view .issue-list .link {
  all: unset;
  display: block;
  cursor: pointer;
  text-decoration: underline;
}
.dependency-svg {
  width: 100%;
  height: 72vh;
  border: 1px solid var(--border);
  cursor: grab;
}
.dependency-svg .band rect {
  fill: var(--layer-color);
  fill-opacity: 0.08;
  stroke: var(--layer-color);
  stroke-opacity: 0.4;
}
.dependency-svg .band-label {
  font-size: 11px;
  fill: currentColor;
  opacity: 0.7;
}
.dependency-svg .support {
  stroke: #8888;
  stroke-width: 1.5;
}
.dependency-svg .support.warn {
  stroke: var(--changed);
  stroke-dasharray: 4 3;
}
.dependency-svg .support.traced {
  stroke: var(--trace);
  stroke-width: 2.5;
}
.dependency-svg .support:hover {
  stroke: currentColor;
}
.dependency-svg .node {
  cursor: pointer;
}
.dependency-svg .node circle {
  fill: var(--layer-color);
  stroke: Canvas;
  stroke-width: 1.5;
}
.dependency-svg .node text {
  font-size: 10px;
  fill: currentColor;
  paint-order: stroke;
  stroke: Canvas;
  stroke-width: 3px;
  stroke-linejoin: round;
}
.dependency-svg .node.diff-added circle {
  stroke: var(--added);
  stroke-width: 3;
}
.dependency-svg .node.diff-deleted circle {
  stroke: var(--deleted);
  stroke-width: 3;
}
.dependency-svg .node.diff-changed circle {
  stroke: var(--changed);
  stroke-width: 3;
}
.dependency-svg .node.warn circle {
  stroke: var(--changed);
  stroke-width: 3;
  stroke-dasharray: 3 2;
}
.dependency-svg .node.info circle {
  stroke: currentColor;
  stroke-opacity: 0.5;
  stroke-width: 2;
  stroke-dasharray: 2 2;
}
.dependency-svg .node.tp circle {
  fill: Canvas;
  stroke: var(--layer-color);
  stroke-width: 2;
}
.dependency-svg .node.floating circle {
  stroke-dasharray: 2 2;
}
.dependency-svg .node.traced circle {
  stroke: var(--trace);
  stroke-width: 3;
  stroke-dasharray: none;
}
.dependency-svg .node.selected circle {
  stroke: currentColor;
  stroke-width: 4;
  stroke-dasharray: none;
}
.dependency-svg .node:hover circle {
  stroke: currentColor;
  stroke-width: 3;
}
.dependency-svg .node.dim,
.dependency-svg .support.dim {
  opacity: 0.2;
}
.dependency-svg .node:hover,
.dependency-svg .support:hover {
  opacity: 1;
}
</style>
