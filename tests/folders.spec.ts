import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../shared/types.ts'
import { FolderBrowser } from '../server/folders.ts'

const directories: string[] = []

function fixture(): { root: string; outside: string; config: AppConfig } {
  const root = mkdtempSync(join(tmpdir(), 'c10-folders-'))
  const outside = mkdtempSync(join(tmpdir(), 'c10-outside-'))
  directories.push(root, outside)
  mkdirSync(join(root, 'music'))
  mkdirSync(join(root, 'other'))
  mkdirSync(join(root, '.hidden'))
  writeFileSync(join(root, 'notes.txt'), 'not a folder')
  mkdirSync(join(outside, 'secret'))
  symlinkSync(join(outside, 'secret'), join(root, 'escape'))

  return {
    root,
    outside,
    config: {
      host: '192.168.1.100',
      httpPort: 80,
      upnpPort: 49152,
      libraries: [],
      browseRoots: [root],
      mediaBaseUrl: '',
    },
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('FolderBrowser', () => {
  it('lists directories under the first root by default', async () => {
    const { root, config } = fixture()
    const listing = await new FolderBrowser(() => config).listing('')

    expect(listing.path).toBe(realpathSync(root))
    expect(listing.parent).toBeNull()
    expect(listing.folders.map((folder) => folder.name)).toEqual(['music', 'other'])
  })

  it('navigates into a subfolder and back to the root', async () => {
    const { root, config } = fixture()
    const realRoot = realpathSync(root)
    const browser = new FolderBrowser(() => config)

    const music = await browser.listing(join(root, 'music'))
    expect(music.path).toBe(join(realRoot, 'music'))
    expect(music.parent).toBe(realRoot)
    expect(music.folders).toEqual([])

    const rootAgain = await browser.listing(music.parent ?? '')
    expect(rootAgain.path).toBe(realRoot)
    expect(rootAgain.parent).toBeNull()
  })

  it('rejects a path outside the browse roots', async () => {
    const { outside, config } = fixture()

    await expect(new FolderBrowser(() => config).listing(outside)).rejects.toThrow('outside the allowed browse roots')
  })

  it('rejects a symlink that escapes the root', async () => {
    const { root, config } = fixture()

    await expect(new FolderBrowser(() => config).listing(join(root, 'escape'))).rejects.toThrow('outside the allowed browse roots')
  })

  it('returns an empty listing when no roots are configured', async () => {
    const { config } = fixture()
    const listing = await new FolderBrowser(() => ({ ...config, browseRoots: [] })).listing('')

    expect(listing).toEqual({ path: '', parent: null, roots: [], folders: [] })
  })
})
