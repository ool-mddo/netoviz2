<script setup lang="ts">
import ViewSelect from './ViewSelect.vue'
import type { ViewKind } from '../domain/viewKind'

defineProps<{ visibleLayers: string[] }>()
const emit = defineEmits<{ 'update:view': [kind: ViewKind] }>()
</script>

<template>
  <div class="dependency-view" data-testid="dependency-view">
    <div class="toolbar">
      <ViewSelect kind="dependency" @update:kind="(kind) => emit('update:view', kind)" />
    </div>
    <p class="note">Layer bands: not implemented yet.</p>
  </div>
</template>
