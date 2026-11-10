// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { QueueItem } from '@shared/types'
import QueuePanel from '@/components/QueuePanel.vue'

const ITEMS: QueueItem[] = [
  { id: 'a', url: 'http://example.com/a.mp3', title: 'First', isLive: false },
  { id: 'b', url: 'http://example.com/b.mp3', title: 'Second', isLive: false },
]

function mountPanel(items: QueueItem[] = ITEMS, activeIndex: number | null = 0, order: number[] = [0, 1]) {
  return mount(QueuePanel, { props: { items, activeIndex, order, busy: false } })
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

  it('renders the shuffled play order', () => {
    const wrapper = mountPanel(ITEMS, 0, [1, 0])

    expect(wrapper.findAll('.row-name').map((row) => row.text())).toEqual(['Second', 'First'])
    wrapper.unmount()
  })

  it('emits a move when one row is dropped on another', async () => {
    const wrapper = mountPanel()
    const rows = wrapper.findAll('.row')

    await rows[0].trigger('dragstart')
    await rows[1].trigger('drop')

    expect(wrapper.emitted('move')).toEqual([[0, 1]])
    wrapper.unmount()
  })

  it('shows cover art when a queued item has one', () => {
    const wrapper = mountPanel([{ ...ITEMS[0], artworkUrl: '/api/library/art?library=main&path=a.mp3&w=96&fallback=1' }])

    expect(wrapper.get('.row-art img').attributes('src')).toContain('/api/library/art')

    wrapper.unmount()
  })

  it('moves a track with the touch buttons', async () => {
    const wrapper = mountPanel()
    const buttons = wrapper.findAll('.row-move')

    await buttons[1].trigger('click')

    expect(wrapper.emitted('move')).toEqual([[0, 1]])
    wrapper.unmount()
  })

  it('hides manual moves while the order is shuffled', () => {
    const wrapper = mountPanel(ITEMS, 0, [1, 0])

    expect(wrapper.findAll('.row-move')).toHaveLength(0)
    wrapper.unmount()
  })

  it('emits the speaker handoff', async () => {
    const wrapper = mountPanel()
    const button = wrapper.findAll('.head-actions .text-button').find((entry) => entry.text() === 'Play on speaker')

    await button?.trigger('click')

    expect(wrapper.emitted('speaker')).toHaveLength(1)
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
    const clear = wrapper.findAll('.text-button').find((entry) => entry.text() === 'Clear')

    await clear?.trigger('click')

    expect(wrapper.emitted('clear')).toHaveLength(1)
    wrapper.unmount()
  })

  it('explains an empty queue', () => {
    const wrapper = mountPanel([], null)

    expect(wrapper.text()).toContain('Add tracks from the Library tab')
    wrapper.unmount()
  })
})
