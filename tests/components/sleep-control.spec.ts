// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSleep = vi.fn<() => Promise<{ endsAt: number | null }>>()
const startSleep = vi.fn<(minutes: number) => Promise<{ endsAt: number | null }>>()
const cancelSleep = vi.fn<() => Promise<{ endsAt: number | null }>>()

vi.mock('@/api', () => ({
  getSleep: () => getSleep(),
  startSleep: (minutes: number) => startSleep(minutes),
  cancelSleep: () => cancelSleep(),
}))

async function mountControl() {
  const { default: SleepControl } = await import('@/components/SleepControl.vue')
  const wrapper = mount(SleepControl)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  getSleep.mockReset()
  startSleep.mockReset()
  cancelSleep.mockReset()
})

describe('SleepControl', () => {
  it('shows the sleep button when no timer runs', async () => {
    getSleep.mockResolvedValue({ endsAt: null })
    const wrapper = await mountControl()

    expect(wrapper.text()).toContain('Sleep')
    expect(wrapper.find('.menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers durations and starts a timer', async () => {
    getSleep.mockResolvedValue({ endsAt: null })
    startSleep.mockResolvedValue({ endsAt: Date.now() + 30 * 60_000 })
    const wrapper = await mountControl()

    await wrapper.get('.sleep-button').trigger('click')
    expect(wrapper.findAll('.menu button')).toHaveLength(4)

    await wrapper.findAll('.menu button')[1].trigger('click')
    await flushPromises()

    expect(startSleep).toHaveBeenCalledWith(30)
    expect(wrapper.text()).toContain('Sleep in')
    wrapper.unmount()
  })

  it('shows an active timer from the server and cancels it', async () => {
    getSleep.mockResolvedValue({ endsAt: Date.now() + 10 * 60_000 })
    cancelSleep.mockResolvedValue({ endsAt: null })
    const wrapper = await mountControl()

    expect(wrapper.text()).toContain('Sleep in')
    await wrapper.get('.text-button').trigger('click')
    await flushPromises()

    expect(cancelSleep).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Sleep')
    wrapper.unmount()
  })

  it('reports a failure to start', async () => {
    getSleep.mockResolvedValue({ endsAt: null })
    startSleep.mockRejectedValue(new Error('The speaker is unreachable'))
    const wrapper = await mountControl()

    await wrapper.get('.sleep-button').trigger('click')
    await wrapper.findAll('.menu button')[0].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('The speaker is unreachable')
    wrapper.unmount()
  })
})
