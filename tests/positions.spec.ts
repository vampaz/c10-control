import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PositionStore } from '../server/positions.ts'

const directories: string[] = []
const URL = 'http://192.168.1.135:8787/api/library/file?library=main&path=Album%2Fa.mp3'

function store(): { positions: PositionStore; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'c10-positions-'))
  directories.push(directory)
  return { positions: new PositionStore(directory), directory }
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('PositionStore', () => {
  it('resumes by library and path even when the address changed', () => {
    const { positions } = store()

    positions.record(URL, 42.5, 200, false)

    expect(positions.resume(URL)).toBe(42)
    expect(positions.resume('http://10.0.0.9:8787/api/library/file?library=main&path=Album%2Fa.mp3')).toBe(42)
  })

  it('ignores the start and the end of a track', () => {
    const { positions } = store()

    positions.record(URL, 2, 200, false)
    expect(positions.resume(URL)).toBeNull()

    positions.record(URL, 195, 200, false)
    expect(positions.resume(URL)).toBeNull()
  })

  it('forgets a track that ended', () => {
    const { positions } = store()

    positions.record(URL, 80, 200, false)
    positions.record(URL, 200, 200, true)

    expect(positions.resume(URL)).toBeNull()
  })

  it('persists positions across instances', () => {
    const { positions, directory } = store()
    positions.record(URL, 64, 200, false)

    const reloaded = new PositionStore(directory)

    expect(reloaded.resume(URL)).toBe(64)
  })
})
