import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Playlist, PlaylistItem, PlayTarget } from '../shared/types.ts'
import { validateTarget } from './presets.ts'

const MAX_PLAYLISTS = 50
const MAX_ITEMS = 500
let sequence = 0

function newId(prefix: string): string {
  sequence += 1
  return createHash('sha1').update(`${prefix}|${Date.now()}|${sequence}`).digest('hex').slice(0, 12)
}

function validateName(value: unknown): string {
  const name = String(value ?? '').trim().slice(0, 80)
  if (!name) {
    throw new Error('A playlist needs a name')
  }
  return name
}

function isPlaylist(value: unknown): value is Playlist {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.items)
    && typeof candidate.createdAt === 'number'
    && typeof candidate.updatedAt === 'number'
}

/** Playlists of any source: library files, radio stations or Plex tracks. */
export class PlaylistStore {
  private readonly file: string
  /** Parsed file contents, validated against the file's mtime and size. */
  private cache: { mtimeMs: number; size: number; value: Playlist[] } | null = null

  constructor(directory: string) {
    this.file = join(directory, 'playlists.json')
  }

  list(): Playlist[] {
    return this.read()
  }

  create(name: unknown): Playlist[] {
    const playlists = this.read()
    if (playlists.length >= MAX_PLAYLISTS) {
      throw new Error(`At most ${MAX_PLAYLISTS} playlists are supported`)
    }

    const now = Date.now()
    playlists.push({
      id: newId('playlist'),
      name: validateName(name),
      items: [],
      createdAt: now,
      updatedAt: now,
    })
    this.write(playlists)
    return playlists
  }

  rename(id: string, name: unknown): Playlist[] {
    const playlists = this.read()
    const playlist = playlists.find((entry) => entry.id === id)
    if (!playlist) {
      throw new Error('Playlist not found')
    }

    playlist.name = validateName(name)
    playlist.updatedAt = Date.now()
    this.write(playlists)
    return playlists
  }

  remove(id: string): Playlist[] {
    const playlists = this.read().filter((entry) => entry.id !== id)
    this.write(playlists)
    return playlists
  }

  addItem(id: string, input: PlayTarget): Playlist[] {
    const playlists = this.read()
    const playlist = playlists.find((entry) => entry.id === id)
    if (!playlist) {
      throw new Error('Playlist not found')
    }
    if (playlist.items.length >= MAX_ITEMS) {
      throw new Error(`A playlist can hold at most ${MAX_ITEMS} tracks`)
    }

    const target = validateTarget(input)
    const item: PlaylistItem = { ...target, id: newId('item') }
    playlist.items.push(item)
    playlist.updatedAt = Date.now()
    this.write(playlists)
    return playlists
  }

  removeItem(id: string, itemId: string): Playlist[] {
    const playlists = this.read()
    const playlist = playlists.find((entry) => entry.id === id)
    if (!playlist) {
      throw new Error('Playlist not found')
    }

    playlist.items = playlist.items.filter((item) => item.id !== itemId)
    playlist.updatedAt = Date.now()
    this.write(playlists)
    return playlists
  }

  private read(): Playlist[] {
    try {
      const stats = statSync(this.file)
      const cached = this.cache
      if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached.value
      }

      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const value = Array.isArray(parsed) ? parsed.filter(isPlaylist) : []
      this.cache = { mtimeMs: stats.mtimeMs, size: stats.size, value }
      return value
    } catch {
      this.cache = null
      return []
    }
  }

  private write(playlists: Playlist[]): void {
    // Mutators edit the cached array in place, so drop it before touching the file.
    this.cache = null
    mkdirSync(join(this.file, '..'), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(playlists, null, 2)}\n`, 'utf8')
  }
}
