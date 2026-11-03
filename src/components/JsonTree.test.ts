import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import JsonTree from './JsonTree.vue'

const kept = { forward: 'kept', backward: null, pair: '' }

describe('JsonTree', () => {
  it('shows keys and values of an object', () => {
    const wrapper = mount(JsonTree, {
      props: { label: 'attr', value: { metric: 1, name: 'x', on: true, none: null } },
    })
    const text = wrapper.text()
    expect(text).toContain('metric')
    expect(text).toContain('1')
    expect(text).toContain('"x"')
    expect(text).toContain('true')
    expect(text).toContain('null')
  })

  it('shows arrays with the number of items and index labels', () => {
    const wrapper = mount(JsonTree, { props: { label: 'list', value: ['a', 'b'] } })
    expect(wrapper.text()).toContain('[2]')
    expect(wrapper.text()).toContain('"b"')
  })

  it('does not show kept diff states (they are in all data)', () => {
    const wrapper = mount(JsonTree, { props: { label: 'attr', value: { metric: 1, _diff_state_: kept } } })
    expect(wrapper.text()).not.toContain('_diff_state_')
    expect(wrapper.find('[data-testid=diff-state]').exists()).toBe(false)
  })

  it('marks the object having a changed diff state, and does not show the state as a child', () => {
    const value = { metric: 1, _diff_state_: { forward: 'kept', backward: 'changed', pair: 'x' } }
    const wrapper = mount(JsonTree, { props: { label: 'attr', value } })
    expect(wrapper.get('[data-testid=diff-state]').text()).toBe('changed')
    expect(wrapper.text()).not.toContain('_diff_state_')
  })

  it('shows added/deleted states of an object', () => {
    const wrapper = mount(JsonTree, {
      props: { label: 'attr', value: { a: 1, _diff_state_: { forward: 'added' } } },
    })
    expect(wrapper.get('[data-testid=diff-state]').text()).toBe('added')
  })

  describe('diff data', () => {
    const value = {
      metric: 9,
      timer: { 'dead-interval': 4 },
      neighbor: [{ 'router-id': 'new' }, { 'router-id': 'added' }],
      _diff_state_: {
        forward: 'changed',
        backward: null,
        pair: 'attribute',
        diff_data: [
          ['~', 'metric', 1, 9],
          ['~', 'timer.dead-interval', 40, 4],
          ['+', 'neighbor[1]', { 'router-id': 'added' }],
          ['-', 'neighbor[2]', { 'router-id': 'old' }],
        ],
      },
    }

    it('shows the previous value of a changed value', () => {
      const wrapper = mount(JsonTree, { props: { label: 'attr', value } })
      const befores = wrapper.findAll('[data-testid=diff-before]').map((e) => e.text())
      expect(befores).toEqual(['was 1', 'was 40'])
    })

    it('marks an added item of an array', () => {
      const wrapper = mount(JsonTree, { props: { label: 'attr', value } })
      const added = wrapper.findAll('[data-testid=diff-entry]').filter((e) => e.text() === 'added')
      expect(added).toHaveLength(1)
    })

    it('lists deleted items (they are not in the current value)', () => {
      const wrapper = mount(JsonTree, { props: { label: 'attr', value } })
      const deleted = wrapper.get('[data-testid=deleted-entry]')
      expect(deleted.text()).toContain('neighbor[2]')
      expect(deleted.text()).toContain('"old"')
    })
  })
})
