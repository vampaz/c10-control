import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppConfig, CommandRequest, CommandType, PlayTarget, RadioStation, RepeatMode } from '../shared/types.ts'
import type { FavoriteStore } from './favorites.ts'
import type { FolderBrowser } from './folders.ts'
import type { LibraryService } from './library.ts'
import type { PlaylistStore } from './playlists.ts'
import type { PresetStore } from './presets.ts'
import type { QueueController } from './queue.ts'
import type { SleepTimer } from './sleep.ts'
import type { SpeakerPoller } from './state.ts'
import { discoverDevices } from './discovery.ts'

const MAX_BODY_BYTES = 64 * 1024
const COMMAND_TYPES: CommandType[] = [
  'play', 'pause', 'toggle', 'next', 'previous', 'stop', 'seek', 'volume', 'mute', 'input',
]

export interface AppDependencies {
  poller: SpeakerPoller
  getConfig: () => AppConfig
  setConfig: (patch: Partial<AppConfig>) => AppConfig
  onConfigChange: (config: AppConfig) => void
  favorites: FavoriteStore
  presets: PresetStore
  playlists: PlaylistStore
  library: LibraryService
  folders: FolderBrowser
  queue: QueueController
  sleep: SleepTimer
  searchRadio: (query: string) => Promise<RadioStation[]>
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  response.end(payload)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body is too large')
    }
    chunks.push(buffer)
  }

  if (size === 0) {
    return {}
  }
  const type = request.headers['content-type']
  if (!type || !type.toLowerCase().startsWith('application/json')) {
    throw new Error('Requests with a body must use application/json')
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function parseCommand(body: unknown): CommandRequest {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Expected a command object')
  }

  const { type, value } = body as Record<string, unknown>
  if (typeof type !== 'string' || !COMMAND_TYPES.includes(type as CommandType)) {
    throw new Error(`Unknown command type: ${String(type)}`)
  }

  if (value !== undefined && typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') {
    throw new Error('Command value must be a number, a boolean or a string')
  }

  if (type === 'input' && typeof value !== 'string') {
    throw new Error('Input commands need an input name')
  }
  if (type === 'mute' && typeof value !== 'boolean') {
    throw new Error('Mute commands need a boolean')
  }
  if ((type === 'seek' || type === 'volume') && typeof value !== 'number') {
    throw new Error(`${type} commands need a number`)
  }

  return { type: type as CommandType, value: value as number | boolean | string | undefined }
}

function parsePlayTarget(body: unknown): PlayTarget {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Expected a play request')
  }

  const { url, title, artist, artworkUrl, isLive } = body as Record<string, unknown>
  const target = typeof url === 'string' ? url.trim() : ''

  if (!/^https?:\/\/\S+$/i.test(target)) {
    throw new Error('Play requests need an http or https URL')
  }

  return {
    url: target,
    title: typeof title === 'string' ? title.trim().slice(0, 200) : undefined,
    artist: typeof artist === 'string' ? artist.trim().slice(0, 200) : undefined,
    artworkUrl: typeof artworkUrl === 'string' && artworkUrl.trim() ? artworkUrl.trim() : null,
    isLive: typeof isLive === 'boolean' ? isLive : true,
  }
}

function currentTarget(deps: AppDependencies): PlayTarget {
  const { playback } = deps.poller.current
  if (!playback.url) {
    throw new Error('Nothing with a stream URL is playing')
  }

  return {
    url: playback.url,
    title: playback.title || undefined,
    artist: playback.artist && playback.artist.toLowerCase() !== 'unknown' ? playback.artist : undefined,
    artworkUrl: playback.artworkUrl,
    isLive: playback.isLive,
  }
}

function streamState(deps: AppDependencies, request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const unsubscribe = deps.poller.subscribe((state) => {
    response.write(`data: ${JSON.stringify(state)}\n\n`)
  })
  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 20_000)

  request.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
    response.end()
  })
}

export function createRequestHandler(deps: AppDependencies): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async function handle(request, response): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const { pathname } = url
    const method = request.method ?? 'GET'

    try {
      if (method !== 'GET' && method !== 'HEAD') {
        const site = request.headers['sec-fetch-site']
        if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
          sendJson(response, 403, { error: 'Cross-site requests are not allowed' })
          return
        }
      }

      if (pathname === '/api/health') {
        sendJson(response, 200, { ok: true })
        return
      }

      if (pathname === '/api/state' && method === 'GET') {
        await deps.poller.ensureFresh()
        sendJson(response, 200, deps.poller.current)
        return
      }

      if (pathname === '/api/events' && method === 'GET') {
        streamState(deps, request, response)
        return
      }

      if (pathname === '/api/command' && method === 'POST') {
        const command = parseCommand(await readJsonBody(request))
        if (command.type === 'next' || command.type === 'previous') {
          const handled = command.type === 'next'
            ? await deps.queue.next()
            : await deps.queue.previous()
          if (handled) {
            sendJson(response, 200, deps.poller.current)
            return
          }
        }
        await deps.poller.run(command)
        sendJson(response, 200, deps.poller.current)
        return
      }

      if (pathname === '/api/discovery' && method === 'GET') {
        sendJson(response, 200, { devices: await discoverDevices() })
        return
      }

      if (pathname === '/api/play' && method === 'POST') {
        const target = deps.library.resolveTarget(parsePlayTarget(await readJsonBody(request)))
        await deps.poller.playTarget(target)
        sendJson(response, 200, deps.poller.current)
        return
      }

      if (pathname === '/api/radio/search' && method === 'GET') {
        const query = url.searchParams.get('q') ?? ''
        sendJson(response, 200, { stations: await deps.searchRadio(query) })
        return
      }

      if (pathname === '/api/favorites') {
        if (method === 'GET') {
          sendJson(response, 200, { favorites: deps.favorites.list() })
          return
        }
        if (method === 'POST') {
          sendJson(response, 200, { favorites: deps.favorites.add(await readJsonBody(request) as RadioStation) })
          return
        }
      }

      if (pathname.startsWith('/api/favorites/') && method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/favorites/'.length))
        sendJson(response, 200, { favorites: deps.favorites.remove(id) })
        return
      }

      if (pathname === '/api/presets' && method === 'GET') {
        sendJson(response, 200, { presets: deps.presets.list() })
        return
      }

      if (pathname.startsWith('/api/presets/')) {
        const raw = pathname.slice('/api/presets/'.length)
        if (!/^\d+$/.test(raw)) {
          throw new Error('Preset index must be a number')
        }
        const index = Number(raw)
        if (method === 'PUT') {
          const target = parsePlayTarget(await readJsonBody(request))
          sendJson(response, 200, { presets: deps.presets.save(index, target) })
          return
        }
        if (method === 'DELETE') {
          sendJson(response, 200, { presets: deps.presets.clear(index) })
          return
        }
      }

      if (pathname === '/api/sleep') {
        if (method === 'GET') {
          sendJson(response, 200, deps.sleep.status())
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(request)
          if (typeof body !== 'object' || body === null) {
            throw new Error('Expected a sleep request')
          }
          deps.sleep.start(Number((body as { minutes?: unknown }).minutes))
          sendJson(response, 200, deps.sleep.status())
          return
        }
        if (method === 'DELETE') {
          sendJson(response, 200, deps.sleep.cancel())
          return
        }
      }

      if (pathname === '/api/library' && method === 'GET') {
        sendJson(response, 200, await deps.library.listing({
          libraryId: url.searchParams.get('library') ?? undefined,
          query: url.searchParams.get('q') ?? '',
          limit: Number(url.searchParams.get('limit') ?? undefined),
          offset: Number(url.searchParams.get('offset') ?? undefined),
          dir: url.searchParams.get('dir') ?? undefined,
        }))
        return
      }

      if (pathname === '/api/library/albums' && method === 'GET') {
        sendJson(response, 200, await deps.library.albums({
          libraryId: url.searchParams.get('library') ?? undefined,
          query: url.searchParams.get('q') ?? '',
          limit: Number(url.searchParams.get('limit') ?? undefined),
          offset: Number(url.searchParams.get('offset') ?? undefined),
        }))
        return
      }

      if (pathname === '/api/library/file' && (method === 'GET' || method === 'HEAD')) {
        const library = url.searchParams.get('library') ?? ''
        const path = url.searchParams.get('path') ?? ''
        if (!deps.library.stream(library, path, request, response)) {
          sendJson(response, 404, { error: 'File not found' })
        }
        return
      }

      if (pathname === '/api/library/art' && (method === 'GET' || method === 'HEAD')) {
        const art = await deps.library.artwork(
          url.searchParams.get('library') ?? '',
          url.searchParams.get('path') ?? '',
        )
        if (!art) {
          sendJson(response, 404, { error: 'Artwork not found' })
          return
        }
        response.writeHead(200, {
          'Content-Type': art.mime,
          'Content-Length': art.data.length,
          'Cache-Control': 'public, max-age=86400',
        })
        response.end(method === 'HEAD' ? undefined : art.data)
        return
      }

      if (pathname === '/api/library/play' && method === 'POST') {
        const body = await readJsonBody(request)
        const patch = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
        if (patch.shuffle !== undefined && typeof patch.shuffle !== 'boolean') {
          throw new Error('Shuffle must be a boolean')
        }
        const folder = await deps.library.folderTargets(
          String(patch.library ?? ''),
          String(patch.path ?? ''),
        )
        if (!folder) {
          sendJson(response, 404, { error: 'Track not found' })
          return
        }
        if (typeof patch.shuffle === 'boolean') {
          deps.queue.setMode({ shuffle: patch.shuffle })
        }
        const random = patch.shuffle === true && folder.targets.length > 0
          ? Math.floor(Math.random() * folder.targets.length)
          : folder.index
        sendJson(response, 200, await deps.queue.replace(folder.targets, random))
        return
      }

      if (pathname === '/api/folders' && method === 'GET') {
        sendJson(response, 200, await deps.folders.listing(url.searchParams.get('path') ?? ''))
        return
      }

      if (pathname === '/api/queue') {
        if (method === 'GET') {
          sendJson(response, 200, deps.queue.snapshot())
          return
        }
        if (method === 'POST') {
          sendJson(response, 200, deps.queue.add(parsePlayTarget(await readJsonBody(request))))
          return
        }
        if (method === 'DELETE') {
          sendJson(response, 200, deps.queue.clear())
          return
        }
      }

      if (pathname === '/api/queue/play' && method === 'POST') {
        const body = await readJsonBody(request)
        const index = typeof body === 'object' && body !== null
          ? Number((body as { index?: unknown }).index ?? 0)
          : 0
        await deps.queue.play(index)
        sendJson(response, 200, deps.queue.snapshot())
        return
      }

      if (pathname === '/api/queue/mode' && method === 'PUT') {
        const body = await readJsonBody(request)
        const patch = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
        const repeat = patch.repeat
        if (repeat !== undefined && repeat !== 'off' && repeat !== 'all' && repeat !== 'one') {
          throw new Error('Repeat must be off, all or one')
        }
        if (patch.shuffle !== undefined && typeof patch.shuffle !== 'boolean') {
          throw new Error('Shuffle must be a boolean')
        }
        sendJson(response, 200, deps.queue.setMode({
          repeat: repeat as RepeatMode | undefined,
          shuffle: patch.shuffle as boolean | undefined,
        }))
        return
      }

      if (pathname === '/api/queue/next' && method === 'POST') {
        await deps.queue.next()
        sendJson(response, 200, deps.queue.snapshot())
        return
      }

      if (pathname === '/api/queue/previous' && method === 'POST') {
        await deps.queue.previous()
        sendJson(response, 200, deps.queue.snapshot())
        return
      }

      if (pathname.startsWith('/api/queue/') && method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/queue/'.length))
        sendJson(response, 200, deps.queue.remove(id))
        return
      }

      if (pathname === '/api/playlists') {
        if (method === 'GET') {
          sendJson(response, 200, { playlists: deps.playlists.list() })
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(request)
          if (typeof body !== 'object' || body === null) {
            throw new Error('Expected a playlist request')
          }
          sendJson(response, 200, { playlists: deps.playlists.create((body as { name?: unknown }).name) })
          return
        }
      }

      if (pathname.startsWith('/api/playlists/')) {
        const rest = pathname.slice('/api/playlists/'.length).split('/')
        const id = decodeURIComponent(rest[0] ?? '')

        if (rest.length === 1 && method === 'PUT') {
          const body = await readJsonBody(request)
          if (typeof body !== 'object' || body === null) {
            throw new Error('Expected a playlist request')
          }
          sendJson(response, 200, { playlists: deps.playlists.rename(id, (body as { name?: unknown }).name) })
          return
        }
        if (rest.length === 1 && method === 'DELETE') {
          sendJson(response, 200, { playlists: deps.playlists.remove(id) })
          return
        }
        if (rest.length === 2 && rest[1] === 'items' && method === 'POST') {
          sendJson(response, 200, { playlists: deps.playlists.addItem(id, parsePlayTarget(await readJsonBody(request))) })
          return
        }
        if (rest.length === 3 && rest[1] === 'items' && method === 'DELETE') {
          sendJson(response, 200, { playlists: deps.playlists.removeItem(id, decodeURIComponent(rest[2])) })
          return
        }
        if (rest.length === 2 && rest[1] === 'current' && method === 'POST') {
          await deps.poller.ensureFresh()
          sendJson(response, 200, { playlists: deps.playlists.addItem(id, currentTarget(deps)) })
          return
        }
        if (rest.length === 2 && rest[1] === 'play' && method === 'POST') {
          const playlist = deps.playlists.list().find((entry) => entry.id === id)
          if (!playlist) {
            throw new Error('Playlist not found')
          }
          sendJson(response, 200, await deps.queue.replace(
            playlist.items.map((item) => deps.library.resolveTarget(item)),
          ))
          return
        }
      }

      if (pathname === '/api/config') {
        if (method === 'GET') {
          sendJson(response, 200, deps.getConfig())
          return
        }
        if (method === 'PUT') {
          const body = await readJsonBody(request)
          if (typeof body !== 'object' || body === null) {
            throw new Error('Expected a configuration object')
          }
          const config = deps.setConfig(body as Partial<AppConfig>)
          deps.onConfigChange(config)
          sendJson(response, 200, config)
          return
        }
      }

      sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
      sendJson(response, 400, { error: message })
    }
  }
}
