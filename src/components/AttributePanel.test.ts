import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { attributesData, layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import AttributePanel from './AttributePanel.vue'

vi.mock('../api/client')
const mocked = vi.mocked(api)

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const topology = useTopologyStore()
  await topology.open('nw', 'ss')
  await Promise.all([topology.loadLayer('layer1'), topology.loadLayer('layer2'), topology.ensureSupports()])
  const wrapper = mount(AttributePanel, { global: { plugins: [pinia] } })
  return { wrapper, topology, selection: useSelectionStore() }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getSummary.mockResolvedValue(makeSummary())
  mocked.getLayer.mockImplementation((_nw, _ss, id) =>
    Promise.resolve(id === 'layer1' ? layer1Data : layer2Data),
  )
  mocked.getSupports.mockResolvedValue(supportsData)
  mocked.getAttributes.mockResolvedValue(attributesData)
})

describe('AttributePanel', () => {
  it('asks to select an object when nothing is selected', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('[data-testid=panel-empty]').exists()).toBe(true)
  })

  it('shows the object, its attributes and the lower layers (supports)', async () => {
    const { wrapper, topology, selection } = await setup()
    selection.select('layer2/r1')
    await topology.loadAttributes(['layer2/r1'])
    await flushPromises()
    expect(wrapper.get('[data-testid=panel-name]').text()).toBe('r1')
    expect(wrapper.text()).toContain('x:attr')
    expect(wrapper.text()).toContain('a')
    const trace = wrapper.get('[data-testid=panel-trace]').text()
    expect(trace).toContain('sw1')
    expect(trace).toContain('p1') // term-point of the node is traced together
  })

  it('shows the loading state until the attributes are loaded', async () => {
    const { wrapper, selection } = await setup()
    selection.select('layer2/r1')
    await flushPromises()
    expect(wrapper.find('[data-testid=panel-loading]').exists()).toBe(true)
  })

  it('shows the upper layers for a lower object', async () => {
    const { wrapper, selection } = await setup()
    selection.select('layer1/sw1')
    await flushPromises()
    const trace = wrapper.get('[data-testid=panel-trace]').text()
    expect(trace).toContain('Upper layers')
    expect(trace).toContain('r1')
  })

  it('selects the object by a click on a traced item and loads its attributes', async () => {
    const { wrapper, selection } = await setup()
    selection.select('layer2/r1')
    await flushPromises()
    await wrapper.findAll('[data-testid=trace-item]')[0]?.trigger('click')
    await flushPromises()
    expect(selection.selectedId).toBe('layer1/sw1')
    expect(mocked.getAttributes).toHaveBeenCalledWith('nw', 'ss', ['layer1/sw1'])
  })

  it('does not list supports when the trace is off', async () => {
    const { wrapper, selection } = await setup()
    selection.select('layer2/r1')
    selection.traceMode = 'off'
    await flushPromises()
    expect(wrapper.get('[data-testid=panel-trace]').text()).toContain('trace is off')
  })

  it('clears the selection with the close button', async () => {
    const { wrapper, selection } = await setup()
    selection.select('layer2/r1')
    await flushPromises()
    await wrapper.get('[data-testid=panel-close]').trigger('click')
    expect(selection.selectedId).toBeNull()
  })

  it('shows the diff label of the selected object', async () => {
    const { wrapper, topology, selection } = await setup()
    topology.layerData = {
      ...topology.layerData,
      layer2: { ...layer2Data, nodes: [{ id: 'layer2/r1', name: 'r1', tp_count: 1, diff: 'changed' }] },
    }
    selection.select('layer2/r1')
    await flushPromises()
    expect(wrapper.get('[data-testid=panel-diff]').text()).toBe('changed')
  })
})
