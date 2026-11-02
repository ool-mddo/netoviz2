import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'

vi.mock('./api/client', () => ({ getIndex: () => Promise.resolve([]) }))

describe('App', () => {
  it('renders the title and the home view', async () => {
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
    expect(wrapper.text()).toContain('netoviz2')
  })
})
