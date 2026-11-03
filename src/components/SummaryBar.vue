<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { Summary } from '../api/types'

const props = defineProps<{ summary: Summary }>()
const showWarnings = ref(false)

const warnCount = computed(() => props.summary.warnings.filter((w) => w.severity === 'warn').length)
const infoCount = computed(() => props.summary.warnings.filter((w) => w.severity === 'info').length)
</script>

<template>
  <div class="summary-bar">
    <RouterLink :to="{ name: 'network', params: { network: summary.network } }" class="network-link">
      <strong>{{ summary.network }}</strong>
    </RouterLink>
    / {{ summary.snapshot }}
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
.network-link {
  color: inherit;
}
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
  border-color: var(--changed);
  color: var(--changed-text);
}
.chip.warnings {
  cursor: pointer;
}
.chip.warnings.warn {
  border-color: var(--error);
  color: var(--error);
}
.warning-list {
  margin: 0.25rem 0;
  font-size: 0.85em;
}
.warning-list .warn {
  color: var(--error);
}
.warning-list .info {
  opacity: 0.7;
}
</style>
