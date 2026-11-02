<script setup lang="ts">
import { computed } from 'vue'
import type { LayerInfo } from '../api/types'
import { layersTopDown } from '../domain/layers'
import { layerColor } from '../render/forceRenderer'

const props = defineProps<{ layers: LayerInfo[]; visible: string[] }>()
const emit = defineEmits<{ toggle: [layerId: string] }>()

const ordered = computed(() => layersTopDown(props.layers))
const order = computed(() => ordered.value.map((layer) => layer.id))
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
