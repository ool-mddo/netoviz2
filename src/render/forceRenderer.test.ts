import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DisplayGraph } from '../domain/graph'
import { ForceRenderer, type Highlight } from './forceRenderer'
import type { ElkLayoutFn, LayoutStats, Positions } from './layout/types'

/** nodes a, b, r; term-points of a (p1, p2) and b (p1); a/p1 - b/p1 are linked */
const graph: DisplayGraph = {
  nodes: [
    { id: 'l1/a', type: 'node', name: 'a', layer: 'l1', tpCount: 2, diff: 'changed', expanded: true },
    { id: 'l1/b', type: 'node', name: 'b', layer: 'l1', tpCount: 1, expanded: true },
    { id: 'l2/r', type: 'node', name: 'r', layer: 'l2', kind: 'node', tpCount: 0 },
    { id: 'l1/a/p1', type: 'tp', name: 'p1', layer: 'l1', parent: 'l1/a' },
    { id: 'l1/a/p2', type: 'tp', name: 'p2', layer: 'l1', parent: 'l1/a', diff: 'added' },
    { id: 'l1/b/p1', type: 'tp', name: 'p1', layer: 'l1', parent: 'l1/b' },
  ],
  links: [{ id: 'k', source: 'l1/a/p1', target: 'l1/b/p1', type: 'link', count: 1 }],
}
/** the same graph without the term-points (collapsed) */
const collapsed: DisplayGraph = {
  nodes: graph.nodes.filter((n) => n.type === 'node').map((n) => ({ ...n, expanded: false })),
  links: [{ id: 'k', source: 'l1/a', target: 'l1/b', type: 'link', count: 1 }],
}

let svg: SVGSVGElement
let callbacks: { onSelect: Mock<(id: string | null) => void>; onToggleExpand: Mock<(nodeId: string) => void> }
let renderer: ForceRenderer

beforeEach(() => {
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  document.body.appendChild(svg)
  callbacks = {
    onSelect: vi.fn<(id: string | null) => void>(),
    onToggleExpand: vi.fn<(nodeId: string) => void>(),
  }
  renderer = new ForceRenderer(svg, callbacks, { multiStart: 1 })
})
afterEach(() => {
  renderer.destroy()
  svg.remove()
})

const nodeEl = (id: string) => svg.querySelector(`g.node[data-id="${id}"]`) as SVGGElement
const pos = (id: string): [number, number] => {
  const m = /translate\((-?[\d.e+-]+),(-?[\d.e+-]+)\)/.exec(nodeEl(id).getAttribute('transform') ?? '')
  return [Number(m?.[1]), Number(m?.[2])]
}
const highlight = (overrides: Partial<Highlight> = {}): Highlight => ({
  selectedId: null,
  tracedIds: new Set(),
  traceEdges: [],
  ...overrides,
})

describe('ForceRenderer', () => {
  it('draws nodes, term-points and links with names', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    expect(svg.querySelectorAll('g.node:not(.tp)')).toHaveLength(3)
    expect(svg.querySelectorAll('g.node.tp')).toHaveLength(3)
    expect(svg.querySelectorAll('path.link')).toHaveLength(1)
    expect(nodeEl('l1/a').querySelector('text')?.textContent).toBe('a')
    expect(nodeEl('l1/a/p1').querySelector('text')?.textContent).toBe('p1')
    expect(nodeEl('l2/r').querySelector('title')?.textContent).toBe('r (node)')
  })

  it('draws a term-point on the circle of its node (not in the simulation)', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(5)
    const [ax, ay] = pos('l1/a')
    const radius = Number(nodeEl('l1/a').querySelector('circle')?.getAttribute('r'))
    for (const id of ['l1/a/p1', 'l1/a/p2']) {
      const [x, y] = pos(id)
      expect(Math.hypot(x - ax, y - ay)).toBeCloseTo(radius, 3)
    }
  })

  it('puts a term-point on the side of the node it is linked to', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(30)
    const [ax, ay] = pos('l1/a')
    const [bx, by] = pos('l1/b')
    const [px, py] = pos('l1/a/p1')
    // the port is on the side of the peer: the angle between (node a -> port) and (node a -> node b) is less than 90 degrees
    expect((px - ax) * (bx - ax) + (py - ay) * (by - ay)).toBeGreaterThan(0)
  })

  it('separates the term-points of a node', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(30)
    const [x1, y1] = pos('l1/a/p1')
    const [x2, y2] = pos('l1/a/p2')
    expect(Math.hypot(x1 - x2, y1 - y2)).toBeGreaterThan(9)
  })

  /** Points of the path of a link */
  const pathPoints = (selector = 'path.link'): Array<[number, number]> =>
    (svg.querySelector(selector)?.getAttribute('d') ?? '')
      .split(/[ML]/)
      .filter(Boolean)
      .map((p) => p.split(',').map(Number) as [number, number])

  it('draws a link between the term-points', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(10)
    expect(pathPoints()).toEqual([pos('l1/a/p1'), pos('l1/b/p1')])
  })

  it('draws a link between the nodes when the term-points are not shown', () => {
    renderer.setGraph(collapsed, ['l1', 'l2'])
    renderer.tick(10)
    expect(svg.querySelectorAll('g.node.tp')).toHaveLength(0)
    expect(pathPoints()).toEqual([pos('l1/a'), pos('l1/b')])
  })

  it('marks nodes and term-points with diff and expanded nodes by classes', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    expect(nodeEl('l1/a').classList.contains('diff-changed')).toBe(true)
    expect(nodeEl('l1/a').classList.contains('expanded')).toBe(true)
    expect(nodeEl('l1/a/p2').classList.contains('diff-added')).toBe(true)
  })

  it('arranges a graph which can be drawn without crossings of links (it is tried again from other starts)', () => {
    // a 4-cycle can be drawn without crossings, but a force layout from one random start is twisted in half of the cases.
    // The random numbers are fixed so that the result does not change at every run.
    let seed = 12345
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
    })
    const nodes = ['a', 'b', 'c', 'd'].map((n) => ({
      id: n,
      type: 'node' as const,
      name: n,
      layer: 'l',
      tpCount: 0,
    }))
    const ring: DisplayGraph = {
      nodes,
      links: [
        { id: '1', source: 'a', target: 'b', type: 'link', count: 1 },
        { id: '2', source: 'b', target: 'c', type: 'link', count: 1 },
        { id: '3', source: 'c', target: 'd', type: 'link', count: 1 },
        { id: '4', source: 'd', target: 'a', type: 'link', count: 1 },
      ],
    }
    const reports: Array<LayoutStats | null> = []
    for (let k = 0; k < 20; k++) {
      const multi = new ForceRenderer(svg, callbacks, { multiStart: 1, onLayout: (s) => reports.push(s) })
      multi.setGraph(ring, ['l'])
      multi.destroy()
    }
    random.mockRestore()
    // with only one start (minTries = 1), the layout is retried until there is no crossing
    expect(reports.every((r) => r?.crossings === 0 && r.overlap === 0)).toBe(true)
  })

  it('keeps the positions of the nodes when the graph is updated', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(30)
    const before = pos('l1/b')
    renderer.setGraph(
      { nodes: [...graph.nodes, { id: 'l1/c', type: 'node', name: 'c', layer: 'l1' }], links: graph.links },
      ['l1', 'l2'],
    )
    renderer.draw()
    expect(svg.querySelectorAll('g.node:not(.tp)')).toHaveLength(4)
    expect(pos('l1/b')).toEqual(before)
  })

  it('removes the elements which are not in the graph any more', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.setGraph({ nodes: graph.nodes.slice(0, 1), links: [] }, ['l1'])
    expect(svg.querySelectorAll('g.node')).toHaveLength(1)
    expect(svg.querySelectorAll('path.link')).toHaveLength(0)
  })

  it('fits the view to the elements, until the user moves the view', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    expect(svg.querySelector('g.viewport')?.getAttribute('transform')).toMatch(
      /^translate\(.+\) scale\(.+\)$/,
    )
  })

  it('selects an element by click and clears the selection by a click on the background', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    nodeEl('l1/a').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(callbacks.onSelect).toHaveBeenLastCalledWith('l1/a')
    nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(callbacks.onSelect).toHaveBeenLastCalledWith('l1/a/p1')
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(callbacks.onSelect).toHaveBeenLastCalledWith(null)
    expect(callbacks.onSelect).toHaveBeenCalledTimes(3)
  })

  it('toggles term-points by double click (the node of a term-point)', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    nodeEl('l1/b').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(callbacks.onToggleExpand).toHaveBeenLastCalledWith('l1/b')
    nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(callbacks.onToggleExpand).toHaveBeenLastCalledWith('l1/a')
  })

  describe('hover (the element under the pointer)', () => {
    beforeEach(() => renderer.setGraph(graph, ['l1', 'l2']))

    it('marks the element under the pointer and clears the mark when the pointer leaves', () => {
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseenter'))
      expect(nodeEl('l1/b').classList.contains('hover')).toBe(true)
      expect(svg.querySelectorAll('g.node.hover')).toHaveLength(1)
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseleave'))
      expect(svg.querySelectorAll('g.node.hover')).toHaveLength(0)
    })

    it('marks only the element under the pointer when the pointer moves to another element', () => {
      nodeEl('l1/a').dispatchEvent(new MouseEvent('mouseenter'))
      nodeEl('l1/a').dispatchEvent(new MouseEvent('mouseleave'))
      nodeEl('l2/r').dispatchEvent(new MouseEvent('mouseenter'))
      expect([...svg.querySelectorAll('g.node.hover')].map((e) => e.getAttribute('data-id'))).toEqual([
        'l2/r',
      ])
    })

    it('marks the links of a hovered term-point', () => {
      nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('mouseenter'))
      expect(svg.querySelectorAll('path.link.hover')).toHaveLength(1)
      nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('mouseleave'))
      nodeEl('l1/a/p2').dispatchEvent(new MouseEvent('mouseenter'))
      expect(svg.querySelectorAll('path.link.hover')).toHaveLength(0)
    })

    it('marks the links of the term-points of a hovered node', () => {
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseenter'))
      expect(svg.querySelectorAll('path.link.hover')).toHaveLength(1)
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseleave'))
      expect(svg.querySelectorAll('path.link.hover')).toHaveLength(0)
    })

    it('brings the hovered element to the front', () => {
      nodeEl('l1/a').dispatchEvent(new MouseEvent('mouseenter'))
      const order = [...svg.querySelectorAll('g.nodes > g.node')].map((e) => e.getAttribute('data-id'))
      expect(order[order.length - 1]).toBe('l1/a')
    })

    it('keeps the mark when the graph is updated while the pointer is on the element', () => {
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseenter'))
      renderer.setGraph(graph, ['l1', 'l2'])
      expect(nodeEl('l1/b').classList.contains('hover')).toBe(true)
    })

    it('marks an element hovered through its label (the label is a part of the element)', () => {
      const label = nodeEl('l1/b').querySelector('text') as SVGTextElement
      // entering the label enters the group of the element first
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseenter'))
      expect(label.parentElement?.classList.contains('hover')).toBe(true)
    })
  })

  describe('label', () => {
    beforeEach(() => renderer.setGraph(graph, ['l1', 'l2']))

    it('selects the element by a click on the label', () => {
      nodeEl('l1/b')
        .querySelector('text')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(callbacks.onSelect).toHaveBeenLastCalledWith('l1/b')
      // not handled as a click on the background
      expect(callbacks.onSelect).toHaveBeenCalledTimes(1)
    })

    it('selects a term-point by a click on its label', () => {
      nodeEl('l1/a/p2')
        .querySelector('text')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(callbacks.onSelect).toHaveBeenLastCalledWith('l1/a/p2')
    })

    it('toggles the term-points by a double click on the label', () => {
      nodeEl('l1/a')
        .querySelector('text')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      expect(callbacks.onToggleExpand).toHaveBeenLastCalledWith('l1/a')
    })
  })

  describe('highlight', () => {
    beforeEach(() => renderer.setGraph(graph, ['l1', 'l2']))

    it('marks the selected and traced elements and dims the others', () => {
      renderer.setHighlight(
        highlight({
          selectedId: 'l2/r',
          tracedIds: new Set(['l2/r', 'l1/a']),
          traceEdges: [{ from: 'l2/r', to: 'l1/a' }],
        }),
      )
      expect(nodeEl('l2/r').classList.contains('selected')).toBe(true)
      expect(nodeEl('l1/a').classList.contains('traced')).toBe(true)
      expect(nodeEl('l1/b').classList.contains('dim')).toBe(true)
      expect(nodeEl('l1/b/p1').classList.contains('dim')).toBe(true)
      expect(svg.querySelectorAll('line.trace-edge')).toHaveLength(1)
    })

    it('highlights a selected term-point', () => {
      renderer.setHighlight(highlight({ selectedId: 'l1/a/p1', tracedIds: new Set(['l1/a/p1']) }))
      expect(nodeEl('l1/a/p1').classList.contains('selected')).toBe(true)
      expect(svg.querySelectorAll('g.node.dim')).toHaveLength(0)
    })

    it('skips trace edges whose end is not shown', () => {
      renderer.setHighlight(highlight({ selectedId: 'l2/r', traceEdges: [{ from: 'l2/r', to: 'l9/none' }] }))
      expect(svg.querySelectorAll('line.trace-edge')).toHaveLength(0)
    })

    it('clears the highlight', () => {
      renderer.setHighlight(highlight({ selectedId: 'l2/r', tracedIds: new Set(['l2/r', 'l1/a']) }))
      renderer.setHighlight(highlight())
      expect(svg.querySelectorAll('g.node.selected, g.node.traced, g.node.dim')).toHaveLength(0)
    })
  })

  it('removes the drawing on destroy', () => {
    renderer.setGraph(graph, ['l1'])
    renderer.destroy()
    expect(svg.querySelector('g.viewport')).toBeNull()
  })

  describe('layout engines', () => {
    /** ELK is replaced by a function which puts the nodes on a line (the nodes of a layer are 100 apart) */
    const lineLayout = (routes: Map<number, Array<{ x: number; y: number }>> = new Map()) =>
      vi.fn<ElkLayoutFn>((_algorithm, nodes) =>
        Promise.resolve({
          positions: new Map(nodes.map((n, i) => [n.id, { x: i * 100 + 50, y: 50 }])) as Positions,
          routes,
        }),
      )
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
    const make = (elkLayout: ElkLayoutFn, onLayout?: (stats: LayoutStats | null) => void) => {
      renderer.destroy()
      renderer = new ForceRenderer(svg, callbacks, {
        multiStart: 1,
        engine: 'elk-layered',
        elkLayout,
        onLayout,
      })
      return renderer
    }

    it('puts the nodes at the positions given by ELK (the algorithm of the engine is used)', async () => {
      const elk = lineLayout()
      make(elk).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(elk.mock.calls.map((call) => call[0])).toEqual(['layered', 'layered'])
      // layer l1 (a, b) is in a line, 100 apart
      expect(pos('l1/b')[0] - pos('l1/a')[0]).toBeCloseTo(100, 3)
      expect(pos('l1/b')[1]).toBeCloseTo(pos('l1/a')[1], 3)
    })

    it('arranges each layer separately and puts the layouts of the layers apart from each other', async () => {
      const elk = lineLayout()
      make(elk).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      const layers = elk.mock.calls.map((call) => call[1].map((n) => n.id))
      expect(layers).toEqual([['l1/a', 'l1/b'], ['l2/r']])
      const [r, a, b] = [pos('l2/r'), pos('l1/a'), pos('l1/b')]
      // the box of l1 is x: -r..., the layer l2 is next to it with a gap (no overlap)
      expect(Math.hypot(r[0] - a[0], r[1] - a[1])).toBeGreaterThan(40)
      expect(Math.hypot(r[0] - b[0], r[1] - b[1])).toBeGreaterThan(40)
    })

    it('passes only the links in the layer to ELK', async () => {
      const elk = lineLayout()
      make(elk).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(elk.mock.calls[0]?.[2]).toEqual([{ source: 'l1/a', target: 'l1/b' }])
      expect(elk.mock.calls[1]?.[2]).toEqual([])
    })

    it('reports that the layout is in progress (null) and then the quality of the layout', async () => {
      const reports: Array<LayoutStats | null> = []
      make(lineLayout(), (stats) => reports.push(stats)).setGraph(collapsed, ['l1', 'l2'])
      expect(reports).toEqual([null])
      await flush()
      expect(reports).toHaveLength(2)
      expect(reports[1]).toMatchObject({ engine: 'elk-layered', nodes: 3, links: 1, crossings: 0 })
    })

    it('does not arrange the same graph again, and reports the last result', async () => {
      const elk = lineLayout()
      const reports: Array<LayoutStats | null> = []
      const r = make(elk, (stats) => reports.push(stats))
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(elk).toHaveBeenCalledTimes(2) // 2 layers, once
      expect(reports.at(-1)?.engine).toBe('elk-layered')
    })

    it('arranges again when the nodes are changed (e.g. the term-points are shown)', async () => {
      const elk = lineLayout()
      const r = make(elk)
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setGraph(graph, ['l1', 'l2'])
      await flush()
      expect(elk).toHaveBeenCalledTimes(4)
    })

    it('ignores the result of an old layout when a newer one is started', async () => {
      const resolvers: Array<(positions: Positions) => void> = []
      const slow = vi.fn<ElkLayoutFn>(
        () =>
          new Promise((resolve) => resolvers.push((positions) => resolve({ positions, routes: new Map() }))),
      )
      const r = make(slow)
      r.setGraph({ nodes: collapsed.nodes.slice(0, 1), links: [] }, ['l1', 'l2'])
      r.setGraph({ nodes: collapsed.nodes.slice(0, 1), links: [] }, ['l1', 'l2']) // the layout is started again
      const [first, second] = resolvers
      second?.(new Map([['l1/a', { x: 500, y: 0 }]]))
      first?.(new Map([['l1/a', { x: -900, y: 0 }]]))
      await flush()
      expect(pos('l1/a')[0]).not.toBeCloseTo(-900, 0)
    })

    it('arranges again from scratch when the engine is changed (to force and back)', async () => {
      const elk = lineLayout()
      const reports: Array<LayoutStats | null> = []
      const r = make(elk, (stats) => reports.push(stats))
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setEngine('force')
      expect(reports.at(-1)).toMatchObject({ engine: 'force', nodes: 3 })
      r.setEngine('elk-layered')
      await flush()
      expect(elk).toHaveBeenCalledTimes(4)
      expect(reports.at(-1)).toMatchObject({ engine: 'elk-layered' })
    })

    it('does nothing when the engine is not changed', async () => {
      const elk = lineLayout()
      const r = make(elk)
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setEngine('elk-layered')
      await flush()
      expect(elk).toHaveBeenCalledTimes(2)
    })

    it('reports the quality of the force layout too', () => {
      const reports: Array<LayoutStats | null> = []
      renderer.destroy()
      renderer = new ForceRenderer(svg, callbacks, { multiStart: 1, onLayout: (s) => reports.push(s) })
      renderer.setGraph(collapsed, ['l1', 'l2'])
      expect(reports.at(-1)).toMatchObject({ engine: 'force', nodes: 3, links: 1 })
      expect(reports.at(-1)?.ms).toBeGreaterThanOrEqual(0)
    })

    it('draws a link through the bend points given by ELK (moved with the layout of the layer)', async () => {
      // link 0 of the layer l1 is a -> b: bend points at (150, 200)
      make(lineLayout(new Map([[0, [{ x: 150, y: 200 }]]]))).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      const [a, b] = [pos('l1/a'), pos('l1/b')]
      // a and b are at (50,50) and (150,50) in the layout of the layer: the bend point is 150 below the line of the nodes
      expect(pathPoints()).toEqual([a, [b[0], b[1] + 150], b])
    })

    it('draws the bend points in the reverse order for a link in the other direction', async () => {
      const bends = [
        { x: 100, y: 200 },
        { x: 200, y: 200 },
      ]
      const reverse: DisplayGraph = {
        ...collapsed,
        links: [{ id: 'k', source: 'l1/b', target: 'l1/a', type: 'link', count: 1 }],
      }
      // the link (b -> a) is given to ELK as b -> a: the bend points are from b to a
      make(lineLayout(new Map([[0, bends]]))).setGraph(reverse, ['l1', 'l2'])
      await flush()
      const [a, b] = [pos('l1/a'), pos('l1/b')]
      const points = pathPoints()
      expect(points[0]).toEqual(b)
      expect(points[3]).toEqual(a)
      expect(points[1]?.[0]).toBeLessThan(points[2]?.[0] ?? 0)
    })

    it('draws a link straight when the engine is changed to force (the routes are forgotten)', async () => {
      const r = make(lineLayout(new Map([[0, [{ x: 150, y: 200 }]]])))
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(pathPoints()).toHaveLength(3)
      r.setEngine('force')
      expect(pathPoints()).toHaveLength(2)
    })

    it('counts the crossings with the routes (a link around a node does not cross the other link)', async () => {
      const reports: Array<LayoutStats | null> = []
      // the layer l1: a, b on a line, and a link a - b. Another layer would not matter.
      make(lineLayout(new Map([[0, [{ x: 100, y: 500 }]]])), (stats) => reports.push(stats)).setGraph(
        collapsed,
        ['l1', 'l2'],
      )
      await flush()
      expect(reports.at(-1)).toMatchObject({ crossings: 0 })
    })

    it('puts the term-points on the circles of the nodes with ELK, too', async () => {
      make(lineLayout()).setGraph(graph, ['l1', 'l2'])
      await flush()
      const [ax, ay] = pos('l1/a')
      const radius = Number(nodeEl('l1/a').querySelector('circle')?.getAttribute('r'))
      const [px, py] = pos('l1/a/p1')
      expect(Math.hypot(px - ax, py - ay)).toBeCloseTo(radius, 3)
    })
  })
})
