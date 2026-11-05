import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DisplayGraph } from '../domain/graph'
import { ForceRenderer, type Highlight } from './forceRenderer'
import { parseProfiles } from './layout/schematic/profile'
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
