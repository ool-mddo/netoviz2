<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getIndex } from '../api/client'
import type { IndexEntry } from '../api/types'

const entries = ref<IndexEntry[]>([])
const error = ref<string | null>(null)
const loading = ref(true)

const networks = computed(() => {
  const map = new Map<string, IndexEntry[]>()
  for (const entry of entries.value) {
    const list = map.get(entry.network)
    if (list) list.push(entry)
    else map.set(entry.network, [entry])
  }
  return [...map.entries()]
})

onMounted(async () => {
  try {
    entries.value = await getIndex()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <h1>Topologies</h1>
  <p v-if="loading">Loading...</p>
  <p v-else-if="error" class="error">Failed to load the list: {{ error }}</p>
  <p v-else-if="entries.length === 0">No topology is registered.</p>
  <section v-for="[network, items] in networks" :key="network">
    <h2>{{ network }}</h2>
    <ul>
      <li v-for="item in items" :key="item.snapshot">
        <RouterLink :to="{ name: 'topology', params: { network: item.network, snapshot: item.snapshot } }">
          {{ item.snapshot }}
        </RouterLink>
        <span class="label"> {{ item.label }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.error {
  color: #c62828;
}
.label {
  opacity: 0.6;
  font-size: 0.85em;
}
</style>
