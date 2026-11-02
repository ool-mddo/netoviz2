<script setup lang="ts">
import { computed } from 'vue'
import type { LayerInfo } from '../api/types'
import { layersTopDown } from '../domain/layers'

const props = defineProps<{ layers: LayerInfo[]; visible: string[] }>()
const emit = defineEmits<{ toggle: [layerId: string] }>()

const ordered = computed(() => layersTopDown(props.layers))
</script>

<template>
  <ul class="layer-list">
    <li v-for="layer in ordered" :key="layer.id" :data-testid="`layer-${layer.id}`">
      <label>
        <input
          type="checkbox"
          :checked="visible.includes(layer.id)"
          :data-testid="`toggle-${layer.id}`"
          @change="emit('toggle', layer.id)"
        />
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

<style scoped>
.layer-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.layer-list li {
  padding: 0.4rem 0;
  border-bottom: 1px solid #8883;
}
.meta {
  font-size: 0.8em;
  opacity: 0.7;
  margin-left: 1.4rem;
}
</style>
