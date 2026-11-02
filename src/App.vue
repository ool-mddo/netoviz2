<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="app-header">
    <RouterLink to="/" class="app-title">netoviz2</RouterLink>
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
.app-title {
  font-weight: bold;
  text-decoration: none;
  color: inherit;
}
.app-main {
  padding: 1rem;
}
</style>
