<script setup lang="ts">
import { computed } from 'vue'
import { useSelect } from '../composables/useSelect'
import { layerOfId } from '../domain/layers'
import { traceSupports } from '../domain/tracer'
import { useSelectionStore } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import JsonTree from './JsonTree.vue'

const topology = useTopologyStore()
const selection = useSelectionStore()
const selectObject = useSelect()

const entry = computed(() => selection.selected)
const attributes = computed(() =>
  selection.selectedId ? topology.attributes[selection.selectedId] : undefined,
)
const layerRank = computed(
  () => new Map((topology.summary?.layers ?? []).map((layer) => [layer.id, layer.rank ?? -1])),
)
const layerName = computed(
  () => new Map((topology.summary?.layers ?? []).map((layer) => [layer.id, layer.name])),
)
const attributeList = computed(() => Object.entries(attributes.value?.attributes ?? {}))

interface TraceItem {
  id: string
  name: string
  type: string
  layer: string
}

/** Objects reached through supports in the direction, grouped by layer (upper layers first) */
function traced(direction: 'lower' | 'upper'): Array<[string, TraceItem[]]> {
  const starts = selection.traceStartIds
  if (starts.length === 0) return []
  const startSet = new Set(starts)
  const items = [...traceSupports(topology.supportIndex, starts, direction).ids]
    .filter((id) => !startSet.has(id))
    .map((id): TraceItem => {
      const found = topology.objects.get(id)
      return {
        id,
        name: found?.data.name ?? id,
        type: found?.type ?? '?',
        layer: found?.layer ?? layerOfId(id, topology.summary?.layers ?? []) ?? '?',
      }
    })
  const groups = new Map<string, TraceItem[]>()
  for (const item of items) groups.set(item.layer, [...(groups.get(item.layer) ?? []), item])
  return [...groups.entries()].sort(
    ([a], [b]) => (layerRank.value.get(b) ?? -2) - (layerRank.value.get(a) ?? -2),
  )
}
const lowerItems = computed(() => traced('lower'))
const upperItems = computed(() => traced('upper'))
</script>

<template>
  <aside class="attribute-panel" data-testid="attribute-panel">
    <p v-if="!entry" class="empty" data-testid="panel-empty">
      Select a node or a term-point to see its attributes.
    </p>
    <template v-else>
      <header class="panel-header">
        <div>
          <strong data-testid="panel-name">{{ entry.data.name }}</strong>
          <span class="chip">{{ entry.type }}</span>
          <span class="chip">{{ layerName.get(entry.layer) ?? entry.layer }}</span>
          <span v-if="entry.data.diff" class="chip" :class="entry.data.diff" data-testid="panel-diff">
            {{ entry.data.diff }}
          </span>
          <span v-if="entry.type === 'node' && entry.data.kind" class="chip">{{ entry.data.kind }}</span>
        </div>
        <button type="button" data-testid="panel-close" @click="selectObject(null)">x</button>
      </header>

      <section>
        <h3>Attributes</h3>
        <p v-if="!attributes" data-testid="panel-loading">Loading...</p>
        <p v-else-if="attributeList.length === 0" class="empty">(no attributes)</p>
        <JsonTree
          v-for="[key, value] in attributeList"
          :key="key"
          :label="key"
          :value="value"
          :open-depth="3"
        />
      </section>

      <section v-if="attributes?.diff_state">
        <h3>Diff state</h3>
        <JsonTree :value="attributes.diff_state" :open-depth="1" />
      </section>

      <section v-if="attributes?.supporting">
        <h3>Supporting (in the data)</h3>
        <JsonTree
          v-for="(value, key) in attributes.supporting"
          :key="key"
          :label="key"
          :value="value"
          :open-depth="0"
        />
      </section>

      <section data-testid="panel-trace">
        <h3>Supports</h3>
        <p v-if="selection.traceMode === 'off'" class="empty">(trace is off)</p>
        <template v-else>
          <template
            v-for="[title, groups] in [
              ['Lower layers', lowerItems],
              ['Upper layers', upperItems],
            ] as const"
            :key="title"
          >
            <h4>{{ title }}</h4>
            <p v-if="groups.length === 0" class="empty">(none)</p>
            <div v-for="[layer, items] in groups" :key="layer" class="trace-group">
              <div class="trace-layer">{{ layerName.get(layer) ?? layer }}</div>
              <ul>
                <li v-for="item in items" :key="item.id">
                  <button type="button" class="link" data-testid="trace-item" @click="selectObject(item.id)">
                    {{ item.name }}
                  </button>
                  <span class="chip">{{ item.type }}</span>
                </li>
              </ul>
            </div>
          </template>
        </template>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.attribute-panel {
  border: 1px solid #8884;
  padding: 0.5rem 0.75rem;
  height: 72vh;
  overflow: auto;
  box-sizing: border-box;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}
h3 {
  margin: 0.75rem 0 0.25rem;
  font-size: 0.95em;
  border-bottom: 1px solid #8883;
}
h4 {
  margin: 0.4rem 0 0.1rem;
  font-size: 0.85em;
  opacity: 0.8;
}
.chip {
  border: 1px solid #8886;
  border-radius: 999px;
  padding: 0 0.5rem;
  margin-left: 0.3rem;
  font-size: 0.8em;
}
.chip.added {
  border-color: #2e7d32;
  color: #2e7d32;
}
.chip.deleted {
  border-color: #c62828;
  color: #c62828;
}
.chip.changed {
  border-color: #f9a825;
  color: #f9a825;
}
.empty {
  opacity: 0.6;
  font-size: 0.9em;
}
.trace-layer {
  font-weight: bold;
  font-size: 0.85em;
}
.trace-group ul {
  margin: 0 0 0.3rem;
  padding-left: 1.2rem;
  font-size: 0.85em;
}
button.link {
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
