<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useIndexStore } from '../stores/index'

const props = defineProps<{ network: string }>()
const index = useIndexStore()
onMounted(() => void index.load(true))

const snapshots = computed(() => index.snapshotsOf(props.network))
</script>

<template>
  <h1>{{ props.network }}</h1>
  <p v-if="index.loading && !index.loaded">Loading...</p>
  <p v-else-if="index.error" class="error">Failed to load the list: {{ index.error }}</p>
  <p v-else-if="snapshots.length === 0">No snapshot of this network is registered.</p>
  <ul class="snapshots">
    <li v-for="item in snapshots" :key="item.snapshot">
      <RouterLink
        :to="{ name: 'topology', params: { network: item.network, snapshot: item.snapshot } }"
        data-testid="snapshot-link"
      >
        {{ item.snapshot }}
      </RouterLink>
      <span class="label"> {{ item.label }}</span>
    </li>
  </ul>
</template>

<style scoped>
.error {
  color: #c62828;
}
.label {
  opacity: 0.6;
  font-size: 0.85em;
}
.snapshots {
  line-height: 1.8;
}
</style>
