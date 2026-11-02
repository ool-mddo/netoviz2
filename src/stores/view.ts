import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/** UI state shared by the viewers */
export const useViewStore = defineStore('view', () => {
  /** Nodes whose term-points are shown */
  const expandedNodes = shallowRef<ReadonlySet<string>>(new Set())

  function toggleExpand(nodeId: string): void {
    const next = new Set(expandedNodes.value)
    if (!next.delete(nodeId)) next.add(nodeId)
    expandedNodes.value = next
  }

  function collapseAll(): void {
    expandedNodes.value = new Set()
  }

  return { expandedNodes, toggleExpand, collapseAll }
})
