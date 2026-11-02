import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import { router } from '../router'
import AppBreadcrumb from './AppBreadcrumb.vue'

vi.mock('../api/client')
const mocked = vi.mocked(api)

const entries = [
  { label: 'A (s1)', network: 'a', snapshot: 's1', file: 'topology.json' },
  { label: 'A (s2)', network: 'a', snapshot: 's2', file: 'topology.json' },
  { label: 'B (s1)', network: 'b', snapshot: 's1', file: 'topology.json' },
]
let current: ReturnType<typeof mount> | null = null

async function mountAt(path: string) {
  await router.push(path)
  await router.isReady()
  current = mount(AppBreadcrumb, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  return current
}

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getIndex.mockResolvedValue(entries)
})
afterEach(() => current?.unmount())

describe('AppBreadcrumb', () => {
  it('shows only the title on the top page', async () => {
    const wrapper = await mountAt('/')
    expect(wrapper.get('[data-testid=crumb-home]').text()).toBe('netoviz2')
    expect(wrapper.find('[data-testid=crumb-network]').exists()).toBe(false)
  })

  it('links the network to the snapshot list', async () => {
    const wrapper = await mountAt('/a')
    expect(wrapper.get('[data-testid=crumb-network]').attributes('href')).toBe(
      router.resolve({ name: 'network', params: { network: 'a' } }).href,
    )
    expect(wrapper.find('[data-testid=crumb-snapshot-select]').exists()).toBe(false)
  })

  it('shows a selector of the snapshots of the network on the viewer page', async () => {
    const wrapper = await mountAt('/a/s1')
    const options = wrapper.findAll('[data-testid=crumb-snapshot-select] option').map((o) => o.text())
    expect(options).toEqual(['s1', 's2'])
    expect((wrapper.get('[data-testid=crumb-snapshot-select]').element as HTMLSelectElement).value).toBe('s1')
  })

  it('moves to the selected snapshot', async () => {
    const wrapper = await mountAt('/a/s1?layers=x&sel=y')
    await wrapper.get('[data-testid=crumb-snapshot-select]').setValue('s2')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(
      router.resolve({ name: 'topology', params: { network: 'a', snapshot: 's2' } }).fullPath,
    )
  })

  it('shows the snapshot name without a selector if the network has only one snapshot', async () => {
    const wrapper = await mountAt('/b/s1')
    expect(wrapper.get('[data-testid=crumb-snapshot]').text()).toBe('s1')
  })
})
