import { createHash } from 'node:crypto'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { AppConfig, AlbumListing, LibraryEntry, LibraryListing, LibraryRoot, PlayTarget } from '../shared/types.ts'
import { readCoverArt, type CoverArt } from './artwork.ts'
import { detectMediaBaseUrl } from './network.ts'

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.wma',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wma': 'audio/x-ms-wma',
}

const CACHE_TTL_MS = 5 * 60_000
const DEFAULT_ALBUM_LIMIT = 60
const MAX_ALBUM_LIMIT = 200

export const DEFAULT_LIMIT = 200
export const MAX_LIMIT = 500

export interface LibraryFile {
  id: string
  name: string
  path: string
}

export interface ByteRange {
  start: number
  end: number
}

export interface ListingOptions {
  libraryId?: string
  query?: string
  limit?: number
  offset?: number
  /** Restricts the listing to one album folder. */
  dir?: string
}

export function isAudioFile(path: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(path).toLowerCase())
}

export function audioMime(path: string): string {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function safeReal(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Parses a single `bytes=` range. Returns null for a malformed or
 * unsatisfiable range; the caller then answers 416.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) {
    return null
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) {
    return null
  }

  const [, rawStart, rawEnd] = match
  let start: number
  let end: number

  if (rawStart) {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  } else {
    const suffix = Number(rawEnd)
    start = Math.max(0, size - suffix)
    end = size - 1
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
    return null
  }

  return { start, end: Math.min(end, size - 1) }
}

/** Reads only directory entries; file sizes are fetched for the visible page. */
async function scan(root: string): Promise<LibraryFile[]> {
  const files: LibraryFile[] = []
  const directories = [root]

  async function worker(): Promise<void> {
    while (directories.length) {
      const directory = directories.shift()
      if (!directory) {
        return
      }

      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue
        }
        const full = join(directory, entry.name)
        if (entry.isDirectory()) {
          directories.push(full)
        } else if (entry.isFile() && isAudioFile(entry.name)) {
          const path = relative(root, full).split(sep).join('/')
          files.push({
            id: createHash('sha1').update(`${root}|${path}`).digest('hex').slice(0, 12),
            name: basename(entry.name, extname(entry.name)),
            path,
          })
        }
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, () => worker()))
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/** Indexes the configured folders and serves their files to the speaker. */
export class LibraryService {
  private readonly cache = new Map<string, { at: number; files: LibraryFile[] }>()
  private readonly scanning = new Map<string, Promise<LibraryFile[]>>()
  private readonly getConfig: () => AppConfig
  private readonly port: number

  constructor(getConfig: () => AppConfig, port: number) {
    this.getConfig = getConfig
    this.port = port
  }

  /** Starts indexing at boot so the first Browse request is usually instant. */
  warmup(): void {
    void (async () => {
      for (const library of this.getConfig().libraries) {
        await this.files(library.path).catch(() => undefined)
      }
    })()
  }

  async listing(options: ListingOptions = {}): Promise<LibraryListing> {
    const config = this.getConfig()
    const mediaBaseUrl = detectMediaBaseUrl(config.host, this.port, config.mediaBaseUrl)
    const libraries = config.libraries
    const selected = options.libraryId
      ? libraries.filter((library) => library.id === options.libraryId)
      : libraries
    const query = (options.query ?? '').trim()
    const requestedLimit = Number(options.limit)
    const requestedOffset = Number(options.offset)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requestedLimit)))
      : DEFAULT_LIMIT
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.trunc(requestedOffset))
      : 0

    if (!libraries.length) {
      return { libraries: [], entries: [], total: 0, query, limit, offset, mediaBaseUrl }
    }

    const scanned = await Promise.all(selected.map(async (library) => ({
      library,
      files: await this.files(library.path),
    })))
    const needle = query.toLowerCase()
    const matching = scanned
      .flatMap(({ library, files }, libraryIndex) => files.map((file) => ({ library, libraryIndex, file })))
      .filter(({ file }) => !options.dir || dirname(file.path) === options.dir)
      .filter(({ library, file }) => !needle || `${file.name} ${file.path} ${library.name}`.toLowerCase().includes(needle))
      .sort((left, right) => left.libraryIndex - right.libraryIndex
        || left.file.path.localeCompare(right.file.path))
    const page = matching.slice(offset, offset + limit)
    const entries = await Promise.all(page.map(({ library, file }) => this.entry(mediaBaseUrl, library, file)))

    return {
      libraries,
      entries: entries.filter((entry): entry is LibraryEntry => entry !== null),
      total: matching.length,
      query,
      limit,
      offset,
      mediaBaseUrl,
    }
  }

  /** Groups the index into album folders, each with cover art. */
  async albums(options: ListingOptions = {}): Promise<AlbumListing> {
    const config = this.getConfig()
    const libraries = config.libraries
    const selected = options.libraryId
      ? libraries.filter((library) => library.id === options.libraryId)
      : libraries
    const query = (options.query ?? '').trim()
    const needle = query.toLowerCase()
    const requestedLimit = Number(options.limit)
    const requestedOffset = Number(options.offset)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(MAX_ALBUM_LIMIT, Math.max(1, Math.trunc(requestedLimit)))
      : DEFAULT_ALBUM_LIMIT
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.trunc(requestedOffset))
      : 0

    if (!libraries.length) {
      return { libraries: [], albums: [], total: 0, query, limit, offset }
    }

    const scanned = await Promise.all(selected.map(async (library) => ({
      library,
      files: await this.files(library.path),
    })))

    const groups = new Map<string, { library: LibraryRoot; dir: string; files: LibraryFile[] }>()
    for (const { library, files } of scanned) {
      for (const file of files) {
        const dir = dirname(file.path)
        const key = `${library.id}|${dir}`
        const group = groups.get(key)
        if (group) {
          group.files.push(file)
        } else {
          groups.set(key, { library, dir, files: [file] })
        }
      }
    }

    const albums = [...groups.values()]
      .map((group) => ({
        group,
        name: group.dir === '.' ? group.library.name : basename(group.dir),
      }))
      .filter(({ group, name }) => !needle
        || name.toLowerCase().includes(needle)
        || group.library.name.toLowerCase().includes(needle)
        || group.files.some((file) => file.name.toLowerCase().includes(needle)))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
        || left.group.library.name.localeCompare(right.group.library.name))
      .map(({ group, name }) => ({
        id: createHash('sha1').update(`${group.library.id}|${group.dir}`).digest('hex').slice(0, 12),
        name,
        path: group.dir,
        libraryId: group.library.id,
        libraryName: group.library.name,
        trackCount: group.files.length,
        artworkUrl: `/api/library/art?library=${encodeURIComponent(group.library.id)}&path=${encodeURIComponent(group.files[0].path)}`,
      }))

    return {
      libraries,
      albums: albums.slice(offset, offset + limit),
      total: albums.length,
      query,
      limit,
      offset,
    }
  }

  /** Resolves a relative path to a real file inside one of the libraries. */
  resolveFile(libraryId: string, relativePath: string): string | null {    const library = this.getConfig().libraries.find((entry) => entry.id === libraryId)
    if (!library || !relativePath) {
      return null
    }

    const rootReal = safeReal(library.path)
    if (!rootReal) {
      return null
    }

    const candidate = resolve(rootReal, relativePath)
    if (!isInside(rootReal, candidate)) {
      return null
    }

    const real = safeReal(candidate)
    if (!real || !isInside(rootReal, real) || !isAudioFile(real)) {
      return null
    }

    return real
  }

  /** Streams a file with range support. Returns false when it is not servable. */
  stream(libraryId: string, relativePath: string, request: IncomingMessage, response: ServerResponse): boolean {    const file = this.resolveFile(libraryId, relativePath)
    if (!file) {
      return false
    }

    let size: number
    try {
      size = statSync(file).size
    } catch {
      return false
    }

    const rangeHeader = request.headers.range
    const range = parseRange(rangeHeader, size)
    if (rangeHeader && !range) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` })
      response.end()
      return true
    }

    const start = range?.start ?? 0
    const end = range?.end ?? size - 1
    const length = size === 0 ? 0 : end - start + 1
    const headers: Record<string, string | number> = {
      'Content-Type': audioMime(file),
      'Accept-Ranges': 'bytes',
      'Content-Length': length,
      'Cache-Control': 'no-cache',
    }
    if (range) {
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }

    response.writeHead(range ? 206 : 200, headers)
    if (request.method === 'HEAD' || length === 0) {
      response.end()
      return true
    }

    createReadStream(file, { start, end })
      .on('error', () => response.destroy())
      .pipe(response)
    return true
  }

  /**
   * The folder that holds `relativePath` as an ordered list of targets, so
   * picking one library track continues through the rest of its folder.
   */
  async folderTargets(libraryId: string, relativePath: string): Promise<{ targets: PlayTarget[]; index: number } | null> {
    const file = this.resolveFile(libraryId, relativePath)
    const config = this.getConfig()
    const library = config.libraries.find((entry) => entry.id === libraryId)
    const rootReal = library ? safeReal(library.path) : null
    if (!file || !rootReal) {
      return null
    }

    const directory = dirname(file)
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    const names = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && isAudioFile(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
    const index = names.findIndex((name) => join(directory, name) === file)
    if (index === -1) {
      return null
    }

    const mediaBaseUrl = detectMediaBaseUrl(config.host, this.port, config.mediaBaseUrl)
    const targets = names.map((name) => {
      const path = relative(rootReal, join(directory, name)).split(sep).join('/')
      return {
        url: `${mediaBaseUrl}/api/library/file?library=${encodeURIComponent(libraryId)}&path=${encodeURIComponent(path)}`,
        title: basename(name, extname(name)),
        isLive: false,
      }
    })

    return { targets, index }
  }

  /** Cover art embedded in a library file, or an image from its album folder. */
  async artwork(libraryId: string, relativePath: string): Promise<CoverArt | null> {
    const file = this.resolveFile(libraryId, relativePath)
    return file ? readCoverArt(file) : null
  }

  /**
   * Maps a playing library file URL to its artwork endpoint. Local files have no
   * DIDL artwork, so the poller asks for one when the speaker reports none.
   */
  artworkUrl(playbackUrl: string): string | null {
    if (!playbackUrl) {
      return null
    }
    let url: URL
    try {
      url = new URL(playbackUrl, 'http://localhost')
    } catch {
      return null
    }
    if (url.pathname !== '/api/library/file') {
      return null
    }
    const library = url.searchParams.get('library')
    const path = url.searchParams.get('path')
    if (!library || !path) {
      return null
    }
    return `/api/library/art?library=${encodeURIComponent(library)}&path=${encodeURIComponent(path)}`
  }

  private async entry(mediaBaseUrl: string, library: LibraryRoot, file: LibraryFile): Promise<LibraryEntry | null> {
    try {
      const stats = await stat(join(library.path, file.path))
      return {
        ...file,
        libraryId: library.id,
        libraryName: library.name,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        url: `${mediaBaseUrl}/api/library/file?library=${encodeURIComponent(library.id)}&path=${encodeURIComponent(file.path)}`,
      }
    } catch {
      return null
    }
  }

  private async files(root: string): Promise<LibraryFile[]> {
    const cached = this.cache.get(root)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.files
    }

    const running = this.scanning.get(root)
    if (running) {
      return running
    }

    const scanning = scan(root)
      .then((files) => {
        this.cache.set(root, { at: Date.now(), files })
        return files
      })
      .finally(() => {
        this.scanning.delete(root)
      })

    this.scanning.set(root, scanning)
    return scanning
  }
}
