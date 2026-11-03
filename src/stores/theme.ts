import { defineStore } from 'pinia'
import { ref } from 'vue'

/** `system`: the setting of the browser/OS, `light` / `dark`: the choice of the user */
export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
/** Key of the localStorage (index.html reads the same key to apply the theme before the page is drawn) */
export const THEME_STORAGE_KEY = 'netoviz2.theme'

function readStored(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system' // the storage is not available
  }
}

/** Light/dark theme chosen by the user (kept in the browser) */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored())

  /** Set the theme to the page: `data-theme` on <html> (none for the setting of the browser) */
  function apply(): void {
    const element = document.documentElement
    if (mode.value === 'system') delete element.dataset.theme
    else element.dataset.theme = mode.value
  }

  function set(next: ThemeMode): void {
    mode.value = next
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // the choice is not kept
    }
    apply()
  }

  return { mode, apply, set }
})
