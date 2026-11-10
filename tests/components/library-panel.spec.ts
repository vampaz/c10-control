// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { LibraryEntry, LibraryRoot } from '@shared/types'
import LibraryPanel from '@/components/LibraryPanel.vue'

const LIBRARIES: LibraryRoot[] = [
  { id: 'main', name: 'Main', path: '/music' },
  { id: 'extra', name: 'Extra', path: '/other' },
]

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
  libraries: LibraryRoot[]
  selectedLibrary: string
  mediaBaseUrl: string
  query: string
  busy: boolean
  loading: boolean
}> = {}) {
  return mount(LibraryPanel, {
    props: {
      entries: [ENTRY],
      total: 1,
      libraries: LIBRARIES,
      selectedLibrary: '',
      mediaBaseUrl: 'http://192.168.1.135:5173',
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

  it('shows the library picker and reports a change', async () => {
    const wrapper = mountPanel()

    const select = wrapper.get('select')
    await select.setValue('extra')

    expect(wrapper.emitted('select')).toEqual([['extra']])
    wrapper.unmount()
  })

  it('explains an empty folder', () => {
    const wrapper = mountPanel({ entries: [], total: 0, query: '' })

    expect(wrapper.text()).toContain('No audio files')
    wrapper.unmount()
  })

  it('asks for a folder when none is configured', () => {
    const wrapper = mountPanel({ libraries: [], entries: [], total: 0 })

    expect(wrapper.text()).toContain('Add a music folder')
    wrapper.unmount()
  })

  it('warns when the media URL is not reachable by the speaker', () => {
    const wrapper = mountPanel({ mediaBaseUrl: 'http://localhost:5173' })

    expect(wrapper.text()).toContain('cannot reach')
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

  it('asks for more when the page is smaller than the total', async () => {
    const wrapper = mountPanel({ total: 50 })

    await wrapper.get('.more .text-button').trigger('click')

    expect(wrapper.emitted('more')).toHaveLength(1)
    wrapper.unmount()
  })
})
