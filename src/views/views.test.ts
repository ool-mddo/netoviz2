import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { router } from '../router'
import { layer1Data, layer2Data, makeSummary } from '../test/fixtures'
import HomeView from './HomeView.vue'
import TopologyView from './TopologyView.vue'

vi.mock('../api/client')
const mocked = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getSummary.mockResolvedValue(makeSummary({ flags: ['blueprint=b1'] }))
  mocked.getLayer.mockImplementation((_nw, _ss, id) =>
    Promise.resolve(id === 'layer1' ? layer1Data : layer2Data),
  )
})

describe('HomeView', () => {
  it('lists snapshots grouped by network with links', async () => {
    mocked.getIndex.mockResolvedValue([
      { label: 'A (s1)', network: 'a', snapshot: 's1', file: 'topology.json' },
      { label: 'A (s2)', network: 'a', snapshot: 's2', file: 'topology.json' },
      { label: 'B (s1)', network: 'b', snapshot: 's1', file: 'topology.json' },
    ])
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } })
    await flushPromises()
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(['a', 'b'])
    const href = (network: string, snapshot: string) =>
      router.resolve({ name: 'topology', params: { network, snapshot } }).href
    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toEqual([
      href('a', 's1'),
      href('a', 's2'),
      href('b', 's1'),
    ])
  })

  it('shows the error message if the list can not be loaded', async () => {
    mocked.getIndex.mockRejectedValue(new Error('Bad Gateway'))
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Bad Gateway')
  })
})

describe('TopologyView', () => {
  async function mountView(path = '/nw/ss') {
    await router.push(path)
    await router.isReady()
    const wrapper = mount(TopologyView, {
      props: { network: 'nw', snapshot: 'ss' },
      global: { plugins: [createPinia(), router] },
    })
    await flushPromises()
    return wrapper
  }

  it('shows the summary and loads the visible layers (all layers for a small topology)', async () => {
    const wrapper = await mountView()
    expect(wrapper.get('[data-testid=flag]').text()).toBe('blueprint=b1')
    expect(mocked.getLayer).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid=viewer]').text()).toContain('layer1: 2 nodes')
  })

  it('shows only the layers in the URL query', async () => {
    await mountView('/nw/ss?layers=layer1')
    expect(mocked.getLayer).toHaveBeenCalledTimes(1)
    expect(mocked.getLayer).toHaveBeenCalledWith('nw', 'ss', 'layer1')
  })

  it('ignores unknown layers in the URL query', async () => {
    const wrapper = await mountView('/nw/ss?layers=nothing')
    expect(mocked.getLayer).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid=viewer]').exists()).toBe(true)
  })

  it('updates the URL when a layer is toggled', async () => {
    const wrapper = await mountView('/nw/ss?layers=layer1,layer2')
    await wrapper.get('[data-testid=toggle-layer2]').trigger('change')
    await flushPromises()
    expect(router.currentRoute.value.query.layers).toBe('layer1')
  })

  it('shows the error if the snapshot can not be loaded', async () => {
    mocked.getSummary.mockRejectedValue(new Error('Not found: x'))
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Not found: x')
  })
})
