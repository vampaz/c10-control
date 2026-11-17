// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransportControls from '@/components/TransportControls.vue'

// The component runs a position ticker; unmount each wrapper to stop it.
enableAutoUnmount(afterEach)

function mountControls(props: Record<string, unknown> = {}) {
  return mount(TransportControls, {
    props: {
      status: 'playing',
      position: 42,
      duration: 200,
      isLive: false,
      busy: false,
      ...props,
    },
  })
}

describe('TransportControls', () => {
  it('labels the main button pause while playing', () => {
    const wrapper = mountControls()
    expect(wrapper.get('.play-button').attributes('aria-label')).toBe('Pause')
  })

  it('labels the main button play while paused', () => {
    const wrapper = mountControls({ status: 'paused' })
    expect(wrapper.get('.play-button').attributes('aria-label')).toBe('Play')
  })

  it('emits toggle from the main button', async () => {
    const wrapper = mountControls()
    await wrapper.get('.play-button').trigger('click')

    expect(wrapper.emitted('command')).toContainEqual(['toggle'])
  })

  it('emits next and previous', async () => {
    const wrapper = mountControls()
    await wrapper.get('button[aria-label="Next track"]').trigger('click')
    await wrapper.get('button[aria-label="Previous track"]').trigger('click')

    expect(wrapper.emitted('command')).toContainEqual(['next'])
    expect(wrapper.emitted('command')).toContainEqual(['previous'])
  })

  it('shows the track duration on the seek row', () => {
    const wrapper = mountControls()
    expect(wrapper.get('.seek-times').text()).toContain('3:20')
  })

  it('keeps the seek row visible for a live stream and waits for a duration', () => {
    const wrapper = mountControls({ isLive: true, duration: 0 })
    const seek = wrapper.get('.seek')

    expect(seek.isVisible()).toBe(true)
    expect(wrapper.get('input[type="range"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.seek-times').text()).toContain('--:--')
  })

  it('resets the seek row to zero instead of removing it when a track changes', async () => {
    const wrapper = mountControls({ position: 42, duration: 200 })
    const before = wrapper.get('.seek').element

    // The poller still carries the old position until the new track reports in.
    await wrapper.setProps({ duration: 0, isLive: true })

    expect(wrapper.get('.seek').element).toBe(before)
    expect(wrapper.get('.seek-times').text()).toContain('0:00')
    expect(wrapper.get('.seek-times').text()).toContain('--:--')
  })

  it('advances the progress between speaker polls', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountControls({ position: 10, duration: 200 })

      await vi.advanceTimersByTimeAsync(1000)
      await wrapper.vm.$nextTick()

      const value = Number((wrapper.get('input[type="range"]').element as HTMLInputElement).value)
      expect(value).toBeGreaterThanOrEqual(10.5)
      expect(value).toBeLessThanOrEqual(12)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds the progress while paused', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountControls({ position: 10, duration: 200, status: 'paused' })

      await vi.advanceTimersByTimeAsync(1000)
      await wrapper.vm.$nextTick()

      const value = Number((wrapper.get('input[type="range"]').element as HTMLInputElement).value)
      expect(value).toBe(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the thumb hidden while waiting for the next track', () => {
    const wrapper = mountControls({ isLive: true, duration: 0 })

    expect(wrapper.get('.seek').classes()).toContain('waiting')
    expect((wrapper.get('input[type="range"]').element as HTMLInputElement).value).toBe('0')
  })

  it('emits the seek target on release', async () => {
    const wrapper = mountControls()
    const range = wrapper.get('input[type="range"]')

    await range.setValue(120)
    await range.trigger('change')

    expect(wrapper.emitted('command')).toContainEqual(['seek', 120])
  })

  it('holds the requested position until the speaker reports it', async () => {
    const wrapper = mountControls({ position: 10 })
    const range = wrapper.get('input[type="range"]')

    await range.setValue(120)
    await range.trigger('change')
    // A poll that still carries the old position must not snap the thumb back.
    await wrapper.setProps({ position: 12 })

    expect((range.element as HTMLInputElement).value).toBe('120')
  })

  it('disables the controls while busy', () => {
    const wrapper = mountControls({ busy: true })
    expect(wrapper.get('.play-button').attributes('disabled')).toBeDefined()
  })
})
