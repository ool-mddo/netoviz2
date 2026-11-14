import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'
import { attributesData, layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import type { ProfileFile } from '../api/types'
import type { ProfileSource } from '../render/layout/schematic/profileSource'
import { profileSourceOf } from '../test/profileSource'
import { yamlDocuments } from '../test/profileYaml'
import { layoutSchematic } from '../render/layout/schematic'
import ForceView from './ForceView.vue'

vi.mock('../api/client')
// the schematic layout is the real one, with the calls recorded
vi.mock('../render/layout/schematic', async (importOriginal) => {
  const original = await importOriginal<typeof import('../render/layout/schematic')>()
  return { ...original, layoutSchematic: vi.fn(original.layoutSchematic) }
})
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
  mocked.getProfiles.mockResolvedValue([]) // no profile files (the default source of the schematic layout)
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

    it('tells how to move a row / a column only for the schematic layout', async () => {
      const { wrapper } = await mountView()
      current = wrapper
      expect(wrapper.find('[data-testid=drag-hint]').exists()).toBe(false)
      await wrapper.setProps({ engine: 'schematic' })
      expect(wrapper.get('[data-testid=drag-hint]').text()).toMatch(/Shift\+drag.*row.*Ctrl.*column/)
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

  describe('lower layers of the schematic layout', () => {
    it('loads the lower layer which the visible layer reaches by the supports (layer2 -> layer1), only for schematic', async () => {
      mocked.getLayer.mockClear()
      const { wrapper } = await mountView(['layer2'], ['layer2'], { engine: 'schematic' })
      current = wrapper
      await vi.waitFor(() => expect(count(wrapper, 'g.node:not(.tp)')).toBe(1))
      expect(mocked.getLayer).toHaveBeenCalledWith('nw', 'ss', 'layer1')
      expect(wrapper.findAll('[data-testid=report-source]').map((e) => e.text())).toEqual([
        'no profile (stress layout)', // layer1 has only two nodes and no profile: nothing to inherit
      ])
    })

    // the profile of the lower layer (layer1): all the nodes of it are given a tier, so layer2 can inherit
    const baseProfile = profileSourceOf({
      'base.yaml': () =>
        Promise.resolve(
          "view: v\ntarget: { layer: layer1 }\ntiers: [t]\nrules:\n  - { select: '*', tier: t }\n",
        ),
    })

    it('arranges once with the lower layer when the engine is changed to schematic, and tells it inherits', async () => {
      const { wrapper } = await mountView(['layer2'], ['layer2'], {
        profile: 'base',
        profileSource: baseProfile,
      })
      current = wrapper
      vi.mocked(layoutSchematic).mockClear()
      await wrapper.setProps({ engine: 'schematic' })
      await vi.waitFor(() => expect(wrapper.find('[data-testid=report-source]').exists()).toBe(true))
      await flushPromises()
      expect(layoutSchematic).toHaveBeenCalledTimes(1)
      expect(vi.mocked(layoutSchematic).mock.calls[0]?.[0].bases?.map((b) => b.layer)).toEqual(['layer1'])
      expect(wrapper.get('[data-testid=report-source]').text()).toBe(
        'inherited from layer1 (profile base #1 (named))',
      )
    })

    it('arranges once with the lower layer when the view is opened with the schematic engine', async () => {
      vi.mocked(layoutSchematic).mockClear()
      const { wrapper } = await mountView(['layer2'], ['layer2'], {
        engine: 'schematic',
        profile: 'base',
        profileSource: baseProfile,
      })
      current = wrapper
      await vi.waitFor(() => expect(wrapper.find('[data-testid=report-source]').exists()).toBe(true))
      await flushPromises()
      expect(layoutSchematic).toHaveBeenCalledTimes(1)
      expect(wrapper.get('[data-testid=report-source]').text()).toBe(
        'inherited from layer1 (profile base #1 (named))',
      )
    })

    it('arranges even if the lower layer cannot be loaded (without it)', async () => {
      mocked.getLayer.mockImplementation((_nw, _ss, id) =>
        id === 'layer1' ? Promise.reject(new Error('down')) : Promise.resolve(layer2Data),
      )
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { wrapper } = await mountView(['layer2'], ['layer2'], { engine: 'schematic' })
      current = wrapper
      await vi.waitFor(() => expect(count(wrapper, 'g.node:not(.tp)')).toBe(1))
      warn.mockRestore()
    })

    it('does not load them for the other engines', async () => {
      mocked.getLayer.mockClear()
      const { wrapper } = await mountView(['layer2'], ['layer2'])
      current = wrapper
      await flushPromises()
      expect(mocked.getLayer).not.toHaveBeenCalledWith('nw', 'ss', 'layer1')
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

  describe('profile select', () => {
    const profileSource: ProfileSource = () =>
      Promise.resolve([
        { name: 'ok', documents: [{ view: 'v', target: { layer: 'layer1' } }] },
        { name: 'other', documents: [{ view: 'v', target: { network: 'nw', snapshot: 'x.' } }] },
        { name: 'broken', documents: [], error: 'bad yaml' },
      ])
    const items = (wrapper: ReturnType<typeof mount>) =>
      wrapper.get('[data-testid=profile-select]').findAll('option')

    it('is shown for the schematic layout only, with the files which apply to this snapshot', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profileSource,
      })
      current = wrapper
      await flushPromises()
      expect(items(wrapper).map((o) => [o.attributes('value'), o.text()])).toEqual([
        ['', 'Auto (by target)'],
        ['ok', 'ok'], // `other` (another snapshot) and `broken` are hidden
      ])
      expect((wrapper.get('[data-testid=profile-select]').element as HTMLSelectElement).value).toBe('')
      await wrapper.setProps({ engine: 'stress' })
      expect(wrapper.find('[data-testid=profile-select]').exists()).toBe(false)
      const other = await mountView(['layer1', 'layer2'], undefined, { profileSource })
      expect(other.wrapper.find('[data-testid=profile-select]').exists()).toBe(false)
      other.wrapper.unmount()
    })

    it('tells the choice (the name, or undefined for auto)', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profileSource,
      })
      current = wrapper
      await flushPromises()
      await wrapper.get('[data-testid=profile-select]').setValue('ok')
      await wrapper.setProps({ profile: 'ok' })
      await flushPromises()
      expect((wrapper.get('[data-testid=profile-select]').element as HTMLSelectElement).value).toBe('ok')
      await wrapper.get('[data-testid=profile-select]').setValue('')
      expect(wrapper.emitted('update:profile')).toEqual([['ok'], [undefined]])
    })

    it('shows the file named in the URL even if it does not apply, with the reason', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'other',
        profileSource,
      })
      current = wrapper
      await flushPromises()
      expect(items(wrapper).map((o) => o.text())).toEqual([
        'Auto (by target)',
        'ok',
        'other (does not apply to this snapshot)',
      ])
    })

    it('is not shown when no file applies and none is named (nothing to choose)', async () => {
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profileSource: () => Promise.resolve([]),
      })
      current = wrapper
      await flushPromises()
      expect(wrapper.find('[data-testid=profile-select]').exists()).toBe(false)
    })

    it('asks the backend once for the choices and the loading of the profiles', async () => {
      let calls = 0
      const counted: ProfileSource = () => {
        calls++
        return profileSource('nw')
      }
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profileSource: counted,
      })
      current = wrapper
      await flushPromises()
      await wrapper.setProps({ profile: 'ok' })
      await flushPromises()
      expect(calls).toBe(1)
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

    /** Source whose loading is finished by the test: the calls are numbered in the order (0, 1, ...) */
    const deferredSource = () => {
      const resolvers: Array<(files: ProfileFile[]) => void> = []
      const source: ProfileSource = () => new Promise<ProfileFile[]>((resolve) => resolvers.push(resolve))
      return {
        source,
        /** Finish the call with a file of the name (YAML text); no file if the text is undefined */
        resolve: (call: number, name: string, text?: string) =>
          resolvers[call]?.(text === undefined ? [] : [{ name, documents: yamlDocuments(text).documents }]),
      }
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
      resolve(0, 'ok', 'view: v\n')
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
      resolve(0, 'nothing')
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
      resolve(1, 'b', 'view: b\n')
      await flushPromises()
      resolve(0, 'a', 'view: a\naxes: {}\n') // with a warning, if it were used
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
      resolve(0, 'a', 'view: a\n')
      await flushPromises() // no error
    })

    it('applies the profile only to the network and the snapshot being shown (target)', async () => {
      const source: ProfileSource = () =>
        Promise.resolve([
          { name: 'here', documents: [{ view: 'v', target: { network: 'nw', snapshot: 's.' } }] },
          { name: 'there', documents: [{ view: 'v', target: { network: 'nw', snapshot: 'x.' } }] },
        ])
      const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
        engine: 'schematic',
        profile: 'here',
        profileSource: source,
      })
      current = wrapper
      await flushPromises()
      expect(wrapper.find('[data-testid=profile-error]').exists()).toBe(false)
      await wrapper.setProps({ profile: 'there' })
      await flushPromises()
      expect(errorText(wrapper)).toContain("profile 'there' does not apply to nw / ss")
    })

    describe('changing the engine', () => {
      const okFiles: ProfileFile[] = [
        {
          name: 'f',
          documents: [
            { view: 'v', target: { layer: 'layer1' }, tiers: ['t'], rules: [{ select: '*', tier: 't' }] },
          ],
        },
      ]

      it('arranges once, after the profiles are loaded, when the engine is changed to schematic', async () => {
        const { source, resolveFiles } = (() => {
          let resolveFiles: (files: ProfileFile[]) => void = () => undefined
          const source: ProfileSource = () => new Promise((resolve) => (resolveFiles = resolve))
          return { source, resolveFiles: (files: ProfileFile[]) => resolveFiles(files) }
        })()
        const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
          engine: 'stress',
          profileSource: source,
        })
        current = wrapper
        vi.mocked(layoutSchematic).mockClear()
        await wrapper.setProps({ engine: 'schematic' })
        await flushPromises()
        expect(layoutSchematic).not.toHaveBeenCalled() // the lower layers are loaded, the profiles are not
        resolveFiles(okFiles)
        await flushPromises()
        await vi.waitFor(() => expect(layoutSchematic).toHaveBeenCalled())
        await flushPromises()
        const calls = vi.mocked(layoutSchematic).mock.calls.filter(([input]) => input.layer === 'layer1')
        expect(calls).toHaveLength(1)
        expect(calls[0]?.[0].profile?.view).toBe('v')
      })

      it('does not arrange by the schematic layout when the engine is changed from it, and does not load the profiles again', async () => {
        const source = vi.fn<ProfileSource>(() => Promise.resolve(okFiles))
        const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
          engine: 'schematic',
          profileSource: source,
        })
        current = wrapper
        await vi.waitFor(() => expect(wrapper.find('[data-testid=report-source]').exists()).toBe(true))
        await flushPromises()
        vi.mocked(layoutSchematic).mockClear()
        await wrapper.setProps({ engine: 'stress' })
        await flushPromises()
        expect(layoutSchematic).not.toHaveBeenCalled()
        await wrapper.setProps({ engine: 'schematic' })
        await flushPromises()
        await vi.waitFor(() => expect(layoutSchematic).toHaveBeenCalled())
        expect(source).toHaveBeenCalledTimes(1) // the same profiles: not loaded again
      })
    })

    describe('automatic selection (without ?profile=)', () => {
      const files: ProfileSource = () =>
        Promise.resolve([
          {
            name: 'asis',
            documents: [
              {
                view: 'v',
                target: { network: 'nw', snapshot: 'other', layer: 'layer1' },
                tiers: ['t'],
                rules: [{ select: '*', tier: 't' }],
              },
              {
                view: 'v',
                target: { network: 'nw', snapshot: 'ss', layer: 'layer1' },
                tiers: ['t'],
                rules: [{ select: '*', tier: 't' }],
              },
            ],
          },
        ])

      it('uses the profile whose target accepts the network, the snapshot and the layer, and tells which', async () => {
        const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
          engine: 'schematic',
          profileSource: files,
        })
        current = wrapper
        await vi.waitFor(() => expect(wrapper.find('[data-testid=report-source]').exists()).toBe(true))
        const layer1 = wrapper.get('[data-layer=layer1] [data-testid=report-source]').text()
        expect(layer1).toBe('profile asis #2 (by target)') // the 2nd document: the snapshot is `ss`
        expect(wrapper.find('[data-testid=report-note]').exists()).toBe(false)
        expect(wrapper.find('[data-testid=profile-error]').exists()).toBe(false)
      })

      it('tells that no profile applies, and arranges without profiles', async () => {
        const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
          engine: 'schematic',
          profileSource: () =>
            Promise.resolve([{ name: 'x', documents: [{ view: 'v', target: { network: 'elsewhere' } }] }]),
        })
        current = wrapper
        await vi.waitFor(() => expect(wrapper.find('[data-testid=report-note]').exists()).toBe(true))
        expect(wrapper.get('[data-testid=report-note]').text()).toContain('no profile applies')
        expect(count(wrapper, 'g.node:not(.tp)')).toBe(3)
      })

      it('tells that the profiles cannot be loaded (e.g. an old backend), and arranges without profiles', async () => {
        const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
          engine: 'schematic',
          profileSource: () => Promise.reject(new Error('Not Found')),
        })
        current = wrapper
        await vi.waitFor(() => expect(wrapper.find('[data-testid=profile-error]').exists()).toBe(true))
        expect(errorText(wrapper)).toBe('profiles: Not Found')
        await vi.waitFor(() => expect(count(wrapper, 'g.node:not(.tp)')).toBe(3))
      })

      it('does not load the profiles for the other engines, and loads them when the engine is changed', async () => {
        const source = vi.fn(files)
        const { wrapper } = await mountView(['layer1', 'layer2'], undefined, {
          engine: 'stress',
          profileSource: source,
        })
        current = wrapper
        await flushPromises()
        expect(source).not.toHaveBeenCalled()
        await wrapper.setProps({ engine: 'schematic' })
        await flushPromises()
        expect(source).toHaveBeenCalledTimes(1)
        expect(source).toHaveBeenCalledWith('nw')
      })
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
      await wrapper.setProps({ profile: undefined, engine: 'stress' }) // nothing is loaded for the other engines
      await flushPromises()
      expect(wrapper.find('[data-testid=profile-error]').exists()).toBe(false)
    })
  })
})
