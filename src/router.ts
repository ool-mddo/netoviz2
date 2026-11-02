import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

// URL: /netoviz2/ (list), /netoviz2/:network/:snapshot (viewer)
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: '/', name: 'home', component: HomeView }],
})
