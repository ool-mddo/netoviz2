import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import NetworkView from './views/NetworkView.vue'
import TopologyView from './views/TopologyView.vue'

// URL: /netoviz2/ (networks), /netoviz2/:network (snapshots of the network), /netoviz2/:network/:snapshot (viewer)
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/:network', name: 'network', component: NetworkView, props: true },
    { path: '/:network/:snapshot', name: 'topology', component: TopologyView, props: true },
  ],
})
