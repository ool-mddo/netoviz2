import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { router } from '../router'
import { makeSummary } from '../test/fixtures'
import LayerList from './LayerList.vue'
import SummaryBar from './SummaryBar.vue'

describe('SummaryBar', () => {
  it('shows flags and the diff mark', () => {
    const wrapper = mount(SummaryBar, {
      props: { summary: makeSummary({ flags: ['blueprint=b1'], has_diff: true }) },
      global: { plugins: [router] },
    })
    expect(wrapper.get('[data-testid=flag]').text()).toBe('blueprint=b1')
    expect(wrapper.find('[data-testid=has-diff]').exists()).toBe(true)
  })

  it('shows nothing extra for a plain topology', () => {
    const wrapper = mount(SummaryBar, { props: { summary: makeSummary() }, global: { plugins: [router] } })
    expect(wrapper.find('[data-testid=flag]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=has-diff]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=warnings-button]').exists()).toBe(false)
  })

  it('shows warnings on click, with the number of omitted ones', async () => {
    const warnings = [{ code: 'dangling_support', severity: 'warn' as const, message: 'not found' }]
    const wrapper = mount(SummaryBar, {
      props: { summary: makeSummary({ warnings, warnings_total: 3 }) },
      global: { plugins: [router] },
    })
    expect(wrapper.find('[data-testid=warning-list]').exists()).toBe(false)
    await wrapper.get('[data-testid=warnings-button]').trigger('click')
    expect(wrapper.get('[data-testid=warning-list]').text()).toContain('dangling_support')
    expect(wrapper.get('[data-testid=warning-list]').text()).toContain('2 more')
  })
})

describe('LayerList', () => {
  it('lists layers from the top and emits toggle', async () => {
    const wrapper = mount(LayerList, { props: { layers: makeSummary().layers, visible: ['layer2'] } })
    const names = wrapper.findAll('li strong').map((e) => e.text())
    expect(names).toEqual(['layer2', 'layer1'])
    const box = wrapper.get('[data-testid=toggle-layer1]').element as HTMLInputElement
    expect(box.checked).toBe(false)
    await wrapper.get('[data-testid=toggle-layer1]').trigger('change')
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['layer1'])
  })
})

describe('SummaryBar network link', () => {
  it('links the network name to the snapshot list of the network', () => {
    const wrapper = mount(SummaryBar, { props: { summary: makeSummary() }, global: { plugins: [router] } })
    expect(wrapper.get('a.network-link').attributes('href')).toBe(
      router.resolve({ name: 'network', params: { network: 'nw' } }).href,
    )
  })
})

describe('LayerList: select all / clear all', () => {
  it('tells that all the layers are selected or cleared', async () => {
    const wrapper = mount(LayerList, { props: { layers: makeSummary().layers, visible: ['layer1'] } })
    await wrapper.get('[data-testid=select-all]').trigger('click')
    expect(wrapper.emitted('select-all')).toHaveLength(1)
    await wrapper.get('[data-testid=select-none]').trigger('click')
    expect(wrapper.emitted('select-none')).toHaveLength(1)
  })
})
