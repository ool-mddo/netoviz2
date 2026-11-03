import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { PORTS_AUTO_LIMIT, useViewStore } from './view'

beforeEach(() => setActivePinia(createPinia()))

describe('view store', () => {
  const ids = ['a', 'b', 'c']

  it('shows the term-points of all nodes for a small topology, by default', () => {
    const view = useViewStore()
    expect(view.expandedNodes(ids, 10)).toEqual(new Set(ids))
  })

  it('hides the term-points for a large topology, by default', () => {
    const view = useViewStore()
    expect(view.portsByDefault(PORTS_AUTO_LIMIT)).toBe(true)
    expect(view.portsByDefault(PORTS_AUTO_LIMIT + 1)).toBe(false)
    expect(view.expandedNodes(ids, PORTS_AUTO_LIMIT + 1).size).toBe(0)
  })

  it('inverts the default for a node when it is toggled', () => {
    const view = useViewStore()
    view.toggleExpand('b')
    expect(view.expandedNodes(ids, 10)).toEqual(new Set(['a', 'c']))
    expect(view.expandedNodes(ids, PORTS_AUTO_LIMIT + 1)).toEqual(new Set(['b']))
    view.toggleExpand('b')
    expect(view.expandedNodes(ids, 10)).toEqual(new Set(ids))
  })

  it('follows the choice of the user for all nodes and clears the choices for each node', () => {
    const view = useViewStore()
    view.toggleExpand('a')
    view.setShowPorts(false)
    expect(view.expandedNodes(ids, 10).size).toBe(0)
    view.setShowPorts(true)
    expect(view.expandedNodes(ids, PORTS_AUTO_LIMIT + 1)).toEqual(new Set(ids))
  })
})
