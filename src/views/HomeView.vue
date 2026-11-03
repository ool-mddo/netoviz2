<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useIndexStore } from '../stores/index'

const index = useIndexStore()
onMounted(() => void index.load(true))
</script>

<template>
  <h1>Networks</h1>
  <p v-if="index.loading && !index.loaded">Loading...</p>
  <p v-else-if="index.error" class="error">Failed to load the list: {{ index.error }}</p>
  <p v-else-if="index.networks.length === 0">No topology is registered.</p>
  <ul class="networks">
    <li v-for="item in index.networks" :key="item.network">
      <RouterLink :to="{ name: 'network', params: { network: item.network } }" data-testid="network-link">
        {{ item.network }}
      </RouterLink>
      <span class="count">{{ item.snapshots.length }} snapshots</span>
    </li>
  </ul>
</template>

<style scoped>
.error {
  color: var(--error);
}
.count {
  opacity: 0.6;
  font-size: 0.85em;
}
.networks {
  line-height: 1.8;
}
/* a space between the link and the text (a space in the template is removed by the compiler) */
.networks li {
  display: flex;
  align-items: baseline;
  gap: 0.75em;
}
</style>
