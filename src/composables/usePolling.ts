import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Call `callback` at the interval while the component is mounted and the page is visible.
 * The next call starts after the previous one is finished (requests do not pile up).
 */
export function usePolling(callback: () => Promise<unknown>, intervalMs: number): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  async function run(): Promise<void> {
    if (!document.hidden) {
      try {
        await callback()
      } catch {
        // errors are handled by the callback; keep polling
      }
    }
    if (!stopped) timer = setTimeout(() => void run(), intervalMs)
  }

  onMounted(() => {
    timer = setTimeout(() => void run(), intervalMs)
  })
  onBeforeUnmount(() => {
    stopped = true
    if (timer) clearTimeout(timer)
  })
}
