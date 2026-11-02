import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// The app is served under /netoviz2/ by api-proxy (nginx). API (/topologies/...) is on the same origin.
// In development, requests to the API are proxied to api-proxy (NETOVIZ2_API_URL, default http://localhost:15000).
const apiUrl = process.env.NETOVIZ2_API_URL ?? 'http://localhost:15000'

export default defineConfig({
  base: '/netoviz2/',
  plugins: [vue()],
  server: {
    proxy: {
      '/topologies': { target: apiUrl, changeOrigin: true },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
