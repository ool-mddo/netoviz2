import { describe, expect, it } from 'vitest'
import type { LinkData, TpData } from '../api/types'
import { rollupLinks } from './rollup'

const tps: TpData[] = [
  { id: 'n1/p1', node: 'n1', name: 'p1' },
  { id: 'n1/p2', node: 'n1', name: 'p2' },
  { id: 'n2/p1', node: 'n2', name: 'p1' },
  { id: 'n2/p2', node: 'n2', name: 'p2' },
  { id: 'n3/p1', node: 'n3', name: 'p1' },
]
const link = (id: string, src: string | null, dst: string | null, diff?: LinkData['diff']): LinkData => ({
  id,
  name: id,
  src,
  dst,
  ...(diff ? { diff } : {}),
})

describe('rollupLinks', () => {
  it('bundles links between the same nodes in both directions', () => {
    const links = [
      link('a', 'n1/p1', 'n2/p1'),
      link('b', 'n2/p1', 'n1/p1'),
      link('c', 'n1/p2', 'n2/p2'),
      link('d', 'n1/p1', 'n3/p1'),
    ]
    const result = rollupLinks({ tps, links })
    expect(result).toHaveLength(2)
    const bundle = result.find((l) => l.source === 'n1' && l.target === 'n2')
    expect(bundle?.linkIds).toEqual(['a', 'b', 'c'])
  })

  it('skips links with unknown endpoints and links in a node', () => {
    const links = [link('a', null, 'n2/p1'), link('b', 'n1/p1', 'none'), link('c', 'n1/p1', 'n1/p2')]
    expect(rollupLinks({ tps, links })).toEqual([])
  })

  it('has the common diff label of the bundled links', () => {
    const links = [link('a', 'n1/p1', 'n2/p1', 'added'), link('b', 'n2/p1', 'n1/p1', 'added')]
    expect(rollupLinks({ tps, links })[0]?.diff).toBe('added')
  })

  it('is changed when the diff labels are mixed (including links without diff)', () => {
    const links = [link('a', 'n1/p1', 'n2/p1', 'added'), link('b', 'n1/p2', 'n2/p2')]
    expect(rollupLinks({ tps, links })[0]?.diff).toBe('changed')
  })

  it('has no diff label when no link has diff', () => {
    expect(rollupLinks({ tps, links: [link('a', 'n1/p1', 'n2/p1')] })[0]?.diff).toBeUndefined()
  })

  it('keeps the term-points of expanded nodes (links are between term-points and nodes)', () => {
    const links = [link('a', 'n1/p1', 'n2/p1'), link('b', 'n1/p2', 'n2/p2'), link('c', 'n1/p1', 'n3/p1')]
    const result = rollupLinks({ tps, links }, new Set(['n1']))
    expect(result.map((l) => [l.source, l.target]).sort()).toEqual([
      ['n1/p1', 'n2'],
      ['n1/p1', 'n3'],
      ['n1/p2', 'n2'],
    ])
  })

  it('links two expanded nodes at their term-points', () => {
    const result = rollupLinks({ tps, links: [link('a', 'n1/p1', 'n2/p1')] }, new Set(['n1', 'n2']))
    expect(result).toHaveLength(1)
    expect([result[0]?.source, result[0]?.target].sort()).toEqual(['n1/p1', 'n2/p1'])
  })

  it('skips a link inside an expanded node only when both ends are the same term-point', () => {
    const result = rollupLinks({ tps, links: [link('a', 'n1/p1', 'n1/p2')] }, new Set(['n1']))
    expect(result).toHaveLength(1)
  })
})
