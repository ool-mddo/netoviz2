<script setup lang="ts">
import { computed } from 'vue'
import { useSelectionStore, type TraceMode } from '../stores/selection'
import { useTopologyStore } from '../stores/topology'
import { useViewStore } from '../stores/view'

const props = defineProps<{ visibleLayers: string[]; dependency: boolean }>()
const emit = defineEmits<{ 'update:dependency': [on: boolean] }>()

const topology = useTopologyStore()
const selection = useSelectionStore()
const view = useViewStore()

const tpCount = computed(() =>
  props.visibleLayers.reduce((sum, id) => sum + (topology.layerData[id]?.tps.length ?? 0), 0),
)
const portsOn = computed(() => view.portsByDefault(tpCount.value))
const traceModes: TraceMode[] = ['both', 'lower', 'upper', 'off']
</script>

<template>
  <div class="view-toolbar">
    <label>
      <input
        type="checkbox"
        :checked="portsOn"
        data-testid="show-ports"
        @change="view.setShowPorts(($event.target as HTMLInputElement).checked)"
      />
      Term-points
    </label>
    <label>
      Trace
      <select v-model="selection.traceMode" data-testid="trace-mode">
        <option v-for="mode in traceModes" :key="mode" :value="mode">{{ mode }}</option>
      </select>
    </label>
    <label>
      <input
        type="checkbox"
        :checked="dependency"
        data-testid="dependency"
        @change="emit('update:dependency', ($event.target as HTMLInputElement).checked)"
      />
      Dependency view
    </label>
    <span class="hint">click: select / double click: show or hide the term-points of the node</span>
  </div>
</template>

<style scoped>
.view-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}
.hint {
  opacity: 0.6;
  font-size: 0.85em;
}
</style>
