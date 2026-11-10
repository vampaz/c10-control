import type { PlaybackStatus, SpeakerInput } from '../shared/types.ts'
import { unescapeXml } from './soap.ts'

/** Raw fields of `httpapi.asp?command=getPlayerStatus`. */
export interface PlayerStatus {
  status: PlaybackStatus
  mode: number
  title: string
  artist: string
  album: string
  volume: number
  muted: boolean
  position: number
  duration: number
  isLive: boolean
}

const STATUS_MAP: Record<string, PlaybackStatus> = {
  play: 'playing',
  playing: 'playing',
  pause: 'paused',
  paused: 'paused',
  stop: 'stopped',
  stopped: 'stopped',
  idle: 'idle',
}

/**
 * Linkplay firmware reports non-ASCII text as a hex encoded UTF-8 string and
 * leaves plain ASCII untouched. Decode only when the result is readable text,
 * so titles such as "unknown" survive. Titles we pushed are also stored and
 * echoed back with their XML entities intact, so unescape them here.
 */
export function decodeText(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!value || value.length < 4 || value.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(value)) {
    return unescapeXml(value)
  }

  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Control characters mean the payload was a plain string that happened to be hex-shaped.
    return hasControlCharacters(text) ? value : unescapeXml(text)
  } catch {
    return unescapeXml(value)
  }
}

function hasControlCharacters(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * Source labels by firmware mode code. Modes 2 (a URI pushed over UPnP) and 10
 * (the firmware's own TuneIn player) were observed on this C10; the others
 * follow the Linkplay convention and are unverified here. Unknown codes fall
 * back to "Source N".
 */
const MODE_LABELS: Record<number, string> = {
  0: 'Idle',
  1: 'AirPlay',
  2: 'Stream',
  10: 'Radio',
  11: 'Wi-Fi (direct)',
  31: 'Spotify Connect',
  40: 'Aux in',
  41: 'Bluetooth',
  43: 'Optical',
  44: 'Coaxial',
  45: 'HDMI',
  47: 'USB',
  48: 'USB Audio',
}

export function modeLabel(mode: number): string {
  return MODE_LABELS[mode] ?? `Source ${mode}`
}

const INPUT_BY_MODE: Record<number, SpeakerInput> = {
  2: 'wifi',
  10: 'wifi',
  11: 'wifi',
  40: 'line-in',
  41: 'bluetooth',
  43: 'optical',
}

/** Maps the UPnP transport state to the app's playback status. */
export function mapTransportState(raw: string | undefined): PlaybackStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'PLAYING':
    case 'TRANSITIONING':
      return 'playing'
    case 'PAUSED_PLAYBACK':
    case 'PAUSED':
      return 'paused'
    case 'STOPPED':
      return 'stopped'
    default:
      return 'idle'
  }
}

/** Maps a firmware mode to one of the inputs the app can switch to. */
export function inputFromMode(mode: number): SpeakerInput | null {
  return INPUT_BY_MODE[mode] ?? null
}

function toNumber(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The firmware reports `curpos` and `totlen` in milliseconds. */
function toSeconds(raw: string | undefined): number {
  return Math.max(0, Math.round(toNumber(raw) / 1000))
}

export function parsePlayerStatus(raw: Record<string, string>): PlayerStatus {
  const duration = toSeconds(raw.totlen)
  const mode = toNumber(raw.mode)
  const rawStatus = (raw.status ?? '').toLowerCase()
  // Local files report status "none" while they play; a duration tells them apart.
  const status = rawStatus === 'none' && duration > 0
    ? 'playing'
    : STATUS_MAP[rawStatus] ?? 'idle'

  return {
    status,
    mode,
    title: decodeText(raw.Title),
    artist: decodeText(raw.Artist),
    album: decodeText(raw.Album),
    volume: toNumber(raw.vol),
    muted: raw.mute === '1',
    position: toSeconds(raw.curpos),
    duration,
    // Live streams (internet radio, AirPlay, Spotify) report no total length.
    isLive: duration === 0,
  }
}

/** `httpapi.asp` answers with JSON, HTML or the literal string `unknown command`. */
export function parsePlayerStatusPayload(payload: string): PlayerStatus {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('{')) {
    throw new Error(trimmed === 'unknown command'
      ? 'The speaker rejected the status request'
      : 'Unexpected response from the speaker')
  }

  const parsed = JSON.parse(trimmed) as Record<string, string>
  return parsePlayerStatus(parsed)
}
