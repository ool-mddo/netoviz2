import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SchematicReport } from '../render/layout/schematic/types'
import SchematicReportPanel from './SchematicReportPanel.vue'

const inferred: SchematicReport = {
  layer: 'layer1',
  source: 'inferred',
  violations: [
    { id: 'layer1/odd', code: 'unclassified', message: 'odd: no tier is given' },
    { id: 'layer1/x-1', code: 'unpaired', message: 'x-1: has no partner' },
  ],
  draft: 'view: inferred\n',
}
const given: SchematicReport = { layer: 'layer2', source: 'profile', violations: [] }
const none: SchematicReport = { layer: 'layer3', source: 'none', violations: [] }

afterEach(() => vi.unstubAllGlobals())

describe('SchematicReportPanel', () => {
  it('tells what each layer was made from', () => {
    const wrapper = mount(SchematicReportPanel, { props: { reports: [inferred, given, none] } })
    expect(wrapper.findAll('[data-testid=report-source]').map((e) => e.text())).toEqual([
      'inferred (no usable profile)',
      'profile',
      'no profile (stress layout)',
    ])
  })

  it('shows the number of exceptions, with the list of them, or that there is none', () => {
    const wrapper = mount(SchematicReportPanel, { props: { reports: [inferred, given] } })
    expect(wrapper.get('[data-testid=report-violations]').text()).toBe('2 exceptions')
    expect(wrapper.findAll('li').map((li) => [li.attributes('data-code'), li.text()])).toEqual([
      ['unclassified', 'odd: no tier is given'],
      ['unpaired', 'x-1: has no partner'],
    ])
    expect(wrapper.get('[data-layer=layer2]').text()).toContain('no exceptions')
  })

  it('uses the singular for one exception', () => {
    const one = { ...inferred, violations: inferred.violations.slice(0, 1) }
    const wrapper = mount(SchematicReportPanel, { props: { reports: [one] } })
    expect(wrapper.get('[data-testid=report-violations]').text()).toBe('1 exception')
  })

  it('has the draft to download and to copy only for an inferred profile', () => {
    const wrapper = mount(SchematicReportPanel, { props: { reports: [inferred, given] } })
    const link = wrapper.get('[data-testid=report-download]')
    expect(link.attributes('download')).toBe('layer1-profile.yaml')
    expect(decodeURIComponent(link.attributes('href') ?? '')).toContain('view: inferred')
    expect(wrapper.findAll('[data-testid=report-download]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid=report-copy]')).toHaveLength(1)
  })

  it('copies the draft to the clipboard and tells it (or that it cannot)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = mount(SchematicReportPanel, { props: { reports: [inferred] } })
    await wrapper.get('[data-testid=report-copy]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('copied'))
    expect(writeText).toHaveBeenCalledWith('view: inferred\n')

    writeText.mockRejectedValue(new Error('denied'))
    await wrapper.get('[data-testid=report-copy]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('cannot copy'))
    expect(wrapper.text()).not.toContain('copied')
  })
})
