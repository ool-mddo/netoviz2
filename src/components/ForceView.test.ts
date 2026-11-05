import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'
import { attributesData, layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import { profileSourceOf } from '../render/layout/schematic/profileSource'
import ForceView from './ForceView.vue'

vi.mock('../api/client')
const mocked = vi.mocked(api)

async function mountView(
  visibleLayers = ['layer1', 'layer2'],
  loadedLayers = visibleLayers,
  extraProps: Record<string, unknown> = {},
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const topology = useTopologyStore()
  await topology.open('nw', 'ss')
  await Promise.all(loadedLayers.map((id) => topology.loadLayer(id)))
  await topology.ensureSupports()
  const wrapper = mount(ForceView, {
    props: { visibleLayers, engine: 'force' as const, ...extraProps },
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
        'schematic',
      ])
      await select.setValue('stress')
      expect(wrapper.emitted('update:engine')?.[0]).toEqual(['stress'])
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

  describe('report of the schematic layout', () => {
    it('shows what the layers were made from when the engine is schematic (here: no profile can be inferred)', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, { engine: 'schematic' })
      current = wrapper
      await vi.waitFor(() => expect(wrapper.find('[data-testid=schematic-report]').exists()).toBe(true))
      expect(wrapper.findAll('[data-testid=report-source]').map((e) => e.text())).toEqual([
        'no profile (stress layout)',
        'no profile (stress layout)',
      ])
    })

    it('does not show it for the other engines, nor after the engine is changed to them', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, { engine: 'schematic' })
      current = wrapper
      await vi.waitFor(() => expect(wrapper.find('[data-testid=schematic-report]').exists()).toBe(true))
      await wrapper.setProps({ engine: 'stress' })
      expect(wrapper.find('[data-testid=schematic-report]').exists()).toBe(false)
      const other = await mountView()
      expect(other.wrapper.find('[data-testid=schematic-report]').exists()).toBe(false)
      other.wrapper.unmount()
    })
  })

  describe('diagram profile', () => {
    const profileSource = profileSourceOf({
      'ok.yaml': () => Promise.resolve('view: v\ntarget: { layer: layer1 }\n'),
      'warn.yaml': () => Promise.resolve('view: v\naxes: {}\n'),
      'broken.yaml': () => Promise.resolve('view: [\n'),
    })
    const errorText = (wrapper: ReturnType<typeof mount>) =>
      wrapper.find('[data-testid=profile-error]').text()

    it('shows no message when the profile is loaded', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'ok',
        profileSource,
      })
      current = wrapper
      await flushPromises()
      expect(wrapper.find('[data-testid=profile-error]').exists()).toBe(false)
    })

    it('tells that the profile is not found or invalid (the layout works without the profile)', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'nothing',
        profileSource,
      })
      current = wrapper
      await flushPromises()
      expect(errorText(wrapper)).toContain("profile 'nothing' is not found")
      await wrapper.setProps({ profile: 'broken' })
      await flushPromises()
      expect(errorText(wrapper)).toContain("profile 'broken'")
      expect(count(wrapper, 'g.node:not(.tp)')).toBe(3)
    })

    /** Source whose loading is finished by the test */
    const deferredSource = () => {
      const resolvers = new Map<string, (text: string | undefined) => void>()
      const source = (name: string) =>
        new Promise<string | undefined>((resolve) => resolvers.set(name, resolve))
      return { source, resolve: (name: string, text?: string) => resolvers.get(name)?.(text) }
    }

    it('waits for the profile to arrange the nodes (the schematic layout is made once, with the profile)', async () => {
      const { source, resolve } = deferredSource()
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'ok',
        profileSource: source,
      })
      current = wrapper
      expect(count(wrapper, 'g.node:not(.tp)')).toBe(0)
      resolve('ok', 'view: v\n')
      await flushPromises()
      await vi.waitFor(() => expect(count(wrapper, 'g.node:not(.tp)')).toBe(3))
    })

    it('arranges even when the profile is not found (without the profile)', async () => {
      const { source, resolve } = deferredSource()
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'nothing',
        profileSource: source,
      })
      current = wrapper
      resolve('nothing', undefined)
      await flushPromises()
      await vi.waitFor(() => expect(count(wrapper, 'g.node:not(.tp)')).toBe(3))
    })

    it('ignores the result of an old profile (a profile which is loaded later than the newer one)', async () => {
      const { source, resolve } = deferredSource()
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'a',
        profileSource: source,
      })
      current = wrapper
      await wrapper.setProps({ profile: 'b' })
      resolve('b', 'view: b\n')
      await flushPromises()
      resolve('a', 'view: a\naxes: {}\n') // with a warning, if it were used
      await flushPromises()
      expect(wrapper.find('[data-testid=profile-error]').exists()).toBe(false)
    })

    it('does not use the result of a profile after it is unmounted', async () => {
      const { source, resolve } = deferredSource()
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'a',
        profileSource: source,
      })
      wrapper.unmount()
      resolve('a', 'view: a\n')
      await flushPromises() // no error
    })

    it('tells the warnings of the profile, and clears the message when the profile is removed', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'warn',
        profileSource,
      })
      current = wrapper
      await flushPromises()
      expect(errorText(wrapper)).toContain("unknown key 'axes'")
      await wrapper.setProps({ profile: undefined })
      await flushPromises()
      expect(wrapper.find('[data-testid=profile-error]').exists()).toBe(false)
    })
  })
})
