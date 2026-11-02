import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { PORTS_AUTO_LIMIT, useViewStore } from '../stores/view'
import { layer1Data } from '../test/fixtures'
import ViewToolbar from './ViewToolbar.vue'

function setup(compare = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const topology = useTopologyStore()
  topology.layerData = { layer1: layer1Data }
  const wrapper = mount(ViewToolbar, {
    props: { visibleLayers: ['layer1'], compare },
    global: { plugins: [pinia] },
  })
  return { wrapper, topology, view: useViewStore(), selection: useSelectionStore() }
}
const box = (wrapper: ReturnType<typeof mount>, id: string) =>
  wrapper.get(`[data-testid=${id}]`).element as HTMLInputElement

beforeEach(() => setActivePinia(createPinia()))

describe('ViewToolbar', () => {
  it('has the term-points checked for a small topology and changes the setting of all nodes', async () => {
    const { wrapper, view } = setup()
    expect(box(wrapper, 'show-ports').checked).toBe(true)
    await wrapper.get('[data-testid=show-ports]').setValue(false)
    expect(view.showPorts).toBe(false)
    expect(box(wrapper, 'show-ports').checked).toBe(false)
  })

  it('has the term-points unchecked for a large topology', () => {
    const { wrapper, topology } = setup()
    const many = {
      ...layer1Data,
      tps: Array.from({ length: PORTS_AUTO_LIMIT + 1 }, (_, i) => ({
        id: `t${i}`,
        node: 'layer1/sw1',
        name: `t${i}`,
      })),
    }
    topology.layerData = { layer1: many }
    return wrapper.vm.$nextTick().then(() => expect(box(wrapper, 'show-ports').checked).toBe(false))
  })

  it('changes the trace mode', async () => {
    const { wrapper, selection } = setup()
    await wrapper.get('[data-testid=trace-mode]').setValue('lower')
    expect(selection.traceMode).toBe('lower')
  })

  it('tells the change of the comparison', async () => {
    const { wrapper } = setup()
    expect(box(wrapper, 'compare').checked).toBe(false)
    await wrapper.get('[data-testid=compare]').setValue(true)
    expect(wrapper.emitted('update:compare')?.[0]).toEqual([true])
  })

  it('shows the comparison as on', () => {
    expect(box(setup(true).wrapper, 'compare').checked).toBe(true)
  })
})
