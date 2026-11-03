import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { attributesData, layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import DependencyView from './DependencyView.vue'

vi.mock('../api/client')
const mocked = vi.mocked(api)

async function mountView(selected: string | null = null, loadedLayers = ['layer1', 'layer2']) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const topology = useTopologyStore()
  await topology.open('nw', 'ss')
  await Promise.all(loadedLayers.map((id) => topology.loadLayer(id)))
  await topology.ensureSupports()
  const selection = useSelectionStore()
  selection.select(selected)
  const wrapper = mount(DependencyView, {
    props: { visibleLayers: ['layer1', 'layer2'] },
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, topology, selection }
}

let current: ReturnType<typeof mount> | null = null
beforeEach(() => {
  vi.resetAllMocks()
  mocked.getSummary.mockResolvedValue(makeSummary())
  mocked.getLayer.mockImplementation((_nw, _ss, id) =>
    Promise.resolve(id === 'layer1' ? layer1Data : layer2Data),
  )
  mocked.getSupports.mockResolvedValue(supportsData)
  mocked.getAttributes.mockResolvedValue(attributesData)
})
afterEach(() => {
  current?.unmount()
  current = null
})

const q = (wrapper: ReturnType<typeof mount>, selector: string) => wrapper.element.querySelectorAll(selector)
const ids = (wrapper: ReturnType<typeof mount>) =>
  [...q(wrapper, 'g.node, g.group')].map((el) => el.getAttribute('data-id')).sort()

describe('DependencyView', () => {
  it('asks to select an object when nothing is selected', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    expect(wrapper.get('[data-testid=dependency-hint]').text()).toContain('Select a node or a term-point')
    expect(q(wrapper, 'g.node')).toHaveLength(0)
  })

  it('shows the supports of the selected node (nodes only), the upper layer above the lower one', async () => {
    const { wrapper } = await mountView('layer2/r1')
    current = wrapper
    expect(ids(wrapper)).toEqual(['layer1/sw1', 'layer2/r1'])
    expect(q(wrapper, 'g.band')).toHaveLength(2)
    const lines = q(wrapper, 'path.support')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.getAttribute('data-from')).toBe('layer2/r1')
    expect(lines[0]?.getAttribute('data-to')).toBe('layer1/sw1')
    const y = (id: string) => {
      const t = (wrapper.element.querySelector(`[data-id="${id}"]`) as SVGGElement).getAttribute('transform')
      return Number(/,(-?[\d.]+)\)/.exec(t ?? '')?.[1])
    }
    expect(y('layer2/r1')).toBeLessThan(y('layer1/sw1'))
    expect(wrapper.get('g.node[data-id="layer2/r1"]').classes()).toContain('selected')
    // nodes without term-points in the tree are not boxes
    expect(q(wrapper, 'g.group')).toHaveLength(0)
  })

  it('shows the objects supported by the selected node (the upper layers)', async () => {
    const { wrapper } = await mountView('layer1/sw1')
    current = wrapper
    expect(ids(wrapper)).toEqual(['layer1/sw1', 'layer2/r1'])
  })

  it('does not show the objects which are not related to the selected one', async () => {
    const { wrapper } = await mountView('layer2/r1')
    current = wrapper
    expect(wrapper.find('g.node[data-id="layer1/sw2"]').exists()).toBe(false)
  })

  it('shows the term-points of a selected term-point with the names of their nodes', async () => {
    const { wrapper } = await mountView('layer2/r1/e1')
    current = wrapper
    // the nodes of the term-points are shown too (the boxes which hold them)
    expect(ids(wrapper)).toEqual(['layer1/sw1', 'layer1/sw1/p1', 'layer2/r1', 'layer2/r1/e1'])
    expect(wrapper.get('g.node[data-id="layer2/r1/e1"]').text()).toContain('e1')
    expect(wrapper.get('g.group[data-id="layer2/r1"]').text()).toContain('r1')
    expect(wrapper.get('g.node[data-id="layer1/sw1/p1"]').classes()).toContain('tp')
    expect(q(wrapper, 'path.support')).toHaveLength(1)
    // a term-point has no choice of the term-points
    expect(wrapper.find('[data-testid=with-tps]').exists()).toBe(false)
  })

  it('draws a support between adjacent layers as a straight line', async () => {
    const { wrapper } = await mountView('layer2/r1/e1')
    current = wrapper
    expect(q(wrapper, 'path.support')[0]?.getAttribute('d')).not.toContain('C')
  })

  it('highlights the supports of the hovered node and the node at the other end', async () => {
    const { wrapper } = await mountView('layer2/r1')
    current = wrapper
    await wrapper.get('g.node[data-id="layer2/r1"]').trigger('mouseenter')
    expect(wrapper.get('path.support').classes()).toContain('hover')
    expect(wrapper.get('g.node[data-id="layer1/sw1"]').classes()).toContain('peer')
    await wrapper.get('g.node[data-id="layer2/r1"]').trigger('mouseleave')
    expect(wrapper.get('path.support').classes()).not.toContain('hover')
    expect(wrapper.get('g.node[data-id="layer1/sw1"]').classes()).not.toContain('peer')
  })

  it('highlights the supports of the hovered term-point and the term-point at the other end', async () => {
    const { wrapper } = await mountView('layer2/r1/e1')
    current = wrapper
    await wrapper.get('g.node.tp[data-id="layer2/r1/e1"]').trigger('mouseenter')
    expect(wrapper.get('path.support').classes()).toContain('hover')
    expect(wrapper.get('g.node.tp[data-id="layer1/sw1/p1"]').classes()).toContain('peer')
  })

  it('adds the term-points of the selected node with the checkbox', async () => {
    const { wrapper } = await mountView('layer2/r1')
    current = wrapper
    await wrapper.get('[data-testid=with-tps]').setValue(true)
    await flushPromises()
    expect(ids(wrapper)).toEqual(['layer1/sw1', 'layer1/sw1/p1', 'layer2/r1', 'layer2/r1/e1'])
    expect(q(wrapper, 'path.support')).toHaveLength(2)
  })

  it('keeps a term-point with its node: the term-point is inside the box of the node', async () => {
    const { wrapper } = await mountView('layer2/r1/e1')
    current = wrapper
    const translate = (el: Element) => {
      const m = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(el.getAttribute('transform') ?? '')
      return { x: Number(m?.[1]), y: Number(m?.[2]) }
    }
    const tp = wrapper.get('g.node.tp[data-id="layer2/r1/e1"]')
    expect(tp.attributes('data-node')).toBe('layer2/r1')
    const box = wrapper.get('g.group[data-id="layer2/r1"]')
    const width = Number(box.get('rect').attributes('width'))
    const [t, b] = [translate(tp.element), translate(box.element)]
    expect(Math.abs(t.x - b.x)).toBeLessThanOrEqual(width / 2)
    expect(Math.abs(t.y - b.y)).toBeLessThan(Number(box.get('rect').attributes('height')) / 2)
  })

  it('shows the node of a term-point as the context (the node itself is not in the tree)', async () => {
    const { wrapper } = await mountView('layer2/r1/e1')
    current = wrapper
    expect(wrapper.get('g.group[data-id="layer2/r1"]').classes()).toContain('context')
  })

  it('shows the tree when the object is selected after the view is shown', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    selection.select('layer2/r1/e1')
    await flushPromises()
    expect(ids(wrapper)).toEqual(['layer1/sw1', 'layer1/sw1/p1', 'layer2/r1', 'layer2/r1/e1'])
  })

  it('loads the layers of the traced objects (even if they are not shown in the topology view)', async () => {
    const { wrapper } = await mountView('layer2/r1', ['layer2'])
    current = wrapper
    expect(mocked.getLayer).toHaveBeenCalledWith('nw', 'ss', 'layer1')
    expect(ids(wrapper)).toEqual(['layer1/sw1', 'layer2/r1'])
  })

  it('says that a link has no dependency tree', async () => {
    const { wrapper } = await mountView('layer1/~link/a')
    current = wrapper
    expect(wrapper.text()).toContain('Links have no dependency tree')
    expect(q(wrapper, 'g.node')).toHaveLength(0)
  })

  it('selects another object by a click (to follow the dependencies)', async () => {
    const { wrapper, selection } = await mountView('layer2/r1')
    current = wrapper
    await wrapper.get('g.node[data-id="layer1/sw1"]').trigger('click')
    await flushPromises()
    expect(selection.selectedId).toBe('layer1/sw1')
    expect(wrapper.get('g.node[data-id="layer1/sw1"]').classes()).toContain('selected')
  })

  it('marks and lists the problems of the shown objects', async () => {
    mocked.getSupports.mockResolvedValue({ etag: 'v1-1', supports: [] })
    // r1 is in the layer which declares the lower layer but nothing supports it
    const { wrapper } = await mountView('layer2/r1')
    current = wrapper
    expect(wrapper.get('g.node[data-id="layer2/r1"]').classes()).toContain('warn')
    const count = wrapper.get('[data-testid=issue-count]')
    expect(count.text()).toMatch(/1 warn/)
    await count.trigger('click')
    expect(wrapper.get('[data-testid=issue-list]').text()).toContain('unsupported')
  })

  it('does not list the problems of the objects which are not shown', async () => {
    // sw2 supports nothing above (a problem), but it is not in the tree of r1
    const { wrapper } = await mountView('layer2/r1')
    current = wrapper
    expect(wrapper.get('[data-testid=issue-count]').text()).toMatch(/0 warn \/ 0 info/)
  })

  it('can hide the marks of the problems', async () => {
    mocked.getSupports.mockResolvedValue({ etag: 'v1-1', supports: [] })
    const { wrapper } = await mountView('layer2/r1')
    current = wrapper
    await wrapper.get('[data-testid=show-issues]').setValue(false)
    expect(wrapper.get('g.node[data-id="layer2/r1"]').classes()).not.toContain('warn')
  })
})
