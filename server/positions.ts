import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Entry {
  position: number
  duration: number
  updatedAt: number
}

const MAX_ENTRIES = 2000
const MIN_RESUME_SECONDS = 5
const END_MARGIN_SECONDS = 10
const SAVE_INTERVAL_MS = 10_000

/** Keys library files by id and path, so an address change keeps the position. */
function positionKey(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/library/file') {
      const library = parsed.searchParams.get('library')
      const path = parsed.searchParams.get('path')
      if (library && path) {
        return `${library}|${path}`
      }
    }
  } catch {
    // Fall through to the raw URL.
  }
  return url
}

/**
 * Remembers where each finite track stopped, so playing it again resumes
 * instead of starting over.
 */
export class PositionStore {
  private readonly entries = new Map<string, Entry>()
  private readonly path: string
  private savedAt = 0

  constructor(directory: string) {
    this.path = join(directory, 'positions.json')
    this.load()
  }

  /** Seconds to resume from, or null when the track should start over. */
  resume(url: string): number | null {
    const entry = this.entries.get(positionKey(url))
    if (!entry) {
      return null
    }
    if (entry.position < MIN_RESUME_SECONDS) {
      return null
    }
    if (entry.duration > 0 && entry.position >= entry.duration - END_MARGIN_SECONDS) {
      return null
    }
    return Math.floor(entry.position)
  }

  record(url: string, position: number, duration: number, ended: boolean): void {
    if (!url || !Number.isFinite(position)) {
      return
    }
    const key = positionKey(url)
    if (ended) {
      if (this.entries.delete(key)) {
        this.save(true)
      }
      return
    }
    if (position < 1) {
      return
    }

    const previous = this.entries.get(key)
    this.entries.set(key, { position, duration, updatedAt: Date.now() })
    this.trim()
    if (!previous || Math.abs(previous.position - position) >= 10) {
      this.save(false)
    }
  }

  private trim(): void {
    if (this.entries.size <= MAX_ENTRIES) {
      return
    }
    const oldest = [...this.entries.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    for (const [key] of oldest.slice(0, this.entries.size - MAX_ENTRIES)) {
      this.entries.delete(key)
    }
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, Entry>
      for (const [key, value] of Object.entries(raw)) {
        if (value && Number.isFinite(value.position) && Number.isFinite(value.duration)) {
          this.entries.set(key, value)
        }
      }
    } catch {
      // No saved positions yet.
    }
  }

  private save(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.savedAt < SAVE_INTERVAL_MS) {
      return
    }
    try {
      mkdirSync(join(this.path, '..'), { recursive: true })
      const temporary = `${this.path}.tmp`
      writeFileSync(temporary, `${JSON.stringify(Object.fromEntries(this.entries))}\n`, 'utf8')
      renameSync(temporary, this.path)
      this.savedAt = now
    } catch {
      // Positions are a convenience; a failed write must not break playback.
    }
  }
}
