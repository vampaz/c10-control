import { describe, expect, it, vi } from 'vitest'
import { SpeakerPoller } from '../server/state.ts'
import type { SpeakerDevice } from '../server/device.ts'
import type { PlayerStatus } from '../server/status.ts'
import type { PlaybackStatus } from '../shared/types.ts'
import type { MediaInfo } from '../server/mediainfo.ts'

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
    pause: vi.fn(async () => undefined),
    setVolume: vi.fn(async (_level: number) => undefined),
    setMute: vi.fn(async (_muted: boolean) => undefined),
  }

  return { device: calls as unknown as SpeakerDevice, calls }
}

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
    poller.artworkFor = (url) => url.includes('/api/library/file') ? '/api/library/art?library=main&path=a.flac' : null

    await poller.refresh()

    expect(poller.current.playback.artworkUrl).toBe('/api/library/art?library=main&path=a.flac')
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
})
