<script setup lang="ts">
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSelect } from '../composables/useSelect'
import { layerOfId, layersTopDown } from '../domain/layers'
import { checkSupports, pairKey, type Issue } from '../domain/supportCheck'
import { traceSupports } from '../domain/tracer'
import { layerColor } from '../render/forceRenderer'
import { compareNames, detourPath, layoutBands } from '../render/layout/bands'
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

const BAND_HEIGHT = 96
const NODE_RADIUS = 9
const TP_RADIUS = 6
const LABEL_CHAR_WIDTH = 5.5
const BAND_PADDING = 60
/** Height of the box of a node with term-points, and the vertical position of the term-points in it (from the band center) */
const BOX_HEIGHT = 60
const TP_Y = 8
const TP_MIN_SLOT = 34

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

/** A term-point in the tree (shown inside the box of its node) */
interface TpItem {
  id: string
  /** name of the term-point */
  name: string
  diff?: string
}
/**
 * A node with its traced term-points: the term-points are always shown together with their node
 * (so that it is clear which node a term-point belongs to).
 */
interface Group {
  /** ID of the node */
  id: string
  name: string
  layer: string
  /** The node itself is in the tree (otherwise the node is shown only as the context of its term-points) */
  nodeTraced: boolean
  diff?: string
  tps: TpItem[]
}
/** The groups of the traced objects. Not ready (null) until their layers are loaded */
const groups = computed<Group[] | null>(() => {
  const result = trace.value
  if (!result) return null
  const map = new Map<string, Group>()
  const groupOf = (nodeId: string, layer: string): Group | null => {
    const found = map.get(nodeId)
    if (found) return found
    const node = topology.objects.get(nodeId)
    if (node?.type !== 'node') return null
    const group: Group = {
      id: nodeId,
      name: node.data.name,
      layer,
      nodeTraced: false,
      diff: node.data.diff,
      tps: [],
    }
    map.set(nodeId, group)
    return group
  }
  for (const id of result.ids) {
    const entry = topology.objects.get(id)
    if (!entry) return null
    if (entry.type === 'node') {
      const group = groupOf(id, entry.layer)
      if (!group) return null
      group.nodeTraced = true
    } else if (entry.type === 'tp') {
      const group = groupOf(entry.data.node, entry.layer)
      if (!group) return null
      group.tps.push({ id, name: entry.data.name, diff: entry.data.diff })
    }
  }
  return [...map.values()]
})
const groupByObject = computed(() => {
  const map = new Map<string, Group>()
  for (const group of groups.value ?? []) {
    map.set(group.id, group)
    for (const tp of group.tps) map.set(tp.id, group)
  }
  return map
})
const tpById = computed(
  () => new Map((groups.value ?? []).flatMap((group) => group.tps.map((tp) => [tp.id, tp] as const))),
)

/** Supports between the shown objects (from: upper, to: lower) */
const edges = computed(() =>
  (trace.value?.edges ?? []).filter(
    (edge) => groupByObject.value.has(edge.from) && groupByObject.value.has(edge.to),
  ),
)

/** Layers of the shown objects from the top to the bottom */
const bandLayers = computed(() => {
  const present = new Set((groups.value ?? []).map((group) => group.layer))
  return layersTopDown(topology.summary?.layers ?? []).filter((layer) => present.has(layer.id))
})

const tpSlotWidth = (tp: TpItem) => Math.max(TP_MIN_SLOT, tp.name.length * LABEL_CHAR_WIDTH + 8)
/** Width of a group: the name of the node and the term-points in a row */
function groupWidth(group: Group): number {
  const nameWidth = group.name.length * LABEL_CHAR_WIDTH + 16
  if (group.tps.length === 0) return nameWidth
  return Math.max(nameWidth, group.tps.reduce((sum, tp) => sum + tpSlotWidth(tp), 0) + 16)
}

const layout = computed(() => {
  if (!groups.value) return null
  // supports between the groups (the supports between term-points are rolled up to their nodes)
  const groupEdges = new Map<string, { from: string; to: string }>()
  for (const edge of edges.value) {
    const [from, to] = [groupByObject.value.get(edge.from)?.id, groupByObject.value.get(edge.to)?.id]
    if (from && to && from !== to) groupEdges.set(pairKey(from, to), { from, to })
  }
  return layoutBands(
    bandLayers.value.map((layer) => ({
      id: layer.id,
      nodes: (groups.value ?? [])
        .filter((group) => group.layer === layer.id)
        .map((group) => ({ id: group.id, name: group.name, width: groupWidth(group) })),
    })),
    [...groupEdges.values()],
    { gap: 24, bandSpacing: BAND_HEIGHT * 1.2 },
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

interface DrawnTp extends TpItem {
  x: number
}
interface DrawnGroup extends Group {
  x: number
  y: number
  width: number
  /** The group has a box (it has term-points) */
  boxed: boolean
  drawnTps: DrawnTp[]
  issues: Issue<string>[]
  floating: boolean
}
const drawnGroups = computed<DrawnGroup[]>(() => {
  const l = layout.value
  if (!l || !groups.value) return []
  const lowerOf = new Map<string, string[]>()
  for (const edge of edges.value) lowerOf.set(edge.from, [...(lowerOf.get(edge.from) ?? []), edge.to])

  // the lowest layer first: the order of the term-points in a node follows the positions of the term-points below
  const tpX = new Map<string, number>()
  const result: DrawnGroup[] = []
  for (const layer of [...bandLayers.value].reverse()) {
    for (const group of groups.value.filter((g) => g.layer === layer.id)) {
      const p = l.positions.get(group.id)
      if (!p) continue
      const wanted = (tp: TpItem) => {
        const xs = (lowerOf.get(tp.id) ?? []).flatMap((id) => (tpX.has(id) ? [tpX.get(id) as number] : []))
        return xs.length > 0 ? xs.reduce((sum, x) => sum + x, 0) / xs.length : p.x
      }
      const sorted = [...group.tps].sort((a, b) => wanted(a) - wanted(b) || compareNames(a.name, b.name))
      const total = sorted.reduce((sum, tp) => sum + tpSlotWidth(tp), 0)
      let cursor = p.x - total / 2
      const drawnTps = sorted.map((tp) => {
        const x = cursor + tpSlotWidth(tp) / 2
        cursor += tpSlotWidth(tp)
        tpX.set(tp.id, x)
        return { ...tp, x }
      })
      result.push({
        ...group,
        x: p.x,
        y: p.y,
        width: groupWidth(group),
        boxed: group.tps.length > 0,
        drawnTps,
        issues: report.value?.nodeIssues.get(group.id) ?? [],
        floating: l.floating.has(group.id),
      })
    }
  }
  return result
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
  /** Path of the line: a curve if the support skips layers (so that it does not overlap the supports through the layers) */
  d: string
}
/** Offset of the curve of a support which skips layers */
const DETOUR_STEP = 34
/** Ends of the supports: a term-point circle, or the bottom (upper end) / top (lower end) of a node */
const drawnEdges = computed<DrawnEdge[]>(() => {
  const nodes = new Map(drawnGroups.value.map((group) => [group.id, group]))
  const tps = new Map<string, { x: number; y: number }>()
  for (const group of drawnGroups.value)
    for (const tp of group.drawnTps) tps.set(tp.id, { x: tp.x, y: group.y + TP_Y })
  const end = (id: string, upper: boolean): { x: number; y: number } | undefined => {
    const tp = tps.get(id)
    if (tp) return tp
    const group = nodes.get(id)
    if (!group) return undefined
    const half = group.boxed ? BOX_HEIGHT / 2 : NODE_RADIUS
    return { x: group.x, y: group.y + (upper ? half : -half) }
  }
  const bandIndex = new Map(bandLayers.value.map((layer, i) => [layer.id, i]))
  /** Number of the supports which skip layers, for each upper object (to separate the curves) */
  const detours = new Map<string, number>()
  return edges.value.flatMap((edge) => {
    const [a, b] = [end(edge.from, true), end(edge.to, false)]
    if (!a || !b) return []
    const key = pairKey(edge.from, edge.to)
    const issues = edge.kind === 'node' ? (report.value?.edgeIssues.get(key) ?? []) : []
    const [upper, lower] = [groupByObject.value.get(edge.from), groupByObject.value.get(edge.to)]
    const skipped =
      Math.abs((bandIndex.get(lower?.layer ?? '') ?? 0) - (bandIndex.get(upper?.layer ?? '') ?? 0)) - 1
    let d = `M${a.x},${a.y} L${b.x},${b.y}`
    if (skipped > 0) {
      // bend the line to the side, away from the objects between the layers
      const count = detours.get(edge.from) ?? 0
      detours.set(edge.from, count + 1)
      d = detourPath(a, b, DETOUR_STEP * (count + 1) * (count % 2 === 0 ? 1 : -1))
    }
    return [{ key, from: edge.from, to: edge.to, x1: a.x, y1: a.y, x2: b.x, y2: b.y, issues, d }]
  })
})

const selectedId = computed(() => target.value?.data.id)
function groupClass(group: DrawnGroup): Record<string, boolean> {
  return {
    selected: group.id === selectedId.value,
    boxed: group.boxed,
    context: !group.nodeTraced,
    [`diff-${group.diff}`]: Boolean(group.diff),
    warn: showIssues.value && group.issues.some((i) => i.severity === 'warn'),
    info: showIssues.value && group.issues.length > 0 && group.issues.every((i) => i.severity === 'info'),
    // the chain ends here: nothing supports the object in the lower layers
    floating: showIssues.value && group.floating,
  }
}
function titleOf(group: DrawnGroup): string {
  const notes = group.issues.map((i) => `! ${i.message}`)
  if (group.floating) notes.push('! no supporting object in the lower layers (the chain ends here)')
  return [group.name, ...notes].join('\n')
}

/** Problems of the shown objects (counts and the list) */
const issueList = computed(() => {
  const r = report.value
  if (!r) return []
  const list: { key: string; severity: string; code: string; text: string; select?: string }[] = []
  const shownLayers = new Set(bandLayers.value.map((layer) => layer.id))
  const layerName = (id: string) => bandLayers.value.find((layer) => layer.id === id)?.name ?? id
  const nameOf = (id: string) => {
    const group = groupByObject.value.get(id)
    const tp = tpById.value.get(id)
    return tp ? `${group?.name}:${tp.name}` : (group?.name ?? id)
  }
  for (const issue of r.layerIssues) {
    if (!shownLayers.has(issue.from) || !shownLayers.has(issue.to)) continue
    list.push({
      key: `layer:${issue.code}:${issue.from}:${issue.to}`,
      severity: issue.severity,
      code: issue.code,
      text: `${layerName(issue.from)} → ${layerName(issue.to)}: ${issue.message}`,
    })
  }
  for (const group of drawnGroups.value)
    for (const issue of group.issues)
      list.push({
        key: `node:${issue.code}:${group.id}`,
        severity: issue.severity,
        code: issue.code,
        text: `${group.name}: ${issue.message}`,
        select: group.id,
      })
  for (const edge of drawnEdges.value)
    for (const issue of edge.issues)
      list.push({
        key: `edge:${issue.code}:${edge.key}`,
        severity: issue.severity,
        code: issue.code,
        text: `${nameOf(edge.from)} → ${nameOf(edge.to)}: ${issue.message}`,
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
        v-if="groups"
        type="button"
        class="issue-count"
        data-testid="issue-count"
        :aria-expanded="showList"
        @click="showList = !showList"
      >
        problems: {{ counts.warn }} warn / {{ counts.info }} info
      </button>
    </div>
    <ul v-if="showList && groups" class="issue-list" data-testid="issue-list">
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
    <p v-else-if="!groups" class="note">Loading...</p>
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
          <text :x="band.x + 6" :y="band.y - BAND_HEIGHT / 2 + 12" class="band-label">{{ band.name }}</text>
        </g>
        <!-- nodes with term-points: a box (the term-points are inside the box of their node) -->
        <g
          v-for="group in drawnGroups.filter((g) => g.boxed)"
          :key="`box:${group.id}`"
          class="group"
          :class="groupClass(group)"
          :data-id="group.id"
          :transform="`translate(${group.x},${group.y})`"
          :style="{ '--layer-color': layerColor(group.layer, layerOrder) }"
          @click.stop="void selectObject(group.id)"
        >
          <title>{{ titleOf(group) }}</title>
          <rect :x="-group.width / 2" :y="-BOX_HEIGHT / 2" :width="group.width" :height="BOX_HEIGHT" rx="6" />
          <text class="group-name" :y="-BOX_HEIGHT / 2 + 14" text-anchor="middle">{{ group.name }}</text>
        </g>
        <g class="edges">
          <path
            v-for="edge in drawnEdges"
            :key="edge.key"
            :d="edge.d"
            class="support"
            :class="{ warn: showIssues && edge.issues.length > 0 }"
            :data-from="edge.from"
            :data-to="edge.to"
          >
            <title v-if="edge.issues.length > 0">
              {{ edge.issues.map((i) => `! ${i.message}`).join('\n') }}
            </title>
          </path>
        </g>
        <!-- nodes without term-points: a circle -->
        <g
          v-for="group in drawnGroups.filter((g) => !g.boxed)"
          :key="`node:${group.id}`"
          class="node"
          :class="groupClass(group)"
          :data-id="group.id"
          :transform="`translate(${group.x},${group.y})`"
          :style="{ '--layer-color': layerColor(group.layer, layerOrder) }"
          @click.stop="void selectObject(group.id)"
        >
          <title>{{ titleOf(group) }}</title>
          <circle :r="NODE_RADIUS" />
          <text :y="NODE_RADIUS + 11" text-anchor="middle">{{ group.name }}</text>
        </g>
        <template v-for="group in drawnGroups" :key="`tps:${group.id}`">
          <g
            v-for="tp in group.drawnTps"
            :key="tp.id"
            class="node tp"
            :class="{ selected: tp.id === selectedId, [`diff-${tp.diff}`]: Boolean(tp.diff) }"
            :data-id="tp.id"
            :data-node="group.id"
            :transform="`translate(${tp.x},${group.y + TP_Y})`"
            :style="{ '--layer-color': layerColor(group.layer, layerOrder) }"
            @click.stop="void selectObject(tp.id)"
          >
            <title>{{ group.name }}:{{ tp.name }}</title>
            <circle :r="TP_RADIUS" />
            <text :y="TP_RADIUS + 10" text-anchor="middle">{{ tp.name }}</text>
          </g>
        </template>
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
  fill: none;
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
.dependency-svg .group rect {
  fill: var(--layer-color);
  fill-opacity: 0.12;
  stroke: var(--layer-color);
  stroke-width: 1.5;
  cursor: pointer;
}
.dependency-svg .group.context rect {
  stroke-dasharray: 4 3;
  fill-opacity: 0.05;
}
.dependency-svg .group-name {
  font-size: 10px;
  font-weight: bold;
  fill: currentColor;
  cursor: pointer;
}
.dependency-svg .group.warn rect {
  stroke: var(--changed);
  stroke-width: 3;
}
.dependency-svg .group.info rect {
  stroke-opacity: 0.6;
  stroke-dasharray: 2 2;
}
.dependency-svg .group.selected rect {
  stroke: currentColor;
  stroke-width: 3;
}
.dependency-svg .group.diff-added rect {
  stroke: var(--added);
}
.dependency-svg .group.diff-deleted rect {
  stroke: var(--deleted);
}
.dependency-svg .group.diff-changed rect {
  stroke: var(--changed);
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
