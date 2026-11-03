import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'
import { attributesData, layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import ForceView from './ForceView.vue'

vi.mock('../api/client')
const mocked = vi.mocked(api)

async function mountView(visibleLayers = ['layer1', 'layer2'], loadedLayers = visibleLayers) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const topology = useTopologyStore()
  await topology.open('nw', 'ss')
  await Promise.all(loadedLayers.map((id) => topology.loadLayer(id)))
  await topology.ensureSupports()
  const wrapper = mount(ForceView, {
    props: { visibleLayers, engine: 'force' as const },
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, topology, selection: useSelectionStore(), view: useViewStore() }
}

const nodeEl = (wrapper: ReturnType<typeof mount>, id: string) =>
  wrapper.element.querySelector(`g.node[data-id="${id}"]`) as SVGGElement

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

describe('ForceView', () => {
  const count = (wrapper: ReturnType<typeof mount>, selector: string) =>
    wrapper.element.querySelectorAll(selector).length

  it('draws the nodes and the term-points of the visible layers', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    expect(count(wrapper, 'g.node:not(.tp)')).toBe(3)
    expect(count(wrapper, 'g.node.tp')).toBe(4)
  })

  it('arranges the nodes after all the visible layers are loaded (not for each layer)', async () => {
    const { wrapper, topology } = await mountView(['layer1', 'layer2'], ['layer1'])
    current = wrapper
    expect(count(wrapper, 'g.node')).toBe(0)
    await topology.loadLayer('layer2')
    await flushPromises()
    expect(count(wrapper, 'g.node')).toBe(7)
  })

  it('draws only the visible layers', async () => {
    const { wrapper } = await mountView(['layer2'])
    current = wrapper
    expect(count(wrapper, 'g.node')).toBe(2)
  })

  it('updates the drawing when a layer is shown', async () => {
    const { wrapper } = await mountView(['layer2'], ['layer1', 'layer2'])
    current = wrapper
    await wrapper.setProps({ visibleLayers: ['layer1', 'layer2'] })
    expect(count(wrapper, 'g.node')).toBe(7)
  })

  it('highlights the selected node and the objects traced by supports', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    selection.select('layer2/r1')
    await flushPromises()
    expect(nodeEl(wrapper, 'layer2/r1').classList.contains('selected')).toBe(true)
    expect(nodeEl(wrapper, 'layer1/sw1').classList.contains('traced')).toBe(true)
    expect(nodeEl(wrapper, 'layer1/sw1/p1').classList.contains('traced')).toBe(true)
    expect(nodeEl(wrapper, 'layer1/sw2').classList.contains('dim')).toBe(true)
    // the support of the node and the support of its term-point
    expect(count(wrapper, 'line.trace-edge')).toBe(2)
  })

  it('does not trace when the trace mode is off', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    selection.select('layer2/r1')
    selection.traceMode = 'off'
    await flushPromises()
    expect(count(wrapper, 'g.node.traced, g.node.dim')).toBe(0)
  })

  it('highlights the selected term-point itself, and shows it as its node when term-points are hidden', async () => {
    const { wrapper, selection, view } = await mountView()
    current = wrapper
    selection.select('layer1/sw1/p1')
    await flushPromises()
    expect(nodeEl(wrapper, 'layer1/sw1/p1').classList.contains('selected')).toBe(true)
    view.setShowPorts(false)
    await flushPromises()
    expect(count(wrapper, 'g.node.tp')).toBe(0)
    expect(nodeEl(wrapper, 'layer1/sw1').classList.contains('selected')).toBe(true)
  })

  it('hides the term-points of one node by double click (and shows them again)', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    nodeEl(wrapper, 'layer1/sw1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flushPromises()
    expect(count(wrapper, 'g.node.tp')).toBe(2) // sw1 has 2 of the 4
    nodeEl(wrapper, 'layer1/sw1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flushPromises()
    expect(count(wrapper, 'g.node.tp')).toBe(4)
  })

  it('selects by click and loads the attributes of the object', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    nodeEl(wrapper, 'layer2/r1').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(selection.selectedId).toBe('layer2/r1')
    expect(mocked.getAttributes).toHaveBeenCalledWith('nw', 'ss', ['layer2/r1'])
  })

  it('selects a term-point by click and loads its attributes', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    nodeEl(wrapper, 'layer1/sw1/p2').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(selection.selectedId).toBe('layer1/sw1/p2')
    expect(mocked.getAttributes).toHaveBeenCalledWith('nw', 'ss', ['layer1/sw1/p2'])
  })

  it('clears the selection by a click on the background', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    selection.select('layer2/r1')
    wrapper.element.querySelector('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(selection.selectedId).toBeNull()
  })

  it('loads the layers of the objects reached through supports when an object is selected', async () => {
    const { wrapper, topology } = await mountView(['layer2'], ['layer2'])
    current = wrapper
    nodeEl(wrapper, 'layer2/r1').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(topology.layerData['layer1']).toBeDefined()
    // the layer is loaded only for names: it is not drawn (not visible)
    expect(wrapper.element.querySelectorAll('g.node:not(.tp)')).toHaveLength(1)
  })

  describe('layout engine', () => {
    it('has a selector of the engines (the current one is selected) and tells the change', async () => {
      const { wrapper } = await mountView()
      current = wrapper
      const select = wrapper.get('[data-testid=layout-select]')
      expect((select.element as HTMLSelectElement).value).toBe('force')
      expect(select.findAll('option').map((o) => o.attributes('value'))).toEqual([
        'force',
        'stress',
        'dependency',
      ])
      await select.setValue('stress')
      expect(wrapper.emitted('update:view')?.[0]).toEqual(['stress'])
    })

    it('shows the quality of the layout (time, crossings, overlaps)', async () => {
      const { wrapper } = await mountView()
      current = wrapper
      const text = wrapper.get('[data-testid=layout-stats]').text()
      expect(text).toMatch(/\d+ ms \/ crossings \d+ \/ overlap [\d.]+ \/ 3 nodes, 1 links/)
      expect(wrapper.get('[data-testid=layout-stats]').attributes('data-engine')).toBe('force')
    })

    it('arranges again with the new engine when the engine is changed', async () => {
      const { wrapper } = await mountView()
      current = wrapper
      await wrapper.setProps({ engine: 'stress' })
      await vi.waitFor(() =>
        expect(wrapper.get('[data-testid=layout-stats]').attributes('data-engine')).toBe('stress'),
      )
      expect(count(wrapper, 'g.node:not(.tp)')).toBe(3)
    })
  })
})
