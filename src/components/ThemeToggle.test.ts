import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '../stores/theme'
import ThemeToggle from './ThemeToggle.vue'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return { wrapper: mount(ThemeToggle, { global: { plugins: [pinia] } }), theme: useThemeStore() }
}

describe('ThemeToggle', () => {
  it('has the three choices and shows the current one as pressed', () => {
    const { wrapper } = setup()
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['Auto', 'Light', 'Dark'])
    expect(wrapper.get('[data-testid=theme-system]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid=theme-dark]').attributes('aria-pressed')).toBe('false')
  })

  it('changes the theme of the page by a click', async () => {
    const { wrapper, theme } = setup()
    await wrapper.get('[data-testid=theme-dark]').trigger('click')
    expect(theme.mode).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(wrapper.get('[data-testid=theme-dark]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid=theme-light]').trigger('click')
    expect(document.documentElement.dataset.theme).toBe('light')
    await wrapper.get('[data-testid=theme-system]').trigger('click')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
