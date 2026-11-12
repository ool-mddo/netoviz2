<script setup lang="ts">
import { ref } from 'vue'
import type { SchematicReport } from '../render/layout/schematic/types'

const props = defineProps<{
  reports: SchematicReport[]
  /** Profile in use for each layer (file, position of the document, how it was selected) */
  profiles?: Record<string, string>
  /** Told when no profile applies */
  note?: string
}>()

function sourceLabel(report: SchematicReport): string {
  switch (report.source) {
    case 'profile': {
      const used = props.profiles?.[report.layer]
      return used === undefined ? 'profile' : `profile ${used}`
    }
    case 'inferred':
      return 'inferred (no usable profile)'
    case 'inherited':
      return `inherited from ${report.base ?? 'the lower layer'}${inheritedProfile(report)}`
    case 'none':
      return 'no profile (stress layout)'
  }
}

/** The profile of the lower layer which the arrangement is inherited from (if it has one) */
function inheritedProfile(report: SchematicReport): string {
  const used = report.base === undefined ? undefined : props.profiles?.[report.base]
  return used === undefined ? '' : ` (profile ${used})`
}

/** Layer whose draft was copied (to tell it) */
const copied = ref('')
const failed = ref('')

const dataUrlOf = (text: string) => `data:text/yaml;charset=utf-8,${encodeURIComponent(text)}`

async function copy(report: SchematicReport): Promise<void> {
  if (report.draft === undefined) return
  copied.value = ''
  failed.value = ''
  try {
    await navigator.clipboard.writeText(report.draft)
    copied.value = report.layer
  } catch {
    failed.value = report.layer
  }
}
</script>

<template>
  <div class="schematic-report" data-testid="schematic-report">
    <div v-if="note" class="note" data-testid="report-note">{{ note }}</div>
    <div v-for="report in reports" :key="report.layer" class="report" :data-layer="report.layer">
      <span class="layer">{{ report.layer }}</span>
      <span class="source" data-testid="report-source">{{ sourceLabel(report) }}</span>
      <details v-if="report.violations.length > 0" class="violations">
        <summary data-testid="report-violations">
          {{ report.violations.length }} {{ report.violations.length === 1 ? 'exception' : 'exceptions' }}
        </summary>
        <ul>
          <li v-for="v in report.violations" :key="`${v.code}:${v.id}`" :data-code="v.code">
            {{ v.message }}
          </li>
        </ul>
      </details>
      <span v-else class="none">no exceptions</span>
      <template v-if="report.draft !== undefined">
        <a
          class="draft"
          data-testid="report-download"
          :href="dataUrlOf(report.draft)"
          :download="`${report.layer}-profile.yaml`"
          :aria-label="`Download the draft of the profile of ${report.layer}`"
          >Download draft</a
        >
        <button
          type="button"
          data-testid="report-copy"
          :aria-label="`Copy the draft of the profile of ${report.layer}`"
          @click="copy(report)"
        >
          Copy draft
        </button>
        <span role="status" aria-live="polite">
          <span v-if="copied === report.layer" class="note">copied</span>
          <span v-if="failed === report.layer" class="note error">cannot copy (use Download)</span>
        </span>
      </template>
    </div>
  </div>
</template>

<style>
.schematic-report {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 0.25rem;
  flex-shrink: 0;
  font-size: 0.8em;
}
.schematic-report .report {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.schematic-report .layer {
  font-weight: 600;
}
.schematic-report .source,
.schematic-report .none {
  opacity: 0.7;
}
.schematic-report .violations ul {
  margin: 0.2rem 0;
  padding-left: 1.2rem;
}
</style>
