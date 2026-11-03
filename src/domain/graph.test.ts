import { describe, expect, it } from 'vitest'
import type { LayerData } from '../api/types'
import { buildDisplayGraph, displayIdOf } from './graph'

const layer: LayerData = {
  layer: 'l1',
  etag: 'e',
  nodes: [
    { id: 'l1/a', name: 'a', tp_count: 2, kind: 'node', diff: 'added' },
    { id: 'l1/b', name: 'b', tp_count: 1 },
  ],
  tps: [
    { id: 'l1/a/p1', node: 'l1/a', name: 'p1' },
    { id: 'l1/a/p2', node: 'l1/a', name: 'p2', diff: 'changed' },
    { id: 'l1/b/p1', node: 'l1/b', name: 'p1' },
  ],
  links: [
    { id: 'l1/~link/x', name: 'x', src: 'l1/a/p1', dst: 'l1/b/p1' },
    { id: 'l1/~link/y', name: 'y', src: 'l1/b/p1', dst: 'l1/a/p1' },
  ],
}

describe('buildDisplayGraph', () => {
  it('shows nodes only (term-points are collapsed) with bundled links', () => {
    const graph = buildDisplayGraph([layer], new Set())
    expect(graph.nodes.map((n) => n.id)).toEqual(['l1/a', 'l1/b'])
    expect(graph.links).toHaveLength(1)
    expect(graph.links[0]).toMatchObject({ source: 'l1/a', target: 'l1/b', type: 'link', count: 2 })
  })

  it('has name, kind, diff and the number of term-points of nodes', () => {
    const [a, b] = buildDisplayGraph([layer], new Set()).nodes
    expect(a).toMatchObject({ type: 'node', name: 'a', layer: 'l1', kind: 'node', diff: 'added', tpCount: 2 })
    expect(b).not.toHaveProperty('kind')
    expect(b).not.toHaveProperty('diff')
  })

  it('shows term-points of expanded nodes with member links', () => {
    const graph = buildDisplayGraph([layer], new Set(['l1/a']))
    expect(graph.nodes.map((n) => n.id)).toEqual(['l1/a', 'l1/b', 'l1/a/p1', 'l1/a/p2'])
    expect(graph.nodes.find((n) => n.id === 'l1/a')?.expanded).toBe(true)
    expect(graph.nodes.find((n) => n.id === 'l1/a/p2')).toMatchObject({
      type: 'tp',
      parent: 'l1/a',
      diff: 'changed',
    })
    const members = graph.links.filter((l) => l.type === 'member')
    expect(members.map((l) => [l.source, l.target])).toEqual([
      ['l1/a', 'l1/a/p1'],
      ['l1/a', 'l1/a/p2'],
    ])
    expect(graph.links.find((l) => l.type === 'link')).toMatchObject({ source: 'l1/a/p1', target: 'l1/b' })
  })

  it('makes the graph of multiple layers', () => {
    const other: LayerData = {
      layer: 'l2',
      etag: 'e',
      nodes: [{ id: 'l2/r', name: 'r', tp_count: 0 }],
      tps: [],
      links: [],
    }
    expect(buildDisplayGraph([layer, other], new Set()).nodes.map((n) => n.layer)).toEqual(['l1', 'l1', 'l2'])
  })
})

describe('displayIdOf', () => {
  const shown = new Set(['l1/a', 'l1/b', 'l1/a/p1'])
  const node = { type: 'node' as const, data: { id: 'l1/a' } }
  const tp = { type: 'tp' as const, data: { id: 'l1/a/p1', node: 'l1/a' } }

  it('returns the node ID for a node', () => {
    expect(displayIdOf(node, new Set(), shown)).toBe('l1/a')
  })

  it('returns the node ID for a term-point of a collapsed node', () => {
    expect(displayIdOf(tp, new Set(), shown)).toBe('l1/a')
  })

  it('returns the term-point ID for a term-point of an expanded node', () => {
    expect(displayIdOf(tp, new Set(['l1/a']), shown)).toBe('l1/a/p1')
  })

  it('returns undefined for links, unknown objects and objects which are not shown', () => {
    expect(displayIdOf({ type: 'link', data: { id: 'x' } }, new Set(), shown)).toBeUndefined()
    expect(displayIdOf(undefined, new Set(), shown)).toBeUndefined()
    expect(displayIdOf({ type: 'node', data: { id: 'l9/z' } }, new Set(), shown)).toBeUndefined()
  })
})
