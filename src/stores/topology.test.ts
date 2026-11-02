import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { attributesData, layer1Data, layer2Data, makeSummary, supportsData } from '../test/fixtures'
import { useSelectionStore } from './selection'
import { useTopologyStore } from './topology'

vi.mock('../api/client')
const mocked = vi.mocked(api)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  mocked.getSummary.mockResolvedValue(makeSummary())
  mocked.getLayer.mockImplementation((_nw, _ss, id) =>
    Promise.resolve(id === 'layer1' ? layer1Data : layer2Data),
  )
  mocked.getSupports.mockResolvedValue(supportsData)
  mocked.getAttributes.mockResolvedValue(attributesData)
})

describe('topology store', () => {
  it('opens a snapshot and gets the summary', async () => {
    const store = useTopologyStore()
    await store.open('nw', 'ss')
    expect(store.summary?.layers).toHaveLength(2)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('keeps the error message if the summary can not be loaded', async () => {
    mocked.getSummary.mockRejectedValue(new Error('Not found: x'))
    const store = useTopologyStore()
    await store.open('nw', 'ss')
    expect(store.summary).toBeNull()
    expect(store.error).toBe('Not found: x')
  })

  it('loads layers on demand only once and indexes the objects', async () => {
    const store = useTopologyStore()
    await store.open('nw', 'ss')
    await store.loadLayer('layer1')
    await store.loadLayer('layer1')
    expect(mocked.getLayer).toHaveBeenCalledTimes(1)
    expect(store.objects.get('layer1/sw1')?.type).toBe('node')
    expect(store.objects.get('layer1/sw1/p1')?.type).toBe('tp')
    expect(store.objects.get('layer1/~link/a')?.type).toBe('link')
    expect(store.tpsOfNode.get('layer1/sw1')?.map((tp) => tp.name)).toEqual(['p1', 'p2'])
  })

  it('loads supports once', async () => {
    const store = useTopologyStore()
    await store.open('nw', 'ss')
    await store.ensureSupports()
    await store.ensureSupports()
    expect(mocked.getSupports).toHaveBeenCalledTimes(1)
    expect(store.supportIndex.lowerEdges('layer2/r1')).toHaveLength(1)
    expect(store.supportIndex.lowerEdges('layer2/r1/e1')).toHaveLength(1)
  })

  it('loads only attributes which are not loaded yet', async () => {
    const store = useTopologyStore()
    await store.open('nw', 'ss')
    await store.loadAttributes(['layer2/r1'])
    await store.loadAttributes(['layer2/r1'])
    expect(mocked.getAttributes).toHaveBeenCalledTimes(1)
    expect(store.attributes['layer2/r1']?.type).toBe('node')
  })

  it('ignores responses for the snapshot which is not shown any more', async () => {
    let resolveFirst: (value: ReturnType<typeof makeSummary>) => void = () => {}
    mocked.getSummary.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const store = useTopologyStore()
    const first = store.open('nw', 'old')
    mocked.getSummary.mockResolvedValueOnce(makeSummary({ snapshot: 'new' }))
    await store.open('nw', 'new')
    resolveFirst(makeSummary({ snapshot: 'old' }))
    await first
    expect(store.summary?.snapshot).toBe('new')
  })

  describe('refresh', () => {
    it('does nothing when the topology is not updated (304)', async () => {
      const store = useTopologyStore()
      await store.open('nw', 'ss')
      await store.loadLayer('layer1')
      mocked.getSummary.mockResolvedValueOnce(null)
      expect(await store.refresh()).toBe(false)
      expect(mocked.getSummary).toHaveBeenLastCalledWith('nw', 'ss', 'v1-1')
      expect(store.revision).toBe(0)
    })

    it('reloads loaded layers and supports when the topology is updated', async () => {
      const store = useTopologyStore()
      await store.open('nw', 'ss')
      await store.loadLayer('layer1')
      await store.ensureSupports()
      await store.loadAttributes(['layer2/r1'])
      mocked.getSummary.mockResolvedValueOnce(makeSummary({ etag: 'v1-2' }))
      expect(await store.refresh()).toBe(true)
      expect(store.summary?.etag).toBe('v1-2')
      expect(mocked.getLayer).toHaveBeenCalledTimes(2)
      expect(mocked.getSupports).toHaveBeenCalledTimes(2)
      expect(store.attributes).toEqual({}) // attributes are loaded again when they are needed
      expect(store.revision).toBe(1)
    })

    it('keeps the current data and shows the error when the server fails', async () => {
      const store = useTopologyStore()
      await store.open('nw', 'ss')
      mocked.getSummary.mockRejectedValueOnce(new Error('Bad Gateway'))
      expect(await store.refresh()).toBe(false)
      expect(store.summary?.etag).toBe('v1-1')
      expect(store.error).toBe('Bad Gateway')
    })
  })
})

describe('selection store', () => {
  async function opened() {
    const topology = useTopologyStore()
    await topology.open('nw', 'ss')
    await Promise.all([topology.loadLayer('layer1'), topology.loadLayer('layer2'), topology.ensureSupports()])
    return { topology, selection: useSelectionStore() }
  }

  it('traces a node together with its term-points', async () => {
    const { selection } = await opened()
    selection.select('layer2/r1')
    expect(selection.traceStartIds).toEqual(['layer2/r1', 'layer2/r1/e1'])
    expect([...selection.trace.ids].sort()).toEqual([
      'layer1/sw1',
      'layer1/sw1/p1',
      'layer2/r1',
      'layer2/r1/e1',
    ])
  })

  it('traces only the term-point when it is selected', async () => {
    const { selection } = await opened()
    selection.select('layer2/r1/e1')
    expect([...selection.trace.ids].sort()).toEqual(['layer1/sw1/p1', 'layer2/r1/e1'])
  })

  it('traces nothing without selection or when the trace is off', async () => {
    const { selection } = await opened()
    expect(selection.trace.ids.size).toBe(0)
    selection.select('layer2/r1')
    selection.traceMode = 'off'
    expect(selection.trace.ids.size).toBe(0)
  })

  it('traces only one direction', async () => {
    const { selection } = await opened()
    selection.select('layer1/sw1')
    selection.traceMode = 'lower'
    expect(selection.trace.ids.has('layer2/r1')).toBe(false)
    selection.traceMode = 'upper'
    expect(selection.trace.ids.has('layer2/r1')).toBe(true)
  })

  it('ignores an unknown id', async () => {
    const { selection } = await opened()
    selection.select('unknown')
    expect(selection.selected).toBeUndefined()
    expect(selection.trace.ids.size).toBe(0)
  })
})
