import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeakerPoller } from '../server/state.ts'
import { QueueController } from '../server/queue.ts'
import type { SpeakerDevice } from '../server/device.ts'
import type { PlayerStatus } from '../server/status.ts'
import type { PlaybackStatus, PlayTarget } from '../shared/types.ts'
import type { MediaInfo } from '../server/mediainfo.ts'

const TRACK: PlayTarget = {
  url: 'http://192.168.1.135:8787/api/library/file?library=main&path=a.mp3',
  title: 'Track 1',
  isLive: false,
}

const INFO = {
  host: '192.168.1.100',
  name: 'Office',
  model: 'AudioPro_C10',
  firmware: '4.2.337151',
  uuid: '0123456789ABCDEF01234567',
}

function playerStatus(overrides: Partial<PlayerStatus> = {}): PlayerStatus {
  return {
    status: 'playing',
    mode: 10,
    title: 'Rádio Oxigénio',
    artist: 'unknown',
    album: 'unknown',
    volume: 12,
    muted: false,
    position: 42,
    duration: 0,
    isLive: true,
    ...overrides,
  }
}

interface FakeDeviceOptions {
  status?: () => Promise<PlayerStatus>
  mediaInfo?: () => Promise<MediaInfo>
}

function fakeDevice(options: FakeDeviceOptions = {}) {
  const calls = {
    getPlayerStatus: vi.fn(options.status ?? (async () => playerStatus())),
    getDeviceInfo: vi.fn(async () => INFO),
    getMediaInfo: vi.fn(options.mediaInfo ?? (async () => ({
      url: 'http://proic1.redeaudio.com/oxigenio_aac',
      title: 'Rádio Oxigénio',
      subtitle: 'Música para Respirar',
      artworkUrl: 'https://example.com/logo.jpg',
      isLive: true,
    }))),
    getTransportState: vi.fn(async (): Promise<PlaybackStatus> => 'playing'),
    play: vi.fn(async () => undefined),
    playTarget: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    seek: vi.fn(async (_seconds: number) => undefined),
    setVolume: vi.fn(async (_level: number) => undefined),
    setMute: vi.fn(async (_muted: boolean) => undefined),
  }

  return { device: calls as unknown as SpeakerDevice, calls }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SpeakerPoller.refresh', () => {
  it('maps the speaker status into application state', async () => {
    const { device } = fakeDevice()
    const poller = new SpeakerPoller(device)

    await poller.refresh()

    expect(poller.current).toMatchObject({
      connected: true,
      source: 'Radio',
      input: 'wifi',
      volume: { level: 12, muted: false },
      playback: {
        status: 'playing',
        title: 'Rádio Oxigénio',
        subtitle: 'Música para Respirar',
        position: 42,
        isLive: true,
        url: 'http://proic1.redeaudio.com/oxigenio_aac',
        artworkUrl: 'https://example.com/logo.jpg',
      },
      error: null,
    })
  })

  it('reuses media metadata until the track changes', async () => {
    const { device, calls } = fakeDevice()
    const poller = new SpeakerPoller(device)

    await poller.refresh()
    await poller.refresh()

    expect(calls.getMediaInfo).toHaveBeenCalledOnce()
  })

  it('keeps the speaker online when the media description fails', async () => {
    const { device, calls } = fakeDevice()
    calls.getMediaInfo.mockRejectedValue(new Error('GetMediaInfo failed'))
    const poller = new SpeakerPoller(device)

    await poller.refresh()

    expect(poller.current.connected).toBe(true)
    expect(poller.current.playback.artworkUrl).toBeNull()
  })

  it('reports positions and resumes a saved one before playback', async () => {
    const status = async () => playerStatus({ mode: 2, duration: 200, position: 30, isLive: false })
    const { device, calls } = fakeDevice({ status })
    const poller = new SpeakerPoller(device)
    const seen: number[] = []
    poller.onPosition = (_url, position) => seen.push(position)

    await poller.refresh()
    expect(seen).toContain(30)

    poller.resumeFor = () => 42
    await poller.playTarget({ url: 'http://192.168.1.135:8787/api/library/file?library=main&path=a.mp3', isLive: false })

    expect(calls.seek).toHaveBeenCalledWith(42)
  })

  it('refetches media when a track restarts under the same title', async () => {
    let position = 100
    let mediaUrl = 'http://192.168.1.135:8787/api/library/file?path=a.mp3'
    const status = async () => playerStatus({ mode: 2, duration: 200, position, isLive: false })
    const mediaInfo = async (): Promise<MediaInfo> => ({
      url: mediaUrl,
      title: 'Track 01',
      subtitle: '',
      artworkUrl: null,
      isLive: false,
    })
    const { device, calls } = fakeDevice({ status, mediaInfo })
    const poller = new SpeakerPoller(device)

    await poller.refresh()
    expect(calls.getMediaInfo).toHaveBeenCalledOnce()

    position = 150
    await poller.refresh()
    expect(calls.getMediaInfo).toHaveBeenCalledOnce()

    mediaUrl = 'http://192.168.1.135:8787/api/library/file?path=b.mp3'
    position = 0
    await poller.refresh()

    expect(calls.getMediaInfo).toHaveBeenCalledTimes(2)
    expect(poller.current.playback.url).toBe('http://192.168.1.135:8787/api/library/file?path=b.mp3')
  })

  it('asks the library for artwork when the speaker reports none', async () => {
    const mediaInfo = async (): Promise<MediaInfo> => ({
      url: 'http://192.168.1.135:8787/api/library/file?library=main&path=a.flac',
      title: 'Track',
      subtitle: '',
      artworkUrl: null,
      isLive: false,
    })
    const { device } = fakeDevice({ mediaInfo, status: async () => playerStatus({ mode: 2, duration: 240 }) })
    const poller = new SpeakerPoller(device)
    poller.artworkFor = async (url) => url.includes('/api/library/file') ? '/api/library/art?library=main&path=a.flac' : null

    await poller.refresh()

    expect(poller.current.playback.artworkUrl).toBe('/api/library/art?library=main&path=a.flac')
  })

  it('fills artist and album from the queue when the speaker reports none', async () => {
    const mediaInfo = async (): Promise<MediaInfo> => ({
      url: TRACK.url,
      title: 'Track 1',
      subtitle: '',
      artworkUrl: null,
      isLive: false,
    })
    // `playerStatus` defaults artist and album to the firmware's "unknown".
    const { device } = fakeDevice({
      mediaInfo,
      status: async () => playerStatus({ mode: 2, title: 'Track 1', duration: 200, isLive: false }),
    })
    const poller = new SpeakerPoller(device)
    poller.metadataFor = async (url) => (url === TRACK.url ? { ...TRACK, artist: 'Artist', album: 'Album' } : null)

    await poller.refresh()

    expect(poller.current.playback.artist).toBe('Artist')
    expect(poller.current.playback.album).toBe('Album')
  })

  it('keeps the artist and album the speaker reports', async () => {
    const { device } = fakeDevice({
      status: async () => playerStatus({ artist: 'Real Artist', album: 'Real Album' }),
    })
    const poller = new SpeakerPoller(device)
    poller.metadataFor = async () => ({ url: 'http://unused', artist: 'Queue Artist', album: 'Queue Album' })

    await poller.refresh()

    expect(poller.current.playback.artist).toBe('Real Artist')
    expect(poller.current.playback.album).toBe('Real Album')
  })

  it('uses the UPnP transport state for a paused local file', async () => {
    const { device, calls } = fakeDevice({
      status: async () => playerStatus({ status: 'playing', duration: 12, isLive: false }),
    })
    calls.getTransportState.mockResolvedValue('paused')
    const poller = new SpeakerPoller(device)

    await poller.refresh()

    expect(calls.getTransportState).toHaveBeenCalledOnce()
    expect(poller.current.playback.status).toBe('paused')
  })

  it('fetches device info once and reuses it', async () => {
    const { device, calls } = fakeDevice()
    const poller = new SpeakerPoller(device)

    await poller.refresh()
    await poller.refresh()

    expect(calls.getDeviceInfo).toHaveBeenCalledOnce()
    expect(poller.current.device?.name).toBe('Office')
  })

  it('stays connected after a single failed poll', async () => {
    const failing = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(playerStatus())
    const { device } = fakeDevice({ status: failing })
    const poller = new SpeakerPoller(device)

    await poller.refresh()
    expect(poller.current.connected).toBe(false)

    await poller.refresh()
    expect(poller.current.connected).toBe(true)
  })

  it('reports the speaker offline after two failures and keeps the reason', async () => {
    const { device } = fakeDevice({ status: async () => Promise.reject(new Error('EHOSTUNREACH')) })
    const poller = new SpeakerPoller(device)

    await poller.refresh()
    await poller.refresh()

    expect(poller.current.connected).toBe(false)
    expect(poller.current.error).toBe('EHOSTUNREACH')
    expect(poller.current.updatedAt).toBeGreaterThan(0)
  })

  it('shares one device request between overlapping refreshes', async () => {
    let resolve: (status: PlayerStatus) => void = () => undefined
    const pending = new Promise<PlayerStatus>((done) => {
      resolve = done
    })
    const { device, calls } = fakeDevice({ status: () => pending })
    const poller = new SpeakerPoller(device)

    const first = poller.refresh()
    const second = poller.refresh()
    resolve(playerStatus())
    await Promise.all([first, second])

    expect(calls.getPlayerStatus).toHaveBeenCalledOnce()
  })

  it('does not answer a command with a poll that started before it', async () => {
    let volume = 12
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // Every poll returns the volume captured when it was requested.
    const status = (): Promise<PlayerStatus> => {
      const snapshot = playerStatus({ volume })
      return gate.then(() => snapshot)
    }
    const { device, calls } = fakeDevice({ status })
    calls.setVolume.mockImplementation(async (next: number) => {
      volume = next
    })

    const poller = new SpeakerPoller(device)
    const inFlight = poller.refresh()
    const command = poller.run({ type: 'volume', value: 33 })
    release()
    await Promise.all([inFlight, command])

    expect(poller.current.volume.level).toBe(33)
  })
})

describe('SpeakerPoller.run', () => {
  it('forwards a volume command and refreshes the state', async () => {
    const { device, calls } = fakeDevice()
    const poller = new SpeakerPoller(device)

    await poller.run({ type: 'volume', value: 30 })

    expect(calls.setVolume).toHaveBeenCalledWith(30)
    expect(calls.getPlayerStatus).toHaveBeenCalled()
  })

  it('toggles playback based on the current state', async () => {
    const { device, calls } = fakeDevice()
    const poller = new SpeakerPoller(device)

    await poller.refresh()
    await poller.run({ type: 'toggle' })
    expect(calls.pause).toHaveBeenCalledOnce()

    const paused = fakeDevice({ status: async () => playerStatus({ status: 'paused' }) })
    const pausedPoller = new SpeakerPoller(paused.device)
    await pausedPoller.refresh()
    await pausedPoller.run({ type: 'toggle' })
    expect(paused.calls.play).toHaveBeenCalledOnce()
  })
})

describe('SpeakerPoller.subscribe', () => {
  it('emits the current state to new listeners once one is known', async () => {
    const { device } = fakeDevice()
    const poller = new SpeakerPoller(device)
    await poller.refresh()

    const seen: string[] = []
    const unsubscribe = poller.subscribe((state) => seen.push(state.playback.title))
    unsubscribe()

    expect(seen).toContain('Rádio Oxigénio')
  })

  it('does not emit an empty state before the first poll', () => {
    const { device } = fakeDevice()
    const poller = new SpeakerPoller(device)

    const seen: number[] = []
    const unsubscribe = poller.subscribe((state) => seen.push(state.updatedAt))
    unsubscribe()

    expect(seen).toHaveLength(0)
  })

  it('keeps polling after the last client leaves while the queue has an active track', async () => {
    vi.useFakeTimers()
    const { device, calls } = fakeDevice()
    const poller = new SpeakerPoller(device)
    // Mirrors the runtime wiring: an active queue keeps the poller alive.
    const queue = new QueueController(async () => undefined)
    poller.keepAlive = () => queue.snapshot().activeIndex !== null
    await queue.replace([TRACK])

    const unsubscribe = poller.subscribe(() => undefined)
    // Let the first poll finish, so no poll is in flight when the client leaves.
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    const before = calls.getPlayerStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(4_500)

    expect(calls.getPlayerStatus.mock.calls.length).toBeGreaterThan(before)

    queue.clear()
    await vi.advanceTimersByTimeAsync(1_500)
    const settled = calls.getPlayerStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(4_500)

    expect(calls.getPlayerStatus.mock.calls.length).toBe(settled)
  })

  it('stops polling when the last client leaves and nothing asks for it', async () => {
    vi.useFakeTimers()
    const { device, calls } = fakeDevice()
    const poller = new SpeakerPoller(device)

    const unsubscribe = poller.subscribe(() => undefined)
    unsubscribe()
    await vi.advanceTimersByTimeAsync(1_500)
    const settled = calls.getPlayerStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(4_500)

    expect(calls.getPlayerStatus.mock.calls.length).toBe(settled)
  })

  it('advances the queue after the client leaves when the track ends', async () => {
    vi.useFakeTimers()
    let status: PlayerStatus = playerStatus({
      mode: 2, title: 'Track 1', status: 'playing', duration: 200, position: 10, isLive: false,
    })
    const { device, calls } = fakeDevice({
      status: async () => status,
      mediaInfo: async () => ({ url: TRACK.url, title: 'Track 1', subtitle: '', artworkUrl: null, isLive: false }),
    })
    const poller = new SpeakerPoller(device)
    const played: PlayTarget[] = []
    const queue = new QueueController(async (target) => {
      played.push(target)
    })
    // Both hooks are wired by the runtime; this client is about to disappear.
    poller.onState = (state) => void queue.onState(state)
    poller.keepAlive = () => queue.snapshot().activeIndex !== null
    const second: PlayTarget = { ...TRACK, title: 'Track 2', url: `${TRACK.url}&n=2` }
    await queue.replace([TRACK, second])

    const unsubscribe = poller.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(queue.snapshot().activeIndex).toBe(0)

    // The track ends with no client listening.
    status = playerStatus({ mode: 2, title: 'Track 1', status: 'stopped', duration: 200, position: 200, isLive: false })
    calls.getTransportState.mockResolvedValue('stopped')
    await vi.advanceTimersByTimeAsync(1_500)

    expect(played).toHaveLength(2)
    expect(queue.snapshot().activeIndex).toBe(1)

    const after = calls.getPlayerStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(1_500)

    expect(calls.getPlayerStatus.mock.calls.length).toBeGreaterThan(after)
  })
})
