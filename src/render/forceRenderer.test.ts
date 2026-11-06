import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DisplayGraph } from '../domain/graph'
import { ForceRenderer, type Highlight } from './forceRenderer'
import { parseProfiles } from '../test/profileYaml'
import type { SchematicLayerFn } from './layout/schematic/types'
import type { LayerLayoutFn, LayoutStats, Positions } from './layout/types'

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

    it('marks the term-point at the other end of the links of the hovered term-point as a peer', () => {
      renderer.setGraph(graph, ['l1', 'l2'])
      nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('mouseenter'))
      expect(nodeEl('l1/b/p1').classList.contains('peer')).toBe(true)
      expect(nodeEl('l1/a/p2').classList.contains('peer')).toBe(false)
      expect(svg.querySelectorAll('path.link.hover')).toHaveLength(1)
      nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('mouseleave'))
      expect(svg.querySelectorAll('g.node.peer')).toHaveLength(0)
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
    /** The stress layout is replaced by a function which puts the nodes on a line (the nodes of a layer are 100 apart) */
    const lineLayout = () =>
      vi.fn<LayerLayoutFn>((nodes) =>
        Promise.resolve(new Map(nodes.map((n, i) => [n.id, { x: i * 100 + 50, y: 50 }])) as Positions),
      )
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
    const make = (stressLayout: LayerLayoutFn, onLayout?: (stats: LayoutStats | null) => void) => {
      renderer.destroy()
      renderer = new ForceRenderer(svg, callbacks, {
        multiStart: 1,
        engine: 'stress',
        stressLayout,
        onLayout,
      })
      return renderer
    }

    it('puts the nodes at the positions of the stress layout', async () => {
      make(lineLayout()).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      // layer l1 (a, b) is in a line, 100 apart
      expect(pos('l1/b')[0] - pos('l1/a')[0]).toBeCloseTo(100, 3)
      expect(pos('l1/b')[1]).toBeCloseTo(pos('l1/a')[1], 3)
    })

    it('arranges each layer separately and puts the layouts of the layers apart from each other', async () => {
      const layout = lineLayout()
      make(layout).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(layout.mock.calls.map((call) => call[0].map((n) => n.id))).toEqual([['l1/a', 'l1/b'], ['l2/r']])
      const [r, a, b] = [pos('l2/r'), pos('l1/a'), pos('l1/b')]
      expect(Math.hypot(r[0] - a[0], r[1] - a[1])).toBeGreaterThan(40)
      expect(Math.hypot(r[0] - b[0], r[1] - b[1])).toBeGreaterThan(40)
    })

    it('passes only the links in the layer to the layout', async () => {
      const layout = lineLayout()
      make(layout).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(layout.mock.calls[0]?.[1]).toEqual([{ source: 'l1/a', target: 'l1/b' }])
      expect(layout.mock.calls[1]?.[1]).toEqual([])
    })

    it('draws links straight between the nodes', async () => {
      make(lineLayout()).setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(pathPoints()).toEqual([pos('l1/a'), pos('l1/b')])
    })

    it('reports that the layout is in progress (null) and then the quality of the layout', async () => {
      const reports: Array<LayoutStats | null> = []
      make(lineLayout(), (stats) => reports.push(stats)).setGraph(collapsed, ['l1', 'l2'])
      expect(reports).toEqual([null])
      await flush()
      expect(reports).toHaveLength(2)
      expect(reports[1]).toMatchObject({ engine: 'stress', nodes: 3, links: 1, crossings: 0 })
    })

    it('does not arrange the same graph again, and reports the last result', async () => {
      const layout = lineLayout()
      const reports: Array<LayoutStats | null> = []
      const r = make(layout, (stats) => reports.push(stats))
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      expect(layout).toHaveBeenCalledTimes(2) // 2 layers, once
      expect(reports.at(-1)?.engine).toBe('stress')
    })

    it('arranges again when the nodes are changed (e.g. the term-points are shown)', async () => {
      const layout = lineLayout()
      const r = make(layout)
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setGraph(graph, ['l1', 'l2'])
      await flush()
      expect(layout).toHaveBeenCalledTimes(4)
    })

    it('ignores the result of an old layout when a newer one is started', async () => {
      const resolvers: Array<(positions: Positions) => void> = []
      const slow = vi.fn<LayerLayoutFn>(() => new Promise((resolve) => resolvers.push(resolve)))
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
      const layout = lineLayout()
      const reports: Array<LayoutStats | null> = []
      const r = make(layout, (stats) => reports.push(stats))
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setEngine('force')
      expect(reports.at(-1)).toMatchObject({ engine: 'force', nodes: 3 })
      r.setEngine('stress')
      await flush()
      expect(layout).toHaveBeenCalledTimes(4)
      expect(reports.at(-1)).toMatchObject({ engine: 'stress' })
    })

    it('does nothing when the engine is not changed', async () => {
      const layout = lineLayout()
      const r = make(layout)
      r.setGraph(collapsed, ['l1', 'l2'])
      await flush()
      r.setEngine('stress')
      await flush()
      expect(layout).toHaveBeenCalledTimes(2)
    })

    describe('schematic engine', () => {
      const lineSchematic = () =>
        vi.fn<SchematicLayerFn>((input) =>
          Promise.resolve(
            new Map(input.nodes.map((n, i) => [n.id, { x: i * 100 + 50, y: 50 }])) as Positions,
          ),
        )
      const makeSchematic = (
        schematicLayout: SchematicLayerFn,
        onLayout?: (stats: LayoutStats | null) => void,
        profiles?: ReturnType<typeof parseProfiles>['profiles'],
      ) => {
        renderer.destroy()
        renderer = new ForceRenderer(svg, callbacks, {
          multiStart: 1,
          engine: 'schematic',
          schematicLayout,
          ...(profiles ? { profiles } : {}),
          onLayout,
        })
        return renderer
      }

      it('arranges each layer by the schematic layout (not by force or stress) and puts the nodes at the positions', async () => {
        const stress = lineLayout()
        const layout = lineSchematic()
        renderer.destroy()
        renderer = new ForceRenderer(svg, callbacks, {
          multiStart: 1,
          engine: 'schematic',
          stressLayout: stress,
          schematicLayout: layout,
        })
        renderer.setGraph(collapsed, ['l1', 'l2'])
        await flush()
        expect(stress).not.toHaveBeenCalled()
        expect(layout.mock.calls.map((call) => call[0].layer)).toEqual(['l1', 'l2'])
        expect(pos('l1/b')[0] - pos('l1/a')[0]).toBeCloseTo(100, 3)
      })

      describe('moving a node by hand', () => {
        type Manual = {
          bodies: Array<{ id: string; x: number; y: number }>
          startManualMove(d: unknown): void
          manualMove(d: unknown, x: number, y: number, mouse?: Partial<MouseEvent>): void
        }
        const drag = async (key: Partial<MouseEvent>, dx: number, dy: number) => {
          makeSchematic(lineSchematic()).setGraph(collapsed, ['l1', 'l2'])
          await flush()
          const internals = renderer as unknown as Manual
          const a = internals.bodies.find((b) => b.id === 'l1/a')!
          const before = { a: pos('l1/a'), b: pos('l1/b') }
          internals.startManualMove(a)
          internals.manualMove(a, a.x + dx, a.y + dy, key)
          return { before, after: { a: pos('l1/a'), b: pos('l1/b') } }
        }

        it('moves only the node, rounded to the grid, without the simulation', async () => {
          const { before, after } = await drag({}, 14, 6)
          expect(after.a).toEqual([before.a[0] + 10, before.a[1] + 10])
          expect(after.b).toEqual(before.b)
        })

        it('moves the nodes in the row with the shift key, and the nodes in the column with the control key', async () => {
          const row = await drag({ shiftKey: true }, 20, 0)
          expect(row.after.a[0] - row.before.a[0]).toBe(20)
          expect(row.after.b[0] - row.before.b[0]).toBe(20) // (a and b are in the same row)
          const column = await drag({ ctrlKey: true }, 20, 0)
          expect(column.after.b).toEqual(column.before.b) // (b is not in the column of a)
        })
      })

      it('passes the names of the nodes and the links in the layer', async () => {
        const layout = lineSchematic()
        makeSchematic(layout).setGraph(collapsed, ['l1', 'l2'])
        await flush()
        const first = layout.mock.calls[0]?.[0]
        expect(first?.nodes.map((n) => n.id)).toEqual(['l1/a', 'l1/b'])
        expect(first?.nodes.every((n) => typeof n.name === 'string' && n.radius > 0)).toBe(true)
        expect(first?.links).toEqual([{ source: 'l1/a', target: 'l1/b' }])
        expect(layout.mock.calls[1]?.[0].links).toEqual([])
      })

      it('passes the profile whose target accepts the layer (none if no profile)', async () => {
        const { profiles } = parseProfiles('view: v\ntarget: { layer: l1 }\n')
        const layout = lineSchematic()
        makeSchematic(layout, undefined, profiles).setGraph(collapsed, ['l1', 'l2'])
        await flush()
        expect(layout.mock.calls[0]?.[0].profile?.view).toBe('v')
        expect(layout.mock.calls[1]?.[0].profile).toBeUndefined()
      })

      it('arranges again when the profiles are changed', async () => {
        const layout = lineSchematic()
        const r = makeSchematic(layout)
        r.setGraph(collapsed, ['l1', 'l2'])
        await flush()
        r.setProfiles(parseProfiles('view: v\n').profiles)
        await flush()
        expect(layout).toHaveBeenCalledTimes(4)
        expect(layout.mock.calls[2]?.[0].profile?.view).toBe('v')
      })

      it('does not arrange again when the profiles are not changed, or the engine is not schematic', async () => {
        const layout = lineSchematic()
        const r = makeSchematic(layout)
        r.setGraph(collapsed, ['l1', 'l2'])
        await flush()
        r.setProfiles([]) // empty to empty
        const { profiles } = parseProfiles('view: v\n')
        r.setProfiles(profiles)
        r.setProfiles(profiles) // the same profiles
        await flush()
        expect(layout).toHaveBeenCalledTimes(4) // 2 layers, and the arrangement for the profiles

        const stress = lineLayout()
        make(stress).setGraph(collapsed, ['l1', 'l2'])
        await flush()
        renderer.setProfiles(parseProfiles('view: w\n').profiles)
        await flush()
        expect(stress).toHaveBeenCalledTimes(2)
      })

      it('gives the lower layers to the layout, with the profile of the lower layer; the next layout is made with changed ones', async () => {
        const layout = lineSchematic()
        const { profiles } = parseProfiles('view: v\ntarget: { layer: base }\n')
        const base = { layer: 'base', nodes: [], links: [], lowerOf: new Map<string, string[]>() }
        renderer.destroy()
        renderer = new ForceRenderer(svg, callbacks, {
          multiStart: 1,
          engine: 'schematic',
          schematicLayout: layout,
          profiles,
          schematicBases: new Map([['l1', [base]]]),
        })
        renderer.setGraph(collapsed, ['l1', 'l2'])
        await flush()
        const [first, second] = layout.mock.calls.map((call) => call[0])
        expect(first?.bases?.map((b) => [b.layer, b.profile?.view])).toEqual([['base', 'v']])
        expect(second?.bases).toBeUndefined() // no base for l2
        // changing the lower layers does not arrange by itself: the next layout is made with them, even for the same graph
        renderer.setSchematicBases(new Map())
        await flush()
        expect(layout).toHaveBeenCalledTimes(2)
        renderer.setGraph(collapsed, ['l1', 'l2'])
        await flush()
        expect(layout).toHaveBeenCalledTimes(4)
        expect(layout.mock.calls[2]?.[0].bases).toBeUndefined()
        // the same lower layers (or the same graph without a change) are not arranged again
        renderer.setGraph(collapsed, ['l1', 'l2'])
        await flush()
        expect(layout).toHaveBeenCalledTimes(4)
      })

      describe('routes of the links (made from the current positions)', () => {
        const node = (id: string, expanded = false) => ({
          id: `l1/${id}`,
          type: 'node' as const,
          name: id,
          layer: 'l1',
          tpCount: expanded ? 2 : 0,
          expanded,
        })
        const row: DisplayGraph = {
          nodes: ['a', 'm', 'b'].map((id) => node(id)),
          links: [{ id: 'l1/a>l1/b', source: 'l1/a', target: 'l1/b', type: 'link', count: 1 }],
        }
        const makeRow = (graph = row) => {
          renderer.destroy()
          renderer = new ForceRenderer(svg, callbacks, {
            multiStart: 1,
            engine: 'schematic',
            // the nodes are in a row, 150 apart (the order of the nodes)
            schematicLayout: (input) =>
              Promise.resolve(new Map(input.nodes.map((n, i) => [n.id, { x: i * 150, y: 50 }])) as Positions),
          })
          renderer.setGraph(graph, ['l1'])
          return renderer
        }
        const d = () => svg.querySelector('path.link')?.getAttribute('d') ?? ''
        type Body = { id: string; x: number; y: number }
        /** Move a node and draw (as if it was dragged) */
        const move = (id: string, x: number, y: number) => {
          const body = (renderer as unknown as { bodies: Body[] }).bodies.find((b) => b.id === id)!
          Object.assign(body, { x, y })
          renderer.draw()
        }
        const points = (path: string) =>
          path.match(/-?[\d.]+,-?[\d.]+/g)!.map((p) => p.split(',').map(Number) as [number, number])

        it('draws a link which a straight line passes through a node as a polyline with rounded corners, around the node', async () => {
          makeRow()
          await flush()
          expect(d()).toContain('Q')
          // the lane is over the row (y < 50), and the line starts at the center of a and ends at the center of b
          const ps = points(d())
          expect(ps[0]).toEqual(pos('l1/a'))
          expect(ps.at(-1)).toEqual(pos('l1/b'))
          expect(Math.min(...ps.map((p) => p[1]))).toBeLessThan(50 - 11 - 6)
        })

        it('draws a link straight when nothing is in the way', async () => {
          makeRow({ nodes: row.nodes.slice(0, 2), links: row.links })
          await flush()
          expect(d()).not.toContain('Q')
        })

        it('makes the route again when a node is moved: the route follows, and the link is straight when the node is out of the way', async () => {
          makeRow()
          await flush()
          const [[bx, by], [mx, my]] = [pos('l1/b'), pos('l1/m')]
          const before = d()
          // the end b is moved a little down: the line a - b still passes near m, so the route follows it to the new end
          move('l1/b', bx, by + 10)
          expect(d()).toContain('Q')
          expect(points(d()).at(-1)).toEqual([bx, by + 10])
          expect(d()).not.toBe(before)
          // the node m in the way is moved away: the link is straight again
          move('l1/b', bx, by)
          move('l1/m', mx, my + 300)
          expect(d()).not.toContain('Q')
          // and back: the route again
          move('l1/m', mx, my)
          expect(d()).toContain('Q')
        })

        it('does not pass under the ports of a node in the way, and leaves the port outward', async () => {
          const expanded = (id: string, ports: string[]) => [
            node(id, true),
            ...ports.map((name) => ({
              id: `l1/${id}/${name}`,
              type: 'tp' as const,
              name,
              layer: 'l1',
              parent: `l1/${id}`,
            })),
          ]
          const graph: DisplayGraph = {
            nodes: [...expanded('a', ['p']), ...expanded('m', ['x', 'y']), ...expanded('b', ['q'])],
            links: [{ id: 'l', source: 'l1/a/p', target: 'l1/b/q', type: 'link', count: 1 }],
          }
          makeRow(graph)
          await flush()
          expect(d()).toContain('Q')
          const [start, first] = points(d())
          // the line which leaves the port goes outward (away from the center of the node a)
          const a = pos('l1/a')
          const away = (first![0] - a[0]) ** 2 + (first![1] - a[1]) ** 2
          expect(away).toBeGreaterThan((start![0] - a[0]) ** 2 + (start![1] - a[1]) ** 2)
          // the polyline is clear of the node m and of its ports (the polyline of the vertices: the corners are rounded inside)
          const line = points(d())
          const distanceTo = (c: [number, number]) =>
            Math.min(
              ...line.slice(1).map((q, i) => {
                const [p0, p1] = [line[i]!, q]
                const [dx, dy] = [p1[0] - p0[0], p1[1] - p0[1]]
                const t = Math.max(
                  0,
                  Math.min(1, ((c[0] - p0[0]) * dx + (c[1] - p0[1]) * dy) / (dx * dx + dy * dy || 1)),
                )
                return Math.hypot(c[0] - (p0[0] + t * dx), c[1] - (p0[1] + t * dy))
              }),
            )
          const radiusOfM = Number(nodeEl('l1/m').querySelector('circle')?.getAttribute('r'))
          expect(distanceTo(pos('l1/m'))).toBeGreaterThanOrEqual(radiusOfM)
          for (const name of ['x', 'y']) expect(distanceTo(pos(`l1/m/${name}`))).toBeGreaterThanOrEqual(4.5)
        })

        it('makes the routes again when the links are replaced by other ones between the same nodes', async () => {
          makeRow()
          await flush()
          expect(d()).toContain('Q')
          // the same nodes at the same positions, the link has another ID: the routes are by the ID of the link
          renderer.setGraph(
            {
              nodes: row.nodes,
              links: [{ id: 'other', source: 'l1/a', target: 'l1/b', type: 'link', count: 1 }],
            },
            ['l1'],
          )
          await flush()
          expect(d()).toContain('Q')
        })

        it('does not make a heavy route on every frame: the old routes are drawn, and the routes are made a little later', async () => {
          makeRow()
          await flush()
          const internals = renderer as unknown as { routeCost: number; routesAt: number }
          const [bx, by] = pos('l1/b')
          // as if the last making took long (a heavy one), and was just now
          internals.routeCost = 10
          internals.routesAt = performance.now()
          move('l1/b', bx, by + 10)
          expect(points(d()).at(-1)).toEqual([bx, by + 10]) // (the end follows at once)
          const stale = d()
          expect(stale).toContain('Q') // (the old route is drawn)
          await new Promise((resolve) => setTimeout(resolve, 80))
          expect(d()).toContain('Q')
          expect(d()).not.toBe(stale) // the route was made again from the new positions
        })

        describe('the ports of the links which go around something', () => {
          const expandedRow = (withBlocker: boolean): DisplayGraph => {
            const withPorts = (id: string, ports: string[]) => [
              node(id, true),
              ...ports.map((name) => ({
                id: `l1/${id}/${name}`,
                type: 'tp' as const,
                name,
                layer: 'l1',
                parent: `l1/${id}`,
              })),
            ]
            return {
              nodes: [
                ...withPorts('a', ['p']),
                ...(withBlocker ? withPorts('m', ['x', 'y']) : []),
                ...withPorts('b', ['q']),
              ],
              links: [{ id: 'l', source: 'l1/a/p', target: 'l1/b/q', type: 'link', count: 1 }],
            }
          }
          /** The port relative to the center of the node, and the radius of the node */
          const relative = (port: string, node: string) => {
            const [p, n] = [pos(port), pos(node)]
            return {
              dx: p[0] - n[0],
              dy: p[1] - n[1],
              r: Number(nodeEl(node).querySelector('circle')?.getAttribute('r')),
            }
          }

          it('is put toward where the route leaves the node (here: over the row), not toward the other node', async () => {
            makeRow(expandedRow(true))
            await flush()
            for (const [port, node] of [
              ['l1/a/p', 'l1/a'],
              ['l1/b/q', 'l1/b'],
            ] as const) {
              const { dx, dy, r } = relative(port, node)
              expect(dy).toBeLessThan(-0.9 * r) // at the top of the circle
              expect(Math.abs(dx)).toBeLessThan(1)
            }
            // and the link leaves it straight up
            const [start, first] = points(d())
            expect(first![0]).toBeCloseTo(start![0], 6)
            expect(first![1]).toBeLessThan(start![1])
          })

          it('is toward the other node when the link is straight', async () => {
            makeRow(expandedRow(false))
            await flush()
            expect(d()).not.toContain('Q')
            const a = relative('l1/a/p', 'l1/a')
            expect(a.dx).toBeGreaterThan(0.9 * a.r) // at the right of a (toward b)
            const b = relative('l1/b/q', 'l1/b')
            expect(b.dx).toBeLessThan(-0.9 * b.r)
          })

          it('is toward the other node again when the node in the way is moved away', async () => {
            makeRow(expandedRow(true))
            await flush()
            const [mx, my] = pos('l1/m')
            move('l1/m', mx, my + 300)
            expect(d()).not.toContain('Q')
            const a = relative('l1/a/p', 'l1/a')
            expect(a.dx).toBeGreaterThan(0.9 * a.r)
          })
        })

        it('makes the routes at once when the nodes are arranged (they are not delayed because the last making was heavy)', async () => {
          renderer.destroy()
          renderer = new ForceRenderer(svg, callbacks, {
            multiStart: 1,
            engine: 'schematic',
            schematicLayout: (input) =>
              Promise.resolve(new Map(input.nodes.map((n, i) => [n.id, { x: i * 150, y: 50 }])) as Positions),
          })
          // as if the last making took long and was just now
          const internals = renderer as unknown as { routeCost: number; routesAt: number }
          internals.routeCost = 1000
          internals.routesAt = performance.now()
          renderer.setGraph(row, ['l1'])
          await flush()
          expect(d()).toContain('Q')
        })

        it('keeps a straight link straight when the ports of the node are turned toward the route of another link', async () => {
          // a, b: expanded, in a row with the node m between (the link a - b goes around m: the ports are turned over the
          // row). The node a has another link to the node u under it, which is straight: it must stay straight.
          // (If the turned ports made it go around, the ports of the nodes would not be turned: see updateRoutes.)
          const port = (id: string, name: string) => ({
            id: `l1/${id}/${name}`,
            type: 'tp' as const,
            name,
            layer: 'l1',
            parent: `l1/${id}`,
          })
          const graph: DisplayGraph = {
            nodes: [
              node('a', true),
              port('a', 'p'),
              port('a', 'r'),
              node('m'),
              node('b', true),
              port('b', 'q'),
              node('u'),
            ],
            links: [
              { id: 'around', source: 'l1/a/p', target: 'l1/b/q', type: 'link', count: 1 },
              { id: 'down', source: 'l1/a/r', target: 'l1/u', type: 'link', count: 1 },
            ],
          }
          renderer.destroy()
          renderer = new ForceRenderer(svg, callbacks, {
            multiStart: 1,
            engine: 'schematic',
            // a, m, b in a row; u under a
            schematicLayout: (input) => {
              const at: Record<string, [number, number]> = {
                'l1/a': [0, 50],
                'l1/m': [150, 50],
                'l1/b': [300, 50],
                'l1/u': [0, 160],
              }
              return Promise.resolve(
                new Map(input.nodes.map((n) => [n.id, { x: at[n.id]![0], y: at[n.id]![1] }])) as Positions,
              )
            },
          })
          renderer.setGraph(graph, ['l1'])
          await flush()
          const pathOf = (id: string) =>
            [...svg.querySelectorAll('path.link')]
              .find((p) => (p as unknown as { __data__: { id: string } }).__data__.id === id)
              ?.getAttribute('d') ?? ''
          expect(pathOf('around')).toContain('Q')
          expect(pathOf('down')).not.toContain('Q') // straight
        })

        it('draws the links straight in the other engines', async () => {
          make(lineLayout()).setGraph(collapsed, ['l1', 'l2'])
          await flush()
          expect(svg.querySelector('path.link')?.getAttribute('d')).not.toContain('Q')
        })
      })

      it('tells the report of each layer, but not the one which comes after a newer layout is started', async () => {
        const reports: string[] = []
        renderer.destroy()
        let first = true
        renderer = new ForceRenderer(svg, callbacks, {
          multiStart: 1,
          engine: 'schematic',
          schematicLayout: async (input) => {
            const tag = first ? 'old' : 'new'
            await Promise.resolve() // the report comes later than the start of the next layout
            input.report?.({ layer: `${input.layer}:${tag}`, source: 'none', violations: [] })
            return new Map(input.nodes.map((n, i) => [n.id, { x: i * 100, y: 0 }])) as Positions
          },
          onSchematicReport: (r) => reports.push(r.layer),
        })
        renderer.setGraph(collapsed, ['l1', 'l2'])
        first = false
        renderer.setGraph({ nodes: collapsed.nodes.slice(0, 1), links: [] }, ['l1', 'l2']) // a newer layout
        await flush()
        expect(reports).toEqual(['l1:new'])
      })

      it('reports the quality of the layout with the engine', async () => {
        const reports: Array<LayoutStats | null> = []
        makeSchematic(lineSchematic(), (stats) => reports.push(stats)).setGraph(collapsed, ['l1', 'l2'])
        await flush()
        expect(reports.at(-1)).toMatchObject({ engine: 'schematic', nodes: 3, links: 1 })
      })

      it('arranges with the real skeleton layout (no overlaps or crossings)', async () => {
        renderer.destroy()
        const reports: Array<LayoutStats | null> = []
        renderer = new ForceRenderer(svg, callbacks, {
          engine: 'schematic',
          onLayout: (s) => reports.push(s),
        })
        renderer.setGraph(graph, ['l1', 'l2'])
        await flush()
        expect(reports.at(-1)).toMatchObject({ engine: 'schematic', crossings: 0, overlap: 0 })
      })
    })

    it('reports the quality of the force layout too', () => {
      const reports: Array<LayoutStats | null> = []
      renderer.destroy()
      renderer = new ForceRenderer(svg, callbacks, { multiStart: 1, onLayout: (s) => reports.push(s) })
      renderer.setGraph(collapsed, ['l1', 'l2'])
      expect(reports.at(-1)).toMatchObject({ engine: 'force', nodes: 3, links: 1 })
      expect(reports.at(-1)?.ms).toBeGreaterThanOrEqual(0)
    })

    it('arranges with the real stress layout (no overlaps or crossings)', async () => {
      renderer.destroy()
      const reports: Array<LayoutStats | null> = []
      renderer = new ForceRenderer(svg, callbacks, { engine: 'stress', onLayout: (s) => reports.push(s) })
      renderer.setGraph(graph, ['l1', 'l2'])
      await flush()
      expect(reports.at(-1)).toMatchObject({ engine: 'stress', crossings: 0, overlap: 0 })
    })

    it('puts the term-points on the circles of the nodes with the stress layout, too', async () => {
      make(lineLayout()).setGraph(graph, ['l1', 'l2'])
      await flush()
      const [ax, ay] = pos('l1/a')
      const radius = Number(nodeEl('l1/a').querySelector('circle')?.getAttribute('r'))
      const [px, py] = pos('l1/a/p1')
      expect(Math.hypot(px - ax, py - ay)).toBeCloseTo(radius, 3)
    })
  })
})
