import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptySpeakerState, type AppConfig, type PlayTarget, type SpeakerState } from '../shared/types.ts'
import { createRequestHandler, type AppDependencies } from '../server/app.ts'
import type { FavoriteStore } from '../server/favorites.ts'
import type { FolderBrowser } from '../server/folders.ts'
import type { LibraryService } from '../server/library.ts'
import type { PlaylistStore } from '../server/playlists.ts'
import type { PresetStore } from '../server/presets.ts'
import type { QueueController } from '../server/queue.ts'
import { SleepTimer } from '../server/sleep.ts'
import type { SpeakerPoller } from '../server/state.ts'

const CONFIG: AppConfig = {
  host: '192.168.1.100',
  httpPort: 80,
  upnpPort: 49152,
  libraries: [],
  browseRoots: [],
  mediaBaseUrl: '',
}

function connectedState(): SpeakerState {
  return {
    ...emptySpeakerState(),
    connected: true,
    device: {
      host: '192.168.1.100',
      name: 'Office',
      model: 'AudioPro_C10',
      firmware: '4.2.337151',
      uuid: '0123456789ABCDEF01234567',
    },
    playback: { ...emptySpeakerState().playback, status: 'playing', title: 'Rádio Oxigénio' },
    volume: { level: 12, muted: false },
    source: 'Wi-Fi',
  }
}

interface TestServer {
  url: string
  close: () => Promise<void>
}

const servers: TestServer[] = []

async function start(deps: AppDependencies): Promise<TestServer> {
  const handler = createRequestHandler(deps)
  const server: Server = createServer((request, response) => void handler(request, response))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not bind to a port')
  }

  const testServer: TestServer = {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
  servers.push(testServer)
  return testServer
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  const run = vi.fn(async () => undefined)
  const ensureFresh = vi.fn(async () => undefined)
  const playTarget = vi.fn(async () => undefined)
  const state = connectedState()

  const favorites = {
    list: vi.fn(() => []),
    add: vi.fn(() => []),
    remove: vi.fn(() => []),
  } as unknown as FavoriteStore

  const presets = {
    list: vi.fn(() => Array.from({ length: 6 }, () => null)),
    save: vi.fn(() => []),
    clear: vi.fn(() => []),
  } as unknown as PresetStore

  const sleep = {
    status: vi.fn(() => ({ endsAt: null })),
    start: vi.fn(() => ({ endsAt: 1 })),
    cancel: vi.fn(() => ({ endsAt: null })),
  } as unknown as SleepTimer

  const library = {
    listing: vi.fn(async () => ({
      libraries: [],
      entries: [],
      total: 0,
      query: '',
      limit: 200,
      offset: 0,
      mediaBaseUrl: '',
    })),
    stream: vi.fn(() => true),
    resolveTarget: (target: PlayTarget) => target,
    albumTargets: vi.fn(async () => null),
    thumbnail: vi.fn(async () => null),
  } as unknown as LibraryService

  const folders = {
    listing: vi.fn(async () => ({ path: '', parent: null, roots: [], folders: [] })),
  } as unknown as FolderBrowser

  const playlists = {
    list: vi.fn(() => []),
    create: vi.fn(() => []),
    rename: vi.fn(() => []),
    remove: vi.fn(() => []),
    addItem: vi.fn(() => []),
    removeItem: vi.fn(() => []),
  } as unknown as PlaylistStore

  const queue = {
    snapshot: vi.fn(() => ({ items: [], activeIndex: null })),
    add: vi.fn(() => ({ items: [], activeIndex: null })),
    remove: vi.fn(() => ({ items: [], activeIndex: null })),
    clear: vi.fn(() => ({ items: [], activeIndex: null })),
    play: vi.fn(async () => true),
    replace: vi.fn(async () => ({ items: [], activeIndex: null })),
    next: vi.fn(async () => false),
    previous: vi.fn(async () => false),
  } as unknown as QueueController

  return {
    poller: {
      current: state,
      subscribe: () => () => undefined,
      ensureFresh,
      run,
      playTarget,
    } as unknown as SpeakerPoller,
    getConfig: () => CONFIG,
    setConfig: (patch) => ({ ...CONFIG, ...patch }),
    onConfigChange: () => undefined,
    favorites,
    presets,
    playlists,
    library,
    folders,
    queue,
    sleep,
    searchRadio: vi.fn(async () => []),
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('GET /api/state', () => {
  it('returns the current speaker state', async () => {
    const { url } = await start(makeDeps())
    const response = await fetch(`${url}/api/state`)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.json()) as SpeakerState).toMatchObject({ connected: true, source: 'Wi-Fi' })
  })

  it('refreshes stale state before answering', async () => {
    const ensureFresh = vi.fn(async () => undefined)
    const deps = makeDeps()
    Object.assign(deps.poller, { ensureFresh })

    const { url } = await start(deps)
    await fetch(`${url}/api/state`)

    expect(ensureFresh).toHaveBeenCalledOnce()
  })
})

describe('POST /api/command', () => {
  it('runs a valid command and returns the new state', async () => {
    const deps = makeDeps()
    const { url } = await start(deps)

    const response = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'volume', value: 24 }),
    })

    expect(response.status).toBe(200)
    expect(deps.poller.run).toHaveBeenCalledWith({ type: 'volume', value: 24 })
  })

  it('rejects an unknown command type', async () => {
    const { url } = await start(makeDeps())

    const response = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'explode' }),
    })

    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toEqual({ error: 'Unknown command type: explode' })
  })

  it('rejects a non numeric value', async () => {
    const { url } = await start(makeDeps())

    const response = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'volume', value: 'loud' }),
    })

    expect(response.status).toBe(400)
  })

  it('accepts an input name', async () => {
    const deps = makeDeps()
    const { url } = await start(deps)

    const response = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'input', value: 'bluetooth' }),
    })

    expect(response.status).toBe(200)
    expect(deps.poller.run).toHaveBeenCalledWith({ type: 'input', value: 'bluetooth' })
  })

  it('reports a failing command', async () => {
    const deps = makeDeps({
      poller: {
        current: connectedState(),
        subscribe: () => () => undefined,
        ensureFresh: async () => undefined,
        run: async () => {
          throw new Error('Cannot reach the speaker: connect EHOSTUNREACH')
        },
      } as unknown as SpeakerPoller,
    })
    const { url } = await start(deps)

    const response = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'play' }),
    })

    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toEqual({
      error: 'Cannot reach the speaker: connect EHOSTUNREACH',
    })
  })
})

describe('configuration endpoints', () => {
  it('returns the stored configuration', async () => {
    const { url } = await start(makeDeps())
    const response = await fetch(`${url}/api/config`)

    expect((await response.json()) as AppConfig).toEqual(CONFIG)
  })

  it('saves a new address and notifies the poller', async () => {
    const onConfigChange = vi.fn()
    const { url } = await start(makeDeps({ onConfigChange }))

    const response = await fetch(`${url}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '192.168.1.50' }),
    })

    expect(response.status).toBe(200)
    expect(onConfigChange).toHaveBeenCalledWith({ ...CONFIG, host: '192.168.1.50' })
  })
})

describe('play requests', () => {
  it('pushes a stream to the speaker', async () => {
    const deps = makeDeps()
    const { url } = await start(deps)

    const response = await fetch(`${url}/api/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com/stream.mp3', title: 'Test FM' }),
    })

    expect(response.status).toBe(200)
    expect(deps.poller.playTarget).toHaveBeenCalledWith({
      url: 'http://example.com/stream.mp3',
      title: 'Test FM',
      artist: undefined,
      artworkUrl: null,
      isLive: true,
    })
  })

  it('rebuilds a stored library URL before playing', async () => {
    const resolveTarget = vi.fn((target: PlayTarget) => ({
      ...target,
      url: 'http://current/api/library/file?library=main&path=a.mp3',
    }))
    const library = { resolveTarget } as unknown as LibraryService
    const deps = makeDeps({ library })
    const { url } = await start(deps)

    await fetch(`${url}/api/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://old/api/library/file?library=main&path=a.mp3', title: 'A' }),
    })

    expect(resolveTarget).toHaveBeenCalled()
    expect(deps.poller.playTarget).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://current/api/library/file?library=main&path=a.mp3',
    }))
  })

  it('rejects a non http URL', async () => {
    const { url } = await start(makeDeps())

    const response = await fetch(`${url}/api/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd' }),
    })

    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toEqual({
      error: 'Play requests need an http or https URL',
    })
  })

  it('rejects a cross-site write', async () => {
    const deps = makeDeps()
    const { url } = await start(deps)

    const response = await fetch(`${url}/api/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ url: 'http://example.com/stream.mp3' }),
    })

    expect(response.status).toBe(403)
    expect(deps.poller.playTarget).not.toHaveBeenCalled()
  })

  it('rejects a body that is not declared as JSON', async () => {
    const deps = makeDeps()
    const { url } = await start(deps)

    const response = await fetch(`${url}/api/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ url: 'http://example.com/stream.mp3' }),
    })

    expect(response.status).toBe(400)
    expect(deps.poller.playTarget).not.toHaveBeenCalled()
  })
})

describe('radio search', () => {
  it('forwards the query to the directory', async () => {
    const searchRadio = vi.fn(async () => [])
    const { url } = await start(makeDeps({ searchRadio }))

    const response = await fetch(`${url}/api/radio/search?q=jazz%20fm`)

    expect(response.status).toBe(200)
    expect(searchRadio).toHaveBeenCalledWith('jazz fm')
  })

  it('reports a directory failure', async () => {
    const searchRadio = vi.fn(async () => {
      throw new Error('The radio directory is unreachable')
    })
    const { url } = await start(makeDeps({ searchRadio }))

    const response = await fetch(`${url}/api/radio/search?q=jazz`)

    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toEqual({ error: 'The radio directory is unreachable' })
  })
})

describe('favorites', () => {
  it('lists saved stations', async () => {
    const favorites = {
      list: () => [{ id: 'a', name: 'Test FM', url: 'http://example.com/a', country: '', tags: '', codec: '', bitrate: 0, artworkUrl: null, addedAt: 1 }],
      add: vi.fn(),
      remove: vi.fn(),
    } as unknown as FavoriteStore
    const { url } = await start(makeDeps({ favorites }))

    const response = await fetch(`${url}/api/favorites`)
    const body = (await response.json()) as { favorites: unknown[] }

    expect(response.status).toBe(200)
    expect(body.favorites).toHaveLength(1)
  })

  it('saves a station', async () => {
    const add = vi.fn(() => [])
    const favorites = { list: () => [], add, remove: vi.fn() } as unknown as FavoriteStore
    const { url } = await start(makeDeps({ favorites }))

    await fetch(`${url}/api/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x', name: 'Test FM', url: 'http://example.com/a' }),
    })

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test FM' }))
  })

  it('removes a station by id', async () => {
    const remove = vi.fn(() => [])
    const favorites = { list: () => [], add: vi.fn(), remove } as unknown as FavoriteStore
    const { url } = await start(makeDeps({ favorites }))

    await fetch(`${url}/api/favorites/hash%201`, { method: 'DELETE' })

    expect(remove).toHaveBeenCalledWith('hash 1')
  })
})

describe('presets', () => {
  it('lists six slots', async () => {
    const { url } = await start(makeDeps())
    const response = await fetch(`${url}/api/presets`)
    const body = (await response.json()) as { presets: unknown[] }

    expect(response.status).toBe(200)
    expect(body.presets).toHaveLength(6)
  })

  it('saves a target in a slot', async () => {
    const save = vi.fn(() => [])
    const presets = { list: () => [], save, clear: vi.fn() } as unknown as PresetStore
    const { url } = await start(makeDeps({ presets }))

    const response = await fetch(`${url}/api/presets/2`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com/stream.mp3', title: 'Test FM' }),
    })

    expect(response.status).toBe(200)
    expect(save).toHaveBeenCalledWith(2, expect.objectContaining({ title: 'Test FM' }))
  })

  it('clears a slot', async () => {
    const clear = vi.fn(() => [])
    const presets = { list: () => [], save: vi.fn(), clear } as unknown as PresetStore
    const { url } = await start(makeDeps({ presets }))

    await fetch(`${url}/api/presets/4`, { method: 'DELETE' })

    expect(clear).toHaveBeenCalledWith(4)
  })

  it('rejects a slot that is not a number', async () => {
    const { url } = await start(makeDeps())
    const response = await fetch(`${url}/api/presets/abc`, { method: 'DELETE' })

    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toEqual({ error: 'Preset index must be a number' })
  })
})

describe('sleep timer', () => {
  it('reports no timer by default', async () => {
    const { url } = await start(makeDeps())
    const response = await fetch(`${url}/api/sleep`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ endsAt: null })
  })

  it('starts a timer', async () => {
    const startTimer = vi.fn(() => ({ endsAt: 123 }))
    const sleep = { status: () => ({ endsAt: 123 }), start: startTimer, cancel: vi.fn() } as unknown as SleepTimer
    const { url } = await start(makeDeps({ sleep }))

    const response = await fetch(`${url}/api/sleep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 30 }),
    })

    expect(startTimer).toHaveBeenCalledWith(30)
    expect(await response.json()).toEqual({ endsAt: 123 })
  })

  it('cancels a timer', async () => {
    const cancel = vi.fn(() => ({ endsAt: null }))
    const sleep = { status: () => ({ endsAt: 123 }), start: vi.fn(), cancel } as unknown as SleepTimer
    const { url } = await start(makeDeps({ sleep }))

    await fetch(`${url}/api/sleep`, { method: 'DELETE' })

    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects an invalid duration', async () => {
    const sleep = new SleepTimer({
      getVolume: () => 10,
      setVolume: async () => undefined,
      pause: async () => undefined,
    })
    const { url } = await start(makeDeps({ sleep }))
    const response = await fetch(`${url}/api/sleep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 0 }),
    })

    expect(response.status).toBe(400)
  })
})

describe('library', () => {
  it('lists the indexed files with a playable URL', async () => {
    const library = {
      listing: vi.fn(() => ({
        root: '/music',
        mediaBaseUrl: 'http://192.168.1.135:5173',
        entries: [{ id: 'a', name: 'Track', path: 'Track.mp3', size: 10, modifiedAt: 1, url: 'http://192.168.1.135:5173/api/library/file?path=Track.mp3' }],
      })),
      stream: vi.fn(() => true),
    } as unknown as LibraryService
    const { url } = await start(makeDeps({ library }))

    const response = await fetch(`${url}/api/library`)
    const body = (await response.json()) as { entries: unknown[] }

    expect(response.status).toBe(200)
    expect(body.entries).toHaveLength(1)
  })
})

describe('queue modes', () => {
  it('sets repeat and shuffle', async () => {
    const setMode = vi.fn(() => ({ items: [], activeIndex: null, repeat: 'all', shuffle: true }))
    const queue = { setMode } as unknown as QueueController
    const { url } = await start(makeDeps({ queue }))

    const response = await fetch(`${url}/api/queue/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repeat: 'all', shuffle: true }),
    })

    expect(response.status).toBe(200)
    expect(setMode).toHaveBeenCalledWith({ repeat: 'all', shuffle: true })
    expect((await response.json()) as { repeat: string }).toMatchObject({ repeat: 'all', shuffle: true })
  })

  it('rejects an unknown repeat mode', async () => {
    const setMode = vi.fn()
    const queue = { setMode } as unknown as QueueController
    const { url } = await start(makeDeps({ queue }))

    const response = await fetch(`${url}/api/queue/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repeat: 'sometimes' }),
    })

    expect(response.status).toBe(400)
    expect(setMode).not.toHaveBeenCalled()
  })
})

describe('queue', () => {
  it('adds a track to the queue', async () => {
    const add = vi.fn(() => ({ items: [], activeIndex: null }))
    const queue = { snapshot: () => ({ items: [], activeIndex: null }), add, remove: vi.fn(), clear: vi.fn(), play: vi.fn(), next: vi.fn(), previous: vi.fn() } as unknown as QueueController
    const { url } = await start(makeDeps({ queue }))

    const response = await fetch(`${url}/api/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com/a.mp3', title: 'Track', isLive: false }),
    })

    expect(response.status).toBe(200)
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Track', isLive: false }))
  })

  it('starts a queued track', async () => {
    const play = vi.fn(async () => true)
    const queue = { snapshot: () => ({ items: [], activeIndex: 1 }), add: vi.fn(), remove: vi.fn(), clear: vi.fn(), play, next: vi.fn(), previous: vi.fn() } as unknown as QueueController
    const { url } = await start(makeDeps({ queue }))

    await fetch(`${url}/api/queue/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 1 }),
    })

    expect(play).toHaveBeenCalledWith(1)
  })

  it('removes a track by id', async () => {
    const remove = vi.fn(() => ({ items: [], activeIndex: null }))
    const queue = { snapshot: () => ({ items: [], activeIndex: null }), add: vi.fn(), remove, clear: vi.fn(), play: vi.fn(), next: vi.fn(), previous: vi.fn() } as unknown as QueueController
    const { url } = await start(makeDeps({ queue }))

    await fetch(`${url}/api/queue/abc`, { method: 'DELETE' })

    expect(remove).toHaveBeenCalledWith('abc')
  })

  it('lets the queue handle next and previous when it is active', async () => {
    const next = vi.fn(async () => true)
    const queue = { snapshot: () => ({ items: [], activeIndex: 0 }), add: vi.fn(), remove: vi.fn(), clear: vi.fn(), play: vi.fn(), next, previous: vi.fn(async () => true) } as unknown as QueueController
    const deps = makeDeps({ queue })
    const { url } = await start(deps)

    await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'next' }),
    })

    expect(next).toHaveBeenCalledOnce()
    expect(deps.poller.run).not.toHaveBeenCalled()
  })

  it('falls back to the speaker when the queue is inactive', async () => {
    const deps = makeDeps()
    const { url } = await start(deps)

    await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'next' }),
    })

    expect(deps.poller.run).toHaveBeenCalledWith({ type: 'next', value: undefined })
  })
})

describe('playlists', () => {
  const PLAYLIST = {
    id: 'one',
    name: 'Mix',
    items: [{ id: 'item1', url: 'http://example.com/a.mp3', title: 'Track', isLive: false }],
    createdAt: 1,
    updatedAt: 1,
  }

  it('lists playlists', async () => {
    const playlists = { list: () => [PLAYLIST], create: vi.fn(), rename: vi.fn(), remove: vi.fn(), addItem: vi.fn(), removeItem: vi.fn() } as unknown as PlaylistStore
    const { url } = await start(makeDeps({ playlists }))

    const response = await fetch(`${url}/api/playlists`)
    const body = (await response.json()) as { playlists: unknown[] }

    expect(response.status).toBe(200)
    expect(body.playlists).toHaveLength(1)
  })

  it('creates a playlist', async () => {
    const create = vi.fn(() => [PLAYLIST])
    const playlists = { list: () => [], create, rename: vi.fn(), remove: vi.fn(), addItem: vi.fn(), removeItem: vi.fn() } as unknown as PlaylistStore
    const { url } = await start(makeDeps({ playlists }))

    await fetch(`${url}/api/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mix' }),
    })

    expect(create).toHaveBeenCalledWith('Mix')
  })

  it('renames and deletes a playlist', async () => {
    const rename = vi.fn(() => [PLAYLIST])
    const remove = vi.fn(() => [])
    const playlists = { list: () => [PLAYLIST], create: vi.fn(), rename, remove, addItem: vi.fn(), removeItem: vi.fn() } as unknown as PlaylistStore
    const { url } = await start(makeDeps({ playlists }))

    await fetch(`${url}/api/playlists/one`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New' }),
    })
    await fetch(`${url}/api/playlists/one`, { method: 'DELETE' })

    expect(rename).toHaveBeenCalledWith('one', 'New')
    expect(remove).toHaveBeenCalledWith('one')
  })

  it('adds the current track', async () => {
    const addItem = vi.fn(() => [PLAYLIST])
    const playlists = { list: () => [PLAYLIST], create: vi.fn(), rename: vi.fn(), remove: vi.fn(), addItem, removeItem: vi.fn() } as unknown as PlaylistStore
    const deps = makeDeps({ playlists })
    deps.poller.current.playback.url = 'http://example.com/a.mp3'
    deps.poller.current.playback.title = 'Track'
    const { url } = await start(deps)

    await fetch(`${url}/api/playlists/one/current`, { method: 'POST' })

    expect(addItem).toHaveBeenCalledWith('one', expect.objectContaining({ title: 'Track' }))
  })

  it('plays a playlist through the queue', async () => {
    const playlists = { list: () => [PLAYLIST], create: vi.fn(), rename: vi.fn(), remove: vi.fn(), addItem: vi.fn(), removeItem: vi.fn() } as unknown as PlaylistStore
    const deps = makeDeps({ playlists })
    const { url } = await start(deps)

    await fetch(`${url}/api/playlists/one/play`, { method: 'POST' })

    expect(deps.queue.replace).toHaveBeenCalledWith(PLAYLIST.items)
  })
})

describe('folders', () => {
  it('lists directories under a browse root', async () => {
    const folders = {
      listing: vi.fn(async () => ({
        path: '/host/music',
        parent: null,
        roots: ['/host/music'],
        folders: [{ name: 'Album', path: '/host/music/Album' }],
      })),
    } as unknown as FolderBrowser
    const { url } = await start(makeDeps({ folders }))

    const response = await fetch(`${url}/api/folders?path=%2Fhost%2Fmusic`)
    const body = (await response.json()) as { folders: unknown[] }

    expect(response.status).toBe(200)
    expect(folders.listing).toHaveBeenCalledWith('/host/music')
    expect(body.folders).toHaveLength(1)
  })
})

describe('library artwork', () => {
  it('serves the cover art of a library file', async () => {
    const artwork = vi.fn(async () => ({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mime: 'image/jpeg' }))
    const library = { artwork } as unknown as LibraryService
    const { url } = await start(makeDeps({ library }))

    const response = await fetch(`${url}/api/library/art?library=main&path=sub%2Fb.flac`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(artwork).toHaveBeenCalledWith('main', 'sub/b.flac')
    expect((await response.arrayBuffer()).byteLength).toBe(4)
  })

  it('serves a resized thumbnail when a width is requested', async () => {
    const thumbnail = vi.fn(async () => ({ data: Buffer.from([1, 2, 3]), mime: 'image/webp' }))
    const library = { thumbnail } as unknown as LibraryService
    const { url } = await start(makeDeps({ library }))

    const response = await fetch(`${url}/api/library/art?library=main&path=a.mp3&w=320`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(thumbnail).toHaveBeenCalledWith('main', 'a.mp3', 320)
  })

  it('answers with a blank image when fallback is requested and art is missing', async () => {
    const library = { artwork: vi.fn(async () => null) } as unknown as LibraryService
    const { url } = await start(makeDeps({ library }))

    const response = await fetch(`${url}/api/library/art?library=main&path=a.mp3&fallback=1`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('answers 404 when a file has no art', async () => {
    const library = { artwork: vi.fn(async () => null) } as unknown as LibraryService
    const { url } = await start(makeDeps({ library }))

    const response = await fetch(`${url}/api/library/art?library=main&path=a.mp3`)

    expect(response.status).toBe(404)
  })
})

describe('library albums', () => {
  it('lists album folders with the selected library and query', async () => {
    const albums = vi.fn(async () => ({ libraries: [], albums: [], total: 0, query: 'air', limit: 60, offset: 0 }))
    const library = { albums } as unknown as LibraryService
    const { url } = await start(makeDeps({ library }))

    const response = await fetch(`${url}/api/library/albums?q=air&library=main`)

    expect(response.status).toBe(200)
    expect(albums).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 'main', query: 'air' }))
  })
})

describe('library playback', () => {
  it('plays the folder that holds the selected file', async () => {
    const targets = [{ url: 'http://192.168.1.135:8787/api/library/file?library=main&path=album%2Fa.mp3', title: 'A', isLive: false }]
    const folderTargets = vi.fn(async () => ({ targets, index: 0 }))
    const replace = vi.fn(async () => ({ items: [], activeIndex: 0 }))
    const library = { folderTargets } as unknown as LibraryService
    const queue = { replace } as unknown as QueueController

    const { url } = await start(makeDeps({ library, queue }))
    const response = await fetch(`${url}/api/library/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: 'main', path: 'album/a.mp3' }),
    })

    expect(response.status).toBe(200)
    expect(folderTargets).toHaveBeenCalledWith('main', 'album/a.mp3')
    expect(replace).toHaveBeenCalledWith(targets, 0)
  })

  it('plays an album folder including its disc subfolders', async () => {
    const targets = [{ url: 'http://192.168.1.135:8787/api/library/file?library=main&path=Release%2FCD1%2F01.mp3', title: '01', isLive: false }]
    const albumTargets = vi.fn(async () => ({ targets, index: 0 }))
    const replace = vi.fn(async () => ({ items: [], activeIndex: 0 }))
    const library = { albumTargets } as unknown as LibraryService
    const queue = { replace } as unknown as QueueController
    const { url } = await start(makeDeps({ library, queue }))

    const response = await fetch(`${url}/api/library/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: 'main', dirs: ['Release'] }),
    })

    expect(response.status).toBe(200)
    expect(albumTargets).toHaveBeenCalledWith('main', ['Release'])
    expect(replace).toHaveBeenCalledWith(targets, 0)
  })

  it('starts an album shuffled from a random track', async () => {
    const targets = [
      { url: 'http://192.168.1.135:8787/api/library/file?library=main&path=a.mp3', title: 'A', isLive: false },
      { url: 'http://192.168.1.135:8787/api/library/file?library=main&path=b.mp3', title: 'B', isLive: false },
    ]
    const folderTargets = vi.fn(async () => ({ targets, index: 0 }))
    const replace = vi.fn(async () => ({ items: [], activeIndex: 0 }))
    const setMode = vi.fn(() => ({ items: [], activeIndex: null, repeat: 'off', shuffle: true }))
    const library = { folderTargets } as unknown as LibraryService
    const queue = { replace, setMode } as unknown as QueueController
    const { url } = await start(makeDeps({ library, queue }))

    const response = await fetch(`${url}/api/library/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: 'main', path: 'album/a.mp3', shuffle: true }),
    })

    expect(response.status).toBe(200)
    expect(setMode).toHaveBeenCalledWith({ shuffle: true })
    const index = (replace.mock.calls[0] as unknown as [unknown, number])[1]
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(targets.length)
  })

  it('answers 404 when the track is outside a library', async () => {    const library = { folderTargets: vi.fn(async () => null) } as unknown as LibraryService
    const { url } = await start(makeDeps({ library }))
    const response = await fetch(`${url}/api/library/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: 'main', path: '../secret.mp3' }),
    })

    expect(response.status).toBe(404)
  })
})

describe('events', () => {
  it('streams the current state over SSE', async () => {
    const state = connectedState()
    const poller = {
      subscribe: (listener: (value: unknown) => void) => {
        listener(state)
        return () => undefined
      },
    } as unknown as SpeakerPoller
    const { url } = await start(makeDeps({ poller }))
    const controller = new AbortController()

    try {
      const response = await fetch(`${url}/api/events`, { signal: controller.signal })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const reader = response.body?.getReader()
      const chunk = await reader?.read()
      const text = new TextDecoder().decode(chunk?.value)
      expect(text).toContain('data: ')
      expect(text).toContain('"connected":true')
    } finally {
      controller.abort()
    }
  })
})

describe('unknown routes', () => {
  it('answers with 404 JSON', async () => {
    const { url } = await start(makeDeps())
    const response = await fetch(`${url}/api/nope`)

    expect(response.status).toBe(404)
    expect((await response.json()) as { error: string }).toEqual({ error: 'Not found' })
  })
})
