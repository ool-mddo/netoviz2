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
    props: { visibleLayers },
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
  it('draws the nodes of the visible layers', async () => {
    const { wrapper } = await mountView()
    current = wrapper
    expect(wrapper.element.querySelectorAll('g.node')).toHaveLength(3)
  })

  it('draws only the visible layers', async () => {
    const { wrapper } = await mountView(['layer2'])
    current = wrapper
    expect(wrapper.element.querySelectorAll('g.node')).toHaveLength(1)
  })

  it('updates the drawing when a layer is shown', async () => {
    const { wrapper } = await mountView(['layer2'], ['layer1', 'layer2'])
    current = wrapper
    await wrapper.setProps({ visibleLayers: ['layer1', 'layer2'] })
    expect(wrapper.element.querySelectorAll('g.node')).toHaveLength(3)
  })

  it('highlights the selected node and the nodes traced by supports', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    selection.select('layer2/r1')
    await flushPromises()
    expect(nodeEl(wrapper, 'layer2/r1').classList.contains('selected')).toBe(true)
    expect(nodeEl(wrapper, 'layer1/sw1').classList.contains('traced')).toBe(true)
    expect(nodeEl(wrapper, 'layer1/sw2').classList.contains('dim')).toBe(true)
    expect(wrapper.element.querySelectorAll('line.trace-edge')).toHaveLength(1)
  })

  it('does not trace when the trace mode is off', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    selection.select('layer2/r1')
    await wrapper.get('[data-testid=trace-mode]').setValue('off')
    expect(selection.traceMode).toBe('off')
    expect(wrapper.element.querySelectorAll('g.node.traced, g.node.dim')).toHaveLength(0)
  })

  it('shows the term-points of an expanded node and maps a selected term-point to them', async () => {
    const { wrapper, selection, view } = await mountView()
    current = wrapper
    selection.select('layer1/sw1/p1')
    await flushPromises()
    // the term-point is shown as its node while the node is collapsed
    expect(nodeEl(wrapper, 'layer1/sw1').classList.contains('selected')).toBe(true)
    view.toggleExpand('layer1/sw1')
    await flushPromises()
    expect(wrapper.element.querySelectorAll('g.node')).toHaveLength(5)
    expect(nodeEl(wrapper, 'layer1/sw1/p1').classList.contains('selected')).toBe(true)
    view.collapseAll()
    await flushPromises()
    expect(wrapper.element.querySelectorAll('g.node')).toHaveLength(3)
  })

  it('selects by click and loads the attributes of the object', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    nodeEl(wrapper, 'layer2/r1').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(selection.selectedId).toBe('layer2/r1')
    expect(mocked.getAttributes).toHaveBeenCalledWith('nw', 'ss', ['layer2/r1'])
  })

  it('clears the selection by a click on the background', async () => {
    const { wrapper, selection } = await mountView()
    current = wrapper
    selection.select('layer2/r1')
    wrapper.element.querySelector('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(selection.selectedId).toBeNull()
  })

  it('expands a node by double click', async () => {
    const { wrapper, view } = await mountView()
    current = wrapper
    nodeEl(wrapper, 'layer1/sw1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flushPromises()
    expect(view.expandedNodes.has('layer1/sw1')).toBe(true)
  })

  it('loads the layers of the objects reached through supports when an object is selected', async () => {
    const { wrapper, topology } = await mountView(['layer2'], ['layer2'])
    current = wrapper
    nodeEl(wrapper, 'layer2/r1').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(topology.layerData['layer1']).toBeDefined()
    // the layer is loaded only for names: it is not drawn (not visible)
    expect(wrapper.element.querySelectorAll('g.node')).toHaveLength(1)
  })
})
