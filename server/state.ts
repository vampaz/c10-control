import { emptySpeakerState, type CommandRequest, type DeviceInfo, type PlayTarget, type SpeakerState } from '../shared/types.ts'
import type { SpeakerDevice } from './device.ts'
import { EMPTY_MEDIA_INFO, type MediaInfo } from './mediainfo.ts'
import { log, warn } from './log.ts'
import { SPEAKER_QUEUE_NAME } from './playqueue.ts'
import { inputFromMode, modeLabel } from './status.ts'

const POLL_INTERVAL_MS = 1500
const INFO_REFRESH_MS = 60_000
const MEDIA_REFRESH_MS = 60_000
/** A position this far behind the previous poll means a new track started. */
const RESTART_TOLERANCE_SECONDS = 2
const MISSES_BEFORE_OFFLINE = 2

type Listener = (state: SpeakerState) => void

/**
 * Polls the speaker while at least one client is listening and fans the result
 * out to every subscriber.
 */
export class SpeakerPoller {
  /** Called after every emitted state, for app-side features such as the queue. */
  onState: ((state: SpeakerState) => void) | null = null
  /** Resolves cover art for local library files, which carry no DIDL artwork. */
  artworkFor: ((url: string) => Promise<string | null>) | null = null
  /** Reports the position of finite tracks so they can resume later. */
  onPosition: ((url: string, position: number, duration: number, ended: boolean) => void) | null = null
  /** Returns the saved position for a track, or null to start at zero. */
  resumeFor: ((url: string) => number | null) | null = null
  private state: SpeakerState = emptySpeakerState()
  private readonly listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null
  private misses = 0
  private infoFetchedAt = 0
  private info: DeviceInfo | null = null
  private media: MediaInfo = EMPTY_MEDIA_INFO
  private mediaKey = ''
  private mediaFetchedAt = 0
  private lastPosition = 0
  private lastEmitted = ''
  private refreshing: Promise<void> | null = null
  private device: SpeakerDevice

  constructor(device: SpeakerDevice) {
    this.device = device
  }

  get current(): SpeakerState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (this.state.updatedAt > 0) {
      listener(this.state)
    }
    this.ensureRunning()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.stop()
      }
    }
  }

  /** Refreshes when the cached state is older than `maxAgeMs`. */
  async ensureFresh(maxAgeMs = 2000): Promise<void> {
    if (Date.now() - this.state.updatedAt > maxAgeMs) {
      await this.refresh()
    }
  }

  async refresh(): Promise<void> {
    // Collapse overlapping polls: the interval and a command can both trigger one.
    this.refreshing ??= this.pollOnce().finally(() => {
      this.refreshing = null
    })
    await this.refreshing
  }

  /**
   * Polls after a command. A poll that started before the command reached the
   * speaker would report the old value, so wait it out and read again.
   */
  private async refreshAfterCommand(): Promise<void> {
    if (this.refreshing) {
      await this.refreshing
    }
    await this.refresh()
  }

  private async pollOnce(): Promise<void> {
    try {
      const status = await this.device.getPlayerStatus()

      if (!this.info || Date.now() - this.infoFetchedAt > INFO_REFRESH_MS) {
        this.infoFetchedAt = Date.now()
        this.info = await this.device.getDeviceInfo().catch(() => this.info)
      }

      await this.refreshMedia(
        status.mode,
        status.title,
        status.position < this.lastPosition - RESTART_TOLERANCE_SECONDS,
      )
      this.lastPosition = status.position

      // Local files report `status: none`; UPnP knows whether they play or pause.
      const playbackStatus = status.duration > 0
        ? await this.device.getTransportState().catch(() => status.status)
        : status.status

      this.misses = 0
      const reconnected = this.state.connected === false && this.state.updatedAt > 0
      const artworkUrl = this.media.artworkUrl
        ?? (this.artworkFor ? await this.artworkFor(this.media.url) : null)
      this.state = {
        connected: true,
        device: this.info,
        playback: {
          status: playbackStatus,
          title: status.title,
          artist: status.artist,
          album: status.album,
          subtitle: this.media.subtitle,
          position: status.position,
          duration: status.duration,
          isLive: status.isLive,
          url: this.media.url,
          artworkUrl,
        },
        volume: { level: status.volume, muted: status.muted },
        source: modeLabel(status.mode),
        input: inputFromMode(status.mode),
        updatedAt: Date.now(),
        error: null,
      }

      if (!status.isLive && status.duration > 0 && this.media.url) {
        const ended = status.status === 'stopped' || status.position >= status.duration - 1
        this.onPosition?.(this.media.url, status.position, status.duration, ended)
      }

      if (reconnected) {
        log('Speaker reconnected')
      }
    } catch (error) {
      this.misses += 1
      if (this.misses === MISSES_BEFORE_OFFLINE) {
        warn('Speaker offline', error instanceof Error ? error.message : String(error))
      }
      if (this.misses >= MISSES_BEFORE_OFFLINE) {
        this.state = {
          ...this.state,
          connected: false,
          error: error instanceof Error ? error.message : 'The speaker is unreachable',
          updatedAt: Date.now(),
        }
      }
    }

    this.emit()
  }

  /**
   * Artwork and subtitle change with the track, not with the poll. Refetch when
   * the track identity changes and once a minute otherwise. A failure here must
   * not take the speaker offline.
   */
  private async refreshMedia(mode: number, title: string, restarted = false): Promise<void> {
    const key = `${mode}|${title}`
    if (restarted) {
      // Same title, new track: the media description belongs to the old one.
      this.mediaKey = ''
    }
    if (key === this.mediaKey && Date.now() - this.mediaFetchedAt < MEDIA_REFRESH_MS) {
      return
    }

    try {
      this.media = await this.device.getMediaInfo()
      this.mediaKey = key
      this.mediaFetchedAt = Date.now()
    } catch {
      // Keep the previous artwork; the next poll retries.
    }
  }

  async run(command: CommandRequest): Promise<void> {
    switch (command.type) {
      case 'play':
        await this.device.play()
        break
      case 'pause':
        await this.device.pause()
        break
      case 'toggle':
        if (this.state.playback.status === 'playing') {
          await this.device.pause()
        } else {
          await this.device.play()
        }
        break
      case 'stop':
        await this.device.stop()
        break
      case 'next':
        await this.device.next()
        break
      case 'previous':
        await this.device.previous()
        break
      case 'seek':
        await this.device.seek(Number(command.value ?? 0))
        break
      case 'volume':
        await this.device.setVolume(Number(command.value ?? 0))
        break
      case 'mute':
        await this.device.setMute(Boolean(command.value))
        break
      case 'input':
        await this.device.switchMode(String(command.value ?? ''))
        break
    }

    await this.refreshAfterCommand()
  }

  /** Pushes a stream or file to the speaker and starts it. */
  async playTarget(target: PlayTarget): Promise<void> {
    await this.device.playTarget(target)
    if (!target.isLive && this.resumeFor) {
      const position = this.resumeFor(target.url)
      if (position !== null && position > 0) {
        await this.device.seek(position).catch(() => undefined)
      }
    }
    await this.refreshAfterCommand()
  }

  /** Creates the device-side queue, plays an index and refreshes state. */
  async startSpeakerQueue(context: string, index: number): Promise<void> {
    await this.device.deletePlayQueue(SPEAKER_QUEUE_NAME).catch(() => undefined)
    await this.device.createPlayQueue(context)
    await this.device.playPlayQueue(SPEAKER_QUEUE_NAME, index)
    await this.refreshAfterCommand()
  }

  /** Reads the device-side queue as a PlayList document. */
  async browseSpeakerQueue(): Promise<string> {
    return this.device.browsePlayQueue(SPEAKER_QUEUE_NAME).catch(() => '')
  }

  async deleteSpeakerQueue(): Promise<void> {
    await this.device.deletePlayQueue(SPEAKER_QUEUE_NAME).catch(() => undefined)
  }

  /** Replaces the device after the address changed in the UI. */
  useDevice(device: SpeakerDevice): void {
    this.device = device
    this.info = null
    this.infoFetchedAt = 0
    this.media = EMPTY_MEDIA_INFO
    this.mediaKey = ''
    this.mediaFetchedAt = 0
    this.lastPosition = 0
    this.misses = 0
    this.lastEmitted = ''
    void this.refresh()
  }

  private ensureRunning(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS)
    void this.refresh()
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private emit(): void {
    const serialised = JSON.stringify(this.state)
    if (serialised === this.lastEmitted) {
      return
    }
    this.lastEmitted = serialised
    for (const listener of this.listeners) {
      listener(this.state)
    }
    this.onState?.(this.state)
  }
}
