import { createHash } from 'node:crypto'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type { AppConfig, LibraryEntry, LibraryListing, LibraryRoot } from '../shared/types.ts'
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

  /** Resolves a relative path to a real file inside one of the libraries. */
  resolveFile(libraryId: string, relativePath: string): string | null {
    const library = this.getConfig().libraries.find((entry) => entry.id === libraryId)
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
  stream(libraryId: string, relativePath: string, request: IncomingMessage, response: ServerResponse): boolean {
    const file = this.resolveFile(libraryId, relativePath)
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
