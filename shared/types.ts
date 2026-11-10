/** Player modes reported by the Linkplay firmware in `mode`. */
export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'idle'

export interface DeviceInfo {
  host: string
  name: string
  model: string
  firmware: string
  uuid: string
}

export interface PlaybackState {
  status: PlaybackStatus
  title: string
  artist: string
  album: string
  subtitle: string
  position: number
  duration: number
  isLive: boolean
  /** URI the speaker is playing, when the firmware reports one. */
  url: string
  artworkUrl: string | null
}

export interface VolumeState {
  level: number
  muted: boolean
}

export interface SpeakerState {
  connected: boolean
  device: DeviceInfo | null
  playback: PlaybackState
  volume: VolumeState
  /** Human readable source, for example "Wi-Fi" or "Bluetooth". */
  source: string
  /** Physical input or network mode, when it is one we can switch to. */
  input: SpeakerInput | null
  updatedAt: number
  error: string | null
}

export type SpeakerInput = 'wifi' | 'bluetooth' | 'line-in' | 'optical'

export type CommandType =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'stop'
  | 'seek'
  | 'volume'
  | 'mute'
  | 'input'

export interface CommandRequest {
  type: CommandType
  /** Seconds for `seek`, 0-100 for `volume`, boolean for `mute`, input name for `input`. */
  value?: number | boolean | string
}

export interface DiscoveredDevice {
  host: string
  name: string
  model: string
  location: string
}

/** Anything the app can push to the speaker. */
export interface PlayTarget {
  url: string
  title?: string
  artist?: string
  artworkUrl?: string | null
  /** False for a finite track, true (default) for a live stream. */
  isLive?: boolean
}

export interface RadioStation {
  /** Station id from the directory, or a hash of the URL for custom streams. */
  id: string
  name: string
  url: string
  country: string
  tags: string
  codec: string
  bitrate: number
  artworkUrl: string | null
}

export interface Favorite extends RadioStation {
  addedAt: number
}

export interface AppConfig {
  host: string
  httpPort: number
  upnpPort: number
  /** Folders scanned for local audio. */
  libraries: LibraryRoot[]
  /** Parent folders the settings dialog may browse. */
  browseRoots: string[]
  /** Base URL the speaker can reach this app on, empty to auto-detect. */
  mediaBaseUrl: string
  /** True when C10_HOST pins the address, so the UI cannot change it. */
  pinnedHost?: boolean
}

export interface FolderEntry {
  name: string
  path: string
}

export interface FolderListing {
  path: string
  parent: string | null
  roots: string[]
  folders: FolderEntry[]
}

export interface LibraryRoot {
  id: string
  name: string
  path: string
}

export interface LibraryEntry {
  id: string
  libraryId: string
  libraryName: string
  name: string
  /** Path relative to its library folder. */
  path: string
  size: number
  modifiedAt: number
  /** URL the speaker can fetch. */
  url: string
}

export interface LibraryListing {
  libraries: LibraryRoot[]
  entries: LibraryEntry[]
  /** Number of files that match the query, before the page slice. */
  total: number
  query: string
  limit: number
  offset: number
  mediaBaseUrl: string
}

export interface SleepStatus {
  /** Epoch milliseconds when playback will stop, or null when no timer runs. */
  endsAt: number | null
}

export interface QueueItem extends PlayTarget {
  id: string
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueSnapshot {
  items: QueueItem[]
  activeIndex: number | null
  repeat: RepeatMode
  shuffle: boolean
}

export interface PlaylistItem extends PlayTarget {
  id: string
}

export interface Playlist {
  id: string
  name: string
  items: PlaylistItem[]
  createdAt: number
  updatedAt: number
}

export const EMPTY_PLAYBACK: PlaybackState = {
  status: 'idle',
  title: '',
  artist: '',
  album: '',
  subtitle: '',
  position: 0,
  duration: 0,
  isLive: false,
  url: '',
  artworkUrl: null,
}

export function emptySpeakerState(): SpeakerState {
  return {
    connected: false,
    device: null,
    playback: { ...EMPTY_PLAYBACK },
    volume: { level: 0, muted: false },
    source: 'Unknown',
    input: null,
    updatedAt: 0,
    error: null,
  }
}
