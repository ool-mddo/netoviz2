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

const NODE_RADIUS = 10
const TP_RADIUS = 5
const LAYER_SPACING_X = 700
const LAYER_SPACING_Y = 500
const FIT_MARGIN = 40

type SimNode = SimulationNodeDatum & DisplayNode
type SimLink = SimulationLinkDatum<SimNode> &
  Omit<DisplayLink, 'source' | 'target'> & { source: string | SimNode; target: string | SimNode }

export interface RendererCallbacks {
  /** Click on a node/term-point (id) or on the background (null) */
  onSelect: (id: string | null) => void
  /** Double click on a node/term-point: expand/collapse the term-points of the node (node id) */
  onToggleExpand: (nodeId: string) => void
}

/** IDs are IDs of shown elements (see displayIdOf) */
export interface Highlight {
  selectedId: string | null
  tracedIds: ReadonlySet<string>
  /** Traced supports (drawn as dashed lines between the shown elements) */
  traceEdges: ReadonlyArray<{ from: string; to: string }>
}

const NO_HIGHLIGHT: Highlight = { selectedId: null, tracedIds: new Set(), traceEdges: [] }

function radiusOf(node: DisplayNode): number {
  if (node.type === 'tp') return TP_RADIUS
  return NODE_RADIUS + Math.min(6, Math.log2((node.tpCount ?? 0) + 1))
}

/**
 * Force-directed view of the topology by d3-force and SVG.
 * Elements are updated directly (not through the reactivity of Vue) because positions change on every tick.
 */
export class ForceRenderer {
  private readonly root: Selection<SVGGElement, unknown, null, undefined>
  private readonly linkLayer: Selection<SVGGElement, unknown, null, undefined>
  private readonly traceLayer: Selection<SVGGElement, unknown, null, undefined>
  private readonly nodeLayer: Selection<SVGGElement, unknown, null, undefined>
  private readonly simulation: Simulation<SimNode, SimLink>
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>
  private nodes: SimNode[] = []
  private links: SimLink[] = []
  private nodeById = new Map<string, SimNode>()
  private readonly positions = new Map<string, { x: number; y: number }>()
  /** Layers in the order (for colors) and the layers having elements (for the areas) */
  private layerOrder: readonly string[] = []
  private areaIndex = new Map<string, number>()
  private highlight: Highlight = NO_HIGHLIGHT
  private userMoved = false

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly callbacks: RendererCallbacks,
  ) {
    const svgSelection = select(svg)
    this.root = svgSelection.append('g').attr('class', 'viewport')
    this.linkLayer = this.root.append('g').attr('class', 'links')
    this.traceLayer = this.root.append('g').attr('class', 'trace-edges')
    this.nodeLayer = this.root.append('g').attr('class', 'nodes')

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 8])
      .on('zoom', (event: { transform: { toString(): string }; sourceEvent?: unknown }) => {
        this.root.attr('transform', event.transform.toString())
        if (event.sourceEvent) this.userMoved = true
      })
    svgSelection.call(this.zoomBehavior).on('dblclick.zoom', null)
    svgSelection.on('click.background', () => this.callbacks.onSelect(null))

    this.simulation = forceSimulation<SimNode, SimLink>()
      .force(
        'link',
        forceLink<SimNode, SimLink>()
          .id((d) => d.id)
          .distance((l) => (l.type === 'member' ? 22 : 70))
          .strength((l) => (l.type === 'member' ? 1 : 0.5)),
      )
      .force(
        'charge',
        forceManyBody<SimNode>().strength((d) => (d.type === 'tp' ? -25 : -90)),
      )
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => radiusOf(d) + 4),
      )
      .force('x', forceX<SimNode>((d) => this.layerCenter(d.layer).x).strength(0.06))
      .force('y', forceY<SimNode>((d) => this.layerCenter(d.layer).y).strength(0.06))
      .on('tick', () => this.draw())
      .on('end', () => {
        if (!this.userMoved) this.fit()
      })
  }

  /**
   * Set the graph to show. Positions of the elements which are already shown are kept.
   * @param layerOrder All layer IDs of the topology in a stable order (decides the colors)
   *   Each layer shown has its own area.
   */
  setGraph(graph: DisplayGraph, layerOrder: readonly string[]): void {
    for (const node of this.nodes) {
      if (node.x !== undefined && node.y !== undefined) this.positions.set(node.id, { x: node.x, y: node.y })
    }
    this.layerOrder = layerOrder
    const shown = new Set(graph.nodes.map((node) => node.layer))
    this.areaIndex = new Map(layerOrder.filter((layer) => shown.has(layer)).map((layer, i) => [layer, i]))
    this.nodes = graph.nodes.map((node) => this.simNode(node))
    this.nodeById = new Map(this.nodes.map((node) => [node.id, node]))
    this.links = graph.links.map((link) => ({ ...link }))

    this.simulation.nodes(this.nodes)
    this.simulation.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')?.links(this.links)
    this.renderElements()
    this.applyHighlight()
    this.simulation.alpha(0.7).restart()
  }

  setHighlight(highlight: Highlight): void {
    this.highlight = highlight
    this.applyHighlight()
    this.draw()
  }

  /** Move the viewport to see all elements */
  fit(): void {
    if (this.nodes.length === 0) return
    const xs = this.nodes.map((n) => n.x ?? 0)
    const ys = this.nodes.map((n) => n.y ?? 0)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
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
    this.simulation.tick(count)
    this.draw()
  }

  destroy(): void {
    this.simulation.stop()
    const svgSelection = select(this.svg)
    svgSelection.on('.zoom', null).on('click.background', null)
    this.root.remove()
  }

  private layerCenter(layer: string): { x: number; y: number } {
    const index = this.areaIndex.get(layer) ?? 0
    const columns = Math.max(1, Math.ceil(Math.sqrt(this.areaIndex.size)))
    return { x: (index % columns) * LAYER_SPACING_X, y: Math.floor(index / columns) * LAYER_SPACING_Y }
  }

  private simNode(node: DisplayNode): SimNode {
    const known = this.positions.get(node.id)
    if (known) return { ...node, x: known.x, y: known.y }
    // a new element starts near its node (term-points) or in the area of its layer
    const base = (node.parent ? this.positions.get(node.parent) : undefined) ?? this.layerCenter(node.layer)
    return { ...node, x: base.x + (Math.random() - 0.5) * 30, y: base.y + (Math.random() - 0.5) * 30 }
  }

  private renderElements(): void {
    this.linkLayer
      .selectAll<SVGLineElement, SimLink>('line')
      .data(this.links, (d) => d.id)
      .join('line')
      .attr('class', (d) => `link ${d.type}${d.diff ? ` diff-${d.diff}` : ''}`)
      .attr('stroke-width', (d) => (d.type === 'member' ? 1 : 1 + Math.min(4, Math.log2(d.count))))

    const nodeSelection = this.nodeLayer
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(this.nodes, (d) => d.id)
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
      .on('click', (event: Event, d) => {
        event.stopPropagation()
        this.callbacks.onSelect(d.id)
      })
      .on('dblclick', (event: Event, d) => {
        event.stopPropagation()
        this.callbacks.onToggleExpand(d.parent ?? d.id)
      })
      .call(
        drag<SVGGElement, SimNode>()
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
    nodeSelection
      .select('circle')
      .attr('r', (d) => radiusOf(d))
      .attr('fill', (d) => layerColor(d.layer, this.layerOrder))
    nodeSelection
      .select('text')
      .attr('dy', (d) => radiusOf(d) + 10)
      .attr('text-anchor', 'middle')
      .text((d) => d.name)
    nodeSelection.select('title').text((d) => (d.kind ? `${d.name} (${d.kind})` : d.name))
  }

  private applyHighlight(): void {
    const { selectedId, tracedIds } = this.highlight
    const active = selectedId !== null && tracedIds.size > 1
    this.nodeLayer
      .selectAll<SVGGElement, SimNode>('g.node')
      .classed('selected', (d) => d.id === selectedId)
      .classed('traced', (d) => d.id !== selectedId && tracedIds.has(d.id))
      .classed('dim', (d) => active && d.id !== selectedId && !tracedIds.has(d.id))
    this.linkLayer.selectAll<SVGLineElement, SimLink>('line').classed('dim', active)
  }

  /** Draw the current positions */
  draw(): void {
    this.linkLayer
      .selectAll<SVGLineElement, SimLink>('line')
      .attr('x1', (d) => (d.source as SimNode).x ?? 0)
      .attr('y1', (d) => (d.source as SimNode).y ?? 0)
      .attr('x2', (d) => (d.target as SimNode).x ?? 0)
      .attr('y2', (d) => (d.target as SimNode).y ?? 0)
    this.nodeLayer
      .selectAll<SVGGElement, SimNode>('g.node')
      .attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)

    const edges = this.highlight.traceEdges.filter(
      (e) => e.from !== e.to && this.nodeById.has(e.from) && this.nodeById.has(e.to),
    )
    this.traceLayer
      .selectAll<SVGLineElement, { from: string; to: string }>('line')
      .data(edges, (d) => `${d.from}>${d.to}`)
      .join('line')
      .attr('class', 'trace-edge')
      .attr('x1', (d) => this.nodeById.get(d.from)?.x ?? 0)
      .attr('y1', (d) => this.nodeById.get(d.from)?.y ?? 0)
      .attr('x2', (d) => this.nodeById.get(d.to)?.x ?? 0)
      .attr('y2', (d) => this.nodeById.get(d.to)?.y ?? 0)
  }
}
