import { describe, expect, it } from 'vitest'
import type { LayerInfo, SupportEdge } from '../api/types'
import { checkSupports, pairKey } from './supportCheck'

const layer = (id: string, rank: number | null, supports: string[] = []): LayerInfo => ({
  id,
  name: id,
  kind: null,
  supports,
  rank,
  counts: { nodes: 0, tps: 0, links: 0 },
})
const nodes = (layerId: string, names: string[]) => names.map((n) => ({ id: `${layerId}/${n}`, name: n }))
const edge = (kind: SupportEdge['kind'], from: string, to: string): SupportEdge => ({ kind, from, to })

const layers = [layer('l3', 2, ['l2']), layer('l2', 1, ['l1']), layer('l1', 0)]
const allNodes = {
  l3: nodes('l3', ['a', 'b']),
  l2: nodes('l2', ['a', 'b']),
  l1: nodes('l1', ['a', 'b']),
}
const nodeOfTp = (id: string) => id.split('/').slice(0, 2).join('/')

const base: SupportEdge[] = [
  edge('node', 'l3/a', 'l2/a'),
  edge('node', 'l3/b', 'l2/b'),
  edge('node', 'l2/a', 'l1/a'),
  edge('node', 'l2/b', 'l1/b'),
]
const run = (
  edges: SupportEdge[],
  ls = layers,
  ns: Record<string, { id: string; name: string }[]> = allNodes,
) => checkSupports({ layers: ls, nodes: ns, edges, nodeOfTp })

describe('checkSupports', () => {
  it('finds no problem in consistent supports', () => {
    const report = run(base)
    expect(report.nodeIssues.size).toBe(0)
    expect(report.edgeIssues.size).toBe(0)
    expect(report.layerIssues).toEqual([])
    expect(report.pairs).toHaveLength(4)
  })

  it('finds a node which is not supported by a lower node (not in the lowest layer)', () => {
    const report = run(base.filter((e) => e.from !== 'l3/b'))
    expect(report.nodeIssues.get('l3/b')?.map((i) => i.code)).toEqual(['unsupported'])
    expect(report.nodeIssues.has('l1/a')).toBe(false)
    // l2/b is still used by nothing above
    expect(report.nodeIssues.get('l2/b')?.map((i) => i.code)).toEqual(['unused'])
  })

  it('finds a node which supports nothing above', () => {
    const report = run(base.filter((e) => e.from !== 'l2/b'))
    expect(report.nodeIssues.get('l1/b')?.map((i) => i.code)).toEqual(['unused'])
    expect(report.nodeIssues.get('l2/b')?.map((i) => i.code)).toEqual(['unsupported'])
  })

  it('does not report the lowest layer as unsupported nor the top layer as unused', () => {
    const report = run(base)
    expect(report.nodeIssues.has('l1/a')).toBe(false)
    expect(report.nodeIssues.has('l3/a')).toBe(false)
  })

  it('finds term-point supports without the node support', () => {
    const edges = [...base.filter((e) => e.from !== 'l3/b'), edge('tp', 'l3/b/tp1', 'l2/b/tp1')]
    const report = run(edges)
    expect(report.edgeIssues.get(pairKey('l3/b', 'l2/b'))?.map((i) => i.code)).toEqual(['tp-only'])
    // the node is supported through its term-point, so it is not "unsupported"
    expect(report.nodeIssues.has('l3/b')).toBe(false)
  })

  it('accepts term-point supports which agree with the node support', () => {
    const report = run([...base, edge('tp', 'l3/a/tp1', 'l2/a/tp1')])
    expect(report.edgeIssues.size).toBe(0)
    expect(report.pairs.find((p) => p.from === 'l3/a')).toMatchObject({ byNode: true, byTp: true })
  })

  it('finds supports in the same layer', () => {
    const report = run([...base, edge('node', 'l2/a', 'l2/b')])
    expect(report.edgeIssues.get(pairKey('l2/a', 'l2/b'))?.map((i) => i.code)).toEqual(['same-layer'])
  })

  it('finds supports from a layer which is not lower', () => {
    const report = run([...base, edge('node', 'l1/a', 'l3/a')])
    expect(report.edgeIssues.get(pairKey('l1/a', 'l3/a'))?.map((i) => i.code)).toEqual(['inverted'])
  })

  it('finds supports between layers which are not declared', () => {
    const report = run([...base, edge('node', 'l3/a', 'l1/b')])
    expect(report.layerIssues.map((i) => [i.code, i.from, i.to])).toEqual([['undeclared', 'l3', 'l1']])
  })

  it('finds a declared layer without supports', () => {
    const report = run(base.filter((e) => !e.from.startsWith('l2/')))
    expect(report.layerIssues.map((i) => [i.code, i.from, i.to])).toEqual([['no-support', 'l2', 'l1']])
  })

  it('does not report a declared layer without nodes', () => {
    const report = run(
      base.filter((e) => !e.from.startsWith('l2/')),
      layers,
      { ...allNodes, l1: [] },
    )
    expect(report.layerIssues).toEqual([])
  })

  it('ignores supports to the layers which are not checked (hidden)', () => {
    const report = run(base, layers.slice(0, 2), { l3: allNodes.l3, l2: allNodes.l2 })
    expect(report.nodeIssues.size).toBe(0)
    expect(report.layerIssues).toEqual([])
    expect(report.pairs).toHaveLength(2)
  })
})
