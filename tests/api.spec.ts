// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySpeakerState, type SpeakerState } from '@shared/types'

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  readyState = FakeEventSource.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  closed = false
  url: string
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN
    this.onopen?.()
  }

  emit(state: SpeakerState): void {
    this.onmessage?.({ data: JSON.stringify(state) })
  }

  emitPing(): void {
    for (const listener of this.listeners.get('ping') ?? []) {
      listener()
    }
  }
}

function stateWith(title: string): SpeakerState {
  const base = emptySpeakerState()
  return {
    ...base,
    connected: true,
    playback: { ...base.playback, status: 'playing', title, url: `http://radio.example/${title}`, isLive: true },
    updatedAt: 1,
  }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

let unsubscribe: (() => void) | null = null

beforeEach(() => {
  vi.resetModules()
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = null
  vi.unstubAllGlobals()
})

describe('playStream', () => {
  it('publishes the returned state to subscribers', async () => {
    const api = await import('@/api')
    const seen: string[] = []
    unsubscribe = api.subscribeState((state) => seen.push(state.playback.title), () => undefined)

    const source = FakeEventSource.instances[0]
    source.open()
    source.emit(stateWith('Old Station'))

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(stateWith('New Station'))))
    await api.playStream({ url: 'http://radio.example/new', title: 'New Station', isLive: true })

    expect(seen).toEqual(['Old Station', 'New Station'])
  })

  it('keeps the returned state for later subscribers', async () => {
    const api = await import('@/api')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(stateWith('New Station'))))

    await api.playStream({ url: 'http://radio.example/new', title: 'New Station', isLive: true })

    const seen: string[] = []
    unsubscribe = api.subscribeState((state) => seen.push(state.playback.title), () => undefined)

    expect(seen).toEqual(['New Station'])
  })
})

describe('subscribeState', () => {
  it('shares one event source between subscribers', async () => {
    const api = await import('@/api')
    const first = api.subscribeState(() => undefined, () => undefined)
    const second = api.subscribeState(() => undefined, () => undefined)

    expect(FakeEventSource.instances).toHaveLength(1)

    second()
    first()
  })

  it('replaces the connection when the page becomes visible again', async () => {
    const api = await import('@/api')
    unsubscribe = api.subscribeState(() => undefined, () => undefined)
    const initial = FakeEventSource.instances[0]

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeEventSource.instances).toHaveLength(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(initial.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('replaces the connection when the browser comes back online', async () => {
    const api = await import('@/api')
    unsubscribe = api.subscribeState(() => undefined, () => undefined)
    const initial = FakeEventSource.instances[0]

    window.dispatchEvent(new Event('online'))

    expect(initial.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('keeps the connection while server pings keep arriving', async () => {
    vi.useFakeTimers()
    try {
      const api = await import('@/api')
      unsubscribe = api.subscribeState(() => undefined, () => undefined)
      const source = FakeEventSource.instances[0]
      source.open()

      await vi.advanceTimersByTimeAsync(20_000)
      source.emitPing()
      await vi.advanceTimersByTimeAsync(20_000)
      source.emitPing()
      await vi.advanceTimersByTimeAsync(20_000)
      source.emitPing()

      expect(source.closed).toBe(false)
      expect(FakeEventSource.instances).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('replaces a connection that stops sending pings', async () => {
    vi.useFakeTimers()
    try {
      const api = await import('@/api')
      unsubscribe = api.subscribeState(() => undefined, () => undefined)
      const initial = FakeEventSource.instances[0]
      initial.open()

      await vi.advanceTimersByTimeAsync(60_000)

      expect(initial.closed).toBe(true)
      expect(FakeEventSource.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
