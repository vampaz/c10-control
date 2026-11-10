import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FavoriteStore, stationId, validateStation } from '../server/favorites.ts'
import type { RadioStation } from '../shared/types.ts'

const directories: string[] = []

function store(): FavoriteStore {
  const directory = mkdtempSync(join(tmpdir(), 'c10-fav-'))
  directories.push(directory)
  return new FavoriteStore(directory)
}

function station(overrides: Partial<RadioStation> = {}): RadioStation {
  return {
    id: 'station-1',
    name: 'Jazz FM',
    url: 'http://stream.example.com/jazz',
    country: 'United Kingdom',
    tags: 'jazz',
    codec: 'MP3',
    bitrate: 128,
    artworkUrl: null,
    ...overrides,
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('stationId', () => {
  it('is stable for the same URL', () => {
    expect(stationId('http://a')).toBe(stationId('http://a'))
    expect(stationId('http://a')).not.toBe(stationId('http://b'))
  })
})

describe('validateStation', () => {
  it('requires a name and an http URL', () => {
    expect(() => validateStation(station({ name: '  ' }))).toThrow('A station needs a name')
    expect(() => validateStation(station({ url: 'ftp://x' }))).toThrow('A station needs an http or https stream URL')
  })

  it('derives an id when the station has none', () => {
    expect(validateStation(station({ id: '' })).id).toBe(stationId('http://stream.example.com/jazz'))
  })
})

describe('FavoriteStore', () => {
  it('starts empty', () => {
    expect(store().list()).toEqual([])
  })

  it('saves and lists a station', () => {
    const favorites = store()
    const list = favorites.add(station())

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'station-1', name: 'Jazz FM' })
    expect(list[0].addedAt).toBeGreaterThan(0)
    expect(favorites.list()).toHaveLength(1)
  })

  it('keeps the newest first and replaces the same URL', () => {
    const favorites = store()
    favorites.add(station())
    favorites.add(station({ id: 'station-2', name: 'Rock FM', url: 'http://stream.example.com/rock' }))
    const list = favorites.add(station({ name: 'Jazz FM updated' }))

    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('Jazz FM updated')
  })

  it('removes by id', () => {
    const favorites = store()
    favorites.add(station())

    expect(favorites.remove('station-1')).toEqual([])
    expect(favorites.list()).toEqual([])
  })

  it('survives a corrupt file', () => {
    const favorites = store()
    favorites.add(station())
    writeFileSync(join(directories[0], 'favorites.json'), 'not json')

    expect(favorites.list()).toEqual([])
  })

  it('ignores entries that are not favourites', () => {
    const favorites = store()
    writeFileSync(join(directories[0], 'favorites.json'), JSON.stringify([{ id: 'x' }, station()]))

    expect(favorites.list()).toHaveLength(0)
  })
})
