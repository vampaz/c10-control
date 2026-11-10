import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig, PlayTarget } from '../shared/types.ts'
import { LibraryService, parseRange } from '../server/library.ts'

const directories: string[] = []
const servers: Server[] = []

function fixture(): { root: string; extra: string; outside: string; config: AppConfig } {
  const root = mkdtempSync(join(tmpdir(), 'c10-library-'))
  const extra = mkdtempSync(join(tmpdir(), 'c10-library-extra-'))
  const outside = mkdtempSync(join(tmpdir(), 'c10-outside-'))
  directories.push(root, extra, outside)
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'a.mp3'), '0123456789')
  writeFileSync(join(root, 'sub', 'b.flac'), 'flac')
  writeFileSync(join(root, 'notes.txt'), 'not audio')
  writeFileSync(join(root, '.hidden.mp3'), 'hidden')
  writeFileSync(join(extra, 'c.wav'), 'wav')
  writeFileSync(join(outside, 'secret.mp3'), 'secret')
  symlinkSync(join(outside, 'secret.mp3'), join(root, 'escape.mp3'))

  return {
    root,
    extra,
    outside,
    config: {
      host: '192.168.1.100',
      httpPort: 80,
      upnpPort: 49152,
      libraries: [
        { id: 'main', name: 'Main', path: root },
        { id: 'extra', name: 'Extra', path: extra },
      ],
      browseRoots: [],
      mediaBaseUrl: 'http://192.168.1.135:5173',
    },
  }
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('LibraryService.listing', () => {
  it('indexes audio files from every library and ignores everything else', async () => {
    const { config } = fixture()
    const listing = await new LibraryService(() => config, 5173).listing()

    expect(listing.entries.map((entry) => entry.path)).toEqual(['a.mp3', 'sub/b.flac', 'c.wav'])
    expect(listing.entries.map((entry) => entry.libraryName)).toEqual(['Main', 'Main', 'Extra'])
    expect(listing.total).toBe(3)
    expect(listing.entries[0]).toMatchObject({ name: 'a', size: 10 })
  })

  it('builds a speaker-reachable URL with the library id', async () => {
    const { config } = fixture()
    const listing = await new LibraryService(() => config, 5173).listing()

    expect(listing.mediaBaseUrl).toBe('http://192.168.1.135:5173')
    expect(listing.entries[0].url).toBe('http://192.168.1.135:5173/api/library/file?library=main&path=a.mp3')
    expect(listing.entries[1].url).toContain('path=sub%2Fb.flac')
  })

  it('filters by library and by text', async () => {
    const { config } = fixture()
    const library = new LibraryService(() => config, 5173)

    const extra = await library.listing({ libraryId: 'extra' })
    expect(extra.entries.map((entry) => entry.path)).toEqual(['c.wav'])
    expect(extra.libraries).toHaveLength(2)

    const search = await library.listing({ query: 'b.flac' })
    expect(search.entries.map((entry) => entry.path)).toEqual(['sub/b.flac'])
    expect(search.total).toBe(1)
  })

  it('pages the results', async () => {
    const { config } = fixture()
    const library = new LibraryService(() => config, 5173)

    const first = await library.listing({ limit: 1, offset: 0 })
    const second = await library.listing({ limit: 1, offset: 1 })

    expect(first.entries).toHaveLength(1)
    expect(first.total).toBe(3)
    expect(second.entries[0].path).toBe('sub/b.flac')
  })

  it('returns an empty listing when no folder is configured', async () => {
    const { config } = fixture()
    const listing = await new LibraryService(() => ({ ...config, libraries: [] }), 5173).listing()

    expect(listing.libraries).toEqual([])
    expect(listing.entries).toEqual([])
    expect(listing.total).toBe(0)
  })
})

describe('LibraryService.resolveFile', () => {
  it('accepts a file inside its library', () => {
    const { config } = fixture()
    const library = new LibraryService(() => config, 5173)

    expect(library.resolveFile('main', 'a.mp3')).toContain('a.mp3')
    expect(library.resolveFile('main', 'sub/b.flac')).toContain('b.flac')
  })

  it('rejects traversal, unknown libraries, non-audio files and symlink escapes', () => {
    const { config } = fixture()
    const library = new LibraryService(() => config, 5173)

    expect(library.resolveFile('main', '../secret.mp3')).toBeNull()
    expect(library.resolveFile('nope', 'a.mp3')).toBeNull()
    expect(library.resolveFile('main', 'notes.txt')).toBeNull()
    expect(library.resolveFile('main', 'escape.mp3')).toBeNull()
    expect(library.resolveFile('main', '')).toBeNull()
  })
})

describe('LibraryService.artworkUrl', () => {
  it('maps a playing library file to the artwork endpoint', () => {
    const { config } = fixture()
    const library = new LibraryService(() => config, 5173)

    expect(library.artworkUrl('http://192.168.1.135:5173/api/library/file?library=main&path=sub%2Fb.flac'))
      .toBe('/api/library/art?library=main&path=sub%2Fb.flac')
  })

  it('ignores streams, other paths and empty urls', () => {
    const { config } = fixture()
    const library = new LibraryService(() => config, 5173)

    expect(library.artworkUrl('http://stream.example.com/live.aac')).toBeNull()
    expect(library.artworkUrl('/api/discovery')).toBeNull()
    expect(library.artworkUrl('')).toBeNull()
    expect(library.artworkUrl('http://192.168.1.135:5173/api/library/file?library=main')).toBeNull()
  })
})

describe('LibraryService.folderTargets', () => {
  it('orders the folder and points at the selected track', async () => {
    const { config, root } = fixture()
    mkdirSync(join(root, 'album'))
    writeFileSync(join(root, 'album', '10 Ten.mp3'), 'x')
    writeFileSync(join(root, 'album', '02 Two.mp3'), 'x')
    writeFileSync(join(root, 'album', '01 One.flac'), 'x')
    writeFileSync(join(root, 'album', 'cover.jpg'), 'jpg')

    const folder = await new LibraryService(() => config, 5173).folderTargets('main', 'album/02 Two.mp3')

    expect(folder?.targets.map((target) => target.title)).toEqual(['01 One', '02 Two', '10 Ten'])
    expect(folder?.index).toBe(1)
    expect(folder?.targets[1].url).toContain('/api/library/file?library=main&path=album%2F02%20Two.mp3')
    expect(folder?.targets[1].isLive).toBe(false)
  })

  it('rejects tracks outside a library', async () => {
    const { config } = fixture()
    const service = new LibraryService(() => config, 5173)

    expect(await service.folderTargets('nope', 'a.mp3')).toBeNull()
    expect(await service.folderTargets('main', '../secret.mp3')).toBeNull()
  })
})

describe('LibraryService.albums', () => {
  it('groups files into folders with track counts and art', async () => {
    const { config, root } = fixture()
    mkdirSync(join(root, 'Album A'))
    writeFileSync(join(root, 'Album A', '01.mp3'), 'x')
    writeFileSync(join(root, 'Album A', '02.mp3'), 'x')
    writeFileSync(join(root, 'Album A', 'cover.jpg'), 'jpg')

    const listing = await new LibraryService(() => config, 5173).albums()
    const album = listing.albums.find((entry) => entry.name === 'Album A')

    expect(listing.total).toBe(4)
    expect(album?.trackCount).toBe(2)
    expect(album?.libraryName).toBe('Main')
    expect(album?.artworkUrl).toContain('/api/library/art?library=main&path=Album%20A%2F01.mp3')
  })

  it('filters albums by their name', async () => {
    const { config, root } = fixture()
    mkdirSync(join(root, 'Album A'))
    writeFileSync(join(root, 'Album A', '01.mp3'), 'x')

    const listing = await new LibraryService(() => config, 5173).albums({ query: 'album a' })

    expect(listing.albums.map((entry) => entry.name)).toEqual(['Album A'])
  })
})

describe('LibraryService.listing with a folder', () => {
  it('returns only the files of one album folder', async () => {
    const { config } = fixture()
    const listing = await new LibraryService(() => config, 5173).listing({ libraryId: 'main', dir: 'sub' })

    expect(listing.entries.map((entry) => entry.path)).toEqual(['sub/b.flac'])
  })
})

describe('LibraryService search', () => {
  it('matches accented names when the query has no accents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'c10-accent-'))
    directories.push(root)
    mkdirSync(join(root, 'Radio Oxigénio'))
    writeFileSync(join(root, 'Radio Oxigénio', 'Rádio Oxigénio.mp3'), 'x')
    const config: AppConfig = {
      host: '192.168.1.100',
      httpPort: 80,
      upnpPort: 49152,
      libraries: [{ id: 'main', name: 'Main', path: root }],
      browseRoots: [],
      mediaBaseUrl: 'http://192.168.1.135:5173',
    }
    const service = new LibraryService(() => config, 5173)

    const tracks = await service.listing({ query: 'oxigenio' })
    const albums = await service.albums({ query: 'oxigenio' })

    expect(tracks.entries.map((entry) => entry.name)).toEqual(['Rádio Oxigénio'])
    expect(albums.albums.map((album) => album.name)).toEqual(['Radio Oxigénio'])
  })
})

describe('LibraryService.resolveTarget', () => {
  it('rebuilds a stored library URL against the current media address', () => {
    const { config } = fixture()
    const service = new LibraryService(() => config, 5173)

    const resolved = service.resolveTarget({
      url: 'http://10.0.0.9:8787/api/library/file?library=main&path=sub%2Fb.flac',
      title: 'B',
      isLive: false,
    })

    expect(resolved.url).toBe('http://192.168.1.135:5173/api/library/file?library=main&path=sub%2Fb.flac')
    expect(resolved.title).toBe('B')
  })

  it('leaves other URLs and missing files alone', () => {
    const { config } = fixture()
    const service = new LibraryService(() => config, 5173)
    const radio: PlayTarget = { url: 'http://stream.example.com/live.aac', isLive: true }
    const missing: PlayTarget = { url: 'http://10.0.0.9:8787/api/library/file?library=main&path=missing.mp3' }

    expect(service.resolveTarget(radio)).toEqual(radio)
    expect(service.resolveTarget(missing)).toEqual(missing)
  })
})

describe('LibraryService.artworkForPlayback', () => {
  it('returns an art URL only when the file has a cover', async () => {
    const { config, root } = fixture()
    mkdirSync(join(root, 'Album'))
    writeFileSync(join(root, 'Album', 'track.mp3'), 'x')
    writeFileSync(join(root, 'Album', 'cover.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))
    const service = new LibraryService(() => config, 5173)

    const withArt = await service.artworkForPlayback('http://192.168.1.135:5173/api/library/file?library=main&path=Album%2Ftrack.mp3')
    const withoutArt = await service.artworkForPlayback('http://192.168.1.135:5173/api/library/file?library=main&path=a.mp3')

    expect(withArt).toBe('/api/library/art?library=main&path=Album%2Ftrack.mp3')
    expect(withoutArt).toBeNull()
  })
})

describe('LibraryService multi-disc albums', () => {
  it('groups disc folders under one album and plays them together', async () => {
    const { config, root } = fixture()
    mkdirSync(join(root, 'Release', 'CD1'), { recursive: true })
    mkdirSync(join(root, 'Release', 'CD2'), { recursive: true })
    writeFileSync(join(root, 'Release', 'CD1', '01.mp3'), 'x')
    writeFileSync(join(root, 'Release', 'CD2', '01.mp3'), 'x')
    const service = new LibraryService(() => config, 5173)

    const albums = await service.albums()
    const release = albums.albums.find((album) => album.name === 'Release')
    expect(release?.path).toBe('Release')
    expect(release?.trackCount).toBe(2)

    const tracks = await service.listing({ libraryId: 'main', dir: 'Release' })
    expect(tracks.entries.map((entry) => entry.path)).toEqual(['Release/CD1/01.mp3', 'Release/CD2/01.mp3'])

    const album = await service.albumTargets('main', 'Release')
    expect(album?.targets).toHaveLength(2)
    expect(album?.index).toBe(0)

    const singleDisc = await service.folderTargets('main', 'Release/CD2/01.mp3')
    expect(singleDisc?.targets).toHaveLength(1)
  })
})

describe('parseRange', () => {
  it('parses common byte ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 })
  })

  it('rejects malformed and unsatisfiable ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=100-', 100)).toBeNull()
    expect(parseRange('bytes=5-2', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
    expect(parseRange('bytes=-', 100)).toBeNull()
  })
})

describe('LibraryService.stream', () => {
  async function startServer(config: AppConfig): Promise<string> {
    const library = new LibraryService(() => config, 5173)
    const server = createServer((request, response) => {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams
      if (!library.stream(params.get('library') ?? '', params.get('path') ?? '', request, response)) {
        response.writeHead(404).end()
      }
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('No port')
    }
    return `http://127.0.0.1:${address.port}`
  }

  it('serves a byte range', async () => {
    const { config } = fixture()
    const base = await startServer(config)

    const response = await fetch(`${base}/?library=main&path=a.mp3`, { headers: { Range: 'bytes=0-3' } })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-3/10')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await response.text()).toBe('0123')
  })

  it('serves the whole file without a range', async () => {
    const { config } = fixture()
    const base = await startServer(config)

    const response = await fetch(`${base}/?library=main&path=a.mp3`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(await response.text()).toBe('0123456789')
  })

  it('answers 416 for an unsatisfiable range', async () => {
    const { config } = fixture()
    const base = await startServer(config)

    const response = await fetch(`${base}/?library=main&path=a.mp3`, { headers: { Range: 'bytes=99-' } })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })

  it('answers 404 for a file outside the root', async () => {
    const { config } = fixture()
    const base = await startServer(config)

    const response = await fetch(`${base}/?library=main&path=..%2Fsecret.mp3`)

    expect(response.status).toBe(404)
  })
})
