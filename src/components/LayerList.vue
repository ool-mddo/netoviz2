<script setup lang="ts">
import { computed } from 'vue'
import type { LayerInfo } from '../api/types'
import { layersTopDown } from '../domain/layers'
import { layerColor } from '../render/forceRenderer'

const props = defineProps<{ layers: LayerInfo[]; visible: string[]; collapsed?: boolean }>()
const emit = defineEmits<{ toggle: [layerId: string]; 'select-all': []; 'select-none': [] }>()

const ordered = computed(() => layersTopDown(props.layers))
const order = computed(() => ordered.value.map((layer) => layer.id))
</script>

<template>
  <!-- collapsed: only the swatches (filled: visible), click to toggle -->
  <ul v-if="collapsed" class="layer-dots" data-testid="layer-dots">
    <li v-for="layer in ordered" :key="layer.id">
      <button
        type="button"
        class="dot"
        :class="{ off: !visible.includes(layer.id) }"
        :title="layer.name"
        :aria-label="`${layer.name} (${visible.includes(layer.id) ? 'shown' : 'hidden'})`"
        :aria-pressed="visible.includes(layer.id)"
        :data-testid="`dot-${layer.id}`"
        :style="{ '--dot-color': layerColor(layer.id, order) }"
        @click="emit('toggle', layer.id)"
      />
    </li>
  </ul>
  <template v-else>
    <div class="layer-actions">
      <button type="button" data-testid="select-all" @click="emit('select-all')">Select all</button>
      <button type="button" data-testid="select-none" @click="emit('select-none')">Clear all</button>
    </div>
    <ul class="layer-list">
      <li v-for="layer in ordered" :key="layer.id" :data-testid="`layer-${layer.id}`">
        <label>
          <input
            type="checkbox"
            :checked="visible.includes(layer.id)"
            :data-testid="`toggle-${layer.id}`"
            @change="emit('toggle', layer.id)"
          />
          <span class="swatch" :style="{ background: layerColor(layer.id, order) }" />
          <strong>{{ layer.name }}</strong>
        </label>
        <div class="meta">
          <div>{{ layer.kind ?? '(no type)' }}</div>
          <div>
            nodes {{ layer.counts.nodes }} / tps {{ layer.counts.tps }} / links {{ layer.counts.links }}
          </div>
          <div v-if="layer.supports.length > 0">supported by {{ layer.supports.join(', ') }}</div>
        </div>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.layer-dots {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.dot {
  width: 1rem;
  height: 1rem;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--dot-color);
  background: var(--dot-color);
  cursor: pointer;
}
.dot.off {
  background: transparent;
}
.layer-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}
.layer-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.layer-list li {
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border-weak);
}
.swatch {
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  border-radius: 50%;
  margin: 0 0.3rem;
}
.meta {
  font-size: 0.8em;
  opacity: 0.7;
  margin-left: 1.4rem;
}
</style>
