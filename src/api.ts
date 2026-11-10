import type { AlbumListing, AppConfig, CommandRequest, DeviceDetails, DiscoveredDevice, Favorite, FolderListing, LibraryListing, Playlist, PlayTarget, QueueSnapshot, RadioStation, RepeatMode, SleepStatus, SpeakerState } from '@shared/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed with HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function fetchState(): Promise<SpeakerState> {
  return request<SpeakerState>('/api/state')
}

export function sendCommand(command: CommandRequest): Promise<SpeakerState> {
  return request<SpeakerState>('/api/command', {
    method: 'POST',
    body: JSON.stringify(command),
  })
}

export function fetchConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/config')
}

export function fetchDeviceDetails(): Promise<DeviceDetails> {
  return request<DeviceDetails>('/api/device')
}

export function renameSpeaker(name: string): Promise<{ name: string }> {
  return request<{ name: string }>('/api/device/name', {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

export function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  return request<AppConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function discoverDevices(): Promise<DiscoveredDevice[]> {
  const result = await request<{ devices: DiscoveredDevice[] }>('/api/discovery')
  return result.devices
}

export async function playStream(target: PlayTarget): Promise<SpeakerState> {
  return request<SpeakerState>('/api/play', {
    method: 'POST',
    body: JSON.stringify(target),
  })
}

/** Plays a library file with the rest of its folder queued behind it. */
export function playLibraryFolder(libraryId: string, path: string, shuffle?: boolean): Promise<QueueSnapshot> {
  const body: Record<string, unknown> = { library: libraryId, path }
  if (shuffle !== undefined) {
    body.shuffle = shuffle
  }
  return request<QueueSnapshot>('/api/library/play', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Plays a whole album folder, including its disc subfolders. */
export function playLibraryAlbum(libraryId: string, dirs: string[], shuffle?: boolean): Promise<QueueSnapshot> {
  const body: Record<string, unknown> = { library: libraryId, dirs }
  if (shuffle !== undefined) {
    body.shuffle = shuffle
  }
  return request<QueueSnapshot>('/api/library/play', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function searchRadio(query: string): Promise<RadioStation[]> {
  const result = await request<{ stations: RadioStation[] }>(`/api/radio/search?q=${encodeURIComponent(query)}`)
  return result.stations
}

export async function fetchTopStations(limit = 20, offset = 0): Promise<RadioStation[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const result = await request<{ stations: RadioStation[] }>(`/api/radio/top?${params}`)
  return result.stations
}

export function fetchLibrary(query = '', limit = 200, offset = 0, libraryId = '', dir = ''): Promise<LibraryListing> {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })
  if (libraryId) {
    params.set('library', libraryId)
  }
  if (dir) {
    params.set('dir', dir)
  }
  return request<LibraryListing>(`/api/library?${params}`)
}

export function fetchAlbums(query = '', limit = 60, offset = 0, libraryId = ''): Promise<AlbumListing> {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })
  if (libraryId) {
    params.set('library', libraryId)
  }
  return request<AlbumListing>(`/api/library/albums?${params}`)
}

export function fetchFolders(path = ''): Promise<FolderListing> {
  const params = new URLSearchParams()
  if (path) {
    params.set('path', path)
  }
  return request<FolderListing>(`/api/folders?${params}`)
}

export async function listFavorites(): Promise<Favorite[]> {
  const result = await request<{ favorites: Favorite[] }>('/api/favorites')
  return result.favorites
}

export async function addFavorite(station: RadioStation): Promise<Favorite[]> {
  const result = await request<{ favorites: Favorite[] }>('/api/favorites', {
    method: 'POST',
    body: JSON.stringify(station),
  })
  return result.favorites
}

export async function removeFavorite(id: string): Promise<Favorite[]> {
  const result = await request<{ favorites: Favorite[] }>(`/api/favorites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  return result.favorites
}

export async function listPresets(): Promise<(PlayTarget | null)[]> {
  const result = await request<{ presets: (PlayTarget | null)[] }>('/api/presets')
  return result.presets
}

export async function savePreset(index: number, target: PlayTarget): Promise<(PlayTarget | null)[]> {
  const result = await request<{ presets: (PlayTarget | null)[] }>(`/api/presets/${index}`, {
    method: 'PUT',
    body: JSON.stringify(target),
  })
  return result.presets
}

export async function clearPreset(index: number): Promise<(PlayTarget | null)[]> {
  const result = await request<{ presets: (PlayTarget | null)[] }>(`/api/presets/${index}`, {
    method: 'DELETE',
  })
  return result.presets
}

export function getSleep(): Promise<SleepStatus> {
  return request<SleepStatus>('/api/sleep')
}

export function startSleep(minutes: number): Promise<SleepStatus> {
  return request<SleepStatus>('/api/sleep', {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  })
}

export function cancelSleep(): Promise<SleepStatus> {
  return request<SleepStatus>('/api/sleep', { method: 'DELETE' })
}

export function fetchQueue(): Promise<QueueSnapshot> {
  return request<QueueSnapshot>('/api/queue')
}

export function setQueueMode(patch: { repeat?: RepeatMode; shuffle?: boolean }): Promise<QueueSnapshot> {
  return request<QueueSnapshot>('/api/queue/mode', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function addToQueue(target: PlayTarget): Promise<QueueSnapshot> {
  return request<QueueSnapshot>('/api/queue', {
    method: 'POST',
    body: JSON.stringify(target),
  })
}

export function removeFromQueue(id: string): Promise<QueueSnapshot> {
  return request<QueueSnapshot>(`/api/queue/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function clearQueue(): Promise<QueueSnapshot> {
  return request<QueueSnapshot>('/api/queue', { method: 'DELETE' })
}

export function playNext(target: PlayTarget): Promise<QueueSnapshot> {
  return request<QueueSnapshot>('/api/queue/next-up', {
    method: 'POST',
    body: JSON.stringify(target),
  })
}

export function moveQueue(from: number, to: number): Promise<QueueSnapshot> {
  return request<QueueSnapshot>('/api/queue/move', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  })
}

export function startSpeakerQueue(): Promise<{ ok: boolean; tracks: number }> {
  return request<{ ok: boolean; tracks: number }>('/api/speaker-queue', { method: 'POST' })
}

export function playQueue(index = 0): Promise<QueueSnapshot> {
  return request<QueueSnapshot>('/api/queue/play', {
    method: 'POST',
    body: JSON.stringify({ index }),
  })
}

async function playlistRequest(path: string, init?: RequestInit): Promise<Playlist[]> {
  const result = await request<{ playlists: Playlist[] }>(path, init)
  return result.playlists
}

export function fetchPlaylists(): Promise<Playlist[]> {
  return playlistRequest('/api/playlists')
}

export function createPlaylist(name: string): Promise<Playlist[]> {
  return playlistRequest('/api/playlists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function renamePlaylist(id: string, name: string): Promise<Playlist[]> {
  return playlistRequest(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

export function deletePlaylist(id: string): Promise<Playlist[]> {
  return playlistRequest(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function addCurrentToPlaylist(id: string): Promise<Playlist[]> {
  return playlistRequest(`/api/playlists/${encodeURIComponent(id)}/current`, { method: 'POST' })
}

export function removePlaylistItem(id: string, itemId: string): Promise<Playlist[]> {
  return playlistRequest(`/api/playlists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  })
}

export function playPlaylist(id: string): Promise<QueueSnapshot> {
  return request<QueueSnapshot>(`/api/playlists/${encodeURIComponent(id)}/play`, { method: 'POST' })
}

export function subscribeState(onState: (state: SpeakerState) => void, onStatus: (open: boolean) => void): () => void {
  const source = new EventSource('/api/events')
  source.onopen = () => onStatus(true)
  source.onerror = () => onStatus(false)
  source.onmessage = (event) => {
    onState(JSON.parse(event.data) as SpeakerState)
  }

  return () => source.close()
}
