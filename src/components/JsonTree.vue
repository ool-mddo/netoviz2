<script setup lang="ts">
import { computed } from 'vue'
import {
  childPath,
  isDiffState,
  isMeaningfulDiffState,
  parseDiffData,
  type DiffEntry,
  type RawDiffState,
} from '../domain/diffData'

defineOptions({ name: 'JsonTree' })

const props = withDefaults(
  defineProps<{
    value: unknown
    label?: string
    /** Path in the style of diff data, from the nearest object having diff data */
    path?: string
    /** Diff entries of the nearest object having diff data (by path) */
    entries?: ReadonlyMap<string, DiffEntry>
    /** Depth until which the nodes are opened */
    openDepth?: number
    depth?: number
  }>(),
  { label: undefined, path: '', entries: undefined, openDepth: 2, depth: 0 },
)

const isContainer = computed(() => typeof props.value === 'object' && props.value !== null)
const isArray = computed(() => Array.isArray(props.value))

/** Diff state of this object (if the object has meaningful one) */
const ownState = computed<RawDiffState | null>(() => {
  const v = props.value
  if (!isContainer.value || isArray.value) return null
  const state = (v as Record<string, unknown>)['_diff_state_']
  return isDiffState(state) && isMeaningfulDiffState(state) ? state : null
})
/** If the object has diff data, the entries of the children are searched in it from here */
const ownEntries = computed<ReadonlyMap<string, DiffEntry> | null>(() => {
  const list = parseDiffData(ownState.value?.diff_data)
  return list.length > 0 ? new Map(list.map((entry) => [entry.path, entry])) : null
})
const activeEntries = computed(() => ownEntries.value ?? props.entries)
const basePath = computed(() => (ownEntries.value ? '' : props.path))

const deletedEntries = computed(() => [...(ownEntries.value?.values() ?? [])].filter((e) => e.sign === '-'))

/** Children to show (`_diff_state_` is shown as a mark of this object, not as a child) */
const children = computed<Array<[string | number, unknown]>>(() => {
  const v = props.value
  if (Array.isArray(v)) return v.map((item, i) => [i, item])
  if (isContainer.value)
    return Object.entries(v as Record<string, unknown>).filter(([key]) => key !== '_diff_state_')
  return []
})

/** Diff entry about this value */
const entry = computed(() => (props.path === '' ? undefined : props.entries?.get(props.path)))

const SIGN_LABEL = { '+': 'added', '-': 'deleted', '~': 'changed' } as const
const entryLabel = computed(() => (entry.value ? SIGN_LABEL[entry.value.sign] : null))
/** Label of the diff state of this object: added/deleted, otherwise changed (changed itself or its children) */
const stateLabel = computed(() => {
  const forward = ownState.value?.forward
  if (!ownState.value) return null
  return forward === 'added' || forward === 'deleted' ? forward : 'changed'
})

const summary = computed(() => (isArray.value ? `[${children.value.length}]` : `{${children.value.length}}`))

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value))
}
function valueClass(value: unknown): string {
  if (value === null) return 'null'
  return typeof value
}
</script>

<template>
  <details v-if="isContainer" class="json-node" :open="depth < openDepth">
    <summary>
      <span v-if="label !== undefined" class="key">{{ label }}</span>
      <span class="meta">{{ summary }}</span>
      <span v-if="stateLabel" class="badge" :class="stateLabel" data-testid="diff-state">{{
        stateLabel
      }}</span>
      <span v-if="entryLabel" class="badge" :class="entryLabel" data-testid="diff-entry">{{
        entryLabel
      }}</span>
    </summary>
    <div class="children">
      <JsonTree
        v-for="[key, child] in children"
        :key="key"
        :value="child"
        :label="String(key)"
        :path="childPath(basePath, key)"
        :entries="activeEntries"
        :open-depth="openDepth"
        :depth="depth + 1"
      />
      <div
        v-for="removed in deletedEntries"
        :key="removed.path"
        class="row removed"
        data-testid="deleted-entry"
      >
        <span class="badge deleted">deleted</span> <span class="key">{{ removed.path }}</span>
        <span class="value">{{ show(removed.before) }}</span>
      </div>
    </div>
  </details>
  <div v-else class="row" :class="{ changed: entry }">
    <span v-if="label !== undefined" class="key">{{ label }}</span>
    <span class="value" :class="valueClass(value)">{{ show(value) }}</span>
    <template v-if="entry">
      <span class="badge" :class="entryLabel" data-testid="diff-entry">{{ entryLabel }}</span>
      <span v-if="entry.sign === '~'" class="was" data-testid="diff-before"
        >was {{ show(entry.before) }}</span
      >
    </template>
  </div>
</template>

<style>
.json-node,
.json-node .row {
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
}
.json-node > .children {
  margin-left: 1rem;
  border-left: 1px solid var(--border-weak);
  padding-left: 0.5rem;
}
.json-node .key {
  font-weight: bold;
  margin-right: 0.4rem;
}
.json-node .meta {
  opacity: 0.6;
}
.json-node .value.string {
  color: var(--value-string);
}
.json-node .value.number {
  color: var(--value-number);
}
.json-node .value.boolean,
.json-node .value.null {
  color: var(--value-other);
}
.json-node .badge,
.row .badge {
  border-radius: 3px;
  padding: 0 0.3rem;
  margin-left: 0.4rem;
  font-size: 0.8em;
  color: var(--badge-text);
}
.badge.added {
  background: var(--added);
}
.badge.deleted {
  background: var(--deleted);
}
.badge.changed {
  background: var(--changed);
  color: #000;
}
.row.changed {
  background: color-mix(in srgb, var(--changed) 14%, transparent);
}
.row .was {
  opacity: 0.7;
  margin-left: 0.4rem;
}
</style>
