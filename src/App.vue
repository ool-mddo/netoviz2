<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppBreadcrumb from './components/AppBreadcrumb.vue'
</script>

<template>
  <header class="app-header">
    <AppBreadcrumb />
  </header>
  <main class="app-main">
    <RouterView />
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}
body {
  margin: 0;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #8884;
}
.app-main {
  padding: 1rem;
}
</style>
