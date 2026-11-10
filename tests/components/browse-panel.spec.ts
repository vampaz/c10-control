// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlbumListing, Favorite, LibraryListing, Playlist, QueueSnapshot } from '@shared/types'

const favorites = vi.fn<() => Promise<Favorite[]>>()
const addFavorite = vi.fn(async (_station: unknown): Promise<Favorite[]> => [])
const removeFavorite = vi.fn(async (_id: string): Promise<Favorite[]> => [])
const playStream = vi.fn(async (_target: unknown) => undefined)
const playLibraryFolder = vi.fn(async (_library: string, _path: string, _shuffle?: boolean): Promise<QueueSnapshot> => emptyQueue)
const playLibraryAlbum = vi.fn(async (_library: string, _dir: string, _shuffle?: boolean): Promise<QueueSnapshot> => emptyQueue)
const playNext = vi.fn(async (_target: unknown): Promise<QueueSnapshot> => emptyQueue)
const moveQueue = vi.fn(async (_from: number, _to: number): Promise<QueueSnapshot> => emptyQueue)
const subscribeState = vi.fn((_onState: (state: unknown) => void, _onStatus: (open: boolean) => void) => () => undefined)
const searchRadio = vi.fn(async (_query: string) => [])
const fetchLibrary = vi.fn<() => Promise<LibraryListing>>(async () => ({
  libraries: [],
  entries: [],
  total: 0,
  query: '',
  limit: 200,
  offset: 0,
  mediaBaseUrl: '',
}))
const emptyQueue: QueueSnapshot = { items: [], activeIndex: null, repeat: 'off', shuffle: false, order: [] }
const ALBUM = {
  id: 'al',
  name: 'Album',
  path: 'Album',
  libraryId: 'main',
  libraryName: 'Main',
  trackCount: 1,
  artworkUrl: '/api/library/art?library=main&path=Album%2FTrack.mp3',
}
const fetchAlbums = vi.fn<() => Promise<AlbumListing>>(async () => ({
  libraries: [{ id: 'main', name: 'Main', path: '/music' }],
  albums: [ALBUM],
  total: 1,
  query: '',
  limit: 60,
  offset: 0,
}))
const fetchQueue = vi.fn<() => Promise<QueueSnapshot>>(async () => emptyQueue)
const addToQueue = vi.fn<(target: unknown) => Promise<QueueSnapshot>>(async () => emptyQueue)
const removeFromQueue = vi.fn<(id: string) => Promise<QueueSnapshot>>(async () => emptyQueue)
const clearQueue = vi.fn<() => Promise<QueueSnapshot>>(async () => emptyQueue)
const playQueue = vi.fn<(index: number) => Promise<QueueSnapshot>>(async () => emptyQueue)
const fetchPlaylists = vi.fn<() => Promise<Playlist[]>>(async () => [])
const createPlaylist = vi.fn<(name: string) => Promise<Playlist[]>>(async () => [])
const renamePlaylist = vi.fn<(id: string, name: string) => Promise<Playlist[]>>(async () => [])
const deletePlaylist = vi.fn<(id: string) => Promise<Playlist[]>>(async () => [])
const addCurrentToPlaylist = vi.fn<(id: string) => Promise<Playlist[]>>(async () => [])
const removePlaylistItem = vi.fn<(id: string, itemId: string) => Promise<Playlist[]>>(async () => [])
const playPlaylist = vi.fn<(id: string) => Promise<QueueSnapshot>>(async () => emptyQueue)

vi.mock('@/api', () => ({
  listFavorites: () => favorites(),
  addFavorite: (station: unknown) => addFavorite(station),
  removeFavorite: (id: string) => removeFavorite(id),
  playStream: (target: unknown) => playStream(target),
  playLibraryFolder: (...args: [string, string, boolean?]) => playLibraryFolder(...args),
  playLibraryAlbum: (...args: [string, string, boolean?]) => playLibraryAlbum(...args),
  playNext: (target: unknown) => playNext(target),
  moveQueue: (from: number, to: number) => moveQueue(from, to),
  subscribeState: (onState: (state: unknown) => void, onStatus: (open: boolean) => void) => subscribeState(onState, onStatus),
  searchRadio: (query: string) => searchRadio(query),
  fetchLibrary: () => fetchLibrary(),
  fetchAlbums: () => fetchAlbums(),
  fetchQueue: () => fetchQueue(),
  addToQueue: (target: unknown) => addToQueue(target),
  removeFromQueue: (id: string) => removeFromQueue(id),
  clearQueue: () => clearQueue(),
  playQueue: (index: number) => playQueue(index),
  fetchPlaylists: () => fetchPlaylists(),
  createPlaylist: (name: string) => createPlaylist(name),
  renamePlaylist: (id: string, name: string) => renamePlaylist(id, name),
  deletePlaylist: (id: string) => deletePlaylist(id),
  addCurrentToPlaylist: (id: string) => addCurrentToPlaylist(id),
  removePlaylistItem: (id: string, itemId: string) => removePlaylistItem(id, itemId),
  playPlaylist: (id: string) => playPlaylist(id),
}))

const STATION: Favorite = {
  id: 'fip-jazz',
  name: 'FIP Jazz',
  url: 'http://icecast.radiofrance.fr/fipjazz-hifi.aac',
  country: 'France',
  tags: 'jazz',
  codec: 'AAC',
  bitrate: 192,
  artworkUrl: null,
  addedAt: 1,
}

async function mountPanel() {
  const { default: BrowsePanel } = await import('@/components/BrowsePanel.vue')
  const wrapper = mount(BrowsePanel, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  favorites.mockReset()
  addFavorite.mockReset()
  removeFavorite.mockReset()
  playStream.mockClear()
  searchRadio.mockClear()
  fetchLibrary.mockClear()
  fetchQueue.mockClear()
  addToQueue.mockClear()
  removeFromQueue.mockClear()
  clearQueue.mockClear()
  playQueue.mockClear()
  fetchPlaylists.mockClear()
  createPlaylist.mockClear()
  renamePlaylist.mockClear()
  deletePlaylist.mockClear()
  addCurrentToPlaylist.mockClear()
  removePlaylistItem.mockClear()
  playPlaylist.mockClear()
})

describe('BrowsePanel', () => {
  it('lists saved favorites', async () => {
    favorites.mockResolvedValue([STATION])
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('FIP Jazz')
    expect(wrapper.text()).toContain('France')
    wrapper.unmount()
  })

  it('explains an empty favorites list', async () => {
    favorites.mockResolvedValue([])
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('No favorites yet')
    wrapper.unmount()
  })

  it('plays a favorite and stays open', async () => {
    favorites.mockResolvedValue([STATION])
    const wrapper = await mountPanel()

    await wrapper.get('.row-main').trigger('click')
    await flushPromises()

    expect(playStream).toHaveBeenCalledWith({
      url: STATION.url,
      title: 'FIP Jazz',
      artworkUrl: null,
      isLive: true,
    })
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('removes a favorite from the star', async () => {
    favorites.mockResolvedValue([STATION])
    removeFavorite.mockResolvedValue([])
    const wrapper = await mountPanel()

    await wrapper.get('.star').trigger('click')
    await flushPromises()

    expect(removeFavorite).toHaveBeenCalledWith('fip-jazz')
    expect(wrapper.text()).toContain('No favorites yet')
    wrapper.unmount()
  })

  it('closes on the close button and on Escape', async () => {
    favorites.mockResolvedValue([])
    const wrapper = await mountPanel()

    await wrapper.get('button[aria-label="Close browse"]').trigger('click')
    await wrapper.get('.drawer').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })

  it('disables the stream button until a URL is present', async () => {
    favorites.mockResolvedValue([])
    const wrapper = await mountPanel()

    expect((wrapper.get('.drawer-foot .primary').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('.stream-row input').setValue('http://example.com/live')
    expect((wrapper.get('.drawer-foot .primary').element as HTMLButtonElement).disabled).toBe(false)
    wrapper.unmount()
  })

  it('plays a file from an album through its folder', async () => {
    favorites.mockResolvedValue([])
    fetchLibrary.mockResolvedValue({
      libraries: [{ id: 'main', name: 'Main', path: '/music' }],
      mediaBaseUrl: 'http://192.168.1.135:5173',
      entries: [{ id: 'a', libraryId: 'main', libraryName: 'Main', name: 'Track', path: 'Album/Track.mp3', size: 10, modifiedAt: 1, url: 'http://192.168.1.135:5173/api/library/file?library=main&path=Album%2FTrack.mp3' }],
      total: 1,
      query: '',
      limit: 200,
      offset: 0,
    })
    const wrapper = await mountPanel()

    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Album')

    await wrapper.get('.card').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Track')

    await wrapper.get('.row-main').trigger('click')
    await flushPromises()

    expect(playLibraryFolder).toHaveBeenCalledWith('main', 'Album/Track.mp3')
    expect(playStream).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('starts the open album from the action buttons', async () => {
    favorites.mockResolvedValue([])
    fetchLibrary.mockResolvedValue({
      libraries: [{ id: 'main', name: 'Main', path: '/music' }],
      mediaBaseUrl: 'http://192.168.1.135:5173',
      entries: [{ id: 'a', libraryId: 'main', libraryName: 'Main', name: 'Track', path: 'Album/Track.mp3', size: 10, modifiedAt: 1, url: 'http://192.168.1.135:5173/api/library/file?library=main&path=Album%2FTrack.mp3' }],
      total: 1,
      query: '',
      limit: 200,
      offset: 0,
    })
    const wrapper = await mountPanel()

    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()
    await wrapper.get('.card').trigger('click')
    await flushPromises()

    const actions = wrapper.findAll('.album-action')
    await actions[0].trigger('click')
    await flushPromises()
    expect(playLibraryAlbum).toHaveBeenLastCalledWith('main', 'Album', false)

    await actions[1].trigger('click')
    await flushPromises()
    expect(playLibraryAlbum).toHaveBeenLastCalledWith('main', 'Album', true)
    wrapper.unmount()
  })

  it('adds a library file to the queue', async () => {
    favorites.mockResolvedValue([])
    fetchLibrary.mockResolvedValue({
      libraries: [{ id: 'main', name: 'Main', path: '/music' }],
      mediaBaseUrl: 'http://192.168.1.135:5173',
      entries: [{ id: 'a', libraryId: 'main', libraryName: 'Main', name: 'Track', path: 'Album/Track.mp3', size: 10, modifiedAt: 1, url: 'http://192.168.1.135:5173/api/library/file?library=main&path=Album%2FTrack.mp3' }],
      total: 1,
      query: '',
      limit: 200,
      offset: 0,
    })
    const wrapper = await mountPanel()

    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()
    await wrapper.get('.card').trigger('click')
    await flushPromises()
    await wrapper.get('.row-queue').trigger('click')
    await flushPromises()

    expect(addToQueue).toHaveBeenCalledWith({
      url: 'http://192.168.1.135:5173/api/library/file?library=main&path=Album%2FTrack.mp3',
      title: 'Track',
      isLive: false,
    })
    wrapper.unmount()
  })

  it('reloads the queue when the playing track changes', async () => {
    favorites.mockResolvedValue([])
    const wrapper = await mountPanel()
    const notify = subscribeState.mock.calls[0]?.[0] as (state: { playback: { url: string } }) => void
    notify({ playback: { url: 'http://192.168.1.135:5173/api/library/file?library=main&path=First.mp3' } })
    await flushPromises()
    fetchQueue.mockClear()

    notify({ playback: { url: 'http://192.168.1.135:5173/api/library/file?library=main&path=Track.mp3' } })
    await flushPromises()

    expect(fetchQueue).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('creates a playlist from the playlists tab', async () => {    favorites.mockResolvedValue([])
    fetchPlaylists.mockResolvedValue([])
    createPlaylist.mockResolvedValue([{ id: 'p1', name: 'Mix', items: [], createdAt: 1, updatedAt: 1 }])
    const wrapper = await mountPanel()

    await wrapper.findAll('.tabs button')[3].trigger('click')
    await wrapper.get('.create input').setValue('Mix')
    await wrapper.get('.create .primary').trigger('click')
    await flushPromises()

    expect(createPlaylist).toHaveBeenCalledWith('Mix')
    wrapper.unmount()
  })
})
