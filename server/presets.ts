import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlayTarget } from '../shared/types.ts'

export const PRESET_COUNT = 6

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value)
}

export function validateTarget(input: PlayTarget): PlayTarget {
  const url = String(input.url ?? '').trim()
  if (!isHttpUrl(url)) {
    throw new Error('A preset needs an http or https URL')
  }

  return {
    url,
    title: String(input.title ?? '').trim().slice(0, 200) || undefined,
    artist: String(input.artist ?? '').trim().slice(0, 200) || undefined,
    artworkUrl: input.artworkUrl ? String(input.artworkUrl).trim() : null,
    isLive: input.isLive !== false,
  }
}

function validIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= PRESET_COUNT) {
    throw new Error(`Preset index must be between 0 and ${PRESET_COUNT - 1}`)
  }
  return index
}

function isPlayTarget(value: unknown): value is PlayTarget {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.url === 'string' && isHttpUrl(candidate.url)
}

/** Six one-tap slots, saved next to the configuration. */
export class PresetStore {
  private readonly file: string

  constructor(directory: string) {
    this.file = join(directory, 'presets.json')
  }

  list(): (PlayTarget | null)[] {
    const stored = this.read()
    return Array.from({ length: PRESET_COUNT }, (_, index) => stored[index] ?? null)
  }

  save(index: number, input: PlayTarget): (PlayTarget | null)[] {
    const target = validateTarget(input)
    const slots = this.list()
    slots[validIndex(index)] = target
    this.write(slots)
    return slots
  }

  clear(index: number): (PlayTarget | null)[] {
    const slots = this.list()
    slots[validIndex(index)] = null
    this.write(slots)
    return slots
  }

  private read(): (PlayTarget | null)[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed) ? parsed.map((entry) => (isPlayTarget(entry) ? entry : null)) : []
    } catch {
      return []
    }
  }

  private write(slots: (PlayTarget | null)[]): void {
    mkdirSync(join(this.file, '..'), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(slots, null, 2)}\n`, 'utf8')
  }
}
