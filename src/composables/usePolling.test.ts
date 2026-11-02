import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { usePolling } from './usePolling'

const Host = (callback: () => Promise<unknown>) =>
  defineComponent({
    setup() {
      usePolling(callback, 1000)
      return () => null
    },
  })

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('usePolling', () => {
  it('calls the callback at the interval while mounted', async () => {
    const callback = vi.fn(() => Promise.resolve())
    const wrapper = mount(Host(callback))
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(callback).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('stops after unmount', async () => {
    const callback = vi.fn(() => Promise.resolve())
    const wrapper = mount(Host(callback))
    await vi.advanceTimersByTimeAsync(1000)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not call while the page is hidden', async () => {
    const callback = vi.fn(() => Promise.resolve())
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const wrapper = mount(Host(callback))
    await vi.advanceTimersByTimeAsync(3000)
    expect(callback).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not start the next call before the previous one is finished', async () => {
    let finish: () => void = () => {}
    const callback = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const wrapper = mount(Host(callback))
    await vi.advanceTimersByTimeAsync(5000)
    expect(callback).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('keeps polling even if the callback fails', async () => {
    const callback = vi.fn(() => Promise.reject(new Error('x')))
    const wrapper = mount(Host(callback))
    await vi.advanceTimersByTimeAsync(2500)
    expect(callback).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
