// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { QueueItem } from '@shared/types'
import QueuePanel from '@/components/QueuePanel.vue'

const ITEMS: QueueItem[] = [
  { id: 'a', url: 'http://example.com/a.mp3', title: 'First', isLive: false },
  { id: 'b', url: 'http://example.com/b.mp3', title: 'Second', isLive: false },
]

function mountPanel(items: QueueItem[] = ITEMS, activeIndex: number | null = 0) {
  return mount(QueuePanel, { props: { items, activeIndex, busy: false } })
}

describe('QueuePanel', () => {
  it('lists queued tracks', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('First')
    expect(wrapper.text()).toContain('Second')
    expect(wrapper.findAll('.row')).toHaveLength(2)
    wrapper.unmount()
  })

  it('marks the active track', () => {
    const wrapper = mountPanel(ITEMS, 1)

    expect(wrapper.findAll('.row')[1].classes()).toContain('active')
    wrapper.unmount()
  })

  it('plays a track by index', async () => {
    const wrapper = mountPanel()

    await wrapper.findAll('.row-main')[1].trigger('click')

    expect(wrapper.emitted('play')).toEqual([[1]])
    wrapper.unmount()
  })

  it('removes a track', async () => {
    const wrapper = mountPanel()

    await wrapper.findAll('.row-remove')[0].trigger('click')

    expect(wrapper.emitted('remove')).toEqual([['a']])
    wrapper.unmount()
  })

  it('clears the queue', async () => {
    const wrapper = mountPanel()

    await wrapper.get('.text-button').trigger('click')

    expect(wrapper.emitted('clear')).toHaveLength(1)
    wrapper.unmount()
  })

  it('explains an empty queue', () => {
    const wrapper = mountPanel([], null)

    expect(wrapper.text()).toContain('Add tracks from the Library tab')
    wrapper.unmount()
  })
})
