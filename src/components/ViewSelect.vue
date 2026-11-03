<script setup lang="ts">
import { parseViewKind, VIEW_KINDS, type ViewKind } from '../domain/viewKind'

defineProps<{ kind: ViewKind }>()
const emit = defineEmits<{ 'update:kind': [kind: ViewKind] }>()

function onChange(event: Event): void {
  const kind = parseViewKind((event.target as HTMLSelectElement).value)
  if (kind) emit('update:kind', kind)
}
</script>

<template>
  <label>
    View
    <select :value="kind" data-testid="layout-select" @change="onChange">
      <option v-for="item in VIEW_KINDS" :key="item.id" :value="item.id">{{ item.label }}</option>
    </select>
  </label>
</template>
