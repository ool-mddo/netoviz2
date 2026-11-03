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

async function mountView(loadedLayers = ['layer1', 'layer2']) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const topology = useTopologyStore()
  await topology.open('nw', 'ss')
  await Promise.all(loadedLayers.map((id) => topology.loadLayer(id)))
  const wrapper = mount(DependencyView, {
    props: { visibleLayers: ['layer1', 'layer2'] },
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, topology, selection: useSelectionStore() }
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

describe('DependencyView', () => {
  it('draws a band for each layer and the nodes in the bands', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    expect(q(wrapper, 'g.band')).toHaveLength(2)
    expect(q(wrapper, 'g.node')).toHaveLength(3)
  })

  it('draws the supports between nodes (node supports and term-point supports are one line)', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    const lines = q(wrapper, 'line.support')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.getAttribute('data-from')).toBe('layer2/r1')
    expect(lines[0]?.getAttribute('data-to')).toBe('layer1/sw1')
  })

  it('puts the upper layer above the lower layer', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    const y = (id: string) => {
      const t = (wrapper.element.querySelector(`g.node[data-id="${id}"]`) as SVGGElement).getAttribute(
        'transform',
      )
      return Number(/,(-?[\d.]+)\)/.exec(t ?? '')?.[1])
    }
    expect(y('layer2/r1')).toBeLessThan(y('layer1/sw1'))
  })

  it('waits for the layers and the supports (no problem is reported before that)', async () => {
    const { wrapper } = await mountView(['layer1'])
    current = wrapper
    expect(q(wrapper, 'g.node')).toHaveLength(0)
    expect(wrapper.find('[data-testid=issue-count]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Loading')
  })

  it('selects a node by a click and highlights the trace', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    await wrapper.get('g.node[data-id="layer2/r1"]').trigger('click')
    await flushPromises()
    expect(selection.selectedId).toBe('layer2/r1')
    expect(q(wrapper, 'g.node.selected')).toHaveLength(1)
    expect(q(wrapper, 'g.node.traced').length).toBe(2)
    expect(q(wrapper, 'line.support.traced')).toHaveLength(1)
    // sw2 is not related to the selected node
    expect(wrapper.get('g.node[data-id="layer1/sw2"]').classes()).toContain('dim')
  })

  it('marks the problems and lists them (sw2 supports nothing above)', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    expect(wrapper.get('g.node[data-id="layer1/sw2"]').classes()).toContain('info')
    const count = wrapper.get('[data-testid=issue-count]')
    expect(count.text()).toMatch(/0 warn \/ 1 info/)
    await count.trigger('click')
    expect(wrapper.get('[data-testid=issue-list]').text()).toContain('unused')
  })

  it('can hide the marks of the problems', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    await wrapper.get('[data-testid=show-issues]').setValue(false)
    expect(wrapper.get('g.node[data-id="layer1/sw2"]').classes()).not.toContain('info')
  })

  it('selects the node of an issue from the list', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    await wrapper.get('[data-testid=issue-count]').trigger('click')
    await wrapper.get('[data-testid=issue-list] button').trigger('click')
    await flushPromises()
    expect(selection.selectedId).toBe('layer1/sw2')
  })

  it('tells the change of the view', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    await wrapper.get('[data-testid=layout-select]').setValue('force')
    expect(wrapper.emitted('update:view')?.[0]).toEqual(['force'])
  })
})
