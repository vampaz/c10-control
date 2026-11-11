import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Favorite, RadioStation } from '../shared/types.ts'

const MAX_FAVORITES = 100

/** Stable id for a stream that has none, based on its URL. */
export function stationId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 12)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value)
}

export function validateStation(input: RadioStation): RadioStation {
  const name = String(input.name ?? '').trim()
  const url = String(input.url ?? '').trim()

  if (!name) {
    throw new Error('A station needs a name')
  }
  if (!isHttpUrl(url)) {
    throw new Error('A station needs an http or https stream URL')
  }

  return {
    id: String(input.id ?? '').trim() || stationId(url),
    name: name.slice(0, 200),
    url,
    country: String(input.country ?? '').trim().slice(0, 80),
    tags: String(input.tags ?? '').trim().slice(0, 200),
    codec: String(input.codec ?? '').trim().slice(0, 20),
    bitrate: Number(input.bitrate) || 0,
    artworkUrl: input.artworkUrl ? String(input.artworkUrl).trim() : null,
  }
}

function isFavorite(value: unknown): value is Favorite {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.addedAt === 'number'
}

/** Favourites live next to the configuration, so they survive restarts. */
export class FavoriteStore {
  private readonly file: string
  /** Parsed file contents, validated against the file's mtime and size. */
  private cache: { mtimeMs: number; size: number; value: Favorite[] } | null = null

  constructor(directory: string) {
    this.file = join(directory, 'favorites.json')
  }

  list(): Favorite[] {
    return this.read()
  }

  add(input: RadioStation): Favorite[] {
    const station = validateStation(input)
    const favorite: Favorite = { ...station, addedAt: Date.now() }
    const remaining = this.read().filter((entry) => entry.url !== station.url)
    const next = [favorite, ...remaining].slice(0, MAX_FAVORITES)

    this.write(next)
    return next
  }

  remove(id: string): Favorite[] {
    const next = this.read().filter((entry) => entry.id !== id)
    this.write(next)
    return next
  }

  private read(): Favorite[] {
    try {
      const stats = statSync(this.file)
      const cached = this.cache
      if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached.value
      }

      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const value = Array.isArray(parsed) ? parsed.filter(isFavorite) : []
      this.cache = { mtimeMs: stats.mtimeMs, size: stats.size, value }
      return value
    } catch {
      this.cache = null
      return []
    }
  }

  private write(favorites: Favorite[]): void {
    this.cache = null
    mkdirSync(join(this.file, '..'), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(favorites, null, 2)}\n`, 'utf8')
  }
}
