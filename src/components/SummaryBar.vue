<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Summary } from '../api/types'

const props = defineProps<{ summary: Summary }>()
const showWarnings = ref(false)

const warnCount = computed(() => props.summary.warnings.filter((w) => w.severity === 'warn').length)
const infoCount = computed(() => props.summary.warnings.filter((w) => w.severity === 'info').length)
</script>

<template>
  <div class="summary-bar">
    <strong>{{ summary.network }}</strong> / {{ summary.snapshot }}
    <span v-for="flag in summary.flags" :key="flag" class="chip" data-testid="flag">{{ flag }}</span>
    <span v-if="summary.has_diff" class="chip diff" data-testid="has-diff">diff</span>
    <button
      v-if="summary.warnings_total > 0"
      type="button"
      class="chip warnings"
      :class="{ warn: warnCount > 0 }"
      data-testid="warnings-button"
      @click="showWarnings = !showWarnings"
    >
      warnings {{ summary.warnings_total }}
    </button>
  </div>
  <ul v-if="showWarnings" class="warning-list" data-testid="warning-list">
    <li v-for="(w, i) in summary.warnings" :key="i" :class="w.severity">
      <code>{{ w.code }}</code> {{ w.message }}
    </li>
    <li v-if="summary.warnings_total > summary.warnings.length" class="info">
      ... {{ summary.warnings_total - summary.warnings.length }} more
    </li>
    <li v-if="warnCount === 0 && infoCount > 0" class="info">(info only)</li>
  </ul>
</template>

<style scoped>
.summary-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.chip {
  border: 1px solid #8886;
  border-radius: 999px;
  padding: 0 0.6rem;
  font-size: 0.85em;
  background: none;
  color: inherit;
}
.chip.diff {
  border-color: #f9a825;
  color: #f9a825;
}
.chip.warnings {
  cursor: pointer;
}
.chip.warnings.warn {
  border-color: #c62828;
  color: #c62828;
}
.warning-list {
  margin: 0.25rem 0;
  font-size: 0.85em;
}
.warning-list .warn {
  color: #c62828;
}
.warning-list .info {
  opacity: 0.7;
}
</style>
