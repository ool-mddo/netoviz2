<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppBreadcrumb from './components/AppBreadcrumb.vue'
import ThemeToggle from './components/ThemeToggle.vue'
</script>

<template>
  <header class="app-header">
    <AppBreadcrumb />
    <ThemeToggle />
  </header>
  <main class="app-main">
    <RouterView />
  </main>
</template>

<style>
:root {
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
  border-bottom: 1px solid var(--border);
}
.app-main {
  padding: 1rem;
}
</style>
