<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useIndexStore } from '../stores/index'

const route = useRoute()
const router = useRouter()
const index = useIndexStore()
onMounted(() => void index.load())

const network = computed(() => (typeof route.params.network === 'string' ? route.params.network : null))
const snapshot = computed(() => (typeof route.params.snapshot === 'string' ? route.params.snapshot : null))
const siblings = computed(() => (network.value ? index.snapshotsOf(network.value) : []))

/** Move to another snapshot of the network (layers and selection are not kept: they may not exist) */
function changeSnapshot(event: Event): void {
  const next = (event.target as HTMLSelectElement).value
  if (network.value && next !== snapshot.value) {
    void router.push({ name: 'topology', params: { network: network.value, snapshot: next } })
  }
}
</script>

<template>
  <nav class="breadcrumb" aria-label="breadcrumb">
    <RouterLink to="/" class="app-title" data-testid="crumb-home">netoviz2</RouterLink>
    <template v-if="network">
      <span class="sep">/</span>
      <RouterLink :to="{ name: 'network', params: { network } }" data-testid="crumb-network">{{
        network
      }}</RouterLink>
    </template>
    <template v-if="network && snapshot">
      <span class="sep">/</span>
      <select
        v-if="siblings.length > 1"
        :value="snapshot"
        data-testid="crumb-snapshot-select"
        aria-label="snapshot"
        @change="changeSnapshot"
      >
        <option v-for="item in siblings" :key="item.snapshot" :value="item.snapshot">
          {{ item.snapshot }}
        </option>
      </select>
      <span v-else data-testid="crumb-snapshot">{{ snapshot }}</span>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.app-title {
  font-weight: bold;
}
.breadcrumb a {
  color: inherit;
}
.sep {
  opacity: 0.4;
}
</style>
