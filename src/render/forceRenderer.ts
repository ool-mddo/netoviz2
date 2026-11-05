import { drag } from 'd3-drag'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { select, type Selection } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import type { DisplayGraph, DisplayLink, DisplayNode } from '../domain/graph'
import { countCrossings, overlapDepth, type Segment } from '../domain/layoutScore'
import { radiusForPorts, spreadAngles } from '../domain/ports'
import { layoutWithStress } from './layout/stress'
import { packBoxes } from './layout/pack'
import { layoutQuality } from './layout/quality'
import { layoutSchematic } from './layout/schematic'
import { selectProfile } from './layout/schematic/profile'
import type { DiagramProfile, SchematicLayerFn } from './layout/schematic/types'
import { type LayerLayoutFn, type LayoutEngine, type LayoutStats, type Positions } from './layout/types'

/** Colors of layers (color-blind friendly palette) */
export const LAYER_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#56B4E9',
  '#D55E00',
  '#F0E442',
  '#999999',
]

/**
 * Color of a layer: decided by the position in `layerOrder` (all layers of the topology)
 * so that it does not change when layers are shown/hidden.
 */
export function layerColor(layer: string, layerOrder: readonly string[]): string {
  const index = Math.max(0, layerOrder.indexOf(layer))
  return LAYER_COLORS[index % LAYER_COLORS.length] ?? '#999999'
}

/**
 * while a node is dragged in the stress layout, the others follow it through the links but are also
 * pulled back to where they were (so that the layout changes gently and mostly near the dragged node)
 */
const DRAG_ALPHA = 0.1
const DRAG_ANCHOR_STRENGTH = 0.12
const DRAG_CHARGE_SCALE = 0.3
const DRAG_VELOCITY_DECAY = 0.6
const NODE_RADIUS = 11
const PORT_RADIUS = 4.5
/** Length of the arc of a node circle reserved for a port */
const PORT_ARC = 14
/** Space around a node kept by the layout (for labels and links) */
const NODE_MARGIN = 20
const LAYER_SPACING_X = 800
const LAYER_SPACING_Y = 600
const FIT_MARGIN = 40
/** While the layout is moving, fit the view to all elements every this ticks (until the user moves the view) */
const FIT_INTERVAL_TICKS = 25
/** Ticks to settle the layout of a new graph before it is shown */
const WARMUP_TICKS = 300
/** Weights of the quality of the layout (the lower the score, the better) */
const CROSSING_WEIGHT = 100
const OVERLAP_WEIGHT = 10
/** The layout is tried with several random starts only for graphs not larger than this */
/** Gap between the layouts of layers (stress engine) */
const LAYER_GAP = 120
const MULTISTART_MAX_NODES = 400
/** Time to try more random starts when no layout without crossings is found */
const MULTISTART_BUDGET_MS = 500
/** The least upper limit of the number of the random starts (small graphs are made many times quickly) */
const MULTISTART_MAX_TRIES = 12
/** Number of the random starts of the layout */
const DEFAULT_MULTISTART = 6

/**
 * Element to show: a node (moved by the simulation) or a port (term-point, put on the circle of its node).
 * Ports are not in the simulation: their positions are calculated from the node and the connected nodes.
 */
type Item = SimulationNodeDatum & DisplayNode & { radius: number; angle?: number }
type SimLink = SimulationLinkDatum<Item> & { source: string | Item; target: string | Item; count: number }

/** Arrange the nodes of a layer (the layer ID, the nodes and the links in the layer) */
type LayerArrangeFn = (
  layer: string,
  items: readonly Item[],
  links: ReadonlyArray<{ source: string; target: string }>,
) => Promise<Positions>

export interface RendererCallbacks {
  /** Click on a node/term-point (id) or on the background (null) */
  onSelect: (id: string | null) => void
  /** Double click on a node/term-point: show/hide the term-points of the node (node id) */
  onToggleExpand: (nodeId: string) => void
}

export interface RendererOptions {
  /** Number of the random starts of the layout (the best layout is used). 1 to disable. */
  multiStart?: number
  /** Layout engine (default: force) */
  engine?: LayoutEngine
  /** Function to arrange with the own stress layout (default: layoutWithStress) */
  stressLayout?: LayerLayoutFn
  /** Function to arrange with the schematic layout (default: layoutSchematic) */
  schematicLayout?: SchematicLayerFn
  /** Diagram profiles for the schematic layout (see setProfiles) */
  profiles?: readonly DiagramProfile[]
  /** Called with null when a layout is started (asynchronous) and with the result when it is done */
  onLayout?: (stats: LayoutStats | null) => void
}

/** IDs are IDs of shown elements (see displayIdOf) */
export interface Highlight {
  selectedId: string | null
  tracedIds: ReadonlySet<string>
  /** Traced supports (drawn as dashed lines between the shown elements) */
  traceEdges: ReadonlyArray<{ from: string; to: string }>
}

const NO_HIGHLIGHT: Highlight = { selectedId: null, tracedIds: new Set(), traceEdges: [] }

/**
 * Force-directed view of the topology by d3-force and SVG.
 *
 * Nodes are arranged by the simulation; term-points are shown as ports on the circle of the node, toward the node
 * they are connected to, so that it is clear which term-points the nodes are linked by.
 * The layout of a new graph is made several times from random starts and the one with the fewest
 * crossings of links and overlaps of nodes is used.
 *
 * Elements are updated directly (not through the reactivity of Vue) because positions change on every tick.
 */
export class ForceRenderer {
  private readonly root: Selection<SVGGElement, unknown, null, undefined>
  private readonly linkLayer: Selection<SVGGElement, unknown, null, undefined>
  private readonly traceLayer: Selection<SVGGElement, unknown, null, undefined>
  private readonly nodeLayer: Selection<SVGGElement, unknown, null, undefined>
  private readonly simulation: Simulation<Item, SimLink>
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>
  private readonly multiStart: number
  private engine: LayoutEngine
  private readonly stressLayout: LayerLayoutFn
  private readonly schematicLayout: SchematicLayerFn
  private profiles: readonly DiagramProfile[]
  private readonly onLayout: (stats: LayoutStats | null) => void
  private graph: DisplayGraph = { nodes: [], links: [] }
  /** To ignore the result of an old (asynchronous) layout */
  private layoutToken = 0
  /** Nodes and links of the layout (not by force) which is shown (not to arrange the same graph again) */
  private appliedSignature = ''
  private lastStats: LayoutStats | null = null
  /** Time when the last layout was started (the quality of an animated layout is told when it is settled) */
  private layoutStarted: number | null = null
  private bodies: Item[] = []
  private ports: Item[] = []
  private simLinks: SimLink[] = []
  private drawLinks: DisplayLink[] = []
  private itemById = new Map<string, Item>()
  private portsOf = new Map<string, Item[]>()
  /** ID of the port => IDs of the nodes connected to the port */
  private peersOf = new Map<string, Set<string>>()
  private readonly positions = new Map<string, { x: number; y: number }>()
  /** ID of the port => angle on the circle of its node, set by the user dragging the port */
  private readonly pinnedAngles = new Map<string, number>()
  /** Layers in the order (for colors) and the layers having elements (for the areas) */
  private layerOrder: readonly string[] = []
  private areaIndex = new Map<string, number>()
  private highlight: Highlight = NO_HIGHLIGHT
  /** Element under the pointer (shown with its links) */
  private hoverId: string | null = null
  private userMoved = false
  /** Weakens the repulsion while the layout follows a dragged node (stress layout) */
  private chargeScale = 1
  /** positions the nodes are pulled back to (only while the layout follows a dragged node) */
  private anchors: Map<string, { x: number; y: number }> | null = null
  private ticks = 0

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly callbacks: RendererCallbacks,
    options: RendererOptions = {},
  ) {
    this.multiStart = options.multiStart ?? DEFAULT_MULTISTART
    this.engine = options.engine ?? 'force'
    this.stressLayout =
      options.stressLayout ?? ((nodes, links) => Promise.resolve(layoutWithStress(nodes, links)))
    this.schematicLayout = options.schematicLayout ?? layoutSchematic
    this.profiles = options.profiles ?? []
    this.onLayout = options.onLayout ?? (() => undefined)
    const svgSelection = select(svg)
    this.root = svgSelection.append('g').attr('class', 'viewport')
    this.linkLayer = this.root.append('g').attr('class', 'links')
    this.traceLayer = this.root.append('g').attr('class', 'trace-edges')
    this.nodeLayer = this.root.append('g').attr('class', 'nodes')

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 8])
      .on('zoom', (event: { transform: { k: number; toString(): string }; sourceEvent?: unknown }) => {
        this.root.attr('transform', event.transform.toString())
        // names of ports are shown when zoomed in (or highlighted)
        svg.classList.toggle('zoomed-in', event.transform.k >= 1.3)
        if (event.sourceEvent) this.userMoved = true
      })
    svgSelection.call(this.zoomBehavior).on('dblclick.zoom', null)
    svgSelection.on('click.background', () => this.callbacks.onSelect(null))

    this.simulation = forceSimulation<Item, SimLink>()
      .force(
        'link',
        forceLink<Item, SimLink>()
          .id((d) => d.id)
          .distance((l) => 70 + this.radiusOf(l.source) + this.radiusOf(l.target))
          .strength(0.5),
      )
      .force(
        'charge',
        forceManyBody<Item>().strength((d) => -(80 + d.radius * 8) * this.chargeScale),
      )
      .force(
        'collide',
        forceCollide<Item>()
          .radius((d) => d.radius + NODE_MARGIN)
          .iterations(3),
      )
      .force('x', forceX<Item>((d) => this.layerCenter(d.layer).x).strength(0.05))
      .force('y', forceY<Item>((d) => this.layerCenter(d.layer).y).strength(0.05))
      .on('tick', () => this.onTick())
      .on('end', () => {
        this.holdLayout(false)
        if (!this.userMoved) this.fit()
        // the layout of an incremental change is settled: tell its quality (the time is from the start of the layout)
        if (this.engine === 'force' && this.layoutStarted !== null) this.reportLayout(this.layoutStarted)
      })
  }

  /**
   * Set the graph to show. Positions of the nodes which are already shown are kept.
   * @param layerOrder All layer IDs of the topology in a stable order (decides the colors)
   *   Each layer shown has its own area.
   */
  setGraph(graph: DisplayGraph, layerOrder: readonly string[]): void {
    for (const body of this.bodies) {
      if (body.x !== undefined && body.y !== undefined) this.positions.set(body.id, { x: body.x, y: body.y })
    }
    this.layerOrder = layerOrder
    const shown = new Set(graph.nodes.map((node) => node.layer))
    this.areaIndex = new Map(layerOrder.filter((layer) => shown.has(layer)).map((layer, i) => [layer, i]))

    this.buildItems(graph)
    this.simulation.nodes(this.bodies)
    this.simulation.force<ReturnType<typeof forceLink<Item, SimLink>>>('link')?.links(this.simLinks)
    this.ticks = 0
    this.graph = graph
    this.runLayout()
    this.renderElements()
    this.placePorts()
    this.applyHighlight()
    this.applyHover()
    this.draw()
  }

  /** Change the layout engine: all the nodes are arranged again */
  setEngine(engine: LayoutEngine): void {
    if (engine === this.engine) return
    this.engine = engine
    this.relayout()
  }

  /** Change the diagram profiles (the schematic layout is made again with them) */
  setProfiles(profiles: readonly DiagramProfile[]): void {
    // nothing changes without profiles (and a relayout forgets the positions the user moved)
    if (profiles === this.profiles || (profiles.length === 0 && this.profiles.length === 0)) return
    this.profiles = profiles
    if (this.engine === 'schematic') this.relayout()
  }

  /** Arrange all the nodes again from scratch (the known positions are forgotten) */
  relayout(): void {
    this.positions.clear()
    this.pinnedAngles.clear()
    this.bodies = []
    this.appliedSignature = ''
    this.userMoved = false
    this.setGraph(this.graph, this.layerOrder)
  }

  setHighlight(highlight: Highlight): void {
    this.highlight = highlight
    this.applyHighlight()
    this.draw()
  }

  /** Move the viewport to see all elements */
  fit(): void {
    if (this.bodies.length === 0) return
    const xs = this.bodies.map((n) => (n.x ?? 0) - n.radius)
    const xe = this.bodies.map((n) => (n.x ?? 0) + n.radius)
    const ys = this.bodies.map((n) => (n.y ?? 0) - n.radius)
    const ye = this.bodies.map((n) => (n.y ?? 0) + n.radius)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xe), Math.min(...ys), Math.max(...ye)]
    const width = this.svg.clientWidth || 800
    const height = this.svg.clientHeight || 600
    const scale = Math.min(
      2,
      (width - FIT_MARGIN * 2) / Math.max(1, maxX - minX),
      (height - FIT_MARGIN * 2) / Math.max(1, maxY - minY),
    )
    const transform = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
    select(this.svg).call(this.zoomBehavior.transform, transform)
  }

  /** Advance the simulation by `count` ticks synchronously and draw (for tests) */
  tick(count = 1): void {
    this.simulation.stop()
    for (let i = 0; i < count; i++) {
      this.simulation.tick()
      this.onTick()
    }
  }

  destroy(): void {
    this.simulation.stop()
    const svgSelection = select(this.svg)
    svgSelection.on('.zoom', null).on('click.background', null)
    this.svg.classList.remove('zoomed-in')
    this.root.remove()
  }

  // --- items

  private layerCenter(layer: string): { x: number; y: number } {
    const index = this.areaIndex.get(layer) ?? 0
    const columns = Math.max(1, Math.ceil(Math.sqrt(this.areaIndex.size)))
    return { x: (index % columns) * LAYER_SPACING_X, y: Math.floor(index / columns) * LAYER_SPACING_Y }
  }

  private radiusOf(node: string | Item): number {
    return typeof node === 'string' ? (this.itemById.get(node)?.radius ?? NODE_RADIUS) : node.radius
  }

  private buildItems(graph: DisplayGraph): void {
    const portCounts = new Map<string, number>()
    for (const node of graph.nodes) {
      if (node.type === 'tp' && node.parent)
        portCounts.set(node.parent, (portCounts.get(node.parent) ?? 0) + 1)
    }
    const items = graph.nodes.map((node): Item => {
      if (node.type === 'tp') return { ...node, radius: PORT_RADIUS }
      const ports = portCounts.get(node.id) ?? 0
      const collapsed = NODE_RADIUS + Math.min(6, Math.log2((node.tpCount ?? 0) + 1))
      return { ...node, radius: ports > 0 ? radiusForPorts(NODE_RADIUS, ports, PORT_ARC) : collapsed }
    })
    this.bodies = items.filter((item) => item.type === 'node')
    this.ports = items.filter((item) => item.type === 'tp')
    this.itemById = new Map(items.map((item) => [item.id, item]))
    this.portsOf = new Map()
    for (const port of this.ports) {
      if (!port.parent) continue
      this.portsOf.set(port.parent, [...(this.portsOf.get(port.parent) ?? []), port])
    }

    this.drawLinks = graph.links.filter((link) => link.type === 'link')
    const nodeOf = (id: string) => this.itemById.get(id)?.parent ?? id
    const bundles = new Map<string, SimLink>()
    this.peersOf = new Map()
    for (const link of this.drawLinks) {
      const [a, b] = [nodeOf(link.source), nodeOf(link.target)]
      this.addPeer(link.source, b)
      this.addPeer(link.target, a)
      if (a === b || !this.itemById.has(a) || !this.itemById.has(b)) continue
      const key = a < b ? `${a}\n${b}` : `${b}\n${a}`
      const bundle = bundles.get(key)
      if (bundle) bundle.count += link.count
      else bundles.set(key, { source: a, target: b, count: link.count })
    }
    this.simLinks = [...bundles.values()]
  }

  private addPeer(portId: string, peerNode: string): void {
    if (this.itemById.get(portId)?.type !== 'tp') return
    const peers = this.peersOf.get(portId) ?? new Set<string>()
    peers.add(peerNode)
    this.peersOf.set(portId, peers)
  }

  // --- layout

  /** Arrange the nodes by the engine */
  private runLayout(): void {
    const token = ++this.layoutToken
    const started = performance.now()
    this.layoutStarted = started
    const layerLayout = this.layerLayoutOf(this.engine)
    if (!layerLayout) {
      this.layout()
      this.reportLayout(started)
      return
    }

    // The stress layout arranges the layers (asynchronously). The nodes are shown at the known positions
    // (or near their areas) until then.
    this.simulation.stop()
    const fresh = this.bodies.filter((body) => !this.positions.has(body.id))
    for (const body of this.bodies) {
      const known = this.positions.get(body.id)
      if (known) Object.assign(body, { x: known.x, y: known.y, vx: 0, vy: 0 })
    }
    this.scatter(fresh)
    const signature = this.layoutSignature()
    if (signature === this.appliedSignature) {
      this.onLayout(this.lastStats)
      return
    }
    this.onLayout(null)
    void this.layoutByEngine(layerLayout, token, started, signature)
  }

  /** Function to arrange the nodes of a layer by the engine (undefined for force: it is made by the simulation) */
  private layerLayoutOf(engine: LayoutEngine): LayerArrangeFn | undefined {
    if (engine === 'stress') {
      return (_layer, items, links) =>
        this.stressLayout(
          items.map((item) => ({ id: item.id, radius: item.radius })),
          links,
        )
    }
    if (engine === 'schematic') {
      return (layer, items, links) => {
        const profile = selectProfile(this.profiles, layer)
        return this.schematicLayout({
          layer,
          nodes: items.map((item) => ({
            id: item.id,
            name: item.name,
            radius: item.radius,
            ...(item.kind === undefined ? {} : { kind: item.kind }),
          })),
          links,
          ...(profile ? { profile } : {}),
        })
      }
    }
    return undefined
  }

  private layoutSignature(): string {
    const nodes = this.bodies.map((body) => `${body.id}:${body.radius.toFixed(1)}`).join(',')
    const links = this.simLinks.map(
      (link) => `${this.itemOf(link.source)?.id}>${this.itemOf(link.target)?.id}`,
    )
    return `${this.engine}|${nodes}|${links.join(',')}`
  }

  /** Arrange the nodes of each layer by the engine and put the layouts of the layers in a grid */
  private async layoutByEngine(
    layerLayout: LayerArrangeFn,
    token: number,
    started: number,
    signature: string,
  ): Promise<void> {
    const byLayer = new Map<string, Item[]>()
    for (const body of this.bodies) byLayer.set(body.layer, [...(byLayer.get(body.layer) ?? []), body])
    const layers = [...byLayer].sort(
      ([a], [b]) => (this.areaIndex.get(a) ?? 0) - (this.areaIndex.get(b) ?? 0),
    )
    const results = await Promise.all(
      layers.map(async ([layer, items]) => {
        const ids = new Set(items.map((item) => item.id))
        const links = this.simLinks.flatMap((link) => {
          const [source, target] = [this.itemOf(link.source)?.id, this.itemOf(link.target)?.id]
          return source && target && ids.has(source) && ids.has(target) ? [{ source, target }] : []
        })
        const positions = await layerLayout(layer, items, links)
        return { layer, items, positions }
      }),
    )
    if (token !== this.layoutToken) return // a newer layout has been started

    const extents = results.map(({ layer, items, positions }) => {
      const xs = items.map((item) => (positions.get(item.id)?.x ?? 0) - item.radius)
      const ys = items.map((item) => (positions.get(item.id)?.y ?? 0) - item.radius)
      const xe = items.map((item) => (positions.get(item.id)?.x ?? 0) + item.radius)
      const ye = items.map((item) => (positions.get(item.id)?.y ?? 0) + item.radius)
      const [minX, minY] = [Math.min(...xs), Math.min(...ys)]
      return { key: layer, width: Math.max(...xe) - minX, height: Math.max(...ye) - minY, minX, minY }
    })
    const offsets = packBoxes(extents, LAYER_GAP)
    for (const { layer, items, positions } of results) {
      const [offset, extent] = [offsets.get(layer), extents.find((e) => e.key === layer)]
      for (const item of items) {
        const p = positions.get(item.id)
        if (!p || !offset || !extent) continue
        Object.assign(item, {
          x: offset.x + p.x - extent.minX,
          y: offset.y + p.y - extent.minY,
          vx: 0,
          vy: 0,
        })
      }
    }
    this.appliedSignature = signature
    this.placePorts()
    this.draw()
    if (!this.userMoved) this.fit()
    this.reportLayout(started)
  }

  /** Tell the quality of the layout (to compare the engines) */
  private reportLayout(started: number): void {
    const nodes = this.bodies.map((body) => ({
      id: body.id,
      x: body.x ?? 0,
      y: body.y ?? 0,
      radius: body.radius,
    }))
    const links = this.simLinks.map((link) => {
      const [source, target] = [this.itemOf(link.source)?.id ?? '', this.itemOf(link.target)?.id ?? '']
      return { source, target }
    })
    this.lastStats = {
      engine: this.engine,
      ms: Math.round(performance.now() - started),
      nodes: nodes.length,
      links: links.length,
      ...layoutQuality(nodes, links),
    }
    this.onLayout(this.lastStats)
  }

  /** Give the positions of the nodes: known ones are kept, the new ones are placed by the simulation */
  private layout(): void {
    const fresh = this.bodies.filter((body) => !this.positions.has(body.id))
    for (const body of this.bodies) {
      const known = this.positions.get(body.id)
      if (known) Object.assign(body, { x: known.x, y: known.y, vx: 0, vy: 0 })
    }
    if (fresh.length === 0) {
      this.simulation.alpha(0.1).restart()
      return
    }
    if (fresh.length < this.bodies.length / 2) {
      // a few new nodes (e.g. a layer is shown): place them near their area and let the layout move
      this.scatter(fresh)
      this.simulation.alpha(0.5).restart()
      return
    }

    // A force layout often ends up in a twisted state (links crossing each other), so it is made from several
    // random starts. It stops at the first one without crossings and overlaps; if there is none, it goes on
    // (up to 3 times of the number of the starts, at least 12) while the time is within the budget.
    const minTries = this.bodies.length <= MULTISTART_MAX_NODES ? Math.max(1, this.multiStart) : 1
    const begin = performance.now()
    let best: { score: number; positions: Array<[number, number]> } | null = null
    for (let k = 0; k < Math.max(minTries * 3, MULTISTART_MAX_TRIES); k++) {
      if (k >= minTries && (best?.score === 0 || performance.now() - begin > MULTISTART_BUDGET_MS)) break
      if (k > 0 && best?.score === 0) break
      this.scatter(this.bodies)
      this.simulation.alpha(1)
      for (let i = 0; i < WARMUP_TICKS; i++) this.simulation.tick()
      const score = this.score()
      if (!best || score < best.score)
        best = { score, positions: this.bodies.map((b) => [b.x ?? 0, b.y ?? 0]) }
    }
    best?.positions.forEach(([x, y], i) => Object.assign(this.bodies[i] ?? {}, { x, y, vx: 0, vy: 0 }))
    // the layout is settled: show it without animation
    this.simulation.alpha(0)
    if (!this.userMoved) this.fit()
  }

  /** Place the nodes at random positions around the area of their layer */
  private scatter(items: readonly Item[]): void {
    const perLayer = new Map<string, number>()
    for (const item of items) perLayer.set(item.layer, (perLayer.get(item.layer) ?? 0) + 1)
    for (const item of items) {
      const center = this.layerCenter(item.layer)
      const spread = Math.sqrt(perLayer.get(item.layer) ?? 1) * 70
      Object.assign(item, {
        x: center.x + (Math.random() - 0.5) * spread,
        y: center.y + (Math.random() - 0.5) * spread,
        vx: 0,
        vy: 0,
      })
    }
  }

  /** Quality of the layout of the nodes (the lower, the better): crossings of links and overlaps of nodes */
  private score(): number {
    const segments: Segment[] = this.simLinks.flatMap((link) => {
      const [a, b] = [this.itemOf(link.source), this.itemOf(link.target)]
      return a && b
        ? [{ u: a.id, v: b.id, a: { x: a.x ?? 0, y: a.y ?? 0 }, b: { x: b.x ?? 0, y: b.y ?? 0 } }]
        : []
    })
    const circles = this.bodies.map((b) => ({ x: b.x ?? 0, y: b.y ?? 0, r: b.radius + NODE_MARGIN / 2 }))
    return countCrossings(segments) * CROSSING_WEIGHT + overlapDepth(circles) * OVERLAP_WEIGHT
  }

  private itemOf(end: string | Item): Item | undefined {
    return typeof end === 'string' ? this.itemById.get(end) : end
  }

  /** Put each port on the circle of its node, toward the nodes it is connected to */
  private placePorts(): void {
    const center = this.centroid()
    for (const [parentId, ports] of this.portsOf) {
      const node = this.itemById.get(parentId)
      if (!node) continue
      const [cx, cy] = [node.x ?? 0, node.y ?? 0]
      const desired = ports.map((port) => this.desiredAngle(node, port, center))
      const angles = spreadAngles(desired, PORT_ARC / node.radius)
      ports.forEach((port, i) => {
        // a port moved by the user keeps its angle
        const angle = this.pinnedAngles.get(port.id) ?? angles[i] ?? 0
        port.angle = angle
        port.x = cx + node.radius * Math.cos(angle)
        port.y = cy + node.radius * Math.sin(angle)
      })
    }
  }

  private centroid(): { x: number; y: number } {
    const count = Math.max(1, this.bodies.length)
    return {
      x: this.bodies.reduce((sum, b) => sum + (b.x ?? 0), 0) / count,
      y: this.bodies.reduce((sum, b) => sum + (b.y ?? 0), 0) / count,
    }
  }

  /** Direction of the port: toward the connected nodes (or away from the center if it has no link) */
  private desiredAngle(node: Item, port: Item, center: { x: number; y: number }): number {
    let dx = 0
    let dy = 0
    for (const peerId of this.peersOf.get(port.id) ?? []) {
      const peer = this.itemById.get(peerId)
      if (!peer) continue
      const [vx, vy] = [(peer.x ?? 0) - (node.x ?? 0), (peer.y ?? 0) - (node.y ?? 0)]
      const length = Math.hypot(vx, vy) || 1
      dx += vx / length
      dy += vy / length
    }
    if (dx === 0 && dy === 0) {
      dx = (node.x ?? 0) - center.x
      dy = (node.y ?? 0) - center.y
    }
    return Math.atan2(dy, dx)
  }

  // --- drawing

  private renderElements(): void {
    this.linkLayer
      .selectAll<SVGPathElement, DisplayLink>('path')
      .data(this.drawLinks, (d) => d.id)
      .join('path')
      .attr('class', (d) => `link${d.diff ? ` diff-${d.diff}` : ''}`)
      .attr('stroke-width', (d) => 1 + Math.min(3, Math.log2(d.count)))

    const items = [...this.bodies, ...this.ports]
    const nodeSelection = this.nodeLayer
      .selectAll<SVGGElement, Item>('g.node')
      .data(items, (d) => d.id)
      .join((enter) => {
        const group = enter.append('g')
        group.append('circle')
        group.append('text')
        group.append('title')
        return group
      })
    nodeSelection
      .attr(
        'class',
        (d) => `node ${d.type}${d.expanded ? ' expanded' : ''}${d.diff ? ` diff-${d.diff}` : ''}`,
      )
      .attr('data-id', (d) => d.id)
      .style('--layer-color', (d) => layerColor(d.layer, this.layerOrder))
      .on('click', (event: Event, d) => {
        event.stopPropagation()
        this.callbacks.onSelect(d.id)
      })
      .on('dblclick', (event: Event, d) => {
        event.stopPropagation()
        this.callbacks.onToggleExpand(d.parent ?? d.id)
      })
      .on('mouseenter', (event: Event, d) => {
        // bring it to the front so that the element under the pointer is not hidden by the others
        select(event.currentTarget as SVGGElement).raise()
        this.setHover(d.id)
      })
      .on('mouseleave', () => this.setHover(null))
    nodeSelection
      .filter((d) => d.type === 'tp')
      .call(
        drag<SVGGElement, Item>().on('drag', (event, d) => {
          // a port moves along the circle of its node, toward the pointer
          const node = d.parent ? this.itemById.get(d.parent) : undefined
          if (!node) return
          this.pinnedAngles.set(d.id, Math.atan2(event.y - (node.y ?? 0), event.x - (node.x ?? 0)))
          this.placePorts()
          this.draw()
        }),
      )
    nodeSelection
      .filter((d) => d.type === 'node')
      .call(
        drag<SVGGElement, Item>()
          .on('start', (event, d) => {
            // also in the other engines, the other nodes follow the dragged node (force simulation)
            this.holdLayout(true)
            if (!event.active)
              if (this.engine === 'force') this.simulation.alphaTarget(0.3).restart()
              // (the simulation of the stress layout is stopped with the alpha of the start: lower it)
              else this.simulation.alpha(DRAG_ALPHA).alphaTarget(DRAG_ALPHA).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            this.userMoved = true
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) this.simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
            this.anchors?.set(d.id, { x: d.x ?? 0, y: d.y ?? 0 })
          }),
      )
    nodeSelection.select('circle').attr('r', (d) => d.radius)
    nodeSelection.select('title').text((d) => (d.kind ? `${d.name} (${d.kind})` : d.name))
    nodeSelection
      .select('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => (d.type === 'node' ? d.radius + 12 : 0))
      .text((d) => d.name)
  }

  /**
   * (stress layout) while a node is dragged, the simulation pulls the nodes back to their positions
   * instead of the center of their layers. It is restored when the simulation is settled.
   */
  private holdLayout(on: boolean): void {
    if (this.engine === 'force') return
    const forceX_ = this.simulation.force<ReturnType<typeof forceX<Item>>>('x')
    const forceY_ = this.simulation.force<ReturnType<typeof forceY<Item>>>('y')
    if (on === (this.anchors !== null)) return
    const link = this.simulation.force<ReturnType<typeof forceLink<Item, SimLink>>>('link')
    if (on) {
      const anchors = new Map(this.bodies.map((b) => [b.id, { x: b.x ?? 0, y: b.y ?? 0 }]))
      this.anchors = anchors
      // the links keep the distances of the layout (not the distances of the force layout)
      link?.distance((l) => {
        const [a, b] = [
          anchors.get(this.itemOf(l.source)?.id ?? ''),
          anchors.get(this.itemOf(l.target)?.id ?? ''),
        ]
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 100
      })
      forceX_?.x((d) => anchors.get(d.id)?.x ?? d.x ?? 0).strength(DRAG_ANCHOR_STRENGTH)
      forceY_?.y((d) => anchors.get(d.id)?.y ?? d.y ?? 0).strength(DRAG_ANCHOR_STRENGTH)
    } else {
      this.anchors = null
      link?.distance((l) => 70 + this.radiusOf(l.source) + this.radiusOf(l.target))
      forceX_?.x((d) => this.layerCenter(d.layer).x).strength(0.05)
      forceY_?.y((d) => this.layerCenter(d.layer).y).strength(0.05)
    }
    this.chargeScale = on ? DRAG_CHARGE_SCALE : 1
    this.simulation.velocityDecay(on ? DRAG_VELOCITY_DECAY : 0.4)
  }

  private applyHighlight(): void {
    const { selectedId, tracedIds } = this.highlight
    const active = selectedId !== null && tracedIds.size > 1
    this.nodeLayer
      .selectAll<SVGGElement, Item>('g.node')
      .classed('selected', (d) => d.id === selectedId)
      .classed('traced', (d) => d.id !== selectedId && tracedIds.has(d.id))
      .classed('dim', (d) => active && d.id !== selectedId && !tracedIds.has(d.id))
    this.linkLayer.selectAll<SVGPathElement, DisplayLink>('path').classed('dim', active)
  }

  /** Show the element under the pointer (a node, a term-point or its label) and the links of it */
  private setHover(id: string | null): void {
    this.hoverId = id
    this.applyHover()
  }

  private applyHover(): void {
    const id = this.hoverId
    // hovering a term-point: the term-points at the other ends of its links (with their names) are shown too
    const peers = new Set<string>()
    if (id !== null && this.itemById.get(id)?.type === 'tp') {
      for (const link of this.drawLinks) {
        if (link.source === id) peers.add(link.target)
        if (link.target === id) peers.add(link.source)
      }
    }
    this.nodeLayer
      .selectAll<SVGGElement, Item>('g.node')
      .classed('hover', (d) => d.id === id)
      .classed('peer', (d) => peers.has(d.id))
    // the links of a node include the links of its term-points
    const touches = (end: string) => id !== null && (end === id || this.itemById.get(end)?.parent === id)
    this.linkLayer
      .selectAll<SVGPathElement, DisplayLink>('path')
      .classed('hover', (d) => touches(d.source) || touches(d.target))
  }

  /** The view follows the layout until the user moves the view */
  private onTick(): void {
    this.ticks++
    this.placePorts()
    this.draw()
    if (!this.userMoved && this.ticks % FIT_INTERVAL_TICKS === 0) this.fit()
  }

  /** Path of a link: a straight line */
  private pathOf(link: DisplayLink): string {
    const [from, to] = [this.itemById.get(link.source), this.itemById.get(link.target)]
    return `M${from?.x ?? 0},${from?.y ?? 0} L${to?.x ?? 0},${to?.y ?? 0}`
  }

  /** Draw the current positions */
  draw(): void {
    const at = (id: string) => this.itemById.get(id)
    this.linkLayer.selectAll<SVGPathElement, DisplayLink>('path').attr('d', (d) => this.pathOf(d))
    const nodes = this.nodeLayer.selectAll<SVGGElement, Item>('g.node')
    nodes.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    // the name of a port is put outside of the circle of its node
    nodes
      .filter((d) => d.type === 'tp')
      .select('text')
      .attr('x', (d) => Math.cos(d.angle ?? 0) * (PORT_RADIUS + 3))
      .attr('y', (d) => Math.sin(d.angle ?? 0) * (PORT_RADIUS + 3) + 3)
      .attr('text-anchor', (d) => (Math.cos(d.angle ?? 0) >= 0 ? 'start' : 'end'))

    const edges = this.highlight.traceEdges.filter(
      (e) => e.from !== e.to && this.itemById.has(e.from) && this.itemById.has(e.to),
    )
    this.traceLayer
      .selectAll<SVGLineElement, { from: string; to: string }>('line')
      .data(edges, (d) => `${d.from}>${d.to}`)
      .join('line')
      .attr('class', 'trace-edge')
      .attr('x1', (d) => at(d.from)?.x ?? 0)
      .attr('y1', (d) => at(d.from)?.y ?? 0)
      .attr('x2', (d) => at(d.to)?.x ?? 0)
      .attr('y2', (d) => at(d.to)?.y ?? 0)
  }
}
