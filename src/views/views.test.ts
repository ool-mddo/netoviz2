import { flushPromises, mount as vueMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { router } from '../router'
import { useSelectionStore } from '../stores/selection'
import { attributesData, layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import HomeView from './HomeView.vue'
import NetworkView from './NetworkView.vue'
import TopologyView from './TopologyView.vue'

vi.mock('../api/client')
const mocked = vi.mocked(api)

// The router is shared. Mounted views react to it, so they are unmounted after each test.
const mounted: Array<{ unmount: () => void }> = []
const mount = ((...args: Parameters<typeof vueMount>) => {
  const wrapper = vueMount(...args)
  mounted.push(wrapper)
  return wrapper
}) as typeof vueMount
afterEach(() => {
  vi.useRealTimers()
  while (mounted.length > 0) mounted.pop()?.unmount()
})

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getSummary.mockResolvedValue(makeSummary({ flags: ['blueprint=b1'] }))
  mocked.getLayer.mockImplementation((_nw, _ss, id) =>
    Promise.resolve(id === 'layer1' ? layer1Data : layer2Data),
  )
  mocked.getProfiles.mockResolvedValue([]) // no profile files (the default source of the schematic layout)
})

const indexEntries = [
  { label: 'A (s1)', network: 'a', snapshot: 's1', file: 'topology.json' },
  { label: 'A (s2)', network: 'a', snapshot: 's2', file: 'topology.json' },
  { label: 'B (s1)', network: 'b', snapshot: 's1', file: 'topology.json' },
]

describe('HomeView', () => {
  it('lists networks with the number of snapshots and links to the snapshot list', async () => {
    mocked.getIndex.mockResolvedValue(indexEntries)
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } })
    await flushPromises()
    const links = wrapper.findAll('[data-testid=network-link]')
    expect(links.map((a) => a.text())).toEqual(['a', 'b'])
    expect(links.map((a) => a.attributes('href'))).toEqual([
      router.resolve({ name: 'network', params: { network: 'a' } }).href,
      router.resolve({ name: 'network', params: { network: 'b' } }).href,
    ])
    expect(wrapper.text()).toContain('2 snapshots')
    expect(wrapper.text()).toContain('1 snapshots')
  })

  it('shows the error message if the list can not be loaded', async () => {
    mocked.getIndex.mockRejectedValue(new Error('Bad Gateway'))
    const wrapper = mount(HomeView, { global: { plugins: [createPinia(), router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Bad Gateway')
  })
})

describe('NetworkView', () => {
  it('lists the snapshots of the network with links to the viewer', async () => {
    mocked.getIndex.mockResolvedValue(indexEntries)
    const wrapper = mount(NetworkView, {
      props: { network: 'a' },
      global: { plugins: [createPinia(), router] },
    })
    await flushPromises()
    const links = wrapper.findAll('[data-testid=snapshot-link]')
    expect(links.map((a) => a.text())).toEqual(['s1', 's2'])
    expect(links[0]?.attributes('href')).toBe(
      router.resolve({ name: 'topology', params: { network: 'a', snapshot: 's1' } }).href,
    )
    expect(wrapper.text()).toContain('A (s2)')
  })

  it('tells that there is no snapshot for an unknown network', async () => {
    mocked.getIndex.mockResolvedValue(indexEntries)
    const wrapper = mount(NetworkView, {
      props: { network: 'zzz' },
      global: { plugins: [createPinia(), router] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No snapshot')
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
    expect(wrapper.find('[data-testid=force-svg]').exists()).toBe(true)
  })

  it('shows only the layers in the URL query', async () => {
    await mountView('/nw/ss?layers=layer1')
    expect(mocked.getLayer).toHaveBeenCalledTimes(1)
    expect(mocked.getLayer).toHaveBeenCalledWith('nw', 'ss', 'layer1')
  })

  it('shows all the layers by the button (select all)', async () => {
    const wrapper = await mountView('/nw/ss?layers=layer1')
    await wrapper.get('[data-testid=select-all]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.layers).toBe('layer1,layer2')
    expect(mocked.getLayer).toHaveBeenCalledWith('nw', 'ss', 'layer2')
  })

  it('clears all the layers by the button, and then one layer can be chosen', async () => {
    const wrapper = await mountView('/nw/ss')
    await wrapper.get('[data-testid=select-none]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.layers).toBe('')
    expect(wrapper.findAll('g.node')).toHaveLength(0)
    await wrapper.get('[data-testid=toggle-layer2]').trigger('change')
    await flushPromises()
    expect(router.currentRoute.value.query.layers).toBe('layer2')
    expect(wrapper.findAll('g.node:not(.tp)')).toHaveLength(1)
  })

  it('collapses the layer list, and keeps the choice in the browser', async () => {
    localStorage.removeItem('netoviz2.sideCollapsed')
    const wrapper = await mountView('/nw/ss')
    expect(wrapper.find('[data-testid=select-all]').exists()).toBe(true)
    await wrapper.get('[data-testid=side-toggle]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid=select-all]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=layer-dots]').exists()).toBe(true)
    expect(localStorage.getItem('netoviz2.sideCollapsed')).toBe('1')
    await wrapper.get('[data-testid=side-toggle]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid=select-all]').exists()).toBe(true)
    expect(localStorage.getItem('netoviz2.sideCollapsed')).toBeNull()
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

  it('selects the object in the URL query (?sel=) and loads its attributes', async () => {
    mocked.getSupports.mockResolvedValue(supportsData)
    mocked.getAttributes.mockResolvedValue(attributesData)
    await mountView('/nw/ss?sel=layer2%2Fr1')
    expect(useSelectionStore().selectedId).toBe('layer2/r1')
    expect(mocked.getAttributes).toHaveBeenCalledWith('nw', 'ss', ['layer2/r1'])
  })

  it('puts the selected object into the URL query and removes it when cleared', async () => {
    mocked.getSupports.mockResolvedValue(supportsData)
    mocked.getAttributes.mockResolvedValue(attributesData)
    await mountView('/nw/ss')
    const selection = useSelectionStore()
    selection.select('layer2/r1')
    await flushPromises()
    expect(router.currentRoute.value.query.sel).toBe('layer2/r1')
    selection.select(null)
    await flushPromises()
    expect(router.currentRoute.value.query.sel).toBeUndefined()
  })

  describe('auto reload', () => {
    async function mountWithTimers(path: string) {
      await router.push(path)
      await router.isReady()
      vi.useFakeTimers()
      const wrapper = mount(TopologyView, {
        props: { network: 'nw', snapshot: 'ss' },
        global: { plugins: [createPinia(), router] },
      })
      await flushPromises()
      return wrapper
    }

    it('does not reload the layers when the topology is not updated', async () => {
      await mountWithTimers('/nw/ss?layers=layer1')
      mocked.getSummary.mockResolvedValue(null)
      await vi.advanceTimersByTimeAsync(5000)
      expect(mocked.getSummary).toHaveBeenLastCalledWith('nw', 'ss', 'v1-1')
      expect(mocked.getLayer).toHaveBeenCalledTimes(1)
    })

    it('reloads the layers and the attributes of the selected object when the topology is updated', async () => {
      mocked.getSupports.mockResolvedValue(supportsData)
      mocked.getAttributes.mockResolvedValue(attributesData)
      await mountWithTimers('/nw/ss?layers=layer1,layer2&sel=layer2%2Fr1')
      expect(mocked.getAttributes).toHaveBeenCalledTimes(1)
      mocked.getSummary.mockResolvedValue(makeSummary({ etag: 'v1-2' }))
      await vi.advanceTimersByTimeAsync(5000)
      expect(mocked.getLayer).toHaveBeenCalledTimes(4)
      expect(mocked.getAttributes).toHaveBeenCalledTimes(2)
    })
  })

  describe('layout engines', () => {
    const svgCount = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[data-testid=force-svg]').length
    const selected = (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll('[data-testid=layout-select]').map((s) => (s.element as HTMLSelectElement).value)

    it('shows one view with the stress layout by default', async () => {
      const wrapper = await mountView('/nw/ss')
      expect(svgCount(wrapper)).toBe(1)
      expect(selected(wrapper)).toEqual(['stress'])
    })

    it('uses the engine in the URL query (?layout=)', async () => {
      const wrapper = await mountView('/nw/ss?layout=force')
      expect(selected(wrapper)).toEqual(['force'])
    })

    it('uses the schematic engine in the URL query', async () => {
      const wrapper = await mountView('/nw/ss?layout=schematic')
      expect(selected(wrapper)).toEqual(['schematic'])
    })

    it('passes the profile in the URL query (?profile=) to the view: a profile which is not found is told', async () => {
      mocked.getSupports.mockResolvedValue(supportsData) // the schematic layout loads the supports
      const wrapper = await mountView('/nw/ss?layout=schematic&profile=nothing')
      await vi.waitFor(() =>
        expect(wrapper.get('[data-testid=profile-error]').text()).toContain("profile 'nothing' is not found"),
      )
    })

    it('ignores an unknown engine in the URL query (e.g. an engine which was removed)', async () => {
      const wrapper = await mountView('/nw/ss?layout=elk-stress&compare=elk-layered')
      expect(selected(wrapper)).toEqual(['stress'])
      expect(svgCount(wrapper)).toBe(1)
    })

    it('puts the changed engine into the URL (the default engine is not put)', async () => {
      const wrapper = await mountView('/nw/ss')
      await wrapper.get('[data-testid=layout-select]').setValue('force')
      await flushPromises()
      expect(router.currentRoute.value.query.layout).toBe('force')
      await wrapper.get('[data-testid=layout-select]').setValue('stress')
      await flushPromises()
      expect(router.currentRoute.value.query.layout).toBeUndefined()
    })
  })

  describe('dependency view', () => {
    const depCount = (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll('[data-testid=dependency-view]').length

    it('is hidden by default', async () => {
      const wrapper = await mountView('/nw/ss')
      expect(depCount(wrapper)).toBe(0)
    })

    it('is shown next to the topology view with ?dependency=1', async () => {
      const wrapper = await mountView('/nw/ss?dependency=1')
      expect(depCount(wrapper)).toBe(1)
      expect(wrapper.findAll('[data-testid=force-svg]')).toHaveLength(1)
    })

    it('is toggled with the toolbar (and the URL)', async () => {
      const wrapper = await mountView('/nw/ss')
      await wrapper.get('[data-testid=dependency]').setValue(true)
      await flushPromises()
      expect(router.currentRoute.value.query.dependency).toBe('1')
      expect(depCount(wrapper)).toBe(1)
      await wrapper.get('[data-testid=dependency]').setValue(false)
      await flushPromises()
      expect(router.currentRoute.value.query.dependency).toBeUndefined()
      expect(depCount(wrapper)).toBe(0)
    })

    it('shows the supports of the object selected in the topology view', async () => {
      mocked.getSupports.mockResolvedValue(supportsData)
      mocked.getAttributes.mockResolvedValue(attributesData)
      const wrapper = await mountView('/nw/ss?layers=layer1,layer2&dependency=1&sel=layer2%2Fr1')
      await flushPromises()
      expect(wrapper.findAll('[data-testid=dependency-svg] g.node')).toHaveLength(2)
      expect(wrapper.findAll('g.node.selected[data-id="layer2/r1"]').length).toBeGreaterThanOrEqual(2)
    })
  })

  it('shows the error if the snapshot can not be loaded', async () => {
    mocked.getSummary.mockRejectedValue(new Error('Not found: x'))
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Not found: x')
  })
})
