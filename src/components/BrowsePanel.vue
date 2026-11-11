<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { AlbumListing, Favorite, LibraryAlbum, LibraryEntry, LibraryListing, Playlist, QueueSnapshot, RadioStation } from '@shared/types'
import {
  addCurrentToPlaylist,
  addFavorite,
  addToQueue,
  clearQueue,
  createPlaylist,
  deletePlaylist,
  fetchAlbums,
  fetchLibrary,
  fetchPlaylists,
  fetchQueue,
  fetchTopStations,
  listFavorites,
  moveQueue,
  playLibraryAlbum,
  playLibraryFolder,
  playNext,
  playPlaylist,
  playQueue,
  playStream,
  removeFavorite,
  removeFromQueue,
  removePlaylistItem,
  renamePlaylist,
  searchRadio,
  startSpeakerQueue,
  subscribeState,
} from '@/api'
import { titleForUrl } from '@/format'
import AppIcon from '@/components/AppIcon.vue'
import AlbumGrid from '@/components/AlbumGrid.vue'
import LibraryPanel from '@/components/LibraryPanel.vue'
import PlaylistsPanel from '@/components/PlaylistsPanel.vue'
import QueuePanel from '@/components/QueuePanel.vue'

type BrowseTab = 'radio' | 'library' | 'queue' | 'playlists'

const props = withDefaults(defineProps<{ initialTab?: BrowseTab }>(), { initialTab: 'radio' })

const emit = defineEmits<{ close: [] }>()

const tab = ref<BrowseTab>(props.initialTab)
const favorites = ref<Favorite[]>([])
const results = ref<RadioStation[]>([])
const query = ref('')
const searching = ref(false)
const searched = ref(false)
const busyUrl = ref<string | null>(null)
const customUrl = ref('')
const error = ref<string | null>(null)
const topStations = ref<RadioStation[]>([])
const stationsLoading = ref(false)
const stationsError = ref<string | null>(null)
const stationsDone = ref(false)
const speakerNote = ref<string | null>(null)
const scrollArea = ref<HTMLElement | null>(null)
const STATION_PAGE = 20
const STATION_LIST_MAX = 200
let stationsGeneration = 0
let stationsOffset = 0
const library = shallowRef<LibraryListing>({
  libraries: [],
  entries: [],
  total: 0,
  query: '',
  limit: 200,
  offset: 0,
  mediaBaseUrl: '',
})
const libraryLoading = ref(false)
const libraryError = ref<string | null>(null)
const libraryFilter = ref('')
const albums = shallowRef<AlbumListing>({ libraries: [], albums: [], total: 0, query: '', limit: 60, offset: 0 })
const albumsLoading = ref(false)
const albumsError = ref<string | null>(null)
const albumsLoaded = ref(false)
const selectedAlbum = ref<LibraryAlbum | null>(null)
const queue = shallowRef<QueueSnapshot>({ items: [], activeIndex: null, repeat: 'off', shuffle: false, order: [] })
const queueError = ref<string | null>(null)
const playlists = ref<Playlist[]>([])
const selectedPlaylist = ref('')
const playlistError = ref<string | null>(null)

const drawer = ref<HTMLElement | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null
let libraryTimer: ReturnType<typeof setTimeout> | null = null
let libraryGeneration = 0
let albumGeneration = 0
let queueController: AbortController | null = null
let unsubscribeState: (() => void) | null = null
let lastPlayingUrl = ''
const playingUrl = ref('')

const libraryLibraries = computed(() => albums.value.libraries.length
  ? albums.value.libraries
  : library.value.libraries)

const favoriteUrls = computed(() => new Set(favorites.value.map((entry) => entry.url)))

onMounted(async () => {
  drawer.value?.focus()
  document.body.classList.add('drawer-open')
  try {
    favorites.value = await listFavorites()
  } catch (cause) {
    error.value = message(cause)
  }
  void loadAlbums()
  void loadQueue()
  void loadPlaylists()
  void loadTopStations(true)

  // Auto-advance changes the queue on the server, so follow track changes.
  unsubscribeState = subscribeState(
    (state) => {
      playingUrl.value = state.playback.url
      if (state.playback.url !== lastPlayingUrl) {
        const first = lastPlayingUrl === ''
        lastPlayingUrl = state.playback.url
        if (!first) {
          void loadQueue()
        }
      }
    },
    () => undefined,
  )
})

onBeforeUnmount(() => {
  document.body.classList.remove('drawer-open')
  unsubscribeState?.()
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  if (libraryTimer) {
    clearTimeout(libraryTimer)
    libraryTimer = null
  }
})

let touchStartX = 0
let touchStartY = 0

function onTouchStart(event: TouchEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select')) {
    touchStartX = 0
    return
  }
  const touch = event.touches[0]
  touchStartX = touch.clientX
  touchStartY = touch.clientY
}

function onTouchEnd(event: TouchEvent): void {
  if (touchStartX === 0) {
    return
  }
  const touch = event.changedTouches[0]
  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  touchStartX = 0
  // A right swipe closes the full-screen drawer on a phone.
  if (dx > 90 && Math.abs(dy) < 60) {
    emit('close')
  }
}

async function loadPlaylists(): Promise<void> {
  try {
    playlists.value = await fetchPlaylists()
    if (!selectedPlaylist.value && playlists.value.length) {
      selectedPlaylist.value = playlists.value[0].id
    }
  } catch (cause) {
    playlistError.value = message(cause)
  }
}

async function createNewPlaylist(name: string): Promise<void> {
  playlistError.value = null
  try {
    playlists.value = await createPlaylist(name)
    const created = playlists.value.at(-1)
    if (created) {
      selectedPlaylist.value = created.id
    }
  } catch (cause) {
    playlistError.value = message(cause)
  }
}

async function renameSelectedPlaylist(id: string, name: string): Promise<void> {
  playlistError.value = null
  try {
    playlists.value = await renamePlaylist(id, name)
  } catch (cause) {
    playlistError.value = message(cause)
  }
}

async function deleteSelectedPlaylist(id: string): Promise<void> {
  playlistError.value = null
  try {
    playlists.value = await deletePlaylist(id)
    if (selectedPlaylist.value === id) {
      selectedPlaylist.value = playlists.value[0]?.id ?? ''
    }
  } catch (cause) {
    playlistError.value = message(cause)
  }
}

async function addCurrentTrack(id: string): Promise<void> {
  playlistError.value = null
  try {
    playlists.value = await addCurrentToPlaylist(id)
  } catch (cause) {
    playlistError.value = message(cause)
  }
}

async function removeItemFromPlaylist(id: string, itemId: string): Promise<void> {
  playlistError.value = null
  try {
    playlists.value = await removePlaylistItem(id, itemId)
  } catch (cause) {
    playlistError.value = message(cause)
  }
}

async function playSelectedPlaylist(id: string): Promise<void> {
  playlistError.value = null
  try {
    queue.value = await playPlaylist(id)
    tab.value = 'queue'
  } catch (cause) {
    playlistError.value = message(cause)
  }
}

/** Fetches the queue, aborting any previous in-flight queue request. */
async function requestQueue(): Promise<QueueSnapshot | null> {
  queueController?.abort()
  const controller = new AbortController()
  queueController = controller
  try {
    const snapshot = await fetchQueue(controller.signal)
    return queueController === controller ? snapshot : null
  } catch (cause) {
    if (queueController !== controller || isAbortError(cause)) {
      return null
    }
    throw cause
  }
}

async function loadQueue(): Promise<void> {
  try {
    const snapshot = await requestQueue()
    if (snapshot) {
      queue.value = snapshot
    }
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function addTrackToQueue(entry: LibraryEntry): Promise<void> {
  queueError.value = null
  try {
    queue.value = await addToQueue({ url: entry.url, title: entry.name, isLive: false })
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function playTrackNext(entry: LibraryEntry): Promise<void> {
  queueError.value = null
  try {
    queue.value = await playNext({ url: entry.url, title: entry.name, isLive: false })
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function moveQueued(from: number, to: number): Promise<void> {
  queueError.value = null
  try {
    queue.value = await moveQueue(from, to)
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function handOffQueue(): Promise<void> {
  queueError.value = null
  speakerNote.value = null
  try {
    await startSpeakerQueue()
    const snapshot = await requestQueue()
    if (snapshot) {
      queue.value = snapshot
    }
    speakerNote.value = 'Playing from the speaker’s own queue. Next and previous now use the device.'
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function playQueued(index: number): Promise<void> {
  queueError.value = null
  try {
    queue.value = await playQueue(index)
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function removeQueued(id: string): Promise<void> {
  queueError.value = null
  try {
    queue.value = await removeFromQueue(id)
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function clearQueued(): Promise<void> {
  queueError.value = null
  try {
    queue.value = await clearQueue()
  } catch (cause) {
    queueError.value = message(cause)
  }
}

async function loadLibrary(reset = true): Promise<void> {
  const generation = ++libraryGeneration
  libraryLoading.value = true
  libraryError.value = null
  try {
    const offset = reset ? 0 : library.value.entries.length
    const album = selectedAlbum.value
    const page = await fetchLibrary(
      query.value.trim(),
      200,
      offset,
      album ? album.libraryId : libraryFilter.value,
      album ? album.path : '',
    )
    if (generation !== libraryGeneration) {
      return
    }
    if (libraryFilter.value && !page.libraries.some((library) => library.id === libraryFilter.value)) {
      libraryFilter.value = ''
    }
    library.value = reset
      ? page
      : { ...page, entries: [...library.value.entries, ...page.entries] }
  } catch (cause) {
    if (generation === libraryGeneration) {
      libraryError.value = message(cause)
    }
  } finally {
    if (generation === libraryGeneration) {
      libraryLoading.value = false
    }
  }
}

function loadMoreLibrary(): void {
  if (!libraryLoading.value) {
    void loadLibrary(false)
  }
}

async function loadAlbums(reset = true): Promise<void> {
  const generation = ++albumGeneration
  albumsLoading.value = true
  albumsError.value = null
  try {
    const offset = reset ? 0 : albums.value.albums.length
    const page = await fetchAlbums(query.value.trim(), 60, offset, libraryFilter.value)
    if (generation !== albumGeneration) {
      return
    }
    if (libraryFilter.value && !page.libraries.some((library) => library.id === libraryFilter.value)) {
      libraryFilter.value = ''
    }
    albums.value = reset
      ? page
      : { ...page, albums: [...albums.value.albums, ...page.albums] }
    albumsLoaded.value = true
  } catch (cause) {
    if (generation === albumGeneration) {
      albumsError.value = message(cause)
    }
  } finally {
    if (generation === albumGeneration) {
      albumsLoading.value = false
    }
  }
}

function loadMoreAlbums(): void {
  if (!albumsLoading.value) {
    void loadAlbums(false)
  }
}

function openAlbum(album: LibraryAlbum): void {
  selectedAlbum.value = album
  query.value = ''
  void loadLibrary(true)
}

function closeAlbum(): void {
  selectedAlbum.value = null
  query.value = ''
  void loadAlbums(true)
}

function setLibrary(id: string): void {
  libraryFilter.value = id
  selectedAlbum.value = null
  query.value = ''
  void loadAlbums(true)
}

function onLibrarySelect(event: Event): void {
  setLibrary((event.target as HTMLSelectElement).value)
}

function setTab(next: BrowseTab): void {
  tab.value = next
  query.value = ''
  error.value = null
  if (next === 'library') {
    selectedAlbum.value = null
    void loadAlbums(true)
  }
  if (next === 'radio' && !topStations.value.length && !stationsLoading.value) {
    void loadTopStations(true)
  }
}

function onScroll(): void {
  const area = scrollArea.value
  if (!area || tab.value !== 'radio' || query.value.trim() || stationsLoading.value || stationsDone.value) {
    return
  }
  if (area.scrollTop + area.clientHeight >= area.scrollHeight - 200) {
    void loadTopStations(false)
  }
}

async function loadTopStations(reset = false): Promise<void> {
  if (stationsLoading.value) {
    return
  }
  const generation = ++stationsGeneration
  stationsLoading.value = true
  stationsError.value = null
  try {
    const offset = reset ? 0 : stationsOffset
    const page = await fetchTopStations(STATION_PAGE, offset)
    if (generation !== stationsGeneration) {
      return
    }

    // The directory pages by raw rows, so advance by the page size, not by
    // the number of stations that survived filtering.
    stationsOffset = offset + STATION_PAGE
    const seen = new Set(topStations.value.map((station) => station.id))
    const additions = page.filter((station) => !seen.has(station.id))
    const next = reset ? page : [...topStations.value, ...additions]
    // Cap the accumulated list: clamp at STATION_LIST_MAX and stop paging further.
    topStations.value = next.length > STATION_LIST_MAX ? next.slice(0, STATION_LIST_MAX) : next
    stationsDone.value = page.length === 0 || topStations.value.length >= STATION_LIST_MAX
  } catch (cause) {
    if (generation === stationsGeneration) {
      stationsError.value = message(cause)
    }
  } finally {
    if (generation === stationsGeneration) {
      stationsLoading.value = false
    }
  }
}

const searchPlaceholder = computed(() => {
  if (tab.value === 'radio') {
    return 'Search radio stations'
  }
  if (tab.value === 'library') {
    return selectedAlbum.value ? 'Filter this album' : 'Search albums'
  }
  return 'Filter this folder'
})

watch(query, (value) => {
  if (tab.value === 'library') {
    if (libraryTimer) {
      clearTimeout(libraryTimer)
    }
    libraryTimer = setTimeout(() => {
      if (selectedAlbum.value) {
        void loadLibrary(true)
      } else {
        void loadAlbums(true)
        if (query.value.trim()) {
          void loadLibrary(true)
        }
      }
    }, 300)
    return
  }
  if (tab.value !== 'radio') {
    return
  }
  if (searchTimer) {
    clearTimeout(searchTimer)
  }

  const text = value.trim()
  if (text.length < 2) {
    results.value = []
    searched.value = false
    searching.value = false
    return
  }

  searchTimer = setTimeout(() => void runSearch(text), 350)
})

async function runSearch(text: string): Promise<void> {
  searching.value = true
  error.value = null
  try {
    const stations = await searchRadio(text)
    if (query.value.trim() === text) {
      results.value = stations
      searched.value = true
    }
  } catch (cause) {
    error.value = message(cause)
  } finally {
    searching.value = false
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Something went wrong'
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

function favoriteFor(url: string): Favorite | undefined {
  return favorites.value.find((entry) => entry.url === url)
}

async function toggleFavorite(station: RadioStation): Promise<void> {
  const existing = favoriteFor(station.url)
  error.value = null
  try {
    favorites.value = existing ? await removeFavorite(existing.id) : await addFavorite(station)
  } catch (cause) {
    error.value = message(cause)
  }
}

async function play(target: { url: string; title: string; artworkUrl: string | null; isLive?: boolean }): Promise<void> {
  busyUrl.value = target.url
  error.value = null
  try {
    await playStream({ ...target, isLive: target.isLive ?? true })
  } catch (cause) {
    error.value = message(cause)
  } finally {
    busyUrl.value = null
  }
}

async function playStation(station: RadioStation): Promise<void> {
  await play({ url: station.url, title: station.name, artworkUrl: station.artworkUrl })
}

async function playLibrary(entry: LibraryEntry): Promise<void> {
  busyUrl.value = entry.url
  error.value = null
  try {
    queue.value = await playLibraryFolder(entry.libraryId, entry.path)
  } catch (cause) {
    error.value = message(cause)
  } finally {
    busyUrl.value = null
  }
}

/** Starts the open album from its first track, optionally shuffled. */
async function playAlbum(shuffle: boolean): Promise<void> {
  const album = selectedAlbum.value
  if (!album) {
    return
  }
  busyUrl.value = 'album'
  error.value = null
  try {
    queue.value = await playLibraryAlbum(album.libraryId, album.dirs, shuffle)
  } catch (cause) {
    error.value = message(cause)
  } finally {
    busyUrl.value = null
  }
}

async function playCustom(): Promise<void> {
  const url = customUrl.value.trim()
  if (!url) {
    return
  }
  await play({ url, title: titleForUrl(url), artworkUrl: null })
}

function meta(station: RadioStation): string {
  return [
    station.country,
    station.tags,
    station.codec,
    station.bitrate > 0 ? `${station.bitrate} kbps` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <aside
    id="browse-panel"
    ref="drawer"
    class="drawer"
    aria-labelledby="browse-title"
    tabindex="-1"
    @keydown.esc="emit('close')"
    @touchstart.passive="onTouchStart"
    @touchend="onTouchEnd"
  >
    <header class="drawer-head">
      <h2 id="browse-title">Browse</h2>
      <button type="button" class="icon-button" aria-label="Close browse" @click="emit('close')">
        <AppIcon name="close" :size="18" />
      </button>
    </header>

    <div class="tabs" role="tablist" aria-label="Browse source">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'radio'"
        :class="{ active: tab === 'radio' }"
        @click="setTab('radio')"
      >
        Radio
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'library'"
        :class="{ active: tab === 'library' }"
        @click="setTab('library')"
      >
        Library
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'queue'"
        :class="{ active: tab === 'queue' }"
        @click="setTab('queue')"
      >
        Queue<span v-if="queue.items.length" class="count">{{ queue.items.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'playlists'"
        :class="{ active: tab === 'playlists' }"
        @click="setTab('playlists')"
      >
        Playlists
      </button>
    </div>

    <label v-if="tab === 'radio' || tab === 'library'" class="search">
      <AppIcon name="search" :size="16" />
      <input
        v-model="query"
        type="search"
        :placeholder="searchPlaceholder"
        autocomplete="off"
        spellcheck="false"
      />
    </label>

    <p v-if="error && tab === 'radio'" class="error" role="alert">{{ error }}</p>

    <div ref="scrollArea" class="scroll" @scroll.passive="onScroll">
      <template v-if="tab === 'radio'">
        <section class="stream-box">
          <span class="stream-label">Play a stream URL</span>
          <div class="stream-row">
            <input
              v-model="customUrl"
              type="url"
              placeholder="https://…"
              autocomplete="off"
              spellcheck="false"
              aria-label="Stream URL"
              @keydown.enter="playCustom"
            />
            <button type="button" class="primary" :disabled="!customUrl.trim() || busyUrl !== null" @click="playCustom">
              Play
            </button>
          </div>
        </section>
        <section v-if="!query.trim()" class="group">
          <h3>Favorites</h3>
          <ul v-if="favorites.length" class="list">
            <li v-for="station in favorites" :key="station.id" class="row">
              <button
                type="button"
                class="row-main"
                :class="{ pending: busyUrl === station.url }"
                :disabled="busyUrl !== null"
                @click="playStation(station)"
              >
                <span class="row-name">{{ station.name }}</span>
                <span class="row-meta">{{ meta(station) || 'Saved station' }}</span>
              </button>
              <button
                type="button"
                class="star"
                :aria-pressed="true"
                :aria-label="`Remove ${station.name} from favorites`"
                @click="toggleFavorite(station)"
              >
                <AppIcon name="starFilled" :size="17" />
              </button>
            </li>
          </ul>
          <p v-else class="hint">No favorites yet. Tap the star on a station.</p>
        </section>

        <section v-if="!query.trim()" class="group">
          <h3>Stations</h3>
          <p v-if="stationsError" class="error" role="alert">{{ stationsError }}</p>
          <ul v-else-if="topStations.length" class="list">
            <li v-for="station in topStations" :key="station.id" class="row">
              <button
                type="button"
                class="row-main"
                :class="{ pending: busyUrl === station.url }"
                :disabled="busyUrl !== null"
                @click="playStation(station)"
              >
                <span class="row-name">{{ station.name }}</span>
                <span class="row-meta">{{ meta(station) }}</span>
              </button>
              <button
                type="button"
                class="star"
                :aria-pressed="favoriteUrls.has(station.url)"
                :aria-label="`${favoriteUrls.has(station.url) ? 'Remove' : 'Add'} ${station.name} ${favoriteUrls.has(station.url) ? 'from' : 'to'} favorites`"
                @click="toggleFavorite(station)"
              >
                <AppIcon :name="favoriteUrls.has(station.url) ? 'starFilled' : 'star'" :size="17" />
              </button>
            </li>
          </ul>
          <p v-else-if="stationsLoading" class="hint">Loading stations…</p>
          <p v-else class="hint">No stations available right now.</p>

          <div class="stations-more">
            <button
              v-if="topStations.length && !stationsDone"
              type="button"
              class="text-button"
              :disabled="stationsLoading"
              @click="loadTopStations(false)"
            >
              {{ stationsLoading ? 'Loading…' : 'Show more stations' }}
            </button>
          </div>
        </section>

        <section v-if="query.trim()" class="group">
          <h3>{{ searching ? 'Searching…' : 'Results' }}</h3>
          <ul v-if="results.length" class="list">
            <li v-for="station in results" :key="station.id" class="row">
              <button
                type="button"
                class="row-main"
                :class="{ pending: busyUrl === station.url }"
                :disabled="busyUrl !== null"
                @click="playStation(station)"
              >
                <span class="row-name">{{ station.name }}</span>
                <span class="row-meta">{{ meta(station) }}</span>
              </button>
              <button
                type="button"
                class="star"
                :aria-pressed="favoriteUrls.has(station.url)"
                :aria-label="`${favoriteUrls.has(station.url) ? 'Remove' : 'Add'} ${station.name} ${favoriteUrls.has(station.url) ? 'from' : 'to'} favorites`"
                @click="toggleFavorite(station)"
              >
                <AppIcon :name="favoriteUrls.has(station.url) ? 'starFilled' : 'star'" :size="17" />
              </button>
            </li>
          </ul>
          <p v-else-if="searched && !searching" class="hint">Nothing found for “{{ query.trim() }}”.</p>
          <p v-else-if="searching" class="hint">Looking up stations…</p>
        </section>
      </template>

      <template v-else-if="tab === 'library'">
        <label v-if="libraryLibraries.length" class="picker">
          <span class="picker-label">Library</span>
          <select :value="libraryFilter" @change="onLibrarySelect">
            <option value="">All libraries</option>
            <option v-for="entry in libraryLibraries" :key="entry.id" :value="entry.id">
              {{ entry.name }}
            </option>
          </select>
        </label>

        <p v-if="albumsError" class="error" role="alert">{{ albumsError }}</p>

        <p v-else-if="!libraryLibraries.length && !albumsLoaded" class="hint">
          Reading the library…
        </p>

        <p v-else-if="!libraryLibraries.length" class="hint">
          Add a music folder in Speaker settings to play files from this machine.
        </p>

        <template v-else-if="selectedAlbum">
          <div class="album-head">
            <button type="button" class="album-back" @click="closeAlbum">
              <AppIcon name="previous" :size="13" />
              Albums
            </button>
            <div class="album-actions">
              <button
                type="button"
                class="album-action"
                :disabled="!library.entries.length || busyUrl !== null"
                @click="playAlbum(false)"
              >
                Play
              </button>
              <button
                type="button"
                class="album-action"
                :disabled="!library.entries.length || busyUrl !== null"
                @click="playAlbum(true)"
              >
                Shuffle
              </button>
            </div>
          </div>
          <p class="album-title">{{ selectedAlbum.name }}</p>
          <p v-if="libraryError" class="error" role="alert">{{ libraryError }}</p>
          <p v-else-if="libraryLoading && !library.entries.length" class="hint">Reading the album…</p>
          <LibraryPanel
            v-else
            :entries="library.entries"
            :total="library.total"
            :media-base-url="library.mediaBaseUrl"
            :playing-url="playingUrl"
            :query="query"
            :busy="busyUrl !== null"
            :loading="libraryLoading"
            @play="playLibrary"
            @queue="addTrackToQueue"
            @next="playTrackNext"
            @more="loadMoreLibrary"
          />
        </template>

        <template v-else>
          <AlbumGrid
            :albums="albums.albums"
            :total="albums.total"
            :loading="albumsLoading"
            :busy="busyUrl !== null"
            @open="openAlbum"
            @more="loadMoreAlbums"
          />

          <template v-if="query.trim()">
            <p v-if="libraryError" class="error" role="alert">{{ libraryError }}</p>
            <LibraryPanel
              :entries="library.entries"
              :total="library.total"
              :media-base-url="library.mediaBaseUrl"
              :playing-url="playingUrl"
              :query="query"
              :busy="busyUrl !== null"
              :loading="libraryLoading"
              @play="playLibrary"
              @queue="addTrackToQueue"
              @next="playTrackNext"
              @more="loadMoreLibrary"
            />
          </template>
        </template>
      </template>

      <template v-else-if="tab === 'queue'">
        <p v-if="queueError" class="error" role="alert">{{ queueError }}</p>
        <p v-if="speakerNote" class="hint">{{ speakerNote }}</p>
        <QueuePanel
          :items="queue.items"
          :active-index="queue.activeIndex"
          :order="queue.order"
          :busy="busyUrl !== null"
          @play="playQueued"
          @remove="removeQueued"
          @move="moveQueued"
          @speaker="handOffQueue"
          @clear="clearQueued"
        />
      </template>

      <template v-else>
        <p v-if="playlistError" class="error" role="alert">{{ playlistError }}</p>
        <PlaylistsPanel
          :playlists="playlists"
          :selected-id="selectedPlaylist"
          :busy="busyUrl !== null"
          @create="createNewPlaylist"
          @select="selectedPlaylist = $event"
          @rename="renameSelectedPlaylist"
          @remove="deleteSelectedPlaylist"
          @play="playSelectedPlaylist"
          @add-current="addCurrentTrack"
          @remove-item="removeItemFromPlaylist"
        />
      </template>
    </div>
  </aside>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset-block: 0;
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: min(480px, 100%);
  height: 100%;
  /* Standalone phones draw under the status bar and home bar. */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  border-left: 1px solid var(--line);
  background: var(--surface);
  box-shadow: -40px 0 80px -40px var(--shadow);
  animation: slide-in 220ms ease-out;
  overscroll-behavior: contain;
}

@keyframes slide-in {
  from {
    transform: translateX(16px);
  }
  to {
    transform: none;
  }
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 10px;
}

.drawer-head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.tabs {
  display: flex;
  gap: 4px;
  margin: 0 20px 10px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
}

.tabs button {
  flex: 1;
  padding: 7px 10px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--ink-faint);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.tabs button.active {
  background: var(--surface-hover);
  color: var(--ink);
}

.count {
  margin-left: 4px;
  font-size: 0.68rem;
  color: var(--accent);
}

.picker {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 20px 10px;
}

.picker-label {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.picker select {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--ink);
  font: inherit;
  font-size: 0.8rem;
}

.album-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0 20px 8px;
}

.album-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.album-back:hover {
  color: var(--accent-strong);
}

.album-actions {
  display: flex;
  gap: 6px;
}

.album-action {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: none;
  color: var(--ink-dim);
  font: inherit;
  font-size: 0.74rem;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}

.album-action:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--ink);
}

.album-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.album-title {
  margin: 0 20px 10px;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--ink);
}

.stations-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
}

.search {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 20px 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--ink-faint);
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  outline: none;
}

.search input::-webkit-search-cancel-button {
  filter: invert(0.6);
}

.error {
  margin: 0 20px 8px;
  font-size: 0.84rem;
  color: var(--danger);
}

.scroll {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 20px 16px;
}

.group h3 {
  margin: 12px 0 6px;
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 10px;
  transition: background 140ms ease;
  content-visibility: auto;
  contain-intrinsic-size: auto 60px;
}

.row:hover {
  background: var(--hover);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 9px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  text-align: left;
  cursor: pointer;
}

.row-main:disabled {
  cursor: progress;
}

/* Only the row that started the request shows progress; dimming every row
   while one stream opens makes the whole list flash. */
.row-main.pending {
  opacity: 0.6;
}

.row-name {
  overflow: hidden;
  font-size: 0.92rem;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  overflow: hidden;
  font-size: 0.74rem;
  color: var(--ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.star {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
  transition: color 140ms ease, transform 120ms ease;
}

.star:hover {
  color: var(--accent);
}

.star:active {
  transform: scale(0.92);
}

.star[aria-pressed='true'] {
  color: var(--accent);
}

.hint {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: var(--ink-faint);
}

.stream-box {
  display: grid;
  gap: 8px;
  margin: 0 0 16px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface-sunken);
}

.stream-label {
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.stream-row {
  display: flex;
  gap: 10px;
}

.stream-row input {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface-raised);
  color: var(--ink);
  font: inherit;
  font-size: 0.86rem;
}

.stream-row input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

@media (max-width: 900px) {
  .drawer {
    width: 100%;
    border-left: 0;
  }
}

@media (max-width: 520px) {
  .drawer-head .icon-button {
    width: 44px;
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .drawer {
    animation: none;
  }
}
</style>
