import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlaylistStore } from '../server/playlists.ts'

const TARGET = {
  url: 'http://192.168.1.135:5173/api/library/file?library=main&path=a.mp3',
  title: 'Track',
  isLive: false,
}

function store(): PlaylistStore {
  return new PlaylistStore(mkdtempSync(join(tmpdir(), 'c10-playlists-')))
}

describe('PlaylistStore', () => {
  it('creates and lists playlists', () => {
    const playlists = store()
    const created = playlists.create(' Road trip ')

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ name: 'Road trip', items: [] })
    expect(playlists.list()).toHaveLength(1)
  })

  it('renames and removes a playlist', () => {
    const playlists = store()
    const id = playlists.create('Old').at(-1)?.id ?? ''

    expect(playlists.rename(id, 'New')[0].name).toBe('New')
    expect(playlists.remove(id)).toEqual([])
  })

  it('adds and removes items', () => {
    const playlists = store()
    const id = playlists.create('Mix').at(-1)?.id ?? ''

    const added = playlists.addItem(id, TARGET)
    expect(added[0].items).toHaveLength(1)
    expect(added[0].items[0]).toMatchObject({ title: 'Track', isLive: false })

    const itemId = added[0].items[0].id
    expect(playlists.removeItem(id, itemId)[0].items).toEqual([])
  })

  it('allows the same track twice', () => {
    const playlists = store()
    const id = playlists.create('Mix').at(-1)?.id ?? ''

    playlists.addItem(id, TARGET)
    const added = playlists.addItem(id, TARGET)

    expect(added[0].items).toHaveLength(2)
    expect(added[0].items[0].id).not.toBe(added[0].items[1].id)
  })

  it('rejects an empty name', () => {
    expect(() => store().create('  ')).toThrow('playlist needs a name')
  })

  it('rejects an item that is not an http URL', () => {
    const playlists = store()
    const id = playlists.create('Mix').at(-1)?.id ?? ''

    expect(() => playlists.addItem(id, { ...TARGET, url: 'file:///a.mp3' })).toThrow('http or https')
  })

  it('rejects an unknown playlist', () => {
    const playlists = store()
    expect(() => playlists.rename('missing', 'Name')).toThrow('Playlist not found')
    expect(() => playlists.addItem('missing', TARGET)).toThrow('Playlist not found')
    expect(() => playlists.removeItem('missing', 'x')).toThrow('Playlist not found')
  })
})
