import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

/** Term-points are shown for all nodes by default if the shown layers have not more term-points than this */
export const PORTS_AUTO_LIMIT = 1000

/** UI state shared by the viewers */
export const useViewStore = defineStore('view', () => {
  /** Show the term-points of all nodes (true/false), or decide automatically by the size (null) */
  const showPorts = ref<boolean | null>(null)
  /** Nodes whose term-points are shown differently from the default (by a double click) */
  const toggledNodes = shallowRef<ReadonlySet<string>>(new Set())

  /** @param tpCount Number of the term-points of the shown layers */
  function portsByDefault(tpCount: number): boolean {
    return showPorts.value ?? tpCount <= PORTS_AUTO_LIMIT
  }

  /** @returns IDs of the nodes whose term-points are shown */
  function expandedNodes(nodeIds: readonly string[], tpCount: number): Set<string> {
    const byDefault = portsByDefault(tpCount)
    return new Set(nodeIds.filter((id) => byDefault !== toggledNodes.value.has(id)))
  }

  function toggleExpand(nodeId: string): void {
    const next = new Set(toggledNodes.value)
    if (!next.delete(nodeId)) next.add(nodeId)
    toggledNodes.value = next
  }

  /** Show/hide the term-points of all nodes (the choices for each node are cleared) */
  function setShowPorts(value: boolean): void {
    showPorts.value = value
    toggledNodes.value = new Set()
  }

  return { showPorts, toggledNodes, portsByDefault, expandedNodes, toggleExpand, setShowPorts }
})
