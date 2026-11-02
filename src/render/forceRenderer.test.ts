import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DisplayGraph } from '../domain/graph'
import { ForceRenderer, type Highlight } from './forceRenderer'

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
    expect(svg.querySelectorAll('line.link')).toHaveLength(1)
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

  it('puts a term-point toward the node it is linked to', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(30)
    const [ax, ay] = pos('l1/a')
    const [bx, by] = pos('l1/b')
    const [px, py] = pos('l1/a/p1')
    // the angle between (node a -> port) and (node a -> node b) is small
    const toPort = Math.atan2(py - ay, px - ax)
    const toPeer = Math.atan2(by - ay, bx - ax)
    expect(Math.abs(Math.atan2(Math.sin(toPort - toPeer), Math.cos(toPort - toPeer)))).toBeLessThan(0.5)
  })

  it('separates the term-points of a node', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(30)
    const [x1, y1] = pos('l1/a/p1')
    const [x2, y2] = pos('l1/a/p2')
    expect(Math.hypot(x1 - x2, y1 - y2)).toBeGreaterThan(9)
  })

  it('draws a link between the term-points', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(10)
    const line = svg.querySelector('line.link') as SVGLineElement
    const [x1, y1] = pos('l1/a/p1')
    const [x2, y2] = pos('l1/b/p1')
    expect([line.getAttribute('x1'), line.getAttribute('y1')].map(Number)).toEqual([x1, y1])
    expect([line.getAttribute('x2'), line.getAttribute('y2')].map(Number)).toEqual([x2, y2])
  })

  it('draws a link between the nodes when the term-points are not shown', () => {
    renderer.setGraph(collapsed, ['l1', 'l2'])
    renderer.tick(10)
    expect(svg.querySelectorAll('g.node.tp')).toHaveLength(0)
    const line = svg.querySelector('line.link') as SVGLineElement
    expect([line.getAttribute('x1'), line.getAttribute('y1')].map(Number)).toEqual(pos('l1/a'))
  })

  it('marks nodes and term-points with diff and expanded nodes by classes', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    expect(nodeEl('l1/a').classList.contains('diff-changed')).toBe(true)
    expect(nodeEl('l1/a').classList.contains('expanded')).toBe(true)
    expect(nodeEl('l1/a/p2').classList.contains('diff-added')).toBe(true)
  })

  it('arranges a graph without crossings of links in a ring (the best of random starts)', () => {
    // a 4-cycle: it can be drawn without crossings. The layout with fewer crossings is chosen.
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
    const multi = new ForceRenderer(svg, callbacks, { multiStart: 4 })
    multi.setGraph(ring, ['l'])
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(pos)
    const diag1 = Math.hypot((a?.[0] ?? 0) - (c?.[0] ?? 0), (a?.[1] ?? 0) - (c?.[1] ?? 0))
    const diag2 = Math.hypot((b?.[0] ?? 0) - (d?.[0] ?? 0), (b?.[1] ?? 0) - (d?.[1] ?? 0))
    const side = Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0))
    // the diagonals of a convex quadrangle are longer than a side (a crossed layout has a short diagonal)
    expect(Math.min(diag1, diag2)).toBeGreaterThan(side * 0.9)
    multi.destroy()
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
    expect(svg.querySelectorAll('line.link')).toHaveLength(0)
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
      expect(svg.querySelectorAll('line.link.hover')).toHaveLength(1)
      nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('mouseleave'))
      nodeEl('l1/a/p2').dispatchEvent(new MouseEvent('mouseenter'))
      expect(svg.querySelectorAll('line.link.hover')).toHaveLength(0)
    })

    it('marks the links of the term-points of a hovered node', () => {
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseenter'))
      expect(svg.querySelectorAll('line.link.hover')).toHaveLength(1)
      nodeEl('l1/b').dispatchEvent(new MouseEvent('mouseleave'))
      expect(svg.querySelectorAll('line.link.hover')).toHaveLength(0)
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
})
