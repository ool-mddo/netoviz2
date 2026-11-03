import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY, useThemeStore } from './theme'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  setActivePinia(createPinia())
})
afterEach(() => vi.restoreAllMocks())

describe('theme store', () => {
  it('follows the setting of the browser by default (no data-theme)', () => {
    const theme = useThemeStore()
    theme.apply()
    expect(theme.mode).toBe('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('sets the theme to the page and keeps it in the browser', () => {
    const theme = useThemeStore()
    theme.set('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    theme.set('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('goes back to the setting of the browser (and forgets the choice)', () => {
    const theme = useThemeStore()
    theme.set('dark')
    theme.set('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('restores the kept choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const theme = useThemeStore()
    expect(theme.mode).toBe('dark')
    theme.apply()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('ignores an invalid kept value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(useThemeStore().mode).toBe('system')
  })

  it('works even if the storage is not available', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const theme = useThemeStore()
    expect(theme.mode).toBe('system')
    expect(() => theme.set('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
