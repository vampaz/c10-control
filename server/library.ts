import { createHash } from 'node:crypto'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { AlbumListing, AppConfig, LibraryAlbum, LibraryEntry, LibraryListing, LibraryRoot, PlayTarget } from '../shared/types.ts'
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

interface AlbumIndexEntry {
  album: LibraryAlbum
  /** Folded album, library and track names, ready for substring search. */
  search: string
}

/** Lowercases and strips accents, so "Oxigenio" finds "Oxigénio". */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Reads the library file reference from one of our own file URLs. */
function libraryFile(url: string): { libraryId: string; path: string } | null {
  try {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname !== '/api/library/file') {
      return null
    }
    const libraryId = parsed.searchParams.get('library')
    const path = parsed.searchParams.get('path')
    return libraryId && path ? { libraryId, path } : null
  } catch {
    return null
  }
}

/** Disc folders such as "CD1", "Disc 2" or "disk_3" belong to their parent album. */
const DISC_FOLDER = /^(cd|disc|disk)[\s._-]*\d+$/i

function albumDir(dir: string): string {
  return dir !== '.' && DISC_FOLDER.test(basename(dir)) ? dirname(dir) : dir
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
  private readonly albumCache = new Map<string, { at: number; entries: AlbumIndexEntry[] }>()
  private readonly artPresence = new Map<string, boolean>()
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
    const needle = fold(query)
    const matching = scanned
      .flatMap(({ library, files }, libraryIndex) => files.map((file) => ({ library, libraryIndex, file })))
      .filter(({ file }) => !options.dir || albumDir(dirname(file.path)) === options.dir)
      .filter(({ library, file }) => !needle || fold(`${file.name} ${file.path} ${library.name}`).includes(needle))
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
    const needle = fold(query)
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

    const entries = scanned
      .flatMap(({ library, files }) => this.albumIndex(library, files))
      .filter((entry) => !needle || entry.search.includes(needle))

    // The per-library index is already sorted; only a combined view needs a merge.
    const albums = entries.map((entry) => entry.album)
    if (scanned.length > 1) {
      albums.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
        || left.libraryName.localeCompare(right.libraryName))
    }

    return {
      libraries,
      albums: albums.slice(offset, offset + limit),
      total: albums.length,
      query,
      limit,
      offset,
    }
  }

  /** Builds, and caches, one library's album entries for its current files. */
  private albumIndex(library: LibraryRoot, files: LibraryFile[]): AlbumIndexEntry[] {
    const key = `${library.id}|${library.path}`
    const cached = this.albumCache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.entries
    }

    const groups = new Map<string, LibraryFile[]>()
    for (const file of files) {
      const dir = albumDir(dirname(file.path))
      const group = groups.get(dir)
      if (group) {
        group.push(file)
      } else {
        groups.set(dir, [file])
      }
    }

    const entries = [...groups.entries()].map(([dir, groupFiles]) => {
      const name = dir === '.' ? library.name : basename(dir)
      return {
        album: {
          id: createHash('sha1').update(`${library.id}|${dir}`).digest('hex').slice(0, 12),
          name,
          path: dir,
          libraryId: library.id,
          libraryName: library.name,
          trackCount: groupFiles.length,
          artworkUrl: `/api/library/art?library=${encodeURIComponent(library.id)}&path=${encodeURIComponent(groupFiles[0].path)}`,
        },
        search: fold(`${name} ${library.name} ${groupFiles.map((file) => file.name).join(' ')}`),
      }
    })

    entries.sort((left, right) => left.album.name.localeCompare(right.album.name, undefined, { numeric: true, sensitivity: 'base' })
      || left.album.libraryName.localeCompare(right.album.libraryName))

    this.albumCache.set(key, { at: Date.now(), entries })
    return entries
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

    const targetPath = relative(rootReal, file).split(sep).join('/')
    const directory = dirname(file)
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    const paths = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && isAudioFile(entry.name))
      .map((entry) => relative(rootReal, join(directory, entry.name)).split(sep).join('/'))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
    const index = paths.indexOf(targetPath)
    if (index === -1) {
      return null
    }

    return { targets: this.buildTargets(libraryId, paths), index }
  }

  /**
   * Every track of an album, including tracks inside its CD1, CD2, ... disc
   * folders, so Play and Shuffle cover the whole release.
   */
  async albumTargets(libraryId: string, dir: string): Promise<{ targets: PlayTarget[]; index: number } | null> {
    const config = this.getConfig()
    const library = config.libraries.find((entry) => entry.id === libraryId)
    const rootReal = library ? safeReal(library.path) : null
    if (!library || !rootReal) {
      return null
    }

    const normalised = dir.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
    const directory = normalised === '' || normalised === '.'
      ? rootReal
      : safeReal(resolve(rootReal, normalised))
    if (!directory || !isInside(rootReal, directory)) {
      return null
    }

    const paths: string[] = []
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.') && isAudioFile(entry.name)) {
        paths.push(relative(rootReal, join(directory, entry.name)).split(sep).join('/'))
      } else if (entry.isDirectory() && DISC_FOLDER.test(entry.name)) {
        const disc = join(directory, entry.name)
        const discEntries = await readdir(disc, { withFileTypes: true }).catch(() => [])
        for (const file of discEntries) {
          if (file.isFile() && !file.name.startsWith('.') && isAudioFile(file.name)) {
            paths.push(relative(rootReal, join(disc, file.name)).split(sep).join('/'))
          }
        }
      }
    }

    if (!paths.length) {
      return null
    }
    paths.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
    return { targets: this.buildTargets(libraryId, paths), index: 0 }
  }

  private buildTargets(libraryId: string, paths: string[]): PlayTarget[] {
    const config = this.getConfig()
    const mediaBaseUrl = detectMediaBaseUrl(config.host, this.port, config.mediaBaseUrl)
    return paths.map((path) => ({
      url: `${mediaBaseUrl}/api/library/file?library=${encodeURIComponent(libraryId)}&path=${encodeURIComponent(path)}`,
      title: basename(path, extname(path)),
      isLive: false,
    }))
  }

  /**
   * Rebuilds a stored library URL against the current media address, so a
   * preset or playlist item keeps working when the machine's address changes.
   */
  resolveTarget(target: PlayTarget): PlayTarget {
    const reference = libraryFile(target.url)
    if (!reference || !this.resolveFile(reference.libraryId, reference.path)) {
      return target
    }
    const config = this.getConfig()
    const mediaBaseUrl = detectMediaBaseUrl(config.host, this.port, config.mediaBaseUrl)
    return {
      ...target,
      url: `${mediaBaseUrl}/api/library/file?library=${encodeURIComponent(reference.libraryId)}&path=${encodeURIComponent(reference.path)}`,
    }
  }

  /**
   * The playback artwork URL, but only when the file actually has art, so the
   * browser does not request a cover that would answer 404.
   */
  async artworkForPlayback(url: string): Promise<string | null> {
    const link = this.artworkUrl(url)
    const reference = libraryFile(url)
    const file = reference ? this.resolveFile(reference.libraryId, reference.path) : null
    if (!link || !file) {
      return null
    }

    const cached = this.artPresence.get(url)
    if (cached !== undefined) {
      return cached ? link : null
    }

    const art = await readCoverArt(file).catch(() => null)
    const present = art !== null
    this.artPresence.set(url, present)
    if (this.artPresence.size > 200) {
      const oldest = this.artPresence.keys().next().value
      if (oldest !== undefined) {
        this.artPresence.delete(oldest)
      }
    }
    return present ? link : null
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
