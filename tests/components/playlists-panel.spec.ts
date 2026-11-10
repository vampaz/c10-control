// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Playlist } from '@shared/types'
import PlaylistsPanel from '@/components/PlaylistsPanel.vue'

const PLAYLISTS: Playlist[] = [
  {
    id: 'one',
    name: 'Road trip',
    items: [
      { id: 'item1', url: 'http://example.com/a.mp3', title: 'First', isLive: false },
      { id: 'item2', url: 'http://example.com/live.aac', title: 'Radio', isLive: true },
    ],
    createdAt: 1,
    updatedAt: 1,
  },
  { id: 'two', name: 'Evening', items: [], createdAt: 2, updatedAt: 2 },
]

function mountPanel(selectedId = 'one') {
  return mount(PlaylistsPanel, { props: { playlists: PLAYLISTS, selectedId, busy: false } })
}

describe('PlaylistsPanel', () => {
  it('lists playlists and selects one', async () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Road trip')
    expect(wrapper.text()).toContain('Evening')
    await wrapper.findAll('.playlist-row')[1].trigger('click')

    expect(wrapper.emitted('select')).toEqual([['two']])
    wrapper.unmount()
  })

  it('creates a playlist', async () => {
    const wrapper = mountPanel()

    await wrapper.get('.create input').setValue('New mix')
    await wrapper.get('.create .primary').trigger('click')

    expect(wrapper.emitted('create')).toEqual([['New mix']])
    wrapper.unmount()
  })

  it('shows the selected playlist items and plays it', async () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('First')
    expect(wrapper.text()).toContain('Radio')
    await wrapper.findAll('.detail-head .text-button')[0].trigger('click')

    expect(wrapper.emitted('play')).toEqual([['one']])
    wrapper.unmount()
  })

  it('adds the current track and removes an item', async () => {
    const wrapper = mountPanel()

    await wrapper.get('.add-current').trigger('click')
    await wrapper.findAll('.item-remove')[0].trigger('click')

    expect(wrapper.emitted('addCurrent')).toEqual([['one']])
    expect(wrapper.emitted('removeItem')).toEqual([['one', 'item1']])
    wrapper.unmount()
  })

  it('renames the selected playlist', async () => {
    const wrapper = mountPanel()

    await wrapper.findAll('.detail-head .text-button')[1].trigger('click')
    await wrapper.get('.rename input').setValue('Renamed')
    await wrapper.get('.rename .primary').trigger('click')

    expect(wrapper.emitted('rename')).toEqual([['one', 'Renamed']])
    wrapper.unmount()
  })

  it('asks for confirmation before deleting', async () => {
    const wrapper = mountPanel()
    const remove = wrapper.findAll('.detail-head .text-button')[2]

    await remove.trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(remove.text()).toContain('Confirm')

    await remove.trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['one']])
    wrapper.unmount()
  })
})
