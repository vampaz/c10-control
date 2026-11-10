import type { RadioStation } from '../shared/types.ts'

const DIRECTORY = 'https://de1.api.radio-browser.info'
const CACHE_TTL_MS = 5 * 60_000
const MIN_QUERY_LENGTH = 2

interface CacheEntry {
  storedAt: number
  stations: RadioStation[]
}

const cache = new Map<string, CacheEntry>()

interface RawStation {
  stationuuid?: string
  name?: string
  url_resolved?: string
  favicon?: string
  country?: string
  tags?: string
  codec?: string
  bitrate?: number
  hls?: number
}

function remember(key: string, stations: RadioStation[]): void {
  cache.set(key, { storedAt: Date.now(), stations })
  if (cache.size > 60) {
    const oldest = [...cache.entries()].sort((left, right) => left[1].storedAt - right[1].storedAt)[0]
    if (oldest) {
      cache.delete(oldest[0])
    }
  }
}

async function requestStations(url: string, limit: number): Promise<RadioStation[]> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'c10-control/0.2 (+local network speaker remote)' },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new Error('The radio directory is unreachable')
  }

  if (!response.ok) {
    throw new Error(`The radio directory answered HTTP ${response.status}`)
  }

  return normaliseStations(await response.json(), limit)
}

/**
 * The 2021 firmware cannot play HLS, so only direct streams are offered.
 * Entries without a resolved URL are useless to the speaker too.
 */
export function normaliseStations(raw: unknown, limit: number): RadioStation[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const seen = new Set<string>()
  const stations: RadioStation[] = []

  for (const entry of raw as RawStation[]) {
    const url = entry.url_resolved?.trim()
    const name = entry.name?.trim()
    if (!url || !name || entry.hls === 1 || seen.has(url)) {
      continue
    }

    seen.add(url)
    stations.push({
      id: entry.stationuuid?.trim() || url,
      name,
      url,
      country: entry.country?.trim() || '',
      tags: (entry.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(', '),
      codec: entry.codec?.trim() ?? '',
      bitrate: Number(entry.bitrate) || 0,
      artworkUrl: entry.favicon?.trim() || null,
    })

    if (stations.length >= limit) {
      break
    }
  }

  return stations
}

export async function searchStations(query: string, limit = 30): Promise<RadioStation[]> {
  const text = query.trim()
  if (text.length < MIN_QUERY_LENGTH) {
    return []
  }

  const key = `${limit}:${text.toLowerCase()}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) {
    return cached.stations
  }

  const url = `${DIRECTORY}/json/stations/search?name=${encodeURIComponent(text)}`
    + `&limit=${limit}&order=clickcount&reverse=true&hidebroken=true`

  const stations = await requestStations(url, limit)
  remember(key, stations)
  return stations
}

/** Most-played stations, for browsing before typing a search. */
export async function topStations(limit = 20, offset = 0): Promise<RadioStation[]> {
  const size = Math.min(50, Math.max(1, Math.trunc(limit) || 20))
  const skip = Math.max(0, Math.trunc(offset) || 0)
  const key = `top:${size}:${skip}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) {
    return cached.stations
  }

  const url = `${DIRECTORY}/json/stations/search?order=clickcount&reverse=true&hidebroken=true`
    + `&limit=${size}&offset=${skip}`

  const stations = await requestStations(url, size)
  remember(key, stations)
  return stations
}
