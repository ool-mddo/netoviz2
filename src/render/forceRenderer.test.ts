import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DisplayGraph } from '../domain/graph'
import { ForceRenderer, type Highlight } from './forceRenderer'

const graph: DisplayGraph = {
  nodes: [
    { id: 'l1/a', type: 'node', name: 'a', layer: 'l1', tpCount: 2, diff: 'changed' },
    { id: 'l1/b', type: 'node', name: 'b', layer: 'l1', tpCount: 1 },
    { id: 'l2/r', type: 'node', name: 'r', layer: 'l2', kind: 'node', tpCount: 0 },
  ],
  links: [{ id: 'k', source: 'l1/a', target: 'l1/b', type: 'link', count: 2 }],
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
  renderer = new ForceRenderer(svg, callbacks)
})
afterEach(() => {
  renderer.destroy()
  svg.remove()
})

const nodeEl = (id: string) => svg.querySelector(`g.node[data-id="${id}"]`) as SVGGElement
const highlight = (overrides: Partial<Highlight> = {}): Highlight => ({
  selectedId: null,
  tracedIds: new Set(),
  traceEdges: [],
  ...overrides,
})

describe('ForceRenderer', () => {
  it('draws nodes and links with names', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(5)
    expect(svg.querySelectorAll('g.node')).toHaveLength(3)
    expect(svg.querySelectorAll('line.link')).toHaveLength(1)
    expect(nodeEl('l1/a').querySelector('text')?.textContent).toBe('a')
    expect(nodeEl('l2/r').querySelector('title')?.textContent).toBe('r (node)')
  })

  it('marks nodes with diff and expanded nodes by classes', () => {
    renderer.setGraph(
      { ...graph, nodes: graph.nodes.map((n) => (n.id === 'l1/b' ? { ...n, expanded: true } : n)) },
      ['l1', 'l2'],
    )
    expect(nodeEl('l1/a').classList.contains('diff-changed')).toBe(true)
    expect(nodeEl('l1/b').classList.contains('expanded')).toBe(true)
  })

  it('moves nodes (positions are numbers) and draws the links between them', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(10)
    expect(nodeEl('l1/a').getAttribute('transform')).toMatch(
      /^translate\(-?[\d.]+(e-?\d+)?,-?[\d.]+(e-?\d+)?\)$/,
    )
    const line = svg.querySelector('line.link') as SVGLineElement
    expect(Number.isFinite(Number(line.getAttribute('x1')))).toBe(true)
  })

  it('keeps the positions of the elements when the graph is updated', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.tick(30)
    const before = nodeEl('l1/a').getAttribute('transform')
    renderer.setGraph(
      { nodes: [...graph.nodes, { id: 'l1/c', type: 'node', name: 'c', layer: 'l1' }], links: graph.links },
      ['l1', 'l2'],
    )
    renderer.draw()
    expect(svg.querySelectorAll('g.node')).toHaveLength(4)
    expect(nodeEl('l1/a').getAttribute('transform')).toBe(before)
  })

  it('removes the elements which are not in the graph any more', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    renderer.setGraph({ nodes: graph.nodes.slice(0, 1), links: [] }, ['l1'])
    expect(svg.querySelectorAll('g.node')).toHaveLength(1)
    expect(svg.querySelectorAll('line.link')).toHaveLength(0)
  })

  it('selects an element by click and clears the selection by a click on the background', () => {
    renderer.setGraph(graph, ['l1', 'l2'])
    nodeEl('l1/a').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(callbacks.onSelect).toHaveBeenLastCalledWith('l1/a')
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(callbacks.onSelect).toHaveBeenLastCalledWith(null)
    expect(callbacks.onSelect).toHaveBeenCalledTimes(2)
  })

  it('toggles expansion by double click (the node of a term-point)', () => {
    renderer.setGraph(
      {
        nodes: [...graph.nodes, { id: 'l1/a/p1', type: 'tp', name: 'p1', layer: 'l1', parent: 'l1/a' }],
        links: graph.links,
      },
      ['l1', 'l2'],
    )
    nodeEl('l1/b').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(callbacks.onToggleExpand).toHaveBeenLastCalledWith('l1/b')
    nodeEl('l1/a/p1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(callbacks.onToggleExpand).toHaveBeenLastCalledWith('l1/a')
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
      expect(svg.querySelectorAll('line.trace-edge')).toHaveLength(1)
    })

    it('does not dim anything if the selected element has no trace', () => {
      renderer.setHighlight(highlight({ selectedId: 'l1/b', tracedIds: new Set(['l1/b']) }))
      expect(nodeEl('l1/b').classList.contains('selected')).toBe(true)
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
