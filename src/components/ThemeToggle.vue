<script setup lang="ts">
import { THEME_MODES, useThemeStore, type ThemeMode } from '../stores/theme'

const theme = useThemeStore()
const labels: Record<ThemeMode, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }
</script>

<template>
  <div class="theme-toggle" role="group" aria-label="theme">
    <button
      v-for="mode in THEME_MODES"
      :key="mode"
      type="button"
      :aria-pressed="theme.mode === mode"
      :class="{ active: theme.mode === mode }"
      :data-testid="`theme-${mode}`"
      :title="mode === 'system' ? 'Follow the setting of the browser / OS' : `${labels[mode]} theme`"
      @click="theme.set(mode)"
    >
      {{ labels[mode] }}
    </button>
  </div>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  margin-left: auto;
}
.theme-toggle button {
  border: 1px solid var(--border);
  background: none;
  color: inherit;
  padding: 0.1rem 0.6rem;
  font-size: 0.85em;
  cursor: pointer;
}
.theme-toggle button + button {
  border-left: none;
}
.theme-toggle button.active {
  background: color-mix(in srgb, currentColor 18%, transparent);
  font-weight: bold;
}
</style>
