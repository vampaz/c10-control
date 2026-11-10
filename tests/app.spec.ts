import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptySpeakerState, type AppConfig, type SpeakerState } from '../shared/types.ts'
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

describe('unknown routes', () => {
  it('answers with 404 JSON', async () => {
    const { url } = await start(makeDeps())
    const response = await fetch(`${url}/api/nope`)

    expect(response.status).toBe(404)
    expect((await response.json()) as { error: string }).toEqual({ error: 'Not found' })
  })
})
