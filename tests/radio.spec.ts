import { describe, expect, it, vi } from 'vitest'
import { normaliseStations, topStations } from '../server/radio.ts'

const RAW = [
  {
    stationuuid: 'a',
    name: 'Jazz FM',
    url_resolved: 'http://stream.example.com/jazz',
    favicon: 'http://cdn.example.com/jazz.png',
    country: 'United Kingdom',
    tags: 'jazz,smooth,chill,late,extra',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
  },
  { stationuuid: 'b', name: 'HLS only', url_resolved: 'http://stream.example.com/hls', hls: 1 },
  { stationuuid: 'c', name: 'No URL', url_resolved: '', hls: 0 },
  { stationuuid: 'd', name: '', url_resolved: 'http://stream.example.com/anon', hls: 0 },
  {
    stationuuid: 'e',
    name: 'Jazz FM duplicate',
    url_resolved: 'http://stream.example.com/jazz',
    hls: 0,
  },
]

describe('normaliseStations', () => {
  const stations = normaliseStations(RAW, 10)

  it('keeps playable direct streams', () => {
    expect(stations).toHaveLength(1)
    expect(stations[0]).toMatchObject({
      id: 'a',
      name: 'Jazz FM',
      url: 'http://stream.example.com/jazz',
      country: 'United Kingdom',
      codec: 'MP3',
      bitrate: 128,
      artworkUrl: 'http://cdn.example.com/jazz.png',
    })
  })

  it('drops HLS, unnamed and URL-less entries', () => {
    expect(stations.map((station) => station.id)).toEqual(['a'])
  })

  it('drops duplicate URLs', () => {
    expect(new Set(stations.map((station) => station.url)).size).toBe(stations.length)
  })

  it('shortens the tag list', () => {
    expect(stations[0].tags).toBe('jazz, smooth, chill, late')
  })

  it('respects the limit', () => {
    expect(normaliseStations(RAW, 1)).toHaveLength(1)
  })

  it('tolerates a broken payload', () => {
    expect(normaliseStations({ not: 'a list' }, 10)).toEqual([])
    expect(normaliseStations(null, 10)).toEqual([])
  })
})

describe('topStations', () => {
  it('lists popular stations with paging', async () => {
    const fetchMock = vi.fn(async (_input: unknown) => new Response(JSON.stringify(RAW), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const stations = await topStations(20, 137)

      expect(stations.map((station) => station.name)).toEqual(['Jazz FM'])
      const url = String(fetchMock.mock.calls[0][0])
      expect(url).toContain('order=clickcount')
      expect(url).toContain('offset=137')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
