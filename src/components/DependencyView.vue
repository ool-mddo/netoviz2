<script setup lang="ts">
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSelect } from '../composables/useSelect'
import { layersTopDown } from '../domain/layers'
import { checkSupports, pairKey, type Issue } from '../domain/supportCheck'
import type { ViewKind } from '../domain/viewKind'
import { layerColor } from '../render/forceRenderer'
import { layoutBands, DEFAULT_BAND_OPTIONS } from '../render/layout/bands'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import ViewSelect from './ViewSelect.vue'

const props = defineProps<{ visibleLayers: string[] }>()
const emit = defineEmits<{ 'update:view': [kind: ViewKind] }>()

const topology = useTopologyStore()
const selection = useSelectionStore()
const selectObject = useSelect()
const svgEl = ref<SVGSVGElement | null>(null)
const transform = ref<ZoomTransform>(zoomIdentity)
const showIssues = ref(true)
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null
let userMoved = false

const BAND_HEIGHT = 96
const NODE_RADIUS = 9
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

/** Shown layers from the top to the bottom */
const layers = computed(() =>
  layersTopDown(topology.summary?.layers ?? []).filter((layer) => props.visibleLayers.includes(layer.id)),
)
const layerOrder = computed(() => layersTopDown(topology.summary?.layers ?? []).map((layer) => layer.id))
/** The layers and the supports are loaded (before that, the check would report false problems) */
const ready = computed(
  () =>
    topology.supportsLoaded && layers.value.length > 0 && layers.value.every((l) => topology.layerData[l.id]),
)

const nodesOfLayer = computed(() => {
  const result: Record<string, { id: string; name: string; diff?: string }[]> = {}
  for (const layer of layers.value) result[layer.id] = topology.layerData[layer.id]?.nodes ?? []
  return result
})
const nodeById = computed(() => {
  const map = new Map<string, { id: string; name: string; layer: string; diff?: string }>()
  for (const layer of layers.value)
    for (const node of nodesOfLayer.value[layer.id] ?? []) map.set(node.id, { ...node, layer: layer.id })
  return map
})

const report = computed(() => {
  if (!ready.value) return null
  return checkSupports({
    layers: layers.value,
    nodes: nodesOfLayer.value,
    edges: topology.supportIndex.edges,
    nodeOfTp: (tpId) => {
      const entry = topology.objects.get(tpId)
      return entry?.type === 'tp' ? entry.data.node : undefined
    },
  })
})

const layout = computed(() => {
  if (!ready.value) return null
  const longest = Math.max(1, ...[...nodeById.value.values()].map((node) => node.name.length))
  // labels are put in 2 rows alternately, so a label may be as wide as 2 gaps
  const gap = Math.min(90, Math.max(DEFAULT_BAND_OPTIONS.gap, (longest * LABEL_CHAR_WIDTH) / 2 + 8))
  return layoutBands(
    layers.value.map((layer) => ({ id: layer.id, nodes: nodesOfLayer.value[layer.id] ?? [] })),
    (report.value?.pairs ?? []).map((pair) => ({ from: pair.from, to: pair.to })),
    { gap, bandSpacing: BAND_HEIGHT * 1.5 },
  )
})

interface DrawnNode {
  id: string
  name: string
  layer: string
  x: number
  y: number
  diff?: string
  issues: Issue<string>[]
  /** Row of the label (neighbors in a band have labels in different rows) */
  labelRow: number
}
const drawnNodes = computed<DrawnNode[]>(() => {
  const l = layout.value
  if (!l) return []
  const nodes = [...nodeById.value.values()].flatMap((node) => {
    const p = l.positions.get(node.id)
    return p
      ? [{ ...node, x: p.x, y: p.y, issues: report.value?.nodeIssues.get(node.id) ?? [], labelRow: 0 }]
      : []
  })
  // alternate the rows of the labels in each band (from left to right)
  const rowOfBand = new Map<string, number>()
  for (const node of [...nodes].sort((a, b) => a.x - b.x)) {
    const n = rowOfBand.get(node.layer) ?? 0
    node.labelRow = n % 2
    rowOfBand.set(node.layer, n + 1)
  }
  return nodes
})
const bands = computed(() => {
  const l = layout.value
  if (!l) return []
  return layers.value.map((layer) => ({
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
  return (report.value?.pairs ?? []).flatMap((pair) => {
    const [a, b] = [l.positions.get(pair.from), l.positions.get(pair.to)]
    if (!a || !b) return []
    const key = pairKey(pair.from, pair.to)
    return [
      {
        key,
        from: pair.from,
        to: pair.to,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        issues: report.value?.edgeIssues.get(key) ?? [],
      },
    ]
  })
})

/** Trace of the selected object at the node level (term-points are traced to their nodes) */
const traced = computed(() => {
  const nodes = new Set<string>()
  const pairs = new Set<string>()
  const toNode = (id: string): string | undefined => {
    const entry = topology.objects.get(id)
    if (entry?.type === 'node') return entry.data.id
    if (entry?.type === 'tp') return entry.data.node
    return undefined
  }
  for (const id of selection.trace.ids) {
    const node = toNode(id)
    if (node) nodes.add(node)
  }
  for (const edge of selection.trace.edges) {
    const [from, to] = [toNode(edge.from), toNode(edge.to)]
    if (from && to) pairs.add(pairKey(from, to))
  }
  return { nodes, pairs }
})
const selectedNode = computed(() => {
  const entry = selection.selected
  if (!entry) return null
  return entry.type === 'node' ? entry.data.id : entry.type === 'tp' ? entry.data.node : null
})
const hasSelection = computed(() => selectedNode.value !== null)

function nodeClass(node: DrawnNode): Record<string, boolean> {
  return {
    selected: node.id === selectedNode.value,
    traced: traced.value.nodes.has(node.id),
    dim: hasSelection.value && !traced.value.nodes.has(node.id),
    [`diff-${node.diff}`]: Boolean(node.diff),
    warn: showIssues.value && node.issues.some((i) => i.severity === 'warn'),
    info: showIssues.value && node.issues.length > 0 && node.issues.every((i) => i.severity === 'info'),
    floating: showIssues.value && (layout.value?.floating.has(node.id) ?? false),
  }
}
function edgeClass(edge: DrawnEdge): Record<string, boolean> {
  return {
    traced: traced.value.pairs.has(edge.key),
    dim: hasSelection.value && !traced.value.pairs.has(edge.key),
    warn: showIssues.value && edge.issues.length > 0,
  }
}
function titleOf(node: DrawnNode): string {
  return [node.name, ...node.issues.map((i) => `! ${i.message}`)].join('\n')
}

/** Problems found by the check (counts and the list) */
const counts = computed(() => {
  const r = report.value
  if (!r) return { warn: 0, info: 0 }
  let [warn, info] = [0, 0]
  const all = [...r.nodeIssues.values(), ...r.edgeIssues.values(), r.layerIssues]
  for (const list of all)
    for (const issue of list) {
      if (issue.severity === 'warn') warn++
      else info++
    }
  return { warn, info }
})
const issueList = computed(() => {
  const r = report.value
  if (!r) return []
  const items: { key: string; severity: string; code: string; text: string; select?: string }[] = []
  const name = (id: string) => nodeById.value.get(id)?.name ?? id
  const layerName = (id: string) => layers.value.find((l) => l.id === id)?.name ?? id
  for (const issue of r.layerIssues)
    items.push({
      key: `layer:${issue.code}:${issue.from}:${issue.to}`,
      severity: issue.severity,
      code: issue.code,
      text: `${layerName(issue.from)} → ${layerName(issue.to)}: ${issue.message}`,
    })
  for (const [id, list] of r.nodeIssues)
    for (const issue of list)
      items.push({
        key: `node:${issue.code}:${id}`,
        severity: issue.severity,
        code: issue.code,
        text: `${name(id)} (${layerName(nodeById.value.get(id)?.layer ?? '')}): ${issue.message}`,
        select: id,
      })
  for (const [key, list] of r.edgeIssues) {
    const pair = r.pairs.find((p) => pairKey(p.from, p.to) === key)
    for (const issue of list)
      items.push({
        key: `edge:${issue.code}:${key}`,
        severity: issue.severity,
        code: issue.code,
        text: `${name(pair?.from ?? '')} → ${name(pair?.to ?? '')}: ${issue.message}`,
        select: pair?.from,
      })
  }
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1))
})
const showList = ref(false)

function fit(): void {
  const svg = svgEl.value
  const l = layout.value
  if (!svg || !zoomBehavior || !l) return
  const rows = l.bandY.size
  const [minX, maxX] = [l.minX - BAND_PADDING, l.maxX + BAND_PADDING]
  const [minY, maxY] = [-BAND_HEIGHT / 2, (Math.max(1, rows) - 1) * BAND_HEIGHT * 1.5 + BAND_HEIGHT / 2]
  const width = svg.clientWidth || 800
  const height = svg.clientHeight || 600
  const scale = Math.min(2, (width - 40) / Math.max(1, maxX - minX), (height - 40) / Math.max(1, maxY - minY))
  const t = zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
  select(svg).call(zoomBehavior.transform, t)
}
// fit when the layout is first made, and while the user has not moved the view
watch(
  layout,
  () => {
    if (!userMoved) fit()
  },
  { flush: 'post' },
)
function onFit(): void {
  userMoved = false
  fit()
}
</script>

<template>
  <div class="dependency-view" data-testid="dependency-view">
    <div class="toolbar">
      <ViewSelect kind="dependency" @update:kind="(kind) => emit('update:view', kind)" />
      <button type="button" data-testid="fit" @click="onFit">Fit</button>
      <label>
        <input v-model="showIssues" type="checkbox" data-testid="show-issues" />
        Mark problems
      </label>
      <button
        v-if="report"
        type="button"
        class="issue-count"
        data-testid="issue-count"
        :aria-expanded="showList"
        @click="showList = !showList"
      >
        problems: {{ counts.warn }} warn / {{ counts.info }} info
      </button>
    </div>
    <ul v-if="showList && report" class="issue-list" data-testid="issue-list">
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
    <p v-if="!ready" class="note">Loading...</p>
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
            :class="edgeClass(edge)"
            :data-from="edge.from"
            :data-to="edge.to"
          >
            <title v-if="edge.issues.length > 0">
              {{ edge.issues.map((i) => `! ${i.message}`).join('\n') }}
            </title>
          </line>
        </g>
        <g
          v-for="node in drawnNodes"
          :key="node.id"
          class="node"
          :class="nodeClass(node)"
          :data-id="node.id"
          :transform="`translate(${node.x},${node.y})`"
          :style="{ '--layer-color': layerColor(node.layer, layerOrder) }"
          @click.stop="void selectObject(node.id)"
        >
          <title>{{ titleOf(node) }}</title>
          <circle :r="NODE_RADIUS" />
          <text :y="NODE_RADIUS + 11 + node.labelRow * 11" text-anchor="middle">{{ node.name }}</text>
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
