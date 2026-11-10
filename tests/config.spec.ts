import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, saveConfig, validateConfig } from '../server/config.ts'

const directories: string[] = []

function useTempDataDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'c10-config-'))
  directories.push(directory)
  process.env.C10_DATA_DIR = directory
  return directory
}

afterEach(() => {
  delete process.env.C10_DATA_DIR
  delete process.env.C10_HOST
  delete process.env.C10_LIBRARY_DIR
  delete process.env.C10_LIBRARY_DIRS
  delete process.env.C10_BROWSE_ROOTS
  delete process.env.C10_MEDIA_URL
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('validateConfig', () => {
  it('accepts an IPv4 address', () => {
    expect(validateConfig({ host: ' 192.168.1.100 ' })).toEqual({ host: '192.168.1.100' })
  })

  it('accepts a host name', () => {
    expect(validateConfig({ host: 'speaker.local' })).toEqual({ host: 'speaker.local' })
  })

  it('rejects an empty or malformed host', () => {
    expect(() => validateConfig({ host: '' })).toThrow('Enter a valid IP address or host name')
    expect(() => validateConfig({ host: '-bad' })).toThrow('Enter a valid IP address or host name')
  })

  it('validates ports', () => {
    expect(validateConfig({ upnpPort: 49152 })).toEqual({ upnpPort: 49152 })
    expect(() => validateConfig({ httpPort: 0 })).toThrow('httpPort must be a port between 1 and 65535')
    expect(() => validateConfig({ httpPort: 70000 })).toThrow('httpPort must be a port between 1 and 65535')
  })

  it('normalises libraries and the media URL', () => {
    expect(validateConfig({
      libraries: [{ name: ' Music ', path: ' /music ' }],
      mediaBaseUrl: 'http://192.168.1.135:5173/',
    })).toEqual({
      libraries: [{ id: expect.any(String), name: 'Music', path: '/music' }],
      mediaBaseUrl: 'http://192.168.1.135:5173',
    })
  })

  it('allows clearing the library settings', () => {
    expect(validateConfig({ libraries: [], mediaBaseUrl: '' })).toEqual({ libraries: [], mediaBaseUrl: '' })
  })

  it('expands a home folder', () => {
    const libraries = validateConfig({ libraries: [{ path: '~/Music' }] }).libraries ?? []

    expect(libraries[0].path).toBe(join(homedir(), 'Music'))
    expect(libraries[0].name).toBe('Music')
  })

  it('deduplicates libraries by path', () => {
    const libraries = validateConfig({
      libraries: [{ path: '/music' }, { path: '/music' }, { path: '/other' }],
    }).libraries ?? []

    expect(libraries.map((library) => library.path)).toEqual(['/music', '/other'])
  })

  it('normalises and deduplicates browse roots', () => {
    expect(validateConfig({ browseRoots: [' /host/music ', '/host/music'] }).browseRoots).toEqual(['/host/music'])
  })

  it('rejects a media URL that is not http', () => {
    expect(() => validateConfig({ mediaBaseUrl: 'ftp://example.com' })).toThrow('http:// or https://')
  })
})

describe('saveConfig', () => {
  it('persists the address and reads it back', () => {
    useTempDataDir()
    expect(saveConfig({ host: '192.168.1.77' }).host).toBe('192.168.1.77')
    expect(loadConfig().host).toBe('192.168.1.77')
  })

  it('falls back to defaults when nothing is stored', () => {
    useTempDataDir()
    expect(loadConfig()).toMatchObject({
      host: '192.168.1.100',
      httpPort: 80,
      upnpPort: 49152,
      libraries: [],
      browseRoots: [],
      mediaBaseUrl: '',
      pinnedHost: false,
    })
  })

  it('does not configure a library by default', () => {
    useTempDataDir()
    expect(loadConfig().libraries).toEqual([])
  })

  it('accepts a library default from the environment', () => {
    useTempDataDir()
    process.env.C10_LIBRARY_DIR = '/music'

    const config = loadConfig()
    expect(config.libraries).toHaveLength(1)
    expect(config.libraries[0].path).toBe('/music')
  })

  it('accepts browse roots from the environment', () => {
    useTempDataDir()
    process.env.C10_BROWSE_ROOTS = '/volumes,/media'

    expect(loadConfig().browseRoots).toEqual(['/volumes', '/media'])
  })

  it('lets the environment override the default host', () => {
    useTempDataDir()
    process.env.C10_HOST = '10.0.0.9'
    expect(loadConfig().host).toBe('10.0.0.9')
  })

  it('lets the environment win over a saved address', () => {
    useTempDataDir()
    saveConfig({ host: '192.168.1.77' })
    process.env.C10_HOST = '10.0.0.9'

    const config = loadConfig()
    expect(config.host).toBe('10.0.0.9')
    expect(config.pinnedHost).toBe(true)
  })

  it('refuses to save a different address while the environment pins it', () => {
    useTempDataDir()
    process.env.C10_HOST = '10.0.0.9'

    expect(() => saveConfig({ host: '192.168.1.77' })).toThrow(
      'The address is set by C10_HOST in the environment',
    )
    expect(saveConfig({ host: '10.0.0.9' }).host).toBe('10.0.0.9')
  })
})
