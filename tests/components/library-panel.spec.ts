// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '@shared/types'
import LibraryPanel from '@/components/LibraryPanel.vue'

const ENTRY: LibraryEntry = {
  id: 'a',
  libraryId: 'main',
  libraryName: 'Main',
  name: 'Track',
  path: 'Album/Track.mp3',
  size: 2_500_000,
  modifiedAt: 1,
  url: 'http://192.168.1.135:5173/api/library/file?library=main&path=Album%2FTrack.mp3',
}

function mountPanel(overrides: Partial<{
  entries: LibraryEntry[]
  total: number
  mediaBaseUrl: string
  playingUrl: string
  query: string
  busy: boolean
  loading: boolean
}> = {}) {
  return mount(LibraryPanel, {
    props: {
      entries: [ENTRY],
      total: 1,
      mediaBaseUrl: 'http://192.168.1.135:5173',
      playingUrl: '',
      query: '',
      busy: false,
      loading: false,
      ...overrides,
    },
  })
}

describe('LibraryPanel', () => {
  it('lists files with their library, path and size', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Track')
    expect(wrapper.text()).toContain('Main')
    expect(wrapper.text()).toContain('Album/Track.mp3')
    expect(wrapper.text()).toContain('2.4 MB')
    wrapper.unmount()
  })

  it('explains an empty folder', () => {
    const wrapper = mountPanel({ entries: [], total: 0, query: '' })

    expect(wrapper.text()).toContain('No audio files')
    wrapper.unmount()
  })

  it('warns when the media URL is not reachable by the speaker', () => {
    const wrapper = mountPanel({ mediaBaseUrl: 'http://localhost:5173' })

    expect(wrapper.text()).toContain('cannot reach')
    wrapper.unmount()
  })

  it('marks the playing track', () => {
    const wrapper = mountPanel({ playingUrl: ENTRY.url })

    expect(wrapper.get('.row').classes()).toContain('playing')
    expect(wrapper.find('.playing-mark').exists()).toBe(true)
    expect(wrapper.get('.row-main').attributes('aria-current')).toBe('true')
    wrapper.unmount()
  })

  it('emits the chosen file', async () => {
    const wrapper = mountPanel()

    await wrapper.get('.row-main').trigger('click')

    expect(wrapper.emitted('play')).toEqual([[ENTRY]])
    wrapper.unmount()
  })

  it('emits the file to queue', async () => {
    const wrapper = mountPanel()

    await wrapper.get('.row-queue').trigger('click')

    expect(wrapper.emitted('queue')).toEqual([[ENTRY]])
    wrapper.unmount()
  })

  it('emits the file to play next', async () => {
    const wrapper = mountPanel()

    await wrapper.get('.row-next').trigger('click')

    expect(wrapper.emitted('next')).toEqual([[ENTRY]])
    wrapper.unmount()
  })

  it('asks for more when the page is smaller than the total', async () => {
    const wrapper = mountPanel({ total: 50 })

    await wrapper.get('.more .text-button').trigger('click')

    expect(wrapper.emitted('more')).toHaveLength(1)
    wrapper.unmount()
  })
})
