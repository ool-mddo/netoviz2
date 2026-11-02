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
const MULTISTART_MAX_NODES = 400
/** Number of the random starts of the layout */
const DEFAULT_MULTISTART = 6

/**
 * Element to show: a node (moved by the simulation) or a port (term-point, put on the circle of its node).
 * Ports are not in the simulation: their positions are calculated from the node and the connected nodes.
 */
type Item = SimulationNodeDatum & DisplayNode & { radius: number; angle?: number }
type SimLink = SimulationLinkDatum<Item> & { source: string | Item; target: string | Item; count: number }

export interface RendererCallbacks {
  /** Click on a node/term-point (id) or on the background (null) */
  onSelect: (id: string | null) => void
  /** Double click on a node/term-point: show/hide the term-points of the node (node id) */
  onToggleExpand: (nodeId: string) => void
}

export interface RendererOptions {
  /** Number of the random starts of the layout (the best layout is used). 1 to disable. */
  multiStart?: number
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
  private bodies: Item[] = []
  private ports: Item[] = []
  private simLinks: SimLink[] = []
  private drawLinks: DisplayLink[] = []
  private itemById = new Map<string, Item>()
  private portsOf = new Map<string, Item[]>()
  /** ID of the port => IDs of the nodes connected to the port */
  private peersOf = new Map<string, Set<string>>()
  private readonly positions = new Map<string, { x: number; y: number }>()
  /** Layers in the order (for colors) and the layers having elements (for the areas) */
  private layerOrder: readonly string[] = []
  private areaIndex = new Map<string, number>()
  private highlight: Highlight = NO_HIGHLIGHT
  private userMoved = false
  private ticks = 0

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly callbacks: RendererCallbacks,
    options: RendererOptions = {},
  ) {
    this.multiStart = options.multiStart ?? DEFAULT_MULTISTART
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
        forceManyBody<Item>().strength((d) => -(80 + d.radius * 8)),
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
        if (!this.userMoved) this.fit()
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
    this.layout()
    this.renderElements()
    this.placePorts()
    this.applyHighlight()
    this.draw()
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

    const tries = this.bodies.length <= MULTISTART_MAX_NODES ? Math.max(1, this.multiStart) : 1
    let best: { score: number; positions: Array<[number, number]> } | null = null
    for (let k = 0; k < tries; k++) {
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
        const angle = angles[i] ?? 0
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
      .selectAll<SVGLineElement, DisplayLink>('line')
      .data(this.drawLinks, (d) => d.id)
      .join('line')
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
    nodeSelection
      .filter((d) => d.type === 'node')
      .call(
        drag<SVGGElement, Item>()
          .on('start', (event, d) => {
            if (!event.active) this.simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
            this.userMoved = true
          })
          .on('end', (event, d) => {
            if (!event.active) this.simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
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

  private applyHighlight(): void {
    const { selectedId, tracedIds } = this.highlight
    const active = selectedId !== null && tracedIds.size > 1
    this.nodeLayer
      .selectAll<SVGGElement, Item>('g.node')
      .classed('selected', (d) => d.id === selectedId)
      .classed('traced', (d) => d.id !== selectedId && tracedIds.has(d.id))
      .classed('dim', (d) => active && d.id !== selectedId && !tracedIds.has(d.id))
    this.linkLayer.selectAll<SVGLineElement, DisplayLink>('line').classed('dim', active)
  }

  /** The view follows the layout until the user moves the view */
  private onTick(): void {
    this.ticks++
    this.placePorts()
    this.draw()
    if (!this.userMoved && this.ticks % FIT_INTERVAL_TICKS === 0) this.fit()
  }

  /** Draw the current positions */
  draw(): void {
    const at = (id: string) => this.itemById.get(id)
    this.linkLayer
      .selectAll<SVGLineElement, DisplayLink>('line')
      .attr('x1', (d) => at(d.source)?.x ?? 0)
      .attr('y1', (d) => at(d.source)?.y ?? 0)
      .attr('x2', (d) => at(d.target)?.x ?? 0)
      .attr('y2', (d) => at(d.target)?.y ?? 0)
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
